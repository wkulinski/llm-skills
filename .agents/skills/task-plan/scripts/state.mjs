#!/usr/bin/env node

import {pathToFileURL} from "node:url";

export const PLAN_STATUSES = Object.freeze([
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

export const PLAN_TRANSITIONS = Object.freeze({
    "needs-clarification": Object.freeze(["awaiting-package-decisions"]),
    "awaiting-package-decisions": Object.freeze(["approved", "needs-clarification"]),
    "review-limit-reached": Object.freeze(["awaiting-package-decisions"]),
    approved: Object.freeze(["awaiting-package-decisions", "approved"]),
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

export function canTransition(kind, from, to) {
    const table = transitionTable(kind);
    if (!table) {
        return false;
    }
    return Array.isArray(table[from]) && table[from].includes(to);
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
    if (previousStatus === "approved" && nextStatus === "awaiting-package-decisions") {
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
    reasons.push(...blockerReasons(candidate));
    if (Array.isArray(candidate.findings) && candidate.findings.some((finding) => {
        return finding && ["CRITICAL", "HIGH"].includes(finding.severity)
            && ["open", "reopened"].includes(finding.status);
    })) {
        reasons.push("open_high_findings");
    }
    if (candidate.review_complete !== true) {
        reasons.push("review_incomplete");
    }
    reasons.push(...reviewHistoryReasons(candidate));
    reasons.push(...simplificationReasons(candidate));

    return {approved: reasons.length === 0, reasons};
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
        }
    }

    const graphResult = validateDependencyGraph(records);
    errors.push(...graphResult.errors);
    return {valid: errors.length === 0, errors};
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
        if (questions.some((question) => !isValidQuestionRecord(question))) {
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
    if (typeof question === "string") {
        return /\[BLOCKING\]/i.test(question);
    }
    return Boolean(question)
        && typeof question === "object"
        && !Array.isArray(question)
        && question.blocking === true
        && question.resolved !== true;
}

function isValidQuestionRecord(question) {
    if (typeof question === "string") {
        return true;
    }
    return Boolean(question)
        && typeof question === "object"
        && !Array.isArray(question)
        && (!Object.hasOwn(question, "blocking") || typeof question.blocking === "boolean")
        && (!Object.hasOwn(question, "resolved") || typeof question.resolved === "boolean");
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
    if (candidate.review_history.some((review) => {
        return !review
            || typeof review !== "object"
            || !Number.isInteger(review.iteration)
            || review.iteration < 1
            || (Object.hasOwn(review, "plan_version")
                && (!Number.isInteger(review.plan_version) || review.plan_version < 1));
    })) {
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
