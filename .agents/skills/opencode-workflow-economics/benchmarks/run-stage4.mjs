#!/usr/bin/env node
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {performance} from "node:perf_hooks";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {CORPUS_CASES, PRICING} from "../corpus/cases.mjs";
import {DEFAULT_CONFIG} from "../scripts/lib/config.mjs";
import {buildReportIndex} from "../scripts/lib/report-index.mjs";
import {analyzeRoots} from "../scripts/lib/analysis.mjs";
import {parseTree} from "../scripts/lib/parser.mjs";
import {buildOverlapDetail, buildPatternDetail, buildRootDetail, serializeReport, writeLayeredReport} from "../scripts/lib/report-files.mjs";
import {renderAnalysisBrief} from "../scripts/lib/report-brief.mjs";
import {benchmarkOutputPath, writeBenchmarkOutput} from "./output-path.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SAMPLES = 5;

export const STAGE4_CORPUS_SIZES = {
    small: 8,
    medium: 40,
    large: 100,
};

export const STAGE4_THRESHOLDS = {
    list_patterns_p95_ms: 500,
    show_pattern_p95_ms: 500,
    standard_sequence_p95_ms: 3000,
    peak_rss_bytes: 512 * 1024 * 1024,
};

async function main() {
    if (process.argv[2] === "--worker") {
        process.stdout.write(`${JSON.stringify(await runWorker(Number.parseInt(process.argv[3], 10)))}\n`);
        return;
    }

    const outputPath = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : benchmarkOutputPath("stage4-decision.json");
    const samples = numberFlag("--samples", SAMPLES);
    const result = await runStage4(samples);
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    await writeBenchmarkOutput(outputPath, result);
    process.stdout.write(serialized);
}

export async function runStage4(samplesPerCorpus = SAMPLES, corpusSizes = STAGE4_CORPUS_SIZES) {
    const corpusResults = {};
    for (const [name, rootCount] of Object.entries(corpusSizes))
    { corpusResults[name] = await measureCorpus(name, rootCount, samplesPerCorpus); }

    const checks = Object.fromEntries(Object.entries(corpusResults).map(([name, result]) => [name, evaluateCorpus(result)]));
    const passed = Object.values(checks).every((check) => check.passed);
    return {
        benchmark_version: "owe-stage-4-index-gate-v1",
        methodology: {
            indexed_artifact_is_not_read: true,
            projection_source: "report.json",
            samples_per_corpus: samplesPerCorpus,
            corpus_sizes: corpusSizes,
            note: "The benchmark measures rebuilding projections from report.json without a persisted index.",
        },
        thresholds: STAGE4_THRESHOLDS,
        corpora: corpusResults,
        checks,
        decision: {
            passed,
            recommended_action: passed ? "remove_index_in_stage_5" : "retain_minimal_index_in_stage_5",
            rationale: passed
                ? "All no-index latency and memory thresholds passed for small, medium, and large corpora."
                : "At least one no-index latency or memory threshold failed; retain a minimal projection cache in Stage 5.",
            stage5_started: false,
        },
    };
}

async function measureCorpus(name, rootCount, samplesPerCorpus) {
    const samples = [];
    for (let sample = 0; sample < samplesPerCorpus; sample += 1) {
        const child = await execFileAsync(process.execPath, [SCRIPT_PATH, "--worker", String(rootCount)], {encoding: "utf8"});
        samples.push(JSON.parse(child.stdout));
    }

    const scenarios = {};
    for (const scenario of ["list_patterns", "show_pattern", "standard_sequence"]) {
        const measurements = samples.map((sample) => sample.scenarios[scenario]);
        scenarios[scenario] = {
            operation_count: measurements[0].operation_count,
            samples: measurements,
            p50_duration_ms: percentile(measurements.map((item) => item.duration_ms), 0.5),
            p95_duration_ms: percentile(measurements.map((item) => item.duration_ms), 0.95),
            peak_rss_bytes: Math.max(...measurements.map((item) => item.peak_rss_bytes)),
            stdout_bytes_p50: percentile(measurements.map((item) => item.stdout_bytes), 0.5),
        };
    }

    return {
        name,
        root_sessions: rootCount,
        report_sizes: samples[0].report_sizes,
        scenarios,
    };
}

