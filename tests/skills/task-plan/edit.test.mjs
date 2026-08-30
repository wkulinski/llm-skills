import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {it} from "vitest";

import {applyOperation, editPlan} from "../../../.agents/skills/task-plan/scripts/edit.mjs";
import {buildPlanId, normalizeUserInput, persistSource} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {savePlan} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {validatePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";

function buildPlan() {
    return `# Fixture plan

## Source and objective
- Objective: exercise the structural editor.

## Source assessment
- Requested outcome: update a structured plan.
- Observed symptoms: a field needs editing.
- Explicit constraints: preserve the document contract.
- Suggested diagnosis or solution: use a structural selector.
- Claims verified in evidence: the fixture is valid.
- Claims corrected or still unverified: none.

## Scope
- In scope: the fixture.
- Out of scope: unrelated content.

## Direction, simplicity and consistency
- Existing mechanism reused: the task-plan store.
- Simpler alternative considered: none; arbitrary text replacement is unsafe.
- Why the selected approach is minimal: edit one selected node.
- Duplicate or parallel responsibilities: none; the store owns persistence.
- Cross-WP consistency and ownership: the fixture has one package.

## Source coverage
- Point 1: WP1.

## Work packages
### WP1 — Fixture package
- Source: Fixture source.
- Goal: Exercise a deterministic edit.
- Scope: One package field.
- Out of scope: Other packages.
- Confirmed paths: fixture source.
- Candidate paths: none.
- Discovery required: none.
- Dependencies: none.
- Estimated size: medium
- Acceptance criteria: The selected field changes.
- Verification: The targeted test passes.

## Order
- WP1: independent.

## Decisions and open questions
- Q1 [open]: Should the field be changed?

## Risks and discovery debt
- R1 [low]: The fixture is intentionally small.

## Acceptance and verification
- Check: validate the plan after editing.

## Execution environment

- Default model: openai/gpt-5.6-sol
- Default reasoning: medium
- WP overrides: none

## Execution

- [ ] WP1

## Next action
- Action: Run the targeted test.
`;
}
const EDIT_SCRIPT = path.join(process.cwd(), ".agents/skills/task-plan/scripts/edit.mjs");

function createFixture() {
    const root = fs.mkdtempSync(path.join(process.cwd(), "var/agent/cache/task-plan-edit-test-"));
    const configDir = path.join(root, ".agents", "config");
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), `${JSON.stringify({
        version: 1,
        order: "strongest-to-weakest",
        profiles: [
            {model: "deepseek/deepseek-v4", reasoning: "high"},
            {model: "openai/gpt-5.6-sol", reasoning: "medium"},
        ],
    }, null, 2)}\n`);
    const identity = `test/structural-editor/${path.basename(root)}`;
    const source = normalizeUserInput({
        body: "structural editor fixture",
        identity,
    }, {fetched_at: "2026-01-01T00:00:00.000Z"});
    persistSource(source, {repoRoot: root});
    const planId = buildPlanId(identity);
    const saved = savePlan({
        repo_root: root,
        source_identity: identity,
        plan_id: planId,
        markdown_body: buildPlan(),
        context: null,
        updated_at: "2026-01-01T00:00:01.000Z",
    });
    const file = path.join(root, saved.paths.draft_path);
    return {
        root,
        file,
        relativeFile: saved.paths.draft_path,
    };
}

function cleanup(fixture) {
    fs.rmSync(fixture.root, {recursive: true, force: true});
}

it("edit-bullet selects a WP bullet and persists through store", () => {
    const fixture = createFixture();
    try {
        const result = editPlan({
            file: fixture.relativeFile,
            operation: {
                type: "edit-bullet",
                work_package: "WP1",
                id: "Goal",
                value: "Use the structural editor.",
            },
        }, {repoRoot: fixture.root});

        assert.equal(result.changed, true);
        assert.equal(result.revision, 2);
        assert.equal(result.status, "blocked");
        assert.match(fs.readFileSync(fixture.file, "utf8"), /- Goal: Use the structural editor\./);
    } finally {
        cleanup(fixture);
    }
});

