#!/usr/bin/env node

import {pathToFileURL} from "node:url";

export const PLAN_STATUSES = Object.freeze([
    "review-pending",
    "needs-clarification",
    "awaiting-package-decisions",
    "review-limit-reached",
    "approved",
]);

export const PACKAGE_STATUSES = Object.freeze([
    "pending",
    "revision-requested",
    "accepted",
    "excluded",
    "separated",
]);

export const TERMINAL_PACKAGE_STATUSES = Object.freeze([
    "accepted",
    "excluded",
    "separated",
]);

export const SIMPLIFICATION_STATUSES = Object.freeze([
    "pending",
    "no-change",
    "simplified",
    "needs-user-decision",
]);

export const OWNERSHIP_REDUNDANCY_SUBJECT_KINDS = Object.freeze([
    "field",
    "object",
    "algorithm",
    "workflow",
    "module",
    "endpoint",
]);

export const OWNERSHIP_REDUNDANCY_REQUIREMENT_BASES = Object.freeze([
    "critical-review",
    "user-request",
    "not-applicable",
]);

export const OWNERSHIP_REDUNDANCY_REVIEW_STATUSES = Object.freeze([
    "not-required",
    "pending",
    "complete",
]);

export const OWNERSHIP_REDUNDANCY_CLAIM_CLASSIFICATIONS = Object.freeze([
    "requirement",
    "source_example",
    "agent_hypothesis",
    "user_decision",
]);

export const OWNERSHIP_REDUNDANCY_SCOPES = Object.freeze(["local", "cross-context"]);

export const OWNERSHIP_REDUNDANCY_STATUSES = Object.freeze([
    "not-assessed",
    "justified",
    "redundant",
    "accepted-exception",
]);

export const REDUNDANT_DESIGN_ELEMENT = "REDUNDANT_DESIGN_ELEMENT";

const OWNERSHIP_SUBJECT_ID = /^OR[1-9][0-9]*$/;
const OWNERSHIP_FINDING_ID = /^F[1-9][0-9]*$/;

export const REQUIRED_REVIEW_CHECKS = Object.freeze([
    "intent-and-acceptance",
    "technical-scope",
    "edge-cases-and-verification",
    "risks-and-dependencies",
]);

const QUESTION_FIELDS = Object.freeze(["prompt", "impact", "decision_needed"]);
const QUESTION_RESOLUTION_FIELDS = Object.freeze(["answer", "decision_source", "decided_at"]);

export const PLAN_TRANSITIONS = Object.freeze({
    "review-pending": Object.freeze(["awaiting-package-decisions", "needs-clarification", "review-limit-reached"]),
    "needs-clarification": Object.freeze(["review-pending"]),
    "awaiting-package-decisions": Object.freeze(["approved", "needs-clarification", "review-pending"]),
    "review-limit-reached": Object.freeze(["review-pending"]),
    approved: Object.freeze(["review-pending", "approved"]),
});

export const PACKAGE_TRANSITIONS = Object.freeze({
    pending: Object.freeze(["accepted", "excluded", "revision-requested", "separated"]),
    "revision-requested": Object.freeze(["pending"]),
});

const DECISION_ALIASES = Object.freeze({
    accept: "accepted",
    accepted: "accepted",
    exclude: "excluded",
    excluded: "excluded",
    revise: "revision-requested",
    "revision-requested": "revision-requested",
    separate: "separated",
    separated: "separated",
});

const CLI_CONTRACT_REJECTIONS = Object.freeze([
    "INVALID_DECISION_COMMAND",
    "INVALID_BULK_DECISION",
    "INVALID_TRANSITION",
    "UNKNOWN_STATUS",
    "APPROVAL_GUARD_FAILED",
    "PACKAGE_DECISION_GATE_FAILED",
]);

const CLI_ARGUMENT_ERRORS = Object.freeze([
    "INVALID_ARGUMENT",
    "INVALID_COMMAND",
]);

export class StateError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "StateError";
        this.code = code;
        this.details = details;
    }
}

export function canTransition(kind, from, to, state = null) {
    const table = transitionTable(kind);
    if (!table) {
        return false;
    }
    if (!Array.isArray(table[from]) || !table[from].includes(to)) {
        return false;
    }
    if (kind === "plan" && to === "awaiting-package-decisions" && state !== null) {
        return canOpenPackageDecisions(state).ready;
    }
    return true;
}

export function canOpenPackageDecisions(state) {
    const reasons = packageDecisionGateReasons(state);
    return {ready: reasons.length === 0, reasons};
}

export function assertTransition(kind, from, to) {
    if (!transitionTable(kind)) {
        throw new StateError("UNKNOWN_TRANSITION_KIND", `Unknown transition kind: ${kind}.`);
    }
    const statuses = kind === "plan" ? PLAN_STATUSES : PACKAGE_STATUSES;
    if (!statuses.includes(from) || !statuses.includes(to)) {
        throw new StateError("UNKNOWN_STATUS", `Unknown ${kind} status transition: ${from} → ${to}.`, {
            kind,
            from,
            to,
        });
    }

    if (!canTransition(kind, from, to)) {
        throw new StateError("INVALID_TRANSITION", `Invalid ${kind} status transition: ${from} → ${to}.`, {
            kind,
            from,
            to,
        });
    }
}

