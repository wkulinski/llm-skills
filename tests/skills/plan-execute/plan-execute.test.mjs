import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {it, vi} from "vitest";

import {persistSource, normalizeUserInput} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {completeWorkPackage, recordReview, savePlan, StoreError} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {parsePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";
import {LEADERBOARD_URL} from "../../../.agents/skills/_shared/scripts/model-leaderboard.mjs";
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
const EXECUTE_SCRIPT = fileURLToPath(new URL("../../../.agents/skills/plan-execute/scripts/execute.mjs", import.meta.url));
const DECISION_OPTIONS = ["change-profile", "user-attested", "stop"];
const DEFAULT_PROFILES = [
    {model: "deepseek/deepseek-v4", reasoning: "high"},
    {model: "openai/gpt-5.6-sol", reasoning: "medium"},
];

function leaderboardResponse(rows) {
    const body = `<table><thead><tr><th>#</th><th>Model</th><th>Total points (max 70)</th></tr>
<tr><th>Other project scores</th></tr></thead><tbody>${rows.map((row, index) =>
    `<tr><td>${index + 1}</td><td><a href="https://aicodingdaily.com/model/synthetic-${index}">${row.label}</a></td><td>${row.totalPoints}</td>${"<td>other</td>".repeat(8)}</tr>`).join("")}</tbody></table>`;
    return {
        ok: true,
        status: 200,
        headers: new Headers({"content-type": "text/html; charset=utf-8"}),
        text: async () => body,
    };
}

function updateToken(saved) {
    return {
        expected_revision: saved.revision,
        base_sha256: saved.content_sha256,
    };
}

function temporaryRepository(profiles = DEFAULT_PROFILES) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-execute-"));
    const configDir = path.join(root, ".agents", "config");
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), `${JSON.stringify({
        version: 1,
        order: "strongest-to-weakest",
        profiles,
    }, null, 2)}\n`, "utf8");
    return root;
}

function makePlan(root, packages, identity = `user-input:plan-execute-${packages.length}`, extras = {}) {
    const source = normalizeUserInput({identity, title: "Plan execute test", body: "Execute the requested plan."}, {fetched_at: NOW});
    persistSource(source, {repoRoot: root});
    const drafted = savePlan({
        repo_root: root,
        source_identity: source.identity,
        markdown_body: planBody(packages, extras),
    }, {now: NOW, verbose: true});
    const planPath = path.join(root, drafted.paths.draft_path);
    const saved = recordReview({
        repoRoot: root,
        planPath,
        decision: {
            ok: true,
            action: "finish-ready",
            reason: "plan-ready",
            plan: {plan_id: drafted.plan_id, revision: drafted.revision, content_sha256: drafted.content_sha256},
        },
    }, {verbose: true});
    return {saved, planPath};
}

