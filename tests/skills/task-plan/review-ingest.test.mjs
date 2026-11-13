import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {prepareJob, bindSession} from "../../../.agents/skills/_shared/scripts/review-session-job.mjs";
import {describe, expect, it} from "vitest";

import {PLAN_REVIEW_AREAS} from "../../../.agents/skills/task-plan/scripts/review-coverage.mjs";

import {acceptPlanReview, decideReviewCycle, ingestExternalReview} from "../../../.agents/skills/task-plan/scripts/review-cycle.mjs";

const COVERAGE = PLAN_REVIEW_AREAS.map(area => ({area, subject: area, outcome: "REVIEWED",
    scenario: "Source requirement traced to the relevant WP and repository mechanism.", evidence: ["plan.md:10", "src/example.mjs:4"]}));

const PLAN = {plan_id: "v2-example-1111aaaa-2222bbbb", revision: 1, content_sha256: "1".repeat(64)};
const REQUEST = {full_review_count: 1, delta_review_count: 0, plan: PLAN, previous_findings: []};
const REVIEWER = {mode: "external", attempt: "1", provider: "claude", model: "claude-opus-5-5", thinking: "high", session_id: "s1"};

function requestSha(request) {
    return crypto.createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function accepted(payload, request = REQUEST, overrides = {}) {
    return {
        decision: "ACCEPTED",
        reviewer: REVIEWER,
        context_refs: [{path: "var/agent/cache/review-request.json", sha256: requestSha(request)}],
        payload,
        ...overrides,
    };
}

describe("external plan review ingest", () => {
    it("decides from the reviewer payload and the bound request", () => {
        const payload = {
            verdict: "PLAN CHANGES REQUESTED",
            findings: [{id: "F1", classification: "finding", severity: "MAJOR", actionable: true, repair_attempts: 0}],
            previous_resolutions: [],
        };
        const decision = ingestExternalReview({result: accepted(payload), request: REQUEST, requestSha256: requestSha(REQUEST)});

        expect(decision).toMatchObject({ok: true, action: "apply-repair", plan: PLAN, reviewer: REVIEWER, actionable_finding_ids: ["F1"]});
    });

    it("ignores counters and plan references smuggled into the payload", () => {
        const payload = {verdict: "PLAN READY", findings: [], previous_resolutions: [], delta_review_count: 3, plan: {...PLAN, revision: 9}};
        const decision = ingestExternalReview({result: accepted(payload), request: REQUEST, requestSha256: requestSha(REQUEST)});

        expect(decision).toMatchObject({ok: true, action: "finish-ready", plan: PLAN});
    });

    it("takes full continuation scope from the bound request, not the reviewer", () => {
        const request = {full_review_count: 2, delta_review_count: 1, review_scope: "full", plan: {...PLAN, revision: 2},
            previous_findings: [{id: "F1", severity: "MAJOR"}],
            delta_review: {plan_id: PLAN.plan_id, base_revision: 1, current_revision: 2,
                base_sha256: "2".repeat(64), current_sha256: PLAN.content_sha256,
                changed_sections: ["Work packages"], changed_work_packages: ["WP1"],
                previous_finding_ids: ["F1"], allowed_direct_dependencies: []}};
        const payload = {review_scope: "delta", verdict: "PLAN CHANGES REQUESTED",
            findings: [{id: "F2", classification: "finding", severity: "MAJOR", actionable: true, repair_attempts: 0}],
            previous_resolutions: [{id: "F1", status: "resolved"}]};
        expect(ingestExternalReview({result: accepted(payload, request), request, requestSha256: requestSha(request)}))
            .toMatchObject({ok: true, action: "apply-repair", review_scope: "full", actionable_finding_ids: ["F2"]});
    });

    it("rejects a request that was not bound to the session", () => {
        const changed = {...REQUEST, previous_findings: [{id: "F1", severity: "MAJOR"}]};
        expect(() => ingestExternalReview({result: accepted({verdict: "PLAN READY", findings: [], previous_resolutions: []}), request: changed, requestSha256: requestSha(changed)}))
            .toThrow(expect.objectContaining({code: "EXTERNAL_REQUEST_UNBOUND"}));
    });

    it("rejects a result that was not accepted", () => {
        expect(() => ingestExternalReview({result: {decision: "REJECTED"}, request: REQUEST, requestSha256: requestSha(REQUEST)}))
            .toThrow(expect.objectContaining({code: "EXTERNAL_RESULT_NOT_ACCEPTED"}));
    });

    it("blocks an incomplete reviewer payload through the normal decide validation", () => {
        const decision = ingestExternalReview({result: accepted({verdict: "PLAN READY"}), request: REQUEST, requestSha256: requestSha(REQUEST)});
        expect(decision).toMatchObject({ok: false, action: "blocked", reviewer: null});
    });
});

describe("reviewer in decide", () => {
    it("records a decision without reviewer as self review", () => {
        const decision = decideReviewCycle({...REQUEST, verdict: "PLAN READY", findings: [], previous_resolutions: []});
        expect(decision).toMatchObject({ok: true, reviewer: {mode: "self"}});
    });

    it("rejects a malformed reviewer", () => {
        const decision = decideReviewCycle({...REQUEST, verdict: "PLAN READY", findings: [], previous_resolutions: [], reviewer: {mode: "external"}});
        expect(decision.errors.map((issue) => issue.code)).toContain("INVALID_REVIEWER");
    });
});

function withSession(callback) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "plan-accept-")));
    try {
        execFileSync("git", ["init", "--quiet"], {cwd: root});
        fs.writeFileSync(path.join(root, "request.json"), JSON.stringify(REQUEST));
        fs.writeFileSync(path.join(root, "task.md"), "Review the plan.");
        fs.writeFileSync(path.join(root, "plan.md"), "---\nrevision: 1\n---\n# Plan\n");
        const prepared = prepareJob({root, prefix: "TEST_REVIEW", kind: "plan-review", jobId: crypto.randomUUID(),
            task: path.join(root, "task.md"), context: [path.join(root, "plan.md"), path.join(root, "request.json")]},
        {readConfig: () => Object.fromEntries([1, 2].flatMap(n => [
            [`TEST_REVIEW_${n}_HARNESS`, "opencode"], [`TEST_REVIEW_${n}_MODEL`, "deepseek"], [`TEST_REVIEW_${n}_THINKING`, "high"], [`TEST_REVIEW_${n}_MODE`, "build"],
        ]))});
        const jobPath = path.resolve(root, prepared.job_path);
        const inspect = {Id: "session", Provider: "opencode", Model: "deepseek", Thinking: "high", Cwd: root};
        const bind = () => bindSession({jobPath, inspect});
        const accept = payload => {
            const job = JSON.parse(fs.readFileSync(jobPath));
            return acceptPlanReview({jobPath, inspect, request: REQUEST, requestSha256: requestSha(REQUEST),
                envelopeText: JSON.stringify({version: 1, job_id: job.job_id, binding_sha256: job.binding_sha256,
                    status: "COMPLETE", report_markdown: "F1: evidence and repair details.", payload})});
        };
        callback({jobPath, bind, accept});
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
}