export function parseDecisionCommand(value) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StateError("INVALID_DECISION_COMMAND", "Decision command must be a non-empty string.");
    }

    const command = value.trim();
    if (command === "accept-all-pending") {
        return {
            command,
            decision_status: "accepted",
            package_ids: null,
            scope: "pending",
        };
    }

    const match = command.match(/^(accept-selected|revise|exclude|separate):\s*(.+)$/);
    if (!match) {
        throw new StateError("INVALID_DECISION_COMMAND", `Unsupported decision command: ${command}.`);
    }

    const packageIds = match[2]
        .split(",")
        .map((packageId) => packageId.trim())
        .filter(Boolean);
    if (packageIds.length === 0 || packageIds.some((packageId) => !/^WP[1-9][0-9]*$/.test(packageId))) {
        throw new StateError("INVALID_DECISION_COMMAND", `Invalid work package list: ${match[2]}.`);
    }
    if (new Set(packageIds).size !== packageIds.length) {
        throw new StateError("INVALID_DECISION_COMMAND", "A work package cannot be selected more than once.");
    }

    return {
        command,
        decision_status: match[1] === "accept-selected"
            ? "accepted"
            : DECISION_ALIASES[match[1]],
        package_ids: packageIds,
        scope: "selected",
    };
}

export function applyDecisionCommand(state, command, decisionContext) {
    const parsed = typeof command === "string" ? parseDecisionCommand(command) : command;
    if (!parsed || !DECISION_ALIASES[parsed.decision_status] && parsed.decision_status !== "accepted") {
        throw new StateError("INVALID_DECISION_COMMAND", "Decision command has no supported decision status.");
    }

    if (parsed.scope === "pending") {
        return applyBulkDecision(state, parsed.decision_status, decisionContext);
    }
    if (parsed.scope !== "selected" || !Array.isArray(parsed.package_ids)) {
        throw new StateError("INVALID_DECISION_COMMAND", "Selected decisions must contain package_ids.");
    }

    let nextState = clone(state);
    for (const packageId of parsed.package_ids) {
        nextState = applyPackageDecision(nextState, {
            package_id: packageId,
            decision_status: parsed.decision_status,
            ...decisionContext,
        });
    }

    return nextState;
}

export function applyPlanTransition(state, nextStatus, context = {}) {
    const nextState = prepareState(state);
    const previousStatus = nextState.plan_status;
    assertTransition("plan", previousStatus, nextStatus);
    if (nextStatus === "awaiting-package-decisions") {
        const gate = canOpenPackageDecisions(nextState);
        if (!gate.ready) {
            throw new StateError("PACKAGE_DECISION_GATE_FAILED", `Package decisions cannot open: ${gate.reasons.join(", ")}.`, {
                from: previousStatus,
                to: nextStatus,
                reasons: gate.reasons,
            });
        }
    }
    if (nextStatus === "approved") {
        const approval = canApprovePlan(nextState);
        if (!approval.approved) {
            throw new StateError("APPROVAL_GUARD_FAILED", `Plan cannot be approved: ${approval.reasons.join(", ")}.`, {
                from: previousStatus,
                to: nextStatus,
                reasons: approval.reasons,
            });
        }
    }
    nextState.plan_status = nextStatus;
    if (previousStatus === "approved" && nextStatus === "review-pending") {
        nextState.plan_version += 1;
    }
    if (!Array.isArray(nextState.plan_history)) {
        nextState.plan_history = [];
    }
    nextState.plan_history.push({
        from: previousStatus,
        to: nextStatus,
        reason: requireString(context.reason ?? "explicit state transition", "reason"),
        changed_at: context.changed_at ? requireTimestamp(context.changed_at) : null,
    });
    return nextState;
}

export function applyPackageDecision(state, decision) {
    const nextState = prepareState(state);
    const packageId = requireString(decision?.package_id, "package_id");
    const decisionStatus = normalizeDecisionStatus(decision?.decision_status);
    const decisionSource = requireString(decision?.decision_source, "decision_source");
    const decidedAt = requireTimestamp(decision?.decided_at);
    const packageIndex = nextState.packages.findIndex((item) => item.id === packageId);

    if (packageIndex < 0) {
        throw new StateError("PACKAGE_NOT_FOUND", `Work package ${packageId} was not found.`, {package_id: packageId});
    }

    const currentStatus = nextState.packages[packageIndex].decision_status;
    assertTransition("package", currentStatus, decisionStatus);
    if (TERMINAL_PACKAGE_STATUSES.includes(decisionStatus)) {
        const questionReasons = packageQuestionReasons([nextState.packages[packageIndex]]);
        if (questionReasons.length > 0) {
            throw new StateError("PACKAGE_QUESTIONS_BLOCKING", `Cannot make ${packageId} terminal: ${questionReasons.join(", ")}.`, {
                package_id: packageId,
                reasons: questionReasons,
            });
        }
    }

    nextState.packages[packageIndex] = {
        ...nextState.packages[packageIndex],
        decision_status: decisionStatus,
    };
    nextState.decisions.push({
        package_id: packageId,
        decision: decisionStatus,
        decision_source: decisionSource,
        decided_at: decidedAt,
        previous_decision: currentStatus,
    });

    return nextState;
}

