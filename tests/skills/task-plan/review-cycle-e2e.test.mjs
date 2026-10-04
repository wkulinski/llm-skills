import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {it} from "vitest";

import {editPlan} from "../../../.agents/skills/task-plan/scripts/edit.mjs";
import {
    buildDeltaReviewInput,
    buildDeltaReviewInputFromPlan,
    decideReviewCycle,
    REVIEW_ACTIONS,
} from "../../../.agents/skills/task-plan/scripts/review-cycle.mjs";
import {normalizeUserInput, persistSource} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {loadPlan, loadPlanFile, recordReview, savePlan} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {parsePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";

const NOW = "2026-09-16T12:00:00.000Z";

function planBody() {
    return `# Review cycle integration plan

## Source and objective

Exercise the bounded review cycle against the real plan write path.

## Source assessment

- Requested outcome: One owner action follows from explicit review data.
- Observed symptoms: The cycle currently has no mechanical integration test.
- Explicit constraints: Do not duplicate the unit decision matrix.
- Suggested diagnosis or solution: Combine the helper with the real write path.
- Claims verified in evidence: The store owns persistence.
- Claims corrected or still unverified: No claim was corrected; every claim is backed by the listed evidence.

## Scope

The review cycle end to end is in scope. Unrelated refactors are out of scope.

## Direction, simplicity and consistency

- Existing mechanism reused: The canonical store and structural editor remain owners.
- Simpler alternative considered: A fixture-only test would not touch the write path.
- Why the selected approach is minimal: One integration file reuses existing helpers.
- Duplicate or parallel responsibilities: None; the helper stays stateless.
- Cross-WP consistency and ownership: WP1 is the only package.

## Source coverage

- Point 1: WP1

## Work packages

### WP1 — Integrate the review cycle

- Source: Point 1
- Goal: Exercise the bounded review cycle end to end.
- Scope: One package field.
- Out of scope: Unrelated cleanup.
- Confirmed paths: .agents/skills/task-plan/scripts/store.mjs
- Candidate paths: none
- Discovery required: none
- Estimated size: medium
- Acceptance criteria: The cycle stops, repairs once, or blocks with evidence.
- Verification: Run the focused integration test.

## Order

WP1: independent.

## Decisions and open questions

No open questions.

## Risks and discovery debt

No known discovery debt.

## Acceptance and verification

Run the focused integration test.

## Execution environment

- Default model: openai/gpt-5.6-sol
- Default reasoning: medium
- WP overrides: none

## Execution

- [ ] WP1
`;
}

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-cycle-e2e-"));
    const configDir = path.join(root, ".agents", "config");
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), `${JSON.stringify({
        version: 1,
        order: "strongest-to-weakest",
        profiles: [
            {model: "deepseek/deepseek-v4", reasoning: "high"},
            {model: "openai/gpt-5.6-sol", reasoning: "medium"},
        ],
    }, null, 2)}\n`, "utf8");
    const identity = `test/review-cycle/${path.basename(root)}`;
    const source = normalizeUserInput({body: "review cycle fixture", identity}, {fetched_at: NOW});
    persistSource(source, {repoRoot: root});
    const saved = savePlan({
        repo_root: root,
        source_identity: identity,
        plan_id: source.plan_id,
        markdown_body: planBody(),
        context: null,
        updated_at: NOW,
    }, {verbose: true, now: NOW});
    return {root, identity, saved, planPath: saved.paths.draft_path};
}

function cleanup(fixture) {
    fs.rmSync(fixture.root, {recursive: true, force: true});
}

function snapshot(fixture) {
    const loaded = loadPlan({repoRoot: fixture.root, sourceIdentity: fixture.identity, fsOps: fs});
    return {
        revision: loaded.metadata.revision,
        content_sha256: loaded.content_sha256,
        markdown: loaded.markdown,
        body: parsePlanDocument(loaded.markdown).body,
    };
}

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
        severity: "MINOR",
        actionable: true,
        repair_attempts: 0,
        ...overrides,
    };
}

