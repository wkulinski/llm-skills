import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {it} from "vitest";

import {persistSource, normalizeUserInput} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {savePlan} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {parsePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";
import {
    PlanExecuteError,
    loadExecutionPlan,
    recordBatch,
    resolvePlanPath,
    resolveExecutionEnvironment,
    selectBatch,
    writeLastPlanPointer,
} from "../../../.agents/skills/plan-execute/scripts/execute.mjs";

const NOW = new Date("2026-08-26T12:00:00.000Z");
const DEFAULT_MODEL = "openai/gpt-5.6-luna";

function temporaryRepository() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "plan-execute-"));
}

function makePlan(root, packages, identity = `user-input:plan-execute-${packages.length}`) {
    const source = normalizeUserInput({identity, title: "Plan execute test", body: "Execute the requested plan."}, {fetched_at: NOW.toISOString()});
    persistSource(source, {repoRoot: root});
    const body = planBody(packages);
    const saved = savePlan({repo_root: root, source_identity: source.identity, markdown_body: body}, {now: NOW.toISOString()});
    return {source, saved, planPath: path.join(root, saved.paths.draft_path)};
}

function planBody(packages) {
    const packageIds = packages.map((item) => item.id);
    const packageSections = packages.map((item) => `### ${item.id} — ${item.title}

- Source: ${item.id} requirement
- Goal: Execute ${item.title}.
- Scope: Update the planned behavior.
- Out of scope: Unrelated changes.
- Confirmed paths: .agents/skills/plan-execute/SKILL.md
- Candidate paths: none
- Discovery required: none
- Dependencies: ${item.dependencies.length > 0 ? item.dependencies.join(", ") : "none"}
- Estimated size: ${item.size}
- Acceptance criteria: ${item.title} is complete and verified.
- Verification: Run the focused check for ${item.id}.
`).join("\n");
    const progress = packages.map((item) => `| ${item.id} | pending | none | none |`).join("\n");
    const sourceCoverage = packageIds.map((id) => `- ${id} requirement → ${id}`).join("\n");

    return `# Plan execute test

## Source and objective

Execute the requested plan without a parallel state store.

## Source assessment

- Requested outcome: The planned work is executed and resumed safely.
- Observed symptoms: Execution state is not yet recorded.
- Explicit constraints: Keep Markdown as the state source.
- Suggested diagnosis or solution: Use the plan-execute adapter.
- Claims verified in evidence: The task-plan contract is the plan owner.
- Claims corrected or still unverified: Runtime model availability remains session-dependent.

## Scope

Only the plan execution flow is in scope.

## Direction, simplicity and consistency

- Existing mechanism reused: task-plan Markdown and store are reused.
- Simpler alternative considered: A path-only pointer is used instead of a state sidecar.
- Why the selected approach is minimal: Only progress and execution log are updated.
- Duplicate or parallel responsibilities: No second WP state representation is introduced.
- Cross-WP consistency and ownership: task-plan owns shape; plan-execute owns runtime progress.

## Source coverage

${sourceCoverage}

## Work packages

${packageSections}
## Order and dependencies

Packages run in dependency order.

## Decisions and open questions

No open questions.

## Risks and discovery debt

No known discovery debt.

## Acceptance and verification

Run the focused plan-execute tests.

## Execution environment

- Ranking source: https://aicodingdaily.com/leaderboard
- Ranking updated at: 2026-08-20
- Assessed at: 2026-08-26
- Allowed model families: OpenAI, DeepSeek, Tencent
- Qwen policy: frontend-design only
- Project family override: none
- Default model: ${DEFAULT_MODEL}
- Default reasoning: max
- Escalation model: openai/gpt-5.6-sol
- Escalation reasoning: medium
- Escalation trigger: contract conflict
- WP overrides: none

## Execution

- Status: not_started
- Next WP: ${packages[0].id}

### Progress

| WP | Status | Completed at | Verification |
|---|---|---|---|
${progress}

### Execution log

No execution entries have been recorded.

## Next action

Select the next eligible batch.
`;
}

