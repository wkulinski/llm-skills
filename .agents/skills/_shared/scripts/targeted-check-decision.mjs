#!/usr/bin/env node

import {pathToFileURL} from "node:url";

export const TargetedCheckAction = Object.freeze({
    RUN_TARGETED_TEST: "RUN_TARGETED_TEST",
    RUN_MATRIX_CHECK: "RUN_MATRIX_CHECK",
    REVIEW_ONLY: "REVIEW_ONLY",
    ENV_BLOCKER: "ENV_BLOCKER",
});

const TARGET_ORIGINS = new Set(["acceptance_criteria", "feedback"]);
const TARGET_SCOPES = new Set(["method", "file", "suite"]);
const MATRIX_SCOPES = new Set(["point", "full"]);
const FAILURE_KINDS = new Set(["test", "environment"]);

function assertEnum(value, allowed, name) {
    if (value !== null && !allowed.has(value)) {
        throw new TypeError(`${name} has unsupported value: ${value}`);
    }
}

function assertBoolean(value, name) {
    if (typeof value !== "boolean") {
        throw new TypeError(`${name} must be a boolean`);
    }
}

/**
 * @param {{
 *   targetOrigin?: "acceptance_criteria"|"feedback"|null,
 *   targetScope?: "method"|"file"|"suite"|null,
 *   targetCount?: number,
 *   matrixScope?: "point"|"full"|null,
 *   executionAttempted?: boolean,
 *   failureKind?: "test"|"environment"|null,
 * }} input
 * @returns {{action: string, reason: string}}
 */
export function decideTargetedCheck(input = {}) {
    const targetOrigin = input.targetOrigin ?? null;
    const targetScope = input.targetScope ?? null;
    const targetCount = input.targetCount ?? (targetOrigin === null ? 0 : 1);
    const matrixScope = input.matrixScope ?? null;
    const executionAttempted = input.executionAttempted ?? false;
    const failureKind = input.failureKind ?? null;

    assertEnum(targetOrigin, TARGET_ORIGINS, "targetOrigin");
    assertEnum(targetScope, TARGET_SCOPES, "targetScope");
    assertEnum(matrixScope, MATRIX_SCOPES, "matrixScope");
    assertEnum(failureKind, FAILURE_KINDS, "failureKind");
    assertBoolean(executionAttempted, "executionAttempted");

    if ((targetOrigin === null) !== (targetScope === null)) {
        throw new TypeError("targetOrigin and targetScope must be provided together");
    }

    if (!Number.isInteger(targetCount) || targetCount < 0) {
        throw new TypeError("targetCount must be a non-negative integer");
    }

    if (targetOrigin === null && targetCount !== 0) {
        throw new TypeError("targetCount must be 0 when no target is provided");
    }

    if (targetOrigin !== null && targetCount === 0) {
        throw new TypeError("targetCount must be positive when a target is provided");
    }

    if (failureKind !== null && !executionAttempted) {
        throw new TypeError("failureKind requires an actual execution attempt");
    }

    if (executionAttempted && failureKind === null) {
        throw new TypeError("executionAttempted requires failureKind; do not call the helper after PASS");
    }

    if (executionAttempted && failureKind === "environment") {
        return {
            action: TargetedCheckAction.ENV_BLOCKER,
            reason: "environment_failure_after_actual_attempt",
        };
    }

    const boundedTarget = targetOrigin !== null && (
        (targetScope === "file" && targetCount === 1)
        || (targetScope === "method" && targetCount >= 1 && targetCount <= 3)
    );

    if (boundedTarget) {
        return {
            action: TargetedCheckAction.RUN_TARGETED_TEST,
            reason: executionAttempted
                ? "bounded_target_retry_after_test_failure"
                : `bounded_${targetOrigin}_target`,
        };
    }

    if (matrixScope === "point") {
        return {
            action: TargetedCheckAction.RUN_MATRIX_CHECK,
            reason: "point_matrix_command_available",
        };
    }

    if (matrixScope === "full") {
        return {
            action: TargetedCheckAction.REVIEW_ONLY,
            reason: "full_suite_requires_explicit_workflow",
        };
    }

    return {
        action: TargetedCheckAction.REVIEW_ONLY,
        reason: targetOrigin === null
            ? "no_targeted_check_available"
            : "target_scope_not_bounded",
    };
}

function usage() {
    return [
        "Usage: node targeted-check-decision.mjs [options]",
        "  --target-origin acceptance_criteria|feedback|none",
        "  --target-scope method|file|suite|none",
        "  --target-count <number>",
        "  --matrix-scope point|full|none",
        "  --execution-attempted",
        "  --failure-kind test|environment|none",
    ].join("\n");
}

function parseCliArgs(args) {
    const input = {};

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];

        if (argument === "--help") {
            return {help: true, input};
        }

        if (argument === "--execution-attempted") {
            input.executionAttempted = true;
            continue;
        }

        const value = args[index + 1];
        if (value === undefined) {
            throw new TypeError(`Missing value for ${argument}`);
        }

        switch (argument) {
            case "--target-origin":
                input.targetOrigin = value === "none" ? null : value;
                break;
            case "--target-scope":
                input.targetScope = value === "none" ? null : value;
                break;
            case "--target-count":
                input.targetCount = Number(value);
                break;
            case "--matrix-scope":
                input.matrixScope = value === "none" ? null : value;
                break;
            case "--failure-kind":
                input.failureKind = value === "none" ? null : value;
                break;
            default:
                throw new TypeError(`Unknown argument: ${argument}`);
        }

        index += 1;
    }

    return {help: false, input};
}

function main() {
    try {
        const parsed = parseCliArgs(process.argv.slice(2));
        if (parsed.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }

        process.stdout.write(`${JSON.stringify(decideTargetedCheck(parsed.input))}\n`);
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}
