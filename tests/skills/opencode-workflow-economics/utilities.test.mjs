import {describe, expect, it} from "vitest";

import {classifyStepActivity} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/analysis.mjs";
import {collapseSequence} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/fingerprints.mjs";
import {canonicalModelId, parseDecimalNano} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/pricing.mjs";
import {parseSince} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/util.mjs";

describe("OWE utility contracts", () => {
    it("parses relative collection windows", () => {
        expect(parseSince("2h", 10_000_000)).toBe(2_800_000);
        expect(parseSince("2026-01-01T00:00:00Z", 10_000_000)).toBe(Date.parse("2026-01-01T00:00:00Z"));
        expect(() => parseSince("invalid", 10_000_000)).toThrow("Invalid --since value");
    });

    it("parses decimal prices exactly", () => {
        expect(parseDecimalNano("1.5")).toBe(1_500_000_000n);
        expect(() => parseDecimalNano("1.1234567890")).toThrow("Invalid decimal price");
    });

    it("canonicalizes provider and model identifiers", () => {
        expect(canonicalModelId("openai", "gpt-5")).toBe("openai/gpt-5");
        expect(canonicalModelId("openai", "openai/gpt-5")).toBe("openai/gpt-5");
        expect(canonicalModelId(null, "gpt-5")).toBe("gpt-5");
    });

    it("collapses repeated operation sequences into configured buckets", () => {
        expect(collapseSequence(["read", "read", "read", "write"], [1, 3])).toEqual(["read{2-3}", "write"]);
    });

    it("preserves mixed activity signals while selecting a primary activity", () => {
        const classification = classifyStepActivity(
            {retry_count: 0, finish_reason: null, usage: {reasoning_tokens: 0n}},
            [
                {tool_category: "search", operation_category: "repository.search"},
                {tool_category: "read", operation_category: "file.read"},
            ],
        );

        expect(classification.primary_activity).toBe("repository_discovery");
        expect(classification.activities).toEqual(["repository_discovery", "file_reading"]);
        expect(classification.classification.resolution).toBe("dominant");
    });
});