export function applyBulkDecision(state, decisionStatus, decisionContext) {
    const normalizedStatus = normalizeDecisionStatus(decisionStatus);
    if (normalizedStatus !== "accepted") {
        throw new StateError("INVALID_BULK_DECISION", "Bulk decisions are limited to accepting pending packages.");
    }

    const nextState = prepareState(state);
    const pendingIds = nextState.packages
        .filter((item) => item.decision_status === "pending")
        .map((item) => item.id);
    let result = nextState;

    for (const packageId of pendingIds) {
        result = applyPackageDecision(result, {
            package_id: packageId,
            decision_status: normalizedStatus,
            ...decisionContext,
        });
    }

    return result;
}

export function reopenPackage(state, packageId, context) {
    const nextState = prepareState(state);
    const targetId = requireString(packageId, "package_id");
    const reason = requireString(context?.reason, "reason");
    const decisionSource = requireString(context?.decision_source, "decision_source");
    const decidedAt = requireTimestamp(context?.decided_at);
    const packageIndex = nextState.packages.findIndex((item) => item.id === targetId);

    if (packageIndex < 0) {
        throw new StateError("PACKAGE_NOT_FOUND", `Work package ${targetId} was not found.`, {package_id: targetId});
    }

    const currentStatus = nextState.packages[packageIndex].decision_status;
    if (!TERMINAL_PACKAGE_STATUSES.includes(currentStatus)) {
        throw new StateError("PACKAGE_NOT_TERMINAL", `Only terminal packages can be reopened: ${targetId}.`);
    }

    nextState.packages[packageIndex] = {
        ...nextState.packages[packageIndex],
        decision_status: "revision-requested",
    };
    nextState.plan_version += 1;
    nextState.decisions.push({
        package_id: targetId,
        decision: "revision-requested",
        decision_source: decisionSource,
        decided_at: decidedAt,
        previous_decision: currentStatus,
        reason,
    });

    return nextState;
}

export function validateDependencyGraph(packages) {
    const errors = [];
    const records = Array.isArray(packages) ? packages : [];
    const ids = new Set();

    for (const item of records) {
        if (!item || typeof item.id !== "string" || !/^WP[1-9][0-9]*$/.test(item.id)) {
            errors.push("Every package must have an id matching WP<number>.");
            continue;
        }
        if (ids.has(item.id)) {
            errors.push(`Duplicate package id: ${item.id}.`);
        }
        ids.add(item.id);
    }

    for (const item of records) {
        if (!item || typeof item.id !== "string") {
            continue;
        }
        const dependencies = Array.isArray(item.dependencies) ? item.dependencies : [];
        for (const dependency of dependencies) {
            if (!ids.has(dependency)) {
                errors.push(`${item.id} depends on unknown package ${dependency}.`);
            }
        }
    }

    if (errors.length === 0 && hasDependencyCycle(records)) {
        errors.push("Package dependency graph contains a cycle.");
    }

    return {valid: errors.length === 0, errors};
}

export function getImpactedPackageIds(packages, changedPackageId) {
    const graphResult = validateDependencyGraph(packages);
    if (!graphResult.valid) {
        throw new StateError("INVALID_DEPENDENCY_GRAPH", graphResult.errors.join(" "), {errors: graphResult.errors});
    }

    const records = Array.isArray(packages) ? packages : [];
    if (!records.some((item) => item.id === changedPackageId)) {
        throw new StateError("PACKAGE_NOT_FOUND", `Work package ${changedPackageId} was not found.`, {
            package_id: changedPackageId,
        });
    }

    const impacted = new Set([changedPackageId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of records) {
            const dependencies = Array.isArray(item.dependencies) ? item.dependencies : [];
            if (!impacted.has(item.id) && dependencies.some((dependency) => impacted.has(dependency))) {
                impacted.add(item.id);
                changed = true;
            }
        }
    }

    return records.filter((item) => impacted.has(item.id)).map((item) => item.id);
}

export function canApprovePlan(state) {
    const reasons = [];
    const candidate = state && typeof state === "object" ? state : {};
    const packages = Array.isArray(candidate.packages) ? candidate.packages : [];

    if (!PLAN_STATUSES.includes(candidate.plan_status)) {
        reasons.push("unknown_plan_status");
    } else if (!["awaiting-package-decisions", "approved"].includes(candidate.plan_status)) {
        reasons.push("plan_not_ready_for_approval");
    }

    if (packages.length === 0) {
        reasons.push("no_work_packages");
    }
    if (packages.some((item) => !TERMINAL_PACKAGE_STATUSES.includes(item?.decision_status))) {
        reasons.push("non_terminal_work_package");
    }
    reasons.push(...missingDecisionRecordReasons(candidate, packages));
    reasons.push(...packageQuestionReasons(packages));
    for (const reason of packageDecisionGateReasons(candidate)) {
        if (!reasons.includes(reason)) {
            reasons.push(reason);
        }
    }

    return {approved: reasons.length === 0, reasons};
}

