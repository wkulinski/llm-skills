import {describe, expect, it} from "vitest";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve} from "node:path";

import {runBaseline} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-baseline.mjs";
import {FINAL_THRESHOLDS, runFinalBenchmark} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-final.mjs";

describe("OWE Stage 16 final non-inferiority benchmark", () => {
    it("reports all required comparisons without fabricating unavailable telemetry", async () => {
        const directory = await mkdtemp(resolve(tmpdir(), "owe-final-test-"));
        try {
            const baselinePath = resolve(directory, "baseline.json");
            await writeFile(baselinePath, `${JSON.stringify(await runBaseline(1), null, 2)}\n`);
            const result = await runFinalBenchmark(baselinePath, 1);

            expect(result.benchmark_version).toBe("owe-stage-16-final-non-inferiority-v1");
            expect(result.reproducibility.fixture_only).toBe(true);
            expect(Object.keys(result.measurements.scenarios)).toEqual([
                "cost_baseline",
                "delegation_candidates",
                "existing_subagents",
                "deep_audit",
            ]);
            expect(result.measurements.total_usage).toMatchObject({status: "unavailable", value: null});
            expect(result.measurements.instruction_tokens).toMatchObject({status: "unavailable", value: null});
            expect(result.measurements.rss).toMatchObject({status: "unavailable", value: null});
            expect(result.quality.overlap.confusion_matrix).toBeTruthy();
            expect(result.quality.pricing.consistency).toBe(true);
            expect(result.rubric.fields).toEqual(["opportunity", "evidence", "action", "confidence", "limitations"]);
            expect(result.decision.stage17_started).toBe(false);
            expect(result.checks.top5_agreement).toMatchObject({passed: false, status: "unavailable", required: FINAL_THRESHOLDS.top5_agreement});
        } finally {
            await rm(directory, {recursive: true, force: true});
        }
    }, 30_000);
});
