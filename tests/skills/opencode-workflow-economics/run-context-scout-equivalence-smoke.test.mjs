import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

import {parseArgs} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-equivalence-smoke.mjs";

const SOURCE = readFileSync(new URL("../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-equivalence-smoke.mjs", import.meta.url), "utf8");

describe("canonical equivalence smoke runner", () => {
    it("publishes a bounded help command", () => {
        expect(parseArgs(["--help"])).toEqual({help: true});
    });

    it("uses the production helper lifecycle and native task controller", () => {
        expect(SOURCE).toMatch(/prepareHybrid/);
        expect(SOURCE).toMatch(/claimAttempt/);
        expect(SOURCE).toMatch(/evaluateAttempt/);
        expect(SOURCE).toMatch(/finalizeHybrid/);
        expect(SOURCE).toMatch(/native task call/);
        expect(SOURCE).toMatch(/criteria_equivalence/);
        expect(SOURCE).toMatch(/PRIMARY_OUTPUT_MISSING/);
        expect(SOURCE).toMatch(/all_primary_observed/);
        expect(SOURCE).toMatch(/dispatch_audit/);
        expect(SOURCE).toMatch(/workspace_unchanged/);
    });
});
