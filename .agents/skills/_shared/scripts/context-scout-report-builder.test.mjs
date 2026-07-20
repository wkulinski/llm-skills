import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../");
const BUILDER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs");

test("report builder accepts artifacts in the system temporary directory", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
    const ledger = path.join(dir, "ledger.json");
    const criteria = path.join(dir, "criteria.json");
    fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow."}]}));
    const result = spawnSync(process.execPath, [BUILDER, "init", ledger, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
        cwd: ROOT,
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(ledger), true);
});

test("report builder refuses to overwrite source files", () => {
    const sourcePath = path.join(ROOT, "AGENTS.md");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
    const criteria = path.join(dir, "criteria.json");
    fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow."}]}));
    const result = spawnSync(process.execPath, [BUILDER, "init", sourcePath, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
        cwd: ROOT,
        encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be under var\/agent\/cache/);
});