function packageDecisionGateReasons(state) {
    const candidate = state && typeof state === "object" ? state : {};
    const reasons = [];
    const addReason = (reason) => {
        if (!reasons.includes(reason)) {
            reasons.push(reason);
        }
    };

    if (Object.hasOwn(candidate, "package_decision_gate")
        && candidate.package_decision_gate !== "open") {
        addReason(candidate.package_decision_gate === "closed"
            ? "package_decision_gate_closed"
            : "invalid_package_decision_gate");
    }

    if (!Array.isArray(candidate.packages) || candidate.packages.length === 0) {
        addReason("no_work_packages");
    }
    if (candidate.review_complete !== true) {
        addReason("review_incomplete");
    }
    if (candidate.critical_review_complete !== true) {
        addReason("critical_review_incomplete");
    }
    for (const reason of reviewHistoryReasons(candidate)) {
        addReason(reason);
    }
    if (!hasCompletedCriticalReview(candidate.review_history)) {
        addReason("critical_review_missing");
    }
    if (!["no-change", "simplified"].includes(candidate.simplification_status)) {
        addReason("simplification_not_resolved");
    }
    if (candidate.simplification_control_review_complete !== true) {
        addReason("simplification_review_incomplete");
    }
    for (const reason of simplificationReasons(candidate)) {
        addReason(reason);
    }
    for (const reason of ownershipRedundancyReasons(candidate)) {
        addReason(reason);
    }
    for (const reason of blockerReasons(candidate)) {
        addReason(reason);
    }

    if (!Array.isArray(candidate.findings)) {
        addReason("findings_missing");
    } else if (candidate.findings.some((finding) => {
        return finding && ["open", "reopened"].includes(finding.status);
    })) {
        addReason("open_actionable_findings");
    }

    if (!Array.isArray(candidate.scope_questions)) {
        addReason("scope_questions_missing");
    } else {
        const scopeQuestionErrors = validateQuestionRecords(candidate.scope_questions, {scope: "scope"});
        if (scopeQuestionErrors.length > 0) {
            addReason("invalid_scope_questions");
        } else if (candidate.scope_questions.some(isUnresolvedScopeQuestion)) {
            addReason("unresolved_scope_questions");
        }
    }

    return reasons;
}

function ownershipRedundancyReasons(candidate) {
    const reasons = [];
    const review = candidate.ownership_redundancy_review;
    const validationErrors = validateOwnershipRedundancyReview(review, candidate.findings);

    if (validationErrors.length > 0) {
        reasons.push("ownership_redundancy_review_invalid");
    }
    if (review
        && typeof review === "object"
        && !Array.isArray(review)
        && review.required === true
        && review.status !== "complete") {
        reasons.push("ownership_redundancy_review_incomplete");
    }

    return reasons;
}

function hasCompletedCriticalReview(history) {
    if (!Array.isArray(history)) {
        return false;
    }

    return history.some((review) => {
        if (!review || review.stage !== "critical-review" || review.complete !== true) {
            return false;
        }
        return Array.isArray(review.checks)
            && REQUIRED_REVIEW_CHECKS.every((check) => review.checks.includes(check));
    });
}

function isUnresolvedScopeQuestion(question) {
    if (typeof question === "string") {
        return question.trim() !== "";
    }
    return Boolean(question)
        && typeof question === "object"
        && !Array.isArray(question)
        && question.resolved !== true;
}

export function readSimplificationResult(state) {
    const simplification = state && typeof state === "object" ? state.simplification : null;
    if (!simplification || typeof simplification !== "object" || Array.isArray(simplification)) {
        return null;
    }
    return typeof simplification.result === "string" ? simplification.result : null;
}

export function validatePackageRecords(packages) {
    const errors = [];
    const records = Array.isArray(packages) ? packages : [];

    for (const item of records) {
        if (!item || typeof item !== "object") {
            errors.push("Every package must be an object.");
            continue;
        }
        if (!PACKAGE_STATUSES.includes(item.decision_status)) {
            errors.push(`${item.id ?? "Unknown package"} has an invalid decision_status.`);
        }
        if (!Array.isArray(item.dependencies)) {
            errors.push(`${item.id ?? "Unknown package"} must declare dependencies as an array.`);
        }
        if (!Array.isArray(item.questions)) {
            errors.push(`${item.id ?? "Unknown package"} must declare questions as an array.`);
        } else {
            errors.push(...validateQuestionRecords(item.questions, {packageId: item.id}).map((error) => {
                return `${item.id ?? "Unknown package"}: ${error}`;
            }));
        }
    }

    const graphResult = validateDependencyGraph(records);
    errors.push(...graphResult.errors);
    return {valid: errors.length === 0, errors};
}

