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

export const SESSION_STRATEGY_MODES = Object.freeze([
    "single-session",
    "staged",
    "hybrid",
]);

export const USER_DECISION_PROPAGATION_STATUSES = Object.freeze([
    "pending",
    "propagated",
]);

export const STATE_SCHEMA_VERSION = 2;

export const WORKFLOW_PHASES = Object.freeze([
    "intake",
    "initial-draft",
    "source/context",
    "review",
    "decisions",
    "handoff",
]);

export const WORKFLOW_OUTCOMES = Object.freeze([
    "running",
    "blocked",
    "complete",
]);

export const SOURCE_FETCH_STATUSES = Object.freeze([
    "pending",
    "complete",
    "failed",
]);

export const MUTATION_TYPES = Object.freeze([
    "create-initial",
    "checkpoint",
    "workflow-phase-transition",
    "plan-transition",
    "plan-revision",
    "package-decision",
    "package-reopen",
    "question-decision",
    "review-record",
    "finding-record",
    "simplification-record",
    "context-requirements-update",
    "hybrid-attempt",
    "source-fetch-complete",
    "source-fetch-failed",
]);

export const WORKFLOW_PHASE_TRANSITIONS = Object.freeze({
    intake: Object.freeze(["initial-draft"]),
    "initial-draft": Object.freeze(["source/context"]),
    "source/context": Object.freeze(["review"]),
    review: Object.freeze(["source/context", "decisions"]),
    decisions: Object.freeze(["review", "handoff"]),
    handoff: Object.freeze([]),
});

export const DEFAULT_SESSION_STRATEGY = Object.freeze({
    mode: "staged",
    rationale: "Initial draft is materialized before source intake.",
    stages: [{
        id: "S1",
        title: "Source intake",
        rationale: "Fetch and assess the source before defining packages.",
        work_package_ids: [],
        dependencies: [],
        session_boundary: "same-session",
        entry_criteria: ["Initial draft exists."],
        exit_criteria: ["Source fetched and profile assigned."],
    }],
    session_boundary_recommendation: "Resume after source intake.",
    dependencies: ["source fetch"],
    entry_criteria: ["Initial draft is valid."],
    exit_criteria: ["Blocking questions have explicit decisions."],
});

export const DEFAULT_OWNERSHIP_REDUNDANCY_REVIEW = Object.freeze({
    required: false,
    requirement_basis: "not-applicable",
    requirement_decision_ref: "",
    status: "not-required",
    subjects: [],
});

const QUESTION_ID = /^(SQ[1-9][0-9]*|WP[1-9][0-9]*-Q[1-9][0-9]*)$/;
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
    "review-limit-reached": Object.freeze([]),
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

export function createInitialState(plan, options = {}) {
    const input = requirePlanStateInput(plan);
    const now = requireStateTimestamp(toTimestamp(options.now ?? input.now ?? new Date().toISOString()), "now");
    const inputProfile = input.input_profile ?? input.source?.input_profile ?? "brief-request";
    const planStatus = input.plan_status ?? (inputProfile === "title-only" ? "needs-clarification" : "review-pending");
    if (!PLAN_STATUSES.includes(planStatus)) {
        throw new StateError("INVALID_INITIAL_STATE", `Invalid initial plan_status: ${planStatus}.`);
    }
    if (inputProfile === "title-only" && planStatus !== "needs-clarification") {
        throw new StateError("INVALID_INITIAL_STATE", "A title-only plan must start with plan_status needs-clarification.");
    }

    const simplificationStatus = input.simplification_status ?? input.simplification?.result ?? "pending";
    const initial = {
        schema_version: STATE_SCHEMA_VERSION,
        revision: 0,
        plan_id: input.plan_id,
        draft_path: input.draft_path,
        source_identity: clone(input.source_identity),
        ...(input.source_ref ? {source_ref: input.source_ref} : {}),
        ...(typeof input.issue !== "undefined" ? {issue: input.issue} : {}),
        plan_status: planStatus,
        package_decision_gate: packageGateForStatus(planStatus),
        plan_version: positiveInteger(input.plan_version ?? 1, "plan_version"),
        workflow_phase: "intake",
        workflow_outcome: "running",
        checkpoint: buildCheckpoint({
            phase: "intake",
            completed_at: now,
            next_phase: "initial-draft",
            next_allowed_action: "materialize initial draft",
            forbidden_actions: ["source fetch", "review", "package decisions", "approval"],
            reason: "Initial state is virtual until create-initial is applied.",
            state_revision: 0,
        }),
        source_fetch_status: "pending",
        fetched_at: null,
        source_updated_at: null,
        source_fetch_error: null,
        source_fetch_failed_at: null,
        hybrid_attempt_id: null,
        hybrid_attempt_hash: null,
        hybrid_attempt: null,
        context_requirements: normalizeContextRequirements(input.context_requirements),
        packages: Array.isArray(input.packages) ? clone(input.packages) : [],
        findings: Array.isArray(input.findings) ? clone(input.findings) : [],
        review_history: Array.isArray(input.review_history) ? clone(input.review_history) : [],
        decisions: Array.isArray(input.decisions) ? clone(input.decisions) : [],
        user_decisions: Array.isArray(input.user_decisions) ? clone(input.user_decisions) : [],
        scope_questions: Array.isArray(input.scope_questions) ? clone(input.scope_questions) : [],
        blockers: Array.isArray(input.blockers) ? clone(input.blockers) : [],
        plan_history: Array.isArray(input.plan_history) ? clone(input.plan_history) : [],
        phase_history: [],
        simplification_status: simplificationStatus,
        simplification: input.simplification ?? {result: simplificationStatus},
        review_complete: input.review_complete ?? false,
        critical_review_complete: input.critical_review_complete ?? false,
        simplification_control_review_complete: input.simplification_control_review_complete ?? false,
        session_strategy: clone(input.session_strategy ?? DEFAULT_SESSION_STRATEGY),
        ownership_redundancy_review: clone(input.ownership_redundancy_review ?? DEFAULT_OWNERSHIP_REDUNDANCY_REVIEW),
        created_at: now,
        updated_at: now,
    };

    const validation = validateTaskPlanState(initial);
    if (!validation.valid) {
        throw new StateError("INVALID_INITIAL_STATE", validation.errors.join(" "), {errors: validation.errors});
    }
    return initial;
}

