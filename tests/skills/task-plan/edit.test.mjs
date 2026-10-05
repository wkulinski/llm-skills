import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {it} from "vitest";

import {applyOperation, editPlan} from "../../../.agents/skills/task-plan/scripts/edit.mjs";
import {buildPlanId, normalizeUserInput, persistSource} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {savePlan} from "../../../.agents/skills/task-plan/scripts/store.mjs";
import {parseQuestions, validatePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate.mjs";

function buildPlan() {
    return `# Fixture plan

## Execution

- [ ] WP1

## Work package summaries

- WP1 — Fixture package: Updates only the current package through the structural editor and leaves all other packages unchanged.

## Source and objective
- Objective: exercise the structural editor.

## Source assessment
- Requested outcome: update a structured plan.
- Observed symptoms: a field needs editing.
- Explicit constraints: preserve the document contract.
- Suggested diagnosis or solution: use a structural selector.
- Claims verified in evidence: the fixture is valid.
- Claims corrected or still unverified: No claim was corrected; every claim is backed by the listed evidence.

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
    }, {verbose: true});
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

        const multiLine = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "edit-bullet",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--work-package", "WP1",
            "--id", "Scope",
            "--value", "One package field.\nThe CLI keeps the second line.",
        ], {encoding: "utf8"});
        assert.equal(multiLine.status, 0, multiLine.stderr);
        assert.match(fs.readFileSync(fixture.file, "utf8"), /^- Scope: One package field\.\n {2}The CLI keeps the second line\.\n- Out of scope:/m);

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

it("CLI edit returns a compact projection by default and full Markdown with --verbose", () => {
    const fixture = createFixture();
    try {
        const compact = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "edit-bullet",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--work-package", "WP1",
            "--id", "Goal",
            "--value", "Compact CLI projection.",
        ], {encoding: "utf8"});
        assert.equal(compact.status, 0, compact.stderr);
        const compactResult = JSON.parse(compact.stdout);
        assert.equal(compactResult.ok, true);
        assert.equal(compactResult.changed, true);
        assert.equal(compactResult.revision, 2);
        assert.match(compactResult.content_sha256, /^[a-f0-9]{64}$/);
        assert.deepEqual(compactResult.changed_work_packages, ["WP1"]);
        assert.equal(Object.hasOwn(compactResult, "markdown"), false);
        assert.equal(Object.hasOwn(compactResult, "validation"), false);
        assert.equal(compact.stdout.includes("## Work packages"), false);

        const verbose = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "edit-bullet",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--work-package", "WP1",
            "--id", "Goal",
            "--value", "Verbose CLI projection.",
            "--verbose",
        ], {encoding: "utf8"});
        assert.equal(verbose.status, 0, verbose.stderr);
        const verboseResult = JSON.parse(verbose.stdout);
        assert.match(verboseResult.markdown, /- Goal: Verbose CLI projection\./);
        assert.equal(verboseResult.revision, 3);
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

it("bullet operations treat a multi-line bullet as one block in every container", () => {
    const multiLine = buildPlan()
        .replace(
            "- WP1 — Fixture package: Updates only the current package through the structural editor and leaves all other packages unchanged.",
            "- WP1 — Fixture package: Updates only the current package.\n  It leaves all other packages unchanged.",
        )
        .replace("- Scope: One package field.", "- Scope: One package field.\n  - Detail: The field keeps its owner.")
        .replace("- WP overrides: none", "- WP overrides: configured\n  - WP1: model=openai/gpt-5.6-sol; reasoning=high; justification=fixture");

    const summary = applyOperation(multiLine, {
        type: "edit-bullet",
        section: "Work package summaries",
        id: "WP1 — Fixture package",
        value: "Updates the selected package.\nOther packages stay unchanged.",
    });
    assert.match(summary.body, /^- WP1 — Fixture package: Updates the selected package\.\n {2}Other packages stay unchanged\.\n\n## Source and objective$/m);

    const scope = applyOperation(multiLine, {
        type: "edit-bullet",
        work_package: "WP1",
        id: "Scope",
        value: "Two package fields.\n- Detail: Both fields keep their owner.\n  - Note: Nested indentation is preserved.",
    });
    assert.match(scope.body, /^- Scope: Two package fields\.\n {2}- Detail: Both fields keep their owner\.\n {4}- Note: Nested indentation is preserved\.\n- Out of scope:/m);
    assert.equal(scope.body.includes("The field keeps its owner."), false);

    const statusOnly = applyOperation(multiLine, {
        type: "edit-bullet",
        work_package: "WP1",
        id: "Scope",
        status: "kept",
    });
    assert.match(statusOnly.body, /^- Scope \[kept\]: One package field\.\n {2}- Detail: The field keeps its owner\.$/m);

    const removed = applyOperation(multiLine, {
        type: "remove-bullet",
        section: "Execution environment",
        id: "WP overrides",
    });
    assert.equal(removed.body.includes("WP overrides"), false);
    assert.equal(removed.body.includes("justification=fixture"), false);
    assert.match(removed.body, /^- Default reasoning: medium\n\n## Next action$/m);

    const added = applyOperation(multiLine, {
        type: "add-bullet",
        section: "Risks and discovery debt",
        id: "R2",
        status: "medium",
        value: "The risk has two lines.\nThe second line explains it.",
    });
    assert.match(added.body, /^- R2 \[medium\]: The risk has two lines\.\n {2}The second line explains it\.\n\n## Acceptance and verification$/m);
});

it("bullet blocks include an indented fenced block and end before an unindented one", () => {
    const indented = buildPlan().replace(
        "- Scope: One package field.",
        "- Scope: One package field.\n  ```text\n  Own example.\n  ```",
    );
    const scope = applyOperation(indented, {
        type: "remove-bullet",
        work_package: "WP1",
        id: "Scope",
    });
    assert.equal(scope.body.includes("Own example."), false);

    const topLevel = buildPlan().replace(
        "- R1 [low]: The fixture is intentionally small.\n",
        "- R1 [low]: The fixture is intentionally small.\n\n```text\nNot part of the bullet.\n```\n",
    );
    const removed = applyOperation(topLevel, {
        type: "remove-bullet",
        section: "Risks and discovery debt",
        id: "R1",
    });
    assert.equal(removed.body.includes("- R1 [low]:"), false);
    assert.equal(removed.body.includes("Not part of the bullet."), true);
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

it("question operations keep multi-line prompts and answers as one block", () => {
    const multiLine = buildPlan().replace(
        "- Q1 [open]: Should the field be changed?",
        "- Q1 [open]: Should the field be changed?\n  The change affects every reader.\n- D1: The field keeps its owner.",
    );

    const answered = applyOperation(multiLine, {
        type: "answer-question",
        id: "Q1",
        answer: "Yes.\n- Reason: The readers need the new value.",
    });
    assert.match(answered.body, /^- Q1 \[answered\]: Should the field be changed\?\n {2}The change affects every reader\.\n {2}- Answer: Yes\.\n {4}- Reason: The readers need the new value\.\n {2}- Source: current conversation\n- D1: The field keeps its owner\.$/m);
    assert.deepEqual(parseQuestions(answered.body).questions, [{
        id: "Q1",
        status: "answered",
        prompt: "Should the field be changed?\nThe change affects every reader.",
        answer: "Yes.\n- Reason: The readers need the new value.",
        source: "current conversation",
    }]);

    const reworded = applyOperation(answered.body, {
        type: "edit-question",
        id: "Q1",
        prompt: "Should the field change?\nOnly the owner decides.",
    });
    assert.match(reworded.body, /^- Q1 \[answered\]: Should the field change\?\n {2}Only the owner decides\.\n {2}- Answer: Yes\.\n {4}- Reason: The readers need the new value\.\n {2}- Source: current conversation$/m);

    const reopened = applyOperation(answered.body, {type: "edit-question", id: "Q1", status: "open"});
    assert.match(reopened.body, /^- Q1 \[open\]: Should the field be changed\?\n {2}The change affects every reader\.\n- D1: The field keeps its owner\.$/m);
    assert.equal(reopened.body.includes("The readers need the new value"), false);

    const removed = applyOperation(answered.body, {type: "remove-question", id: "Q1"});
    assert.match(removed.body, /^## Decisions and open questions\n- D1: The field keeps its owner\.$/m);

    const added = applyOperation(multiLine, {
        type: "add-question",
        id: "Q2",
        status: "answered",
        prompt: "Who reviews the change?\nThe reviewer must know the module.",
        answer: "The module owner.\nA second reviewer is optional.",
    });
    assert.match(added.body, /^- Q2 \[answered\]: Who reviews the change\?\n {2}The reviewer must know the module\.\n {2}- Answer: The module owner\.\n {4}A second reviewer is optional\.\n {2}- Source: current conversation$/m);

    assert.throws(
        () => applyOperation(multiLine, {type: "edit-question", id: "Q1", prompt: "Should it change?\n- Answer: Yes."}),
        (error) => error.code === "INVALID_ARGUMENT",
    );
    assert.throws(
        () => applyOperation(answered.body.replace("  - Source: current conversation", "  - Source: current conversation\n  - Extra: Not a question field."), {
            type: "edit-question",
            id: "Q1",
            prompt: "Should the field change?",
        }),
        (error) => error.code === "MALFORMED_QUESTION",
    );
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

it("applies a batch in memory and persists one revision", () => {
    const fixture = createFixture();
    try {
        const result = editPlan({
            file: fixture.relativeFile,
            operations: [
                {
                    type: "edit-bullet",
                    work_package: "WP1",
                    id: "Goal",
                    value: "Apply the complete batch.",
                },
                {
                    type: "edit-bullet",
                    work_package: "WP1",
                    id: "Scope",
                    value: "Two coordinated fields.",
                },
            ],
        }, {repoRoot: fixture.root});

        assert.equal(result.changed, true);
        assert.equal(result.revision, 2);
        const markdown = fs.readFileSync(fixture.file, "utf8");
        assert.match(markdown, /- Goal: Apply the complete batch\./);
        assert.match(markdown, /- Scope: Two coordinated fields\./);
    } finally {
        cleanup(fixture);
    }
});

it("apply-operations CLI accepts an operations array over stdin and writes one revision", () => {
    const fixture = createFixture();
    try {
        const batched = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "apply-operations",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--input", "-",
        ], {
            encoding: "utf8",
            input: JSON.stringify({
                operations: [
                    {type: "edit-bullet", work_package: "WP1", id: "Goal", value: "Batch CLI goal."},
                    {type: "edit-bullet", work_package: "WP1", id: "Scope", value: "Batch CLI scope."},
                ],
            }),
        });
        assert.equal(batched.status, 0, batched.stderr);
        const result = JSON.parse(batched.stdout);
        assert.equal(result.changed, true);
        assert.equal(result.revision, 2);
        assert.match(fs.readFileSync(fixture.file, "utf8"), /- Goal: Batch CLI goal\./);
        assert.match(fs.readFileSync(fixture.file, "utf8"), /- Scope: Batch CLI scope\./);

        const failing = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "apply-operations",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--input", "-",
        ], {
            encoding: "utf8",
            input: JSON.stringify({
                operations: [
                    {type: "edit-bullet", work_package: "WP1", id: "Goal", value: "Must roll back."},
                    {type: "edit-bullet", work_package: "WP1", id: "Missing", value: "Fails the batch."},
                ],
            }),
        });
        assert.notEqual(failing.status, 0);
        assert.match(failing.stderr, /TARGET_NOT_FOUND/);
        assert.match(fs.readFileSync(fixture.file, "utf8"), /- Goal: Batch CLI goal\./);
        assert.doesNotMatch(fs.readFileSync(fixture.file, "utf8"), /Must roll back\./);

        const malformed = spawnSync(process.execPath, [
            EDIT_SCRIPT,
            "apply-operations",
            "--file", fixture.relativeFile,
            "--root", fixture.root,
            "--input", "-",
        ], {encoding: "utf8", input: JSON.stringify({operations: []})});
        assert.notEqual(malformed.status, 0);
        assert.match(malformed.stderr, /non-empty operations array/);
    } finally {
        cleanup(fixture);
    }
});

it("does not persist any batch operation when a later operation fails", () => {
    const fixture = createFixture();
    try {
        const before = fs.readFileSync(fixture.file, "utf8");
        assert.throws(
            () => editPlan({
                file: fixture.relativeFile,
                operations: [
                    {
                        type: "edit-bullet",
                        work_package: "WP1",
                        id: "Goal",
                        value: "Must be rolled back.",
                    },
                    {
                        type: "edit-bullet",
                        work_package: "WP1",
                        id: "Missing",
                        value: "Fails the batch.",
                    },
                ],
            }, {repoRoot: fixture.root}),
            (error) => error.code === "TARGET_NOT_FOUND",
        );
        assert.equal(fs.readFileSync(fixture.file, "utf8"), before);
    } finally {
        cleanup(fixture);
    }
});

it("rejects an edit when its snapshot changes before the canonical save", () => {
    const fixture = createFixture();
    try {
        let planReads = 0;
        let concurrentBytes = null;
        const racingFs = {
            ...fs,
            readFileSync(file, ...args) {
                if (path.resolve(file) === fixture.file) {
                    planReads += 1;
                    if (planReads === 3) {
                        concurrentBytes = fs.readFileSync(file, "utf8").replace(
                            "- Goal: Exercise a deterministic edit.",
                            "- Goal: Concurrent writer won.",
                        );
                        fs.writeFileSync(file, concurrentBytes, "utf8");
                    }
                }
                return fs.readFileSync(file, ...args);
            },
        };

        assert.throws(
            () => editPlan({
                file: fixture.relativeFile,
                operation: {
                    type: "edit-bullet",
                    work_package: "WP1",
                    id: "Goal",
                    value: "Stale writer.",
                },
            }, {repoRoot: fixture.root, fsOps: racingFs}),
            (error) => error.code === "PLAN_CONFLICT",
        );
        assert.equal(fs.readFileSync(fixture.file, "utf8"), concurrentBytes);
        assert.doesNotMatch(concurrentBytes, /Stale writer\./);
    } finally {
        cleanup(fixture);
    }
});
