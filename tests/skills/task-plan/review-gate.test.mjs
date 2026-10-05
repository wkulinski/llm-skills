import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {it} from "vitest";

import {editPlan} from "../../../.agents/skills/task-plan/scripts/edit.mjs";
import {normalizeUserInput, persistSource} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {
    completeWorkPackage,
    loadPlanFile,
    recordReview,
    savePlan,
    StoreError,
} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {parsePlanDocument, validatePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";

const NOW = "2026-10-02T12:00:00.000Z";
const FINISH_READY = {ok: true, action: "finish-ready", reason: "plan-ready", actionable_finding_ids: [], errors: []};
const STORE_SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/task-plan/scripts/store.mjs");

function planBody() {
    return `# Review gate plan

## Execution

- [ ] WP1

## Work package summaries

- WP1 — Gate: Binds plan readiness to a recorded review decision, verifies the gate, and leaves unrelated cleanup untouched.

## Source and objective

Exercise the review gate.

## Source assessment

- Requested outcome: Ready requires a recorded review.
- Observed symptoms: A plan became ready without a review.
- Explicit constraints: Data stays in the plan front matter.
- Suggested diagnosis or solution: Record the decision in the plan.
- Claims verified in evidence: The store owns persistence.
- Claims corrected or still unverified: No claim was corrected; every claim is backed by the listed evidence.

## Scope

The review gate is in scope.

## Direction, simplicity and consistency

- Existing mechanism reused: The canonical store.
- Simpler alternative considered: A sidecar file.
- Why the selected approach is minimal: Two front matter keys.
- Duplicate or parallel responsibilities: The store stays the only owner of review persistence.
- Cross-WP consistency and ownership: WP1 is the only package.

## Source coverage

- Point 1: WP1

## Work packages

### WP1 — Gate

- Source: Point 1
- Goal: Gate readiness on a recorded review.
- Scope: One package field.
- Out of scope: Unrelated cleanup.
- Confirmed paths: .agents/skills/task-plan/scripts/store.mjs
- Candidate paths: none
- Discovery required: none
- Estimated size: medium
- Acceptance criteria: The gate holds.
- Verification: Run the focused test.

## Order

WP1: independent.

## Decisions and open questions

No open questions.

## Risks and discovery debt

No known discovery debt.

## Acceptance and verification

Run the focused test.

## Execution environment

- Default model: openai/gpt-5.6-sol
- Default reasoning: medium
- WP overrides: none
`;
}

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-gate-"));
    const configDir = path.join(root, ".agents", "config");
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), `${JSON.stringify({
        version: 1,
        order: "strongest-to-weakest",
        profiles: [{model: "openai/gpt-5.6-sol", reasoning: "medium"}],
    }, null, 2)}\n`, "utf8");
    const identity = `test/review-gate/${path.basename(root)}`;
    persistSource(normalizeUserInput({body: "review gate fixture", identity}, {fetched_at: NOW}), {repoRoot: root});
    const saved = savePlan({
        repo_root: root,
        source_identity: identity,
        markdown_body: planBody(),
        context: null,
    }, {now: NOW, verbose: true});
    return {root, identity, saved, planPath: saved.paths.draft_path};
}

function withFixture(callback) {
    const fixture = createFixture();
    try {
        callback(fixture);
    } finally {
        fs.rmSync(fixture.root, {recursive: true, force: true});
    }
}

