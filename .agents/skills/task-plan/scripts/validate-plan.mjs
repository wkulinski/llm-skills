#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {
    DRAFT_SECTIONS,
    parseDraftDocument,
    validateDraftDocument,
} from "./draft.mjs";
import {
    canApprovePlan,
    validateDecisionHistory,
    validatePackageRecords,
    PLAN_STATUSES,
    readSimplificationResult,
    SIMPLIFICATION_STATUSES,
    TERMINAL_PACKAGE_STATUSES,
} from "./state.mjs";

export const FINDING_SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const FINDING_STATUSES = Object.freeze(["open", "resolved", "accepted", "reopened"]);
export const REVIEW_LIMIT = 3;
export const SIMPLIFICATION_RESULTS = Object.freeze([
    "no-change",
    "simplified",
    "needs-user-decision",
]);

const REQUIRED_FINDING_FIELDS = Object.freeze([
    "id",
    "severity",
    "claim",
    "evidence",
    "evidence_ref",
    "impact",
    "recommendation",
    "status",
]);

export function validateFinding(finding, index = 0) {
    const errors = [];
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
        return [`Finding ${index + 1} must be an object.`];
    }

    for (const field of REQUIRED_FINDING_FIELDS) {
        if (!hasMeaningfulValue(finding[field])) {
            errors.push(`Finding ${index + 1} is missing ${field}.`);
        }
    }
    if (!FINDING_SEVERITIES.includes(finding.severity)) {
        errors.push(`Finding ${index + 1} has invalid severity.`);
    }
    if (!FINDING_STATUSES.includes(finding.status)) {
        errors.push(`Finding ${index + 1} has invalid status.`);
    }
    return errors;
}

export function validateFindings(findings) {
    if (!Array.isArray(findings)) {
        return ["Findings must be an array."];
    }
    return findings.flatMap((finding, index) => validateFinding(finding, index));
}

export function validateReviewHistory(history, maxIterations = REVIEW_LIMIT) {
    const errors = [];
    if (!Array.isArray(history)) {
        return ["Review history must be an array."];
    }
    if (history.length > maxIterations) {
        errors.push(`Review history exceeds the limit of ${maxIterations} iterations.`);
    }

    const iterations = new Set();
    let previousPlanVersion = 0;
    for (const [index, review] of history.entries()) {
        if (!review || typeof review !== "object" || !Number.isInteger(review.iteration)) {
            errors.push(`Review ${index + 1} must contain an integer iteration.`);
            continue;
        }
        if (review.iteration < 1 || review.iteration > maxIterations) {
            errors.push(`Review iteration ${review.iteration} is outside the allowed range.`);
        }
        if (iterations.has(review.iteration)) {
            errors.push(`Review iteration ${review.iteration} is duplicated.`);
        }
        iterations.add(review.iteration);
        if (Object.hasOwn(review, "plan_version")) {
            if (!Number.isInteger(review.plan_version) || review.plan_version < 1 || review.plan_version <= previousPlanVersion) {
                errors.push(`Review iteration ${review.iteration} must increase plan_version.`);
            }
            previousPlanVersion = review.plan_version;
        }
    }
    return errors;
}

export function validateSimplification(simplification) {
    const errors = [];
    if (!simplification || typeof simplification !== "object") {
        return ["Simplification result must be an object."];
    }
    if (simplification.result === "pending") {
        return errors;
    }
    if (!SIMPLIFICATION_RESULTS.includes(simplification.result)) {
        return [`Invalid simplification result: ${simplification.result ?? ""}.`];
    }

    if (simplification.result === "needs-user-decision") {
        return errors;
    }

    if (simplification.result === "no-change" && (!simplification.before || !simplification.after)) {
        return errors;
    }

    if (!simplification.before || !simplification.after) {
        return ["Resolved simplification must include before and after snapshots."];
    }
    for (const field of ["scope", "acceptance_criteria", "user_decisions", "required_evidence", "risks"]) {
        if (!Object.hasOwn(simplification.before, field) || !Object.hasOwn(simplification.after, field)) {
            errors.push(`Simplification snapshots must include ${field}.`);
        }
    }
    if (errors.length > 0) {
        return errors;
    }

    if (!sameValue(simplification.before.scope, simplification.after.scope)) {
        errors.push("Simplification changed scope.");
    }
    if (!containsAll(simplification.after.acceptance_criteria, simplification.before.acceptance_criteria)) {
        errors.push("Simplification removed acceptance criteria.");
    }
    if (!containsAll(simplification.after.user_decisions, simplification.before.user_decisions)) {
        errors.push("Simplification removed user decisions.");
    }
    if (!containsAll(simplification.after.required_evidence, simplification.before.required_evidence)) {
        errors.push("Simplification removed required evidence.");
    }
    if (!containsAll(simplification.after.risks, simplification.before.risks)) {
        errors.push("Simplification removed relevant risks.");
    }
    return errors;
}