export function validateTaskPlanState(state) {
    if (!isRecord(state)) {
        return {valid: false, errors: ["Task-plan state must be an object."]};
    }

    const errors = [
        ...validateStateEnvelope(state),
        ...validateStateSource(state),
        ...validateContextRequirements(state.context_requirements),
        ...validateStateRecordsForStore(state),
    ];
    return {valid: errors.length === 0, errors};
}

export function applyStateMutation(state, mutation, context = {}) {
    const type = mutation?.type;
    if (!MUTATION_TYPES.includes(type)) {
        throw new StateError("UNKNOWN_MUTATION", `Unsupported state mutation: ${type ?? ""}.`);
    }

    const current = prepareState(state);
    if (typeof mutation.payload !== "undefined" && !isRecord(mutation.payload)) {
        throw new StateError("INVALID_MUTATION", "mutation.payload must be an object.");
    }
    const payload = mutation.payload ?? {};
    const now = requireStateTimestamp(toTimestamp(context.now ?? new Date().toISOString()), "now");
    switch (type) {
        case "create-initial":
            return applyCreateInitial(current, payload, now);
        case "checkpoint":
            return applyCheckpoint(current, payload, now);
        case "workflow-phase-transition":
            return applyWorkflowPhaseTransition(current, payload, now);
        case "plan-transition":
            return applyPlanMutation(current, payload);
        case "package-decision":
            return applyPackageMutation(current, payload);
        case "package-reopen":
            return applyPackageReopenMutation(current, payload);
        case "question-decision":
            return applyQuestionMutation(current, payload);
        case "plan-revision":
            return applyPlanRevision(current, payload, now);
        case "review-record":
            return appendReviewRecord(current, payload);
        case "finding-record":
            return appendFindingRecord(current, payload);
        case "simplification-record":
            return applySimplificationMutation(current, payload);
        case "context-requirements-update":
            return applyContextRequirementsMutation(current, payload);
        case "hybrid-attempt":
            return applyHybridAttemptMutation(current, payload, now);
        case "source-fetch-complete":
            return applySourceFetchComplete(current, payload);
        case "source-fetch-failed":
            return applySourceFetchFailed(current, payload, now);
        default:
            throw new StateError("UNKNOWN_MUTATION", `Unsupported state mutation: ${type}.`);
    }
}

function requirePlanStateInput(plan) {
    if (!isRecord(plan)) {
        throw new StateError("INVALID_PLAN", "State-store plan must be an object.");
    }
    for (const field of ["plan_id", "draft_path"]) {
        if (typeof plan[field] !== "string" || plan[field].trim() === "") {
            throw new StateError("INVALID_PLAN", `State-store plan requires ${field}.`);
        }
    }
    if (typeof plan.source_identity === "undefined" || plan.source_identity === null) {
        throw new StateError("INVALID_PLAN", "State-store plan requires source_identity.");
    }
    return plan;
}

function positiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new StateError("INVALID_STATE", `${name} must be a positive integer.`);
    }
    return number;
}

function requireStateString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StateError("INVALID_STATE", `${name} must be a non-empty string.`);
    }
    return value.trim();
}

function requireStateTimestamp(value, name) {
    const timestamp = requireStateString(value, name);
    if (Number.isNaN(Date.parse(timestamp))) {
        throw new StateError("INVALID_STATE", `${name} must be a valid timestamp.`);
    }
    return timestamp;
}

function toTimestamp(value) {
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "number") {
        return new Date(value).toISOString();
    }
    return value;
}

function packageGateForStatus(status) {
    return ["awaiting-package-decisions", "approved"].includes(status) ? "open" : "closed";
}

function buildCheckpoint(input) {
    const phase = input.phase;
    if (!WORKFLOW_PHASES.includes(phase)) {
        throw new StateError("INVALID_CHECKPOINT", `Unknown checkpoint phase: ${phase ?? ""}.`);
    }
    return {
        phase,
        completed_at: requireStateTimestamp(input.completed_at, "checkpoint.completed_at"),
        next_phase: input.next_phase === null ? null : requireStateString(input.next_phase, "checkpoint.next_phase"),
        next_allowed_action: requireStateString(input.next_allowed_action, "checkpoint.next_allowed_action"),
        forbidden_actions: normalizeStringArray(input.forbidden_actions, "checkpoint.forbidden_actions"),
        reason: requireStateString(input.reason, "checkpoint.reason"),
        state_revision: nonNegativeInteger(input.state_revision, "checkpoint.state_revision"),
    };
}

function nonNegativeInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
        throw new StateError("INVALID_STATE", `${name} must be a non-negative integer.`);
    }
    return number;
}

function normalizeStringArray(value, name) {
    if (!Array.isArray(value)) {
        throw new StateError("INVALID_STATE", `${name} must be an array.`);
    }
    return value.map((item, index) => requireStateString(item, `${name}[${index}]`));
}

function normalizeContextRequirements(input = {}) {
    if (!isRecord(input)) {
        throw new StateError("INVALID_CONTEXT_REQUIREMENTS", "context_requirements must be an object.");
    }
    return {
        blocking: normalizeBlockingRequirements(input.blocking ?? []),
        follow_up: normalizeFollowUpRequirements(input.follow_up ?? input.followUp ?? []),
    };
}

function normalizeBlockingRequirements(items) {
    if (!Array.isArray(items)) {
        throw new StateError("INVALID_CONTEXT_REQUIREMENTS", "context_requirements.blocking must be an array.");
    }
    return items.map((item, index) => {
        if (typeof item === "string") {
            return {id: `B${index + 1}`, criterion: requireStateString(item, "blocking criterion")};
        }
        if (!isRecord(item)) {
            throw new StateError("INVALID_CONTEXT_REQUIREMENTS", `Blocking requirement ${index + 1} must be an object.`);
        }
        return {
            id: requireStateString(item.id, `blocking requirement ${index + 1}.id`),
            criterion: requireStateString(item.criterion ?? item.description ?? item.reason, `blocking requirement ${index + 1}.criterion`),
        };
    });
}