function read(fixture) {
    return fs.readFileSync(path.join(fixture.root, fixture.planPath), "utf8");
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function planReference(fixture) {
    const markdown = read(fixture);
    const metadata = parsePlanDocument(markdown).metadata;
    return {plan_id: metadata.plan_id, revision: metadata.revision, content_sha256: sha256(markdown)};
}

function bound(fixture, decision = FINISH_READY) {
    return {...decision, plan: planReference(fixture)};
}

function record(fixture, decision = bound(fixture)) {
    return recordReview({repoRoot: fixture.root, planPath: fixture.planPath, decision}, {verbose: true});
}

function updateToken(fixture) {
    const markdown = read(fixture);
    return {expected_revision: parsePlanDocument(markdown).metadata.revision, base_sha256: sha256(markdown)};
}

function saveBody(fixture, body, overrides = {}) {
    return savePlan({
        repo_root: fixture.root,
        source_identity: fixture.identity,
        markdown_body: body,
        ...updateToken(fixture),
        ...overrides,
    }, {now: "2026-10-02T13:00:00.000Z", verbose: true});
}

function changedGoalBody(fixture, goal = "Gate readiness on a changed review.") {
    return parsePlanDocument(read(fixture)).body.replace("- Goal: Gate readiness on a recorded review.", `- Goal: ${goal}`);
}

it("stores the previous revision hash in the front matter and in every outcome", () => {
    withFixture((fixture) => {
        assert.equal(fixture.saved.previous_sha256, null);
        assert.equal(fixture.saved.metadata.previous_sha256, null);

        const revisionOneHash = sha256(read(fixture));
        const saved = saveBody(fixture, changedGoalBody(fixture));
        assert.equal(saved.previous_sha256, revisionOneHash);
        assert.equal(parsePlanDocument(saved.markdown).metadata.previous_sha256, revisionOneHash);

        const revisionTwoHash = sha256(read(fixture));
        const edited = editPlan({
            file: fixture.planPath,
            operation: {type: "edit-bullet", work_package: "WP1", id: "Scope", value: "One edited package field."},
        }, {repoRoot: fixture.root});
        assert.equal(edited.revision, 3);
        assert.equal(edited.previous_sha256, revisionTwoHash);

        record(fixture);
        const recordedHash = sha256(read(fixture));
        const completed = completeWorkPackage({
            repoRoot: fixture.root,
            planPath: fixture.planPath,
            wpId: "WP1",
            evidence: "focused test passed",
        }, {now: NOW});
        assert.equal(completed.previous_sha256, recordedHash);
    });
});

it("keeps revision, file and review unchanged when a save repeats identical content", () => {
    withFixture((fixture) => {
        saveBody(fixture, changedGoalBody(fixture));
        record(fixture);
        const before = read(fixture);

        const repeated = saveBody(fixture, parsePlanDocument(before).body);
        assert.equal(repeated.changed, false);
        assert.equal(repeated.status, "ready");
        assert.equal(repeated.previous_sha256, parsePlanDocument(before).metadata.previous_sha256);
        assert.equal(read(fixture), before);
    });
});

it("reports review_pending without errors until a finish-ready decision is recorded", () => {
    withFixture((fixture) => {
        assert.equal(fixture.saved.status, "blocked");
        assert.equal(fixture.saved.blocked_reason, "review_pending");
        assert.deepEqual(fixture.saved.errors, []);
        assert.equal(fixture.saved.validation.valid, true);

        const recorded = record(fixture);
        assert.equal(recorded.status, "ready");
        assert.equal(recorded.blocked_reason, null);
        assert.equal(recorded.revision, fixture.saved.revision);
        assert.equal(recorded.reviewed_revision, 1);
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "ready");
    });
});

it("withdraws the confirmation when the plan changes through save or edit", () => {
    withFixture((fixture) => {
        record(fixture);

        const saved = saveBody(fixture, changedGoalBody(fixture));
        assert.equal(saved.status, "blocked");
        assert.equal(saved.blocked_reason, "review_pending");
        assert.equal(saved.metadata.reviewed_revision, null);
        assert.equal(saved.metadata.reviewed_body_sha256, null);

        record(fixture);
        const edited = editPlan({
            file: fixture.planPath,
            operation: {type: "edit-bullet", work_package: "WP1", id: "Scope", value: "Another edited package field."},
        }, {repoRoot: fixture.root});
        assert.equal(edited.status, "blocked");
        assert.equal(edited.blocked_reason, "review_pending");
    });
});

it("blocks a plan whose body no longer matches the recorded review", () => {
    withFixture((fixture) => {
        record(fixture);
        fs.writeFileSync(
            path.join(fixture.root, fixture.planPath),
            read(fixture).replace("Gate readiness on a recorded review.", "Silently edited by hand."),
            "utf8",
        );
        const validation = validatePlanDocument(read(fixture), {repoRoot: fixture.root});
        assert.equal(validation.valid, true);
        assert.equal(validation.status, "blocked");
        assert.equal(validation.blocked_reason, "review_pending");
    });
});

it("keeps ready through complete-wp because only the Execution checklist changes", () => {
    withFixture((fixture) => {
        record(fixture);
        const completed = completeWorkPackage({
            repoRoot: fixture.root,
            planPath: fixture.planPath,
            wpId: "WP1",
            evidence: "focused test passed",
        }, {now: NOW, verbose: true});
        assert.equal(completed.status, "ready");
        assert.equal(completed.metadata.revision, 2);
        assert.equal(completed.metadata.reviewed_revision, 2);
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "ready");
    });
});

it("keeps plans written before the review keys readable but review_pending until a review is recorded", () => {
    withFixture((fixture) => {
        const legacy = read(fixture).replace(/^(previous_sha256|reviewed_revision|reviewed_body_sha256|review_base_revision|review_base_sha256): .*\n/gm, "");
        fs.writeFileSync(path.join(fixture.root, fixture.planPath), legacy, "utf8");
        const loaded = loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath});
        assert.equal(loaded.validation.valid, true);
        assert.equal(loaded.status, "blocked");
        assert.equal(loaded.validation.blocked_reason, "review_pending");
        assert.deepEqual(loaded.validation.errors, []);

        const complete = () => completeWorkPackage({
            repoRoot: fixture.root,
            planPath: fixture.planPath,
            wpId: "WP1",
            evidence: "focused test passed",
        }, {now: NOW, verbose: true});
        assert.throws(complete, (error) => error instanceof StoreError && error.code === "PLAN_NOT_READY");
        assert.equal(read(fixture), legacy);

        record(fixture);
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "ready");
        assert.equal(complete().status, "ready");
    });
});

