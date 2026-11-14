import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

import {parseArgs} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-equivalence-smoke.mjs";
import {SCOUT_PROTOCOL_VERSION} from "../../../.agents/skills/_shared/scripts/context-scout-run.mjs";

const SOURCE = readFileSync(new URL("../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-equivalence-smoke.mjs", import.meta.url), "utf8");

describe("canonical equivalence smoke runner", () => {
    it("publishes a bounded help command", () => {
        expect(parseArgs(["--help"])).toEqual({help: true});
    });

    it("uses the production helper lifecycle and native task controller", () => {
        expect(SOURCE).toMatch(/prepareScout/);
        expect(SOURCE).toMatch(/claimScout/);
        expect(SOURCE).toMatch(/settleScout/);
        expect(SOURCE).not.toMatch(/evaluateAttempt/);
        expect(SOURCE).not.toMatch(/finalizeHybrid/);
        expect(SOURCE).toMatch(/native task call/);
        expect(SOURCE).toMatch(/criteria_equivalence/);
        expect(SOURCE).toMatch(/SCOUT_OUTPUT_MISSING/);
        expect(SOURCE).toMatch(/all_scout_observed/);
        expect(SOURCE).toMatch(/dispatch_audit/);
        expect(SOURCE).toMatch(/workspace_unchanged/);
    });

    it("publishes the protocol version owned by the production helper", () => {
        expect(SCOUT_PROTOCOL_VERSION).toBe(6);
        expect(SOURCE).toMatch(/protocol_version:\s*SCOUT_PROTOCOL_VERSION/);
        expect(SOURCE).not.toMatch(/protocol_version:\s*\d/);
    });
});