function availableEnvironment() {
    return {
        availableModels: [DEFAULT_MODEL],
        visibleReasoning: {[DEFAULT_MODEL]: ["max"]},
    };
}

it("resolves an explicit plan and continues through a path-only pointer", () => {
    const root = temporaryRepository();
    const cachePath = path.join(root, "var", "agent", "cache");
    const {saved, planPath} = makePlan(root, [{id: "WP1", title: "First", size: "small", dependencies: []}], "user-input:pointer");

    const explicit = resolvePlanPath({repoRoot: root, explicitPath: saved.paths.draft_path, cachePath});
    assert.equal(explicit.source, "explicit");
    const pointer = writeLastPlanPointer({planPath, repoRoot: root, cachePath});
    assert.equal(pointer.value, saved.paths.draft_path);
    assert.equal(fs.readFileSync(pointer.path, "utf8"), "docs/plans/" + path.basename(planPath) + "\n");

    const continued = resolvePlanPath({repoRoot: root, cachePath});
    assert.equal(continued.source, "last-plan");
    assert.equal(continued.relative, saved.paths.draft_path);
    assert.throws(() => JSON.parse(fs.readFileSync(pointer.path, "utf8")));
});

it("selects only dependency-ready work packages that fit the remaining context", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [
        {id: "WP1", title: "Foundation", size: "small", dependencies: []},
        {id: "WP2", title: "Dependent", size: "large", dependencies: ["WP1"]},
        {id: "WP3", title: "Independent", size: "small", dependencies: []},
    ], "user-input:selection");
    const plan = loadExecutionPlan({planPath, repoRoot: root});
    const selected = selectBatch(plan, {remainingContext: 2, ...availableEnvironment()});

    assert.equal(selected.action, "execute");
    assert.deepEqual(selected.selected.map((item) => item.id), ["WP1", "WP3"]);
    assert.equal(selected.selected.some((item) => item.id === "WP2"), false);

    const unavailable = selectBatch(plan, {remainingContext: 2, availableModels: [], visibleReasoning: {}});
    assert.equal(unavailable.action, "needs-environment");
    assert.equal(unavailable.selected.length, 0);
});

it("continues active work before adding other eligible packages to the batch", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [
        {id: "WP1", title: "Active", size: "small", dependencies: []},
        {id: "WP2", title: "Next", size: "medium", dependencies: []},
    ], "user-input:active-prefix");
    recordBatch({
        planPath,
        repoRoot: root,
        now: NOW,
        results: [{id: "WP1", status: "in_progress"}],
    });

    const selected = selectBatch(loadExecutionPlan({planPath, repoRoot: root}), {
        remainingContext: 3,
        ...availableEnvironment(),
    });

    assert.equal(selected.action, "execute");
    assert.deepEqual(selected.selected.map((item) => item.id), ["WP1", "WP2"]);
});