function normalizeFollowUpRequirements(items) {
    if (!Array.isArray(items)) {
        throw new StateError("INVALID_CONTEXT_REQUIREMENTS", "context_requirements.follow_up must be an array.");
    }
    return items.map((item, index) => {
        if (!isRecord(item)) {
            throw new StateError("INVALID_CONTEXT_REQUIREMENTS", `Follow-up requirement ${index + 1} must be an object.`);
        }
        if (item.verified === true) {
            throw new StateError("INVALID_CONTEXT_REQUIREMENTS", `Follow-up requirement ${index + 1} cannot be verified by state input.`);
        }
        return {
            id: requireStateString(item.id, `follow-up requirement ${index + 1}.id`),
            reason: requireStateString(item.reason ?? item.description, `follow-up requirement ${index + 1}.reason`),
            owner: requireStateString(item.owner, `follow-up requirement ${index + 1}.owner`),
            target_phase: requireStateString(item.target_phase ?? item.phase, `follow-up requirement ${index + 1}.target_phase`),
        };
    });
}

function validateStateEnvelope(state) {
    const errors = [];
    if (state.schema_version !== STATE_SCHEMA_VERSION) {
        errors.push(`Unsupported schema_version: ${state.schema_version ?? ""}.`);
    }
    if (!Number.isInteger(state.revision) || state.revision < 0) {
        errors.push("State revision must be a non-negative integer.");
    }
    for (const field of ["plan_id", "draft_path"]) {
        if (!isNonEmptyString(state[field])) {
            errors.push(`State is missing ${field}.`);
        }
    }
    if (typeof state.source_identity === "undefined" || state.source_identity === null) {
        errors.push("State is missing source_identity.");
    }
    if (!PLAN_STATUSES.includes(state.plan_status)) {
        errors.push(`Invalid plan_status: ${state.plan_status ?? ""}.`);
    }
    if (state.package_decision_gate !== packageGateForStatus(state.plan_status)) {
        errors.push(`package_decision_gate must match plan_status ${state.plan_status}.`);
    }
    if (!WORKFLOW_PHASES.includes(state.workflow_phase)) {
        errors.push(`Invalid workflow_phase: ${state.workflow_phase ?? ""}.`);
    }
    if (!WORKFLOW_OUTCOMES.includes(state.workflow_outcome)) {
        errors.push(`Invalid workflow_outcome: ${state.workflow_outcome ?? ""}.`);
    }
    if (!isRecord(state.checkpoint)) {
        errors.push("State must contain a checkpoint object.");
    } else {
        errors.push(...validateCheckpoint(state.checkpoint, state.revision));
    }
    if (!Number.isInteger(state.plan_version) || state.plan_version < 1) {
        errors.push("State plan_version must be a positive integer.");
    }
    if (state.workflow_outcome === "complete"
        && (state.workflow_phase !== "handoff" || state.plan_status !== "approved")) {
        errors.push("workflow_outcome=complete requires approved handoff state.");
    }
    if (state.plan_status === "approved" && !["decisions", "handoff"].includes(state.workflow_phase)) {
        errors.push("approved plan_status is only allowed in decisions or handoff phases.");
    }
    return errors;
}

function validateCheckpoint(checkpoint, revision) {
    const errors = [];
    if (!WORKFLOW_PHASES.includes(checkpoint.phase)) {
        errors.push("Checkpoint phase is invalid.");
    }
    if (typeof checkpoint.completed_at !== "string" || Number.isNaN(Date.parse(checkpoint.completed_at))) {
        errors.push("Checkpoint completed_at must be a valid timestamp.");
    }
    if (checkpoint.next_phase !== null && !WORKFLOW_PHASES.includes(checkpoint.next_phase)) {
        errors.push("Checkpoint next_phase is invalid.");
    }
    for (const field of ["next_allowed_action", "reason"]) {
        if (!isNonEmptyString(checkpoint[field])) {
            errors.push(`Checkpoint ${field} must be a non-empty string.`);
        }
    }
    if (!Array.isArray(checkpoint.forbidden_actions)
        || checkpoint.forbidden_actions.some((item) => !isNonEmptyString(item))) {
        errors.push("Checkpoint forbidden_actions must contain non-empty strings.");
    }
    if (!Number.isInteger(checkpoint.state_revision)
        || checkpoint.state_revision < 0
        || checkpoint.state_revision > revision) {
        errors.push("Checkpoint state_revision must be within the state revision.");
    }
    return errors;
}

function validateStateSource(state) {
    const errors = [];
    if (!SOURCE_FETCH_STATUSES.includes(state.source_fetch_status)) {
        errors.push(`Invalid source_fetch_status: ${state.source_fetch_status ?? ""}.`);
        return errors;
    }
    if (state.source_fetch_status === "pending") {
        if (state.fetched_at !== null
            || state.source_updated_at !== null
            || state.source_fetch_error !== null
            || state.source_fetch_failed_at !== null) {
            errors.push("Pending source fetch cannot contain completion timestamps or an error.");
        }
    }
    if (state.source_fetch_status === "complete") {
        for (const field of ["fetched_at", "source_updated_at"]) {
            if (typeof state[field] !== "string" || Number.isNaN(Date.parse(state[field]))) {
                errors.push(`Complete source fetch requires valid ${field}.`);
            }
        }
        if (state.source_fetch_error !== null) {
            errors.push("Complete source fetch cannot contain source_fetch_error.");
        }
    }
    if (state.source_fetch_status === "failed") {
        if (!isNonEmptyString(state.source_fetch_error)) {
            errors.push("Failed source fetch requires source_fetch_error.");
        }
        if (typeof state.source_fetch_failed_at !== "string"
            || Number.isNaN(Date.parse(state.source_fetch_failed_at))) {
            errors.push("Failed source fetch requires a valid source_fetch_failed_at.");
        }
    }
    return errors;
}

function validateContextRequirements(requirements) {
    if (!isRecord(requirements)) {
        return ["context_requirements must be an object."];
    }
    const errors = [];
    if (!Array.isArray(requirements.blocking)) {
        errors.push("context_requirements.blocking must be an array.");
    }
    if (!Array.isArray(requirements.follow_up)) {
        errors.push("context_requirements.follow_up must be an array.");
    }
    const ids = new Set();
    for (const [index, item] of (requirements.blocking ?? []).entries()) {
        if (!isRecord(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.criterion)) {
            errors.push(`Blocking requirement ${index + 1} must contain id and criterion.`);
            continue;
        }
        addUniqueId(ids, item.id, errors, "context requirement");
    }
    for (const [index, item] of (requirements.follow_up ?? []).entries()) {
        if (!isRecord(item)
            || !isNonEmptyString(item.id)
            || !isNonEmptyString(item.reason)
            || !isNonEmptyString(item.owner)
            || !isNonEmptyString(item.target_phase)) {
            errors.push(`Follow-up requirement ${index + 1} must contain id, reason, owner and target_phase.`);
            continue;
        }
        if (item.verified === true) {
            errors.push(`Follow-up requirement ${item.id} cannot be marked verified by the state store.`);
        }
        addUniqueId(ids, item.id, errors, "context requirement");
    }
    return errors;
}