export function validateQuestionRecords(questions, options = {}) {
    if (!Array.isArray(questions)) {
        return ["Questions must be an array."];
    }

    const errors = [];
    const ids = new Set();
    const expectedId = options.scope === "scope"
        ? /^SQ[1-9][0-9]*$/
        : new RegExp(`^${escapeRegExp(options.packageId ?? "WP")}-Q[1-9][0-9]*$`);

    for (const [index, question] of questions.entries()) {
        const label = `Question ${index + 1}`;
        if (!question || typeof question !== "object" || Array.isArray(question)) {
            errors.push(`${label} must be a structured record.`);
            continue;
        }
        if (typeof question.id !== "string" || !expectedId.test(question.id)) {
            errors.push(`${label} id must match ${options.scope === "scope" ? "SQ<number>" : `${options.packageId ?? "WP<number>"}-Q<number>`}.`);
        } else if (ids.has(question.id)) {
            errors.push(`Duplicate question id: ${question.id}.`);
        } else {
            ids.add(question.id);
        }
        for (const field of QUESTION_FIELDS) {
            if (typeof question[field] !== "string" || question[field].trim() === "") {
                errors.push(`${label} is missing ${field}.`);
            }
        }
        if (typeof question.blocking !== "boolean") {
            errors.push(`${label} blocking must be boolean.`);
        }
        if (typeof question.resolved !== "boolean") {
            errors.push(`${label} resolved must be boolean.`);
        } else if (question.resolved) {
            for (const field of QUESTION_RESOLUTION_FIELDS) {
                if (typeof question[field] !== "string" || question[field].trim() === "") {
                    errors.push(`${label} is missing ${field} for a resolved question.`);
                }
            }
            if (typeof question.decided_at === "string" && Number.isNaN(Date.parse(question.decided_at))) {
                errors.push(`${label} decided_at must be a valid timestamp.`);
            }
        } else if (QUESTION_RESOLUTION_FIELDS.some((field) => hasMeaningfulQuestionValue(question[field]))) {
            errors.push(`${label} cannot contain an answer before resolved is true.`);
        }
    }

    return errors;
}

export function validateOwnershipRedundancyReview(review, findings) {
    if (typeof review === "undefined") {
        return ["Plan state must contain ownership_redundancy_review."];
    }
    if (!isRecord(review)) {
        return ["ownership_redundancy_review must be an object."];
    }

    const errors = [];
    if (typeof review.required !== "boolean") {
        errors.push("ownership_redundancy_review.required must be boolean.");
    }
    if (!OWNERSHIP_REDUNDANCY_REQUIREMENT_BASES.includes(review.requirement_basis)) {
        errors.push("ownership_redundancy_review.requirement_basis is invalid.");
    }
    if (Object.hasOwn(review, "requirement_decision_ref")
        && review.requirement_decision_ref !== ""
        && !isNonEmptyString(review.requirement_decision_ref)) {
        errors.push("ownership_redundancy_review.requirement_decision_ref must be a string.");
    }
    if (!OWNERSHIP_REDUNDANCY_REVIEW_STATUSES.includes(review.status)) {
        errors.push("ownership_redundancy_review.status is invalid.");
    }
    if (!Array.isArray(review.subjects)) {
        errors.push("ownership_redundancy_review.subjects must be an array.");
        return errors;
    }

    if (review.required === false) {
        if (review.requirement_basis !== "not-applicable") {
            errors.push("ownership_redundancy_review.required=false requires requirement_basis=not-applicable.");
        }
        if (isNonEmptyString(review.requirement_decision_ref)) {
            errors.push("ownership_redundancy_review.required=false requires an empty requirement_decision_ref.");
        }
        if (review.status !== "not-required") {
            errors.push("ownership_redundancy_review.required=false requires status=not-required.");
        }
        if (review.subjects.length > 0) {
            errors.push("ownership_redundancy_review.required=false requires empty subjects.");
        }
    }

    if (review.required === true) {
        if (!["critical-review", "user-request"].includes(review.requirement_basis)) {
            errors.push("ownership_redundancy_review.required=true requires a review or user-request basis.");
        }
        if (review.requirement_basis === "user-request" && !isNonEmptyString(review.requirement_decision_ref)) {
            errors.push("ownership_redundancy_review user-request basis requires requirement_decision_ref.");
        }
        if (review.subjects.length === 0) {
            errors.push("ownership_redundancy_review.required=true requires at least one subject.");
        }
    }

    const subjectIds = new Set();
    for (const [index, subject] of review.subjects.entries()) {
        errors.push(...validateOwnershipSubject(subject, index, subjectIds));
    }
    errors.push(...validateOwnershipFindingRelations(review, findings, subjectIds));
    if (review.required === true
        && review.status === "pending"
        && !hasPendingOwnershipEvidence(review.subjects, findings)) {
        errors.push("ownership_redundancy_review.status=pending requires an incomplete or not-assessed subject or an open finding.");
    }
    return errors;
}

function hasPendingOwnershipEvidence(subjects, findings) {
    if (subjects.some((subject) => isRecord(subject) && subject.redundancy_status === "not-assessed")) {
        return true;
    }
    return Array.isArray(findings)
        && findings.some((finding) => isRecord(finding) && ["open", "reopened"].includes(finding.status));
}