describe("plan session acceptance", () => {
    it("rejects malformed payload before finalizing, then accepts the next profile", () => {
        withSession(({jobPath, bind, accept}) => {
            bind();
            expect(accept({verdict: "PLAN READY"})).toMatchObject({reason: "REPORT_PAYLOAD_INVALID", next: {action: "launch", attempt: "2"}});
            expect(fs.existsSync(path.join(path.dirname(jobPath), "result.json"))).toBe(false);
            bind();
            expect(accept({verdict: "PLAN READY", findings: [], previous_resolutions: [], coverage: COVERAGE})).toMatchObject({decision: "ACCEPTED", reviewer: {attempt: "2"}});
        });
    });
    it("falls back to self when all payloads fail validation", () => {
        withSession(({bind, accept}) => {
            bind(); accept({}); bind();
            expect(accept({})).toMatchObject({reason: "REPORT_PAYLOAD_INVALID", next: {action: "self", reason: "ATTEMPTS_EXHAUSTED"}});
        });
    });
    it.each(["PLAN DISCUSS", "PLAN BLOCKED", "PLAN CHANGES REQUESTED"])("accepts valid %s without trying another profile", verdict => {
        withSession(({bind, accept}) => {
            bind();
            const findings = verdict === "PLAN CHANGES REQUESTED"
                ? [{id: "F1", classification: "finding", severity: "MAJOR", actionable: true, repair_attempts: 0}] : [];
            expect(accept({verdict, findings, previous_resolutions: [], coverage: COVERAGE})).toMatchObject({decision: "ACCEPTED", next: {action: "evaluate"}});
        });
    });
});