function addUniqueId(ids, value, errors, label) {
    if (ids.has(value)) {
        errors.push(`Duplicate ${label} id: ${value}.`);
        return;
    }
    ids.add(value);
}

function validateStateRecordsForStore(state) {
    const errors = [];
    errors.push(...validatePackageRecords(state.packages).errors);
    errors.push(...validateDecisionHistory(state.decisions));
    errors.push(...validateSessionStrategy(state.session_strategy));
    errors.push(...validateOwnershipRedundancyReview(state.ownership_redundancy_review, state.findings));
    errors.push(...validateUserDecisionRecords(state.user_decisions, {packages: state.packages}));
    errors.push(...validateStateQuestions(state));
    errors.push(...validateStateCollections(state));
    return errors;
}

function validateStateQuestions(state) {
    const errors = [];
    errors.push(...validateQuestionRecords(state.scope_questions, {scope: "scope"}));
    for (const packageRecord of state.packages) {
        errors.push(...validateQuestionRecords(packageRecord.questions, {packageId: packageRecord.id}));
    }
    return errors;
}

function validateStateCollections(state) {
    const errors = [];
    for (const field of ["findings", "review_history", "decisions", "user_decisions", "scope_questions", "blockers", "plan_history", "phase_history"]) {
        if (!Array.isArray(state[field])) {
            errors.push(`${field} must be an array.`);
        }
    }
    if (!SIMPLIFICATION_STATUSES.includes(state.simplification_status)) {
        errors.push("Invalid simplification_status.");
    }
    if (!isRecord(state.simplification) || state.simplification.result !== state.simplification_status) {
        errors.push("simplification must match simplification_status.");
    }
    for (const field of ["review_complete", "critical_review_complete", "simplification_control_review_complete"]) {
        if (typeof state[field] !== "boolean") {
            errors.push(`${field} must be boolean.`);
        }
    }
    return errors;
}

function applyCreateInitial(state, payload, now) {
    if (state.revision !== 0) {
        throw new StateError("STATE_ALREADY_MATERIALIZED", "create-initial can only be applied to virtual state.");
    }
    const nextState = clone(state);
    nextState.workflow_phase = "initial-draft";
    nextState.workflow_outcome = "running";
    nextState.checkpoint = buildCheckpoint({
        phase: "initial-draft",
        completed_at: now,
        next_phase: "source/context",
        next_allowed_action: "fetch and assess source",
        forbidden_actions: ["provisional work packages", "review", "package decisions", "approval"],
        reason: payload.reason ?? "Initial draft and state materialized.",
        state_revision: state.revision + 1,
    });
    nextState.phase_history.push({
        from: "intake",
        to: "initial-draft",
        changed_at: now,
        reason: payload.reason ?? "Initial draft and state materialized.",
    });
    return nextState;
}

function applyCheckpoint(state, payload, now) {
    const resume = payload.resume === true;
    if (resume) {
        requireStateString(payload.reason, "resume checkpoint reason");
        if (state.workflow_outcome !== "blocked") {
            throw new StateError("INVALID_WORKFLOW_RESUME", "Only a blocked workflow can be resumed.");
        }
    }
    const phase = payload.phase ?? state.workflow_phase;
    const checkpoint = buildCheckpoint({
        phase,
        completed_at: payload.completed_at ?? now,
        next_phase: payload.next_phase ?? nextPhaseFor(phase),
        next_allowed_action: payload.next_allowed_action ?? actionForPhase(nextPhaseFor(phase)),
        forbidden_actions: payload.forbidden_actions ?? forbiddenActionsFor(phase),
        reason: payload.reason ?? "Phase checkpoint recorded.",
        state_revision: state.revision + 1,
    });
    const nextState = clone(state);
    nextState.checkpoint = checkpoint;
    nextState.workflow_outcome = resume
        ? "running"
        : (state.workflow_outcome === "blocked" ? "blocked" : (payload.workflow_outcome ?? "running"));
    return nextState;
}

function applyWorkflowPhaseTransition(state, payload, now) {
    const from = state.workflow_phase;
    const to = requireStateString(payload.to ?? payload.phase, "workflow phase");
    if (!WORKFLOW_PHASES.includes(to) || !WORKFLOW_PHASE_TRANSITIONS[from]?.includes(to)) {
        throw new StateError("INVALID_WORKFLOW_PHASE_TRANSITION", `Invalid workflow phase transition: ${from} → ${to}.`);
    }
    const nextState = clone(state);
    nextState.workflow_phase = to;
    nextState.workflow_outcome = "running";
    nextState.checkpoint = buildCheckpoint({
        phase: to,
        completed_at: now,
        next_phase: nextPhaseFor(to),
        next_allowed_action: actionForPhase(nextPhaseFor(to)),
        forbidden_actions: forbiddenActionsFor(to),
        reason: payload.reason ?? `Entered workflow phase ${to}.`,
        state_revision: state.revision + 1,
    });
    nextState.phase_history.push({
        from,
        to,
        changed_at: now,
        reason: payload.reason ?? `Entered workflow phase ${to}.`,
    });
    return nextState;
}

function applyPlanMutation(state, payload) {
    const nextStatus = payload.to ?? payload.status ?? payload.plan_status;
    const nextState = applyPlanTransition(state, nextStatus, {
        reason: payload.reason,
        changed_at: payload.changed_at,
    });
    nextState.package_decision_gate = packageGateForStatus(nextState.plan_status);
    if (nextState.plan_status === "review-limit-reached") {
        nextState.workflow_outcome = "blocked";
    }
    return nextState;
}

function applyPackageMutation(state, payload) {
    return applyPackageDecision(state, payload.decision ?? payload);
}

function applyPackageReopenMutation(state, payload) {
    return reopenPackage(state, payload.package_id, payload);
}

function applyQuestionMutation(state, payload) {
    return applyQuestionDecision(state, payload.decision ?? payload);
}