export function validatePlanState(state) {
    const errors = [];
    if (!state || typeof state !== "object") {
        return {valid: false, errors: ["Plan state must be an object."]};
    }
    if (!Number.isInteger(state.plan_version) || state.plan_version < 1) {
        errors.push("Plan state must contain a positive integer plan_version.");
    }
    if (!PLAN_STATUSES.includes(state.plan_status)) {
        errors.push(`Invalid plan_status: ${state.plan_status ?? ""}.`);
    }
    if (Object.hasOwn(state, "simplification_status")
        && !SIMPLIFICATION_STATUSES.includes(state.simplification_status)) {
        errors.push(`Invalid simplification_status: ${state.simplification_status ?? ""}.`);
    }
    const nestedSimplificationResult = readSimplificationResult(state);
    if (nestedSimplificationResult !== null
        && Object.hasOwn(state, "simplification_status")
        && nestedSimplificationResult !== state.simplification_status) {
        errors.push("Simplification status does not match its nested result.");
    }
    if (Object.hasOwn(state, "blockers") && !Array.isArray(state.blockers)) {
        errors.push("Plan state blockers must be an array.");
    }

    if (!Array.isArray(state.packages)) {
        errors.push("Plan state must contain a packages array.");
    } else if (["awaiting-package-decisions", "approved"].includes(state.plan_status) && state.packages.length === 0) {
        errors.push("Plan state must contain at least one work package before package decisions or approval.");
    }
    const packageResult = validatePackageRecords(state.packages);
    errors.push(...packageResult.errors);
    for (const [index, item] of (Array.isArray(state.packages) ? state.packages : []).entries()) {
        if (!item || typeof item !== "object") {
            continue;
        }
        for (const field of ["goal", "scope", "acceptance_criteria", "risks", "questions"]) {
            if (!Object.hasOwn(item, field) || item[field] === null) {
                errors.push(`Package ${index + 1} is missing ${field}.`);
            }
        }
        if (!hasMeaningfulValue(item.goal) || !hasMeaningfulValue(item.scope) || !hasMeaningfulValue(item.acceptance_criteria)) {
            errors.push(`Package ${index + 1} must contain goal, scope and acceptance criteria.`);
        }
    }

    const decisions = state.decisions ?? [];
    errors.push(...validateDecisionHistory(decisions));
    if (Array.isArray(state.packages) && Array.isArray(decisions)) {
        for (const item of state.packages) {
            if (item && TERMINAL_PACKAGE_STATUSES.includes(item.decision_status)
                && !decisions.some((decision) => decision.package_id === item.id && decision.decision === item.decision_status)) {
                errors.push(`Package ${item.id} is missing its decision history.`);
            }
        }
    }
    errors.push(...validateFindings(state.findings ?? []));
    errors.push(...validateReviewHistory(state.review_history ?? []));
    errors.push(...validateSimplification(state.simplification ?? {
        result: state.simplification_status,
        before: state.simplification_before,
        after: state.simplification_after,
    }));

    const approval = canApprovePlan(state);
    if (state.plan_status === "approved" && !approval.approved) {
        errors.push(`Approved plan failed approval guard: ${approval.reasons.join(", ")}.`);
    }
    if (state.plan_status === "approved" && (!Array.isArray(state.review_history) || state.review_history.length === 0)) {
        errors.push("Approved plan must contain review history.");
    }

    return {
        valid: errors.length === 0,
        errors,
        approval,
    };
}

export function validatePlanDocument(document, options = {}) {
    const draftResult = typeof document === "string"
        ? validateDraftDocument(document, {kind: options.kind ?? "main"})
        : validateDraftObject(document, options);
    const errors = [...draftResult.errors];

    if (options.state) {
        errors.push(...validatePlanState(options.state).errors);
    }

    return {
        valid: errors.length === 0,
        errors,
        metadata: draftResult.metadata,
        missingSections: draftResult.missingSections,
    };
}

export function validateFinalApproval(state) {
    const result = validatePlanState(state);
    if (!result.approval.approved) {
        result.errors.push(`Final approval blocked: ${result.approval.reasons.join(", ")}.`);
        result.valid = false;
    }
    return result;
}

function validateDraftObject(document, options) {
    if (!document || typeof document !== "object") {
        return {valid: false, errors: ["Draft document must be an object."], metadata: {}, missingSections: [...DRAFT_SECTIONS]};
    }
    if (typeof document.source === "string") {
        const draft = parseDraftDocument(document.source);
        return validateDraftDocument(draft, {kind: options.kind ?? "main"});
    }
    return validateDraftDocument(document, {kind: options.kind ?? "main"});
}

function hasMeaningfulValue(value) {
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (value && typeof value === "object") {
        return Object.keys(value).length > 0;
    }
    return typeof value === "string" ? value.trim() !== "" : Boolean(value);
}

function containsAll(after, before) {
    if (!Array.isArray(after) || !Array.isArray(before)) {
        return false;
    }
    return before.every((value) => after.some((candidate) => sameValue(candidate, value)));
}

function sameValue(left, right) {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function parseArgs(args) {
    const parsed = {command: args.shift() ?? null, values: {}};
    while (args.length > 0) {
        const key = args.shift();
        if (!key.startsWith("--")) {
            throw new Error(`Unexpected argument: ${key}.`);
        }
        const value = args.shift();
        if (typeof value !== "string") {
            throw new Error(`Missing value for ${key}.`);
        }
        parsed.values[key.slice(2)] = value;
    }
    return parsed;
}

function cliResult(parsed) {
    if (parsed.command === "validate") {
        const source = fs.readFileSync(path.resolve(parsed.values.file), "utf8");
        const state = parsed.values.state
            ? JSON.parse(fs.readFileSync(path.resolve(parsed.values.state), "utf8"))
            : null;
        return validatePlanDocument(source, {kind: parsed.values.kind ?? "main", state});
    }
    if (parsed.command === "validate-state") {
        const state = JSON.parse(fs.readFileSync(path.resolve(parsed.values.file), "utf8"));
        return validatePlanState(state);
    }
    throw new Error("Use validate or validate-state.");
}

function main(args) {
    if (args[0] === "--help") {
        process.stdout.write("Usage: validate-plan.mjs validate --file <draft> [--state <json>] | validate-state --file <json>\n");
        return 0;
    }
    try {
        const result = cliResult(parseArgs(args));
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result.valid ? 0 : 1;
    } catch (error) {
        process.stdout.write(`${JSON.stringify({valid: false, code: "VALIDATION_ERROR", message: String(error)})}\n`);
        return 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
