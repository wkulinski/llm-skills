#!/usr/bin/env node
/* OWE reports intentionally use the snake_case schema and compact benchmark style. */
import {execFile} from "node:child_process";
import {readFile} from "node:fs/promises";
import {promisify} from "node:util";
import {relative, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {analyzeCorpus, analyzeCorpusCase, CORPUS_CASES, CORPUS_VERSION} from "../corpus/cases.mjs";
import {runStage3} from "./run-stage3.mjs";
import {runStage11} from "./run-stage11.mjs";
import {toSnakeCase} from "../scripts/lib/util.mjs";
import {benchmarkOutputPath, writeBenchmarkOutput} from "./output-path.mjs";

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BASELINE_PATH = benchmarkOutputPath("baseline.json");
const BASELINE_RUNNER = resolve(ROOT, "benchmarks/run-baseline.mjs");
const SAMPLES = 5;

export const FINAL_THRESHOLDS = {
    median_token_reduction: 0.15,
    p95_regression: 0.05,
    root_drill_down_rate_increase: 0,
    strong_false_positive: 0,
    strong_possible_recall_drop: 0.1,
    top5_agreement: 0.8,
};

async function main() {
    const positional = positionalArgs();
    const outputPath = positional[0] ? resolve(positional[0]) : benchmarkOutputPath("final.json");
    const baselinePath = resolve(positional[1] ?? BASELINE_PATH);
    const samples = numberFlag("--samples", SAMPLES);
    const result = await runFinalBenchmark(baselinePath, samples);
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    await writeBenchmarkOutput(outputPath, result);
    process.stdout.write(serialized);
}

export async function runFinalBenchmark(baselinePath = BASELINE_PATH, samplesPerScenario = SAMPLES) {
    const baseline = await readJson(resolve(baselinePath));
    if (!baseline) throw new Error(`Baseline report not found: ${baselinePath}`);

    const [current, drillDown] = await Promise.all([
        runCurrentBaseline(samplesPerScenario),
        runStage3(resolve(baselinePath), samplesPerScenario),
    ]);
    const bundle = analyzeCorpus();
    const ablation = runStage11();
    const comparability = compareCorpusVersions(baseline.corpus_version, CORPUS_VERSION);
    const scenarioComparisons = compareScenarios(
        baseline.local_measurements?.scenarios ?? {},
        current.local_measurements?.scenarios ?? {},
        comparability.same_corpus,
    );
    const patternQuality = measurePatternQuality();
    const pricingConsistency = measurePricingConsistency();
    const rootDrillDown = compareRootDrillDown(baseline, drillDown, comparability.same_corpus);
    const checks = buildChecks({
        comparability,
        scenarioComparisons,
        rootDrillDown,
        patternQuality,
        pricingConsistency,
        ablation,
    });
    const limitations = collectLimitations({baseline, comparability, rootDrillDown, patternQuality});
    const passed = Object.values(checks).every((check) => check.passed === true);

    return {
        benchmark_version: "owe-stage-16-final-non-inferiority-v1",
        corpus_version: CORPUS_VERSION,
        reproducibility: {
            fixture_only: true,
            samples_per_scenario: samplesPerScenario,
            command: "node .agents/skills/opencode-workflow-economics/benchmarks/run-final.mjs",
            baseline_path: relative(process.cwd(), baselinePath) || ".",
            note: "Local fixture measurements are reproducible inputs; wall-clock values are environment dependent. Real model telemetry is never inferred.",
        },
        comparability,
        measurements: {
            scenarios: scenarioComparisons,
            total_usage: {
                ...unavailable("Stage 0 did not persist real OpenCode model usage."),
                fixture_projection: toSnakeCase(bundle.summary.total_usage),
            },
            instruction_tokens: unavailable("Instruction tokens require an agent-run benchmark with captured usage."),
            model_turns: unavailable("Model turns require an agent-run benchmark; local CLI commands are reported separately."),
            root_drill_down: rootDrillDown,
            time: {status: "measured_fixture", source: "scenario p50/p95 wall-clock measurements"},
            rss: unavailable("Stage 0 did not persist peak RSS measurements."),
        },
        quality: {
            patterns: patternQuality,
            overlap: {
                confusion_matrix: ablation.variants.without_structural_similarity.confusion_matrix,
                legacy_confusion_matrix: ablation.variants.with_structural_similarity.confusion_matrix,
                strong_false_positive: ablation.variants.without_structural_similarity.metrics.strong.false_positive,
                strong_possible_recall_drop: Math.max(
                    ablation.checks.strong_recall_drop.drop,
                    ablation.checks.possible_recall_drop.drop,
                ),
            },
            pricing: pricingConsistency,
            top5_agreement: unavailable("Stage 0 did not persist ranked pattern IDs, so top-5 agreement cannot be reconstructed."),
        },
        rubric: fixedRubric({comparability, limitations}),
        checks,
        limitations,
        decision: {
            passed,
            status: passed ? "PASS" : "INCOMPLETE",
            stage17_started: false,
            rationale: passed
                ? "All final non-inferiority checks passed on a comparable corpus."
                : "The final benchmark is recorded, but one or more acceptance checks are unavailable or not satisfied; no stronger claim is made.",
        },
        fixture_summary: {
            root_sessions: bundle.summary.root_sessions,
            model_steps: bundle.summary.model_steps,
            total_cost_status: bundle.summary.total_cost.status,
            methodology_hash: bundle.methodology.methodology_hash,
        },
    };
}

async function runCurrentBaseline(samplesPerScenario) {
    const {stdout} = await execFileAsync(process.execPath, [BASELINE_RUNNER, "--samples", String(samplesPerScenario)], {
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(stdout);
}

function compareCorpusVersions(baselineVersion, currentVersion) {
    const sameCorpus = baselineVersion === currentVersion;
    return {
        same_corpus: sameCorpus,
        baseline_corpus_version: baselineVersion ?? null,
        final_corpus_version: currentVersion,
        status: sameCorpus ? "comparable" : "not_comparable",
        limitation: sameCorpus ? null : "The stored Stage 0 baseline uses a different corpus version; performance deltas are descriptive only.",
    };
}

function compareScenarios(baselineScenarios, currentScenarios, sameCorpus) {
    const names = ["cost_baseline", "delegation_candidates", "existing_subagents", "deep_audit"];
    return Object.fromEntries(names.map((name) => {
        const baseline = baselineScenarios[name];
        const current = currentScenarios[name];
        if (!baseline || !current) return [name, {status: "unavailable", reason: "Scenario missing from baseline or final run."}];
        const baselineP50 = baseline.p50?.p50 ?? null;
        const baselineP95 = baseline.p95 ?? null;
        const currentP50 = current.p50?.p50 ?? null;
        const currentP95 = current.p95 ?? null;
        const baselineTokens = baseline.stdout_tokens_auxiliary_p50 ?? null;
        const currentTokens = current.stdout_tokens_auxiliary_p50 ?? null;
        return [name, {
            status: sameCorpus ? "measured" : "descriptive_not_comparable",
            command_count: delta(baseline.command_count, current.command_count),
            model_turns: unavailable("Model turns are not present in fixture reports."),
            stdout_tokens: delta(baselineTokens, currentTokens),
            wall_clock_ms: {p50: delta(baselineP50, currentP50), p95: delta(baselineP95, currentP95)},
        }];
    }));
}

function compareRootDrillDown(baseline, finalDrillDown, sameCorpus) {
    const baselineRate = baseline.local_measurements?.root_drill_down_rate ?? null;
    const finalRate = finalDrillDown.hint_selection?.root_drill_down_rate ?? null;
    if (baselineRate === null || finalRate === null) {
        return {
            status: "unavailable",
            baseline_rate: baselineRate,
            final_rate: finalRate,
            reason: baselineRate === null ? "Stage 0 did not persist root drill-down rate." : "Final root drill-down rate was not produced.",
        };
    }
    return {
        status: sameCorpus ? "measured" : "descriptive_not_comparable",
        baseline_rate: baselineRate,
        final_rate: finalRate,
        delta: finalRate - baselineRate,
    };
}

function measurePatternQuality() {
    const definition = CORPUS_CASES.find((item) => item.id === "patterns");
    const result = analyzeCorpusCase(definition);
    const expected = [
        ["coherent_pattern", ["repository.search", "file.read{2-3}"]],
        ["mixed_pattern", ["repository.search", "file.read", "file.write"]],
        ["micro_pattern", ["file.read{2-3}"]],
    ];
    const observations = expected.map(([name, operations]) => {
        const pattern = result.pattern_groups.find((item) => item.signature.collapsed_operation_sequence.join("|") === operations.join("|"));
        const expectation = definition.expectations[name];
        return {
            name,
            matched: Boolean(pattern),
            expected_occurrences: expectation.occurrences ?? null,
            observed_occurrences: pattern?.occurrences ?? null,
            expected_distinct_root_sessions: expectation.distinct_root_sessions ?? null,
            observed_distinct_root_sessions: pattern?.distinct_root_sessions ?? null,
            semantic_coherent: expectation.semantic_coherent ?? null,
            delegable: expectation.delegable ?? null,
        };
    });
    const matched = observations.filter((item) => item.matched).length;
    return {
        status: "measured_fixture",
        expectation_count: observations.length,
        matched_expectations: matched,
        membership_agreement: matched / observations.length,
        observations,
        recurring_pattern_groups: result.summary.recurring_pattern_groups,
        mixed_pattern_count: observations.filter((item) => item.semantic_coherent === false).length,
    };
}

function measurePricingConsistency() {
    const definition = CORPUS_CASES.find((item) => item.id === "pricing");
    const observations = Object.entries(definition.expectations.statuses).map(([id, expectation]) => {
        const result = analyzeCorpusCase({...definition, roots: [definition.roots.find((root) => root.root_session_id === id)]});
        const step = result.roots[0].steps[0];
        const actual = {
            step_status: step.status,
            cost_status: step.cost_status,
            pricing_status: result.roots[0].totals.cost.status,
        };
        return {id, expected: expectedSubset(expectation), actual, matched: JSON.stringify(expectedSubset(expectation)) === JSON.stringify(actual)};
    });
    return {
        status: "measured_fixture",
        matched_cases: observations.filter((item) => item.matched).length,
        total_cases: observations.length,
        consistency: observations.every((item) => item.matched),
        observations,
    };
}

function buildChecks({comparability, scenarioComparisons, rootDrillDown, patternQuality, pricingConsistency, ablation}) {
    const tokenComparison = standardWorkflowMetric(scenarioComparisons, "stdout_tokens");
    const p95Comparison = standardWorkflowMetric(scenarioComparisons, "wall_clock_ms", "p95");
    return {
        comparable_corpus: {passed: comparability.same_corpus, value: comparability.same_corpus, required: true},
        median_token_reduction: {
            passed: tokenComparison.status === "measured" && tokenComparison.reduction >= FINAL_THRESHOLDS.median_token_reduction,
            ...tokenComparison,
            required: FINAL_THRESHOLDS.median_token_reduction,
        },
        p95_regression: {
            passed: p95Comparison.status === "measured" && p95Comparison.regression <= FINAL_THRESHOLDS.p95_regression,
            ...p95Comparison,
            required: FINAL_THRESHOLDS.p95_regression,
        },
        root_drill_down_rate: {
            passed: rootDrillDown.status === "measured" && rootDrillDown.delta <= FINAL_THRESHOLDS.root_drill_down_rate_increase,
            value: rootDrillDown.delta ?? null,
            required_max_increase: FINAL_THRESHOLDS.root_drill_down_rate_increase,
            status: rootDrillDown.status,
        },
        pattern_quality: {
            passed: patternQuality.membership_agreement >= 1 && patternQuality.mixed_pattern_count <= 1,
            membership_agreement: patternQuality.membership_agreement,
            required: 1,
        },
        strong_false_positive: {
            passed: ablation.variants.without_structural_similarity.metrics.strong.false_positive <= FINAL_THRESHOLDS.strong_false_positive,
            value: ablation.variants.without_structural_similarity.metrics.strong.false_positive,
            required_max: FINAL_THRESHOLDS.strong_false_positive,
        },
        strong_possible_recall: {
            passed: ablation.checks.strong_recall_drop.passed && ablation.checks.possible_recall_drop.passed,
            value: Math.max(ablation.checks.strong_recall_drop.drop, ablation.checks.possible_recall_drop.drop),
            required_max: FINAL_THRESHOLDS.strong_possible_recall_drop,
        },
        top5_agreement: {passed: false, status: "unavailable", required: FINAL_THRESHOLDS.top5_agreement},
        pricing_consistency: {passed: pricingConsistency.consistency, matched_cases: pricingConsistency.matched_cases, total_cases: pricingConsistency.total_cases},
    };
}

function fixedRubric({comparability, limitations}) {
    return {
        fields: ["opportunity", "evidence", "action", "confidence", "limitations"],
        recommendations: [{
            opportunity: "final_non_inferiority",
            evidence: comparability.same_corpus ? "measured_fixture_and_corpus_expectations" : "measured_fixture_with_non_comparable_baseline",
            action: comparability.same_corpus ? "accept_only_if_all_checks_pass" : "capture_a_fresh_stage_0_baseline_before_acceptance",
            confidence: comparability.same_corpus ? "medium" : "low",
            limitations,
        }],
    };
}

function collectLimitations({baseline, comparability, rootDrillDown, patternQuality}) {
    const limitations = [];
    if (!comparability.same_corpus) limitations.push(comparability.limitation);
    if (rootDrillDown.status === "unavailable") limitations.push(rootDrillDown.reason);
    limitations.push("Real model usage, instruction tokens, model turns and RSS require captured OpenCode agent telemetry.");
    limitations.push("Top-5 agreement requires persisted Stage 0 ranked pattern IDs.");
    if (patternQuality.status === "measured_fixture") limitations.push("Pattern quality is evaluated against hand-reviewed fixture expectations, not an observed production workflow.");
    if (!baseline.local_measurements?.scenarios) limitations.push("The Stage 0 scenario measurements are incomplete.");
    return [...new Set(limitations.filter(Boolean))];
}

function standardWorkflowMetric(scenarios, field, nestedKey = null) {
    const values = Object.values(scenarios);
    if (values.length !== 4 || values.some((item) => item.status !== "measured")) return {status: "unavailable"};
    const current = values.reduce((sum, item) => sum + Number(nestedKey ? item[field][nestedKey].current : item[field].current), 0);
    const baseline = values.reduce((sum, item) => sum + Number(nestedKey ? item[field][nestedKey].baseline : item[field].baseline), 0);
    if (!Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return {status: "unavailable"};
    return {status: "measured", baseline, current, reduction: (baseline - current) / baseline, regression: (current - baseline) / baseline};
}

function delta(baseline, current) {
    return {baseline: baseline ?? null, current: current ?? null, delta: baseline === null || current === null ? null : current - baseline};
}

function unavailable(reason) {
    return {status: "unavailable", value: null, reason};
}

function expectedSubset(value) {
    return {step_status: value.step_status, cost_status: value.cost_status, pricing_status: value.pricing_status};
}

async function readJson(path) {
    return JSON.parse(await readFile(path, "utf8"));
}

function numberFlag(name, fallback) {
    const index = process.argv.indexOf(name);
    if (index === -1) return fallback;
    const value = Number.parseInt(process.argv[index + 1], 10);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${name}`);
    return value;
}

function positionalArgs() {
    const args = process.argv.slice(2);
    const index = args.indexOf("--samples");
    if (index !== -1) args.splice(index, 2);
    return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
