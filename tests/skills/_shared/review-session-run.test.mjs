import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawn} from "node:child_process";
import {afterEach, beforeEach, expect, it} from "vitest";
import {prepareJob, acceptResult, jobDirectory} from "../../../.agents/skills/_shared/scripts/review-session-job.mjs";
import {harnessInvocation, finalMessage, runAttempt} from "../../../.agents/skills/_shared/scripts/review-session-run.mjs";

let repo;
const id = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
const modes = {codex: "read-only", claude: "dontAsk", opencode: "build"};
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const jobPath = () => path.join(jobDirectory(repo, id), "job.json");

function prepare(provider = "codex", model = "test", fallback = false, timeout = "1") {
    const config = {PLAN_REVIEW_1_HARNESS: provider, PLAN_REVIEW_1_MODEL: model,
        PLAN_REVIEW_1_THINKING: "high", PLAN_REVIEW_1_MODE: modes[provider], PLAN_REVIEW_TIMEOUT_SECONDS: timeout};
    if (fallback) {
        Object.assign(config, {PLAN_REVIEW_2_HARNESS: "claude", PLAN_REVIEW_2_MODEL: "test",
            PLAN_REVIEW_2_THINKING: "low", PLAN_REVIEW_2_MODE: "dontAsk"});
    }
    return prepareJob({prefix: "PLAN_REVIEW", kind: "plan-review", jobId: id,
        task: path.join(repo, "task.md"), context: [path.join(repo, "plan.md")]}, {cwd: repo, readConfig: () => config});
}

beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "direct review-")));
    execFileSync("git", ["init", "--quiet"], {cwd: repo});
    fs.writeFileSync(path.join(repo, ".gitignore"), "/var/\n");
    fs.writeFileSync(path.join(repo, "plan.md"), "# Plan\n");
    fs.writeFileSync(path.join(repo, "task.md"), "Review the plan.\n");
    fs.mkdirSync(path.join(repo, "fake-bin"));
    fs.writeFileSync(path.join(repo, ".env"), "BIN_PATH=./fake-bin\nREVIEW_ENV_PROBE=from-project\n");
    for (const provider of ["codex", "claude", "opencode"]) {
        fs.writeFileSync(path.join(repo, "fake-bin", provider), `#!${process.execPath}
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const args = process.argv.slice(2);
fs.writeFileSync('invocation.json', JSON.stringify(args));
fs.writeFileSync('env-probe.txt', process.env.REVIEW_ENV_PROBE ?? 'unset');
const model = args[args.indexOf('--model') + 1];
if (model === 'timeout' || model === 'hang') {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
    fs.writeFileSync('descendant.pid', String(child.pid));
    setInterval(() => {}, 1000);
} else {
    if (model === 'error') { process.exit(2); }
    const job = JSON.parse(fs.readFileSync(${JSON.stringify(jobPath())}, 'utf8'));
    const report = JSON.stringify({version:1, job_id:job.job_id, binding_sha256:job.binding_sha256,
        status:'COMPLETE', report_markdown:'No findings.', payload:{verdict:'PLAN READY', findings:[], previous_resolutions:[]}});
    if (model === 'stale') { fs.appendFileSync('plan.md', 'changed'); }
    if (${JSON.stringify(provider)} === 'codex') {
        fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], report);
        console.log('progress only');
    } else if (${JSON.stringify(provider)} === 'claude') {
        console.log(JSON.stringify({type:'result', subtype:'success', is_error:false, result:report}));
    } else {
        console.log(JSON.stringify({type:'text', part:{text:report}}));
        console.log(JSON.stringify({type:'step_finish', part:{reason:'stop'}}));
    }
}
`, {mode: 0o755});
    }
});
afterEach(() => fs.rmSync(repo, {recursive: true, force: true}));

it.each(["codex", "claude", "opencode"])("runs %s through the consumer resolver and accepts its bound report", async provider => {
    prepare(provider);
    const outcome = await runAttempt(jobPath());
    expect(outcome.next.action).toBe("accept");
    const result = acceptResult({jobPath: jobPath(), inspect: read(outcome.inspect_path),
        envelopeText: fs.readFileSync(outcome.envelope_path, "utf8")});
    expect(result.next.action).toBe("evaluate");
    expect(read(jobPath()).result.decision).toBe("ACCEPTED");
    const args = read(path.join(repo, "invocation.json"));
    expect(args.join(" ")).toContain("high");
    expect(args).toContain("test");
    expect(read(outcome.inspect_path).provider).toBe(provider);
});

it("advances after a provider error without retrying the same profile", async () => {
    prepare("codex", "error", true);
    expect((await runAttempt(jobPath())).next.attempt).toBe("2");
    expect((await runAttempt(jobPath())).next.action).toBe("accept");
    expect(read(jobPath()).disabled_profiles["1"].reason).toBe("PROVIDER_ERROR");
});

it("records missing CLI as launch failure and falls back to self", async () => {
    prepare();
    fs.writeFileSync(path.join(repo, "fake-bin/codex"), "#!/bin/sh\nexit 127\n", {mode: 0o755});
    const outcome = await runAttempt(jobPath());
    expect(outcome.reason).toBe("LAUNCH_FAILED");
    expect(outcome.next.action).toBe("self");
});

