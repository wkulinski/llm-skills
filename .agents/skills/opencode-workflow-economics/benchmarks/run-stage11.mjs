#!/usr/bin/env node
import {resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {CORPUS_CASES, CORPUS_VERSION, PRICING} from "../corpus/cases.mjs";
import {analyzeRoots} from "../scripts/lib/analysis.mjs";
import {DEFAULT_CONFIG} from "../scripts/lib/config.mjs";
import {diagnoseDelegationOverlap} from "../scripts/lib/delegation-overlap.mjs";
import {parseTree} from "../scripts/lib/parser.mjs";
import {benchmarkOutputPath, writeBenchmarkOutput} from "./output-path.mjs";

const LABELS = ["strong_repeated_work_signal", "possible_repeated_work", "not_repeated_work"];
const REPEATED_WORK_LABELS = new Set(LABELS.slice(0, 2));
const MAX_RECALL_DROP = 0.1;

async function main() {
    const outputPath = process.argv[2] && !process.argv[2].startsWith("--") ? resolve(process.argv[2]) : benchmarkOutputPath("stage11-ablation.json");
    const result = runStage11();
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    await writeBenchmarkOutput(outputPath, result);
    process.stdout.write(serialized);
}

export function runStage11() {
    const overlapCase = CORPUS_CASES.find((item) => item.id === "overlap");
    const parsedRoots = overlapCase.roots.map((entry) => parseTree(
        entry.tree,
        entry.root_session_id,
        DEFAULT_CONFIG,
        entry.pricing ?? PRICING,
        "compact",
    ));
    const analyzedRoots = analyzeRoots(parsedRoots, DEFAULT_CONFIG, PRICING, {
        corpus_version: CORPUS_VERSION,
        corpus_cases: ["overlap"],
    }).roots;
    const expectedById = new Map(Object.entries(overlapCase.expectations.diagnostics));
    const observed = analyzedRoots.flatMap((root) => {
        const baseline = diagnoseDelegationOverlap(root, DEFAULT_CONFIG.diagnostics.delegation_overlap, {useStructuralSimilarity: true}).diagnostics;
        const ablated = diagnoseDelegationOverlap(root, DEFAULT_CONFIG.diagnostics.delegation_overlap, {useStructuralSimilarity: false}).diagnostics;
        return baseline.map((item, index) => ({
            id: item.delegation_id,
            expected: expectedById.get(item.delegation_id)?.diagnostic,
            baseline: item.diagnostic,
            ablated: ablated[index].diagnostic,
        }));
    });

    const variants = {
        with_structural_similarity: summarizeVariant(observed, "baseline"),
        without_structural_similarity: summarizeVariant(observed, "ablated"),
    };
    const structuralOnlyCases = observed
        .filter((item) => item.baseline === "structural_overlap_only")
        .map((item) => ({
            id: item.id,
            baseline: item.baseline,
            ablated: item.ablated,
            remains_non_repeated_work: !REPEATED_WORK_LABELS.has(item.ablated),
        }));
    const checks = {
        strong_recall_drop: checkRecallDrop(variants.with_structural_similarity.metrics.strong, variants.without_structural_similarity.metrics.strong),
        possible_recall_drop: checkRecallDrop(variants.with_structural_similarity.metrics.possible, variants.without_structural_similarity.metrics.possible),
        strong_precision_non_inferior: checkNonInferior(
            variants.with_structural_similarity.metrics.strong.precision,
            variants.without_structural_similarity.metrics.strong.precision,
        ),
        possible_precision_non_inferior: checkNonInferior(
            variants.with_structural_similarity.metrics.possible.precision,
            variants.without_structural_similarity.metrics.possible.precision,
        ),
        structural_only_not_promoted: structuralOnlyCases.every((item) => item.remains_non_repeated_work),
    };

    return {
        benchmark_version: "owe-stage-11-structural-similarity-ablation-v1",
        corpus_version: CORPUS_VERSION,
        compared_variants: {
            with_structural_similarity: "legacy Jaccard/LCS and structural-family classification enabled",
            without_structural_similarity: "Jaccard/LCS and structural-family classification disabled",
        },
        thresholds: {max_recall_drop: MAX_RECALL_DROP},
        variants,
        structural_only_cases: structuralOnlyCases,
        checks,
        decision: {
            passed: Object.values(checks).every((check) => check === true || check.passed),
            structural_similarity_in_classification: false,
            rationale: "Exact ordered resource evidence is sufficient for repeated-work labels; structural similarity remains descriptive context only.",
            stage12_started: false,
        },
    };
}

function summarizeVariant(observed, field) {
    const actualById = new Map(observed.map((item) => [item.id, item[field]]));
    const confusionMatrix = Object.fromEntries(LABELS.map((expected) => [expected,
        Object.fromEntries(LABELS.map((actual) => [actual, 0]))]));
    for (const item of observed) {
        const expected = toEvaluationLabel(item.expected);
        const actual = toEvaluationLabel(actualById.get(item.id));
        confusionMatrix[expected][actual] += 1;
    }
    return {
        classification_counts: countValues(observed.map((item) => toEvaluationLabel(actualById.get(item.id)))),
        confusion_matrix: confusionMatrix,
        metrics: {
            strong: precisionRecall(observed, field, "strong_repeated_work_signal"),
            possible: precisionRecall(observed, field, "possible_repeated_work"),
        },
    };
}

function precisionRecall(observed, field, target) {
    let truePositive = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    for (const item of observed) {
        const expected = item.expected === target;
        const actual = item[field] === target;
        if (expected && actual) { truePositive += 1; }
        else if (!expected && actual) { falsePositive += 1; }
        else if (expected && !actual) { falseNegative += 1; }
    }
    return {
        true_positive: truePositive,
        false_positive: falsePositive,
        false_negative: falseNegative,
        precision: ratio(truePositive, truePositive + falsePositive),
        recall: ratio(truePositive, truePositive + falseNegative),
    };
}

function checkRecallDrop(baseline, ablated) {
    const drop = baseline.recall - ablated.recall;
    return {passed: drop <= MAX_RECALL_DROP, baseline: baseline.recall, ablated: ablated.recall, drop, max: MAX_RECALL_DROP};
}

function checkNonInferior(baseline, ablated) {
    return {passed: ablated >= baseline, baseline, ablated};
}

function toEvaluationLabel(value) {
    return REPEATED_WORK_LABELS.has(value) ? value : "not_repeated_work";
}

function countValues(values) {
    return Object.fromEntries(LABELS.map((label) => [label, values.filter((value) => value === label).length]));
}

function ratio(numerator, denominator) {
    return denominator === 0 ? 1 : numerator / denominator;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
