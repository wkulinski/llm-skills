import {describe, expect, it} from "vitest";

import {BENCHMARK_OUTPUT_DIR, benchmarkOutputPath} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/output-path.mjs";

describe("OWE benchmark output paths", () => {
    it("uses the ignored repository benchmark directory by default", () => {
        expect(BENCHMARK_OUTPUT_DIR).toMatch(/\.owe\/benchmarks$/);
        expect(benchmarkOutputPath("final.json")).toMatch(/\.owe\/benchmarks\/final\.json$/);
    });
});