function applyPlanRevision(state, payload, now) {
    if (state.workflow_phase !== "review") {
        throw new StateError("INVALID_PLAN_REVISION_PHASE", "plan-revision is allowed only in workflow phase review.");
    }
    if (state.plan_status === "review-limit-reached") {
        throw new StateError("REVIEW_LIMIT_REACHED", "The review limit is terminal for this plan identity; explicitly restart.");
    }
    requireStateString(payload.reason, "plan-revision reason");
    if (!Array.isArray(payload.packages) || !Array.isArray(payload.findings) || !isRecord(payload.session_strategy)) {
        throw new StateError("INVALID_PLAN_REVISION", "plan-revision requires packages, findings and session_strategy.");
    }

    const packages = clone(payload.packages);
    const findings = clone(payload.findings);
    const sessionStrategy = clone(payload.session_strategy);
    const packageValidation = validatePackageRecords(packages);
    const strategyErrors = validateSessionStrategy(sessionStrategy);
    if (!packageValidation.valid || strategyErrors.length > 0 || findings.some((finding) => !isRecord(finding))) {
        const errors = [
            ...packageValidation.errors,
            ...strategyErrors,
            ...(findings.some((finding) => !isRecord(finding)) ? ["Every finding must be an object."] : []),
        ];
        throw new StateError("INVALID_PLAN_REVISION", errors.join(" "), {errors});
    }

    const previousSnapshot = JSON.stringify({
        packages: state.packages,
        findings: state.findings,
        session_strategy: state.session_strategy,
    });
    const nextSnapshot = JSON.stringify({packages, findings, session_strategy: sessionStrategy});
    if (previousSnapshot === nextSnapshot) {
        throw new StateError("PLAN_REVISION_NO_CHANGE", "plan-revision must change the semantic plan snapshot.");
    }

    const nextState = clone(state);
    nextState.packages = packages;
    nextState.findings = findings;
    nextState.session_strategy = sessionStrategy;
    nextState.plan_version += 1;
    nextState.plan_status = "review-pending";
    nextState.package_decision_gate = "closed";
    nextState.review_complete = false;
    nextState.critical_review_complete = false;
    nextState.simplification_control_review_complete = false;
    nextState.simplification_status = "pending";
    nextState.simplification = {result: "pending"};

    if (typeof payload.propagated_decision_ref !== "undefined") {
        propagateDecisionThroughPlanRevision(nextState, state, payload.propagated_decision_ref, now);
    }

    const validation = validateTaskPlanState(nextState);
    if (!validation.valid) {
        throw new StateError("INVALID_PLAN_REVISION", validation.errors.join(" "), {errors: validation.errors});
    }
    return nextState;
}

function propagateDecisionThroughPlanRevision(state, previousState, decisionRefValue, now) {
    const decisionRef = requireStateString(decisionRefValue, "propagated_decision_ref");
    const index = state.user_decisions.findIndex((record) => record.decision_ref === decisionRef);
    if (index < 0) {
        throw new StateError("DECISION_NOT_FOUND", `Decision ${decisionRef} was not found.`);
    }
    const record = state.user_decisions[index];
    if (record.propagation_status === "propagated") {
        throw new StateError("DECISION_ALREADY_PROPAGATED", `Decision ${decisionRef} is already propagated.`);
    }
    const refErrors = validateAffectedRefs(record.affected_refs, state.packages);
    if (refErrors.length > 0) {
        throw new StateError("INVALID_PROPAGATION", refErrors.join(" "), {errors: refErrors});
    }
    for (const ref of record.affected_refs) {
        if (ref === "session_strategy") {
            if (JSON.stringify(previousState.session_strategy) === JSON.stringify(state.session_strategy)) {
                throw new StateError("INVALID_PROPAGATION", "Affected session_strategy was not changed by plan-revision.");
            }
            continue;
        }
        const packageId = /^(WP[1-9][0-9]*)(?:\.|$)/.exec(ref)?.[1];
        const previousPackage = previousState.packages.find((item) => item.id === packageId);
        const revisedPackage = state.packages.find((item) => item.id === packageId);
        if (!revisedPackage || JSON.stringify(previousPackage) === JSON.stringify(revisedPackage)) {
            throw new StateError("INVALID_PROPAGATION", `Unsupported or uncovered affected_ref: ${ref}.`);
        }
    }
    state.user_decisions[index] = {
        ...record,
        propagation_status: "propagated",
        propagated_at: now,
    };
}

function appendReviewRecord(state, payload) {
    const record = clone(payload.review ?? payload);
    if (!isRecord(record) || !Number.isInteger(record.iteration) || record.iteration < 1) {
        throw new StateError("INVALID_REVIEW_RECORD", "review-record requires a positive integer iteration.");
    }
    if (state.review_history.some((item) => item.iteration === record.iteration)) {
        throw new StateError("DUPLICATE_REVIEW_ITERATION", `Review iteration ${record.iteration} is already recorded.`);
    }
    if (state.review_history.length >= 3) {
        throw new StateError("REVIEW_LIMIT_REACHED", "At most three review iterations are allowed for one plan identity; explicitly restart.");
    }
    const nextState = clone(state);
    nextState.review_history.push(record);
    if (record.complete === true) {
        nextState.review_complete = true;
    }
    if (record.stage === "critical-review" && record.complete === true) {
        nextState.critical_review_complete = true;
    }
    return nextState;
}

function appendFindingRecord(state, payload) {
    const record = clone(payload.finding ?? payload);
    if (!isRecord(record) || !isNonEmptyString(record.id)) {
        throw new StateError("INVALID_FINDING_RECORD", "finding-record requires a non-empty id.");
    }
    if (state.findings.some((item) => item?.id === record.id)) {
        throw new StateError("DUPLICATE_FINDING_ID", `Finding ${record.id} is already recorded.`);
    }
    const nextState = clone(state);
    nextState.findings.push(record);
    return nextState;
}

function applySimplificationMutation(state, payload) {
    const simplification = clone(payload.simplification ?? payload);
    const result = simplification.result ?? payload.status;
    if (!SIMPLIFICATION_STATUSES.includes(result)) {
        throw new StateError("INVALID_SIMPLIFICATION", `Invalid simplification result: ${result ?? ""}.`);
    }
    simplification.result = result;
    const nextState = clone(state);
    nextState.simplification = simplification;
    nextState.simplification_status = result;
    if (typeof payload.control_review_complete === "boolean") {
        nextState.simplification_control_review_complete = payload.control_review_complete;
    }
    return nextState;
}