it("CLI exposes structural selectors and rejects legacy options", () => {
    const fixture = createFixture();
    try {
        const edited = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "edit-bullet",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--work-package", "WP1",
            "--id", "Goal",
            "--value", "Use the CLI structural editor.",
        ], {encoding: "utf8"});
        assert.equal(edited.status, 0, edited.stderr);
        assert.match(fs.readFileSync(fixture.file, "utf8"), /- Goal: Use the CLI structural editor\./);

        const next = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "add-bullet",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--section", "Risks and discovery debt",
            "--id", "R2",
            "--value", "Automatic numbering is not part of the contract.",
            "--next",
        ], {encoding: "utf8"});
        assert.notEqual(next.status, 0);
        assert.match(next.stderr, /UNSUPPORTED_OPTION/);

        const legacy = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "set-field",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--target", "Goal",
            "--field", "value",
            "--value", "must not be written",
        ], {encoding: "utf8"});
        assert.notEqual(legacy.status, 0);
        assert.match(legacy.stderr, /INVALID_ARGUMENT/);
        assert.match(fs.readFileSync(fixture.file, "utf8"), /- Goal: Use the CLI structural editor\./);
    } finally {
        cleanup(fixture);
    }
});

it("add-bullet creates a named bullet with an optional status", () => {
    const result = applyOperation(buildPlan(), {
        type: "add-bullet",
        section: "Risks and discovery debt",
        id: "R2",
        status: "medium",
        value: "The new operation needs a focused test.",
    });

    assert.equal(result.changed, true);
    assert.match(result.body, /- R2 \[medium\]: The new operation needs a focused test\./);
});

it("remove-bullet removes one named bullet", () => {
    const result = applyOperation(buildPlan(), {
        type: "remove-bullet",
        section: "Risks and discovery debt",
        id: "R1",
    });

    assert.equal(result.changed, true);
    assert.equal(result.body.includes("- R1 [low]:"), false);
});

it("bullet operations require one container and keep question blocks semantic", () => {
    assert.throws(
        () => applyOperation(buildPlan(), {
            type: "add-bullet",
            section: "Risks and discovery debt",
            work_package: "WP1",
            id: "R2",
            value: "Ambiguous target.",
        }),
        (error) => error.code === "INVALID_SELECTOR",
    );
    assert.throws(
        () => applyOperation(buildPlan(), {
            type: "remove-bullet",
            section: "Decisions and open questions",
            id: "Q1",
        }),
        (error) => error.code === "STRUCTURED_BULLET",
    );
    assert.throws(
        () => applyOperation(buildPlan(), {
            type: "add-bullet",
            section: "Risks and discovery debt",
            next: true,
            value: "Automatic numbering is not part of the contract.",
        }),
        (error) => error.code === "UNSUPPORTED_OPTION",
    );
    assert.throws(
        () => applyOperation(buildPlan(), {
            type: "edit-question",
            id: "Q1",
            source: "manual note",
            prompt: "Unsupported source edits are not implicit.",
        }),
        (error) => error.code === "UNSUPPORTED_OPTION",
    );
});

it("answer-question changes an open question into an answered question", () => {
    const result = applyOperation(buildPlan(), {
        type: "answer-question",
        id: "Q1",
        answer: "Yes.",
    });

    assert.equal(result.changed, true);
    assert.match(result.body, /- Q1 \[answered\]: Should the field be changed\?/);
    assert.match(result.body, /  - Answer: Yes\./);
    assert.match(result.body, /  - Source: current conversation/);
});

it("add-question inserts a structurally addressed question", () => {
    const result = applyOperation(buildPlan(), {
        type: "add-question",
        id: "Q2",
        prompt: "Should this be tested?",
        status: "answered",
        answer: "Yes.",
    });

    assert.equal(result.changed, true);
    assert.match(result.body, /- Q2 \[answered\]: Should this be tested\?/);
    assert.match(result.body, /  - Answer: Yes\./);
});

it("edit-question changes the semantic question block", () => {
    const answered = applyOperation(buildPlan(), {
        type: "edit-question",
        id: "Q1",
        prompt: "Should the selected field be changed?",
        status: "answered",
        answer: "Yes.",
    });

    assert.match(answered.body, /- Q1 \[answered\]: Should the selected field be changed\?/);
    assert.match(answered.body, /  - Answer: Yes\./);

    const reopened = applyOperation(answered.body, {
        type: "edit-question",
        id: "Q1",
        status: "open",
    });

    assert.match(reopened.body, /- Q1 \[open\]: Should the selected field be changed\?/);
    assert.equal(reopened.body.includes("  - Answer: Yes."), false);
    assert.equal(reopened.body.includes("  - Source: current conversation"), false);
});

