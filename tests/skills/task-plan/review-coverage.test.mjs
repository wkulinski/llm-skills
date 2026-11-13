import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {PLAN_REVIEW_AREAS, validatePlanReviewCoverage} from "../../../.agents/skills/task-plan/scripts/review-coverage.mjs";
import {decideReviewCycle} from "../../../.agents/skills/task-plan/scripts/review-cycle.mjs";
import {cases, prepareEvaluation, scoreEvaluation} from "../../evals/task-plan-review/evaluate.mjs";

const coverage = () => PLAN_REVIEW_AREAS.map(area => ({area, subject: `${area} subject`, outcome: "REVIEWED",
    scenario: "Trace the relevant alternate entrypoint before a write.", evidence: ["src/order.mjs:4"], gap: null}));
const codes = (rows, verdict = "PLAN READY") => validatePlanReviewCoverage(rows, verdict).map(issue => issue.code);

describe("full plan-review coverage contract", () => {
    it("requires every area but allows multiple distinct subjects in an area", () => {
        expect(codes()).toContain("REVIEW_COVERAGE_REQUIRED");
        expect(codes(coverage().slice(1))).toContain("REVIEW_COVERAGE_AREA_MISSING");
        expect(codes([...coverage(), {...coverage()[0], subject: "A second source requirement"}])).toEqual([]);
    });
    it.each([null, 1, [], {}, {area: "unknown"}, {area: "critical_assumptions", evidence: "file"}])("rejects malformed row %j without throwing", row => {
        expect(codes([...coverage(), row])).toContain("INVALID_REVIEW_COVERAGE");
    });
    it.each(["REVIEWED", "FINDING"])("requires a scenario and evidence for %s", outcome => {
        const rows = coverage();
        rows[0] = {...rows[0], outcome, scenario: "", evidence: []};
        expect(codes(rows)).toContain("REVIEW_COVERAGE_EVIDENCE_REQUIRED");
    });
    it("requires explicit reasons for omitted areas", () => {
        const rows = coverage();
        rows[2] = {...rows[2], outcome: "NOT_RELEVANT", evidence: []};
        expect(codes(rows)).toContain("REVIEW_COVERAGE_REASON_REQUIRED");
        rows[2].reason = "The plan changes one label and makes no material mechanism assumption.";
        expect(codes(rows)).toEqual([]);
    });
    it.each(["PLAN READY", "PLAN READY WITH CAVEAT"])("rejects material gap with %s, including through decide", verdict => {
        const rows = coverage();
        rows[2] = {...rows[2], outcome: "NOT_COVERED", gap: "Missing import handler.", material: true};
        expect(codes(rows, verdict)).toContain("REVIEW_COVERAGE_VERDICT_CONFLICT");
        expect(decideReviewCycle({full_review_count: 1, delta_review_count: 0, verdict, findings: [],
            previous_findings: [], previous_resolutions: [], coverage: rows,
            plan: {plan_id: "v2-example-1111aaaa", revision: 1, content_sha256: "1".repeat(64)}}))
            .toMatchObject({ok: false, action: "blocked"});
        expect(codes(rows, "PLAN DISCUSS")).toEqual([]);
    });
    it("requires a gap description and materiality, and prevents hiding gaps under REVIEWED", () => {
        const rows = coverage();
        rows[2] = {...rows[2], outcome: "NOT_COVERED", gap: ""};
        expect(codes(rows)).toContain("REVIEW_COVERAGE_GAP_REQUIRED");
        rows[2] = {...rows[2], outcome: "REVIEWED", gap: "Unknown consumer"};
        expect(codes(rows)).toContain("REVIEW_COVERAGE_GAP_CONFLICT");
    });
});