function planBody(packages, extras = {}) {
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
    const summaries = packages.map((item) => `- ${item.id} — ${item.title}: Delivers this package in the existing plan flow and leaves unrelated changes out.`).join("\n");
    const overrideEntries = packages
        .filter((item) => item.model)
        .map((item) => `  - ${item.id}: model=${item.model}; reasoning=${item.reasoning}; justification=${item.justification}`);
    const overrides = overrideEntries.length > 0 ? `- WP overrides: configured\n${overrideEntries.join("\n")}` : "- WP overrides: none";

    return `# Plan execute test

## Execution

${execution}

## Work package summaries

${summaries}

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

${packageSections}${extras.afterPackages ?? ""}
## Order

Work packages run in document order.

## Decisions and open questions

${extras.decisions ?? "No open questions."}

## Risks and discovery debt

${extras.risks ?? "No known discovery debt."}

## Acceptance and verification

Run the focused plan-execute tests.

## Execution environment

- Default model: ${extras.defaultModel ?? "openai/gpt-5.6-sol"}
- Default reasoning: medium
${overrides}
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
    assert.match(first.selected.body, /^### WP1 — Foundation$/m);
    assert.match(first.selected.body, /^- Goal: Execute Foundation\.$/m);
    assert.match(first.selected.body, /^- Scope: Update the planned behavior\.$/m);
    assert.match(first.selected.body, /^- Out of scope: Unrelated changes\.$/m);
    assert.match(first.selected.body, /^- Acceptance criteria: Foundation is complete and verified\.$/m);
    assert.match(first.selected.body, /^- Verification: Run the focused check for WP1\.$/m);
    assert.equal(first.selected.body.includes("Delivers this package in the existing plan flow"), false);
    assert.equal(first.selected.body.includes("### WP2"), false);
    assert.deepEqual(first.selected.environment, {
        model: "openai/gpt-5.6-sol",
        reasoning: "medium",
        source: "plan-default",
    });

    completeWorkPackage({repoRoot: root, planPath, wpId: "WP1", evidence: "focused test passed"}, {now: NOW, verbose: true});
    const second = selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root}));
    assert.equal(second.selected.id, "WP2");
    assert.match(second.selected.body, /^### WP2 — Follow-up$/m);
    assert.match(second.selected.body, /^- Goal: Execute Follow-up\.$/m);
    assert.match(second.selected.body, /^- Verification: Run the focused check for WP2\.$/m);
    assert.equal(second.selected.body.includes("Delivers this package in the existing plan flow"), false);
    assert.equal(second.selected.body.includes("### WP1"), false);
});

it("hands decisions, answered questions, notes and the risks of the selected WP to the executor", () => {
    const root = temporaryRepository();
    const packages = Array.from({length: 10}, (_unused, index) => ({id: `WP${index + 1}`, title: `Package ${index + 1}`}));
    const {planPath} = makePlan(root, packages, "user-input:handoff", {
        decisions: [
            "- D1: Keep the existing contract.",
            "  Its callers stay unchanged.",
            "- Q1 [answered]: Which owner stays?",
            "  It decides the module boundary.",
            "  - Answer: Core stays the owner.",
            "    - Reason: Core already owns the contract.",
            "  - Source: current conversation",
            "- N1 [note]: Row click target; koszt: unpredictable result; podstawa: hipoteza; kierunek: confirm with the product owner.",
        ].join("\n"),
        risks: [
            "- R1 [medium]: WP1 may change the persisted format.",
            "- R2 [low]: WP10 depends on the new format.",
            "- R3 [low]: The whole rollout needs a final smoke run.",
            "  It runs after the last package.",
        ].join("\n"),
    });

    const first = selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root}));
    assert.deepEqual(first.selected.decisions, [
        {id: "D1", type: "decision", text: "Keep the existing contract.\nIts callers stay unchanged."},
        {
            id: "Q1",
            type: "question",
            status: "answered",
            text: "Which owner stays?\nIt decides the module boundary.",
            answer: "Core stays the owner.\n- Reason: Core already owns the contract.",
            source: "current conversation",
        },
        {
            id: "N1",
            type: "note",
            text: "Row click target; koszt: unpredictable result; podstawa: hipoteza; kierunek: confirm with the product owner.",
        },
    ]);
    assert.deepEqual(first.selected.risks.map((risk) => [risk.id, risk.level, risk.scope]), [
        ["R1", "medium", "work-package"],
        ["R3", "low", "plan"],
    ]);
    assert.equal(first.selected.risks[1].text, "The whole rollout needs a final smoke run.\nIt runs after the last package.");

    for (const id of packages.slice(0, 9).map((item) => item.id)) {
        completeWorkPackage({repoRoot: root, planPath, wpId: id, evidence: "focused test passed"}, {now: NOW});
    }
    const last = selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root}));
    assert.equal(last.selected.id, "WP10");
    assert.deepEqual(last.selected.risks.map((risk) => risk.id), ["R2", "R3"]);
});

it("ignores example Execution and WP headings inside fenced code when selecting and completing", () => {
    const root = temporaryRepository();
    const afterPackages = [
        "```md",
        "## Execution",
        "",
        "- [ ] WP7",
        "",
        "### WP9 — Example only",
        "```",
        "",
        "~~~md",
        "## Execution",
        "### WP8 — Tilde example",
        "~~~",
        "",
    ].join("\n");
    const {planPath} = makePlan(root, [{id: "WP1", title: "First"}, {id: "WP2", title: "Second"}], "user-input:fenced-headings", {afterPackages});

    const plan = loadExecutionPlan({planPath, repoRoot: root});
    assert.deepEqual(plan.packages.map((item) => item.id), ["WP1", "WP2"]);
    assert.equal(selectNextWorkPackage(plan).selected.id, "WP1");

    const completed = completeWorkPackage({repoRoot: root, planPath, wpId: "WP1", evidence: "focused test passed"}, {now: NOW, verbose: true});
    assert.match(completed.markdown, /^- \[x\] WP1 — 2026-08-26 — focused test passed$/m);
    assert.match(completed.markdown, /^- \[ \] WP7$/m);
    assert.equal(selectNextWorkPackage(loadExecutionPlan({planPath, repoRoot: root})).selected.id, "WP2");
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