function deltaBetween(fixture, base, current, overrides = {}) {
    const built = buildDeltaReviewInput({
        plan_id: fixture.saved.plan_id,
        base_revision: base.revision,
        current_revision: current.revision,
        base_sha256: base.content_sha256,
        current_sha256: current.content_sha256,
        changed_sections: ["Work packages"],
        changed_work_packages: ["WP1"],
        previous_finding_ids: ["F1"],
        allowed_direct_dependencies: ["Acceptance and verification"],
        ...overrides,
    });
    assert.equal(built.ok, true, JSON.stringify(built.errors));
    return built.delta_review;
}

it("stops on READY without writing the plan or opening a round", () => {
    const fixture = createFixture();
    try {
        const before = snapshot(fixture);
        const decision = decideReviewCycle(reviewInput({plan: planReference(fixture, before)}));

        assert.equal(decision.action, REVIEW_ACTIONS.FINISH_READY);
        assert.equal(decision.reason, "plan-ready");

        const after = snapshot(fixture);
        assert.equal(after.revision, before.revision);
        assert.equal(after.content_sha256, before.content_sha256);
        assert.equal(after.markdown, before.markdown);
    } finally {
        cleanup(fixture);
    }
});

it("turns an actionable MINOR into one coherent revision and allows a delta round", () => {
    const fixture = createFixture();
    try {
        const before = snapshot(fixture);
        const initial = decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            findings: [finding()],
            plan: planReference(fixture, before),
        }));
        assert.equal(initial.action, REVIEW_ACTIONS.APPLY_REPAIR);
        assert.deepEqual(initial.actionable_finding_ids, ["F1"]);

        const repaired = editPlan({
            file: fixture.planPath,
            operations: [
                {
                    type: "edit-bullet",
                    work_package: "WP1",
                    id: "Goal",
                    value: "Exercise the bounded review cycle after one repair.",
                },
            ],
        }, {repoRoot: fixture.root});
        assert.equal(repaired.changed, true);
        assert.equal(repaired.revision, before.revision + 1);
        assert.deepEqual(repaired.changed_work_packages, ["WP1"]);

        const after = snapshot(fixture);
        assert.notEqual(after.content_sha256, before.content_sha256);

        const decision = decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            delta_review_count: 1,
            findings: [finding({
                id: "F2",
                repair_attempts: 0,
                provenance: {
                    kind: "changed_work_package",
                    target: "WP1",
                    evidence: "The repaired goal text now contradicts the acceptance criteria.",
                },
            })],
            previous_findings: [{id: "F1", severity: "MAJOR"}],
            previous_resolutions: [{id: "F1", status: "resolved"}],
            delta_review: deltaBetween(fixture, before, after),
        }));

        assert.equal(decision.ok, true);
        assert.equal(decision.action, REVIEW_ACTIONS.APPLY_REPAIR);
        assert.deepEqual(decision.actionable_finding_ids, ["F2"]);
    } finally {
        cleanup(fixture);
    }
});

it("blocks the next round when the fix made no measurable progress", () => {
    const fixture = createFixture();
    try {
        const before = snapshot(fixture);
        const repaired = editPlan({
            file: fixture.planPath,
            operation: {
                type: "edit-bullet",
                work_package: "WP1",
                id: "Scope",
                value: "One package field, still without measurable progress.",
            },
        }, {repoRoot: fixture.root});
        assert.equal(repaired.changed, true);
        assert.equal(repaired.revision, before.revision + 1);
        const after = snapshot(fixture);

        const decision = decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            delta_review_count: 1,
            findings: [finding({severity: "MINOR", repair_attempts: 1})],
            previous_findings: [{id: "F1", severity: "MINOR"}],
            previous_resolutions: [{id: "F1", status: "current", current_severity: "MINOR"}],
            delta_review: deltaBetween(fixture, before, after, {changed_sections: ["Work packages"]}),
        }));

        assert.equal(decision.action, REVIEW_ACTIONS.BLOCK);
        assert.equal(decision.reason, "no-measurable-progress");
        assert.equal(snapshot(fixture).content_sha256, after.content_sha256);
    } finally {
        cleanup(fixture);
    }
});

