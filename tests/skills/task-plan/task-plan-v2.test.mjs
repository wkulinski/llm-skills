import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {it} from "vitest";

import {
    buildPlanId,
    loadPersistedSource,
    normalizeFileSource,
    normalizeGitHubIssue,
    normalizeUserInput,
    persistSource,
    SourceError,
} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {
    completeWorkPackage,
    loadPlan,
    loadPlanFile,
    resolvePlanPaths,
    savePlan,
    StoreError,
} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {validatePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";
import {AtomicWriteError, writeFileAtomic} from "../../../.agents/skills/task-plan/scripts/atomic-file.mjs";

const NOW = "2026-08-24T12:00:00.000Z";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

function temporaryRepository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-v2-"));
    fs.mkdirSync(path.join(root, "docs", "plans"), {recursive: true});
    writeModelHierarchy(root);
    return root;
}

function writeModelHierarchy(root) {
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
}

function source(body = "Implement point one.") {
    return normalizeUserInput({identity: "owner/repository#123", title: "Example issue", body}, {fetched_at: NOW});
}

function completePlanBody({
    goal = "Implement the requested behavior.",
    confirmed = "src/Example.php",
    discovery = "none",
    decisions = "No open questions.",
} = {}) {
    return `# Example implementation plan

## Source and objective

Implement point one without adding a parallel mechanism.

## Source assessment

- Requested outcome: Point one works in the existing flow.
- Observed symptoms: The requested behavior is currently absent.
- Explicit constraints: Do not add a parallel mechanism.
- Suggested diagnosis or solution: The source suggests only the desired outcome, not an architecture.
- Claims verified in evidence: The current Example flow remains the owner.
- Claims corrected or still unverified: The exact implementation detail remains subject to focused discovery.

## Scope

The requested behavior is in scope. Unrelated refactors are out of scope.

## Direction, simplicity and consistency

- Existing mechanism reused: The current Example flow remains the owner.
- Simpler alternative considered: A local update was selected over a parallel service.
- Why the selected approach is minimal: Only the existing behavior changes.
- Duplicate or parallel responsibilities: None; WP1 keeps the current owner.
- Cross-WP consistency and ownership: WP1 is the only package and uses the existing owner.

## Source coverage

- Point 1 → WP1

## Work packages

### WP1 — Implement point one

- Source: Point 1
- Goal: ${goal}
- Scope: Update the existing behavior.
- Out of scope: Unrelated cleanup.
- Confirmed paths: ${confirmed}
- Candidate paths: none
- Discovery required: ${discovery}
- Estimated size: medium
- Acceptance criteria: Existing flow exposes the requested behavior.
- Verification: Run the focused unit test and inspect the resulting behavior.

## Order

WP1 runs first.

## Decisions and open questions

${decisions}

## Risks and discovery debt

No known discovery debt.

## Acceptance and verification

Run the focused unit test for WP1.

## Execution environment

- Default model: openai/gpt-5.6-sol
- Default reasoning: medium
- WP overrides: none

## Execution

- [ ] WP1

## Next action

Ask the user whether to implement, revise, or stop.
`;
}

function prepareSource(root, sourceValue = source()) {
    return persistSource(sourceValue, {repoRoot: root});
}

function saveInput(repoRoot, overrides = {}) {
    return {
        repo_root: repoRoot,
        source_identity: source().identity,
        markdown_body: completePlanBody(),
        context: null,
        ...overrides,
    };
}

it("normalizes and persists source without escaping repository root", () => {
    const root = temporaryRepository();
    fs.writeFileSync(path.join(root, "task.md"), "Plan this task.\n", "utf8");
    const file = normalizeFileSource({filePath: "./task.md", repoRoot: root, options: {fetched_at: NOW}});
    const persisted = persistSource(source(), {repoRoot: root});
    const loaded = loadPersistedSource({repoRoot: root, sourceIdentity: source().identity});

    assert.match(file.identity, /^file:task\.md:[a-f0-9]{12}$/);
    assert.equal(persisted.plan_id, buildPlanId(source().identity));
    assert.equal(loaded.source.body, "Implement point one.");
    assert.throws(
        () => normalizeFileSource({filePath: "../outside.md", repoRoot: root}),
        (error) => error instanceof SourceError && error.code === "UNSAFE_PATH",
    );
});