function validateOwnershipSubject(subject, index, subjectIds) {
    const label = `ownership_redundancy_review subject ${index + 1}`;
    if (!isRecord(subject)) {
        return [`${label} must be an object.`];
    }

    const errors = [];
    if (!isNonEmptyString(subject.id) || !OWNERSHIP_SUBJECT_ID.test(subject.id)) {
        errors.push(`${label}.id must match OR<number>.`);
    } else if (subjectIds.has(subject.id)) {
        errors.push(`Duplicate ownership subject id: ${subject.id}.`);
    } else {
        subjectIds.add(subject.id);
    }

    for (const field of [
        "subject_ref",
        "source_claim",
        "owner_source_of_truth",
        "necessity",
        "alternative_without_subject",
        "inconsistency_or_divergence_test",
    ]) {
        if (!isNonEmptyString(subject[field])) {
            errors.push(`${label} is missing ${field}.`);
        }
    }
    if (!OWNERSHIP_REDUNDANCY_SUBJECT_KINDS.includes(subject.subject_kind)) {
        errors.push(`${label}.subject_kind is invalid.`);
    }
    if (!OWNERSHIP_REDUNDANCY_CLAIM_CLASSIFICATIONS.includes(subject.claim_classification)) {
        errors.push(`${label}.claim_classification is invalid.`);
    }
    if (!OWNERSHIP_REDUNDANCY_SCOPES.includes(subject.scope)) {
        errors.push(`${label}.scope is invalid.`);
    }
    if (!OWNERSHIP_REDUNDANCY_STATUSES.includes(subject.redundancy_status)) {
        errors.push(`${label}.redundancy_status is invalid.`);
    }

    for (const field of ["producer_or_implementer", "consumer_or_caller", "evidence_refs", "finding_ids"]) {
        if (!Array.isArray(subject[field])) {
            errors.push(`${label}.${field} must be an array.`);
            continue;
        }
        if (field !== "finding_ids" && subject[field].length === 0) {
            errors.push(`${label}.${field} must not be empty.`);
        }
        const seen = new Set();
        for (const [valueIndex, value] of subject[field].entries()) {
            if (!isNonEmptyString(value)) {
                errors.push(`${label}.${field}[${valueIndex}] must be a non-empty string.`);
                continue;
            }
            if (field === "finding_ids" && !OWNERSHIP_FINDING_ID.test(value)) {
                errors.push(`${label}.finding_ids must contain F<number> ids.`);
            }
            if (seen.has(value)) {
                errors.push(`${label}.${field} contains duplicate value ${value}.`);
            }
            seen.add(value);
        }
    }

    for (const field of ["promotion_decision_ref", "decision_ref", "context_boundary"]) {
        if (Object.hasOwn(subject, field)
            && subject[field] !== ""
            && !isNonEmptyString(subject[field])) {
            errors.push(`${label}.${field} must be a string.`);
        }
    }
    if (subject.scope === "cross-context" && !isNonEmptyString(subject.context_boundary)) {
        errors.push(`${label} cross-context scope requires context_boundary.`);
    }
    if (subject.redundancy_status === "redundant"
        && (!Array.isArray(subject.finding_ids) || subject.finding_ids.length === 0)) {
        errors.push(`${label} redundant status requires finding_ids.`);
    }
    if (subject.redundancy_status === "accepted-exception"
        && !isNonEmptyString(subject.decision_ref)) {
        errors.push(`${label} accepted-exception status requires decision_ref.`);
    }

    return errors;
}

function validateOwnershipFindingRelations(review, findings, subjectIds) {
    const relatedFindings = findings === null || typeof findings === "undefined" ? [] : findings;
    if (!Array.isArray(relatedFindings)) {
        return ["ownership_redundancy_review findings must be an array."];
    }

    const errors = [];
    const subjects = Array.isArray(review.subjects) ? review.subjects : [];
    const subjectsById = new Map(subjects
        .filter((subject) => isRecord(subject) && isNonEmptyString(subject.id))
        .map((subject) => [subject.id, subject]));
    const findingsById = new Map();
    const redundantFindings = [];

    for (const finding of relatedFindings) {
        if (!isRecord(finding)) {
            continue;
        }
        if (isNonEmptyString(finding.id)) {
            if (findingsById.has(finding.id)) {
                errors.push(`Duplicate finding id: ${finding.id}.`);
            } else {
                findingsById.set(finding.id, finding);
            }
        }
        if (finding.code === REDUNDANT_DESIGN_ELEMENT) {
            redundantFindings.push(finding);
        }
    }

    for (const subject of subjects) {
        if (!isRecord(subject) || !Array.isArray(subject.finding_ids)) {
            continue;
        }
        for (const findingId of subject.finding_ids) {
            const finding = findingsById.get(findingId);
            if (!finding) {
                errors.push(`Ownership subject ${subject.id} references missing finding ${findingId}.`);
                continue;
            }
            if (finding.code !== REDUNDANT_DESIGN_ELEMENT) {
                errors.push(`Ownership subject ${subject.id} finding ${findingId} must use code ${REDUNDANT_DESIGN_ELEMENT}.`);
            }
            if (finding.subject_id !== subject.id) {
                errors.push(`Ownership finding ${findingId} must reference subject ${subject.id}.`);
            }
        }
    }

    for (const finding of redundantFindings) {
        if (!isNonEmptyString(finding.id)) {
            errors.push("REDUNDANT_DESIGN_ELEMENT finding must contain an id.");
            continue;
        }
        if (!isNonEmptyString(finding.subject_id) || !OWNERSHIP_SUBJECT_ID.test(finding.subject_id)) {
            errors.push(`Finding ${finding.id} subject_id must match OR<number>.`);
            continue;
        }
        if (!subjectIds.has(finding.subject_id)) {
            errors.push(`Finding ${finding.id} references missing ownership subject ${finding.subject_id}.`);
            continue;
        }
        const subject = subjectsById.get(finding.subject_id);
        if (!Array.isArray(subject.finding_ids) || !subject.finding_ids.includes(finding.id)) {
            errors.push(`Finding ${finding.id} is not listed by subject ${finding.subject_id}.`);
        }
        if (!["redundant", "accepted-exception"].includes(subject.redundancy_status)) {
            errors.push(`Finding ${finding.id} references subject ${finding.subject_id} without a redundant status.`);
        }
        if (review.required === true
            && review.status === "complete"
            && !["resolved", "accepted"].includes(finding.status)) {
            errors.push(`Complete ownership review cannot contain open finding ${finding.id}.`);
        }
    }

    for (const subject of subjects) {
        if (!isRecord(subject)) {
            continue;
        }
        if (subject.redundancy_status === "redundant"
            && !redundantFindings.some((finding) => finding.subject_id === subject.id)) {
            errors.push(`Redundant subject ${subject.id} must have a REDUNDANT_DESIGN_ELEMENT finding.`);
        }
        if (review.required === true
            && review.status === "complete"
            && subject.redundancy_status === "not-assessed") {
            errors.push(`Complete ownership review cannot contain not-assessed subject ${subject.id}.`);
        }
    }

    return errors;
}

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
    return typeof value === "string" && value.trim() !== "";
}

