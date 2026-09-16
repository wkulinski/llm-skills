import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {describe, expect, it} from "vitest";

import {
    buildDeltaReviewInput,
    decideReviewCycle,
    REVIEW_ACTIONS,
    validateReviewCycleInput,
} from "../../../.agents/skills/task-plan/scripts/review-cycle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/review-cycle.mjs");
const BASE_HASH = "a".repeat(64);
const CURRENT_HASH = "b".repeat(64);

function reviewInput(overrides = {}) {
    return {
        verdict: "PLAN READY",
        full_review_count: 1,
        delta_review_count: 0,
        findings: [],
        previous_findings: [],
        previous_resolutions: [],
        ...overrides,
    };
}

function finding(overrides = {}) {
    return {
        id: "F1",
        classification: "finding",
        severity: "MAJOR",
        actionable: true,
        repair_attempts: 0,
        ...overrides,
    };
}

function suggestion(overrides = {}) {
    return {
        id: "F1",
        classification: "SUGGESTION",
        severity: null,
        actionable: false,
        repair_attempts: 0,
        ...overrides,
    };
}

function question(overrides = {}) {
    return {
        id: "F1",
        classification: "QUESTION",
        severity: null,
        actionable: false,
        approval_affecting: false,
        repair_attempts: 0,
        ...overrides,
    };
}

function deltaInput(overrides = {}) {
    return {
        plan_id: "example-plan",
        base_revision: 2,
        current_revision: 3,
        base_sha256: BASE_HASH,
        current_sha256: CURRENT_HASH,
        changed_sections: ["Work packages"],
        changed_work_packages: ["WP1"],
        previous_finding_ids: ["F1"],
        allowed_direct_dependencies: ["Acceptance and verification"],
        ...overrides,
    };
}

function laterReview(overrides = {}) {
    return reviewInput({
        verdict: "PLAN CHANGES REQUESTED",
        delta_review_count: 1,
        findings: [finding({severity: "MINOR", repair_attempts: 1})],
        previous_findings: [{id: "F1", severity: "MAJOR"}],
        previous_resolutions: [{id: "F1", status: "current", current_severity: "MINOR"}],
        delta_review: deltaInput(),
        ...overrides,
    });
}

describe("review-cycle decision table", () => {
    it.each([
        ["PLAN READY", [], REVIEW_ACTIONS.FINISH_READY, "plan-ready"],
        ["PLAN READY", [suggestion()], REVIEW_ACTIONS.FINISH_READY, "plan-ready"],
        ["PLAN READY", [question()], REVIEW_ACTIONS.FINISH_READY, "plan-ready"],
        ["PLAN READY WITH CAVEAT", [finding({severity: "MINOR", actionable: false})], REVIEW_ACTIONS.FINISH_READY, "nonactionable-or-accepted-caveat"],
        ["PLAN READY WITH CAVEAT", [finding({severity: "MINOR", accepted_decision_ref: "current conversation: Q1"})], REVIEW_ACTIONS.FINISH_READY, "nonactionable-or-accepted-caveat"],
        ["PLAN DISCUSS", [question({approval_affecting: true})], REVIEW_ACTIONS.BLOCK, "approval-decision-required"],
        ["PLAN BLOCKED", [finding({severity: "BLOCKER"})], REVIEW_ACTIONS.BLOCK, "review-blocked"],
        ["PLAN CHANGES REQUESTED", [finding({severity: "MINOR"})], REVIEW_ACTIONS.APPLY_REPAIR, "repair-all-actionable-findings"],
    ])("maps %s to one owner action", (verdict, findings, action, reason) => {
        expect(decideReviewCycle(reviewInput({verdict, findings}))).toMatchObject({
            ok: true,
            action,
            reason,
        });
    });

    it("does not hide an actionable MINOR behind a caveat", () => {
        expect(decideReviewCycle(reviewInput({
            verdict: "PLAN READY WITH CAVEAT",
            findings: [finding({severity: "MINOR"})],
        }))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "caveat-has-actionable-findings",
            actionable_finding_ids: ["F1"],
        });
    });

    it("blocks an approval-affecting question even under PLAN READY", () => {
        expect(decideReviewCycle(reviewInput({
            findings: [question({approval_affecting: true})],
        }))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "approval-decision-required",
        });
    });

    it("requires actionable findings for PLAN CHANGES REQUESTED", () => {
        expect(decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            findings: [suggestion()],
        }))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "changes-requested-without-actionable-findings",
        });
    });
});