async function runWorker(rootCount) {
    if (!Number.isSafeInteger(rootCount) || rootCount < 1) { throw new Error(`Invalid worker root count: ${rootCount}`); }
    const analysisDir = await mkdtemp(resolve(tmpdir(), "owe-stage4-"));
    try {
        const bundle = createScaledBundle(rootCount);
        const report = await writeLayeredReport(bundle, {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const projection = await rebuildProjection(analysisDir);
        const patternIds = projection.index.patterns.slice(0, 3).map((item) => item.pattern_id);
        const patternId = patternIds[0];
        if (!patternId) { throw new Error(`No pattern available for ${rootCount} root sessions`); }
        const overlapId = projection.index.overlaps[0]?.delegation_id ?? null;
        const rootId = projection.index.roots[0]?.root_session_id;
        const commands = {
            list_patterns: [{type: "list_patterns"}],
            show_pattern: [{type: "show_pattern", id: patternId}],
            standard_sequence: [
                {type: "brief"},
                {type: "list_models"},
                {type: "list_activities"},
                {type: "list_patterns"},
                ...patternIds.map((id) => ({type: "show_pattern", id})),
                {type: "list_subagents"},
                ...(overlapId ? [{type: "show_overlap", id: overlapId}] : []),
                ...(rootId ? [{type: "show_root", id: rootId}] : []),
            ],
        };
        const scenarios = {};
        for (const [name, plan] of Object.entries(commands)) { scenarios[name] = await measureNoIndexPlan(analysisDir, plan); }
        return {root_sessions: rootCount, report_sizes: report.report_sizes, scenarios};
    } finally {
        await rm(analysisDir, {recursive: true, force: true});
    }
}

async function measureNoIndexPlan(analysisDir, plan) {
    let stdoutBytes = 0;
    const started = performance.now();
    for (const command of plan) { stdoutBytes += Buffer.byteLength(await runNoIndexCommand(analysisDir, command), "utf8"); }
    const usage = process.resourceUsage();
    return {
        operation_count: plan.length,
        duration_ms: performance.now() - started,
        peak_rss_bytes: normalizeMaxRss(usage.maxRSS),
        stdout_bytes: stdoutBytes,
    };
}

async function runNoIndexCommand(analysisDir, command) {
    const {bundle, index} = await rebuildProjection(analysisDir);
    if (command.type === "brief") { return renderAnalysisBrief(bundle, index); }
    if (command.type === "list_patterns") { return JSON.stringify(index.patterns.slice(0, 10)); }
    if (command.type === "list_models") { return JSON.stringify(index.cost_baseline?.by_model?.slice(0, 10) ?? []); }
    if (command.type === "list_activities") { return JSON.stringify(index.cost_baseline?.by_primary_activity?.slice(0, 10) ?? []); }
    if (command.type === "list_subagents") { return JSON.stringify(index.subagents.slice(0, 10)); }
    if (command.type === "show_pattern") { return serializeReport(buildPatternDetail(bundle, bundle.pattern_groups.find((item) => item.pattern_id === command.id))); }
    if (command.type === "show_overlap") { return serializeReport(buildOverlapDetail(bundle, bundle.delegation_overlap_diagnostics.find((item) => item.delegation_id === command.id))); }
    if (command.type === "show_root") { return serializeReport(buildRootDetail(bundle, bundle.roots.find((item) => item.root_session_id === command.id))); }
    throw new Error(`Unknown Stage 4 benchmark command: ${command.type}`);
}

async function rebuildProjection(analysisDir) {
    const bundle = JSON.parse(await readFile(resolve(analysisDir, "report.json"), "utf8"));
    return {bundle, index: buildReportIndex(bundle)};
}

function createScaledBundle(rootCount) {
    const sourceRoots = CORPUS_CASES.flatMap((caseDefinition) => caseDefinition.roots.map((entry) => ({
        ...entry,
        pricing: caseDefinition.pricing ?? PRICING,
    })));
    const roots = [];
    for (let index = 0; index < rootCount; index += 1) {
        const sourceRoot = sourceRoots[index % sourceRoots.length];
        const renamed = renameRawRoot(sourceRoot, index);
        roots.push(parseTree(renamed.tree, renamed.root_session_id, DEFAULT_CONFIG, renamed.pricing, "compact"));
    }
    return analyzeRoots(roots, DEFAULT_CONFIG, PRICING, {
        corpus_version: "owe-stage-4-synthetic-corpus-v1",
        corpus_cases: ["patterns", "overlap", "pricing"],
        benchmark_root_count: rootCount,
    });
}

function renameRawRoot(root, replica) {
    const identifiers = new Map();
    for (const session of root.tree ?? []) { identifiers.set(session.session.id, `${session.session.id}--${replica}`); }
    identifiers.set(root.root_session_id, `${root.root_session_id}--${replica}`);
    return {
        ...root,
        root_session_id: identifiers.get(root.root_session_id),
        tree: rewriteIdentifiers(structuredClone(root.tree), identifiers),
    };
}

function rewriteIdentifiers(value, identifiers) {
    if (typeof value === "string") {
        for (const [source, target] of [...identifiers.entries()].sort(([left], [right]) => right.length - left.length)) {
            if (value === source) { return target; }
            if (value.startsWith(`${source}-`)) { return `${target}${value.slice(source.length)}`; }
        }
        return value;
    }
    if (Array.isArray(value)) { return value.map((item) => rewriteIdentifiers(item, identifiers)); }
    if (!value || typeof value !== "object") { return value; }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewriteIdentifiers(item, identifiers)]));
}

function evaluateCorpus(result) {
    const listPatterns = result.scenarios.list_patterns.p95_duration_ms;
    const showPattern = result.scenarios.show_pattern.p95_duration_ms;
    const standardSequence = result.scenarios.standard_sequence.p95_duration_ms;
    const peakRss = Math.max(...Object.values(result.scenarios).map((scenario) => scenario.peak_rss_bytes));
    const checks = {
        list_patterns_p95_ms: check(listPatterns, STAGE4_THRESHOLDS.list_patterns_p95_ms, "<"),
        show_pattern_p95_ms: check(showPattern, STAGE4_THRESHOLDS.show_pattern_p95_ms, "<"),
        standard_sequence_p95_ms: check(standardSequence, STAGE4_THRESHOLDS.standard_sequence_p95_ms, "<"),
        peak_rss_bytes: check(peakRss, STAGE4_THRESHOLDS.peak_rss_bytes, "<"),
    };
    return {passed: Object.values(checks).every((item) => item.passed), observed: {listPatterns, showPattern, standardSequence, peakRss}, checks};
}

function check(value, threshold, operator) {
    return {passed: operator === "<" ? value < threshold : value <= threshold, value, threshold, operator};
}

function normalizeMaxRss(value) {
    return process.platform === "win32" ? value : value * 1024;
}

function percentile(values, fraction) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function numberFlag(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index === -1) { return fallback; }
    const value = Number.parseInt(process.argv[index + 1], 10);
    if (!Number.isSafeInteger(value) || value < 1) { throw new Error(`Invalid ${name}`); }
    return value;
}

function safeId(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