it("kills the timeout process group including descendants", async () => {
    prepare("codex", "timeout");
    const outcome = await runAttempt(jobPath());
    expect(outcome.reason).toMatch(/^TIMEOUT_STOP/);
    expect(outcome.next.action).toBe("self");
    const pid = Number(fs.readFileSync(path.join(repo, "descendant.pid"), "utf8"));
    // A reparented zombie can remain until the container init reaps it.
    const stat = `/proc/${pid}/stat`;
    expect(!fs.existsSync(stat) || fs.readFileSync(stat, "utf8").split(") ")[1].startsWith("Z")).toBe(true);
});

it("retains stale-input detection", async () => {
    prepare("codex", "stale");
    const outcome = await runAttempt(jobPath());
    const accepted = acceptResult({jobPath: jobPath(), inspect: read(outcome.inspect_path),
        envelopeText: fs.readFileSync(outcome.envelope_path, "utf8")});
    expect(accepted.next.reason).toBe("INPUT_CHANGED");
    expect(read(jobPath()).disabled_profiles).toEqual({});
});

it("rejects unknown modes and harnesses rather than silently using defaults", () => {
    for (const provider of ["codex", "claude", "opencode", "other"]) {
        expect(() => harnessInvocation({provider, model: "test", thinking: "high", mode: "typo"}, {})).toThrow();
    }
    expect(() => harnessInvocation({provider: "codex", model: "test", thinking: "high", mode: "constructor"}, {})).toThrow();
    const invocation = harnessInvocation({provider: "codex", model: "test", thinking: "high", mode: "auto-review"},
        {cwd: repo, outputFile: "/tmp/message", prompt: "untrusted `text` $(false)"});
    expect(invocation.args).toContain('approval_policy="never"');
    expect(invocation.args).toContain("workspace-write");
    expect(invocation.input).toBe("untrusted `text` $(false)");
});

it("rejects denied permissions, incomplete turns and provider errors", () => {
    expect(() => finalMessage("claude", JSON.stringify({type: "result", subtype: "success", result: "{}",
        permission_denials: [{tool_name: "Read"}]}))).toThrow();
    for (const events of [[{type: "text", part: {text: "{}"}}], [{type: "error"}], []]) {
        expect(() => finalMessage("opencode", events.map(e => JSON.stringify(e)).join("\n"))).toThrow();
    }
});

const RUNNER = path.resolve(import.meta.dirname, "../../../.agents/skills/_shared/scripts/review-session-run.mjs");
const settled = pid => {
    // A reparented zombie can remain until init reaps it.
    const stat = `/proc/${pid}/stat`;
    return !fs.existsSync(stat) || fs.readFileSync(stat, "utf8").split(") ")[1].startsWith("Z");
};

async function startHangingRunner() {
    prepare("codex", "hang", true, "60");
    const runner = spawn(process.execPath, [RUNNER, "--job", jobPath()], {cwd: repo, stdio: ["ignore", "pipe", "pipe"]});
    let output = "";
    runner.stdout.on("data", chunk => { output += chunk; });
    const exited = new Promise(resolve => runner.once("exit", resolve));
    const pidFile = path.join(repo, "descendant.pid");
    for (let waited = 0; !fs.existsSync(pidFile) && waited < 100; waited += 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    // The leftover process is the fake CLI's group; it is killed in the test.
    return {runner, exited, output: () => output, descendant: () => Number(fs.readFileSync(pidFile, "utf8"))};
}

it("runs the reviewer with the coordinator environment, not the project env files", async () => {
    prepare("codex");
    process.env.REVIEW_ENV_PROBE = "coordinator";
    try { await runAttempt(jobPath()); } finally { delete process.env.REVIEW_ENV_PROBE; }
    expect(fs.readFileSync(path.join(repo, "env-probe.txt"), "utf8")).toBe("coordinator");
});

it("does not leak project env values into the reviewer and still resolves BIN_PATH", async () => {
    prepare("codex");
    delete process.env.REVIEW_ENV_PROBE;
    expect((await runAttempt(jobPath())).next.action).toBe("accept");
    expect(fs.readFileSync(path.join(repo, "env-probe.txt"), "utf8")).toBe("unset");
});

it("ends the round in self review on SIGTERM without disabling the profile", async () => {
    const {runner, exited, output, descendant} = await startHangingRunner();
    runner.kill("SIGTERM");
    await exited;
    const outcome = JSON.parse(output());
    expect(outcome.reason).toBe("RUNNER_INTERRUPTED");
    expect(outcome.next).toMatchObject({action: "self", reason: "INTERRUPTED"});
    expect(read(jobPath()).disabled_profiles).toEqual({});
    expect(settled(descendant())).toBe(true);
});

it("recovers an attempt whose runner was killed: stops the leftover group, no penalty", async () => {
    const {runner, exited, descendant} = await startHangingRunner();
    runner.kill("SIGKILL");
    await exited;
    expect(settled(descendant())).toBe(false);
    const outcome = await runAttempt(jobPath());
    expect(outcome.recovered).toBe(true);
    expect(outcome.next.action).toBe("self");
    expect(settled(descendant())).toBe(true);
    expect(read(jobPath()).disabled_profiles).toEqual({});
});
