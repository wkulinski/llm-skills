import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {decideTargetedCheck, TargetedCheckAction} from "./targeted-check-decision.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../");
const HELPER = path.join(ROOT, ".agents/skills/_shared/scripts/targeted-check-decision.mjs");

test("runs a bounded test named by acceptance criteria", () => {
    assert.deepEqual(decideTargetedCheck({
        targetOrigin: "acceptance_criteria",
        targetScope: "file",
        targetCount: 1,
        matrixScope: "full",
    }), {
        action: TargetedCheckAction.RUN_TARGETED_TEST,
        reason: "bounded_acceptance_criteria_target",
    });
});

test("runs a bounded failing test from feedback and permits one retry", () => {
    assert.equal(decideTargetedCheck({
        targetOrigin: "feedback",
        targetScope: "method",
        targetCount: 1,
    }).action, TargetedCheckAction.RUN_TARGETED_TEST);

    assert.deepEqual(decideTargetedCheck({
        targetOrigin: "feedback",
        targetScope: "method",
        targetCount: 1,
        executionAttempted: true,
        failureKind: "test",
    }), {
        action: TargetedCheckAction.RUN_TARGETED_TEST,
        reason: "bounded_target_retry_after_test_failure",
    });
});

test("uses a point matrix command when no bounded test target exists", () => {
    assert.equal(decideTargetedCheck({matrixScope: "point"}).action, TargetedCheckAction.RUN_MATRIX_CHECK);
});

test("does not promote a full suite to a point fallback", () => {
    assert.deepEqual(decideTargetedCheck({matrixScope: "full"}), {
        action: TargetedCheckAction.REVIEW_ONLY,
        reason: "full_suite_requires_explicit_workflow",
    });

    assert.equal(decideTargetedCheck({
        targetOrigin: "acceptance_criteria",
        targetScope: "suite",
        targetCount: 1,
        matrixScope: "full",
    }).action, TargetedCheckAction.REVIEW_ONLY);
});

test("returns review-only instead of env blocker when no check exists", () => {
    assert.deepEqual(decideTargetedCheck({}), {
        action: TargetedCheckAction.REVIEW_ONLY,
        reason: "no_targeted_check_available",
    });
});

test("returns env blocker only after an actual environment failure", () => {
    assert.deepEqual(decideTargetedCheck({
        executionAttempted: true,
        failureKind: "environment",
    }), {
        action: TargetedCheckAction.ENV_BLOCKER,
        reason: "environment_failure_after_actual_attempt",
    });

    assert.throws(
        () => decideTargetedCheck({failureKind: "environment"}),
        /actual execution attempt/,
    );
});

test("rejects unbounded direct method targets", () => {
    assert.equal(decideTargetedCheck({
        targetOrigin: "acceptance_criteria",
        targetScope: "method",
        targetCount: 4,
    }).action, TargetedCheckAction.REVIEW_ONLY);
});

test("CLI renders the same deterministic decision", () => {
    const result = spawnSync(process.execPath, [
        HELPER,
        "--target-origin", "feedback",
        "--target-scope", "method",
        "--target-count", "1",
        "--matrix-scope", "full",
    ], {cwd: ROOT, encoding: "utf8"});

    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).action, TargetedCheckAction.RUN_TARGETED_TEST);
});

test("skill policy documents reference the helper and all decisions", () => {
    const documents = [
        ".agents/skills/code-implement/SKILL.md",
        ".agents/skills/_shared/references/runtime-collaboration-guidelines.md",
        ".agents/skills/_shared/references/runtime-quality-procedures.md",
    ];

    for (const document of documents) {
        const content = fs.readFileSync(path.join(ROOT, document), "utf8");
        assert.match(content, /targeted-check-decision\.mjs/, document);

        for (const action of Object.values(TargetedCheckAction)) {
            assert.match(content, new RegExp(action), `${document} does not mention ${action}`);
        }
    }

    const codeImplementSkill = fs.readFileSync(path.join(ROOT, documents[0]), "utf8");
    assert.match(codeImplementSkill, /shared_files:[\s\S]*_shared\/scripts\/targeted-check-decision\.mjs/);
    assert.match(codeImplementSkill, /shared_files:[\s\S]*_shared\/scripts\/targeted-check-decision\.test\.mjs/);
});
