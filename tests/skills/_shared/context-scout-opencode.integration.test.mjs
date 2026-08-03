import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {test} from "vitest";
import {auditBenchmarkAgents, installBenchmarkAgents} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-fast.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");

function debugAgent(name) {
    const result = spawnSync("opencode", ["debug", "agent", name], {cwd: ROOT, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

function hasRule(agent, permission, pattern, action) {
    return agent.permission.some((rule) => rule.permission === permission && rule.pattern === pattern && rule.action === action);
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
