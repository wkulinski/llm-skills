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
    canOpenPackageDecisions,
    validateDecisionHistory,
    validatePackageRecords,
    validateQuestionDecisionPropagation,
    validateSessionStrategy,
    validateUserDecisionRecords,
    PLAN_STATUSES,
    readSimplificationResult,
    REDUNDANT_DESIGN_ELEMENT,
    SIMPLIFICATION_STATUSES,
    TERMINAL_PACKAGE_STATUSES,
    validateQuestionRecords,
    validateOwnershipRedundancyReview,
} from "./state.mjs";

export const FINDING_SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const FINDING_STATUSES = Object.freeze(["open", "resolved", "accepted", "reopened"]);
export const REVIEW_LIMIT = 3;
export const SIMPLIFICATION_RESULTS = Object.freeze([
    "no-change",
    "simplified",
    "needs-user-decision",
]);

const OWNERSHIP_SNAPSHOT_FIELDS = Object.freeze(["ownership_redundancy_review"]);

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
    if (Object.hasOwn(finding, "code")
        && (!isMeaningfulString(finding.code))) {
        errors.push(`Finding ${index + 1} code must be a non-empty string.`);
    }
    if (finding.code === REDUNDANT_DESIGN_ELEMENT) {
        errors.push(...validateRedundantFinding(finding, index));
    }
    return errors;
}