it("compares the current profile with the selected work-package requirement", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Default profile"}], "user-input:preflight");
    const plan = loadExecutionPlan({planPath, repoRoot: root});

    const equal = await checkExecutionEnvironment(plan, {
        currentModel: "openai/gpt-5.6-sol",
        currentReasoning: "medium",
    });
    assert.equal(equal.sufficient, true);
    assert.equal(equal.action, "execute");

    const stronger = await checkExecutionEnvironment(plan, {
        currentModel: "deepseek/deepseek-v4",
        currentReasoning: "high",
    });
    assert.equal(stronger.sufficient, true);
    assert.equal(stronger.current.rank < stronger.required.rank, true);
    assert.equal(equal.source, "flags");
});

it("resolves the current profile from the session environment without flags", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Session profile"}], "user-input:session-env");

    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
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

it("matches the session profile across provider prefixes", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Provider agnostic"}], "user-input:provider-agnostic");

    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
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

it("lets explicit flags override the session environment", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Flag precedence"}], "user-input:flag-precedence");

    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
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

it("fails closed when neither flags nor the session environment provide a profile", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Unknown profile"}], "user-input:unknown-profile");

    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {env: {}});
    assert.equal(result.action, "decision-required");
    assert.equal(result.code, "SESSION_PROFILE_UNKNOWN");
    assert.equal(result.sufficient, false);
    assert.deepEqual(result.options, DECISION_OPTIONS);
});

it("rejects a partial explicit override instead of mixing flag and environment sources", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Partial override"}], "user-input:partial-override");

    await assert.rejects(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
            currentModel: "openai/gpt-5.6-sol",
            env: {OPENCODE_SESSION_VARIANT: "medium"},
        }),
        (error) => error instanceof PlanExecuteError && error.code === "INVALID_ARGUMENT",
    );
});

it("asks the agent to pair an unranked session profile instead of guessing its position", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Unranked"}], "user-input:unranked-profile");

    const fetchImpl = vi.fn();
    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        env: {
            OPENCODE_SESSION_MODEL: "openai/gpt-5.6-unknown",
            OPENCODE_SESSION_VARIANT: "max",
        },
        fetchImpl,
    });
    assert.equal(result.action, "pairing-required");
    assert.equal(result.reason, "ranking-labels-missing");
    assert.equal(result.sufficient, false);
    assert.deepEqual(result.current, {model: "openai/gpt-5.6-unknown", reasoning: "max"});
    assert.equal(fetchImpl.mock.calls.length, 0);
    await assert.rejects(() => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        currentModel: "Z", currentReasoning: "max", requiredLabel: "Sol (Medium)", fetchImpl,
    }), {code: "INVALID_ARGUMENT"});
});

it("accepts an explicit user attestation as the portable fallback for harnesses without a session profile", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{
        id: "WP1",
        title: "Attested",
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        justification: "higher capability required",
    }], "user-input:user-attested");

    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        userAttested: true,
        attestedWp: "WP1",
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
    assert.deepEqual(result.attestation, {wpId: "WP1", profile: null, reusable: false});
});

it("still validates the hierarchy for a user attestation instead of trusting blindly", async () => {
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

    await assert.rejects(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {userAttested: true, fsOps}),
        (error) => error instanceof PlanExecuteError && error.code === "UNRANKED_REQUIRED_PROFILE",
    );
});

it("keeps the environment path authoritative when a session profile is available", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Env wins"}], "user-input:env-wins");

    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        env: {
            OPENCODE_SESSION_MODEL: "openai/gpt-5.6-sol",
            OPENCODE_SESSION_VARIANT: "medium",
        },
    });

    assert.equal("attested" in result, false);
    assert.equal(result.source, "session-env");
    assert.notEqual(result.current, null);
});

