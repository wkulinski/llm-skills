import {mkdtempSync} from "node:fs";
import {execFile} from "node:child_process";
import {createServer} from "node:http";
import {readFile, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";

import {afterEach, describe, expect, it} from "vitest";

import {analyzeCorpus, analyzeCorpusCase, CORPUS_CASES} from "../../../.agents/skills/opencode-workflow-economics/corpus/cases.mjs";
import {DEFAULT_CONFIG} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/config.mjs";
import {renderAnalysisBrief} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-brief.mjs";
import {buildReportIndex} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-index.mjs";
import {listReportItems, readReportBrief, showReportItem} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-query.mjs";
import {buildPatternDetail, writeLayeredReport} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-files.mjs";
import {runStage3, selectHintVariant} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-stage3.mjs";
import {runBaseline} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-baseline.mjs";

const temporaryRoots = [];
const execFileAsync = promisify(execFile);
const CLI = path.resolve(".agents/skills/opencode-workflow-economics/scripts/owe.mjs");

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {force: true, recursive: true})));
});

describe("OWE bounded baseline projections", () => {
    it("keeps the brief bounded and caps pattern and overlap rankings", async () => {
        const analysisDir = temporaryDirectory();
        await writeLayeredReport(analyzeCorpus(), {
            analysis_dir: analysisDir,
            brief: {...DEFAULT_CONFIG.reporting.brief, max_bytes: 99_999, max_patterns: 50, max_overlap_diagnostics: 50},
        });

        const brief = await readReportBrief(analysisDir);

        expect(Buffer.byteLength(brief, "utf8")).toBeLessThanOrEqual(14 * 1024);
        expect(brief.match(/^## Pattern /gm) ?? []).toHaveLength(5);
        expect(brief.match(/^## Overlap /gm) ?? []).toHaveLength(5);
        expect(brief).toContain("## Data quality");
        expect(brief).toContain("## Warnings and interpretation limits");
    });

    it("preserves quality guardrails when optional sections do not fit", async () => {
        const analysisDir = temporaryDirectory();
        await writeLayeredReport(analyzeCorpus(), {
            analysis_dir: analysisDir,
            brief: {...DEFAULT_CONFIG.reporting.brief, max_bytes: 1200},
        });

        const brief = await readReportBrief(analysisDir, {...DEFAULT_CONFIG.reporting.brief, max_bytes: 1200});

        expect(Buffer.byteLength(brief, "utf8")).toBeLessThanOrEqual(1200);
        expect(brief).toContain("## Data quality");
        expect(brief).toContain("## Warnings and interpretation limits");
        const index = buildReportIndex(JSON.parse(await readFile(path.join(analysisDir, "report.json"), "utf8")));
        expect(brief).toContain(`Omitted records: patterns ${index.patterns.length}; overlaps ${index.overlaps.length}; subagents ${index.subagents.length}.`);
    });

    it("measures one and two semantic hints without changing the root drill-down recommendation", async () => {
        const bundle = analyzeCorpus();
        const analysisDir = temporaryDirectory();
        const report = await writeLayeredReport(bundle, {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const index = buildReportIndex(JSON.parse(await readFile(report.report_path, "utf8")));
        const oneHint = renderAnalysisBrief(bundle, index, {...DEFAULT_CONFIG.reporting.brief, hints_per_example: 1});
        const twoHints = renderAnalysisBrief(bundle, index, {...DEFAULT_CONFIG.reporting.brief, hints_per_example: 2});

        expect(Buffer.byteLength(oneHint, "utf8")).toBeLessThanOrEqual(14 * 1024);
        expect(Buffer.byteLength(twoHints, "utf8")).toBeLessThanOrEqual(14 * 1024);
        expect(oneHint).not.toContain("\uFFFD");
        expect(twoHints).not.toContain("\uFFFD");
        expect(twoHints.length).toBeGreaterThan(oneHint.length);
        expect(twoHints.match(/show root <session-id>/g) ?? []).toHaveLength(1);
    });

    it("bounds text root drill-downs and reports omitted records", async () => {
        const bundle = analyzeCorpus();
        const analysisDir = temporaryDirectory();
        const report = await writeLayeredReport(bundle, {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const index = buildReportIndex(JSON.parse(await readFile(report.report_path, "utf8")));
        const root = bundle.roots.find((item) => item.spans.length > 1) ?? bundle.roots[0];
        const output = await showReportItem({
            analysis_dir: analysisDir,
            type: "root",
            id: root.root_session_id,
            max_bytes: 257,
            max_spans: 1,
        });

        expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(257);
        expect(output).toContain("Omitted records:");
        expect(output).not.toContain("\uFFFD");
        expect(index.roots.map((item) => item.root_session_id)).toContain(root.root_session_id);
    });

    it("passes root limits through the CLI while JSON remains an unbounded audit view", async () => {
        const bundle = analyzeCorpus();
        const analysisDir = temporaryDirectory();
        await writeLayeredReport(bundle, {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const root = bundle.roots.find((item) => item.spans.length > 1) ?? bundle.roots[0];
        const bounded = await runCli(["show", "root", root.root_session_id, "--analysis-dir", analysisDir, "--max-bytes", "700", "--max-spans", "1"]);
        const audit = await runCli(["show", "root", root.root_session_id, "--analysis-dir", analysisDir, "--json", "--max-bytes", "100", "--max-spans", "1"]);

        expect(Buffer.byteLength(bounded, "utf8")).toBeLessThanOrEqual(700);
        expect(bounded).toContain("Omitted records:");
        expect(JSON.parse(audit).root.spans.length).toBe(root.spans.length);
    });

    it("keeps benchmark command counts and hint comparison within Stage 3 guardrails", async () => {
        const analysisDir = temporaryDirectory();
        const baselinePath = path.join(path.dirname(analysisDir), "baseline.json");
        await writeFile(baselinePath, `${JSON.stringify(await runBaseline(1), null, 2)}\n`, "utf8");
        const result = await runStage3(baselinePath, 1);

        for (const comparison of Object.values(result.baseline_comparison)) {
            expect(comparison.p50_delta).toBeLessThanOrEqual(0);
            expect(comparison.p95_delta).toBeLessThanOrEqual(1);
        }
        expect(result.scenarios.cost_baseline.additional_read_commands).toBe(0);
        expect(result.scenarios.deep_audit.show_root_count).toBe(1);
        expect(result.hint_comparison.map((item) => item.hints_per_example)).toEqual([1, 2]);
        expect(result.hint_comparison[1].brief_bytes).toBeGreaterThan(result.hint_comparison[0].brief_bytes);
        expect(result.hint_comparison.every((item) => item.root_drill_down_rate >= 0 && item.root_drill_down_rate <= 1)).toBe(true);
        expect(result.hint_selection).toMatchObject({
            recommended_hints_per_example: 1,
            rationale: expect.stringContaining("root drill-down rate"),
        });
    }, 15_000);

    it("warns that a single-root pattern is not a stable delegation class", () => {
        const bundle = analyzeCorpus();
        const detail = buildPatternDetail(bundle, {
            ...bundle.pattern_groups[0],
            distinct_root_sessions: 1,
        });

        expect(detail.interpretation_warning).toContain("one root session");
        expect(detail.interpretation_warning).toContain("stable delegation class");
    });

    it("selects the hint variant with the lower root drill-down rate", () => {
        expect(selectHintVariant([
            {hints_per_example: 1, root_drill_down_rate: 0.5, brief_tokens_auxiliary: 100},
            {hints_per_example: 2, root_drill_down_rate: 0.25, brief_tokens_auxiliary: 200},
        ])).toMatchObject({
            recommended_hints_per_example: 2,
            root_drill_down_rate: 0.25,
        });
    });

    it("shows the single-root limitation in the brief", () => {
        const bundle = analyzeCorpus();
        const targetPatternId = bundle.pattern_groups.find((pattern) => pattern.scope === "main_agent"
            && !["delegation", "final_response"].includes(pattern.signature.primary_activity)).pattern_id;
        const singleRootBundle = {
            ...bundle,
            pattern_groups: bundle.pattern_groups.map((pattern) => pattern.pattern_id === targetPatternId
                ? {...pattern, distinct_root_sessions: 1}
                : pattern),
        };
        const index = buildReportIndex(singleRootBundle);
        const brief = renderAnalysisBrief(singleRootBundle, index, DEFAULT_CONFIG.reporting.brief);

        expect(brief).toContain("observed in one root session");
    });

    it("exposes brief, model, activity and subagent projections without reading the bundle", async () => {
        const analysisDir = temporaryDirectory();
        await writeLayeredReport(analyzeCorpusCase(CORPUS_CASES[1]), {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });

        const brief = await readReportBrief(analysisDir);
        const models = await listReportItems({analysis_dir: analysisDir, type: "models", limit: 3});
        const activities = await listReportItems({analysis_dir: analysisDir, type: "activities", limit: 3});
        const subagents = await listReportItems({analysis_dir: analysisDir, type: "subagents", limit: 3});

        expect(brief).toContain("Total usage:");
        expect(brief).toContain("Delegation economics");
        expect(brief).toContain("Omitted records:");
        expect(models).toContain("# OWE models");
        expect(models).toContain("usage input");
        expect(activities).toContain("# OWE activities");
        expect(subagents).toContain("child direct");
        expect(subagents).toContain("parent follow-up");
    });

    it("renders conservative pre-write overlap evidence with pricing and follow-up economics", async () => {
        const analysisDir = temporaryDirectory();
        await writeLayeredReport(analyzeCorpusCase(CORPUS_CASES[1]), {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });

        const output = await showReportItem({
            analysis_dir: analysisDir,
            type: "overlap",
            id: "overlap-post-write-not-strong:tool:0",
        });

        expect(output).toContain("Diagnostic: **mixed_followup**");
        expect(output).toContain("Pre-write semantic matches: paths 0; queries 0; symbols 0; commands 1");
        expect(output).toContain("mixed_followup only; never strengthens strong");
        expect(output).toContain("Shared operation types (descriptive only):");
        expect(output).toContain("Operation Jaccard (descriptive only):");
        expect(output).toContain("Delegating step:");
        expect(output).toContain("Child direct:");
        expect(output).toContain("Ordered parent follow-up:");
        expect(output).toContain("Fallback additional cost:");
        expect(output).toContain("complete");
    });

    it("keeps list output within its byte budget and reports omitted records", async () => {
        const analysisDir = temporaryDirectory();
        await writeLayeredReport(analyzeCorpusCase(CORPUS_CASES[0]), {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });

        const output = await listReportItems({analysis_dir: analysisDir, type: "models", limit: 10, max_bytes: 80});

        expect(Buffer.byteLength(output, "utf8")).toBeLessThanOrEqual(80);
        expect(output).toContain("Omitted records:");
    });

    it("keeps the base report unchanged while inspect publishes an isolated report", async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "owe-inspect-test-"));
        temporaryRoots.push(root);
        const analysisDir = path.join(root, "analysis");
        const baseReport = await writeLayeredReport(analyzeCorpusCase(CORPUS_CASES[0]), {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const original = await readFile(baseReport.report_path, "utf8");
        const server = await startInspectServer();
        const configPath = path.join(root, "config.json");
        const pricingPath = path.join(root, "pricing.json");
        await writeFile(configPath, JSON.stringify({
            opencode: {base_url: server.url, directory: "/tmp/owe-inspect-project"},
            collection: {content_mode: "metadata", concurrency: 1},
        }), "utf8");
        await writeFile(pricingPath, JSON.stringify({version: 1, currency: "USD", models: {}}), "utf8");

        try {
            await runCli(["inspect", "inspect-session", "--directory", root, "--config", configPath, "--pricing", pricingPath, "--server", "existing"], {
                env: {...process.env, OWC_PATH: analysisDir},
            });
        } finally {
            await server.close();
        }

        expect(await readFile(baseReport.report_path, "utf8")).toBe(original);
        const isolated = JSON.parse(await readFile(path.join(analysisDir, "inspect-inspect-session", "report.json"), "utf8"));
        expect(isolated.source.requested_sessions).toEqual(["inspect-session"]);
        expect(isolated.summary.root_sessions).toBe(1);
    });

    it("renders complete and partial pricing with status and coverage", async () => {
        const analysisDir = temporaryDirectory();
        const report = await writeLayeredReport(analyzeCorpusCase(CORPUS_CASES[2]), {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const brief = await readReportBrief(analysisDir);
        const index = buildReportIndex(JSON.parse(await readFile(report.report_path, "utf8")));
        const root = await showReportItem({analysis_dir: analysisDir, type: "root", id: index.roots[0].root_session_id});

        expect(brief).toContain("incomplete");
        expect(brief).toContain("missing_pricing");
        expect(root).toContain("complete");
        expect(root).toContain("steps)");
    });
});

function temporaryDirectory() {
    const root = mkdtempSync(path.join(os.tmpdir(), "owe-projection-test-"));
    temporaryRoots.push(root);
    return path.join(root, "analysis");
}

async function runCli(args, options = {}) {
    const result = await execFileAsync(process.execPath, [CLI, ...args], {encoding: "utf8", ...options});
    return result.stdout;
}

async function startInspectServer() {
    const session = {id: "inspect-session", parentID: null, time: {created: 1, updated: 2}};
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        let payload;
        if (pathname.endsWith("/children")) { payload = {children: []}; }
        else if (pathname.endsWith("/message")) { payload = {messages: []}; }
        else if (pathname.includes("/session/inspect-session")) { payload = session; }
        else if (pathname.startsWith("/session")) { payload = {sessions: [session]}; }
        else {
            response.writeHead(404);
            response.end();
            return;
        }
        response.writeHead(200, {"content-type": "application/json"});
        response.end(JSON.stringify(payload));
    });
    await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolvePromise);
    });
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise())),
    };
}