it("blocks a finding that survived two repair attempts", () => {
    const fixture = createFixture();
    try {
        const before = snapshot(fixture);
        const decision = decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            findings: [finding({repair_attempts: 2})],
            plan: planReference(fixture, before),
        }));

        assert.equal(decision.action, REVIEW_ACTIONS.BLOCK);
        assert.equal(decision.reason, "finding-survived-two-repair-attempts");
        assert.equal(snapshot(fixture).content_sha256, before.content_sha256);
    } finally {
        cleanup(fixture);
    }
});

it("blocks the fourth delta review at the budget boundary", () => {
    const fixture = createFixture();
    try {
        const before = snapshot(fixture);
        const repaired = editPlan({
            file: fixture.planPath,
            operation: {
                type: "edit-bullet",
                work_package: "WP1",
                id: "Scope",
                value: "One package field at the delta budget boundary.",
            },
        }, {repoRoot: fixture.root});
        assert.equal(repaired.revision, before.revision + 1);
        const after = snapshot(fixture);

        const decision = decideReviewCycle(reviewInput({
            verdict: "PLAN CHANGES REQUESTED",
            delta_review_count: 3,
            findings: [finding({
                id: "F2",
                repair_attempts: 0,
                provenance: {
                    kind: "changed_work_package",
                    target: "WP1",
                    evidence: "The boundary edit exposes a new contradiction with the acceptance criteria.",
                },
            })],
            previous_findings: [{id: "F1", severity: "MAJOR"}],
            previous_resolutions: [{id: "F1", status: "resolved"}],
            delta_review: deltaBetween(fixture, before, after),
        }));

        assert.equal(decision.action, REVIEW_ACTIONS.BLOCK);
        assert.equal(decision.reason, "delta-review-budget-exhausted");
        assert.equal(snapshot(fixture).content_sha256, after.content_sha256);
    } finally {
        cleanup(fixture);
    }
});

it("keeps the full save token bound to the transformation base", () => {
    const fixture = createFixture();
    try {
        const before = snapshot(fixture);
        const body = before.body.replace(
            "- Goal: Exercise the bounded review cycle end to end.",
            "- Goal: Persist from the transformation base only.",
        );
        assert.notEqual(body, before.body);

        assert.throws(
            () => savePlan({
                repo_root: fixture.root,
                source_identity: fixture.identity,
                plan_id: fixture.saved.plan_id,
                markdown_body: body,
                context: null,
                expected_revision: before.revision,
                base_sha256: "0".repeat(64),
            }, {now: NOW}),
            (error) => error.code === "PLAN_CONFLICT",
        );
        assert.equal(snapshot(fixture).content_sha256, before.content_sha256);

        const saved = savePlan({
            repo_root: fixture.root,
            source_identity: fixture.identity,
            plan_id: fixture.saved.plan_id,
            markdown_body: body,
            context: null,
            expected_revision: before.revision,
            base_sha256: before.content_sha256,
        }, {now: NOW});

        assert.equal(saved.changed, true);
        assert.equal(saved.revision, before.revision + 1);
        const pending = loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath});
        assert.equal(pending.status, "blocked");
        assert.equal(pending.validation.blocked_reason, "review_pending");
        recordReview({
            repoRoot: fixture.root,
            planPath: fixture.planPath,
            decision: decideReviewCycle(reviewInput({plan: planReference(fixture, snapshot(fixture))})),
        });
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "ready");
    } finally {
        cleanup(fixture);
    }
});

const REVIEW_CYCLE_SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/task-plan/scripts/review-cycle.mjs");

function planReference(fixture, state) {
    return {plan_id: fixture.saved.plan_id, revision: state.revision, content_sha256: state.content_sha256};
}

/** Record a full review of the current revision that requests one repair. */
function recordRepairReview(fixture) {
    const reviewed = snapshot(fixture);
    const decision = decideReviewCycle(reviewInput({
        verdict: "PLAN CHANGES REQUESTED",
        findings: [finding()],
        plan: planReference(fixture, reviewed),
    }));
    assert.equal(decision.action, REVIEW_ACTIONS.APPLY_REPAIR);
    recordReview({repoRoot: fixture.root, planPath: fixture.planPath, decision});
    return reviewed;
}

function repairGoal(fixture, value = "Exercise the bounded review cycle after one repair.") {
    return editPlan({
        file: fixture.planPath,
        operation: {type: "edit-bullet", work_package: "WP1", id: "Goal", value},
    }, {repoRoot: fixture.root});
}

