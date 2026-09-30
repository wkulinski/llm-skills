#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {chmodSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
    createSafeLog, defaultResolvePlaywright, hasSafeStateDirectories,
    isAcceptableStateTarget, isIgnoredByGit, isHttpUrl, isUsableExistingState,
    resolveStatePath, verifyAuthenticatedState,
} from "./playwright-auth-bootstrap.mjs";

/** Promote only state proven usable in a new context, never an agent's assertion. */
export async function runAuthFinalize({
    env = {}, cwd = process.cwd(), cliPath, session, selector = env.PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR,
    url = env.PLAYWRIGHT_GUI_BASE_URL,
    resolvePlaywright = () => defaultResolvePlaywright(cliPath, cwd),
    runCli = spawnSync, log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
    const safeLog = createSafeLog(log, env);
    const fail = (code, reason) => {
        safeLog("Authentication: FAIL");
        safeLog(`Reason: ${reason}`);
        return {code, reason};
    };
    let candidate = null;
    try {
        if (typeof session !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(session)) {
            return fail(2, "session-invalid");
        }
        if (!isHttpUrl(url) || typeof selector !== "string" || !selector.trim()) {
            return fail(2, "verification-config-missing");
        }
        const target = resolveStatePath(env, cwd);
        if (!hasSafeStateDirectories(target, cwd) || !isAcceptableStateTarget(target)
            || !isIgnoredByGit(cwd, target.absolute)) {
            return fail(3, "state-invalid");
        }
        candidate = {
            absolute: path.join(path.dirname(target.absolute), `finalizing-${randomUUID()}.json`),
        };
        candidate.relative = path.relative(cwd, candidate.absolute).split(path.sep).join("/");
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
        if (!isUsableExistingState(candidate, cwd)) {
            return fail(3, "state-invalid");
        }
        chmodSync(candidate.absolute, 0o600);
        let playwright;
        try {
            playwright = await resolvePlaywright();
        } catch {
            return fail(2, "playwright-module-unavailable");
        }
        const verified = await verifyAuthenticatedState({
            playwright, statePath: candidate, url,
            selector, loginUrl: env.PLAYWRIGHT_GUI_LOGIN_URL,
        });
        if (!verified) {
            return fail(3, "access-not-confirmed");
        }
        if (!hasSafeStateDirectories(target, cwd) || !isAcceptableStateTarget(target)
            || !isUsableExistingState(candidate, cwd) || !isIgnoredByGit(cwd, target.absolute)) {
            return fail(3, "state-invalid");
        }
        renameSync(candidate.absolute, target.absolute);
        safeLog("Authentication: OK");
        safeLog(`Storage state: ${target.relative}`);
        safeLog("Access: READY");
        return {code: 0, reason: null};
    } catch (error) {
        return error?.reason === "browser-unavailable"
            ? fail(2, "browser-unavailable") : fail(1, "internal-error");
    } finally {
        if (candidate !== null && hasSafeStateDirectories(candidate, cwd)) {
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
    const keys = {"--cli": "cliPath", "--session": "session", "--selector": "selector", "--url": "url"};
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index += 2) {
        if (!keys[args[index]] || !args[index + 1]) {
            process.stdout.write("Authentication: FAIL\nReason: arguments-invalid\n");
            process.exitCode = 2;
            return;
        }
        options[keys[args[index]]] = args[index + 1];
    }
    const result = await runAuthFinalize({...options, env: process.env});
    process.exitCode = result.code;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
    await main();
}