function hasMeaningfulQuestionValue(value) {
    return value !== null && typeof value !== "undefined" && String(value).trim() !== "";
}

export function validateDecisionHistory(decisions) {
    const errors = [];
    if (!Array.isArray(decisions)) {
        return ["Decision history must be an array."];
    }
    for (const [index, decision] of decisions.entries()) {
        if (!decision || typeof decision !== "object") {
            errors.push(`Decision ${index + 1} must be an object.`);
            continue;
        }
        for (const field of ["package_id", "decision", "decision_source", "decided_at"]) {
            if (typeof decision[field] !== "string" || decision[field].trim() === "") {
                errors.push(`Decision ${index + 1} is missing ${field}.`);
            }
        }
        if (!PACKAGE_STATUSES.includes(decision.decision)) {
            errors.push(`Decision ${index + 1} has an invalid package status.`);
        }
        if (Object.hasOwn(decision, "previous_decision")
            && !PACKAGE_STATUSES.includes(decision.previous_decision)) {
            errors.push(`Decision ${index + 1} has an invalid previous package status.`);
        }
        if (typeof decision.decided_at === "string" && Number.isNaN(Date.parse(decision.decided_at))) {
            errors.push(`Decision ${index + 1} has an invalid decided_at timestamp.`);
        }
    }
    return errors;
}

function missingDecisionRecordReasons(candidate, packages) {
    if (Object.hasOwn(candidate, "decisions") && !Array.isArray(candidate.decisions)) {
        return ["invalid_decision_history"];
    }

    const decisions = Array.isArray(candidate.decisions) ? candidate.decisions : [];
    const missing = packages.some((item) => {
        return item && TERMINAL_PACKAGE_STATUSES.includes(item.decision_status)
            && !decisions.some((decision) => decision
                && decision.package_id === item.id
                && decision.decision === item.decision_status);
    });
    return missing ? ["missing_package_decision_record"] : [];
}

function packageQuestionReasons(packages) {
    const reasons = [];
    for (const item of packages) {
        if (!item || typeof item !== "object") {
            continue;
        }
        if (!Object.hasOwn(item, "questions") || !Array.isArray(item.questions)) {
            if (!reasons.includes("invalid_package_questions")) {
                reasons.push("invalid_package_questions");
            }
            continue;
        }
        const questions = Array.isArray(item.questions) ? item.questions : [];
        if (validateQuestionRecords(questions, {packageId: item.id}).length > 0) {
            if (!reasons.includes("invalid_package_questions")) {
                reasons.push("invalid_package_questions");
            }
        }
        if (questions.some(isUnresolvedBlockingQuestion) && !reasons.includes("unresolved_blocking_question")) {
            reasons.push("unresolved_blocking_question");
        }
    }
    return reasons;
}

function isUnresolvedBlockingQuestion(question) {
    return Boolean(question)
        && typeof question === "object"
        && !Array.isArray(question)
        && question.blocking === true
        && question.resolved !== true;
}

function blockerReasons(candidate) {
    if (!Object.hasOwn(candidate, "blockers") || !Array.isArray(candidate.blockers)) {
        return ["invalid_blockers"];
    }
    return Array.isArray(candidate.blockers) && candidate.blockers.length > 0
        ? ["open_blockers"]
        : [];
}

function simplificationReasons(candidate) {
    const reasons = [];
    if (!Object.hasOwn(candidate, "simplification_status")) {
        return ["simplification_not_resolved"];
    }
    if (!Object.hasOwn(candidate, "simplification")
        || !candidate.simplification
        || typeof candidate.simplification !== "object"
        || Array.isArray(candidate.simplification)) {
        return ["invalid_simplification"];
    }
    const nestedResult = readSimplificationResult(candidate);
    if (nestedResult === null) {
        reasons.push("invalid_simplification");
    }
    if (nestedResult !== null
        && typeof candidate.simplification_status === "string"
        && nestedResult !== candidate.simplification_status) {
        reasons.push("simplification_status_mismatch");
    }
    if (!["no-change", "simplified"].includes(candidate.simplification_status)) {
        reasons.push("simplification_not_resolved");
    }
    if (candidate.simplification_status === "simplified"
        && (!candidate.simplification.before || !candidate.simplification.after)) {
        reasons.push("invalid_simplification");
    }
    return reasons;
}