it("remove-question removes the complete semantic block", () => {
    const answered = applyOperation(buildPlan(), {
        type: "edit-question",
        id: "Q1",
        status: "answered",
        answer: "Yes.",
    });
    const result = applyOperation(answered.body, {
        type: "remove-question",
        id: "Q1",
    });

    assert.equal(result.body.includes("- Q1 [answered]:"), false);
    assert.equal(result.body.includes("  - Answer: Yes."), false);
    assert.match(result.body, /## Decisions and open questions/);
});

it("duplicate and missing structural targets fail closed", () => {
    const duplicate = buildPlan().replace(
        "- Goal: Exercise a deterministic edit.",
        "- Goal: Exercise a deterministic edit.\n- Goal: Duplicate.",
    );

    assert.throws(
        () => applyOperation(duplicate, {
            type: "edit-bullet",
            work_package: "WP1",
            id: "Goal",
            value: "Updated.",
        }),
        (error) => error.code === "DUPLICATE_TARGET",
    );
    assert.throws(
        () => applyOperation(buildPlan(), {
            type: "edit-bullet",
            work_package: "WP1",
            id: "Missing",
            value: "Updated.",
        }),
        (error) => error.code === "TARGET_NOT_FOUND",
    );
});

it("plan validation rejects unnamed bullets but ignores fenced examples", () => {
    const fixture = createFixture();
    try {
        const markdown = fs.readFileSync(fixture.file, "utf8");
        const invalid = markdown.replace(
            "- R1 [low]: The fixture is intentionally small.",
            "- This risk has no named key.",
        );
        const invalidResult = validatePlanDocument(invalid, {repoRoot: fixture.root});
        assert.equal(invalidResult.valid, false);
        assert.match(invalidResult.errors.join("\n"), /Bullet must have a name/);

        const emptyName = markdown.replace(
            "- R1 [low]: The fixture is intentionally small.",
            "- : This risk has an empty key.",
        );
        const emptyNameResult = validatePlanDocument(emptyName, {repoRoot: fixture.root});
        assert.equal(emptyNameResult.valid, false);

        const fenced = markdown.replace(
            "## Risks and discovery debt",
            "```text\n- This is a fenced example.\n```\n\n## Risks and discovery debt",
        );
        const fencedResult = validatePlanDocument(fenced, {repoRoot: fixture.root});
        assert.equal(fencedResult.errors.some((error) => error.includes("fenced example")), false);
    } finally {
        cleanup(fixture);
    }
});

it("editPlan does not write when the selected target is missing", () => {
    const fixture = createFixture();
    try {
        const before = fs.readFileSync(fixture.file, "utf8");
        assert.throws(
            () => editPlan({
                file: fixture.relativeFile,
                operation: {
                    type: "edit-bullet",
                    work_package: "WP1",
                    id: "Missing",
                    value: "Updated.",
                },
            }, {repoRoot: fixture.root}),
            (error) => error.code === "TARGET_NOT_FOUND",
        );
        assert.equal(fs.readFileSync(fixture.file, "utf8"), before);
    } finally {
        cleanup(fixture);
    }
});

it("text resembling a field inside a fenced block is not selected", () => {
    const body = buildPlan().replace(
        "## Risks and discovery debt",
        "```text\n- Goal: fake field\n```\n\n## Risks and discovery debt",
    );
    const result = applyOperation(body, {
        type: "edit-bullet",
        work_package: "WP1",
        id: "Goal",
        value: "Updated.",
    });

    assert.equal(result.body.includes("- Goal: fake field"), true);
    assert.equal(result.body.includes("- Goal: Updated."), true);
});

it("dry-run never writes the proposed structural edit", () => {
    const fixture = createFixture();
    try {
        const before = fs.readFileSync(fixture.file, "utf8");
        const result = editPlan({
            file: fixture.relativeFile,
            dry_run: true,
            operation: {
                type: "edit-bullet",
                section: "Direction, simplicity and consistency",
                id: "Existing mechanism reused",
                value: "Do not persist this dry-run.",
            },
        }, {repoRoot: fixture.root});

        assert.equal(result.dry_run, true);
        assert.equal(fs.readFileSync(fixture.file, "utf8"), before);
    } finally {
        cleanup(fixture);
    }
});

it("dry-run validates the candidate plan before reporting success", () => {
    const fixture = createFixture();
    try {
        const before = fs.readFileSync(fixture.file, "utf8");
        assert.throws(
            () => editPlan({
                file: fixture.relativeFile,
                dry_run: true,
                operation: {
                    type: "edit-bullet",
                    work_package: "WP1",
                    id: "Goal",
                    value: "TODO",
                },
            }, {repoRoot: fixture.root}),
            (error) => error.code === "EDIT_INVALID",
        );
        assert.equal(fs.readFileSync(fixture.file, "utf8"), before);
    } finally {
        cleanup(fixture);
    }
});