it("requires exact profile scope for a user attestation combined with explicit flags", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Attested plus flags"}], "user-input:attested-flags");

    await assert.rejects(
        () => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
            userAttested: true,
            attestedWp: "WP1",
            currentModel: "deepseek/deepseek-v4",
            currentReasoning: "high",
        }),
        (error) => error instanceof PlanExecuteError && error.code === "ATTESTATION_SCOPE_MISMATCH",
    );
});

it("requests an environment change when the current profile ranks below the WP requirement", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{
        id: "WP1",
        title: "Higher requirement",
        model: "deepseek/deepseek-v4",
        reasoning: "high",
        justification: "higher capability required",
    }], "user-input:insufficient");

    const result = await checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), {
        currentModel: "openai/gpt-5.6-sol",
        currentReasoning: "medium",
    });
    assert.equal(result.sufficient, false);
    assert.equal(result.action, "change-environment");
});

it("keeps nonmonotonic local rank authoritative without fetching points", async () => {
    const root = temporaryRepository([{model: "X", reasoning: "low"}, {model: "Y", reasoning: "max"},
        {model: "G", reasoning: "medium"}, {model: "Y", reasoning: "medium"}]);
    const {planPath} = makePlan(root, [{id: "WP1", title: "Local order"}], "user-input:local-order", {defaultModel: "G"});
    const plan = loadExecutionPlan({planPath, repoRoot: root});
    const fetchImpl = vi.fn().mockResolvedValue(leaderboardResponse([
        {label: "Y (Max)", totalPoints: 25},
        {label: "G (Medium)", totalPoints: 35},
        {label: "Y (Medium)", totalPoints: 70},
    ]));
    const labels = {requiredLabel: "G (Medium)", currentLabel: "Y (Medium)"};
    const stronger = await checkExecutionEnvironment(plan, {currentModel: "Y", currentReasoning: "max", ...labels, fetchImpl});
    assert.equal(stronger.sufficient, true);
    assert.equal(stronger.source, "flags");
    const weaker = await checkExecutionEnvironment(plan, {currentModel: "Y", currentReasoning: "medium", ...labels, fetchImpl});
    assert.equal(weaker.sufficient, false);
    assert.deepEqual(weaker.options, DECISION_OPTIONS);
    assert.equal(fetchImpl.mock.calls.length, 0);
});

it("compares external pairs in one fresh read with the two-point boundary", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "External"}]);
    const plan = loadExecutionPlan({planPath, repoRoot: root});
    const rows = (score) => [{label: "GPT 5.6 Sol (Medium)", totalPoints: 35}, {label: "Z (Max)", totalPoints: score}];
    const labels = {requiredLabel: "GPT 5.6 Sol (Medium)", currentLabel: "Z (Max)"};
    const fetchImpl = vi.fn().mockResolvedValueOnce(leaderboardResponse(rows(33)))
        .mockResolvedValueOnce(leaderboardResponse(rows(32.99)));
    const first = await checkExecutionEnvironment(plan, {currentModel: "Z", currentReasoning: "max", ...labels, fetchImpl});
    assert.equal(first.sufficient, true);
    assert.equal(first.source, "leaderboard");
    assert.equal(first.profileSource, "flags");
    assert.equal(first.tolerance, 2);
    assert.equal(first.required.totalPoints, 35);
    assert.equal(first.current.label, "Z (Max)");
    const second = await checkExecutionEnvironment(plan, {env: {OPENCODE_SESSION_MODEL: "Z", OPENCODE_SESSION_VARIANT: "max"}, ...labels, fetchImpl});
    assert.equal(second.sufficient, false);
    assert.equal(second.profileSource, "session-env");
    assert.deepEqual(second.options, DECISION_OPTIONS);
    assert.equal(fetchImpl.mock.calls.length, 2);
    for (const [url, options] of fetchImpl.mock.calls) {
        assert.equal(url, LEADERBOARD_URL);
        assert.equal(options.cache, "no-store");
    }
});

