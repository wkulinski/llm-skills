#!/usr/bin/env node
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {performance} from "node:perf_hooks";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {analyzeCorpus} from "../corpus/cases.mjs";
import {DEFAULT_CONFIG} from "../scripts/lib/config.mjs";
import {renderAnalysisBrief} from "../scripts/lib/report-brief.mjs";
import {buildReportIndex} from "../scripts/lib/report-index.mjs";
import {writeLayeredReport} from "../scripts/lib/report-files.mjs";
import {benchmarkOutputPath, writeBenchmarkOutput} from "./output-path.mjs";

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI = resolve(ROOT, "scripts/owe.mjs");
const SAMPLES = 5;

async function main() {
    const outputPath = process.argv[2] ? resolve(process.argv[2]) : benchmarkOutputPath("stage3.json");
    const baselinePath = resolve(process.argv[3] ?? benchmarkOutputPath("baseline.json"));
    const result = await runStage3(baselinePath);
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    await writeBenchmarkOutput(outputPath, result);
    process.stdout.write(serialized);
}

export async function runStage3(baselinePath, samplesPerScenario = SAMPLES) {
    const analysisDir = await mkdtemp(resolve(tmpdir(), "owe-stage3-"));
    try {
        const bundle = analyzeCorpus();
        const report = await writeLayeredReport(bundle, {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const persistedBundle = JSON.parse(await readFile(resolve(analysisDir, "report.json"), "utf8"));
        const index = buildReportIndex(persistedBundle);
        const patternIds = bundle.pattern_groups.slice(0, 3).map((item) => item.pattern_id);
        const overlapId = bundle.delegation_overlap_diagnostics[0]?.delegation_id;
        const rootId = bundle.roots[0].root_session_id;
        const plans = {
            cost_baseline: [["brief"]],
            delegation_candidates: [["brief"], ...patternIds.map((id) => ["show", "pattern", id])],
            existing_subagents: [["brief"], ["list", "subagents", "--limit", "10"], ...(overlapId ? [["show", "overlap", overlapId]] : [])],
            deep_audit: [["brief"], ["show", "root", rootId]],
        };
        const scenarios = {};
        for (const [name, commands] of Object.entries(plans)) { scenarios[name] = await measurePlan(analysisDir, commands, samplesPerScenario); }
        const rootSessionCount = new Set(bundle.roots.map((root) => root.root_session_id)).size;
        const hintComparison = [1, 2].map((hintsPerExample) => {
            const brief = renderAnalysisBrief(bundle, index, {
                ...DEFAULT_CONFIG.reporting.brief,
                hints_per_example: hintsPerExample,
            });
            const recommendedRootReads = countOccurrences(brief, "show root <session-id>");
            return {
                hints_per_example: hintsPerExample,
                brief_bytes: Buffer.byteLength(brief, "utf8"),
                brief_tokens_auxiliary: Math.ceil(Buffer.byteLength(brief, "utf8") / 4),
                recommended_root_reads: recommendedRootReads,
                root_session_count: rootSessionCount,
                root_drill_down_rate: recommendedRootReads / Math.max(1, rootSessionCount),
                additional_read_commands: scenarios.deep_audit.additional_read_commands,
            };
        });
        const baseline = await readJson(baselinePath);
        return {
            benchmark_version: "owe-stage-3-drill-down-v1",
            corpus_version: bundle.source.corpus_version,
            reproducibility: {
                fixture_only: true,
                samples_per_scenario: samplesPerScenario,
                command: "node .agents/skills/opencode-workflow-economics/benchmarks/run-stage3.mjs",
                note: "Command counts are deterministic; wall-clock and stdout values are environment dependent.",
            },
            guardrails: {
                brief_max_bytes: DEFAULT_CONFIG.reporting.brief.max_bytes,
                brief_max_patterns: DEFAULT_CONFIG.reporting.brief.max_patterns,
                brief_max_overlaps: DEFAULT_CONFIG.reporting.brief.max_overlap_diagnostics,
                root_max_bytes: 16 * 1024,
                root_max_spans: 20,
            },
            scenarios,
            hint_comparison: hintComparison,
            hint_selection: selectHintVariant(hintComparison),
            baseline_comparison: compareCommandCounts(scenarios, baseline?.local_measurements?.scenarios ?? {}),
            report_sizes: report.report_sizes,
        };
    } finally {
        await rm(analysisDir, {recursive: true, force: true});
    }
}

async function measurePlan(analysisDir, commands, samplesPerScenario) {
    const samples = [];
    for (let sample = 0; sample < samplesPerScenario; sample += 1) {
        let stdoutBytes = 0;
        const started = performance.now();
        for (const command of commands) {
            const output = await execFileAsync(process.execPath, [CLI, ...command, "--analysis-dir", analysisDir], {encoding: "utf8"});
            stdoutBytes += Buffer.byteLength(output.stdout, "utf8");
        }
        samples.push({duration_ms: performance.now() - started, stdout_bytes: stdoutBytes});
    }
    return {
        command_count: commands.length,
        p50_command_count: commands.length,
        p95_command_count: commands.length,
        additional_read_commands: Math.max(0, commands.length - 1),
        show_root_count: commands.filter((command) => command[0] === "show" && command[1] === "root").length,
        samples,
        p50_duration_ms: percentile(samples.map((item) => item.duration_ms), 0.5),
        p95_duration_ms: percentile(samples.map((item) => item.duration_ms), 0.95),
        stdout_bytes_p50: percentile(samples.map((item) => item.stdout_bytes), 0.5),
    };
}

function compareCommandCounts(scenarios, baselineScenarios) {
    const comparison = {};
    for (const [name, scenario] of Object.entries(scenarios)) {
        const baseline = baselineScenarios[name];
        comparison[name] = {
            current_p50: scenario.p50_command_count,
            current_p95: scenario.p95_command_count,
            baseline_p50: baseline?.command_count ?? null,
            baseline_p95: baseline?.command_count ?? null,
            p50_delta: baseline ? scenario.p50_command_count - baseline.command_count : null,
            p95_delta: baseline ? scenario.p95_command_count - baseline.command_count : null,
        };
    }
    return comparison;
}

async function readJson(path) {
    try {
        return JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") { return null; }
        throw error;
    }
}

function countOccurrences(value, needle) {
    return value.split(needle).length - 1;
}

export function selectHintVariant(comparison) {
    const selected = comparison.slice().sort((left, right) =>
        left.root_drill_down_rate - right.root_drill_down_rate
        || left.brief_tokens_auxiliary - right.brief_tokens_auxiliary
        || left.hints_per_example - right.hints_per_example,
    )[0];
    return {
        recommended_hints_per_example: selected.hints_per_example,
        root_drill_down_rate: selected.root_drill_down_rate,
        brief_tokens_auxiliary: selected.brief_tokens_auxiliary,
        rationale: "Choose the lowest root drill-down rate, then the lowest auxiliary token count and hint count.",
    };
}

function percentile(values, fraction) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
