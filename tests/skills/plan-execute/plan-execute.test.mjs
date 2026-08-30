import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {it} from "vitest";

import {persistSource, normalizeUserInput} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {completeWorkPackage, savePlan, StoreError} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {parsePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";
import {
    loadExecutionPlan,
    PlanExecuteError,
    resolvePlanPath,
    checkExecutionEnvironment,
    selectNextWorkPackage,
    writeLastPlanPointer,
} from "../../../.agents/skills/plan-execute/scripts/execute.mjs";

const NOW = "2026-08-26T12:00:00.000Z";

function temporaryRepository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-execute-"));
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
    return root;
}

function makePlan(root, packages, identity = `user-input:plan-execute-${packages.length}`) {
    const source = normalizeUserInput({identity, title: "Plan execute test", body: "Execute the requested plan."}, {fetched_at: NOW});
    persistSource(source, {repoRoot: root});
    const saved = savePlan({
        repo_root: root,
        source_identity: source.identity,
        markdown_body: planBody(packages),
    }, {now: NOW});
    return {saved, planPath: path.join(root, saved.paths.draft_path)};
}

function planBody(packages) {
    const packageSections = packages.map((item) => `### ${item.id} — ${item.title}

- Source: ${item.id} requirement
- Goal: Execute ${item.title}.
- Scope: Update the planned behavior.
- Out of scope: Unrelated changes.
- Confirmed paths: .agents/skills/plan-execute/SKILL.md
- Candidate paths: none
- Discovery required: none
- Estimated size: ${item.size ?? "medium"}
- Acceptance criteria: ${item.title} is complete and verified.
- Verification: Run the focused check for ${item.id}.
`).join("\n");
    const sourceCoverage = packages.map((item) => `- ${item.id} requirement: ${item.id}`).join("\n");
    const execution = packages.map((item) => `- [ ] ${item.id}`).join("\n");
    const overrideEntries = packages
        .filter((item) => item.model)
        .map((item) => `  - ${item.id}: model=${item.model}; reasoning=${item.reasoning}; justification=${item.justification}`);
    const overrides = overrideEntries.length > 0 ? `- WP overrides: configured\n${overrideEntries.join("\n")}` : "- WP overrides: none";

    return `# Plan execute test

## Source and objective

Execute the requested plan without a parallel state store.

## Source assessment

- Requested outcome: The planned work is executed and resumed safely.
- Observed symptoms: Execution has not started.
- Explicit constraints: Keep Markdown as the state source.
- Suggested diagnosis or solution: Execute work packages in document order.
- Claims verified in evidence: Task-plan owns the plan format.
- Claims corrected or still unverified: Implementation details remain scoped to each WP.

## Scope

Only the plan execution flow is in scope.

## Direction, simplicity and consistency

- Existing mechanism reused: Task-plan Markdown and store are reused.
- Simpler alternative considered: Binary completion replaces intermediate statuses.
- Why the selected approach is minimal: Only completed work is persisted.
- Duplicate or parallel responsibilities: Plan-execute does not write Markdown itself.
- Cross-WP consistency and ownership: Work packages run in document order.

## Source coverage

${sourceCoverage}

## Work packages

${packageSections}
## Order

Work packages run in document order.

## Decisions and open questions

No open questions.

## Risks and discovery debt

No known discovery debt.

## Acceptance and verification

Run the focused plan-execute tests.

## Execution environment

- Default model: openai/gpt-5.6-sol
- Default reasoning: medium
${overrides}

## Execution

${execution}
`;
}

it("resolves an explicit plan and continues through a path-only pointer", () => {
    const root = temporaryRepository();
    const cachePath = path.join(root, "var", "agent", "cache");
    const {saved, planPath} = makePlan(root, [{id: "WP1", title: "First"}], "user-input:pointer");

    const explicit = resolvePlanPath({repoRoot: root, explicitPath: saved.paths.draft_path, cachePath});
    assert.equal(explicit.source, "explicit");
    const pointer = writeLastPlanPointer({planPath, repoRoot: root, cachePath});
    assert.equal(pointer.value, saved.paths.draft_path);
    assert.equal(fs.readFileSync(pointer.path, "utf8"), `docs/plans/${path.basename(planPath)}\n`);

    const continued = resolvePlanPath({repoRoot: root, cachePath});
    assert.equal(continued.source, "last-plan");
    assert.equal(continued.relative, saved.paths.draft_path);
});

it("selects exactly the first unchecked work package", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [
        {id: "WP1", title: "Foundation"},
        {id: "WP2", title: "Follow-up"},
    ], "user-input:selection");

    const first = selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root}));
    assert.equal(first.action, "execute");
    assert.equal(first.selected.id, "WP1");
    assert.equal(first.selected.estimatedSize, "medium");
    assert.deepEqual(first.selected.environment, {
        model: "openai/gpt-5.6-sol",
        reasoning: "medium",
        source: "plan-default",
    });

    completeWorkPackage({repoRoot: root, planPath, wpId: "WP1", evidence: "focused test passed"}, {now: NOW});
    const second = selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root}));
    assert.equal(second.selected.id, "WP2");
});