it("asks rather than guessing on reasoning, unknown or shared labels and network failure", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "Gaps"}]);
    const plan = loadExecutionPlan({planPath, repoRoot: root});
    const required = {label: "GPT 5.6 Sol (Medium)", totalPoints: 35};
    const external = {label: "Z (Max)", totalPoints: 40};
    const labels = {requiredLabel: required.label, currentLabel: external.label};
    for (const [rows, options] of [[[external], labels], [[required], labels], [[required, {...external, label: "Z"}], labels],
        [[required, {...external, label: "Z (High)"}], labels], [[required, external], {...labels, currentLabel: required.label}]]) {
        const result = await checkExecutionEnvironment(plan, {currentModel: "Z", currentReasoning: "max", ...options,
            fetchImpl: async () => leaderboardResponse(rows)});
        assert.equal(result.action, "decision-required");
        assert.equal(result.sufficient, false);
        assert.deepEqual(result.options, DECISION_OPTIONS);
        assert.equal("totalPoints" in result.current, false);
    }
    const failed = await checkExecutionEnvironment(plan, {currentModel: "Z", currentReasoning: "max", ...labels,
        fetchImpl: async () => { throw new Error("private remote body"); }});
    assert.equal(failed.action, "decision-required");
    assert.equal(failed.code, "LEADERBOARD_FETCH_FAILED");
    assert.equal(JSON.stringify(failed).includes("private remote body"), false);
    const fetchImpl = vi.fn();
    const missingReasoning = await checkExecutionEnvironment(plan, {env: {OPENCODE_SESSION_MODEL: "Z"}, ...labels, fetchImpl});
    assert.equal(missingReasoning.code, "SESSION_PROFILE_UNKNOWN");
    assert.equal(fetchImpl.mock.calls.length, 0);
});

it("scopes attestation to one WP and observed profile with no automatic reuse", async () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "First", model: "deepseek/deepseek-v4", reasoning: "high", justification: "strong requirement"},
        {id: "WP2", title: "Second"}]);
    const plan = loadExecutionPlan({planPath, repoRoot: root});
    const fetchImpl = vi.fn();
    const options = {userAttested: true, attestedWp: "WP1", attestedModel: "openai/gpt-5.6-sol", attestedReasoning: "medium",
        currentModel: "openai/gpt-5.6-sol", currentReasoning: "medium", fetchImpl};
    const admitted = await checkExecutionEnvironment(plan, options);
    assert.equal(admitted.sufficient, true);
    assert.equal(admitted.source, "user-attested");
    assert.deepEqual(admitted.attestation, {wpId: "WP1", profile: {model: "openai/gpt-5.6-sol", reasoning: "medium"}, reusable: false});
    assert.equal(fetchImpl.mock.calls.length, 0);
    assert.equal((await checkExecutionEnvironment(plan, {...options, userAttested: false})).sufficient, false);
    for (const changed of [{currentModel: "Z"}, {currentReasoning: "high"}, {attestedWp: "WP2"}]) {
        await assert.rejects(() => checkExecutionEnvironment(plan, {...options, ...changed}), {code: "ATTESTATION_SCOPE_MISMATCH"});
    }
    completeWorkPackage({repoRoot: root, planPath, wpId: "WP1", evidence: "focused passed"}, {now: NOW});
    await assert.rejects(() => checkExecutionEnvironment(loadExecutionPlan({planPath, repoRoot: root}), options), {code: "ATTESTATION_SCOPE_MISMATCH"});
    const second = loadExecutionPlan({planPath, repoRoot: root});
    assert.equal((await checkExecutionEnvironment(second, {env: {}, userAttested: true, attestedWp: "WP2"})).sufficient, true);
    assert.equal((await checkExecutionEnvironment(second, {env: {}})).action, "decision-required");
    await assert.rejects(() => checkExecutionEnvironment(second, {env: {}, userAttested: true, attestedWp: "WP2",
        attestedModel: "Z", attestedReasoning: "max"}), {code: "ATTESTATION_SCOPE_MISMATCH"});
});