function applyContextRequirementsMutation(state, payload) {
    const nextState = clone(state);
    nextState.context_requirements = normalizeContextRequirements(payload.context_requirements ?? payload);
    return nextState;
}

function applyHybridAttemptMutation(state, payload, now) {
    const phase = requireStateString(payload.phase ?? state.workflow_phase, "hybrid_attempt.phase");
    const runId = requireStateString(payload.run_id, "hybrid_attempt.run_id");
    const attemptId = requireStateString(payload.attempt_id ?? payload.id ?? runId, "hybrid_attempt.attempt_id");
    const criteriaHash = requireStateString(payload.criteria_hash, "hybrid_attempt.criteria_hash");
    const strategyHash = requireStateString(payload.strategy_hash, "hybrid_attempt.strategy_hash");
    const attemptHash = requireStateString(payload.attempt_hash ?? payload.hash, "hybrid_attempt.hash");
    const nextState = clone(state);
    nextState.hybrid_attempt = {
        run_id: runId,
        attempt_id: attemptId,
        attempt_hash: attemptHash,
        criteria_hash: criteriaHash,
        strategy_hash: strategyHash,
        phase,
        status: payload.status ?? "started",
        started_at: payload.started_at ?? now,
    };
    nextState.hybrid_attempt_id = attemptId;
    nextState.hybrid_attempt_hash = attemptHash;
    return nextState;
}

function applySourceFetchComplete(state, payload) {
    const fetchedAt = requireStateTimestamp(payload.fetched_at, "fetched_at");
    const sourceUpdatedAt = requireStateTimestamp(payload.source_updated_at, "source_updated_at");
    const nextState = clone(state);
    nextState.source_fetch_status = "complete";
    nextState.fetched_at = fetchedAt;
    nextState.source_updated_at = sourceUpdatedAt;
    nextState.source_fetch_error = null;
    nextState.source_fetch_failed_at = null;
    return nextState;
}

function applySourceFetchFailed(state, payload, now) {
    const error = requireStateString(payload.error ?? payload.source_fetch_error, "source_fetch_error");
    const nextState = clone(state);
    nextState.source_fetch_status = "failed";
    nextState.fetched_at = null;
    nextState.source_updated_at = null;
    nextState.source_fetch_error = error;
    nextState.source_fetch_failed_at = payload.failed_at ?? now;
    return nextState;
}

function nextPhaseFor(phase) {
    const next = WORKFLOW_PHASE_TRANSITIONS[phase]?.[0] ?? null;
    return next;
}

function actionForPhase(phase) {
    if (phase === null) {
        return "no further workflow action";
    }
    const actions = {
        intake: "confirm planning trigger",
        "initial-draft": "materialize initial draft",
        "source/context": "fetch source and bounded context",
        review: "record review findings",
        decisions: "collect blocking decisions",
        handoff: "prepare explicit execution handoff",
    };
    return actions[phase] ?? "follow the task-plan contract";
}