it("creates a plan from a GitHub issue containing only a title", () => {
    const root = temporaryRepository();
    const titleOnly = normalizeGitHubIssue({
        owner: "owner",
        repo: "repository",
        issue_number: 321,
        title: "Prepare the requested change",
        body: "",
    }, {fetched_at: NOW});
    persistSource(titleOnly, {repoRoot: root});

    const saved = savePlan({
        repo_root: root,
        source_identity: titleOnly.identity,
        markdown_body: completePlanBody(),
        context: null,
    }, {now: NOW});

    assert.equal(saved.status, "ready");
    assert.equal(loadPersistedSource({repoRoot: root, sourceIdentity: titleOnly.identity}).source.body, "");
    assert.throws(
        () => normalizeGitHubIssue({owner: "owner", repo: "repository", issue_number: 322, title: "", body: ""}, {fetched_at: NOW}),
        (error) => error instanceof SourceError && error.code === "INVALID_SOURCE",
    );
});

it("normalizes GitHub authors and comments with validated timestamps", () => {
    const normalized = normalizeGitHubIssue({
        owner: "owner",
        repo: "repository",
        issue_number: 123,
        title: "Structured issue",
        body: "Implement the structured request.",
        authors: [{login: "alice"}, "alice", {name: "Bob"}],
        comments: [
            "Plain comment",
            {body: "Structured comment", user: "carol", created_at: NOW},
        ],
        updated_at: NOW,
    }, {fetched_at: NOW});

    assert.deepEqual(normalized.authors, ["alice", "Bob"]);
    assert.deepEqual(normalized.comments, [
        {body: "Plain comment", author: null, created_at: null},
        {body: "Structured comment", author: "carol", created_at: NOW},
    ]);
    assert.equal(normalized.source_updated_at, NOW);
    assert.throws(
        () => normalizeGitHubIssue({
            owner: "owner",
            repo: "repository",
            issue_number: 123,
            title: "Invalid timestamp",
            comments: [{body: "Comment", created_at: "not-a-date"}],
        }, {fetched_at: NOW}),
        (error) => error instanceof SourceError && error.code === "INVALID_SOURCE",
    );
});

it("source-only is a valid resume point before a complete plan exists", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const loaded = loadPlan({repoRoot: root, sourceIdentity: source().identity});

    assert.equal(loaded.status, "source-only");
    assert.equal(loaded.markdown, null);
});

it("writes a ready Markdown plan without sidecar state", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const saved = savePlan(saveInput(root), {now: NOW});
    const loaded = loadPlan({repoRoot: root, sourceIdentity: source().identity});
    const paths = resolvePlanPaths({repoRoot: root, sourceIdentity: source().identity});

    assert.equal(saved.status, "ready");
    assert.equal(loaded.status, "ready");
    assert.match(saved.markdown, /revision: 1/);
    assert.doesNotMatch(saved.markdown, /^status:/m);
    assert.doesNotMatch(saved.markdown, /reviewed_at|blocking_questions|last_error/);
    assert.equal(paths.draftPath, path.join(root, "docs", "plans", `${saved.metadata.plan_id}.md`));
    assert.equal(fs.existsSync(path.join(path.dirname(paths.sourcePath), "state.json")), false);
});

it("requires one execution checkbox per work package", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const valid = savePlan(saveInput(root), {now: NOW});
    assert.equal(valid.validation.valid, true);
    assert.deepEqual(valid.validation.packages.map((packageRecord) => packageRecord.id), ["WP1"]);

    const duplicateEntry = completePlanBody().replace(
        "- [ ] WP1",
        "- [ ] WP1\n- [ ] WP1",
    );
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: duplicateEntry}), {now: NOW}),
        (error) => error instanceof StoreError
            && error.code === "INVALID_PLAN"
            && error.details.errors.some((message) => message.includes("duplicate work-package")),
    );

    const legacyStatus = completePlanBody().replace("- [ ] WP1", "- Status: not_started\n- [ ] WP1");
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: legacyStatus}), {now: NOW}),
        (error) => error instanceof StoreError
            && error.code === "INVALID_PLAN"
            && error.details.errors.some((message) => message.includes("Invalid Execution entry")),
    );

    const missingEvidence = completePlanBody().replace("- [ ] WP1", "- [x] WP1 — 2026-08-24 — none");
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: missingEvidence}), {now: NOW}),
        (error) => error instanceof StoreError
            && error.code === "INVALID_PLAN"
            && error.details.errors.some((message) => message.includes("concrete verification evidence")),
    );
});

