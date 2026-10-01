#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {chmodSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
    createCandidateStatePath, createSafeLog, defaultResolvePlaywright, hasSafeStateDirectories,
    isAcceptableStateTarget, isIgnoredByGit, isHttpUrl, isUsableExistingState,
    resolveStatePath, verifyStateAccess,
} from "./playwright-auth-bootstrap.mjs";

function isSameFile(candidate, target) {
    if (candidate.absolute === target.absolute) { return true; }
    try {
        const source = lstatSync(candidate.absolute);
        const destination = lstatSync(target.absolute);
        return source.dev === destination.dev && source.ino === destination.ino;
    } catch (error) {
        if (error.code === "ENOENT") { return false; }
        throw error;
    }
}

function validateOperation({stage, promote, session, candidatePath, evidence}) {
    if (stage === promote || (stage && (candidatePath !== undefined || evidence !== undefined))
        || (promote && session !== undefined)) {
        return "arguments-invalid";
    }
    if (promote && (typeof evidence !== "string" || !evidence.trim())) {
        return "evidence-missing";
    }
    if (stage && (typeof session !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(session))) {
        return "session-invalid";
    }
    return null;
}

/** Stage privately, or promote an independent candidate after evidence and a fresh-context check. */
export async function runAuthFinalize({
    env = {}, cwd = process.cwd(), cliPath, session, stage = false, promote = false,
    candidate: candidatePath, evidence,
    url = env.PLAYWRIGHT_GUI_BASE_URL,
    resolvePlaywright = () => defaultResolvePlaywright(cliPath, cwd),
    runCli = spawnSync, log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
    const safeLog = createSafeLog(log, env);
    const fail = (code, reason) => {
        safeLog("Authentication: FAIL");
        safeLog(`Reason: ${reason}`);
        safeLog("Access: BLOCKED");
        return {code, reason};
    };
    let candidate = null;
    let retainCandidate = false;
    try {
        const invalidOperation = validateOperation({stage, promote, session, candidatePath, evidence});
        if (invalidOperation !== null) { return fail(2, invalidOperation); }
        const target = resolveStatePath(env, cwd);
        if (!hasSafeStateDirectories(target, cwd) || !isAcceptableStateTarget(target)
            || !isIgnoredByGit(cwd, target.absolute)) {
            return fail(3, "state-invalid");
        }
        if (stage) {
            candidate = createCandidateStatePath(target);
            mkdirSync(path.dirname(candidate.absolute), {recursive: true});
            if (!hasSafeStateDirectories(candidate, cwd) || !isIgnoredByGit(cwd, candidate.absolute)) {
                return fail(3, "state-invalid");
            }
            // Reserve privately before CLI writes cookies; never expose a 0644 interval.
            writeFileSync(candidate.absolute, "", {flag: "wx", mode: 0o600});
            const cliEnv = {...process.env, ...env};
            delete cliEnv.DEBUG;
            delete cliEnv.PWDEBUG;
            delete cliEnv.PLAYWRIGHT_GUI_USER_LOGIN;
            delete cliEnv.PLAYWRIGHT_GUI_USER_PASSWORD;
            const saved = runCli(cliPath, [`-s=${session}`, "state-save", candidate.relative], {
                cwd, env: cliEnv, encoding: "utf8", timeout: 30000,
            });
            if (saved.error || saved.status !== 0) {
                return fail(3, "state-save-failed");
            }
        } else {
            if (typeof candidatePath !== "string" || !candidatePath) { return fail(3, "state-invalid"); }
            const supplied = resolveStatePath({PLAYWRIGHT_GUI_STORAGE_STATE: candidatePath}, cwd);
            // Do not chmod, verify or register cleanup until canonical identity is excluded.
            if (!isUsableExistingState(supplied, cwd) || isSameFile(supplied, target)
                || !/^candidate-[\w-]+\.json$/.test(path.basename(supplied.absolute))) {
                return fail(3, "state-invalid");
            }
            candidate = supplied;
        }
        if (!isUsableExistingState(candidate, cwd) || isSameFile(candidate, target)) {
            return fail(3, "state-invalid");
        }
        chmodSync(candidate.absolute, 0o600);
        if (stage) {
            retainCandidate = true;
            safeLog("Authentication: ACTION_REQUIRED");
            safeLog(`Candidate state: ${candidate.relative}`);
            safeLog("Access: VERIFY_REQUIRED");
            return {code: 0, reason: null};
        }
        if (!isHttpUrl(url)) { return fail(2, "url-invalid"); }
        let playwright;
        try {
            playwright = await resolvePlaywright();
        } catch {
            return fail(2, "playwright-module-unavailable");
        }
        const verified = await verifyStateAccess({
            playwright, statePath: candidate, url,
            loginUrl: env.PLAYWRIGHT_GUI_LOGIN_URL,
        });
        if (!verified) {
            return fail(3, "access-not-confirmed");
        }
        if (!hasSafeStateDirectories(target, cwd) || !isAcceptableStateTarget(target)
            || !isUsableExistingState(candidate, cwd) || isSameFile(candidate, target)
            || !isIgnoredByGit(cwd, target.absolute)) {
            return fail(3, "state-invalid");
        }
        renameSync(candidate.absolute, target.absolute);
        safeLog("Authentication: OK");
        safeLog(`Storage state: ${target.relative}`);
        safeLog(`Evidence: ${evidence.trim().replace(/[\r\n]/g, " ")}`);
        safeLog("Access: READY");
        return {code: 0, reason: null};
    } catch (error) {
        return error?.reason === "browser-unavailable"
            ? fail(2, "browser-unavailable") : fail(1, "internal-error");
    } finally {
        if (!retainCandidate && candidate !== null && hasSafeStateDirectories(candidate, cwd)) {
            try {
                rmSync(candidate.absolute, {force: true});
            } catch {
                // Cleanup must not leak an exception or hide the authentication result.
            }
        }
    }
}

async function main() {
    const options = {};
    const invalidArguments = () => {
        process.stdout.write("Authentication: FAIL\nReason: arguments-invalid\nAccess: BLOCKED\n");
        process.exitCode = 2;
    };
    const keys = {"--cli": "cliPath", "--session": "session", "--candidate": "candidate", "--evidence": "evidence", "--url": "url"};
    const args = process.argv.slice(2);
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
        process.stdout.write("Usage: playwright-auth-finalize.mjs --stage --cli <cli> --session <name>\n       playwright-auth-finalize.mjs --promote --candidate <path> --evidence <text> [--url <url>] [--cli <cli>]\n");
        return;
    }
    for (let index = 0; index < args.length; index += 1) {
        if (["--stage", "--promote"].includes(args[index])) {
            const key = args[index].slice(2);
            if (options[key]) { invalidArguments(); return; }
            options[key] = true;
            continue;
        }
        if (!keys[args[index]] || args[index + 1] === undefined || options[keys[args[index]]] !== undefined) {
            invalidArguments();
            return;
        }
        options[keys[args[index]]] = args[index + 1];
        index += 1;
    }
    const result = await runAuthFinalize({...options, env: process.env});
    process.exitCode = result.code;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    await main();
}
