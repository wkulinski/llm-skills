import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {it} from "vitest";

import {editPlan} from "../../../.agents/skills/task-plan/scripts/edit.mjs";
import {
    buildDeltaReviewInput,
    decideReviewCycle,
    REVIEW_ACTIONS,
} from "../../../.agents/skills/task-plan/scripts/review-cycle.mjs";
import {normalizeUserInput, persistSource} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {loadPlan, loadPlanFile, savePlan} from "../../../.agents/skills/task-plan/scripts/store.mjs";
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
- Claims corrected or still unverified: none.

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
        const decision = decideReviewCycle(reviewInput());

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
        assert.equal(loadPlanFile({
            repoRoot: fixture.root,
            planPath: fixture.planPath,
        }).status, "ready");
    } finally {
        cleanup(fixture);
    }
});
