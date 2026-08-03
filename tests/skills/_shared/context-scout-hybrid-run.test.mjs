import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "vitest";
import {abortHybrid, claimAttempt, evaluateAttempt, finalizeHybrid, prepareHybrid, settleAttempt, settleBatch} from "../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs";
import {enrichContextManifest} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const HELPER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs");

function makeFixtureDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-hybrid-test-"));
}

function writeFixtures(dir, mode = "targeted") {
    const prompt = path.join(dir, "prompt.txt");
    const manifest = path.join(dir, "manifest.json");
    const handoff = path.join(dir, "handoff.json");
    const criteria = path.join(dir, "criteria.json");
    fs.writeFileSync(prompt, "test prompt\n");
    const sourceManifest = enrichContextManifest({
        version: 1,
        role: "primary",
        repository: "",
        branch: "",
        head: "",
        rules: ["AGENTS.md"],
        documentation: [],
        "active_overrides": [],
        constraints: [],
        "already_read": ["AGENTS.md"],
        omitted: [],
    });
    if (!sourceManifest.repository) {
        sourceManifest.repository = "local/repository";
    }
    fs.writeFileSync(manifest, JSON.stringify(sourceManifest));
    fs.writeFileSync(handoff, JSON.stringify({
        mode,
        "task_brief": "Map a test flow.",
        decisions: [],
        constraints: [],
    }));
    fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "test"}]}));
    return {prompt, manifest, handoff, criteria};
}

function validReport() {
    const evidence = {path: "AGENTS.md", "line_start": 1, "line_end": 1, relation: "defines"};
    return {
        version: 1,
        status: "COMPLETE",
        mode: "targeted",
        findings: [{"criterion_id": "C1", claim: "test claim", claim_type: "observed", confidence: "high", anchors: ["Repository Guidelines"], evidence: [evidence]}],
        coverage: [{"criterion_id": "C1", status: "covered", evidence: [evidence]}],
        risks: [],
        omitted: [],
        "next_step": "none",
    };
}

function prepare(dir, title = "test-run", mode = "targeted") {
    const files = writeFixtures(dir, mode);
    const result = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        title,
    }, ROOT);
    return {...result, files};
}

function claim(prepared, attempt = "primary") {
    return claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt});
}

test("prepare returns native task instructions and never starts OpenCode", () => {
    const dir = makeFixtureDir();
    const result = prepare(dir);
    assert.equal(result.protocolVersion, 3);
    assert.equal(result.next.action, "CLAIM_PRIMARY");
    assert.equal(result.next.agent, "context-scout-fast");
    const claimed = claim(result);
    assert.match(claimed.taskPrompt, /Do not delegate/);
    assert.match(claimed.taskPrompt, /batch-render/);
    assert.match(claimed.taskPrompt, /at most 6 relevant files, 3 symbols, and 2 tests\/commands/);
    assert.match(claimed.taskPrompt, /exactly one compact, parent-ready finding per criterion/);
    assert.match(claimed.taskPrompt, /at most three minimal evidence ranges per finding/);
    assert.match(claimed.taskPrompt, /keep coverage\[\]\.evidence empty/);
    assert.match(claimed.taskPrompt, /search for that exact name and directly read its defining source/);
    assert.match(claimed.taskPrompt, /criteria\[\]\.required_evidence entry as a hard validator gate/);
    assert.match(claimed.taskPrompt, /A COMPLETE report must not claim that an artifact does not exist/);
    assert.match(claimed.taskPrompt, /return INCOMPLETE/);
    assert.match(claimed.taskPrompt, /initialize the ledger exactly once/);
    assert.match(claimed.taskPrompt, /send it directly to batch-render as the second and final builder operation/);
    assert.match(claimed.taskPrompt, /Do not spend more than 24 steps/);
    assert.doesNotMatch(claimed.taskPrompt, /report_sha256/);
    assert.doesNotMatch(claimed.taskPrompt, /opencode run/);
    assert.throws(() => claim(result), /Duplicate claim|Cannot claim/);
    abortHybrid({state: result.statePath, "run-id": result.runId});
});

test("cross-layer primary retains the wider shared discovery budget", () => {
    const result = prepare(makeFixtureDir(), "cross-layer", "cross-layer");
    const claimed = claim(result);
    assert.match(claimed.taskPrompt, /at most 10 relevant files, 5 symbols, and 3 tests\/commands/);
    assert.doesNotMatch(claimed.taskPrompt, /at most 6 relevant files/);
    abortHybrid({state: result.statePath, "run-id": result.runId});
});