it("uses a justified model and reasoning override for the selected work package", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{
        id: "WP1",
        title: "Specialized",
        size: "large",
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        justification: "better fit for this package",
    }], "user-input:override");

    const selected = selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root})).selected;
    assert.equal(selected.estimatedSize, "large");
    assert.deepEqual(selected.environment, {
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        source: "wp-override",
        justification: "better fit for this package",
    });
});

it("compares the current profile with the selected work-package requirement", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Default profile"}], "user-input:preflight");
    const plan = loadExecutionPlan({planPath, repoRoot: root});

    const equal = checkExecutionEnvironment(plan, {
        currentModel: "openai/gpt-5.6-sol",
        currentReasoning: "medium",
    });
    assert.equal(equal.sufficient, true);
    assert.equal(equal.action, "execute");

    const stronger = checkExecutionEnvironment(plan, {
        currentModel: "deepseek/deepseek-v4",
        currentReasoning: "high",
    });
    assert.equal(stronger.sufficient, true);
    assert.equal(stronger.current.rank < stronger.required.rank, true);
});

it("requests an environment change when the current profile ranks below the WP requirement", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{
        id: "WP1",
        title: "Higher requirement",
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        justification: "higher capability required",
    }], "user-input:insufficient");

    const result = checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        currentModel: "openai/gpt-5.6-sol",
        currentReasoning: "medium",
    });
    assert.equal(result.sufficient, false);
    assert.equal(result.action, "change-environment");
});

it("marks completion through task-plan with date and evidence", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Only"}], "user-input:completion");

    const completed = completeWorkPackage({
        repoRoot: root,
        planPath,
        wpId: "WP1",
        evidence: "focused test passed",
    }, {now: NOW});

    assert.equal(completed.changed, true);
    assert.match(completed.markdown, /- \[x\] WP1 — 2026-08-26 — focused test passed/);
    const repeated = completeWorkPackage({
        repoRoot: root,
        planPath,
        wpId: "WP1",
        evidence: "focused test passed",
    }, {now: NOW});
    assert.equal(repeated.changed, false);
    assert.equal(repeated.metadata.revision, 2);
    assert.deepEqual(selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root})), {
        action: "complete",
        selected: null,
    });
});

it("rejects out-of-order completion and missing evidence", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [
        {id: "WP1", title: "First"},
        {id: "WP2", title: "Second"},
    ], "user-input:order");

    assert.throws(
        () => completeWorkPackage({repoRoot: root, planPath, wpId: "WP2", evidence: "passed"}, {now: NOW}),
        (error) => error instanceof StoreError && error.code === "WORK_PACKAGE_OUT_OF_ORDER",
    );
    assert.throws(
        () => completeWorkPackage({repoRoot: root, planPath, wpId: "WP1", evidence: ""}, {now: NOW}),
        (error) => error instanceof StoreError && error.code === "INVALID_ARGUMENT",
    );
});

it("does not execute a plan blocked by an open planning question", () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Questioned"}], "user-input:question");
    const blockedBody = parsePlanDocument(created.saved.markdown).body.replace(
        "No open questions.",
        "- Q1 [open]: Which owner should execute this?",
    );
    savePlan({repo_root: root, source_identity: "user-input:question", markdown_body: blockedBody}, {now: NOW});

    assert.throws(
        () => loadExecutionPlan({planPath: created.planPath, repoRoot: root}),
        (error) => error instanceof PlanExecuteError && error.code === "PLAN_NOT_READY",
    );
});

it("does not execute a ready plan withdrawn by an incomplete material revision", () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Revised"}], "user-input:revision");
    const reportPath = path.join(root, "var", "agent", "incomplete-context.report.json");
    fs.mkdirSync(path.dirname(reportPath), {recursive: true});
    fs.writeFileSync(reportPath, "{\"status\":\"INCOMPLETE\"}\n", "utf8");
    const blocked = savePlan({
        repo_root: root,
        source_identity: "user-input:revision",
        markdown_body: parsePlanDocument(created.saved.markdown).body,
        context: {status: "INCOMPLETE", report_path: reportPath},
    }, {now: "2026-08-26T13:00:00.000Z"});

    assert.equal(created.saved.status, "ready");
    assert.equal(blocked.status, "blocked");
    assert.throws(
        () => loadExecutionPlan({planPath: created.planPath, repoRoot: root}),
        (error) => error instanceof PlanExecuteError && error.code === "PLAN_NOT_READY",
    );
    assert.throws(
        () => completeWorkPackage({repoRoot: root, planPath: created.planPath, wpId: "WP1", evidence: "passed"}),
        (error) => error instanceof StoreError && error.code === "PLAN_NOT_READY",
    );
});