it("requires concrete size, model and reasoning recommendations", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const invalidSize = completePlanBody().replace("- Estimated size: medium", "- Estimated size: huge");
    const invalidModel = completePlanBody().replace("- Default model: openai/gpt-5.6-sol", "- Default model: other/unranked");
    const invalidReasoning = completePlanBody().replace("- Default reasoning: medium", "- Default reasoning: none");

    for (const body of [invalidSize, invalidModel, invalidReasoning]) {
        assert.throws(
            () => savePlan(saveInput(root, {markdown_body: body}), {now: NOW}),
            (error) => error instanceof StoreError && error.code === "INVALID_PLAN",
        );
    }
});

it("requires the project-local model hierarchy", () => {
    const root = temporaryRepository();
    fs.unlinkSync(path.join(root, ".agents", "config", "model-hierarchy.json"));
    prepareSource(root);

    assert.throws(
        () => savePlan(saveInput(root), {now: NOW}),
        (error) => error instanceof StoreError
            && error.code === "INVALID_PLAN"
            && error.details.errors.some((message) => message.includes("Model hierarchy does not exist")),
    );
});

it("completes a work package through the task-plan store", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const saved = savePlan(saveInput(root), {now: NOW});
    const completed = completeWorkPackage({
        repoRoot: root,
        planPath: saved.paths.draft_path,
        wpId: "WP1",
        evidence: "focused unit test passed",
    }, {now: NOW});

    assert.equal(completed.changed, true);
    assert.equal(completed.metadata.revision, 2);
    assert.match(completed.markdown, /- \[x\] WP1 — 2026-08-24 — focused unit test passed/);
    assert.equal(loadPlanFile({repoRoot: root, planPath: saved.paths.draft_path}).status, "ready");
});

it("preserves replacement tokens in completion evidence", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const saved = savePlan(saveInput(root), {now: NOW});
    const completed = completeWorkPackage({
        repoRoot: root,
        planPath: saved.paths.draft_path,
        wpId: "WP1",
        evidence: "saw $& in output",
    }, {now: NOW});

    assert.match(completed.markdown, /- \[x\] WP1 — 2026-08-24 — saw \$& in output/);
});

it("rejects a plan id that does not belong to the source identity", () => {
    const root = temporaryRepository();
    prepareSource(root);

    assert.throws(
        () => resolvePlanPaths({repoRoot: root, sourceIdentity: source().identity, planId: "plan-wrong"}),
        (error) => error instanceof StoreError && error.code === "PLAN_ID_MISMATCH",
    );
});

it("derives blocked and ready from questions stored only in Markdown", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const open = "- Q1 [open]: Which existing contract should remain the owner?";
    const blocked = savePlan(saveInput(root, {markdown_body: completePlanBody({decisions: open})}), {now: NOW});
    assert.equal(blocked.status, "blocked");

    const answered = `- Q1 [answered]: Which existing contract should remain the owner?
  - Answer: Keep the existing Core contract.
  - Source: current conversation`;
    const ready = savePlan(saveInput(root, {markdown_body: completePlanBody({decisions: answered})}), {
        now: "2026-08-24T12:05:00.000Z",
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.metadata.revision, 2);
    assert.equal(ready.validation.questions[0].answer, "Keep the existing Core contract.");
});

it("rejects answered questions without visible answer provenance", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const decisions = `- Q1 [answered]: Which contract?
  - Answer: Use Core.`;
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: completePlanBody({decisions})}), {now: NOW}),
        (error) => error instanceof StoreError
            && error.code === "INVALID_PLAN"
            && error.details.errors.some((message) => message.includes("Source: current conversation")),
    );
});

it("requires critical source and direction reviews", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const missingSourceAssessment = completePlanBody().replace(
        "- Claims corrected or still unverified: The exact implementation detail remains subject to focused discovery.\n",
        "",
    );
    const missingDirection = completePlanBody().replace(
        "- Simpler alternative considered: A local update was selected over a parallel service.\n",
        "",
    );
    for (const body of [missingSourceAssessment, missingDirection]) {
        assert.throws(
            () => savePlan(saveInput(root, {markdown_body: body}), {now: NOW}),
            (error) => error instanceof StoreError && error.code === "INVALID_PLAN",
        );
    }
});

it("rejects none in essential package fields and requires evidence or discovery", () => {
    const root = temporaryRepository();
    prepareSource(root);
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: completePlanBody({goal: "none"})}), {now: NOW}),
        (error) => error instanceof StoreError && error.details.errors.some((message) => message.includes("Goal cannot be none")),
    );
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: completePlanBody({confirmed: "none", discovery: "none"})}), {now: NOW}),
        (error) => error instanceof StoreError && error.details.errors.some((message) => message.includes("confirmed paths or concrete discovery")),
    );
});

