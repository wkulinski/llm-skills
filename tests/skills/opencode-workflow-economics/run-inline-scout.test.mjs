import {describe, expect, it} from "vitest";

import {buildInlinePrompt, isInlineValid} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-inline-scout.mjs";

const prompt = buildInlinePrompt({
    promptPath: "/tmp/prompt.txt",
    manifestPath: "/tmp/manifest.json",
    handoffPath: "/tmp/handoff.json",
    criteriaPath: "/tmp/criteria.json",
    reportPath: "/tmp/report.json",
});

describe("inline scout task contract", () => {
    it("uses the same bounded evidence/report gates without delegation", () => {
        expect(prompt).toContain("same task envelope");
        expect(prompt).toContain("required_evidence");
        expect(prompt).toContain("batch-render");
        expect(prompt).toContain("Do not call task");
    });
});

describe("inline scout validity gate", () => {
    it("treats COMPLETE report with valid schema as valid", () => {
        expect(isInlineValid({valid: true, reason: "ok"}, {status: "COMPLETE"})).toBe(true);
    });

    it("treats BLOCKED report with valid schema as invalid", () => {
        expect(isInlineValid({valid: true, reason: "ok"}, {status: "BLOCKED"})).toBe(false);
    });

    it("treats a missing report as invalid", () => {
        expect(isInlineValid({valid: false, reason: "missing_report"}, null)).toBe(false);
        expect(isInlineValid({valid: true, reason: "ok"}, null)).toBe(false);
    });

    it("keeps the root exit gate failing for an invalid result", () => {
        const result = {
            exit_code: 0,
            delegation_tools: 0,
            valid: isInlineValid({valid: true, reason: "ok"}, {status: "BLOCKED"}),
        };
        const shouldFail = result.exit_code !== 0 || !result.valid || result.delegation_tools > 0;
        expect(result.valid).toBe(false);
        expect(shouldFail).toBe(true);
    });
});