function validateRedundantFinding(finding, index) {
    const errors = [];
    if (!isMeaningfulString(finding.subject_id) || !/^OR[1-9][0-9]*$/.test(finding.subject_id)) {
        errors.push(`Finding ${index + 1} subject_id must match OR<number>.`);
    }
    if (finding.status !== "accepted") {
        return errors;
    }
    for (const field of ["decision_ref", "decision_source", "decided_at"]) {
        if (!isMeaningfulString(finding[field])) {
            errors.push(`Finding ${index + 1} is missing ${field} for an accepted redundancy finding.`);
        }
    }
    if (isMeaningfulString(finding.decided_at) && Number.isNaN(Date.parse(finding.decided_at))) {
        errors.push(`Finding ${index + 1} decided_at must be a valid timestamp.`);
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

export function validateSimplification(simplification, options = {}) {
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
    const snapshotFields = ["scope", "acceptance_criteria", "user_decisions", "required_evidence", "risks"];
    const hasOwnershipSnapshot = OWNERSHIP_SNAPSHOT_FIELDS.some((field) => {
        return Object.hasOwn(simplification.before, field) || Object.hasOwn(simplification.after, field);
    });
    if (options.requireOwnershipReview || hasOwnershipSnapshot) {
        snapshotFields.push("ownership_redundancy_review");
    }
    for (const field of snapshotFields) {
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
    errors.push(...validateOwnershipSimplificationSnapshots(simplification.before, simplification.after));
    return errors;
}

function validateOwnershipSimplificationSnapshots(before, after) {
    const errors = [];
    const beforeReview = before.ownership_redundancy_review;
    const afterReview = after.ownership_redundancy_review;
    const hasBeforeReview = Object.hasOwn(before, "ownership_redundancy_review");
    const hasAfterReview = Object.hasOwn(after, "ownership_redundancy_review");

    if (hasBeforeReview && hasAfterReview) {
        errors.push(...validateOwnershipReviewSnapshot(beforeReview, afterReview));
    }

    for (const field of ["findings", "decisions"]) {
        const hasBefore = Object.hasOwn(before, field);
        const hasAfter = Object.hasOwn(after, field);
        if (!hasBefore && !hasAfter) {
            continue;
        }
        if (!hasBefore && hasAfter) {
            continue;
        }
        if (hasBefore && !hasAfter) {
            errors.push(`Simplification snapshots must preserve ${field}.`);
            continue;
        }
        if (!Array.isArray(before[field]) || !Array.isArray(after[field])) {
            errors.push(`Simplification snapshot ${field} must remain an array.`);
        } else if (!containsAll(after[field], before[field])) {
            errors.push(`Simplification removed ${field}.`);
        }
    }

    return errors;
}

function validateOwnershipReviewSnapshot(before, after) {
    if (!isRecord(before) || !isRecord(after)) {
        return ["Simplification ownership_redundancy_review snapshots must be objects."];
    }

    const errors = [];
    for (const field of ["required", "requirement_basis", "requirement_decision_ref", "status"]) {
        if (!sameValue(after[field], before[field])) {
            errors.push(`Simplification changed ownership_redundancy_review.${field}.`);
        }
    }
    if (!Array.isArray(before.subjects) || !Array.isArray(after.subjects)) {
        errors.push("Simplification ownership_redundancy_review subjects must remain arrays.");
    } else if (!before.subjects.every((subject) => containsOwnershipSubject(after.subjects, subject))) {
        errors.push("Simplification removed ownership_redundancy_review subjects or their evidence/findings/decisions.");
    }
    return errors;
}

function containsOwnershipSubject(afterSubjects, beforeSubject) {
    if (!isRecord(beforeSubject)) {
        return afterSubjects.some((subject) => sameValue(subject, beforeSubject));
    }
    const candidate = afterSubjects.find((subject) => {
        return isRecord(subject) && sameValue(subject.id, beforeSubject.id);
    });
    if (!candidate) {
        return false;
    }

    return Object.entries(beforeSubject).every(([field, value]) => {
        if (Array.isArray(value)) {
            return Array.isArray(candidate[field]) && containsAll(candidate[field], value);
        }
        return sameValue(candidate[field], value);
    });
}

export function validatePlanState(state) {
    if (!state || typeof state !== "object") {
        return {valid: false, errors: ["Plan state must be an object."]};
    }
    const errors = [
        ...validateStateMetadata(state),
        ...validateStatePackages(state),
        ...validateStateRecords(state),
    ];
    const approval = canApprovePlan(state);
    errors.push(...validateStateApproval(state, approval));

    return {
        valid: errors.length === 0,
        errors,
        approval,
    };
}

function validateStateMetadata(state) {
    const errors = [];
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
    for (const field of ["review_complete", "critical_review_complete", "simplification_control_review_complete"]) {
        if (Object.hasOwn(state, field) && typeof state[field] !== "boolean") {
            errors.push(`Plan state ${field} must be boolean.`);
        }
    }
    if (Object.hasOwn(state, "scope_questions") && !Array.isArray(state.scope_questions)) {
        errors.push("Plan state scope_questions must be an array.");
    } else if (Array.isArray(state.scope_questions)) {
        errors.push(...validateQuestionRecords(state.scope_questions, {scope: "scope"}).map((error) => {
            return `scope_questions: ${error}`;
        }));
    }
    if (Object.hasOwn(state, "package_decision_gate")
        && !["open", "closed"].includes(state.package_decision_gate)) {
        errors.push("Plan state package_decision_gate must be open or closed.");
    } else if (Object.hasOwn(state, "package_decision_gate")) {
        const expectedGate = ["awaiting-package-decisions", "approved"].includes(state.plan_status)
            ? "open"
            : ["review-pending", "needs-clarification", "review-limit-reached"].includes(state.plan_status)
                ? "closed"
                : null;
        if (expectedGate && state.package_decision_gate !== expectedGate) {
            errors.push(`Plan state package_decision_gate must be ${expectedGate} for ${state.plan_status}.`);
        }
    }
    return errors;
}

function validateStatePackages(state) {
    const errors = [];
    if (!Array.isArray(state.packages)) {
        errors.push("Plan state must contain a packages array.");
    } else if (["awaiting-package-decisions", "approved"].includes(state.plan_status) && state.packages.length === 0) {
        errors.push("Plan state must contain at least one work package before package decisions or approval.");
    }
    errors.push(...validatePackageRecords(state.packages).errors);
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
    return errors;
}

function validateStateRecords(state) {
    const errors = [];
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
    errors.push(...validateOwnershipRedundancyReview(state.ownership_redundancy_review, state.findings));
    errors.push(...validateReviewHistory(state.review_history ?? []));
    errors.push(...validateSimplification(state.simplification ?? {
        result: state.simplification_status,
        before: state.simplification_before,
        after: state.simplification_after,
    }, {
        requireOwnershipReview: true,
    }));
    errors.push(...validateSessionStrategy(state.session_strategy).map((error) => {
        return `session_strategy: ${error}`;
    }));
    errors.push(...validateUserDecisionRecords(state.user_decisions ?? []).map((error) => {
        return `user_decisions: ${error}`;
    }));
    errors.push(...validateQuestionDecisionPropagation(state));
    return errors;
}

function validateStateApproval(state, approval) {
    const errors = [];
    if (state.plan_status === "awaiting-package-decisions") {
        const gate = canOpenPackageDecisions(state);
        if (!gate.ready) {
            errors.push(`Package decision gate failed: ${gate.reasons.join(", ")}.`);
        }
    }
    if (state.plan_status === "approved" && !approval.approved) {
        errors.push(`Approved plan failed approval guard: ${approval.reasons.join(", ")}.`);
    }
    if (state.plan_status === "approved" && (!Array.isArray(state.review_history) || state.review_history.length === 0)) {
        errors.push("Approved plan must contain review history.");
    }
    return errors;
}

export function validatePlanDocument(document, options = {}) {
    const draftResult = typeof document === "string"
        ? validateDraftDocument(document, {kind: options.kind ?? "main"})
        : validateDraftObject(document, options);
    const errors = [...draftResult.errors];

    if (options.state) {
        errors.push(...validatePlanState(options.state).errors);
        errors.push(...validateDraftStateConsistency(draftResult.metadata, options.state));
    }

    return {
        valid: errors.length === 0,
        errors,
        metadata: draftResult.metadata,
        missingSections: draftResult.missingSections,
    };
}

function validateDraftStateConsistency(metadata, state) {
    const errors = [];
    if (!state || typeof state !== "object") {
        return errors;
    }
    if (typeof state.plan_status === "string"
        && typeof metadata?.plan_status === "string"
        && state.plan_status !== metadata.plan_status) {
        errors.push(`Draft/state plan_status mismatch: draft=${metadata.plan_status}, state=${state.plan_status}.`);
    }
    if (Number.isInteger(state.plan_version)
        && isPositiveInteger(metadata?.plan_version)
        && Number(state.plan_version) !== Number(metadata.plan_version)) {
        errors.push(`Draft/state plan_version mismatch: draft=${metadata.plan_version}, state=${state.plan_version}.`);
    }
    const expectedGate = ["awaiting-package-decisions", "approved"].includes(state.plan_status)
        ? "open"
        : ["review-pending", "needs-clarification", "review-limit-reached"].includes(state.plan_status)
            ? "closed"
            : null;
    const stateGate = state.package_decision_gate ?? expectedGate;
    if (stateGate && metadata?.package_decision_gate && stateGate !== metadata.package_decision_gate) {
        errors.push(`Draft/state package_decision_gate mismatch: draft=${metadata.package_decision_gate}, state=${stateGate}.`);
    }
    if (typeof state.source_ref === "string"
        && typeof metadata?.source_ref === "string"
        && state.source_ref !== metadata.source_ref) {
        errors.push("Draft/state source_ref mismatch.");
    }
    if (typeof state.issue !== "undefined" && typeof metadata?.issue !== "undefined"
        && String(state.issue) !== String(metadata.issue)) {
        errors.push("Draft/state issue mismatch.");
    }
    return errors;
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

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMeaningfulString(value) {
    return typeof value === "string" && value.trim() !== "";
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

function isPositiveInteger(value) {
    return (typeof value === "number" && Number.isInteger(value) && value > 0)
        || (typeof value === "string" && /^[1-9][0-9]*$/.test(value));
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