function reviewHistoryReasons(candidate) {
    if (!Object.hasOwn(candidate, "review_history")
        || !Array.isArray(candidate.review_history)
        || candidate.review_history.length === 0) {
        return ["review_history_missing"];
    }
    const iterations = new Set();
    let previousPlanVersion = 0;
    for (const review of candidate.review_history) {
        if (!review
            || typeof review !== "object"
            || !Number.isInteger(review.iteration)
            || review.iteration < 1
            || iterations.has(review.iteration)
            || (Object.hasOwn(review, "plan_version")
                && (!Number.isInteger(review.plan_version)
                    || review.plan_version < 1
                    || review.plan_version <= previousPlanVersion))) {
            return ["invalid_review_history"];
        }
        iterations.add(review.iteration);
        if (Object.hasOwn(review, "plan_version")) {
            previousPlanVersion = review.plan_version;
        }
    }
    if (candidate.review_history.length > 3) {
        return ["invalid_review_history"];
    }
    return [];
}

function normalizeDecisionStatus(value) {
    const normalized = DECISION_ALIASES[value] ?? value;
    if (!PACKAGE_STATUSES.includes(normalized)) {
        throw new StateError("UNKNOWN_DECISION", `Unknown package decision: ${value}.`);
    }
    return normalized;
}

function prepareState(state) {
    if (!state || typeof state !== "object") {
        throw new StateError("INVALID_STATE", "State must be an object.");
    }
    if (!Number.isInteger(state.plan_version) || state.plan_version < 1) {
        throw new StateError("INVALID_STATE", "State must contain a positive integer plan_version.");
    }
    const packageResult = validatePackageRecords(state.packages);
    if (!packageResult.valid) {
        throw new StateError("INVALID_STATE", packageResult.errors.join(" "), {errors: packageResult.errors});
    }
    const decisionResult = validateDecisionHistory(state.decisions ?? []);
    if (decisionResult.length > 0) {
        throw new StateError("INVALID_STATE", decisionResult.join(" "), {errors: decisionResult});
    }

    return {
        ...clone(state),
        decisions: Array.isArray(state.decisions) ? clone(state.decisions) : [],
    };
}

function transitionTable(kind) {
    if (kind === "plan") {
        return PLAN_TRANSITIONS;
    }
    if (kind === "package") {
        return PACKAGE_TRANSITIONS;
    }
    return null;
}

function requireString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StateError("INVALID_DECISION", `${name} must be a non-empty string.`);
    }
    return value.trim();
}

function requireTimestamp(value) {
    const timestamp = requireString(value, "decided_at");
    if (Number.isNaN(Date.parse(timestamp))) {
        throw new StateError("INVALID_DECISION", `Invalid decided_at timestamp: ${timestamp}.`);
    }
    return timestamp;
}

function hasDependencyCycle(packages) {
    const visiting = new Set();
    const visited = new Set();

    function visit(packageId) {
        if (visiting.has(packageId)) {
            return true;
        }
        if (visited.has(packageId)) {
            return false;
        }

        visiting.add(packageId);
        const item = packages.find((candidate) => candidate.id === packageId);
        const dependencies = Array.isArray(item?.dependencies) ? item.dependencies : [];
        for (const dependency of dependencies) {
            if (visit(dependency)) {
                return true;
            }
        }
        visiting.delete(packageId);
        visited.add(packageId);
        return false;
    }

    return packages.some((item) => visit(item.id));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(args) {
    const parsed = {command: null, values: {}};
    const rest = [...args];
    parsed.command = rest.shift() ?? null;

    while (rest.length > 0) {
        const key = rest.shift();
        if (!key.startsWith("--")) {
            throw new StateError("INVALID_ARGUMENT", `Unexpected argument: ${key}.`);
        }
        const value = rest.shift();
        if (typeof value !== "string") {
            throw new StateError("INVALID_ARGUMENT", `Missing value for ${key}.`);
        }
        parsed.values[key.slice(2)] = value;
    }

    return parsed;
}

function cliResult(parsed) {
    if (parsed.command === "transition") {
        const kind = parsed.values.kind;
        const from = parsed.values.from;
        const to = parsed.values.to;
        try {
            assertTransition(kind, from, to);
            return {valid: true, kind, from, to};
        } catch (error) {
            if (error instanceof StateError) {
                return {valid: false, code: error.code, message: error.message};
            }
            throw error;
        }
    }
    if (parsed.command === "parse-command") {
        return parseDecisionCommand(parsed.values.value);
    }
    throw new StateError("INVALID_COMMAND", "Use transition or parse-command.");
}

function main(args) {
    if (args[0] === "--help") {
        process.stdout.write("Usage: state.mjs transition --kind <plan|package> --from <status> --to <status> | parse-command --value <command>\n");
        return 0;
    }
    try {
        const result = cliResult(parseArgs(args));
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result.valid === false ? 1 : 0;
    } catch (error) {
        const result = error instanceof StateError
            ? {valid: false, code: error.code, message: error.message}
            : {valid: false, code: "UNEXPECTED_ERROR", message: String(error)};
        process.stdout.write(`${JSON.stringify(result)}\n`);
        if (CLI_CONTRACT_REJECTIONS.includes(result.code)) {
            return 1;
        }
        return CLI_ARGUMENT_ERRORS.includes(result.code) || result.code === "UNEXPECTED_ERROR" ? 2 : 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
