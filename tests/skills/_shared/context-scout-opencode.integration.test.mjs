import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {test} from "vitest";
import {auditBenchmarkAgents, installBenchmarkAgents} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-fast.mjs";
import {claimAttempt, prepareHybrid, settleAttempt, abortHybrid} from "../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs";
import {enrichContextManifest} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";
import {FAILURE_CLASSES} from "../../../.agents/skills/_shared/scripts/context-scout-report.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const REPORT_BUILDER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs");

function debugAgent(name) {
    const result = spawnSync("opencode", ["debug", "agent", name], {cwd: ROOT, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

function hasRule(agent, permission, pattern, action) {
    return agent.permission.some((rule) => rule.permission === permission && rule.pattern === pattern && rule.action === action);
}

function writeLifecycleFixtures(dir) {
    const files = {
        prompt: path.join(dir, "prompt.txt"),
        manifest: path.join(dir, "manifest.json"),
        handoff: path.join(dir, "handoff.json"),
        criteria: path.join(dir, "criteria.json"),
    };
    fs.writeFileSync(files.prompt, "controlled integration prompt\n");
    const manifest = enrichContextManifest({
        version: 1,
        role: "primary",
        repository: "",
        branch: "",
        head: "",
        rules: ["AGENTS.md"],
        documentation: [],
        active_overrides: [],
        constraints: [],
        already_read: ["AGENTS.md"],
        omitted: [],
    });
    fs.writeFileSync(files.manifest, JSON.stringify(manifest));
    fs.writeFileSync(files.handoff, JSON.stringify({
        mode: "targeted",
        task_brief: "Exercise controlled report finalization.",
        decisions: [],
        constraints: [],
    }));
    fs.writeFileSync(files.criteria, JSON.stringify({criteria: [{id: "C1", description: "Exercise report finalization."}]}));
    return files;
}

function reportFor(status) {
    return {
        version: 1,
        status,
        mode: "targeted",
        findings: [],
        coverage: [{criterion_id: "C1", status: "blocked", reason: `controlled ${status.toLowerCase()} branch`}],
        read_coverage: {covered: [], follow_up: []},
        risks: [],
        omitted: [],
        next_step: "parent decides whether to retry",
    };
}

function initializeAndRender(ledgerPath, reportPath, state, criteriaPath, report) {
    const init = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "init",
        ledgerPath,
        "--head",
        state.manifestHead,
        "--criteria",
        criteriaPath,
        "--mode",
        "targeted",
    ], {cwd: ROOT, encoding: "utf8"});
    assert.equal(init.status, 0, init.stderr);
    const render = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "batch-render",
        ledgerPath,
        "--status",
        report.status,
        "--output",
        reportPath,
    ], {cwd: ROOT, encoding: "utf8", input: `${JSON.stringify(report)}\n`});
    assert.equal(render.status, 0, render.stderr);
}

test("OpenCode resolves fast scout to CMM-only MCP and restricted Bash", () => {
    const agent = debugAgent("context-scout-fast");
    assert.match(agent.description, /CMM-first/);
    assert.equal(hasRule(agent, "codebase-memory*", "*", "allow"), true);
    for (const permission of ["github_*", "context7_*", "mate_*", "serena*"]) {
        assert.equal(hasRule(agent, permission, "*", "deny"), true);
    }
    assert.equal(hasRule(agent, "bash", "*", "deny"), true);
    assert.equal(hasRule(agent, "bash", "node ./.agents/skills/_shared/scripts/context-scout-report-builder.mjs *", "allow"), true);
    assert.equal(hasRule(agent, "read", "**/*primary*.report.json", "deny"), true);
    assert.equal(hasRule(agent, "read", "**/*primary*.ledger.json", "deny"), true);
});

test("OpenCode resolves fallback without CMM and unrelated MCP tools", () => {
    const agent = debugAgent("context-scout");
    assert.match(agent.description, /bez CMM i danych primary/);
    for (const permission of ["codebase-memory*", "github_*", "context7_*", "mate_*", "serena*"]) {
        assert.equal(hasRule(agent, permission, "*", "deny"), true);
    }
    assert.equal(hasRule(agent, "bash", "*", "deny"), true);
    assert.equal(hasRule(agent, "read", "**/*primary*.report.json", "deny"), true);
    assert.equal(hasRule(agent, "read", "**/*primary*.ledger.json", "deny"), true);
});

