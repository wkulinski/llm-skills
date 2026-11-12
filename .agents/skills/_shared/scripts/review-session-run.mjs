#!/usr/bin/env node

// Execute one prepared attempt. Review policy and report validation stay in
// review-session-job/review-cycle; this module only owns the child process.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "./file-process-async.mjs";
import {execFileSync} from "./file-process.mjs";
import {bindSession, recordFailure, recordInterruption} from "./review-session-job.mjs";
import {isMainModule} from "./is-main-module.mjs";

const ENV_LOADER = fileURLToPath(new URL("./env-load.sh", import.meta.url));
// The project env only resolves the executable (BIN_PATH). It is sourced in this
// throwaway shell and never reaches the reviewer, which runs with the
// coordinator's own environment.
const RESOLVE_SCRIPT = 'source "$1" >/dev/null || exit 127; resolve_tool_cmd "$2"';
const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const MODES = {
    codex: {"read-only": "read-only", "auto-review": "workspace-write", "full-access": "danger-full-access"},
    claude: new Set(["auto", "acceptEdits", "bypassPermissions", "dontAsk", "plan"]),
};

export function harnessInvocation(profile, {cwd, outputFile, prompt}) {
    const {provider, model, thinking, mode} = profile;
    if (![provider, model, thinking, mode].every(value => typeof value === "string" && value.length > 0)) {
        throw new Error("HARNESS, MODEL, THINKING and MODE are required.");
    }
    if (provider === "codex") {
        const sandbox = Object.hasOwn(MODES.codex, mode) ? MODES.codex[mode] : null;
        if (!sandbox) { throw new Error("Unsupported Codex MODE; use read-only, auto-review or full-access."); }
        return {args: ["exec", "--model", model, "-c", `model_reasoning_effort=${JSON.stringify(thinking)}`,
            "-c", 'approval_policy="never"', "--sandbox", sandbox, "--cd", cwd,
            "--output-last-message", outputFile, "-"], input: prompt};
    }
    if (provider === "claude") {
        if (!MODES.claude.has(mode)) { throw new Error("Unsupported Claude permission MODE."); }
        return {args: ["--print", "--output-format", "json", "--model", model, "--effort", thinking,
            "--permission-mode", mode], input: prompt};
    }
    if (provider === "opencode") {
        // OpenCode calls its selected agent a mode; permission policy remains
        // the consumer's configuration, just as for Paseo's build/plan modes.
        if (!["build", "plan"].includes(mode)) { throw new Error("Unsupported OpenCode MODE; use build or plan."); }
        return {args: ["run", "--format", "json", "--model", model, "--variant", thinking,
            "--agent", mode, "--dir", cwd, "--", prompt], input: ""};
    }
    throw new Error("Unsupported HARNESS; use claude, codex or opencode.");
}

export function finalMessage(provider, stdout, outputFile) {
    if (provider === "codex") { return fs.readFileSync(outputFile, "utf8"); }
    if (provider === "claude") {
        const result = JSON.parse(stdout);
        if (result.type !== "result" || result.is_error || result.subtype !== "success" || result.permission_denials?.length) {
            throw new Error("Claude did not complete successfully or reported denied permissions.");
        }
        if (typeof result.result !== "string") { throw new Error("Claude returned no final text."); }
        return result.result;
    }
    const events = stdout.split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
    if (events.some(event => event.type === "error")) { throw new Error("OpenCode reported an error."); }
    if (!events.some(event => event.type === "step_finish" && event.part?.reason === "stop")) {
        throw new Error("OpenCode did not report a completed turn.");
    }
    const texts = events.filter(event => event.type === "text" && typeof event.part?.text === "string");
    if (!texts.length) { throw new Error("OpenCode returned no final text."); }
    return texts.at(-1).part.text;
}

