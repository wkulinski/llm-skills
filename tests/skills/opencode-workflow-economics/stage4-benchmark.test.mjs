import {describe, expect, it} from "vitest";

import {runStage4, STAGE4_THRESHOLDS} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-stage4.mjs";

describe("OWE Stage 4 index gate", () => {
    it("measures no-index projections and returns an explicit Stage 5 decision", async () => {
        const result = await runStage4(1, {small: 5});

        expect(result.benchmark_version).toBe("owe-stage-4-index-gate-v1");
        expect(result.methodology.indexed_artifact_is_not_read).toBe(true);
        expect(result.corpora.small.root_sessions).toBe(5);
        expect(result.corpora.small.scenarios.list_patterns.operation_count).toBe(1);
        expect(result.corpora.small.scenarios.show_pattern.operation_count).toBe(1);
        expect(result.corpora.small.scenarios.standard_sequence.operation_count).toBeGreaterThanOrEqual(3);
        expect(result.checks.small).toHaveProperty("passed");
        expect(result.thresholds).toEqual(STAGE4_THRESHOLDS);
        expect(result.decision.stage5_started).toBe(false);
        expect(["remove_index_in_stage_5", "retain_minimal_index_in_stage_5"]).toContain(result.decision.recommended_action);
    });
});
