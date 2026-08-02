import {describe, expect, it} from "vitest";

import {
    buildFallbackPrompt,
    buildScoutPrompt,
    isReportValid,
    parseArgs,
    parseJsonEvents,
    shouldRunFallback,
    summarizeResult,
} from "../../../.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-fast.mjs";

describe("parseArgs", () => {
    it("applies safe defaults", () => {
        const options = parseArgs([]);
        expect(options.variants).toEqual(["a", "b", "c"]);
        expect(options.repetitions).toBe(3);
        expect(options.concurrency).toBe(1);
        expect(options.fallback).toBe(true);
        expect(options.snapshotDir).toBe(null);
    });

    it("parses --variants, --fallback false and --concurrency 2", () => {
        const options = parseArgs(["--variants", "a,c,x", "--fallback", "false", "--concurrency", "2", "--repetitions", "4"]);
        expect(options.variants).toEqual(["a", "c", "x"]);
        expect(options.fallback).toBe(false);
        expect(options.concurrency).toBe(2);
        expect(options.repetitions).toBe(4);
    });

    it("rejects concurrency above 2", () => {
        expect(() => parseArgs(["--concurrency", "3"])).toThrow(/concurrency/);
    });

    it("rejects an unknown flag", () => {
        expect(() => parseArgs(["--bogus", "x"])).toThrow(/Unknown argument/);
    });
});

describe("buildScoutPrompt requirements", () => {
    const base = {
        promptPath: "/fix/test-a/prompt.txt",
        manifestPath: "/fix/manifest.json",
        handoffPath: "/fix/test-a/handoff.json",
        criteriaPath: "/fix/test-a/criteria.json",
        snapshotHash: "sha256:deadbeef",
        mode: "targeted",
        criteriaJson: '{"criteria":[{"id":"C1"}]}',
        reportPath: "/out/report.json",
    };

    it("passes absolute inputs, snapshot sha, mode and criteria json", () => {
        const prompt = buildScoutPrompt(base);
        expect(prompt).toContain(base.promptPath);
        expect(prompt).toContain(base.manifestPath);
        expect(prompt).toContain(base.handoffPath);
        expect(prompt).toContain(base.criteriaPath);
        expect(prompt).toContain("Snapshot SHA-256: sha256:deadbeef");
        expect(prompt).toContain("Mode: targeted");
        expect(prompt).toContain(base.criteriaJson);
        expect(prompt).toContain(base.reportPath);
    });

    it("requires the evidence hard gate, no negative claims, compact budget and batch-render", () => {
        const prompt = buildScoutPrompt(base);
        expect(prompt).toMatch(/required_evidence/);
        expect(prompt).toMatch(/forbid_negative_claims|negative claims/i);
        expect(prompt).toMatch(/one compact finding/);
        expect(prompt).toMatch(/80 lines/);
        expect(prompt).toMatch(/batch-render/);
        expect(prompt).toMatch(/do not call task|delegate|implement|QA/i);
        expect(prompt).toMatch(/report-builder/);
        expect(prompt).toMatch(/do not fabricate/i);
    });
});

describe("buildFallbackPrompt", () => {
    const base = {
        promptPath: "/fix/test-a/prompt.txt",
        manifestPath: "/fix/manifest.json",
        handoffPath: "/fix/test-a/handoff.json",
        criteriaPath: "/fix/test-a/criteria.json",
        snapshotHash: "sha256:deadbeef",
        mode: "targeted",
        criteriaJson: '{"criteria":[{"id":"C1"}]}',
        reportPath: "/out/report.json",
    };

    it("keeps the same immutable input and evidence gate but drops the compact budget", () => {
        const prompt = buildFallbackPrompt(base);
        expect(prompt).toContain(base.promptPath);
        expect(prompt).toContain("required_evidence");
        expect(prompt).toMatch(/forbid_negative_claims|negative claims/i);
        expect(prompt).toMatch(/report-builder/);
        expect(prompt).not.toMatch(/one compact finding/);
        expect(prompt).not.toMatch(/80 lines/);
    });
});

