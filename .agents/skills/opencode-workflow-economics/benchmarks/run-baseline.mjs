#!/usr/bin/env node
import {mkdtemp, rm} from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {performance} from "node:perf_hooks";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {CORPUS_VERSION, analyzeCorpus} from "../corpus/cases.mjs";
import {DEFAULT_CONFIG} from "../scripts/lib/config.mjs";
import {writeLayeredReport} from "../scripts/lib/report-files.mjs";
import {benchmarkOutputPath, writeBenchmarkOutput} from "./output-path.mjs";

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI = resolve(ROOT, "scripts/owe.mjs");
const SAMPLES = 5;

async function main() {
    const outputPath = positionalArgs()[0] ? resolve(positionalArgs()[0]) : benchmarkOutputPath("baseline.json");
    const samples = numberFlag("--samples", SAMPLES);
    const result = await runBaseline(samples);
    await writeBenchmarkOutput(outputPath, result);
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    process.stdout.write(serialized);
}

export async function runBaseline(samplesPerScenario = SAMPLES) {
    const analysisDir = await mkdtemp(resolve(tmpdir(), "owe-baseline-"));
    try {
        const analysisStart = performance.now();
        const bundle = analyzeCorpus();
        const analysisMs = performance.now() - analysisStart;
        const reportStart = performance.now();
        const report = await writeLayeredReport(bundle, {
            analysis_dir: analysisDir,
            brief: DEFAULT_CONFIG.reporting.brief,
        });
        const reportMs = performance.now() - reportStart;
        const scenarios = await benchmarkScenarios(analysisDir, bundle, samplesPerScenario);
        return {
            baseline_version: "owe-stage-0-baseline-v1",
            corpus_version: CORPUS_VERSION,
            generated_at: new Date().toISOString(),
            reproducibility: {
                fixture_only: true,
                samples_per_cli_scenario: SAMPLES,
                command: "node .agents/skills/opencode-workflow-economics/benchmarks/run-baseline.mjs",
                note: "Fixture corpus and local CLI projections are deterministic inputs; wall-clock values are environment dependent.",
            },
            methodology: {
                corpus_cases: bundle.source.corpus_cases,
                root_sessions: bundle.summary.root_sessions,
                model_steps: bundle.summary.model_steps,
                recurring_pattern_groups: bundle.summary.recurring_pattern_groups,
                overlap_diagnostics: bundle.summary.delegations,
                pricing: {
                    status: bundle.summary.total_cost.status,
                    priced_steps: bundle.summary.total_cost.priced_steps,
                    eligible_steps: bundle.summary.total_cost.eligible_steps,
                },
            },
            local_measurements: {
                analyze_corpus_ms: summarize([analysisMs]),
                write_report_ms: summarize([reportMs]),
                report_bytes: report.report_sizes,
                scenarios,
            },
            unavailable_measurements: {
                model_usage: "No OpenCode session usage was supplied by the fixture corpus.",
                instruction_tokens: "Requires an agent-run benchmark with captured model usage.",
                model_turns: "Requires an agent-run benchmark; local CLI commands are recorded separately.",
                peak_rss: "Not collected by the fixture runner.",
                prepare_latency: "Not measured by the fixture runner; auto-start is smoke-tested, but real session history benchmarking is separate.",
            },
        };
    } finally {
        await rm(analysisDir, {recursive: true, force: true});
    }
}

async function benchmarkScenarios(analysisDir, bundle, samplesPerScenario = SAMPLES) {
    const patternIds = bundle.pattern_groups.slice(0, 3).map((item) => item.pattern_id);
    const overlapIds = bundle.delegation_overlap_diagnostics.slice(0, 2).map((item) => item.delegation_id);
    const rootId = bundle.roots[0].root_session_id;
    const scenarios = {
        cost_baseline: [
            ["list", "roots", "--sort", "cost", "--limit", "10"],
            ["list", "patterns", "--sort", "total-cost", "--limit", "10"],
        ],
        delegation_candidates: [
            ["list", "patterns", "--sort", "total-cost", "--limit", "10"],
            ...patternIds.map((id) => ["show", "pattern", id]),
        ],
        existing_subagents: [
            ["list", "subagents", "--limit", "10"],
            ["list", "overlaps", "--limit", "10"],
            ...overlapIds.map((id) => ["show", "overlap", id]),
        ],
        deep_audit: [
            ["show", "root", rootId],
            ["show", "root", rootId, "--json"],
        ],
    };
    const result = {};
    for (const [name, commands] of Object.entries(scenarios)) {
        const samples = [];
        for (let sample = 0; sample < samplesPerScenario; sample += 1) {
            const started = performance.now();
            let stdoutBytes = 0;
            for (const command of commands) {
                const output = await execFileAsync(process.execPath, [CLI, ...command, "--analysis-dir", analysisDir], {encoding: "utf8"});
                stdoutBytes += Buffer.byteLength(output.stdout, "utf8");
            }
            const durationMs = performance.now() - started;
            samples.push({duration_ms: durationMs, stdout_bytes: stdoutBytes, stdout_tokens_auxiliary: Math.ceil(stdoutBytes / 4)});
        }
        result[name] = {
            command_count: commands.length,
            tool_calls: commands.length,
            model_turns: null,
            instruction_tokens: null,
            workflow_cost: {status: "unavailable", reason: "No real OpenCode usage was supplied."},
            samples,
            p50: summarize(samples.map((item) => item.duration_ms)),
            p95: percentile(samples.map((item) => item.duration_ms), 0.95),
            stdout_bytes_p50: percentile(samples.map((item) => item.stdout_bytes), 0.5),
            stdout_tokens_auxiliary_p50: percentile(samples.map((item) => item.stdout_tokens_auxiliary), 0.5),
        };
    }
    return result;
}

function numberFlag(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index === -1) { return fallback; }
    const value = Number.parseInt(process.argv[index + 1], 10);
    if (!Number.isSafeInteger(value) || value < 1) { throw new Error(`Invalid ${name}`); }
    return value;
}

function positionalArgs() {
    const args = process.argv.slice(2);
    const index = args.indexOf("--samples");
    if (index !== -1) { args.splice(index, 2); }
    return args;
}

function summarize(values) {
    return {p50: percentile(values, 0.5), p95: percentile(values, 0.95)};
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
