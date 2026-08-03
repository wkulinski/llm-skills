import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const BUILDER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs");

describe("context scout report builder", () => {
    it("accepts artifacts in the system temporary directory", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
        const ledger = path.join(dir, "ledger.json");
        const criteria = path.join(dir, "criteria.json");
        fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow."}]}));
        const result = spawnSync(process.execPath, [BUILDER, "init", ledger, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        expect(fs.existsSync(ledger)).toBe(true);
    });

    it("stores enriched criteria in the ledger for every builder validation path", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
        const ledger = path.join(dir, "ledger.json");
        const criteria = path.join(dir, "criteria.json");
        fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow.", forbid_negative_claims: true, required_evidence: [{path: "AGENTS.md", relation: "defines", anchors: ["Repository Guidelines"]}]}]}));
        const result = spawnSync(process.execPath, [BUILDER, "init", ledger, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(fs.readFileSync(ledger, "utf8")).criteria_entries).toEqual([{id: "C1", description: "Map the flow.", forbid_negative_claims: true, required_evidence: [{path: "AGENTS.md", relation: "defines", anchors: ["Repository Guidelines"]}]}]);
    });

    it("refuses to overwrite source files", () => {
        const sourcePath = path.join(ROOT, "AGENTS.md");
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
        const criteria = path.join(dir, "criteria.json");
        fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow."}]}));
        const result = spawnSync(process.execPath, [BUILDER, "init", sourcePath, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/must be under var\/agent\/cache/);
    });

    it("records a bounded parent read-set and explicit follow-up paths", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
        const ledger = path.join(dir, "ledger.json");
        const criteria = path.join(dir, "criteria.json");
        fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow."}]}));
        const init = spawnSync(process.execPath, [BUILDER, "init", ledger, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(init.status, init.stderr).toBe(0);
        const covered = spawnSync(process.execPath, [
            BUILDER,
            "add-covered-path",
            ledger,
            "--path",
            "AGENTS.md",
            "--line-start",
            "1",
            "--line-end",
            "1",
            "--relation",
            "defines",
        ], {cwd: ROOT, encoding: "utf8"});
        expect(covered.status, covered.stderr).toBe(0);
        const followUp = spawnSync(process.execPath, [
            BUILDER,
            "add-follow-up",
            ledger,
            "--path",
            "README.md",
            "--reason",
            "parent needs implementation-level read",
        ], {cwd: ROOT, encoding: "utf8"});
        expect(followUp.status, followUp.stderr).toBe(0);
        const duplicate = spawnSync(process.execPath, [
            BUILDER,
            "add-follow-up",
            ledger,
            "--path",
            "AGENTS.md",
            "--reason",
            "already covered",
        ], {cwd: ROOT, encoding: "utf8"});
        expect(duplicate.status).toBe(1);
        expect(duplicate.stderr).toMatch(/already covered/);
        const value = JSON.parse(fs.readFileSync(ledger, "utf8"));
        expect(value.read_coverage.covered).toHaveLength(1);
        expect(value.read_coverage.follow_up).toEqual([{path: "README.md", reason: "parent needs implementation-level read"}]);
    });

    it("accepts a complete report in one batch and renders it from the ledger", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
        const ledger = path.join(dir, "ledger.json");
        const output = path.join(dir, "report.json");
        const criteria = path.join(dir, "criteria.json");
        fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow."}]}));
        const init = spawnSync(process.execPath, [BUILDER, "init", ledger, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(init.status, init.stderr).toBe(0);
        const report = {
            version: 1,
            status: "COMPLETE",
            mode: "targeted",
            findings: [{criterion_id: "C1", claim: "AGENTS defines rules", claim_type: "observed", confidence: "high", anchors: ["Repository Guidelines"], evidence: [{path: "AGENTS.md", line_start: 1, line_end: 1}]}],
            coverage: [{criterion_id: "C1", status: "covered", evidence: []}],
            read_coverage: {covered: [], follow_up: []},
            risks: [],
            omitted: [],
            next_step: "none",
        };
        const batch = spawnSync(process.execPath, [BUILDER, "batch", ledger], {cwd: ROOT, encoding: "utf8", input: `${JSON.stringify(report)}\n`});
        expect(batch.status, batch.stderr).toBe(0);
        const render = spawnSync(process.execPath, [BUILDER, "render", ledger, "--status", "COMPLETE", "--output", output], {cwd: ROOT, encoding: "utf8"});
        expect(render.status, render.stderr).toBe(0);
        expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({status: "COMPLETE", findings: [{claim_type: "observed"}]});
    });

    it("batch-renders a complete report in one builder invocation", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-builder-test-"));
        const ledger = path.join(dir, "ledger.json");
        const output = path.join(dir, "report.json");
        const criteria = path.join(dir, "criteria.json");
        fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "Map the flow."}]}));
        const init = spawnSync(process.execPath, [BUILDER, "init", ledger, "--head", "HEAD", "--criteria", criteria, "--mode", "targeted"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(init.status, init.stderr).toBe(0);
        const report = {
            version: 1,
            status: "COMPLETE",
            mode: "targeted",
            findings: [{criterion_id: "C1", claim: "AGENTS defines rules", claim_type: "observed", confidence: "high", anchors: ["Repository Guidelines"], evidence: [{path: "AGENTS.md", line_start: 1, line_end: 1}]}],
            coverage: [{criterion_id: "C1", status: "covered", evidence: []}],
            read_coverage: {covered: [], follow_up: []},
            risks: [],
            omitted: [],
            next_step: "none",
        };
        const result = spawnSync(process.execPath, [BUILDER, "batch-render", ledger, "--status", "COMPLETE", "--output", output], {
            cwd: ROOT,
            encoding: "utf8",
            input: `${JSON.stringify(report)}\n`,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(fs.readFileSync(output, "utf8"))).toMatchObject({status: "COMPLETE", findings: [{claim_type: "observed"}]});
        expect(JSON.parse(fs.readFileSync(ledger, "utf8")).batch_report).toMatchObject({status: "COMPLETE"});
    });
});