it("does not attest an invalid hierarchy or execute a non-ready plan through CLI", async () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Ready gate"}]);
    const plan = loadExecutionPlan({planPath: created.planPath, repoRoot: root});
    fs.writeFileSync(path.join(root, ".agents/config/model-hierarchy.json"), "{}");
    await assert.rejects(() => checkExecutionEnvironment(plan, {userAttested: true, attestedWp: "WP1", env: {}}), {code: "INVALID_MODEL_HIERARCHY"});
    const cli = spawnSync(process.execPath, [EXECUTE_SCRIPT, "check-environment", "--root", root, "--path", created.planPath,
        "--user-attested", "--attested-wp", "WP1"], {encoding: "utf8"});
    assert.equal(cli.status, 1);
    assert.equal(JSON.parse(cli.stderr).error, "PLAN_NOT_READY");
    const other = temporaryRepository();
    const unreviewed = makePlan(other, [{id: "WP1", title: "Unreviewed"}], "user-input:cli-unreviewed");
    fs.writeFileSync(unreviewed.planPath, unreviewed.saved.markdown.replace(/^(reviewed_revision|reviewed_body_sha256): .*\n/gm, ""));
    const pending = spawnSync(process.execPath, [EXECUTE_SCRIPT, "check-environment", "--root", other, "--path", unreviewed.planPath,
        "--user-attested", "--attested-wp", "WP1"], {encoding: "utf8"});
    assert.equal(pending.status, 1);
    assert.equal(JSON.parse(pending.stderr).error, "PLAN_NOT_READY");
});

it("smoke-checks CLI admission sources and the three-option user question contract", () => {
    const root = temporaryRepository();
    const {planPath} = makePlan(root, [{id: "WP1", title: "CLI sources"}]);
    const base = [EXECUTE_SCRIPT, "check-environment", "--root", root, "--path", planPath];
    const env = {...process.env, OPENCODE_SESSION_MODEL: "openai/gpt-5.6-sol", OPENCODE_SESSION_VARIANT: "medium"};
    const automatic = spawnSync(process.execPath, base, {env, encoding: "utf8"});
    assert.equal(automatic.status, 0);
    assert.equal(JSON.parse(automatic.stdout).source, "session-env");
    // Synthetic explicit confirmation; does not attest the real session.
    const attested = spawnSync(process.execPath, [...base, "--user-attested", "--attested-wp", "WP1",
        "--attested-model", env.OPENCODE_SESSION_MODEL, "--attested-reasoning", env.OPENCODE_SESSION_VARIANT], {env, encoding: "utf8"});
    assert.equal(attested.status, 0);
    assert.equal(JSON.parse(attested.stdout).source, "user-attested");
    const unknown = spawnSync(process.execPath, base, {env: {...env, OPENCODE_SESSION_VARIANT: ""}, encoding: "utf8"});
    assert.deepEqual(JSON.parse(unknown.stdout).options, DECISION_OPTIONS);
    const instructions = fs.readFileSync(new URL("../../../.agents/skills/plan-execute/SKILL.md", import.meta.url), "utf8");
    assert.match(instructions, /Czy zmieniasz profil, potwierdzasz wystarczalność obecnego/);
    assert.match(instructions, /czy zatrzymujemy wykonanie/);
    const malformed = spawnSync(process.execPath, [...base, "--current-model", "", "--current-reasoning", "medium"], {env, encoding: "utf8"});
    assert.equal(malformed.status, 2);
    assert.equal(JSON.parse(malformed.stderr).error, "INVALID_ARGUMENT");
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

it("refuses a plan without review keys until its review is recorded", () => {
    const root = temporaryRepository();
    const created = makePlan(root, [{id: "WP1", title: "Unreviewed"}], "user-input:no-review-keys");
    const legacy = created.saved.markdown.replace(/^(previous_sha256|reviewed_revision|reviewed_body_sha256|review_base_revision|review_base_sha256): .*\n/gm, "");
    fs.writeFileSync(created.planPath, legacy, "utf8");

    assert.throws(
        () => loadExecutionPlan({planPath: created.planPath, repoRoot: root}),
        (error) => error instanceof PlanExecuteError
            && error.code === "PLAN_NOT_READY"
            && error.details.blocked_reason === "review_pending"
            && /record-review/.test(error.message),
    );

    const reviewed = recordReview({
        repoRoot: root,
        planPath: created.planPath,
        decision: {
            ok: true,
            action: "finish-ready",
            reason: "plan-ready",
            plan: {plan_id: created.saved.plan_id, revision: created.saved.revision, content_sha256: crypto.createHash("sha256").update(legacy).digest("hex")},
        },
    }, {verbose: true});
    assert.equal(reviewed.status, "ready");
    assert.equal(loadExecutionPlan({planPath: created.planPath, repoRoot: root}).status, "ready");
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