describe("review-cycle budget and progress gate", () => {
    it("allows the first coherent repair without fictional previous progress", () => {
        expect(decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            findings: [finding()],
        }))).toMatchObject({
            action: REVIEW_ACTIONS.APPLY_REPAIR,
            actionable_finding_ids: ["F1"],
        });
    });

    it("allows a later repair when one previous severity falls and none worsen", () => {
        expect(decideReviewCycle(laterReview())).toMatchObject({
            ok: true,
            action: REVIEW_ACTIONS.APPLY_REPAIR,
        });
    });

    it("blocks a later repair without measurable progress", () => {
        expect(decideReviewCycle(laterReview({
            findings: [finding({repair_attempts: 1})],
            previous_resolutions: [{id: "F1", status: "current", current_severity: "MAJOR"}],
        }))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "no-measurable-progress",
        });
    });

    it("blocks progress that worsens another previous finding", () => {
        expect(decideReviewCycle(laterReview({
            findings: [
                finding({id: "F1", severity: "MINOR", repair_attempts: 1}),
                finding({id: "F2", severity: "MAJOR", repair_attempts: 1}),
            ],
            previous_findings: [
                {id: "F1", severity: "MAJOR"},
                {id: "F2", severity: "MINOR"},
            ],
            previous_resolutions: [
                {id: "F1", status: "current", current_severity: "MINOR"},
                {id: "F2", status: "current", current_severity: "MAJOR"},
            ],
            delta_review: deltaInput({previous_finding_ids: ["F1", "F2"]}),
        }))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "previous-finding-worsened",
        });
    });

    it("blocks a finding after two repair attempts", () => {
        expect(decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            findings: [finding({repair_attempts: 2})],
        }))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "finding-survived-two-repair-attempts",
        });
    });

    it("blocks before a fourth delta review", () => {
        expect(decideReviewCycle(laterReview({delta_review_count: 3}))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "delta-review-budget-exhausted",
        });
    });

    it("blocks the same failure mode without explicit new evidence", () => {
        expect(decideReviewCycle(laterReview({
            findings: [finding({
                severity: "MINOR",
                repair_attempts: 1,
                previous_id: "F1",
                recurrence: {same_failure_mode: true, new_evidence: false},
            })],
        }))).toMatchObject({
            action: REVIEW_ACTIONS.BLOCK,
            reason: "recurrence-without-new-evidence",
        });
    });

    it("requires an explicit recurrence assessment whenever a finding links to a previous id", () => {
        const result = decideReviewCycle(laterReview({
            findings: [finding({
                id: "F2",
                previous_id: "F1",
                severity: "MINOR",
                repair_attempts: 1,
            })],
        }));

        expect(result).toMatchObject({action: REVIEW_ACTIONS.BLOCK, reason: "invalid-review-input"});
        expect(result.errors.map((entry) => entry.code)).toContain("MISSING_RECURRENCE_ASSESSMENT");
    });

    it("accepts an explicitly evidenced recurrence when the progress gate also passes", () => {
        expect(decideReviewCycle(laterReview({
            findings: [finding({
                severity: "MINOR",
                repair_attempts: 1,
                previous_id: "F1",
                recurrence: {
                    same_failure_mode: true,
                    new_evidence: true,
                    evidence: "The revised WP now exposes a new conflicting constraint.",
                },
            })],
        }))).toMatchObject({
            ok: true,
            action: REVIEW_ACTIONS.APPLY_REPAIR,
        });
    });

    it("treats a different failure mode linked to an old id as a new finding", () => {
        const result = decideReviewCycle(laterReview({
            findings: [finding({
                id: "F2",
                severity: "MINOR",
                repair_attempts: 0,
                previous_id: "F1",
                recurrence: {same_failure_mode: false, new_evidence: false},
            })],
            previous_resolutions: [{id: "F1", status: "resolved"}],
        }));

        expect(result).toMatchObject({action: REVIEW_ACTIONS.BLOCK, reason: "invalid-review-input"});
        expect(result.errors.map((entry) => entry.code)).toContain("MISSING_FINDING_PROVENANCE");
    });

    it.each([
        ["requires_user_decision", "repair-requires-user-decision"],
        ["requires_external_evidence", "repair-requires-external-evidence"],
    ])("blocks when an actionable repair %s", (flag, reason) => {
        expect(decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            findings: [finding({[flag]: true})],
        }))).toMatchObject({action: REVIEW_ACTIONS.BLOCK, reason});
    });
});

