import {describe, expect, it} from "vitest";

import {validateScoutReport} from "../../../.agents/skills/_shared/scripts/context-scout-report.mjs";

function report(overrides = {}) {
    const evidence = {path: "AGENTS.md", line_start: 1, line_end: 1, relation: "defines"};
    return {
        version: 1,
        status: "COMPLETE",
        mode: "targeted",
        findings: [{criterion_id: "C1", claim: "AGENTS defines repository rules", claim_type: "observed", confidence: "high", anchors: ["Repository Guidelines"], evidence: [evidence]}],
        coverage: [{criterion_id: "C1", status: "covered", evidence: [evidence]}],
        risks: [],
        omitted: [],
        next_step: "none",
        ...overrides,
    };
}

describe("context scout report evidence discipline", () => {
    it("requires claim metadata for findings", () => {
        const value = report({findings: [{criterion_id: "C1", claim: "unclassified", evidence: [{path: "AGENTS.md", line_start: 1, line_end: 1}]}]});
        const result = validateScoutReport(value, {criteria: new Set(["C1"])});

        expect(result.valid).toBe(false);
        expect(result.errors.join("\n")).toMatch(/claim_type/);
    });

    it("rejects evidence ranges wider than the parent-ready budget", () => {
        const evidence = {path: "AGENTS.md", line_start: 1, line_end: 81};
        const result = validateScoutReport(report({
            findings: [{criterion_id: "C1", claim: "broad claim", claim_type: "structural", confidence: "medium", anchors: ["Repository Guidelines"], evidence: [evidence]}],
            coverage: [{criterion_id: "C1", status: "covered", evidence: [evidence]}],
        }), {criteria: new Set(["C1"])});

        expect(result.valid).toBe(false);
        expect(result.errors.join("\n")).toMatch(/more than 80 lines/);
    });

    it("rejects a claim whose literal anchor is absent from evidence", () => {
        const value = report({findings: [{criterion_id: "C1", claim: "template defines context_tiers", claim_type: "observed", confidence: "high", anchors: ["context_tiers"], evidence: [{path: "AGENTS.md", line_start: 1, line_end: 1}]}]});
        const result = validateScoutReport(value, {criteria: new Set(["C1"])});

        expect(result.valid).toBe(false);
        expect(result.errors.join("\n")).toMatch(/anchors term is absent/);
    });

    it("enforces criterion-specific required evidence against finding evidence", () => {
        const criteria = [{
            id: "C1",
            description: "Map repository rules.",
            required_evidence: [{path: "AGENTS.md", relation: "defines", anchors: ["Repository Guidelines"]}],
        }];
        expect(validateScoutReport(report(), {criteria}).valid).toBe(true);

        const invalid = validateScoutReport(report(), {criteria: [{
            ...criteria[0],
            required_evidence: [{path_prefix: "tests/", relation: "tests"}],
        }]});
        expect(invalid.valid).toBe(false);
        expect(invalid.errors.join("\n")).toMatch(/does not satisfy required_evidence/);

        const splitEvidence = [
            {path: "AGENTS.md", line_start: 1, line_end: 1, relation: "defines"},
            {path: "AGENTS.md", line_start: 3, line_end: 3, relation: "defines"},
        ];
        const split = report({
            findings: [{criterion_id: "C1", claim: "AGENTS defines repository structure", claim_type: "observed", confidence: "high", anchors: ["Repository Guidelines", "Project Structure"], evidence: splitEvidence}],
            coverage: [{criterion_id: "C1", status: "covered", evidence: []}],
        });
        expect(validateScoutReport(split, {criteria: [{
            id: "C1",
            description: "Map repository rules.",
            required_evidence: [{path: "AGENTS.md", relation: "defines", anchors: ["Repository Guidelines", "Project Structure"]}],
        }]}).valid).toBe(true);
    });

    it("rejects forbidden negative claims only for strict criteria", () => {
        const value = report({
            findings: [{...report().findings[0], claim: "No standalone rules file exists."}],
        });
        expect(validateScoutReport(value, {criteria: new Set(["C1"])}).valid).toBe(true);

        const strict = validateScoutReport(value, {criteria: [{
            id: "C1",
            description: "Map repository rules.",
            forbid_negative_claims: true,
        }]});
        expect(strict.valid).toBe(false);
        expect(strict.errors.join("\n")).toMatch(/forbidden negative or exhaustive claim/);
    });
});
