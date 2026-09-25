import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {it} from "vitest";

import {persistSource, normalizeUserInput} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {completeWorkPackage, savePlan, StoreError} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {parsePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";
import {
    completeExecutionWorkPackage,
    loadExecutionPlan,
    PlanExecuteError,
    resolvePlanPath,
    checkExecutionEnvironment,
    selectNextWorkPackage,
    writeLastPlanPointer,
} from "../../../.agents/skills/plan-execute/scripts/execute.mjs";

const NOW = "2026-08-26T12:00:00.000Z";

function updateToken(saved) {
    return {
        expected_revision: saved.revision,
        base_sha256: saved.content_sha256,
    };
}

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
    }, {now: NOW, verbose: true});
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

it("completes through the facade, refreshes the canonical pointer, and resumes the next WP", () => {
    const root = temporaryRepository();
    const cachePath = path.join(root, "var", "agent", "cache");
    const {saved, planPath} = makePlan(root, [
        {id: "WP1", title: "First"},
        {id: "WP2", title: "Follow-up"},
    ], "user-input:facade");

    const completed = completeExecutionWorkPackage({
        repoRoot: root,
        planPath,
        wpId: "WP1",
        evidence: "facade test passed",
        cachePath,
    }, {now: NOW});

    assert.equal(completed.changed, true);
    assert.equal(completed.pointer.value, saved.paths.draft_path);
    assert.equal(fs.readFileSync(completed.pointer.path, "utf8"), `${saved.paths.draft_path}\n`);
    assert.equal(path.dirname(completed.pointer.path), path.join(root, "var", "agent", "cache", "plan-execute"));
    assert.deepEqual(
        fs.readdirSync(path.dirname(completed.pointer.path)).filter((name) => name.includes(".tmp-")),
        [],
    );

    const resumed = resolvePlanPath({repoRoot: root, cachePath});
    assert.equal(resumed.source, "last-plan");
    assert.equal(resumed.relative, saved.paths.draft_path);
    assert.equal(selectNextWorkPackage(loadExecutionPlan({planPath: resumed.absolute, repoRoot: root})).selected.id, "WP2");
});

it("reports a completed one-WP plan when next resumes through the pointer", () => {
    const root = temporaryRepository();
    const cachePath = path.join(root, "var", "agent", "cache");
    const {planPath} = makePlan(root, [{id: "WP1", title: "Only"}], "user-input:facade-complete");

    completeExecutionWorkPackage({
        repoRoot: root,
        planPath,
        wpId: "WP1",
        evidence: "facade test passed",
        cachePath,
    }, {now: NOW});

    const resumed = resolvePlanPath({repoRoot: root, cachePath});
    assert.deepEqual(selectNextWorkPackage(loadExecutionPlan({planPath: resumed.absolute, repoRoot: root})), {
        action: "complete",
        selected: null,
    });
});

it("keeps the plan and pointer unchanged when facade completion fails", () => {
    const root = temporaryRepository();
    const cachePath = path.join(root, "var", "agent", "cache");
    const {planPath} = makePlan(root, [
        {id: "WP1", title: "First"},
        {id: "WP2", title: "Follow-up"},
    ], "user-input:facade-errors");
    const pointer = writeLastPlanPointer({planPath, repoRoot: root, cachePath});
    const originalPlan = fs.readFileSync(planPath, "utf8");
    const originalPointer = fs.readFileSync(pointer.path, "utf8");

    assert.throws(
        () => completeExecutionWorkPackage({
            repoRoot: root,
            planPath,
            wpId: "WP2",
            evidence: "out of order",
            cachePath,
        }, {now: NOW}),
        (error) => error instanceof PlanExecuteError && error.code === "WORK_PACKAGE_OUT_OF_ORDER",
    );
    assert.throws(
        () => completeExecutionWorkPackage({
            repoRoot: root,
            planPath,
            wpId: "WP1",
            cachePath,
        }, {now: NOW}),
        (error) => error instanceof PlanExecuteError && error.code === "INVALID_ARGUMENT",
    );

    assert.equal(fs.readFileSync(planPath, "utf8"), originalPlan);
    assert.equal(fs.readFileSync(pointer.path, "utf8"), originalPointer);
});