describe("review-cycle completeness and delta provenance", () => {
    it("blocks malformed top-level input instead of throwing", () => {
        expect(decideReviewCycle(null)).toMatchObject({
            ok: false,
            action: REVIEW_ACTIONS.BLOCK,
            reason: "invalid-review-input",
        });
    });

    it("does not treat an omitted previous id as resolved", () => {
        const result = decideReviewCycle(laterReview({previous_resolutions: []}));

        expect(result).toMatchObject({action: REVIEW_ACTIONS.BLOCK, reason: "invalid-review-input"});
        expect(result.errors.map((entry) => entry.code)).toContain("MISSING_PREVIOUS_RESOLUTION");
    });

    it("requires the delta artifact to carry every previous finding id", () => {
        const result = decideReviewCycle(laterReview({
            delta_review: deltaInput({previous_finding_ids: []}),
        }));

        expect(result).toMatchObject({action: REVIEW_ACTIONS.BLOCK, reason: "invalid-review-input"});
        expect(result.errors.map((entry) => entry.code)).toEqual(expect.arrayContaining([
            "EMPTY_PREVIOUS_FINDINGS",
            "DELTA_MISSING_PREVIOUS_ID",
        ]));
    });

    it("rejects duplicate and unknown finding references", () => {
        const errors = validateReviewCycleInput(laterReview({
            findings: [finding(), finding()],
            previous_resolutions: [{id: "F2", status: "resolved"}],
        }));

        expect(errors.map((entry) => entry.code)).toEqual(expect.arrayContaining([
            "DUPLICATE_FINDING_ID",
            "MISSING_PREVIOUS_RESOLUTION",
            "UNKNOWN_PREVIOUS_RESOLUTION",
        ]));
    });

    it("does not let document hashes stand in for new-finding provenance", () => {
        const result = decideReviewCycle(laterReview({
            findings: [finding({id: "F2", severity: "MAJOR", repair_attempts: 0})],
            previous_resolutions: [{id: "F1", status: "resolved"}],
            delta_review: deltaInput({
                base_sha256: "c".repeat(64),
                current_sha256: "d".repeat(64),
            }),
        }));

        expect(result).toMatchObject({action: REVIEW_ACTIONS.BLOCK, reason: "invalid-review-input"});
        expect(result.errors.map((entry) => entry.code)).toContain("MISSING_FINDING_PROVENANCE");
    });

    it("rejects an unchanged or skipped revision as a delta artifact", () => {
        const unchanged = validateReviewCycleInput(laterReview({
            delta_review: deltaInput({current_sha256: BASE_HASH}),
        }));
        expect(unchanged.map((entry) => entry.code)).toContain("UNCHANGED_DELTA_DOCUMENT");

        const skipped = validateReviewCycleInput(laterReview({
            delta_review: deltaInput({current_revision: 4}),
        }));
        expect(skipped.map((entry) => entry.code)).toContain("NON_SEQUENTIAL_DELTA_REVISION");
    });

    it("allows a new actionable finding only from a declared changed area or dependency", () => {
        const result = decideReviewCycle(laterReview({
            findings: [finding({
                id: "F2",
                severity: "MAJOR",
                repair_attempts: 0,
                provenance: {
                    kind: "direct_dependency",
                    target: "Acceptance and verification",
                    evidence: "The WP change makes the dependency contradiction reachable.",
                },
            })],
            previous_resolutions: [{id: "F1", status: "resolved"}],
        }));

        expect(result).toMatchObject({ok: true, action: REVIEW_ACTIONS.APPLY_REPAIR});
    });

    it("rejects provenance outside the explicit delta scope", () => {
        const result = decideReviewCycle(laterReview({
            findings: [finding({
                id: "F2",
                severity: "MINOR",
                repair_attempts: 0,
                provenance: {
                    kind: "changed_section",
                    target: "Unchanged section",
                    evidence: "A claimed origin that is not in the delta.",
                },
            })],
            previous_resolutions: [{id: "F1", status: "resolved"}],
        }));

        expect(result.errors.map((entry) => entry.code)).toContain("PROVENANCE_OUTSIDE_DELTA");
        expect(result.action).toBe(REVIEW_ACTIONS.BLOCK);
    });

    it("builds the minimal delta artifact without interpreting document hashes", () => {
        const input = deltaInput();

        expect(buildDeltaReviewInput(input)).toEqual({
            ok: true,
            delta_review: input,
            errors: [],
        });
    });
});

describe("review-cycle CLI", () => {
    it("reads JSON from stdin and does not persist cycle state", () => {
        const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "review-cycle-cli-"));
        const before = fs.readdirSync(cwd);
        const result = spawnSync(process.execPath, [SCRIPT, "decide", "--input", "-"], {
            cwd,
            encoding: "utf8",
            input: JSON.stringify(reviewInput()),
        });

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
            action: REVIEW_ACTIONS.FINISH_READY,
            reason: "plan-ready",
        });
        expect(fs.readdirSync(cwd)).toEqual(before);
    });

    it("returns structured validation errors for an incomplete delta artifact", () => {
        const result = spawnSync(process.execPath, [SCRIPT, "delta-input", "--input", "-"], {
            cwd: ROOT,
            encoding: "utf8",
            input: JSON.stringify({plan_id: "example-plan"}),
        });
        const output = JSON.parse(result.stdout);

        expect(result.status).toBe(0);
        expect(output.ok).toBe(false);
        expect(output.delta_review).toBeNull();
        expect(output.errors.length).toBeGreaterThan(0);
    });
});