function semanticDeltaInput(overrides = {}) {
    return {
        changed_sections: ["Work packages"],
        changed_work_packages: ["WP1"],
        previous_finding_ids: ["F1"],
        allowed_direct_dependencies: ["Acceptance and verification"],
        ...overrides,
    };
}

it("opens a new cycle after a question, its answer and a plan change and reaches ready", () => {
    const fixture = createFixture();
    try {
        const asked = decideReviewCycle(reviewInput({
            verdict: "PLAN DISCUSS",
            findings: [{
                id: "F1",
                classification: "QUESTION",
                severity: null,
                actionable: false,
                approval_affecting: true,
                repair_attempts: 0,
            }],
            plan: planReference(fixture, snapshot(fixture)),
        }));
        assert.equal(asked.action, REVIEW_ACTIONS.BLOCK);
        assert.equal(asked.reason, "approval-decision-required");
        recordReview({repoRoot: fixture.root, planPath: fixture.planPath, decision: asked});
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "blocked");

        repairGoal(fixture, "Exercise the bounded review cycle as answered in Q1.");

        const built = buildDeltaReviewInputFromPlan({
            repoRoot: fixture.root,
            planPath: fixture.planPath,
            input: semanticDeltaInput(),
        });
        assert.equal(built.ok, true, JSON.stringify(built.errors));
        const decision = decideReviewCycle(reviewInput({
            verdict: "PLAN READY",
            delta_review_count: 1,
            previous_findings: [{id: "F1", classification: "QUESTION"}],
            previous_resolutions: [{id: "F1", status: "accepted", decision_ref: "Q1"}],
            delta_review: built.delta_review,
        }));
        assert.equal(decision.action, REVIEW_ACTIONS.FINISH_READY);
        assert.equal(decision.ok, true, JSON.stringify(decision.errors));

        recordReview({repoRoot: fixture.root, planPath: fixture.planPath, decision});
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "ready");
    } finally {
        cleanup(fixture);
    }
});

it("derives delta input from the last recorded review so the base hash cannot be lost", () => {
    const fixture = createFixture();
    try {
        const reviewed = recordRepairReview(fixture);
        repairGoal(fixture);
        const after = snapshot(fixture);

        const built = buildDeltaReviewInputFromPlan({repoRoot: fixture.root, planPath: fixture.planPath, input: semanticDeltaInput()});
        assert.equal(built.ok, true, JSON.stringify(built.errors));
        assert.deepEqual(built.delta_review, deltaBetween(fixture, reviewed, after));
        assert.deepEqual(built.sources, {base_sha256: "plan", current_sha256: "plan"});

        const input = path.join(fixture.root, "delta.json");
        fs.writeFileSync(input, JSON.stringify(semanticDeltaInput()), "utf8");
        const cli = spawnSync(process.execPath, [
            REVIEW_CYCLE_SCRIPT, "delta-input", "--file", fixture.planPath, "--root", fixture.root, "--input", input,
        ], {encoding: "utf8"});
        assert.equal(cli.status, 0, cli.stderr);
        assert.deepEqual(JSON.parse(cli.stdout).delta_review, built.delta_review);
    } finally {
        cleanup(fixture);
    }
});

it("covers a repair saved in several revisions with one delta from the reviewed revision", () => {
    const fixture = createFixture();
    try {
        const reviewed = recordRepairReview(fixture);
        repairGoal(fixture, "First part of the repair.");
        repairGoal(fixture, "Second part of the repair.");
        const after = snapshot(fixture);
        assert.equal(after.revision, reviewed.revision + 2);

        const built = buildDeltaReviewInputFromPlan({repoRoot: fixture.root, planPath: fixture.planPath, input: semanticDeltaInput()});
        assert.equal(built.ok, true, JSON.stringify(built.errors));
        assert.equal(built.delta_review.base_revision, reviewed.revision);
        assert.equal(built.delta_review.base_sha256, reviewed.content_sha256);
        assert.equal(built.delta_review.current_revision, after.revision);
        assert.equal(built.delta_review.current_sha256, after.content_sha256);
    } finally {
        cleanup(fixture);
    }
});

