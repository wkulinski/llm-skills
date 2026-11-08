import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {spawnSync} from "../../helpers/bounded-spawn-sync.mjs";
import {test} from "vitest";
import {auditBenchmarkAgents, installBenchmarkAgents} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-fast.mjs";
import {claimAttempt, prepareHybrid, settleAttempt, abortHybrid} from "../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs";
import {enrichContextManifest} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";
import {FAILURE_CLASSES} from "../../../.agents/skills/_shared/scripts/context-scout-report.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const AGENTS_DIR = path.join(ROOT, ".opencode/agents");

function debugAgent(name) {
    const result = spawnSync("opencode", ["debug", "agent", name], {cwd: ROOT, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

function agentNames() {
    return fs.readdirSync(AGENTS_DIR)
        .filter((name) => name.endsWith(".md"))
        .map((name) => name.slice(0, -3))
        .sort();
}

function hasRule(agent, permission, pattern, action) {
    return agent.permission.some((rule) => rule.permission === permission && rule.pattern === pattern && rule.action === action);
}

// These checks exercise the resolved ordered rules, not just rule presence.
function matches(value, pattern) {
    return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value);
}

function actionFor(agent, permission, resource = "*") {
    return agent.permission.findLast((rule) => matches(permission, rule.permission) && matches(resource, rule.pattern))?.action;
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
        stack_profile: "generic",
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

test("OpenCode resolves fast scout to read-only CMM and shell-free scout file writes", () => {
    const agent = debugAgent("context-scout-fast");
    assert.match(agent.description, /CMM-first/);
    assert.equal(hasRule(agent, "codebase-memory*", "*", "allow"), true);
    for (const permission of ["github_*", "context7_*", "mate_*", "serena*"]) {
        assert.equal(hasRule(agent, permission, "*", "deny"), true);
    }
    assert.equal(hasRule(agent, "bash", "*", "deny"), true);
    assert.equal(actionFor(agent, "bash", "node /installation/_shared/scripts/context-scout-report-builder.mjs init x"), "deny");
    assert.equal(actionFor(agent, "codebase-memory_search_graph"), "allow");
    for (const tool of ["index_repository", "delete_project", "manage_adr", "ingest_traces"]) {
        assert.equal(actionFor(agent, `codebase-memory_${tool}`), "deny");
    }
    assert.equal(agent.tools.write === true || agent.tools.apply_patch === true, true);
    assert.equal(agent.tools.bash, false);
    assert.equal(actionFor(agent, "edit", "/external/project-b/cache/arbitrary/run-primary.scout.json"), "allow");
    assert.equal(actionFor(agent, "edit", "/external/project-b/source.mjs"), "deny");
    assert.equal(actionFor(agent, "edit", "/external/project-b/run-fallback.scout.json"), "deny");
    assert.equal(actionFor(agent, "external_directory", "/external/installation-a/*"), "allow");
    assert.equal(actionFor(agent, "read", "/external/installation-a/_shared/references/repository-context-scout-playbook.md"), "allow");
    assert.equal(hasRule(agent, "read", "**/*primary*.report.json", "deny"), true);
    assert.equal(hasRule(agent, "read", "**/*primary*.ledger.json", "deny"), true);
});

test("OpenCode refresher permits shared installation reads and an external consumer cwd", () => {
    const agent = debugAgent("context-refresher");
    assert.equal(actionFor(agent, "external_directory", "/outside/project-b/*"), "allow");
    assert.equal(actionFor(agent, "read", "/outside/installation-a/context-refresh/SKILL.md"), "allow");
    assert.equal(actionFor(agent, "bash", "node /outside/installation-a/_shared/scripts/context-manifest.mjs write --output /outside/project-b/cache/context-refresh/context-manifest.json"), "allow");
    assert.equal(actionFor(agent, "edit", "/outside/project-b/source.mjs"), "deny");
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
    assert.equal(actionFor(agent, "edit", "/outside/project-b/output/run-fallback.scout.json"), "allow");
    assert.equal(actionFor(agent, "edit", "/outside/project-b/output/run-primary.scout.json"), "deny");
    assert.equal(actionFor(agent, "read", "/outside/project-b/output/run-primary.scout.json"), "deny");
    assert.equal(actionFor(agent, "external_directory", "/outside/project-b/*"), "allow");
    assert.equal(actionFor(agent, "read", "/outside/installation-a/_shared/references/repository-context-scout-playbook.md"), "allow");
    assert.equal(agent.tools.write === true || agent.tools.apply_patch === true, true);
    assert.equal(agent.tools.bash, false);
});

// Spawns `opencode debug agent` once per project subagent, so its runtime scales
// with the agent count and exceeds the default 30s integration timeout.
test("OpenCode resolves model and thinking for every project subagent", {timeout: 120_000}, () => {
    for (const name of agentNames()) {
        const agent = debugAgent(name);
        assert.equal(typeof agent.model?.providerID, "string", `${name}: missing model provider`);
        assert.equal(typeof agent.model?.modelID, "string", `${name}: missing model id`);

        const thinking = agent.variant ?? agent.options?.thinking?.type;
        assert.equal(typeof thinking, "string", `${name}: missing thinking configuration`);
        assert.notEqual(thinking, "", `${name}: empty thinking configuration`);
    }
});

// Installs benchmark agent adapters and debug-audits them, spawning
// `opencode debug agent` repeatedly, so its runtime scales with the agent count
// and exceeds the default 30s integration timeout.
test("benchmark adapters are debug-audited before a cohort", {timeout: 120_000}, async () => {
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
    const primary = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
    fs.writeFileSync(primary.scoutPath, JSON.stringify(reportFor("INCOMPLETE")));
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
    fs.writeFileSync(fallback.scoutPath, JSON.stringify(reportFor("BLOCKED")));
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

test("controlled lifecycle classifies an empty scout file as invalid report content", () => {
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
    const primary = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
    fs.writeFileSync(primary.scoutPath, "");
    assert.equal(fs.existsSync(primary.reportPath), false);

    const settlement = settleAttempt({
        state: prepared.statePath,
        "run-id": prepared.runId,
        attempt: "primary",
        token: primary.dispatchToken,
        "duration-ms": "123",
    });
    assert.equal(settlement.evaluate.validation.failure_class, FAILURE_CLASSES.REPORT_INVALID);
    assert.equal(settlement.evaluate.next.action, "CLAIM_FALLBACK");
    assert.equal(abortHybrid({state: prepared.statePath, "run-id": prepared.runId}).phase, "ABORTED");
});