test("fallback task prompt retains deterministic semantic criteria gates", () => {
    const result = prepare(makeFixtureDir());
    const primary = claim(result);
    fs.writeFileSync(primary.reportPath, "not-json");
    evaluateAttempt({state: result.statePath, "run-id": result.runId, attempt: "primary", token: primary.dispatchToken});
    const fallback = claim(result, "fallback");
    assert.match(fallback.taskPrompt, /criteria\[\]\.required_evidence entry as a hard validator gate/);
    assert.match(fallback.taskPrompt, /forbid_negative_claims/);
    abortHybrid({state: result.statePath, "run-id": result.runId});
});

test("legacy run command fails closed instead of spawning an agent", () => {
    const result = spawnSync(process.execPath, [HELPER, "run"], {cwd: ROOT, encoding: "utf8"});
    assert.equal(result.status, 2);
    assert.match(result.stdout, /prepare/);
});

test("valid primary finalizes without fallback and records required metrics", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primary = claim(prepared);
    fs.writeFileSync(primary.reportPath, JSON.stringify(validReport()));
    const settled = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "123", ack: {session_ids: ["session-test"], task_tools: 1}});
    assert.equal(settled.evaluate.validation.valid, true);
    assert.equal(settled.evaluate.next.action, "FINALIZE");
    const final = settled.finalized;
    assert.equal(final.fast_first_pass, true);
    assert.equal(final.fallback_count, 0);
    assert.equal(final.hybrid_final, true);
    assert.equal(final.final.agent, "context-scout-fast");
    assert.equal(typeof final.primary.durationMs, "number");
    assert.match(final.primary.reportSha256, /^[a-f0-9]{64}$/);
    assert.equal(final.dispatch_audit.primary.ack.task_tools, 1);
});

test("batch settlement finalizes independent claimed runs", () => {
    const first = prepare(makeFixtureDir(), "batch-first");
    const second = prepare(makeFixtureDir(), "batch-second");
    const firstClaim = claim(first);
    const secondClaim = claim(second);
    fs.writeFileSync(firstClaim.reportPath, JSON.stringify(validReport()));
    fs.writeFileSync(secondClaim.reportPath, JSON.stringify(validReport()));

    const settled = settleBatch({}, JSON.stringify([
        {state: first.statePath, runId: first.runId, attempt: "primary", token: firstClaim.dispatchToken},
        {state: second.statePath, runId: second.runId, attempt: "primary", token: secondClaim.dispatchToken},
    ]));

    assert.equal(settled.count, 2);
    assert.equal(settled.results.every((item) => item.ok), true);
    assert.equal(settled.results.every((item) => item.result.finalized?.hybrid_final === true), true);
});

test("recovers a valid report from the primary ledger when render was interrupted", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir, "ledger-recovery");
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    const init = spawnSync(process.execPath, [
        path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs"),
        "init",
        state.primary.ledgerPath,
        "--head",
        state.manifestHead,
        "--criteria",
        prepared.files.criteria,
        "--mode",
        "targeted",
    ], {cwd: ROOT, encoding: "utf8"});
    assert.equal(init.status, 0, init.stderr);
    const batch = spawnSync(process.execPath, [
        path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs"),
        "batch",
        state.primary.ledgerPath,
    ], {cwd: ROOT, encoding: "utf8", input: `${JSON.stringify(validReport())}\n`});
    assert.equal(batch.status, 0, batch.stderr);

    const primary = claim(prepared);
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "123"});

    assert.equal(evaluated.validation.valid, true);
    assert.equal(fs.existsSync(primary.reportPath), true);
    assert.equal(evaluated.next.action, "FINALIZE");
    finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("invalid primary requests exactly one isolated fallback", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primaryClaim = claim(prepared);
    fs.writeFileSync(primaryClaim.reportPath, "not-json");
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primaryClaim.dispatchToken});
    assert.equal(primary.validation.valid, false);
    assert.equal(primary.next.action, "CLAIM_FALLBACK");
    assert.equal(primary.next.agent, "context-scout");
    assert.equal(fs.existsSync(primaryClaim.reportPath), false);
    const discardedPrimary = JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).primary.reportDiscardedPath;
    assert.equal(typeof discardedPrimary, "string");
    assert.equal(fs.existsSync(discardedPrimary), true);
    const stateAfterPrimary = fs.readFileSync(prepared.statePath, "utf8");
    assert.doesNotMatch(stateAfterPrimary, /not-json|validator_failed/);
    const fallbackClaim = claim(prepared, "fallback");
    assert.equal(fallbackClaim.agent, "context-scout");
    fs.writeFileSync(fallbackClaim.reportPath, JSON.stringify(validReport()));
    const fallback = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallbackClaim.dispatchToken});
    assert.equal(fallback.validation.valid, true);
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallbackClaim.dispatchToken}),
        /Cannot evaluate fallback/,
    );
    const final = finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(final.fast_first_pass, false);
    assert.equal(final.fallback_count, 1);
    assert.equal(final.hybrid_final, true);
    assert.equal(final.final.agent, "context-scout");
});