it("fails hard instead of inferring delta input without a recorded review", () => {
    const fixture = createFixture();
    try {
        repairGoal(fixture);
        assert.throws(
            () => buildDeltaReviewInputFromPlan({repoRoot: fixture.root, planPath: fixture.planPath, input: semanticDeltaInput()}),
            (error) => error.code === "DELTA_BASE_UNAVAILABLE",
        );

        recordRepairReview(fixture);
        assert.throws(
            () => buildDeltaReviewInputFromPlan({repoRoot: fixture.root, planPath: fixture.planPath, input: semanticDeltaInput()}),
            (error) => error.code === "DELTA_NOTHING_TO_REVIEW",
        );

        repairGoal(fixture, "Repair after the recorded review.");
        const markdown = fs.readFileSync(path.join(fixture.root, fixture.planPath), "utf8");
        fs.writeFileSync(path.join(fixture.root, fixture.planPath), markdown.replace(/^review_base_sha256: .*\n/m, ""), "utf8");
        assert.throws(
            () => buildDeltaReviewInputFromPlan({repoRoot: fixture.root, planPath: fixture.planPath, input: semanticDeltaInput()}),
            (error) => error.code === "DELTA_BASE_HASH_MISSING",
        );

        const input = path.join(fixture.root, "delta.json");
        fs.writeFileSync(input, JSON.stringify(semanticDeltaInput()), "utf8");
        const cli = spawnSync(process.execPath, [
            REVIEW_CYCLE_SCRIPT, "delta-input", "--file", fixture.planPath, "--root", fixture.root, "--input", input,
        ], {encoding: "utf8"});
        assert.equal(cli.status, 2);
        assert.equal(cli.stdout, "");
        assert.equal(JSON.parse(cli.stderr).error, "DELTA_BASE_HASH_MISSING");
    } finally {
        cleanup(fixture);
    }
});

it("keeps explicit hash input as an override and rejects contradictory revisions", () => {
    const fixture = createFixture();
    try {
        recordRepairReview(fixture);
        repairGoal(fixture);
        const override = "a".repeat(64);
        const built = buildDeltaReviewInputFromPlan({
            repoRoot: fixture.root,
            planPath: fixture.planPath,
            input: semanticDeltaInput({base_sha256: override}),
        });
        assert.equal(built.ok, true, JSON.stringify(built.errors));
        assert.equal(built.delta_review.base_sha256, override);
        assert.deepEqual(built.sources, {base_sha256: "input-override", current_sha256: "plan"});

        assert.throws(
            () => buildDeltaReviewInputFromPlan({
                repoRoot: fixture.root,
                planPath: fixture.planPath,
                input: semanticDeltaInput({base_revision: 7}),
            }),
            (error) => error.code === "DELTA_INPUT_CONFLICT",
        );
    } finally {
        cleanup(fixture);
    }
});

it("walks the whole review cycle through to a recorded ready decision", () => {
    const fixture = createFixture();
    try {
        recordRepairReview(fixture);
        const repaired = repairGoal(fixture);
        assert.equal(repaired.status, "blocked");
        assert.equal(repaired.blocked_reason, "review_pending");

        const delta = buildDeltaReviewInputFromPlan({repoRoot: fixture.root, planPath: fixture.planPath, input: semanticDeltaInput()});
        const decision = decideReviewCycle(reviewInput({
            delta_review_count: 1,
            previous_findings: [{id: "F1", severity: "MINOR"}],
            previous_resolutions: [{id: "F1", status: "resolved"}],
            delta_review: delta.delta_review,
        }));
        assert.equal(decision.action, REVIEW_ACTIONS.FINISH_READY);
        assert.deepEqual(decision.plan, {
            plan_id: fixture.saved.plan_id,
            revision: repaired.revision,
            content_sha256: delta.delta_review.current_sha256,
        });

        const recorded = recordReview({repoRoot: fixture.root, planPath: fixture.planPath, decision});
        assert.equal(recorded.status, "ready");
        assert.equal(recorded.reviewed_revision, repaired.revision);
        assert.equal(recorded.review_base_revision, repaired.revision);
    } finally {
        cleanup(fixture);
    }
});