it("rejects duplicate work-package and question identifiers", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const duplicatePackage = completePlanBody().replace(
        "\n## Order",
        `\n### WP1 — Duplicate package

- Source: Point 1
- Goal: Duplicate the requested behavior.
- Scope: Duplicate scope.
- Out of scope: none
- Confirmed paths: src/Example.php
- Candidate paths: none
- Discovery required: none
- Estimated size: small
- Acceptance criteria: Duplicate acceptance.
- Verification: Duplicate verification.
\n## Order`,
    );
    const duplicateQuestion = completePlanBody({
        decisions: "- Q1 [open]: First question?\n- Q1 [open]: Duplicate question?",
    });

    for (const body of [duplicatePackage, duplicateQuestion]) {
        assert.throws(
            () => savePlan(saveInput(root, {markdown_body: body}), {now: NOW}),
            (error) => error instanceof StoreError
                && error.code === "INVALID_PLAN"
                && error.details.errors.some((message) => message.includes("Duplicate")),
        );
    }
});

it("rejects placeholders without replacing the last valid plan", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const first = savePlan(saveInput(root), {now: NOW});
    const placeholderBody = completePlanBody().replace("Implement the requested behavior.", "TODO");
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: placeholderBody}), {now: "2026-08-24T12:05:00.000Z"}),
        (error) => error instanceof StoreError && error.code === "INVALID_PLAN",
    );
    assert.equal(fs.readFileSync(first.paths.draft_path.startsWith("/") ? first.paths.draft_path : path.join(root, first.paths.draft_path), "utf8"), first.markdown);
});

it("rejects sidecar-era input fields", () => {
    const root = temporaryRepository();
    prepareSource(root);
    for (const field of ["status", "blocking_questions", "reviewed_at", "last_error", "state"]) {
        assert.throws(
            () => savePlan({...saveInput(root), [field]: field === "status" ? "ready" : {}}, {now: NOW}),
            (error) => error instanceof StoreError && error.code === "SIDECAR_INPUT_FORBIDDEN",
        );
    }
});

it("stores and verifies canonical context references in plan front matter", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const reportPath = path.join(root, "var", "agent", "context.report.json");
    const criteriaPath = path.join(root, "var", "agent", "context.criteria.json");
    fs.mkdirSync(path.dirname(reportPath), {recursive: true});
    fs.writeFileSync(reportPath, "{\"status\":\"COMPLETE\"}\n", "utf8");
    fs.writeFileSync(criteriaPath, "{\"version\":2}\n", "utf8");
    const context = {status: "COMPLETE", report_path: reportPath, criteria_path: criteriaPath};
    const saved = savePlan(saveInput(root, {context}), {now: NOW});
    assert.equal(saved.metadata.context_status, "COMPLETE");

    fs.writeFileSync(reportPath, "{\"status\":\"tampered\"}\n", "utf8");
    const loaded = loadPlan({repoRoot: root, sourceIdentity: source().identity});
    assert.equal(loaded.status, "invalid");
    assert.ok(loaded.validation.errors.some((message) => message.includes("context report hash")));
});

it("verifies context evidence whenever an incomplete canonical run is referenced", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const reportPath = path.join(root, "var", "agent", "incomplete-context.report.json");
    fs.mkdirSync(path.dirname(reportPath), {recursive: true});
    fs.writeFileSync(reportPath, "{\"status\":\"INCOMPLETE\"}\n", "utf8");
    const saved = savePlan(saveInput(root, {context: {status: "INCOMPLETE", report_path: reportPath}}), {now: NOW});
    assert.equal(saved.status, "ready");

    fs.writeFileSync(reportPath, "{\"status\":\"tampered\"}\n", "utf8");
    const loaded = loadPlan({repoRoot: root, sourceIdentity: source().identity});
    assert.equal(loaded.status, "invalid");
    assert.ok(loaded.validation.errors.some((message) => message.includes("context report hash")));
});

it("derives blocked from a blocked repository-context without requiring a synthetic question", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const saved = savePlan(saveInput(root, {context: {status: "BLOCKED"}}), {now: NOW});

    assert.equal(saved.validation.valid, true);
    assert.equal(saved.metadata.context_status, "BLOCKED");
    assert.equal(saved.status, "blocked");
});

