import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {abortHybrid, evaluateAttempt, finalizeHybrid, prepareHybrid} from "./context-scout-hybrid-run.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../");
const HELPER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs");

function makeFixtureDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-hybrid-test-"));
}

function writeFixtures(dir) {
    const prompt = path.join(dir, "prompt.txt");
    const manifest = path.join(dir, "manifest.json");
    const handoff = path.join(dir, "handoff.json");
    const criteria = path.join(dir, "criteria.json");
    fs.writeFileSync(prompt, "test prompt\n");
    const sourceManifest = JSON.parse(fs.readFileSync(path.join(ROOT, "var/agent/cache/context-refresh/context-manifest.json"), "utf8"));
    fs.writeFileSync(manifest, JSON.stringify(sourceManifest));
    fs.writeFileSync(handoff, JSON.stringify({
        mode: "targeted",
        task_brief: "Map a test flow.",
        decisions: [],
        constraints: [],
    }));
    fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "test"}]}));
    return {prompt, manifest, handoff, criteria};
}

function validReport() {
    const evidence = {path: "AGENTS.md", line_start: 1, line_end: 1, relation: "defines"};
    return {
        version: 1,
        status: "COMPLETE",
        mode: "targeted",
        findings: [{criterion_id: "C1", claim: "test claim", evidence: [evidence]}],
        coverage: [{criterion_id: "C1", status: "covered", evidence: [evidence]}],
        risks: [],
        omitted: [],
        next_step: "none",
    };
}

function prepare(dir, title = "test-run") {
    const files = writeFixtures(dir);
    const result = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        "lock-file": path.join(dir, "hybrid.lock"),
        title,
    }, ROOT);
    return {...result, files};
}

test("prepare returns native task instructions and never starts OpenCode", () => {
    const dir = makeFixtureDir();
    const result = prepare(dir);
    assert.equal(result.protocolVersion, 2);
    assert.equal(result.next.action, "DELEGATE_PRIMARY");
    assert.equal(result.next.agent, "context-scout-fast");
    assert.match(result.next.taskPrompt, /Do not delegate/);
    assert.doesNotMatch(result.next.taskPrompt, /opencode run/);
    assert.equal(fs.existsSync(path.join(dir, "hybrid.lock")), true);
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
    fs.writeFileSync(prepared.next.reportPath, JSON.stringify(validReport()));
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", "duration-ms": "123"});
    assert.equal(evaluated.validation.valid, true);
    assert.equal(evaluated.next.action, "FINALIZE");
    const final = finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(final.fast_first_pass, true);
    assert.equal(final.fallback_count, 0);
    assert.equal(final.hybrid_final, true);
    assert.equal(final.final.agent, "context-scout-fast");
    assert.equal(typeof final.primary.durationMs, "number");
    assert.equal(fs.existsSync(path.join(dir, "hybrid.lock")), false);
});

test("invalid primary requests exactly one isolated fallback", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    fs.writeFileSync(prepared.next.reportPath, "not-json");
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
    assert.equal(primary.validation.valid, false);
    assert.equal(primary.next.action, "DELEGATE_FALLBACK");
    assert.equal(primary.next.agent, "context-scout");
    assert.doesNotMatch(primary.next.taskPrompt, /validator_failed|not-json|primary/i);
    assert.equal(fs.existsSync(prepared.next.reportPath), false);
    const stateAfterPrimary = fs.readFileSync(prepared.statePath, "utf8");
    assert.doesNotMatch(stateAfterPrimary, /not-json|validator_failed/);
    fs.writeFileSync(primary.next.reportPath, JSON.stringify(validReport()));
    const fallback = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback"});
    assert.equal(fallback.validation.valid, true);
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback"}),
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
    const report = {...validReport(), mode: "cross-layer"};
    fs.writeFileSync(prepared.next.reportPath, JSON.stringify(report));
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
    assert.equal(primary.validation.valid, false);
    assert.equal(primary.validation.reason, "mode_mismatch");
    assert.equal(primary.next.action, "DELEGATE_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("invalid fallback is final and cannot trigger another attempt", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    fs.writeFileSync(prepared.next.reportPath, "not-json");
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
    fs.writeFileSync(primary.next.reportPath, "still-not-json");
    const fallback = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback"});
    assert.equal(fallback.next.action, "FINALIZE");
    const final = finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(final.fallback_count, 1);
    assert.equal(final.hybrid_final, false);
    assert.equal(final.final.status, "INCOMPLETE");
    assert.equal(fs.existsSync(primary.next.reportPath), false);
});

test("single-flight lock rejects concurrent preparation", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "first");
    const secondDir = path.join(dir, "second");
    fs.mkdirSync(secondDir);
    const files = writeFixtures(secondDir);
    assert.throws(() => prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": secondDir,
        "lock-file": path.join(dir, "hybrid.lock"),
        title: "second",
    }, ROOT), /already active/);
    abortHybrid({state: first.statePath, "run-id": first.runId});
});

test("a finalized title can be reused without stale report artifacts", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "repeatable");
    fs.writeFileSync(first.next.reportPath, JSON.stringify(validReport()));
    evaluateAttempt({state: first.statePath, "run-id": first.runId, attempt: "primary"});
    finalizeHybrid({state: first.statePath, "run-id": first.runId});

    const files = writeFixtures(dir);
    const second = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        "lock-file": path.join(dir, "hybrid.lock"),
        title: "repeatable",
    }, ROOT);
    assert.notEqual(second.statePath, first.statePath);
    assert.notEqual(second.next.reportPath, first.next.reportPath);
    assert.equal(fs.existsSync(second.next.reportPath), false);
    abortHybrid({state: second.statePath, "run-id": second.runId});
});

test("input mutation and wrong run-id fail closed", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": "wrong", attempt: "primary"}),
        /run-id/,
    );
    fs.appendFileSync(prepared.files.prompt, "changed\n");
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"}),
        /input changed/,
    );
    fs.writeFileSync(prepared.files.prompt, "test prompt\n");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("abort releases the lock after an interrupted primary and is idempotent", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const first = abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(first.phase, "ABORTED");
    assert.equal(fs.existsSync(path.join(dir, "hybrid.lock")), false);
    const second = abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(second.phase, "ABORTED");
});