describe("parseJsonEvents", () => {
    it("extracts session id, tool events, task tools and model steps", () => {
        const raw = [
            JSON.stringify({type: "step_start", sessionID: "ses_primary", part: {type: "step-start"}}),
            JSON.stringify({type: "tool", sessionID: "ses_primary", part: {type: "tool", tool: "read"}}),
            JSON.stringify({type: "tool", sessionID: "ses_primary", part: {type: "tool", tool: "task"}}),
            JSON.stringify({sessionID: "ses_primary", part: {type: "step-finish"}}),
            JSON.stringify({type: "tool_use", sessionID: "ses_primary", tool: "grep"}),
            JSON.stringify({type: "step_finish", sessionID: "ses_primary"}),
        ].join("\n");
        const parsed = parseJsonEvents(raw);
        expect(parsed.session_id).toBe("ses_primary");
        expect(parsed.session_ids).toEqual(["ses_primary"]);
        expect(parsed.tool_events).toBe(3);
        expect(parsed.task_tools).toBe(1);
        expect(parsed.model_steps).toBe(2);
    });

    it("survives malformed lines and empty input", () => {
        const parsed = parseJsonEvents("not json\n\n");
        expect(parsed.session_id).toBe(null);
        expect(parsed.tool_events).toBe(0);
        expect(parsed.task_tools).toBe(0);
        expect(parsed.model_steps).toBe(0);
    });
});

describe("isReportValid gate", () => {
    it("accepts a COMPLETE report with a valid schema", () => {
        expect(isReportValid({valid: true, reason: "ok"}, {status: "COMPLETE"})).toBe(true);
    });

    it("rejects a valid schema with non-COMPLETE status", () => {
        expect(isReportValid({valid: true, reason: "ok"}, {status: "BLOCKED"})).toBe(false);
    });

    it("rejects a missing report", () => {
        expect(isReportValid({valid: false, reason: "missing_report"}, null)).toBe(false);
        expect(isReportValid({valid: true, reason: "ok"}, null)).toBe(false);
    });
});

describe("shouldRunFallback (fallback-off behavior)", () => {
    it("does not run fallback when disabled even if primary is invalid", () => {
        expect(shouldRunFallback(false, false)).toBe(false);
    });

    it("runs fallback only when enabled and primary invalid", () => {
        expect(shouldRunFallback(false, true)).toBe(true);
        expect(shouldRunFallback(true, true)).toBe(false);
    });
});

describe("summarizeResult gates", () => {
    const snapshot = {fileCount: 10, sha256: "abc", unchanged: true};
    const validResult = (over = {}) => ({
        valid: true,
        final_task_tools: 0,
        primary: {session_id: "s1"},
        fallback: null,
        fallback_used: false,
        ...over,
    });

    it("passes when every final is valid, snapshot unchanged and no task tools", () => {
        const summary = summarizeResult([validResult(), validResult()], snapshot, {repetitions: 3, concurrency: 1, variants: ["a", "b", "c"]});
        expect(summary.arm).toBe("context-scout-fast");
        expect(summary.gates.valid_rate).toBe(1);
        expect(summary.gates.no_task_tools).toBe(true);
        expect(summary.gates.passed).toBe(true);
        expect(summary.snapshot).toEqual({fileCount: 10, sha256: "abc", unchanged: true});
    });

    it("fails the task-tool gate when an accepted final used task", () => {
        const summary = summarizeResult([validResult(), validResult({final_task_tools: 1})], snapshot);
        expect(summary.gates.no_task_tools).toBe(false);
        expect(summary.gates.passed).toBe(false);
    });

    it("fails when an accepted final is invalid", () => {
        const summary = summarizeResult([validResult(), validResult({valid: false})], snapshot);
        expect(summary.gates.passed).toBe(false);
    });

    it("fails when the snapshot changed", () => {
        const summary = summarizeResult([validResult()], {...snapshot, unchanged: false});
        expect(summary.gates.passed).toBe(false);
    });

    it("records fallback usage and session ids across primary and fallback", () => {
        const results = [
            validResult({primary: {session_id: "p1"}, fallback: {session_id: "f1"}, fallback_used: true}),
            validResult({primary: {session_id: "p2"}}),
        ];
        const summary = summarizeResult(results, snapshot);
        expect(summary.gates.fallback_rate).toBe(0.5);
        expect(summary.session_ids).toEqual(["f1", "p1", "p2"]);
    });
});