it("detects source artifact tampering during resume", () => {
    const root = temporaryRepository();
    const persisted = prepareSource(root);
    savePlan(saveInput(root), {now: NOW});
    const artifactPath = path.join(root, persisted.source_artifact);
    const changed = {...source(), body: "Changed source body."};
    fs.writeFileSync(artifactPath, `${JSON.stringify(changed, null, 2)}\n`, "utf8");

    const loaded = loadPlan({repoRoot: root, sourceIdentity: source().identity});
    assert.equal(loaded.status, "invalid");
    assert.ok(loaded.validation.errors.some((message) => message.includes("source artifact hash")));
    const planBeforeRetry = fs.readFileSync(path.join(root, loaded.paths.draft_path), "utf8");
    assert.throws(
        () => savePlan(saveInput(root), {now: "2026-08-24T12:05:00.000Z"}),
        (error) => error instanceof StoreError && error.code === "SOURCE_ARTIFACT_CHANGED",
    );
    assert.equal(fs.readFileSync(path.join(root, loaded.paths.draft_path), "utf8"), planBeforeRetry);
});

it("keeps the last valid Markdown when atomic save fails", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const first = savePlan(saveInput(root, {markdown_body: completePlanBody({goal: "Stable goal."})}), {now: NOW});
    const failingFs = {
        ...fs,
        renameSync(from, to) {
            if (to.endsWith(".md")) {
                throw new Error("simulated rename failure");
            }
            return fs.renameSync(from, to);
        },
    };
    assert.throws(
        () => savePlan(saveInput(root, {markdown_body: completePlanBody({goal: "Uncommitted goal."})}), {
            now: "2026-08-24T12:05:00.000Z",
            fsOps: failingFs,
        }),
        (error) => error?.code === "WRITE_FAILED",
    );
    const persistedMarkdown = fs.readFileSync(path.join(root, first.paths.draft_path), "utf8");
    assert.match(persistedMarkdown, /Stable goal\./);
    assert.doesNotMatch(persistedMarkdown, /Uncommitted goal\./);
});

it("writes atomically inside the configured root and rejects path escape", () => {
    const root = temporaryRepository();
    const target = path.join(root, "var", "artifact.txt");

    const written = writeFileAtomic(target, "first\n", {rootDir: root});
    assert.equal(written.written, true);
    assert.equal(fs.readFileSync(target, "utf8"), "first\n");
    assert.throws(
        () => writeFileAtomic(path.join(root, "..", "outside.txt"), "unsafe\n", {rootDir: root}),
        (error) => error instanceof AtomicWriteError && error.code === "UNSAFE_PATH",
    );
});

it("CLI persists source, saves and validates a plan without sidecar", () => {
    const root = temporaryRepository();
    const sourceFile = path.join(root, "source-input.json");
    const planFile = path.join(root, "plan-input.json");
    fs.writeFileSync(sourceFile, JSON.stringify(source()), "utf8");
    const sourceScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/task-plan/scripts/source.mjs");
    const storeScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/task-plan/scripts/store.mjs");
    const validateScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/task-plan/scripts/validate.mjs");
    const persisted = spawnSync(process.execPath, [sourceScript, "persist", "--input", sourceFile, "--root", root], {encoding: "utf8"});
    assert.equal(persisted.status, 0, persisted.stderr);

    fs.writeFileSync(planFile, JSON.stringify(saveInput(root)), "utf8");
    const saved = spawnSync(process.execPath, [storeScript, "save", "--input", planFile], {encoding: "utf8"});
    assert.equal(saved.status, 0, saved.stderr);
    const savedResult = JSON.parse(saved.stdout);
    assert.equal(savedResult.status, "ready");

    const validated = spawnSync(process.execPath, [
        validateScript,
        "validate",
        "--file",
        path.join(root, savedResult.paths.draft_path),
        "--root",
        root,
    ], {encoding: "utf8"});
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).valid, true);
});

it("validation can run directly against persisted evidence", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const saved = savePlan(saveInput(root), {now: NOW});
    const validation = validatePlanDocument(saved.markdown, {repoRoot: root});
    assert.equal(validation.valid, true);
    assert.equal(validation.status, "ready");
    assert.match(saved.metadata.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root, saved.metadata.source_artifact))).digest("hex"), saved.metadata.source_sha256);
});

it("documents the repository-level task-plan test directory", () => {
    const skill = fs.readFileSync(path.join(ROOT, ".agents/skills/task-plan/SKILL.md"), "utf8");

    assert.match(skill, /tests\/skills\/task-plan\//);
    assert.doesNotMatch(skill, /<skill_dir>\/tests\//);
    assert.equal(fs.existsSync(path.join(ROOT, "tests/skills/task-plan/task-plan-v2.test.mjs")), true);
});
