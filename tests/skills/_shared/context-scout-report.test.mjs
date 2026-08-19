import {describe, expect, it} from "vitest";

import {
    FAILURE_CLASSES,
    RETRYABLE_FAILURE_CLASSES,
    classifyReportValidation,
    isRetryableFailureClass,
    nextActionForFailureClass,
    validateScoutReport,
} from "../../../.agents/skills/_shared/scripts/context-scout-report.mjs";

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

describe("context scout failure classification", () => {
    const cases = [
        [FAILURE_CLASSES.INPUT_INVALID, "STOP", false],
        [FAILURE_CLASSES.SCOPE_INVALID, "STOP", false],
        [FAILURE_CLASSES.SNAPSHOT_STALE, "ABORT", false],
        [FAILURE_CLASSES.AGENT_INCOMPLETE, "CLAIM_FALLBACK", true],
        [FAILURE_CLASSES.AGENT_TIMEOUT, "CLAIM_FALLBACK", true],
        [FAILURE_CLASSES.REPORT_MISSING, "CLAIM_FALLBACK", true],
        [FAILURE_CLASSES.REPORT_INVALID, "CLAIM_FALLBACK", true],
        [FAILURE_CLASSES.REPORT_WRITE_FAILED, "CLAIM_FALLBACK", true],
    ];

    it.each(cases)("classifies %s with primary action %s", (failureClass, action, retryable) => {
        expect(isRetryableFailureClass(failureClass)).toBe(retryable);
        expect(nextActionForFailureClass(failureClass, "primary")).toBe(action);
        expect(nextActionForFailureClass(failureClass, "fallback")).toBe(retryable ? "FINALIZE" : action);
        expect(RETRYABLE_FAILURE_CLASSES.has(failureClass)).toBe(retryable);
    });

    it("classifies valid incomplete and blocked reports as retryable agent results", () => {
        for (const status of ["INCOMPLETE", "BLOCKED"]) {
            expect(classifyReportValidation({
                valid: false,
                reportExists: true,
                schemaValid: true,
                status,
                modeMatches: true,
            })).toBe(FAILURE_CLASSES.AGENT_INCOMPLETE);
        }
    });

    it("distinguishes missing, invalid, write-failed and accepted reports", () => {
        expect(classifyReportValidation({reportExists: false})).toBe(FAILURE_CLASSES.REPORT_MISSING);
        expect(classifyReportValidation({reportExists: true, ioFailure: true})).toBe(FAILURE_CLASSES.REPORT_WRITE_FAILED);
        expect(classifyReportValidation({reportExists: true, schemaValid: false, modeMatches: false})).toBe(FAILURE_CLASSES.REPORT_INVALID);
        expect(classifyReportValidation({valid: true, reportExists: true, schemaValid: true, status: "COMPLETE", modeMatches: true})).toBeNull();
    });
});
