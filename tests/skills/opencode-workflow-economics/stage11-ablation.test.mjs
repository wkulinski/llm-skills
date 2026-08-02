import {describe, expect, it} from "vitest";

import {runStage11} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-stage11.mjs";

describe("OWE Stage 11 structural similarity ablation", () => {
    it("passes non-inferiority thresholds and does not promote structural-only cases", () => {
        const result = runStage11();

        expect(result.benchmark_version).toBe("owe-stage-11-structural-similarity-ablation-v1");
        expect(result.decision).toMatchObject({passed: true, structural_similarity_in_classification: false, stage12_started: false});
        expect(result.structural_only_cases).toEqual([
            {
                id: "overlap-structural:tool:0",
                baseline: "structural_overlap_only",
                ablated: "no_overlap_observed_in_window",
                remains_non_repeated_work: true,
            },
            {
                id: "overlap-multi-structural:tool:0",
                baseline: "structural_overlap_only",
                ablated: "no_overlap_observed_in_window",
                remains_non_repeated_work: true,
            },
        ]);
        for (const check of Object.values(result.checks)) { expect(check === true || check.passed).toBe(true); }
        expect(result.variants.without_structural_similarity.confusion_matrix).toMatchObject({
            strong_repeated_work_signal: {strong_repeated_work_signal: 2},
            possible_repeated_work: {possible_repeated_work: 4},
        });
    });
});