// Resolve the CLI through the consumer env without exporting that env to it.
function resolveTool(provider, repo) {
    const resolved = execFileSync("bash", ["--noprofile", "--norc", "-c", RESOLVE_SCRIPT, "review-resolve", ENV_LOADER, provider],
        {cwd: repo, encoding: "utf8"}).trim();
    if (resolved === "") { throw new Error(`${provider} CLI was not found.`); }
    // A bare name is looked up on PATH by spawn; a relative path is relative to the repository.
    return resolved.includes("/") ? path.resolve(repo, resolved) : resolved;
}

function killGroup(pid) {
    try { process.kill(-pid, "SIGKILL"); return true; }
    catch (error) { return error.code === "ESRCH"; }
}

function exists(pid) {
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== "ESRCH"; }
}

const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));

// Start time distinguishes our process from an unrelated one that reuses its PID.
function processStart(pid) {
    try {
        return execFileSync("ps", ["-o", "lstart=", "-p", String(pid)],
            {encoding: "utf8", env: {...process.env, LC_ALL: "C"}}).trim() || null;
    } catch { return null; }
}

function runningFile(directory, runId) {
    return path.join(directory, `running-${runId}.json`);
}

function execute({job, attempt, tool, invocation, stdoutFile, stderrFile, recordRunning}) {
    return new Promise(resolve => {
        const out = fs.openSync(stdoutFile, "wx", 0o600);
        const err = fs.openSync(stderrFile, "wx", 0o600);
        let child;
        try {
            // The reviewer inherits this process's environment (no `env` option).
            child = spawn(tool, invocation.args, {cwd: job.repo, detached: true, input: invocation.input, stdio: ["pipe", out, err]});
        } catch (error) {
            resolve({error: error.code ?? "SPAWN_FAILED", code: null, timedOut: false, interrupted: false, stopped: true, pid: null});
            return;
        } finally {
            fs.closeSync(out);
            fs.closeSync(err);
        }
        // Recorded at once: if this runner dies, a restart can still stop the group.
        if (child.pid) { recordRunning(child.pid); }
        let timedOut = false;
        let interrupted = false;
        let stopped = true;
        const stop = () => { if (child.pid) { stopped = killGroup(child.pid); } };
        const onSignal = () => { interrupted = true; stop(); };
        for (const signal of SIGNALS) { process.once(signal, onSignal); }
        const timer = setTimeout(() => { timedOut = true; stop(); }, job.timeout_seconds * 1000);
        let finished = false;
        const finish = async result => {
            if (finished) { return; }
            finished = true;
            clearTimeout(timer);
            stop(); // Also remove descendants after a normal leader exit.
            if (timedOut || interrupted) {
                await pause(100);
                try { process.kill(-child.pid, 0); stopped = false; }
                catch (error) { stopped = error.code === "ESRCH"; }
            }
            for (const signal of SIGNALS) { process.removeListener(signal, onSignal); }
            resolve({...result, timedOut, interrupted, stopped, pid: child.pid});
        };
        child.once("error", error => finish({error: error.code, code: null}));
        child.once("exit", (code, signal) => finish({code, signal}));
    });
}