it("appends the review keys with null on the first content change of a legacy plan", () => {
    withFixture((fixture) => {
        fs.writeFileSync(
            path.join(fixture.root, fixture.planPath),
            read(fixture).replace(/^(previous_sha256|reviewed_revision|reviewed_body_sha256|review_base_revision|review_base_sha256): .*\n/gm, ""),
            "utf8",
        );
        const saved = saveBody(fixture, changedGoalBody(fixture));
        assert.equal(saved.metadata.reviewed_revision, null);
        assert.equal(saved.status, "blocked");
        assert.equal(saved.blocked_reason, "review_pending");
    });
});

it("rejects invalid or unbound decisions without touching the plan", () => {
    withFixture((fixture) => {
        const before = read(fixture);
        for (const decision of [
            {ok: false, action: "finish-ready", reason: "invalid-review-input", plan: planReference(fixture)},
            {ok: true, action: "unknown", plan: planReference(fixture)},
            {action: "finish-ready"},
            null,
            [],
        ]) {
            assert.throws(
                () => record(fixture, decision),
                (error) => error instanceof StoreError && error.code === "REVIEW_DECISION_REJECTED",
            );
        }
        assert.throws(
            () => record(fixture, FINISH_READY),
            (error) => error instanceof StoreError && error.code === "REVIEW_DECISION_UNBOUND",
        );
        assert.equal(read(fixture), before);
    });
});

it("rejects a decision made for an older revision of the plan", () => {
    withFixture((fixture) => {
        const stale = bound(fixture);
        record(fixture, stale);
        saveBody(fixture, changedGoalBody(fixture));
        const before = read(fixture);

        assert.throws(
            () => record(fixture, stale),
            (error) => error instanceof StoreError && error.code === "REVIEW_DECISION_STALE",
        );
        assert.throws(
            () => record(fixture, {...stale, plan: {...planReference(fixture), content_sha256: "0".repeat(64)}}),
            (error) => error instanceof StoreError && error.code === "REVIEW_DECISION_STALE",
        );
        assert.equal(read(fixture), before);
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "blocked");
    });
});

it("rejects a decision bound to the recorded base after the body was edited by hand", () => {
    withFixture((fixture) => {
        const reference = planReference(fixture);
        record(fixture, {ok: true, action: "apply-repair", reason: "repair-all-actionable-findings", plan: reference});
        fs.writeFileSync(
            path.join(fixture.root, fixture.planPath),
            read(fixture).replace("Gate readiness on a recorded review.", "Silently edited by hand."),
            "utf8",
        );
        const before = read(fixture);

        assert.throws(
            () => record(fixture, {...FINISH_READY, plan: reference}),
            (error) => error instanceof StoreError && error.code === "REVIEW_DECISION_STALE",
        );
        assert.equal(read(fixture), before);
        assert.equal(loadPlanFile({repoRoot: fixture.root, planPath: fixture.planPath}).status, "blocked");
    });
});

it("records a repair decision as the next delta base without confirming readiness", () => {
    withFixture((fixture) => {
        const reference = planReference(fixture);
        const recorded = record(fixture, bound(fixture, {ok: true, action: "apply-repair", reason: "repair-all-actionable-findings"}));
        assert.equal(recorded.status, "blocked");
        assert.equal(recorded.blocked_reason, "review_pending");
        assert.equal(recorded.reviewed_revision, null);
        assert.equal(recorded.review_base_revision, reference.revision);
        assert.equal(recorded.review_base_sha256, reference.content_sha256);

        const saved = saveBody(fixture, changedGoalBody(fixture));
        assert.equal(saved.metadata.review_base_revision, reference.revision);
        assert.equal(saved.metadata.review_base_sha256, reference.content_sha256);
    });
});

it("rejects the review of a structurally invalid plan", () => {
    withFixture((fixture) => {
        fs.writeFileSync(path.join(fixture.root, fixture.planPath), read(fixture).replace("## Scope", "## Scoped"), "utf8");
        assert.throws(
            () => record(fixture),
            (error) => error instanceof StoreError && error.code === "INVALID_PLAN",
        );
    });
});

it("record-review CLI reads a decision file, is idempotent and rejects an unbound decision", () => {
    withFixture((fixture) => {
        const decisionFile = path.join(fixture.root, "decision.json");
        const run = () => spawnSync(process.execPath, [
            STORE_SCRIPT, "record-review", "--file", fixture.planPath, "--input", decisionFile, "--root", fixture.root,
        ], {encoding: "utf8"});

        fs.writeFileSync(decisionFile, JSON.stringify(FINISH_READY), "utf8");
        const rejected = run();
        assert.equal(rejected.status, 1);
        assert.equal(JSON.parse(rejected.stderr).error, "REVIEW_DECISION_UNBOUND");

        fs.writeFileSync(decisionFile, JSON.stringify(bound(fixture)), "utf8");
        const first = run();
        assert.equal(first.status, 0, first.stderr);
        assert.equal(JSON.parse(first.stdout).status, "ready");
        assert.equal(JSON.parse(first.stdout).changed, true);

        const second = run();
        assert.equal(second.status, 0, second.stderr);
        assert.equal(JSON.parse(second.stdout).changed, false);
    });
});