it("records a partial batch and declares completion only after every WP has evidence", () => {
    const root = temporaryRepository();
    const cachePath = path.join(root, "var", "agent", "cache");
    const {planPath} = makePlan(root, [
        {id: "WP1", title: "Foundation", size: "small", dependencies: []},
        {id: "WP2", title: "Dependent", size: "small", dependencies: ["WP1"]},
    ], "user-input:recording");

    const partial = recordBatch({
        planPath,
        cachePath,
        repoRoot: root,
        now: NOW,
        results: [{id: "WP1", status: "done", verification: "focused test passed"}],
    });
    assert.equal(partial.contract.execution.status, "in_progress");
    assert.equal(partial.contract.execution.nextWp, "WP2");
    assert.match(partial.contract.execution.log, /WP1=done/);
    assert.equal((partial.body.match(/^## Execution$/gm) ?? []).length, 1);

    assert.throws(
        () => recordBatch({planPath, cachePath, repoRoot: root, now: NOW, results: [{id: "WP2", status: "done"}]}),
        (error) => error instanceof PlanExecuteError && error.code === "VERIFICATION_REQUIRED",
    );

    const complete = recordBatch({
        planPath,
        cachePath,
        repoRoot: root,
        now: NOW,
        results: [{id: "WP2", status: "done", verification: "focused test passed"}],
    });
    assert.equal(complete.contract.execution.status, "complete");
    assert.equal(complete.contract.execution.nextWp, "none");
    assert.deepEqual(complete.contract.execution.progressRows.map((row) => row.status), ["done", "done"]);
});

it("records a blocked batch without misclassifying it as complete", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Blocked task", size: "small", dependencies: []}], "user-input:blocked");
    const blocked = recordBatch({
        planPath,
        repoRoot: root,
        now: NOW,
        results: [{id: "WP1", status: "blocked", verification: "explicit environment is required"}],
    });

    assert.equal(blocked.contract.execution.status, "blocked");
    assert.equal(blocked.contract.execution.nextWp, "none");
    assert.equal(blocked.contract.execution.progressRows[0].status, "blocked");
    assert.deepEqual(selectBatch(blocked, {remainingContext: 1, ...availableEnvironment()}), {
        action: "blocked",
        code: "WP_BLOCKED",
        selected: [],
    });
});

it("requests a new session when the first eligible WP exceeds remaining context", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Large task", size: "large", dependencies: []}], "user-input:context");
    const plan = loadExecutionPlan({planPath, repoRoot: root});
    const result = selectBatch(plan, {remainingContext: 1, ...availableEnvironment()});

    assert.equal(result.action, "new-session");
    assert.equal(result.code, "REMAINING_CONTEXT");
    assert.deepEqual(result.selected, []);
});

it("does not execute a task-plan that is blocked by an open planning question", () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Questioned task", size: "small", dependencies: []}], "user-input:question");
    const blockedBody = parsePlanDocument(created.saved.markdown).body.replace("No open questions.", "- Q1 [open]: Which owner should execute this?");
    savePlan({repo_root: root, source_identity: created.source.identity, markdown_body: blockedBody}, {now: NOW.toISOString()});

    assert.throws(
        () => loadExecutionPlan({planPath: created.planPath, repoRoot: root}),
        (error) => error instanceof PlanExecuteError && error.code === "INVALID_PLAN",
    );
});

it("reuses a recorded recommendation only when model and reasoning remain available", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Recorded environment", size: "small", dependencies: []}], "user-input:environment");
    const plan = loadExecutionPlan({planPath, repoRoot: root});

    const recorded = resolveExecutionEnvironment(plan, {...availableEnvironment(), rankingAvailable: false});
    assert.equal(recorded.action, "execute");
    assert.equal(recorded.environment.source, "recorded-plan-recommendation");

    const hiddenReasoning = resolveExecutionEnvironment(plan, {availableModels: [DEFAULT_MODEL]});
    assert.equal(hiddenReasoning.action, "needs-environment");
    assert.equal(hiddenReasoning.code, "REASONING_VISIBILITY_UNKNOWN");
});

it("uses a validated work-package environment override", () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Override", size: "small", dependencies: []}], "user-input:override");
    const markdown = fs.readFileSync(created.planPath, "utf8");
    const body = parsePlanDocument(markdown).body.replace(
        "- WP overrides: none",
        "- WP overrides:\n  - WP1: model=deepseek/deepseek-v4; reasoning=high; justification=better fit",
    );
    savePlan({repo_root: root, source_identity: created.source.identity, markdown_body: body}, {now: NOW.toISOString()});

    const selected = selectBatch(loadExecutionPlan({planPath: created.planPath, repoRoot: root}), {
        remainingContext: 1,
        availableModels: ["deepseek/deepseek-v4"],
        visibleReasoning: {"deepseek/deepseek-v4": ["high"]},
    });

    assert.equal(selected.action, "execute");
    assert.deepEqual(selected.selected[0].environment, {
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        source: "plan-recommendation",
    });
});