it("points at the explicitly chosen plan when facade completion fails", () => {
    const root = temporaryRepository();
    const cachePath = path.join(root, "var", "agent", "cache");
    const previous = makePlan(root, [{id: "WP1", title: "Previous"}], "user-input:pointer-previous");
    const selected = makePlan(root, [
        {id: "WP1", title: "First"},
        {id: "WP2", title: "Follow-up"},
    ], "user-input:pointer-selected");
    const pointer = writeLastPlanPointer({planPath: previous.planPath, repoRoot: root, cachePath});
    const previousPlanBefore = fs.readFileSync(previous.planPath, "utf8");
    const selectedPlanBefore = fs.readFileSync(selected.planPath, "utf8");

    assert.equal(fs.readFileSync(pointer.path, "utf8"), `${previous.saved.paths.draft_path}\n`);

    assert.throws(
        () => completeExecutionWorkPackage({
            repoRoot: root,
            planPath: selected.planPath,
            wpId: "WP2",
            evidence: "out of order",
            cachePath,
        }, {now: NOW}),
        (error) => error instanceof PlanExecuteError && error.code === "WORK_PACKAGE_OUT_OF_ORDER",
    );

    assert.equal(fs.readFileSync(pointer.path, "utf8"), `${selected.saved.paths.draft_path}\n`);
    assert.equal(fs.readFileSync(selected.planPath, "utf8"), selectedPlanBefore);
    assert.equal(fs.readFileSync(previous.planPath, "utf8"), previousPlanBefore);

    const resumed = resolvePlanPath({repoRoot: root, cachePath});
    assert.equal(resumed.source, "last-plan");
    assert.equal(resumed.relative, selected.saved.paths.draft_path);
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

    completeWorkPackage({repoRoot: root, planPath, wpId: "WP1", evidence: "focused test passed"}, {now: NOW, verbose: true});
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
    assert.equal(equal.source, "flags");
});

it("resolves the current profile from the session environment without flags", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Session profile"}], "user-input:session-env");

    const result = checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        env: {
            OPENCODE_SESSION_MODEL: "openai/gpt-5.6-sol",
            OPENCODE_SESSION_VARIANT: "medium",
        },
    });

    assert.equal(result.sufficient, true);
    assert.equal(result.action, "execute");
    assert.equal(result.source, "session-env");
    assert.equal(result.current.model, "openai/gpt-5.6-sol");
    assert.equal(result.current.reasoning, "medium");
});

it("matches the session profile across provider prefixes", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Provider agnostic"}], "user-input:provider-agnostic");

    const result = checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        env: {
            OPENCODE_SESSION_MODEL: "commandcode/openai/gpt-5.6-sol",
            OPENCODE_SESSION_VARIANT: "medium",
        },
    });

    assert.equal(result.sufficient, true);
    assert.equal(result.action, "execute");
    assert.equal(result.current.model, "commandcode/openai/gpt-5.6-sol");
    assert.equal(result.current.rank, 1);
});

it("lets explicit flags override the session environment", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Flag precedence"}], "user-input:flag-precedence");

    const result = checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        currentModel: "deepseek/deepseek-v4",
        currentReasoning: "high",
        env: {
            OPENCODE_SESSION_MODEL: "openai/gpt-5.6-sol",
            OPENCODE_SESSION_VARIANT: "medium",
        },
    });

    assert.equal(result.source, "flags");
    assert.equal(result.current.model, "deepseek/deepseek-v4");
    assert.equal(result.sufficient, true);
});

it("fails closed when neither flags nor the session environment provide a profile", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Unknown profile"}], "user-input:unknown-profile");

    assert.throws(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {env: {}}),
        (error) => error instanceof PlanExecuteError && error.code === "SESSION_PROFILE_UNKNOWN",
    );
});

it("rejects a partial explicit override instead of mixing flag and environment sources", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Partial override"}], "user-input:partial-override");

    assert.throws(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
            currentModel: "openai/gpt-5.6-sol",
            env: {OPENCODE_SESSION_VARIANT: "medium"},
        }),
        (error) => error instanceof PlanExecuteError && error.code === "INVALID_ARGUMENT",
    );
});

it("reports an unranked session profile instead of guessing its position", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Unranked"}], "user-input:unranked-profile");

    assert.throws(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
            env: {
                OPENCODE_SESSION_MODEL: "openai/gpt-5.6-unknown",
                OPENCODE_SESSION_VARIANT: "max",
            },
        }),
        (error) => error instanceof PlanExecuteError && error.code === "UNRANKED_CURRENT_PROFILE",
    );
});

