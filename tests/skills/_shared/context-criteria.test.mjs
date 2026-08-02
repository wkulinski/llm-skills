import {describe, expect, it} from "vitest";
import {validateCriteriaDocument} from "../../../.agents/skills/_shared/scripts/context-criteria.mjs";

describe("criteria validator", () => {
    it("accepts the canonical object format", () => {
        expect(validateCriteriaDocument({criteria: [{id: "C1", description: "Map the flow."}]}).valid).toBe(true);
        expect(validateCriteriaDocument({criteria: [{
            id: "C1",
            description: "Map the flow.",
            forbid_negative_claims: true,
            required_evidence: [{path: "AGENTS.md", relation: "defines", anchors: ["Repository Guidelines"]}],
        }]}).valid).toBe(true);
    });

    it("rejects aliases, duplicates and incomplete entries", () => {
        expect(validateCriteriaDocument(["C1"]).valid).toBe(false);
        const result = validateCriteriaDocument({criteria: [
            {id: "C1", description: "One"},
            {id: "C1", description: ""},
        ]});
        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("duplicate"))).toBe(true);
        expect(result.errors.some((error) => error.includes("description"))).toBe(true);
    });

    it("rejects malformed semantic evidence requirements", () => {
        const result = validateCriteriaDocument({criteria: [{
            id: "C1",
            description: "Map the flow.",
            forbid_negative_claims: "yes",
            required_evidence: [
                {path: "AGENTS.md", path_prefix: "tests/"},
                {path: "../outside", anchors: []},
            ],
        }]});

        expect(result.valid).toBe(false);
        expect(result.errors.join("\n")).toMatch(/forbid_negative_claims/);
        expect(result.errors.join("\n")).toMatch(/exactly one safe repo-relative path or path_prefix/);
        expect(result.errors.join("\n")).toMatch(/anchors/);
    });
});