// A previous runner died (SIGKILL, closed terminal) after binding the attempt.
// Stop whatever it left running and end the round without penalizing the profile.
async function recoverInterrupted(jobPath, attempt) {
    const file = runningFile(path.dirname(jobPath), attempt.session.id);
    let stopped = true;
    if (fs.existsSync(file)) {
        const {pid, started} = JSON.parse(fs.readFileSync(file, "utf8"));
        const groupExists = () => { try { process.kill(-pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } };
        if (Number.isInteger(pid) && pid > 1 && groupExists()) {
            // A live leader must be the recorded process; a dead leader with a
            // surviving group cannot have its PID reused, so the group is ours.
            const now = exists(pid) ? processStart(pid) : undefined;
            if (now === undefined || (started && now === started)) {
                killGroup(pid);
                await pause(100);
                stopped = !groupExists();
            } else if (!started || now === null) {
                stopped = false;
            }
        }
    }
    return {...recordInterruption({jobPath, stopped}), recovered: true};
}

export async function runAttempt(jobPath) {
    if (process.platform === "win32") { throw new Error("Direct review requires a POSIX process-group runtime (use WSL on Windows)."); }
    const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));
    const attempt = job.attempts.find(entry => entry.outcome === null);
    if (attempt?.session && !job.result) { return recoverInterrupted(jobPath, attempt); }
    if (!attempt || job.result || attempt.session) { throw new Error("Expected an unbound, pending review attempt."); }
    const fail = reason => recordFailure({jobPath, reason});
    const runId = crypto.randomUUID();
    const directory = path.dirname(jobPath);
    const outputFile = path.join(directory, `last-message-${runId}.txt`);
    let invocation;
    let tool;
    try {
        invocation = harnessInvocation(attempt, {cwd: job.repo, outputFile,
            prompt: fs.readFileSync(path.join(directory, "prompt.md"), "utf8")});
        tool = resolveTool(attempt.provider, job.repo);
    } catch (error) {
        return {...fail("LAUNCH_FAILED"), warning: error.message};
    }
    const identity = {id: runId, provider: attempt.provider, model: attempt.model,
        thinking: attempt.thinking, cwd: job.repo, pending_permissions: []};
    const bound = bindSession({jobPath, inspect: identity});
    if (!bound.ok) { return bound; }
    const stdoutFile = path.join(directory, `stdout-${runId}.jsonl`);
    const stderrFile = path.join(directory, `stderr-${runId}.txt`);
    if (attempt.provider === "codex") { fs.writeFileSync(outputFile, "", {flag: "wx", mode: 0o600}); }
    const recordRunning = pid => fs.writeFileSync(runningFile(directory, runId),
        JSON.stringify({id: runId, pid, started: processStart(pid)}), {mode: 0o600});
    const result = await execute({job, attempt, tool, invocation, stdoutFile, stderrFile, recordRunning});
    fs.writeFileSync(path.join(directory, `process-${runId}.json`), JSON.stringify({identity, ...result}, null, 2), {mode: 0o600});
    if (result.timedOut) { return fail(result.stopped ? "TIMEOUT_STOPPED" : "TIMEOUT_STOP_UNCONFIRMED"); }
    if (result.interrupted) { return recordInterruption({jobPath, stopped: result.stopped}); }
    if (result.error || result.code !== 0) {
        return fail(result.error || result.code === 127 ? "LAUNCH_FAILED" : "PROVIDER_ERROR");
    }
    try {
        if (fs.statSync(stdoutFile).size > 16 * 1024 * 1024) { throw new Error("Harness output exceeds 16 MiB."); }
        const message = finalMessage(attempt.provider, fs.readFileSync(stdoutFile, "utf8"), outputFile);
        const envelopePath = path.join(directory, `envelope-${runId}.txt`);
        const inspectPath = path.join(directory, `inspect-${runId}.json`);
        fs.writeFileSync(envelopePath, message, {mode: 0o600});
        fs.writeFileSync(inspectPath, JSON.stringify(identity), {mode: 0o600});
        return {ok: true, attempt: attempt.name, envelope_path: envelopePath, inspect_path: inspectPath,
            next: {action: "accept", attempt: attempt.name}};
    } catch (error) {
        return {...fail("PROVIDER_ERROR"), warning: error.message};
    }
}

if (isMainModule(import.meta.url)) {
    if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
        console.log("Usage: review-session-run.mjs --job <job.json>\nExecutes one direct harness attempt; returns accept paths or the next launch/self decision.\nRe-running after an interrupted runner stops the leftover process and returns self.");
    } else if (process.argv.length === 4 && process.argv[2] === "--job") {
        try { console.log(JSON.stringify(await runAttempt(path.resolve(process.argv[3])), null, 2)); }
        catch (error) { console.error(JSON.stringify({error: error.message})); process.exitCode = 1; }
    } else {
        console.error("Usage: review-session-run.mjs --job <job.json>");
        process.exitCode = 1;
    }
}