it("accepts an explicit user attestation as the portable fallback for harnesses without a session profile", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{
        id: "WP1",
        title: "Attested",
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        justification: "higher capability required",
    }], "user-input:user-attested");

    const result = checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        userAttested: true,
        env: {},
    });

    assert.equal(result.action, "execute");
    assert.equal(result.sufficient, true);
    assert.equal(result.attested, true);
    assert.equal(result.source, "user-attested");
    assert.equal(result.current, null);
    assert.deepEqual(result.required, {
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        rank: 0,
    });
    assert.equal(result.selected.id, "WP1");
});

it("still validates the hierarchy for a user attestation instead of trusting blindly", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Attested unranked"}], "user-input:attested-unranked");
    const hierarchyPath = path.join(root, ".agents", "config", "model-hierarchy.json");
    const reduced = JSON.parse(fs.readFileSync(hierarchyPath, "utf8"));
    reduced.profiles = [{model: "other/only", reasoning: "low"}];
    const fsOps = {
        ...fs,
        readFileSync(file, ...args) {
            if (path.resolve(file) === hierarchyPath) {
                return `${JSON.stringify(reduced, null, 2)}\n`;
            }
            return fs.readFileSync(file, ...args);
        },
    };

    assert.throws(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {userAttested: true, fsOps}),
        (error) => error instanceof PlanExecuteError && error.code === "UNRANKED_REQUIRED_PROFILE",
    );
});

it("keeps the environment path authoritative when a session profile is available", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Env wins"}], "user-input:env-wins");

    const result = checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        env: {
            OPENCODE_SESSION_MODEL: "openai/gpt-5.6-sol",
            OPENCODE_SESSION_VARIANT: "medium",
        },
    });

    assert.equal("attested" in result, false);
    assert.equal(result.source, "session-env");
    assert.notEqual(result.current, null);
});

it("rejects a user attestation combined with explicit flags", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Attested plus flags"}], "user-input:attested-flags");

    assert.throws(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
            userAttested: true,
            currentModel: "deepseek/deepseek-v4",
            currentReasoning: "high",
        }),
        (error) => error instanceof PlanExecuteError && error.code === "INVALID_ARGUMENT",
    );
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
    }, {now: NOW, verbose: true});

    assert.equal(completed.changed, true);
    assert.match(completed.markdown, /- \[x\] WP1 — 2026-08-26 — focused test passed/);
    const repeated = completeWorkPackage({
        repoRoot: root,
        planPath,
        wpId: "WP1",
        evidence: "focused test passed",
    }, {now: NOW, verbose: true});
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

it("propagates a completion conflict when the transformed snapshot becomes stale", () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Concurrent"}], "user-input:completion-conflict");
    let planReads = 0;
    let concurrentBytes = null;
    const racingFs = {
        ...fs,
        readFileSync(file, ...args) {
            if (path.resolve(file) === created.planPath) {
                planReads += 1;
                if (planReads === 3) {
                    concurrentBytes = fs.readFileSync(file, "utf8").replace(
                        "- Goal: Execute Concurrent.",
                        "- Goal: Concurrent writer changed the package.",
                    );
                    fs.writeFileSync(file, concurrentBytes, "utf8");
                }
            }
            return fs.readFileSync(file, ...args);
        },
    };

    assert.throws(
        () => completeExecutionWorkPackage({
            repoRoot: root,
            planPath: created.planPath,
            wpId: "WP1",
            evidence: "stale implementation evidence",
            fsOps: racingFs,
        }, {now: NOW}),
        (error) => error instanceof PlanExecuteError && error.code === "PLAN_CONFLICT",
    );
    assert.equal(fs.readFileSync(created.planPath, "utf8"), concurrentBytes);
    assert.match(concurrentBytes, /- \[ \] WP1/);
});

it("does not execute a plan blocked by an open planning question", () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Questioned"}], "user-input:question");
    const blockedBody = parsePlanDocument(created.saved.markdown).body.replace(
        "No open questions.",
        "- Q1 [open]: Which owner should execute this?",
    );
    savePlan({
        repo_root: root,
        source_identity: "user-input:question",
        markdown_body: blockedBody,
        ...updateToken(created.saved),
    }, {now: NOW});

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
        ...updateToken(created.saved),
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
