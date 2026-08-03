import {access, mkdir, readFile, rm, stat, utimes, writeFile} from "node:fs/promises";
import {mkdtempSync} from "node:fs";
import os from "node:os";
import path from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {analyzeCorpusCase, CORPUS_CASES} from "../../../.agents/skills/opencode-workflow-economics/corpus/cases.mjs";
import {DEFAULT_CONFIG} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/config.mjs";
import {analyzeRoots} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/analysis.mjs";
import {parseTree} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/parser.mjs";
import {listReportItems, readReportBrief} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-query.mjs";
import {writeLayeredReport, writeUnavailableReport} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-files.mjs";

const temporaryRoots = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {force: true, recursive: true})));
});

describe("OWE canonical report persistence", () => {
    it("writes an explicit COST_UNAVAILABLE report without pretending to have pricing", async () => {
        const analysisDir = temporaryDirectory();
        const report = await writeUnavailableReport({analysis_dir: analysisDir, reason: "session fetch timeout", requested_sessions: ["s1"]});
        const persisted = JSON.parse(await readFile(report.report_path, "utf8"));

        expect(report.status).toBe("COST_UNAVAILABLE");
        expect(persisted).toMatchObject({status: "COST_UNAVAILABLE", reason: "session fetch timeout", requested_sessions: ["s1"]});
        expect((await stat(report.report_path)).mode & 0o777).toBe(0o600);
    });

    it("publishes one complete report atomically and resolves projections from it", async () => {
        const analysisDir = temporaryDirectory();
        const bundle = fixtureBundle();

        const report = await writeLayeredReport(bundle, reportOptions(analysisDir));
        const roots = await listReportItems({analysis_dir: analysisDir, type: "roots", limit: 1});
        const persisted = JSON.parse(await readFile(report.report_path, "utf8"));

        expect(report.report_path).toBe(path.join(analysisDir, "report.json"));
        expect(persisted).toMatchObject({
            schema_version: 5,
            summary: {root_sessions: 1},
            methodology: {
                fingerprint_version: "operation_fingerprint_v2",
                effective_thresholds: {patterns: {min_occurrences: 2}},
            },
        });
        expect(roots).toContain("root");
        await expect(access(path.join(analysisDir, "brief.md"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(access(path.join(analysisDir, "index.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(access(path.join(analysisDir, "generations"))).rejects.toMatchObject({code: "ENOENT"});
        expect((await stat(report.report_path)).mode & 0o777).toBe(0o600);
    });

    it("does not reintroduce removed fields in the serialized report", async () => {
        const analysisDir = temporaryDirectory();
        const bundle = analyzeCorpusCase(CORPUS_CASES[1]);
        const report = await writeLayeredReport(bundle, reportOptions(analysisDir));
        const persisted = JSON.parse(await readFile(report.report_path, "utf8"));

        expect(persisted.schema_version).toBe(5);
        expect(persisted.aggregates).not.toHaveProperty("by_activity");
        expect(persisted.candidate_views).not.toHaveProperty("high_cost");

        for (const root of persisted.roots) {
            for (const step of root.steps) {
                expect(step).not.toHaveProperty("activity");
                expect(step).not.toHaveProperty("activity_classification.method");
            }
            for (const span of root.spans) {
                expect(span).not.toHaveProperty("activity");
                expect(span).not.toHaveProperty("classification_method");
                expect(span).not.toHaveProperty("read_only");
                expect(span).not.toHaveProperty("operation_fingerprint.diagnostics.profile.read_only");
            }
            for (const delegation of root.delegations) {
                if (delegation.parent_followup) { expect(delegation.parent_followup).not.toHaveProperty("activities"); }
            }
        }
    });

    it("cleans legacy artifacts and stale report temporaries after publication", async () => {
        const analysisDir = temporaryDirectory();
        const bundle = fixtureBundle();
        const legacy = ["CURRENT", "LOCK", "brief.md", "index.json", "full-bundle.json", "patterns", "overlaps", "roots"];

        await mkdir(path.join(analysisDir, "generations", "old"), {recursive: true});
        await mkdir(path.join(analysisDir, ".staging", "old"), {recursive: true});
        for (const name of legacy) {
            const target = path.join(analysisDir, name);
            if (name === "patterns" || name === "overlaps" || name === "roots") { await mkdir(target, {recursive: true}); }
            else { await writeFile(target, "legacy\n", "utf8"); }
        }
        const staleTemp = path.join(analysisDir, ".report.123.abc.tmp");
        await writeFile(staleTemp, "stale\n", "utf8");
        await utimes(staleTemp, new Date(Date.now() - 7_200_000), new Date(Date.now() - 7_200_000));

        await writeLayeredReport(bundle, reportOptions(analysisDir));

        for (const name of [...legacy, "generations", ".staging", ".report.123.abc.tmp"])
        { await expect(access(path.join(analysisDir, name))).rejects.toMatchObject({code: "ENOENT"}); }
    });

    it("serializes concurrent publications without corrupting report.json", async () => {
        const analysisDir = temporaryDirectory();
        const bundle = fixtureBundle();

        const reports = await Promise.all([
            writeLayeredReport(bundle, reportOptions(analysisDir)),
            writeLayeredReport(bundle, reportOptions(analysisDir)),
        ]);
        const persisted = JSON.parse(await readFile(path.join(analysisDir, "report.json"), "utf8"));

        expect(reports).toHaveLength(2);
        expect(persisted).toMatchObject({schema_version: 5, summary: {root_sessions: 1}});
        await expect(access(path.join(analysisDir, "LOCK"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(listReportItems({analysis_dir: analysisDir, type: "roots", limit: 1})).resolves.toContain("root");
    });

    it("keeps the previous report when serialization fails", async () => {
        const analysisDir = temporaryDirectory();
        const first = await writeLayeredReport(fixtureBundle(), reportOptions(analysisDir));
        const previous = await readFile(first.report_path, "utf8");
        const broken = fixtureBundle();
        broken.roots[0].circular = broken;

        await expect(writeLayeredReport(broken, reportOptions(analysisDir))).rejects.toThrow();
        expect(await readFile(first.report_path, "utf8")).toBe(previous);
    });

    it.each(["CURRENT", "generations", "index.json"])("detects legacy %s layout and asks for regeneration", async (legacyName) => {
        const analysisDir = temporaryDirectory();
        await mkdir(analysisDir, {recursive: true});
        if (legacyName === "generations") { await mkdir(path.join(analysisDir, legacyName), {recursive: true}); }
        else { await writeFile(path.join(analysisDir, legacyName), "old\n", "utf8"); }

        await expect(readReportBrief(analysisDir))
            .rejects.toThrow("Legacy OWE report layout detected. Run `owe prepare` to regenerate the report.");
    });
});

function temporaryDirectory() {
    const root = mkdtempSync(path.join(os.tmpdir(), "owe-report-test-"));
    temporaryRoots.push(root);
    return path.join(root, "analysis");
}

function reportOptions(analysisDir) {
    return {
        analysis_dir: analysisDir,
        brief: DEFAULT_CONFIG.reporting.brief,
    };
}

function fixtureBundle() {
    const config = structuredClone(DEFAULT_CONFIG);
    const pricing = {
        version: 1,
        currency: "USD",
        models: {
            "provider/model": {
                aliases: [],
                reasoning_accounting: "included_in_output",
                cache_read_accounting: "excluded",
                cache_write_accounting: "excluded",
                prices_per_million: {
                    input: "1",
                    output: "2",
                    cache_read: "0",
                    cache_write: "0",
                },
            },
        },
    };
    const tree = [{
        session: {
            id: "root",
            parent_id: null,
            title: "test",
            created_at_ms: 1,
            updated_at_ms: 2,
            agent_name: "main",
        },
        messages: [{
            info: {
                role: "assistant",
                id: "message",
                providerID: "provider",
                modelID: "model",
                time: {created: 1},
            },
            parts: [
                {type: "step-start", time: {start: 1}},
                {type: "step-finish", reason: "stop", tokens: {input: 1, output: 1, cache: {read: 0, write: 0}}},
            ],
        }],
    }];
    return analyzeRoots([parseTree(tree, "root", config, pricing, "compact")], config, pricing, {});
}
