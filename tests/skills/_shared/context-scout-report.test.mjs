import fs from "node:fs";
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

    it("accepts valid evidence ranges without a numeric line quota", () => {
        const evidence = {path: "AGENTS.md", line_start: 1, line_end: 81};
        const result = validateScoutReport(report({
            findings: [{criterion_id: "C1", claim: "broad claim", claim_type: "structural", confidence: "medium", anchors: ["Repository Guidelines"], evidence: [evidence]}],
            coverage: [{criterion_id: "C1", status: "covered", evidence: [evidence]}],
        }), {criteria: new Set(["C1"])});

        expect(result.valid).toBe(true);
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

    it("accepts scout-selected evidence from the required path prefix", () => {
        const evidence = {
            path: "tests/skills/_shared/context-scout-report.test.mjs",
            line_start: 1,
            line_end: 35,
            relation: "tests",
        };
        const value = report({
            findings: [{
                criterion_id: "C1",
                claim: "the context scout report evidence discipline suite is directly tested",
                claim_type: "observed",
                confidence: "high",
                anchors: ["context scout report evidence discipline"],
                evidence: [evidence],
            }],
            coverage: [{criterion_id: "C1", status: "covered", evidence: [evidence]}],
        });

        expect(validateScoutReport(value, {criteria: [{
            id: "C1",
            description: "Map the report tests.",
            required_evidence: [{path_prefix: "tests/skills/_shared/", relation: "tests", anchor_mode: "scout-selected"}],
        }]}).valid).toBe(true);
    });

    it("does not treat a sibling path with the same textual prefix as a descendant", () => {
        const evidence = {
            path: "tests/skills/_shared/context-scout-report.test.mjs",
            line_start: 1,
            line_end: 35,
            relation: "tests",
        };
        const value = report({
            findings: [{
                criterion_id: "C1",
                claim: "the context scout report evidence discipline suite is directly tested",
                claim_type: "observed",
                confidence: "high",
                anchors: ["context scout report evidence discipline"],
                evidence: [evidence],
            }],
            coverage: [{criterion_id: "C1", status: "covered", evidence: [evidence]}],
        });

        const result = validateScoutReport(value, {criteria: [{
            id: "C1",
            description: "Require a different sibling path.",
            required_evidence: [{path_prefix: "tests/skills/_share", relation: "tests", anchor_mode: "scout-selected"}],
        }]});
        expect(result.valid).toBe(false);
        expect(result.errors.join("\n")).toMatch(/does not satisfy required_evidence/);
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

    it("requires complete structured read metadata once read purpose is declared", () => {
        const evidence = {path: "AGENTS.md", line_start: 1, line_end: 1, purpose: "discovery"};
        const result = validateScoutReport(report({
            findings: [{...report().findings[0], evidence: [evidence]}],
            coverage: [{criterion_id: "C1", status: "covered", evidence: [evidence]}],
        }), {criteria: new Set(["C1"])});

        expect(result.valid).toBe(false);
        expect(result.errors.join("\n")).toMatch(/structured metadata must include/);
    });
});

it("validates the documented minimal BLOCKED envelope and requires version 1", () => {
    const protocol = fs.readFileSync(new URL("../../../.agents/skills/_shared/references/context-scout-report-protocol.md", import.meta.url), "utf8");
    const minimal = JSON.parse(protocol.match(/```json\n([\s\S]*?)\n```/)[1]);
    expect(validateScoutReport(minimal, {criteria: new Set(["C1"])})).toEqual({valid: true, errors: []});
    expect(minimal).not.toHaveProperty("read_coverage");
    delete minimal.version;
    expect(validateScoutReport(minimal, {criteria: new Set(["C1"])}).errors).toContain("version must be 1");
});

it("allows a justified follow-up for an already partially read file", () => {
    const value = report({read_coverage: {
        covered: [{path: "AGENTS.md", line_start: 1, line_end: 1}],
        follow_up: [{path: "AGENTS.md", reason: "Read the remaining workflow section beyond line 1."}],
    }});
    expect(validateScoutReport(value, {criteria: new Set(["C1"])}).valid).toBe(true);
    value.read_coverage.follow_up[0].reason = "";
    expect(validateScoutReport(value).valid).toBe(false);
});

it.each(["INCOMPLETE", "BLOCKED"])("requires explicit criterion gaps in %s", status => {
    const value = report({status, findings: [], coverage: []});
    expect(validateScoutReport(value, {criteria: new Set(["C1"])}).valid).toBe(false);
});