function forbiddenActionsFor(phase) {
    const forbidden = {
        intake: ["source fetch", "review", "package decisions"],
        "initial-draft": ["provisional work packages", "review", "approval"],
        "source/context": ["package decisions", "approval", "implementation"],
        review: ["package decisions while gate is closed", "approval", "implementation"],
        decisions: ["approval with open blockers", "implementation"],
        handoff: ["automatic implementation"],
    };
    return forbidden[phase] ?? [];
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
    const reasons = packageDecisionGateReasons({...state, package_decision_gate: "open"});
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
    for (const reason of unpropagatedUserDecisionReasons(candidate)) {
        addReason(reason);
    }
    if (validateQuestionDecisionPropagation(candidate).length > 0) {
        addReason("question_decision_propagation_incomplete");
    }
    if (validateSessionStrategy(candidate.session_strategy).length > 0) {
        addReason("invalid_session_strategy");
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

function unpropagatedUserDecisionReasons(candidate) {
    if (!Object.hasOwn(candidate, "user_decisions")) {
        return [];
    }
    if (!Array.isArray(candidate.user_decisions)) {
        return ["invalid_user_decisions"];
    }
    const pending = candidate.user_decisions.filter((record) => {
        return record && record.propagation_status !== "propagated";
    });
    return pending.length > 0 ? ["unpropagated_user_decisions"] : [];
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
        if (question.context !== null && typeof question.context !== "undefined") {
            if (typeof question.context !== "string" || question.context.trim() === "") {
                errors.push(`${label} context must be a non-empty string.`);
            }
        }
        errors.push(...validateQuestionOptions(question, index));
        if (question.resolved === true
            && Array.isArray(question.options)
            && question.options.length > 0
            && !question.options.some((option) => option && option.id === question.answer)) {
            errors.push(`${label} answer must select one of the declared options.`);
        }
    }

    return errors;
}

function validateQuestionOptions(question, index) {
    const label = `Question ${index + 1}`;
    if (typeof question.options === "undefined") {
        return [];
    }
    if (!Array.isArray(question.options)) {
        return [`${label} options must be an array.`];
    }

    const errors = [];
    const optionIds = new Set();
    for (const [optionIndex, option] of question.options.entries()) {
        const optionLabel = `${label} option ${optionIndex + 1}`;
        if (!option || typeof option !== "object" || Array.isArray(option)) {
            errors.push(`${optionLabel} must be an object.`);
            continue;
        }
        if (typeof option.id !== "string" || option.id.trim() === "") {
            errors.push(`${optionLabel} must contain a non-empty id.`);
        } else if (optionIds.has(option.id)) {
            errors.push(`${optionLabel} has duplicate id ${option.id}.`);
        } else {
            optionIds.add(option.id);
        }
        const hasLabel = typeof option.label === "string" && option.label.trim() !== "";
        const hasDescription = typeof option.description === "string" && option.description.trim() !== "";
        if (!hasLabel && !hasDescription) {
            errors.push(`${optionLabel} must contain label or description.`);
        }
        if (typeof option.consequence !== "string" || option.consequence.trim() === "") {
            errors.push(`${optionLabel} must contain a consequence/tradeoff.`);
        }
    }
    return errors;
}

export function validateSessionStrategy(strategy) {
    if (typeof strategy === "undefined" || strategy === null) {
        return ["Plan state must contain session_strategy."];
    }
    if (!isRecord(strategy)) {
        return ["session_strategy must be an object."];
    }

    const errors = [];
    if (!SESSION_STRATEGY_MODES.includes(strategy.mode)) {
        errors.push("session_strategy.mode is invalid.");
    }
    if (!isNonEmptyString(strategy.rationale)) {
        errors.push("session_strategy.rationale must be a non-empty string.");
    }
    if (!Array.isArray(strategy.stages) || strategy.stages.length === 0) {
        errors.push("session_strategy.stages must be a non-empty array.");
    } else {
        const stageIds = new Set();
        for (const [index, stage] of strategy.stages.entries()) {
            const label = `session_strategy.stages[${index}]`;
            if (!isRecord(stage)) {
                errors.push(`${label} must be an object.`);
                continue;
            }
            errors.push(...validateSessionStageFields(stage, label));
            if (!/^S[1-9][0-9]*$/.test(stage.id ?? "")) {
                errors.push(`${label}.id must match S<number>.`);
            } else if (stageIds.has(stage.id)) {
                errors.push(`${label}.id is duplicated: ${stage.id}.`);
            } else {
                stageIds.add(stage.id);
            }
            errors.push(...validateSessionStagePackages(stage, label));
            errors.push(...validateSessionStageCriteria(stage, label));
        }
    }
    if (!isNonEmptyString(strategy.session_boundary_recommendation)) {
        errors.push("session_strategy.session_boundary_recommendation must be a non-empty string.");
    }
    if (!Array.isArray(strategy.dependencies)) {
        errors.push("session_strategy.dependencies must be an array.");
    } else {
        for (const [index, dependency] of strategy.dependencies.entries()) {
            if (!isNonEmptyString(dependency)) {
                errors.push(`session_strategy.dependencies[${index}] must be a non-empty string.`);
            }
        }
    }
    for (const field of ["entry_criteria", "exit_criteria"]) {
        if (!Array.isArray(strategy[field]) || strategy[field].length === 0) {
            errors.push(`session_strategy.${field} must be a non-empty array.`);
        } else {
            for (const [index, criterion] of strategy[field].entries()) {
                if (!isNonEmptyString(criterion)) {
                    errors.push(`session_strategy.${field}[${index}] must be a non-empty string.`);
                }
            }
        }
    }
    return errors;
}

export function validateAffectedRefs(refs, packages = null) {
    if (!Array.isArray(refs) || refs.length === 0) {
        return ["affected_refs must be a non-empty array."];
    }
    const errors = [];
    const seen = new Set();
    const validatePackageExistence = Array.isArray(packages);
    const packageIds = new Set((validatePackageExistence ? packages : []).map((item) => item?.id));
    for (const [index, ref] of refs.entries()) {
        if (!isNonEmptyString(ref)) {
            errors.push(`affected_refs[${index}] must be a non-empty string.`);
            continue;
        }
        if (seen.has(ref)) {
            errors.push(`affected_refs contains duplicate ref: ${ref}.`);
            continue;
        }
        seen.add(ref);
        if (ref === "session_strategy") {
            continue;
        }
        const packageId = /^(WP[1-9][0-9]*)(?:\.[A-Za-z][A-Za-z0-9_]*)?$/.exec(ref)?.[1];
        if (!packageId || (validatePackageExistence && !packageIds.has(packageId))) {
            errors.push(`Unsupported affected_ref: ${ref}.`);
        }
    }
    return errors;
}

export function validateUserDecisionRecords(records, options = {}) {
    if (!Array.isArray(records)) {
        return ["user_decisions must be an array."];
    }

    const errors = [];
    const refs = new Set();
    for (const [index, record] of records.entries()) {
        const label = `user_decision ${index + 1}`;
        if (!isRecord(record)) {
            errors.push(`${label} must be an object.`);
            continue;
        }
        if (!isNonEmptyString(record.decision_ref)) {
            errors.push(`${label} is missing decision_ref.`);
        } else if (refs.has(record.decision_ref)) {
            errors.push(`Duplicate decision_ref: ${record.decision_ref}.`);
        } else {
            refs.add(record.decision_ref);
        }
        if (!isNonEmptyString(record.question_id) || !QUESTION_ID.test(record.question_id)) {
            errors.push(`${label} question_id must match SQ<number> or WP<number>-Q<number>.`);
        }
        const hasSelectedOption = hasMeaningfulQuestionValue(record.selected_option);
        const hasAnswer = hasMeaningfulQuestionValue(record.answer);
        if (hasSelectedOption === hasAnswer) {
            errors.push(`${label} must contain exactly one of selected_option or answer.`);
        }
        if (!isNonEmptyString(record.decision_source)) {
            errors.push(`${label} is missing decision_source.`);
        }
        if (typeof record.decided_at !== "string" || Number.isNaN(Date.parse(record.decided_at))) {
            errors.push(`${label} decided_at must be a valid timestamp.`);
        }
        errors.push(...validateAffectedRefs(record.affected_refs, options.packages).map((error) => `${label} ${error}`));
        if (!USER_DECISION_PROPAGATION_STATUSES.includes(record.propagation_status)) {
            errors.push(`${label} propagation_status is invalid.`);
        }
    }
    return errors;
}

export function validateQuestionDecisionPropagation(state) {
    const errors = [];
    if (!state || typeof state !== "object") {
        return errors;
    }
    const records = Array.isArray(state.user_decisions) ? state.user_decisions : [];
    const questions = [];
    appendQuestionRecords(questions, state.scope_questions);
    if (Array.isArray(state.packages)) {
        for (const item of state.packages) {
            if (!item || !Array.isArray(item.questions)) {
                continue;
            }
            appendQuestionRecords(questions, item.questions);
        }
    }

    const questionIds = new Set(questions.map((question) => question.id));
    for (const question of questions) {
        if (question.resolved !== true) {
            continue;
        }
        const record = records.find((candidate) => candidate && candidate.question_id === question.id);
        if (!record) {
            errors.push(`Resolved question ${question.id} is missing a user_decisions record.`);
            continue;
        }
        if (Array.isArray(question.options) && question.options.length > 0) {
            if (!isNonEmptyString(record.selected_option)) {
                errors.push(`User decision for ${question.id} must record selected_option.`);
            } else if (!question.options.some((option) => option && option.id === record.selected_option)) {
                errors.push(`User decision for ${question.id} selected_option must be one of the declared options.`);
            } else if (record.selected_option !== question.answer) {
                errors.push(`User decision for ${question.id} answer must match the selected option.`);
            }
        } else if (!isNonEmptyString(record.answer)) {
            errors.push(`User decision for ${question.id} must record answer.`);
        } else if (record.answer !== question.answer) {
            errors.push(`User decision for ${question.id} answer must match the resolved question answer.`);
        }
    }

    for (const record of records) {
        if (record && !questionIds.has(record.question_id)) {
            errors.push(`user_decisions references unknown question ${record.question_id ?? "unknown"}.`);
        }
        if (record && record.propagation_status !== "propagated") {
            errors.push(`user_decisions propagation incomplete for ${record.decision_ref ?? "unknown"}.`);
        }
    }
    return errors;
}

export function applyQuestionDecision(state, decision) {
    const nextState = prepareState(state);
    const questionId = requireString(decision?.question_id, "question_id");
    const question = findQuestion(nextState, questionId);
    if (!question) {
        throw new StateError("QUESTION_NOT_FOUND", `Question ${questionId} was not found.`, {question_id: questionId});
    }
    if (question.resolved === true) {
        throw new StateError("QUESTION_ALREADY_RESOLVED", `Question ${questionId} is already resolved.`, {question_id: questionId});
    }

    const selectedOption = decision?.selected_option;
    const answer = decision?.answer;
    const hasSelectedOption = hasMeaningfulQuestionValue(selectedOption);
    const hasAnswer = hasMeaningfulQuestionValue(answer);
    if (hasSelectedOption === hasAnswer) {
        throw new StateError("INVALID_QUESTION_DECISION", "A question decision must contain exactly one of selected_option or answer.");
    }
    if (hasSelectedOption && (!Array.isArray(question.options)
        || !question.options.some((option) => option?.id === selectedOption))) {
        throw new StateError("INVALID_QUESTION_DECISION", `Selected option is not declared for ${questionId}.`, {
            question_id: questionId,
        });
    }
    if (Array.isArray(question.options) && question.options.length > 0 && !hasSelectedOption) {
        throw new StateError("INVALID_QUESTION_DECISION", `${questionId} requires selected_option because it declares options.`, {
            question_id: questionId,
        });
    }

    const record = {
        decision_ref: requireString(decision?.decision_ref, "decision_ref"),
        question_id: questionId,
        ...(hasSelectedOption ? {selected_option: selectedOption} : {answer}),
        decision_source: requireString(decision?.decision_source, "decision_source"),
        decided_at: requireTimestamp(decision?.decided_at, "decided_at"),
        affected_refs: Array.isArray(decision?.affected_refs) ? [...decision.affected_refs] : [],
        propagation_status: "pending",
    };
    if (nextState.user_decisions.some((candidate) => candidate.decision_ref === record.decision_ref)) {
        throw new StateError("DUPLICATE_DECISION_REF", `Decision ref ${record.decision_ref} is already recorded.`);
    }
    const recordErrors = validateUserDecisionRecords([record], {packages: nextState.packages});
    if (recordErrors.length > 0) {
        throw new StateError("INVALID_QUESTION_DECISION", recordErrors.join(" "), {errors: recordErrors});
    }

    question.resolved = true;
    question.answer = hasSelectedOption ? selectedOption : answer;
    question.decision_source = record.decision_source;
    question.decided_at = record.decided_at;
    nextState.user_decisions.push(record);
    return nextState;
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
    const strategyErrors = validateSessionStrategy(state.session_strategy);
    if (strategyErrors.length > 0) {
        throw new StateError("INVALID_STATE", strategyErrors.join(" "), {errors: strategyErrors});
    }
    if (Object.hasOwn(state, "user_decisions")) {
        const userDecisionErrors = validateUserDecisionRecords(state.user_decisions, {packages: state.packages});
        if (userDecisionErrors.length > 0) {
            throw new StateError("INVALID_STATE", userDecisionErrors.join(" "), {errors: userDecisionErrors});
        }
    }

    return {
        ...clone(state),
        decisions: Array.isArray(state.decisions) ? clone(state.decisions) : [],
        user_decisions: Array.isArray(state.user_decisions) ? clone(state.user_decisions) : [],
    };
}

function findQuestion(state, questionId) {
    const scopeQuestion = (state.scope_questions ?? []).find((question) => question?.id === questionId);
    if (scopeQuestion) {
        return scopeQuestion;
    }
    for (const packageRecord of state.packages ?? []) {
        const packageQuestion = (packageRecord.questions ?? []).find((question) => question?.id === questionId);
        if (packageQuestion) {
            return packageQuestion;
        }
    }
    return null;
}

function validateSessionStageFields(stage, label) {
    const errors = [];
    for (const field of ["id", "title", "rationale", "session_boundary"]) {
        if (!isNonEmptyString(stage[field])) {
            errors.push(`${label}.${field} must be a non-empty string.`);
        }
    }
    if (!Array.isArray(stage.dependencies)) {
        errors.push(`${label}.dependencies must be an array.`);
    } else if (stage.dependencies.some((dependency) => !isNonEmptyString(dependency))) {
        errors.push(`${label}.dependencies must contain non-empty strings.`);
    }
    return errors;
}

function validateSessionStagePackages(stage, label) {
    if (!Array.isArray(stage.work_package_ids)) {
        return [`${label}.work_package_ids must be an array.`];
    }
    return stage.work_package_ids.flatMap((packageId, index) => {
        return /^WP[1-9][0-9]*$/.test(packageId ?? "")
            ? []
            : [`${label}.work_package_ids[${index}] must match WP<number>.`];
    });
}

function validateSessionStageCriteria(stage, label) {
    const errors = [];
    for (const field of ["entry_criteria", "exit_criteria"]) {
        if (!Array.isArray(stage[field]) || stage[field].length === 0) {
            errors.push(`${label}.${field} must be a non-empty array.`);
        } else if (stage[field].some((criterion) => !isNonEmptyString(criterion))) {
            errors.push(`${label}.${field} must contain non-empty strings.`);
        }
    }
    return errors;
}

function appendQuestionRecords(target, candidates) {
    if (!Array.isArray(candidates)) {
        return;
    }
    for (const question of candidates) {
        if (question && typeof question === "object" && !Array.isArray(question)) {
            target.push(question);
        }
    }
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