describe("independent review reconciliation", () => {
    const request = {...REQUEST, review_scope: "full", previous_findings: [{id: "F1", severity: "MAJOR"}]};
    const payload = {verdict: "PLAN READY", findings: [], previous_resolutions: [], coverage: COVERAGE};
    const result = accepted(payload, request, {independent_full_review: true, binding_sha256: "b".repeat(64)});
    const run = options => ingestExternalReview({result, request, requestSha256: requestSha(request), ...options});
    it("accepts independent coverage without exposing prior findings, but cannot finalize without owner evidence", () => {
        expect(run({acceptanceOnly: true})).toMatchObject({ok: true});
        expect(() => run({})).toThrow(/reconciliation/);
    });
    it("rejects historical resolutions in an independent payload before accepting the session", () => {
        expect(run({acceptanceOnly: true, result: {...result,
            payload: {...payload, previous_resolutions: [{id: "F1", status: "resolved"}]}}}))
            .toMatchObject({ok: false, errors: [{code: "INDEPENDENT_HISTORY_PRESENT"}]});
    });
    it("rejects an unbound or evidence-free reconciliation", () => {
        expect(() => run({reconciliation: {}})).toThrow(/reconciliation/);
        expect(() => run({reconciliation: {binding_sha256: result.binding_sha256,
            payload_sha256: requestSha(payload), finding_mappings: [], previous_resolutions: [{id: "F1", status: "resolved"}]}})).toThrow(/evidence/);
    });
    it("requires owner-supplied repair_attempts when a mapping links a previous finding", () => {
        const found = {...result, payload: {...payload, verdict: "PLAN CHANGES REQUESTED", findings: [{id: "F1", classification: "finding", severity: "MAJOR", actionable: true, repair_attempts: 0}]}};
        const reconcile = mapping => ({binding_sha256: found.binding_sha256, payload_sha256: requestSha(found.payload),
            finding_mappings: [mapping], previous_resolutions: [{id: "F1", status: "current", current_severity: "MAJOR", evidence: "Same defect remains in WP1."}]});
        const linked = {report_id: "F1", id: "F1", previous_id: "F1", recurrence: {same_failure_mode: true, new_evidence: true, evidence: "New trace in WP1 A2."}};
        expect(() => run({result: found, reconciliation: reconcile(linked)})).toThrow(/repair_attempts/);
        expect(run({result: found, reconciliation: reconcile({...linked, repair_attempts: 1})})).toMatchObject({ok: true, action: "apply-repair"});
    });
    it("never permits dropping an independent finding", () => {
        const found = {...result, payload: {...payload, verdict: "PLAN CHANGES REQUESTED", findings: [{id: "F1", classification: "finding", severity: "MAJOR", actionable: true, repair_attempts: 0}]}};
        expect(() => run({result: found, reconciliation: {binding_sha256: found.binding_sha256,
            payload_sha256: requestSha(found.payload), finding_mappings: [], previous_resolutions: []}})).toThrow(/exactly once/);
    });
});