test("benchmark adapters are debug-audited before a cohort", async () => {
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-adapter-audit-"));
    fs.copyFileSync(path.join(ROOT, "opencode.jsonc"), path.join(snapshotDir, "opencode.jsonc"));
    fs.mkdirSync(path.join(snapshotDir, "bin"), {recursive: true});
    fs.copyFileSync(path.join(ROOT, "bin/codebase-memory-mcp"), path.join(snapshotDir, "bin/codebase-memory-mcp"));
    await installBenchmarkAgents(snapshotDir);
    const audit = auditBenchmarkAgents("opencode", snapshotDir);
    assert.equal(audit["context-scout-benchmark-primary"].mode, "primary");
    assert.equal(audit["context-scout-benchmark-fallback"].mode, "primary");
    assert.equal(typeof audit["context-scout-benchmark-primary"].tools_invalid, "boolean");
    assert.equal(typeof audit["context-scout-benchmark-fallback"].tools_invalid, "boolean");
});

test("controlled lifecycle preserves INCOMPLETE and BLOCKED reports through one fallback", () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "var", "agent", "cache", "context-scout-controlled-lifecycle-"));
    const files = writeLifecycleFixtures(dir);
    const prepared = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        title: "controlled-statuses",
    }, ROOT);
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    const primary = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
    initializeAndRender(primary.ledgerPath, primary.reportPath, state, files.criteria, reportFor("INCOMPLETE"));
    const primarySettlement = settleAttempt({
        state: prepared.statePath,
        "run-id": prepared.runId,
        attempt: "primary",
        token: primary.dispatchToken,
        "duration-ms": "123",
    });
    assert.equal(primarySettlement.evaluate.validation.status, "INCOMPLETE");
    assert.equal(primarySettlement.evaluate.next.failure_class, FAILURE_CLASSES.AGENT_INCOMPLETE);
    assert.equal(primarySettlement.evaluate.next.action, "CLAIM_FALLBACK");
    assert.equal(primarySettlement.finalized, null);

    const fallback = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback"});
    initializeAndRender(fallback.ledgerPath, fallback.reportPath, state, files.criteria, reportFor("BLOCKED"));
    const fallbackSettlement = settleAttempt({
        state: prepared.statePath,
        "run-id": prepared.runId,
        attempt: "fallback",
        token: fallback.dispatchToken,
        "duration-ms": "123",
    });
    assert.equal(fallbackSettlement.evaluate.validation.status, "BLOCKED");
    assert.equal(fallbackSettlement.evaluate.next.failure_class, FAILURE_CLASSES.AGENT_INCOMPLETE);
    assert.equal(fallbackSettlement.evaluate.next.action, "FINALIZE");

    const final = fallbackSettlement.finalized;
    assert.equal(final.fallback_count, 1);
    assert.equal(final.fallback.status, "BLOCKED");
    assert.equal(final.final.status, "BLOCKED");
    assert.equal(final.hybrid_final, false);
});

test("controlled lifecycle classifies empty stdin as a missing report", () => {
    const dir = fs.mkdtempSync(path.join(ROOT, "var", "agent", "cache", "context-scout-controlled-empty-report-"));
    const files = writeLifecycleFixtures(dir);
    const prepared = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        title: "controlled-empty-report",
    }, ROOT);
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    const primary = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
    const init = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "init",
        primary.ledgerPath,
        "--head",
        state.manifestHead,
        "--criteria",
        files.criteria,
        "--mode",
        "targeted",
    ], {cwd: ROOT, encoding: "utf8"});
    assert.equal(init.status, 0, init.stderr);
    const empty = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "batch-render",
        primary.ledgerPath,
        "--status",
        "INCOMPLETE",
        "--output",
        primary.reportPath,
    ], {cwd: ROOT, encoding: "utf8", input: ""});
    assert.notEqual(empty.status, 0);
    assert.equal(fs.existsSync(primary.reportPath), false);

    const settlement = settleAttempt({
        state: prepared.statePath,
        "run-id": prepared.runId,
        attempt: "primary",
        token: primary.dispatchToken,
        "duration-ms": "123",
    });
    assert.equal(settlement.evaluate.validation.failure_class, FAILURE_CLASSES.REPORT_MISSING);
    assert.equal(settlement.evaluate.next.action, "CLAIM_FALLBACK");
    assert.equal(abortHybrid({state: prepared.statePath, "run-id": prepared.runId}).phase, "ABORTED");
});