test("report mode must match the canonical handoff mode", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primaryClaim = claim(prepared);
    const report = {...validReport(), mode: "cross-layer"};
    fs.writeFileSync(primaryClaim.reportPath, JSON.stringify(report));
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primaryClaim.dispatchToken});
    assert.equal(primary.validation.valid, false);
    assert.equal(primary.validation.reason, "mode_mismatch");
    assert.equal(primary.next.action, "CLAIM_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("invalid fallback is final and cannot trigger another attempt", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primaryClaim = claim(prepared);
    fs.writeFileSync(primaryClaim.reportPath, "not-json");
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primaryClaim.dispatchToken});
    const fallbackClaim = claim(prepared, "fallback");
    fs.writeFileSync(fallbackClaim.reportPath, "still-not-json");
    const fallback = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallbackClaim.dispatchToken});
    assert.equal(fallback.next.action, "FINALIZE");
    const final = finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(final.fallback_count, 1);
    assert.equal(final.hybrid_final, false);
    assert.equal(final.final.status, "INCOMPLETE");
    assert.equal(fs.existsSync(primaryClaim.reportPath), false);
    assert.equal(fs.existsSync(JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).primary.reportDiscardedPath), true);
});

test("concurrent preparations use isolated run artifacts", () => {
    const first = prepare(makeFixtureDir(), "first");
    const second = prepare(makeFixtureDir(), "second");
    const firstClaim = claim(first);
    const secondClaim = claim(second);
    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.statePath, second.statePath);
    assert.notEqual(firstClaim.reportPath, secondClaim.reportPath);
    assert.equal(fs.existsSync(first.statePath), true);
    assert.equal(fs.existsSync(second.statePath), true);
    abortHybrid({state: first.statePath, "run-id": first.runId});
    abortHybrid({state: second.statePath, "run-id": second.runId});
});

test("concurrent claims serialize and only one caller obtains the token", async () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir, "claim-race");
    const moduleUrl = new URL("../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs", import.meta.url).href;
    const script = `import {claimAttempt} from ${JSON.stringify(moduleUrl)}; try { claimAttempt({state: process.env.STATE, "run-id": process.env.RUN_ID, attempt: "primary"}); } catch (error) { console.error(error.message); process.exitCode = 1; }`;
    const launch = () => new Promise((resolve) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
            cwd: ROOT,
            env: {...process.env, STATE: prepared.statePath, RUN_ID: prepared.runId},
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("close", (code) => resolve({code, stderr}));
    });
    const results = await Promise.all([launch(), launch()]);
    assert.deepEqual(results.map((result) => result.code).sort((a, b) => a - b), [0, 1]);
    assert.match(results.find((result) => result.code === 1).stderr, /Cannot claim|Duplicate claim/);
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("a finalized title can be reused without stale report artifacts", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "repeatable");
    const firstPrimary = claim(first);
    fs.writeFileSync(firstPrimary.reportPath, JSON.stringify(validReport()));
    evaluateAttempt({state: first.statePath, "run-id": first.runId, attempt: "primary", token: firstPrimary.dispatchToken});
    finalizeHybrid({state: first.statePath, "run-id": first.runId});

    const files = writeFixtures(dir);
    const second = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        title: "repeatable",
    }, ROOT);
    const secondClaim = claim(second);
    assert.notEqual(second.statePath, first.statePath);
    assert.notEqual(secondClaim.reportPath, firstPrimary.reportPath);
    assert.equal(fs.existsSync(secondClaim.reportPath), false);
    abortHybrid({state: second.statePath, "run-id": second.runId});
});

test("input mutation and wrong run-id fail closed", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primary = claim(prepared);
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": "wrong", attempt: "primary", token: primary.dispatchToken}),
        /run-id/,
    );
    fs.appendFileSync(prepared.files.prompt, "changed\n");
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken}),
        /input changed/,
    );
    fs.writeFileSync(prepared.files.prompt, "test prompt\n");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("abort after an interrupted primary is idempotent", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const first = abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(first.phase, "ABORTED");
    const second = abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(second.phase, "ABORTED");
});