describe("plan-review evaluation fixture isolation and scoring", () => {
    const sha = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
    it("prepares six reviewer roots without oracle or sibling inputs and refuses overwriting", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-review-eval-"));
        try {
            const skills = path.join(root, "skills");
            fs.mkdirSync(path.join(skills, "task-plan/references"), {recursive: true});
            fs.mkdirSync(path.join(skills, "code-review/references"), {recursive: true});
            fs.writeFileSync(path.join(skills, "task-plan/references/external-review-task.md"), "Read <skills_root>/code-review/references/plan-review.md");
            fs.writeFileSync(path.join(skills, "code-review/references/plan-review.md"), "Trace critical assumptions.");
            const options = {output: path.join(root, "run"), skillsRoot: skills, label: "candidate",
                profile: {harness: "codex", model: "test-model", thinking: "high", mode: "read-only"}};
            const run = prepareEvaluation(options);
            expect(run.cases).toHaveLength(6);
            expect(cases.filter(row => row.expected.length === 0)).toHaveLength(1);
            for (const item of run.cases) {
                expect(fs.existsSync(path.join(item.root, "cases.json"))).toBe(false);
                expect(fs.existsSync(path.join(item.root, "run.json"))).toBe(false);
                const prompt = fs.readFileSync(path.join(item.root, "prompt.md"), "utf8");
                expect(sha(prompt)).toBe(item.prompt_sha256);
                expect(prompt).not.toContain("<skills_root>");
                expect(fs.readFileSync(path.join(item.root, "review-plan.md"), "utf8")).not.toContain("expected_ids");
            }
            expect(() => prepareEvaluation(options)).toThrow();
            const annotations = cases.map((fixture, index) => {
                const reportPath = path.join(root, `${fixture.id}-report.json`);
                const findings = fixture.expected.length ? [{id: "F1"}] : [];
                const bytes = JSON.stringify({payload: {findings}});
                fs.writeFileSync(reportPath, bytes);
                return {case_id: fixture.id, report_path: reportPath, report_sha256: sha(bytes),
                    prompt_sha256: run.cases[index].prompt_sha256, elapsed_seconds: 10, cost_usd: null,
                    findings: findings.map(finding => ({report_id: finding.id, classification: "expected",
                        expected_ids: fixture.expected.map(item => item.id), reason: "Matched concrete failure mode and source evidence."}))};
            });
            expect(scoreEvaluation(run, annotations)).toMatchObject({detected: 5, expected: 5, recall: 1,
                false_positives: 0, elapsed_seconds: 60, cost_usd: null});
            const control = annotations.at(-1);
            const bytes = JSON.stringify({payload: {findings: [{id: "F1"}]}});
            fs.writeFileSync(control.report_path, bytes);
            control.report_sha256 = sha(bytes);
            control.findings = [{report_id: "F1", classification: "false_positive", expected_ids: [], reason: "Not required by source or repository."}];
            expect(scoreEvaluation(run, annotations).false_positives).toBe(1);
            control.findings[0].classification = "other_valid";
            expect(scoreEvaluation(run, annotations)).toMatchObject({other_valid: 1, false_positives: 0});
            control.findings = [];
            expect(() => scoreEvaluation(run, annotations)).toThrow(/every reported finding/);
            control.report_sha256 = "0".repeat(64);
            expect(() => scoreEvaluation(run, annotations)).toThrow(/hash mismatch/);
        } finally { fs.rmSync(root, {recursive: true, force: true}); }
    });
});

describe("optional coverage outside independent full review", () => {
    const base = {full_review_count: 1, delta_review_count: 0, verdict: "PLAN READY", findings: [],
        previous_findings: [], previous_resolutions: [],
        plan: {plan_id: "v2-example-1111aaaa-2222bbbb", revision: 1, content_sha256: "1".repeat(64)}};
    it.each([[{}], [{coverage: null}], [{coverage: []}]])("treats %j as not supplied in decide", extra => {
        const result = decideReviewCycle({...base, ...extra});
        expect(result).toMatchObject({ok: true, action: "finish-ready"});
        expect(result).not.toHaveProperty("coverage");
    });
    it("still validates a non-empty coverage supplied to decide", () => {
        expect(decideReviewCycle({...base, coverage: [{area: "unknown"}]}).errors.map(issue => issue.code))
            .toContain("INVALID_REVIEW_COVERAGE");
    });
});