it("finalizes an independent continuation only with explicit bound owner resolutions", () => {
    const request = {...REQUEST, review_scope: "full", full_review_count: 2,
        previous_findings: [{id: "F1", severity: "MAJOR"}],
        delta_review: {plan_id: PLAN.plan_id, base_revision: 1, current_revision: 2,
            base_sha256: "2".repeat(64), current_sha256: PLAN.content_sha256,
            changed_sections: ["Work packages"], changed_work_packages: ["WP1"],
            previous_finding_ids: ["F1"], allowed_direct_dependencies: []}};
    delete request.plan;
    const payload = {verdict: "PLAN READY", findings: [], previous_resolutions: [], coverage: COVERAGE};
    const result = accepted(payload, request, {independent_full_review: true, binding_sha256: "b".repeat(64)});
    const reconciliation = {binding_sha256: result.binding_sha256, payload_sha256: requestSha(payload),
        finding_mappings: [], previous_resolutions: [{id: "F1", status: "resolved", evidence: "WP1 A2 now covers the missing branch."}]};
    expect(ingestExternalReview({result, request, requestSha256: requestSha(request), reconciliation}))
        .toMatchObject({ok: true, action: "finish-ready", plan: {...PLAN, revision: 2}});
    reconciliation.previous_resolutions = [];
    expect(ingestExternalReview({result, request, requestSha256: requestSha(request), reconciliation}))
        .toMatchObject({ok: false});
});


describe("independent full review coverage acceptance", () => {
    it("rejects empty coverage before finalizing and accepts the next profile's complete report", () => {
        withSession(({jobPath, bind, accept}) => {
            bind();
            expect(accept({verdict: "PLAN READY", findings: [], previous_resolutions: []}))
                .toMatchObject({reason: "REPORT_PAYLOAD_INVALID", next: {attempt: "2"}});
            expect(fs.existsSync(path.join(path.dirname(jobPath), "result.json"))).toBe(false);
            bind();
            expect(accept({verdict: "PLAN READY", findings: [], previous_resolutions: [], coverage: COVERAGE}))
                .toMatchObject({decision: "ACCEPTED", payload: {coverage: COVERAGE}});
        });
    });
    it("does not take coverage from the owner request or reconciliation", () => {
        const request = {...REQUEST, coverage: COVERAGE};
        const payload = {verdict: "PLAN READY", findings: [], previous_resolutions: []};
        const result = accepted(payload, request, {independent_full_review: true});
        expect(ingestExternalReview({result, request, requestSha256: requestSha(request), reconciliation: {coverage: COVERAGE}}))
            .toMatchObject({ok: false, errors: [{code: "REVIEW_COVERAGE_REQUIRED"}]});
    });
    it("rechecks coverage at ingest and keeps valid evidence in the owner decision", () => {
        const payload = {verdict: "PLAN READY", findings: [], previous_resolutions: [], coverage: COVERAGE};
        const result = accepted(payload, REQUEST, {independent_full_review: true});
        expect(ingestExternalReview({result, request: REQUEST, requestSha256: requestSha(REQUEST)}))
            .toMatchObject({ok: true, action: "finish-ready", coverage: COVERAGE});
        result.payload.coverage = COVERAGE.filter(row => row.area !== "critical_assumptions");
        expect(ingestExternalReview({result, request: REQUEST, requestSha256: requestSha(REQUEST)}))
            .toMatchObject({ok: false, action: "blocked", errors: [{code: "REVIEW_COVERAGE_AREA_MISSING"}]});
    });
    it("accepts an honest material gap for discussion and never turns it into ready", () => {
        withSession(({bind, accept}) => {
            bind();
            const coverage = COVERAGE.map(row => row.area === "critical_assumptions"
                ? {...row, outcome: "NOT_COVERED", gap: "Import implementation unavailable.", material: true} : row);
            expect(accept({verdict: "PLAN DISCUSS", findings: [], previous_resolutions: [], coverage}))
                .toMatchObject({decision: "ACCEPTED", next: {action: "evaluate"}});
        });
    });
});
