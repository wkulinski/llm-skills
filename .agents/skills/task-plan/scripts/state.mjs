#!/usr/bin/env node

import crypto from "node:crypto";
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

export const SIMPLIFICATION_RESULTS = Object.freeze([
    "no-change",
    "simplified",
    "needs-user-decision",
]);

export const SIMPLIFICATION_CONTROL_REVIEW_RESULTS = Object.freeze([
    "no-change",
    "simplified",
]);

export const REVIEW_LIMIT = 3;

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

export const INPUT_PROFILES = Object.freeze([
    "title-only",
    "brief-request",
    "specification",
    "detailed-plan",
]);

export const INTAKE_CERTAINTY_LEVELS = Object.freeze(["high", "medium", "low", "unknown"]);

export const INTAKE_TASK_TYPES = Object.freeze([
    "bug",
    "feature",
    "refactor",
    "documentation",
    "configuration",
    "operational",
    "unknown",
]);

export const SCOPE_CHANGE_TYPES = Object.freeze([
    "inventory/evidence-expansion",
    "known-scope-description",
]);

export const HYBRID_ATTEMPT_STATUSES = Object.freeze([
    "started",
    "complete",
    "incomplete",
    "blocked",
    "COMPLETE",
    "INCOMPLETE",
    "BLOCKED",
]);

export const STATE_SCHEMA_VERSION = 3;

export const STATE_LIFECYCLES = Object.freeze([
    "absent",
    "virtual-initial",
    "persisted",
]);

export const INCOMPLETE_ARTIFACT_LIFECYCLE = "ARTIFACT_SET_INCOMPLETE";

const CANONICAL_STATE_FIELDS = Object.freeze([
    "schema_version",
    "workflow_phase",
    "context_requirements",
]);

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
    "not-required",
    "pending",
    "complete",
    "failed",
]);

export const SOURCE_KINDS = Object.freeze([
    "github-issue",
    "file",
    "user-input",
    "derived-work-package",
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
    "propagate-decisions",
    "review-record",
    "finding-record",
    "simplification-record",
    "context-requirements-update",
    "intake-assessment",
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

export const WORKFLOW_DEFAULT_NEXT_PHASE = Object.freeze({
    intake: "initial-draft",
    "initial-draft": "source/context",
    "source/context": "review",
    review: "decisions",
    decisions: "handoff",
    handoff: null,
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
    "direction-and-simplicity",
    "backward-compatibility",
]);

const QUESTION_FIELDS = Object.freeze(["prompt", "impact", "decision_needed"]);
const QUESTION_RESOLUTION_FIELDS = Object.freeze(["answer", "decision_source", "decided_at"]);
const PREFLIGHT_DECISION_TIMESTAMP = "1970-01-01T00:00:00.000Z";

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

const INTAKE_ASSESSMENT_AXES = Object.freeze([
    "intent_authority",
    "diagnosis_reliability",
    "requirements_completeness",
    "technical_certainty",
]);

const UNKNOWN_INTAKE_RATIONALE = "No intake evidence has been assessed.";

export function createUnknownIntakeAssessment() {
    return {
        ...Object.fromEntries(INTAKE_ASSESSMENT_AXES.map((axis) => [axis, {
            level: "unknown",
            rationale: UNKNOWN_INTAKE_RATIONALE,
            evidence_refs: [],
        }])),
        task_type: "unknown",
    };
}

export function normalizeEvidenceRefs(value, name = "evidence_refs") {
    if (typeof value === "undefined" || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new StateError("INVALID_EVIDENCE_REFS", `${name} must be an array.`);
    }

    const refs = value.map((item, index) => {
        if (isNonEmptyString(item)) {
            return item.trim();
        }
        if (isRecord(item)) {
            const ref = item.ref ?? item.id ?? item.evidence_ref;
            if (isNonEmptyString(ref)) {
                return ref.trim();
            }
        }
        throw new StateError("INVALID_EVIDENCE_REFS", `${name}[${index}] must be a non-empty reference.`);
    });
    if (new Set(refs).size !== refs.length) {
        throw new StateError("INVALID_EVIDENCE_REFS", `${name} must contain unique references.`);
    }
    return refs;
}

export function normalizeIntakeAssessment(input) {
    const defaults = createUnknownIntakeAssessment();
    if (typeof input === "undefined" || input === null) {
        return defaults;
    }
    if (!isRecord(input)) {
        throw new StateError("INVALID_INTAKE_ASSESSMENT", "intake_assessment must be an object.");
    }

    const assessment = {};
    for (const axis of INTAKE_ASSESSMENT_AXES) {
        const candidate = input[axis];
        if (typeof candidate === "undefined" || candidate === null) {
            assessment[axis] = defaults[axis];
            continue;
        }
        if (!isRecord(candidate)) {
            throw new StateError("INVALID_INTAKE_ASSESSMENT", `${axis} must be an object.`);
        }
        const level = candidate.level ?? "unknown";
        if (!INTAKE_CERTAINTY_LEVELS.includes(level)) {
            throw new StateError("INVALID_INTAKE_ASSESSMENT", `${axis}.level is invalid: ${level}.`);
        }
        const rationale = candidate.rationale ?? UNKNOWN_INTAKE_RATIONALE;
        if (!isNonEmptyString(rationale)) {
            throw new StateError("INVALID_INTAKE_ASSESSMENT", `${axis}.rationale must be a non-empty string.`);
        }
        assessment[axis] = {
            level,
            rationale: rationale.trim(),
            evidence_refs: normalizeEvidenceRefs(candidate.evidence_refs ?? candidate.evidenceRefs, `${axis}.evidence_refs`),
        };
        if (level === "high" && assessment[axis].evidence_refs.length === 0) {
            throw new StateError("INVALID_INTAKE_ASSESSMENT", `${axis}.level high requires evidence_refs.`);
        }
    }

    const taskType = input.task_type ?? "unknown";
    if (!INTAKE_TASK_TYPES.includes(taskType)) {
        throw new StateError("INVALID_INTAKE_ASSESSMENT", `task_type is invalid: ${taskType}.`);
    }
    assessment.task_type = taskType;
    return assessment;
}

export function validateIntakeAssessment(assessment) {
    if (!isRecord(assessment)) {
        return ["intake_assessment must be an object."];
    }
    try {
        normalizeIntakeAssessment(assessment);
        return [];
    } catch (error) {
        return [error instanceof StateError ? error.message : String(error)];
    }
}

export function normalizeProvenance(input, fallback = {}) {
    const candidate = typeof input === "undefined" || input === null ? {} : input;
    if (!isRecord(candidate)) {
        throw new StateError("INVALID_PROVENANCE", "provenance must be an object.");
    }
    const sourceKind = candidate.source_kind ?? fallback.source_kind ?? null;
    const sourceRef = candidate.source_ref ?? fallback.source_ref ?? null;
    if (sourceKind !== null && !SOURCE_KINDS.includes(sourceKind)) {
        throw new StateError("INVALID_PROVENANCE", `provenance.source_kind is invalid: ${sourceKind}.`);
    }
    if (sourceRef !== null && !isNonEmptyString(sourceRef)) {
        throw new StateError("INVALID_PROVENANCE", "provenance.source_ref must be a non-empty string or null.");
    }
    return {
        source_kind: sourceKind,
        source_ref: sourceRef === null ? null : sourceRef.trim(),
        evidence_refs: normalizeEvidenceRefs(
            candidate.evidence_refs ?? fallback.evidence_refs,
            "provenance.evidence_refs",
        ),
    };
}

export function validateProvenance(provenance) {
    if (!isRecord(provenance)) {
        return ["provenance must be an object."];
    }
    try {
        normalizeProvenance(provenance);
        return [];
    } catch (error) {
        return [error instanceof StateError ? error.message : String(error)];
    }
}

function normalizePathList(value, name) {
    if (typeof value === "undefined" || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new StateError("INVALID_EVIDENCE_SCOPE", `${name} must be an array.`);
    }
    const paths = value.map((item, index) => {
        if (!isNonEmptyString(item)) {
            throw new StateError("INVALID_EVIDENCE_SCOPE", `${name}[${index}] must be a non-empty path.`);
        }
        return item.trim();
    });
    if (new Set(paths).size !== paths.length) {
        throw new StateError("INVALID_EVIDENCE_SCOPE", `${name} must contain unique paths.`);
    }
    return paths;
}

function normalizeDiscoveryRequirements(value, name) {
    if (typeof value === "undefined" || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new StateError("INVALID_DISCOVERY_REQUIREMENTS", `${name} must be an array.`);
    }
    const ids = new Set();
    return value.map((item, index) => {
        if (!isRecord(item)) {
            throw new StateError("INVALID_DISCOVERY_REQUIREMENTS", `${name}[${index}] must be an object with owner and target_phase.`);
        }
        const id = requireStateString(item.id, `${name}[${index}].id`);
        const reason = requireStateString(item.reason ?? item.description, `${name}[${index}].reason`);
        const owner = requireStateString(item.owner, `${name}[${index}].owner`);
        const targetPhase = requireStateString(item.target_phase ?? item.phase, `${name}[${index}].target_phase`);
        if (ids.has(id)) {
            throw new StateError("INVALID_DISCOVERY_REQUIREMENTS", `${name} contains duplicate id: ${id}.`);
        }
        ids.add(id);
        const normalized = {id, reason, owner, target_phase: targetPhase};
        if (typeof item.path !== "undefined") {
            normalized.path = requireStateString(item.path, `${name}[${index}].path`);
        }
        if (typeof item.evidence_refs !== "undefined") {
            normalized.evidence_refs = normalizeEvidenceRefs(item.evidence_refs, `${name}[${index}].evidence_refs`);
        }
        return normalized;
    });
}

function normalizeWorkPackage(item, index) {
    if (!isRecord(item)) {
        return item;
    }
    const packageProvenance = normalizeProvenance(item.provenance);
    return {
        ...clone(item),
        confirmed_files: normalizePathList(item.confirmed_files, `packages[${index}].confirmed_files`),
        candidate_paths: normalizePathList(item.candidate_paths, `packages[${index}].candidate_paths`),
        discovery_required: normalizeDiscoveryRequirements(item.discovery_required, `packages[${index}].discovery_required`),
        evidence_refs: normalizeEvidenceRefs(
            item.evidence_refs ?? packageProvenance.evidence_refs,
            `packages[${index}].evidence_refs`,
        ),
        provenance: packageProvenance,
    };
}

function normalizeWorkPackages(packages) {
    if (typeof packages === "undefined" || packages === null) {
        return [];
    }
    if (!Array.isArray(packages)) {
        throw new StateError("INVALID_STATE", "packages must be an array.");
    }
    return packages.map(normalizeWorkPackage);
}

export function createInitialState(plan, options = {}) {
    const input = requirePlanStateInput(plan);
    const now = requireStateTimestamp(toTimestamp(options.now ?? input.now ?? new Date().toISOString()), "now");
    const sourceEnvelope = isRecord(input.source) ? input.source : input;
    const inputProfile = requireInputProfile(input.input_profile ?? sourceEnvelope.input_profile);
    const planStatus = input.plan_status ?? (inputProfile === "title-only" ? "needs-clarification" : "review-pending");
    if (!PLAN_STATUSES.includes(planStatus)) {
        throw new StateError("INVALID_INITIAL_STATE", `Invalid initial plan_status: ${planStatus}.`);
    }
    if (inputProfile === "title-only" && planStatus !== "needs-clarification") {
        throw new StateError("INVALID_INITIAL_STATE", "A title-only plan must start with plan_status needs-clarification.");
    }

    const sourceMetadata = initialSourceMetadata(sourceEnvelope);
    const provenance = normalizeProvenance(
        input.provenance ?? sourceEnvelope.provenance,
        {
            ...sourceEnvelope,
            source_ref: input.source_ref
                ?? sourceEnvelope.source_ref
                ?? (isNonEmptyString(input.source_identity) ? input.source_identity : null),
        },
    );
    const initial = {
        schema_version: STATE_SCHEMA_VERSION,
        revision: 0,
        plan_id: input.plan_id,
        draft_path: input.draft_path,
        source_identity: clone(input.source_identity),
        input_profile: inputProfile,
        ...(input.source_ref ? {source_ref: input.source_ref} : {}),
        ...(typeof input.issue !== "undefined" ? {issue: input.issue} : {}),
        plan_status: planStatus,
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
        ...sourceMetadata,
        intake_assessment: normalizeIntakeAssessment(input.intake_assessment ?? sourceEnvelope.intake_assessment),
        provenance,
        hybrid_attempt_id: null,
        hybrid_attempt_hash: null,
        hybrid_attempt: null,
        context_requirements: normalizeContextRequirements(input.context_requirements),
        packages: normalizeWorkPackages(input.packages),
        findings: Array.isArray(input.findings) ? clone(input.findings) : [],
        review_history: Array.isArray(input.review_history) ? clone(input.review_history) : [],
        decisions: Array.isArray(input.decisions) ? clone(input.decisions) : [],
        user_decisions: Array.isArray(input.user_decisions) ? clone(input.user_decisions) : [],
        scope_questions: Array.isArray(input.scope_questions) ? clone(input.scope_questions) : [],
        blockers: Array.isArray(input.blockers) ? clone(input.blockers) : [],
        plan_history: Array.isArray(input.plan_history) ? clone(input.plan_history) : [],
        phase_history: [],
        simplification: input.simplification ?? {result: "pending"},
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
        ...(Object.hasOwn(state, "intake_assessment")
            ? validateIntakeAssessment(state.intake_assessment)
            : ["State must contain intake_assessment."]),
        ...(Object.hasOwn(state, "provenance")
            ? validateProvenance(state.provenance)
            : ["State must contain provenance."]),
        ...validateHybridAttemptState(state),
        ...validateContextRequirements(state.context_requirements),
        ...validateStateRecordsForStore(state),
    ];
    return {valid: errors.length === 0, errors};
}

/**
 * Validate a state that is allowed to exist while the workflow is running.
 * Pending user-decision propagation is intentionally a valid intermediate
 * state; approval has a stricter validator below.
 */
export function validateRuntimeState(state) {
    return validateTaskPlanState(state);
}

/**
 * Validate the state required to enter the approval/handoff gate.
 */
export function validateApprovalState(state) {
    const runtime = validateRuntimeState(state);
    const errors = [...runtime.errors];
    if (!isRecord(state)) {
        return {valid: false, errors};
    }

    const propagationErrors = validateQuestionDecisionPropagation(state);
    errors.push(...propagationErrors);
    const approval = canApprovePlan(state);
    if (!approval.approved) {
        const reasons = approval.reasons.filter((reason) => {
            return !(reason === "question_decision_propagation_incomplete" && propagationErrors.length > 0);
        });
        if (reasons.length > 0) {
            errors.push(`Approval state failed: ${reasons.join(", ")}.`);
        }
    }
    if (state.workflow_outcome === "blocked") {
        errors.push("Approval state cannot be blocked.");
    }

    return {valid: errors.length === 0, errors, approval};
}

/**
 * Return the semantic plan snapshot. Technical revisions such as state
 * revision timestamps and decision propagation status are deliberately absent.
 */
export function planSnapshot(state) {
    const candidate = isRecord(state) ? state : {};
    const packages = Array.isArray(candidate.packages)
        ? candidate.packages.map((item) => isRecord(item)
            ? {
                ...item,
                questions: Array.isArray(item.questions)
                    ? item.questions.map(semanticQuestionSnapshot)
                    : item.questions,
            }
            : item)
        : [];
    const findings = Array.isArray(candidate.findings)
        ? candidate.findings.map((finding) => {
            if (!isRecord(finding)) {
                return finding;
            }
            const {decided_at: _decidedAt, ...semanticFinding} = finding;
            return semanticFinding;
        })
        : [];
    return clone({
        packages,
        findings,
        scope_questions: Array.isArray(candidate.scope_questions)
            ? candidate.scope_questions.map(semanticQuestionSnapshot)
            : [],
        session_strategy: candidate.session_strategy ?? null,
    });
}

function semanticQuestionSnapshot(question) {
    if (!isRecord(question)) {
        return question;
    }
    const semanticQuestion = {...question};
    delete semanticQuestion.answer;
    delete semanticQuestion.decided_at;
    delete semanticQuestion.decision_source;
    delete semanticQuestion.resolved;
    return semanticQuestion;
}

export function planSnapshotFingerprint(state) {
    return crypto.createHash("sha256")
        .update(stableStringify(planSnapshot(state)))
        .digest("hex");
}

export function validateStateLifecycle(input) {
    if (!isRecord(input)) {
        return {
            valid: false,
            errors: ["Plan state must be an object."],
            lifecycle: null,
            state: null,
        };
    }

    if (!Object.hasOwn(input, "lifecycle") && !Object.hasOwn(input, "state")) {
        return {valid: true, errors: [], lifecycle: null, state: input};
    }

    const lifecycle = input.lifecycle ?? input.status;
    if (lifecycle === INCOMPLETE_ARTIFACT_LIFECYCLE) {
        return {
            valid: false,
            errors: ["Draft and state form an incomplete artifact pair; explicit restart is required."],
            lifecycle,
            state: null,
        };
    }
    if (!STATE_LIFECYCLES.includes(lifecycle)) {
        return {
            valid: false,
            errors: [`Invalid state lifecycle: ${lifecycle ?? ""}.`],
            lifecycle,
            state: null,
        };
    }
    const state = input.state ?? null;
    if (lifecycle === "absent") {
        if (state !== null) {
            return {
                valid: false,
                errors: ["Absent state lifecycle must not contain state data."],
                lifecycle,
                state,
            };
        }
        return {valid: true, errors: [], lifecycle, state: null};
    }
    if (!isRecord(state)) {
        return {
            valid: false,
            errors: [`${lifecycle} state lifecycle requires a state object.`],
            lifecycle,
            state,
        };
    }
    if (!isCanonicalState(state)) {
        return {
            valid: false,
            errors: [`${lifecycle} state lifecycle requires the complete canonical state.`],
            lifecycle,
            state,
        };
    }
    return {valid: true, errors: [], lifecycle, state};
}

export function isCanonicalState(state) {
    return isRecord(state) && CANONICAL_STATE_FIELDS.some((field) => Object.hasOwn(state, field));
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
        case "propagate-decisions":
            return applyPropagateDecisions(current, payload, now);
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
        case "intake-assessment":
            return applyIntakeAssessmentMutation(current, payload);
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

function requireInputProfile(value) {
    const profile = requireStateString(value, "input_profile");
    if (!INPUT_PROFILES.includes(profile)) {
        throw new StateError("INVALID_INITIAL_STATE", `Unsupported input profile: ${profile}.`);
    }
    return profile;
}

function initialSourceMetadata(source) {
    if (!isRecord(source)
        || !SOURCE_KINDS.includes(source.source_kind)
        || !SOURCE_FETCH_STATUSES.includes(source.source_fetch_status)) {
        throw new StateError("INVALID_INITIAL_STATE", "Initial state requires explicit source_kind and source_fetch_status in the source envelope.");
    }

    const kind = source.source_kind;
    const status = source.source_fetch_status;
    const kindStatusError = validateSourceKindStatus(kind, status);
    if (kindStatusError) {
        throw new StateError("INVALID_INITIAL_STATE", kindStatusError);
    }
    if (status === "not-required" || status === "pending") {
        if (["fetched_at", "source_updated_at", "source_fetch_error", "source_fetch_failed_at"]
            .some((field) => source[field] !== null && typeof source[field] !== "undefined")) {
            throw new StateError("INVALID_INITIAL_STATE", `${status} source envelope cannot contain fetch metadata.`);
        }
        return {
            source_kind: kind,
            source_fetch_status: status,
            fetched_at: null,
            source_updated_at: null,
            source_fetch_error: null,
            source_fetch_failed_at: null,
        };
    }

    if (status === "complete") {
        return {
            source_kind: kind,
            source_fetch_status: status,
            fetched_at: requireStateTimestamp(source.fetched_at, "fetched_at"),
            source_updated_at: requireStateTimestamp(source.source_updated_at, "source_updated_at"),
            source_fetch_error: null,
            source_fetch_failed_at: null,
        };
    }

    return {
        source_kind: kind,
        source_fetch_status: status,
        fetched_at: null,
        source_updated_at: null,
        source_fetch_error: requireStateString(source.source_fetch_error, "source_fetch_error"),
        source_fetch_failed_at: requireStateTimestamp(source.source_fetch_failed_at, "source_fetch_failed_at"),
    };
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
        if (Object.hasOwn(item, "owner")
            || Object.hasOwn(item, "target_phase")
            || Object.hasOwn(item, "follow_up")) {
            throw new StateError("INVALID_CONTEXT_REQUIREMENTS", `Blocking requirement ${index + 1} must not contain follow-up metadata.`);
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
    for (const field of [
        "package_decision_gate",
        "review_complete",
        "critical_review_complete",
        "simplification_status",
        "simplification_control_review_complete",
    ]) {
        if (Object.hasOwn(state, field)) {
            errors.push(`Derived state field must not be stored: ${field}.`);
        }
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
    if (!INPUT_PROFILES.includes(state.input_profile)) {
        errors.push(`Invalid input_profile: ${state.input_profile ?? ""}.`);
    }
    if (!PLAN_STATUSES.includes(state.plan_status)) {
        errors.push(`Invalid plan_status: ${state.plan_status ?? ""}.`);
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

export function validateStateSourceMetadata(state) {
    if (!Object.hasOwn(state, "source_fetch_status")) {
        return [];
    }
    return validateStateSource(state);
}

function validateStateSource(state) {
    const errors = [];
    if (!SOURCE_KINDS.includes(state.source_kind)) {
        errors.push(`Invalid source_kind: ${state.source_kind ?? ""}.`);
    }
    if (!SOURCE_FETCH_STATUSES.includes(state.source_fetch_status)) {
        errors.push(`Invalid source_fetch_status: ${state.source_fetch_status ?? ""}.`);
        return errors;
    }
    const kindStatusError = validateSourceKindStatus(state.source_kind, state.source_fetch_status);
    if (kindStatusError) {
        errors.push(kindStatusError);
    }
    if (state.source_fetch_status === "not-required" || state.source_fetch_status === "pending") {
        if (state.fetched_at !== null
            || state.source_updated_at !== null
            || state.source_fetch_error !== null
            || state.source_fetch_failed_at !== null) {
            errors.push(`${state.source_fetch_status} source cannot contain completion timestamps or an error.`);
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
        if (state.source_fetch_failed_at !== null) {
            errors.push("Complete source fetch cannot contain source_fetch_failed_at.");
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
        if (state.fetched_at !== null || state.source_updated_at !== null) {
            errors.push("Failed source fetch cannot contain completion timestamps.");
        }
    }
    return errors;
}

function validateHybridAttemptState(state) {
    const errors = [];
    if (!Object.hasOwn(state, "hybrid_attempt")) {
        return ["State must contain hybrid_attempt."];
    }
    if (state.hybrid_attempt === null || typeof state.hybrid_attempt === "undefined") {
        if (state.hybrid_attempt_id !== null || state.hybrid_attempt_hash !== null) {
            errors.push("Empty hybrid_attempt must have null reference fields.");
        }
        return errors;
    }
    if (!isRecord(state.hybrid_attempt)) {
        return ["hybrid_attempt must be an object or null."];
    }
    const attempt = state.hybrid_attempt;
    for (const field of [
        "run_id",
        "attempt_id",
        "attempt_hash",
        "criteria_hash",
        "strategy_hash",
        "phase",
        "status",
    ]) {
        if (!isNonEmptyString(attempt[field])) {
            errors.push(`hybrid_attempt is missing ${field}.`);
        }
    }
    if (isNonEmptyString(attempt.phase) && !WORKFLOW_PHASES.includes(attempt.phase)) {
        errors.push(`hybrid_attempt has invalid phase: ${attempt.phase}.`);
    }
    if (isNonEmptyString(attempt.status) && !HYBRID_ATTEMPT_STATUSES.includes(attempt.status)) {
        errors.push(`hybrid_attempt has invalid status: ${attempt.status}.`);
    }
    if (typeof attempt.started_at !== "string" || Number.isNaN(Date.parse(attempt.started_at))) {
        errors.push("hybrid_attempt.started_at must be a valid timestamp.");
    }
    if (state.hybrid_attempt_id !== attempt.attempt_id) {
        errors.push("hybrid_attempt_id must match hybrid_attempt.attempt_id.");
    }
    if (state.hybrid_attempt_hash !== attempt.attempt_hash) {
        errors.push("hybrid_attempt_hash must match hybrid_attempt.attempt_hash.");
    }
    if (["incomplete", "INCOMPLETE", "blocked", "BLOCKED"].includes(attempt.status)
        && state.intake_assessment?.technical_certainty?.level !== "unknown") {
        errors.push("INCOMPLETE hybrid context requires technical_certainty unknown.");
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
        if (Object.hasOwn(item, "owner")
            || Object.hasOwn(item, "target_phase")
            || Object.hasOwn(item, "follow_up")) {
            errors.push(`Blocking requirement ${item.id} must not contain follow-up metadata.`);
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
    errors.push(...validatePackageRecords(state.packages, {
        evidence_refs: state.provenance?.evidence_refs,
    }).errors);
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
    if (!isRecord(state.simplification) || !SIMPLIFICATION_STATUSES.includes(state.simplification.result)) {
        errors.push("simplification must contain a valid result.");
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
    if (state.workflow_outcome !== "running") {
        throw new StateError("STALE_CHECKPOINT", "Workflow phase transition requires workflow_outcome running.");
    }
    if (!isRecord(state.checkpoint)
        || state.checkpoint.phase !== from
        || state.checkpoint.next_phase !== to
        || state.checkpoint.state_revision !== state.revision) {
        throw new StateError(
            "STALE_CHECKPOINT",
            `Workflow phase transition requires a fresh checkpoint for ${from} → ${to}.`,
            {
                checkpoint: state.checkpoint ?? null,
                state_revision: state.revision,
                requested_phase: to,
            },
        );
    }
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
    const propagatedDecisionRefs = readPropagatedDecisionRefs(payload, {required: false});
    if (!Array.isArray(payload.packages)
        || !Array.isArray(payload.findings)
        || !Array.isArray(payload.scope_questions)
        || !isRecord(payload.session_strategy)) {
        throw new StateError("INVALID_PLAN_REVISION", "plan-revision requires packages, findings, scope_questions and session_strategy.");
    }

    const packages = normalizeWorkPackages(payload.packages);
    const findings = clone(payload.findings);
    const scopeQuestions = clone(payload.scope_questions);
    const sessionStrategy = clone(payload.session_strategy);
    const packageValidation = validatePackageRecords(packages, {
        evidence_refs: state.provenance?.evidence_refs,
    });
    const scopeQuestionErrors = validateQuestionRecords(scopeQuestions, {scope: "scope"});
    const strategyErrors = validateSessionStrategy(sessionStrategy);
    if (!packageValidation.valid
        || scopeQuestionErrors.length > 0
        || strategyErrors.length > 0
        || findings.some((finding) => !isRecord(finding))) {
        const errors = [
            ...packageValidation.errors,
            ...scopeQuestionErrors,
            ...strategyErrors,
            ...(findings.some((finding) => !isRecord(finding)) ? ["Every finding must be an object."] : []),
        ];
        throw new StateError("INVALID_PLAN_REVISION", errors.join(" "), {errors});
    }

    const previousFingerprint = planSnapshotFingerprint(state);
    const candidateState = {
        ...state,
        packages,
        findings,
        scope_questions: scopeQuestions,
        session_strategy: sessionStrategy,
    };
    const nextFingerprint = planSnapshotFingerprint(candidateState);
    if (previousFingerprint === nextFingerprint) {
        throw new StateError("PLAN_REVISION_NO_CHANGE", "plan-revision must change the semantic plan snapshot.");
    }

    const propagation = validateDecisionPropagationBatch(state, propagatedDecisionRefs, candidateState, {
        requireChanged: true,
        requirePending: true,
    });

    const nextState = clone(state);
    nextState.packages = packages;
    nextState.findings = findings;
    nextState.scope_questions = scopeQuestions;
    nextState.session_strategy = sessionStrategy;
    nextState.plan_version += 1;
    nextState.plan_status = "review-pending";
    nextState.simplification = {result: "pending"};

    if (propagation.records.length > 0) {
        markDecisionsPropagated(nextState, propagation.refs, nextFingerprint, now);
    }
    appendPlanHistory(nextState, {
        type: "plan-revision",
        from_version: state.plan_version,
        to_version: nextState.plan_version,
        reason: payload.reason,
        decision_refs: propagation.refs,
        affected_refs: propagation.affectedRefs,
        previous_fingerprint: previousFingerprint,
        next_fingerprint: nextFingerprint,
        changed_at: now,
    });

    const validation = validateTaskPlanState(nextState);
    if (!validation.valid) {
        throw new StateError("INVALID_PLAN_REVISION", validation.errors.join(" "), {errors: validation.errors});
    }
    return nextState;
}

export function applyPropagateDecisions(state, payload, now) {
    const nextState = prepareState(state);
    requireStateString(payload.reason, "propagation reason");
    const refs = readPropagatedDecisionRefs(payload, {required: true});
    const snapshot = requirePropagationSnapshot(payload.snapshot);
    const snapshotFingerprint = planSnapshotFingerprint(snapshot);
    const currentFingerprint = planSnapshotFingerprint(nextState);
    if (snapshotFingerprint !== currentFingerprint) {
        throw new StateError(
            "PLAN_STALE",
            `Propagation snapshot fingerprint ${snapshotFingerprint} does not match current plan ${currentFingerprint}.`,
            {expected: currentFingerprint, actual: snapshotFingerprint},
        );
    }

    const propagation = validateDecisionPropagationBatch(nextState, refs, snapshot, {
        requireChanged: false,
        semanticCandidate: true,
    });
    const selectedRecords = propagation.records;
    const alreadyPropagated = selectedRecords.every((record) => record.propagation_status === "propagated");
    if (alreadyPropagated) {
        const fingerprintMismatch = selectedRecords.some((record) => {
            return record.propagated_snapshot_fingerprint !== snapshotFingerprint;
        });
        if (fingerprintMismatch) {
            throw new StateError(
                "PLAN_STALE",
                "Already propagated decisions belong to a different plan snapshot.",
                {expected: snapshotFingerprint},
            );
        }
        return nextState;
    }
    if (selectedRecords.some((record) => record.propagation_status === "propagated")) {
        throw new StateError(
            "INVALID_PROPAGATION",
            "A propagation batch cannot mix already-propagated and pending decisions.",
        );
    }

    markDecisionsPropagated(nextState, refs, snapshotFingerprint, now);
    appendPlanHistory(nextState, {
        type: "decision-propagation",
        from_version: nextState.plan_version,
        to_version: nextState.plan_version,
        reason: payload.reason,
        decision_refs: propagation.refs,
        affected_refs: propagation.affectedRefs,
        previous_fingerprint: snapshotFingerprint,
        next_fingerprint: snapshotFingerprint,
        changed_at: now,
    });
    return nextState;
}

function readPropagatedDecisionRefs(payload, options = {}) {
    if (Object.hasOwn(payload, "propagated_decision_ref")) {
        throw new StateError(
            "LEGACY_PROPAGATION_PAYLOAD",
            "Use propagated_decision_refs[]; the singular propagated_decision_ref field is not supported.",
        );
    }
    if (!Object.hasOwn(payload, "propagated_decision_refs")) {
        if (options.required) {
            throw new StateError("INVALID_PROPAGATION", "propagated_decision_refs must be a non-empty array.");
        }
        return [];
    }
    if (!Array.isArray(payload.propagated_decision_refs)
        || (options.required && payload.propagated_decision_refs.length === 0)) {
        throw new StateError("INVALID_PROPAGATION", "propagated_decision_refs must be a non-empty array.");
    }
    const refs = [];
    const seen = new Set();
    for (const [index, value] of payload.propagated_decision_refs.entries()) {
        if (!isNonEmptyString(value)) {
            throw new StateError("INVALID_PROPAGATION", `propagated_decision_refs[${index}] must be a non-empty string.`);
        }
        if (seen.has(value)) {
            throw new StateError("DUPLICATE_PROPAGATION_REF", `propagated_decision_refs contains duplicate ref: ${value}.`);
        }
        seen.add(value);
        refs.push(value);
    }
    return refs;
}

function requirePropagationSnapshot(snapshot) {
    const errors = validatePropagationSnapshot(snapshot);
    if (errors.length > 0) {
        throw new StateError("INVALID_PROPAGATION_SNAPSHOT", errors.join(" "), {errors});
    }
    return clone(snapshot);
}

function validatePropagationSnapshot(snapshot) {
    if (!isRecord(snapshot)) {
        return ["propagation snapshot must be an object."];
    }
    const requiredFields = ["packages", "findings", "scope_questions", "session_strategy"];
    const missingFields = requiredFields
        .filter((field) => !Object.hasOwn(snapshot, field))
        .map((field) => `propagation snapshot is missing ${field}.`);
    if (missingFields.length > 0) {
        return missingFields;
    }
    const packages = Array.isArray(snapshot.packages)
        ? snapshot.packages.map((item) => isRecord(item)
            ? {...item, questions: normalizeSemanticQuestionsForValidation(item.questions)}
            : item)
        : null;
    const scopeQuestions = Array.isArray(snapshot.scope_questions)
        ? normalizeSemanticQuestionsForValidation(snapshot.scope_questions)
        : null;
    const packageErrors = packages
        ? validatePackageRecords(packages, {evidence_refs: snapshot.provenance?.evidence_refs}).errors
        : ["packages must be an array."];
    const scopeQuestionErrors = scopeQuestions
        ? validateQuestionRecords(scopeQuestions, {scope: "scope"})
        : ["scope_questions must be an array."];
    const strategyErrors = isRecord(snapshot.session_strategy)
        ? validateSessionStrategy(snapshot.session_strategy)
        : ["session_strategy must be an object."];
    const findingErrors = Array.isArray(snapshot.findings)
        ? (snapshot.findings.some((finding) => !isRecord(finding)) ? ["Every finding must be an object."] : [])
        : ["findings must be an array."];
    return [
        ...packageErrors,
        ...scopeQuestionErrors,
        ...strategyErrors,
        ...findingErrors,
    ];
}

function normalizeSemanticQuestionsForValidation(questions) {
    if (!Array.isArray(questions)) {
        return questions;
    }
    return questions.map((question) => {
        if (!isRecord(question) || typeof question.resolved === "boolean") {
            return question;
        }
        return {...question, resolved: false};
    });
}

function validateDecisionPropagationBatch(state, refs, candidate, options = {}) {
    const records = [];
    const errors = [];
    for (const decisionRef of refs) {
        const record = state.user_decisions.find((item) => item?.decision_ref === decisionRef);
        if (!record) {
            errors.push(`Decision ${decisionRef} was not found.`);
            continue;
        }
        records.push(record);
        if (record.propagation_status !== "pending" && record.propagation_status !== "propagated") {
            errors.push(`Decision ${decisionRef} has an invalid propagation status.`);
        }
        if (options.requirePending && record.propagation_status !== "pending") {
            errors.push(`Decision ${decisionRef} has already been propagated.`);
        }
        const question = findQuestion(state, record.question_id);
        if (!question || question.resolved !== true) {
            errors.push(`Decision ${decisionRef} requires a resolved question.`);
        } else {
            errors.push(...validateDecisionQuestionRecord(record, question).map((error) => {
                return `Decision ${decisionRef}: ${error}`;
            }));
        }
        const candidateQuestion = findQuestion(candidate, record.question_id);
        if (!candidateQuestion || (!options.semanticCandidate && candidateQuestion.resolved !== true)) {
            errors.push(`Decision ${decisionRef} is not covered by the candidate snapshot.`);
        } else if (!options.semanticCandidate) {
            errors.push(...validateDecisionQuestionRecord(record, candidateQuestion).map((error) => {
                return `Decision ${decisionRef}: ${error}`;
            }));
        }
        const affectedErrors = validateAffectedRefs(record.affected_refs, candidate.packages);
        errors.push(...affectedErrors.map((error) => `Decision ${decisionRef}: ${error}`));
        errors.push(...validateCoveredAffectedRefs(candidate, record.affected_refs).map((error) => {
            return `Decision ${decisionRef}: ${error}`;
        }));
    }

    const affectedRefs = uniqueStrings(records.flatMap((record) => record.affected_refs ?? []));
    let staleErrors = [];
    if (options.requireChanged && refs.length > 0) {
        errors.push(...validateChangedAffectedRefs(state, candidate, affectedRefs));
        staleErrors = validateSemanticChangesCovered(state, candidate, affectedRefs);
        errors.push(...staleErrors);
    }
    if (errors.length > 0) {
        throw new StateError(staleErrors.length > 0 ? "PLAN_STALE" : "INVALID_PROPAGATION", errors.join(" "), {errors});
    }
    return {refs: [...refs], records, affectedRefs};
}

function validateDecisionQuestionRecord(record, question) {
    if (Array.isArray(question.options) && question.options.length > 0) {
        if (!isNonEmptyString(record.selected_option)) {
            return ["resolved question requires selected_option."];
        }
        if (!question.options.some((option) => option?.id === record.selected_option)) {
            return ["selected_option is not declared by the resolved question."];
        }
        return record.selected_option === question.answer
            ? []
            : ["selected_option does not match the resolved question answer."];
    }
    if (!isNonEmptyString(record.answer)) {
        return ["resolved question requires answer."];
    }
    return record.answer === question.answer
        ? []
        : ["answer does not match the resolved question answer."];
}

function validateCoveredAffectedRefs(candidate, refs) {
    const errors = [];
    for (const ref of refs ?? []) {
        if (ref === "session_strategy") {
            if (!isRecord(candidate.session_strategy)) {
                errors.push("affected_ref session_strategy is not covered by the snapshot.");
            }
            continue;
        }
        const match = /^(WP[1-9][0-9]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/.exec(ref);
        const packageRecord = candidate.packages.find((item) => item?.id === match?.[1]);
        if (!packageRecord || (match[2] && !Object.hasOwn(packageRecord, match[2]))) {
            errors.push(`Unsupported or uncovered affected_ref: ${ref}.`);
        }
    }
    return errors;
}

function validateChangedAffectedRefs(previousState, nextState, refs) {
    return refs.flatMap((ref) => {
        if (ref === "session_strategy") {
            return stableStringify(previousState.session_strategy) === stableStringify(nextState.session_strategy)
                ? [`Affected session_strategy was not changed by plan-revision.`]
                : [];
        }
        const match = /^(WP[1-9][0-9]*)(?:\.([A-Za-z][A-Za-z0-9_]*))?$/.exec(ref);
        if (!match) {
            return [`Unsupported or uncovered affected_ref: ${ref}.`];
        }
        const previousPackage = previousState.packages.find((item) => item?.id === match?.[1]);
        const nextPackage = nextState.packages.find((item) => item?.id === match?.[1]);
        const previousValue = match[2] ? previousPackage?.[match[2]] : previousPackage;
        const nextValue = match[2] ? nextPackage?.[match[2]] : nextPackage;
        return stableStringify(previousValue) === stableStringify(nextValue)
            ? [`Affected ${ref} was not changed by plan-revision.`]
            : [];
    });
}

function validateSemanticChangesCovered(previousState, nextState, refs) {
    const previous = planSnapshot(previousState);
    const next = planSnapshot(nextState);
    const errors = [];
    if (stableStringify(previous.findings) !== stableStringify(next.findings)) {
        errors.push("findings changed outside propagated affected_refs.");
    }
    if (stableStringify(previous.scope_questions) !== stableStringify(next.scope_questions)) {
        errors.push("scope_questions changed outside propagated affected_refs.");
    }
    if (stableStringify(previous.session_strategy) !== stableStringify(next.session_strategy)
        && !refs.includes("session_strategy")) {
        errors.push("session_strategy changed outside propagated affected_refs.");
    }

    const packageIds = uniqueStrings([
        ...previous.packages.map((item) => item?.id),
        ...next.packages.map((item) => item?.id),
    ]);
    for (const packageId of packageIds) {
        const previousPackage = previous.packages.find((item) => item?.id === packageId);
        const nextPackage = next.packages.find((item) => item?.id === packageId);
        const fields = uniqueStrings([
            ...Object.keys(previousPackage ?? {}),
            ...Object.keys(nextPackage ?? {}),
        ]);
        for (const field of fields) {
            if (stableStringify(previousPackage?.[field]) === stableStringify(nextPackage?.[field])) {
                continue;
            }
            if (!refs.includes(packageId) && !refs.includes(`${packageId}.${field}`)) {
                errors.push(`${packageId}.${field} changed outside propagated affected_refs.`);
            }
        }
    }
    return errors;
}

function markDecisionsPropagated(state, refs, fingerprint, now) {
    const refSet = new Set(refs);
    state.user_decisions = state.user_decisions.map((record) => refSet.has(record.decision_ref)
        ? {
            ...record,
            propagation_status: "propagated",
            propagated_at: now,
            propagated_snapshot_fingerprint: fingerprint,
        }
        : record);
}

function appendPlanHistory(state, record) {
    if (!Array.isArray(state.plan_history)) {
        state.plan_history = [];
    }
    state.plan_history.push(clone(record));
}

function uniqueStrings(values) {
    return [...new Set(values.filter(isNonEmptyString))];
}

function appendReviewRecord(state, payload) {
    const record = clone(payload.review ?? payload);
    if (!isRecord(record) || !Number.isInteger(record.iteration) || record.iteration < 1) {
        throw new StateError("INVALID_REVIEW_RECORD", "review-record requires a positive integer iteration.");
    }
    if (state.review_history.some((item) => item.iteration === record.iteration)) {
        throw new StateError("DUPLICATE_REVIEW_ITERATION", `Review iteration ${record.iteration} is already recorded.`);
    }
    if (state.review_history.length >= REVIEW_LIMIT) {
        throw new StateError("REVIEW_LIMIT_REACHED", `At most ${REVIEW_LIMIT} review iterations are allowed for one plan identity; explicitly restart.`);
    }
    const nextState = clone(state);
    nextState.review_history.push(record);
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
    return nextState;
}

function applyContextRequirementsMutation(state, payload) {
    const nextState = clone(state);
    nextState.context_requirements = normalizeContextRequirements(payload.context_requirements ?? payload);
    return nextState;
}

function applyIntakeAssessmentMutation(state, payload) {
    const nextState = clone(state);
    nextState.intake_assessment = normalizeIntakeAssessment(
        payload.intake_assessment ?? payload.assessment ?? payload,
    );
    if (typeof payload.provenance !== "undefined" || typeof payload.evidence_refs !== "undefined") {
        const current = isRecord(nextState.provenance) ? nextState.provenance : {};
        nextState.provenance = normalizeProvenance({
            ...current,
            ...(typeof payload.provenance === "object" && payload.provenance !== null ? payload.provenance : {}),
            ...(typeof payload.evidence_refs !== "undefined" ? {evidence_refs: payload.evidence_refs} : {}),
        }, current);
    }
    return nextState;
}

function applyHybridAttemptMutation(state, payload, now) {
    const phase = requireStateString(payload.phase ?? state.workflow_phase, "hybrid_attempt.phase");
    const runId = requireStateString(payload.run_id, "hybrid_attempt.run_id");
    const attemptId = requireStateString(payload.attempt_id ?? payload.id ?? runId, "hybrid_attempt.attempt_id");
    const criteriaHash = requireStateString(payload.criteria_hash, "hybrid_attempt.criteria_hash");
    const strategyHash = requireStateString(payload.strategy_hash, "hybrid_attempt.strategy_hash");
    const attemptHash = requireStateString(payload.attempt_hash ?? payload.hash, "hybrid_attempt.hash");
    const status = requireStateString(payload.status ?? "started", "hybrid_attempt.status");
    if (!HYBRID_ATTEMPT_STATUSES.includes(status)) {
        throw new StateError("INVALID_HYBRID_ATTEMPT", `Unsupported hybrid attempt status: ${status}.`);
    }
    const nextState = clone(state);
    nextState.hybrid_attempt = {
        run_id: runId,
        attempt_id: attemptId,
        attempt_hash: attemptHash,
        criteria_hash: criteriaHash,
        strategy_hash: strategyHash,
        phase,
        status,
        started_at: payload.started_at ?? now,
    };
    nextState.hybrid_attempt_id = attemptId;
    nextState.hybrid_attempt_hash = attemptHash;
    if (["incomplete", "INCOMPLETE", "blocked", "BLOCKED"].includes(status)) {
        const currentAssessment = normalizeIntakeAssessment(nextState.intake_assessment);
        nextState.intake_assessment = {
            ...currentAssessment,
            technical_certainty: {
                ...currentAssessment.technical_certainty,
                level: "unknown",
                rationale: `Blocking context report ${status.toUpperCase()} did not establish complete technical evidence.`,
            },
        };
        nextState.plan_status = "needs-clarification";
        nextState.workflow_outcome = "blocked";
        nextState.checkpoint = {
            ...nextState.checkpoint,
            completed_at: now,
            next_allowed_action: "provide missing evidence or explicitly restart",
            reason: `Canonical blocking context report returned ${status.toUpperCase()}.`,
        };
    }
    return nextState;
}

function applySourceFetchComplete(state, payload) {
    assertSourceFetchApplicable(state);
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
    assertSourceFetchApplicable(state);
    const error = requireStateString(payload.error ?? payload.source_fetch_error, "source_fetch_error");
    const nextState = clone(state);
    nextState.source_fetch_status = "failed";
    nextState.fetched_at = null;
    nextState.source_updated_at = null;
    nextState.source_fetch_error = error;
    nextState.source_fetch_failed_at = payload.failed_at ?? now;
    return nextState;
}

function assertSourceFetchApplicable(state) {
    if (state.source_kind !== "github-issue") {
        throw new StateError(
            "SOURCE_FETCH_NOT_APPLICABLE",
            `Source fetch mutations require source_kind github-issue, got ${state.source_kind ?? "unknown"}.`,
        );
    }
}

function validateSourceKindStatus(kind, status) {
    if (kind === "github-issue" && status === "not-required") {
        return "github-issue sources must use source_fetch_status pending, complete or failed.";
    }
    if (SOURCE_KINDS.includes(kind) && kind !== "github-issue" && status !== "not-required") {
        return `${kind} sources must use source_fetch_status not-required.`;
    }
    return null;
}

function nextPhaseFor(phase) {
    return WORKFLOW_DEFAULT_NEXT_PHASE[phase] ?? null;
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
    const reasons = packageDecisionGateReasons(state);
    return {ready: reasons.length === 0, reasons};
}

export function hasCompletedReview(history, planVersion) {
    if (!Array.isArray(history) || !Number.isInteger(planVersion) || planVersion < 1) {
        return false;
    }
    return history.some((review) => review
        && review.complete === true
        && review.plan_version === planVersion);
}

export function hasCompletedCriticalReview(history, planVersion) {
    if (!Array.isArray(history) || !Number.isInteger(planVersion) || planVersion < 1) {
        return false;
    }

    return history.some((review) => {
        if (!review
            || review.stage !== "critical-review"
            || review.complete !== true
            || review.plan_version !== planVersion) {
            return false;
        }
        return Array.isArray(review.checks)
            && REQUIRED_REVIEW_CHECKS.every((check) => review.checks.includes(check));
    });
}

export function isSimplificationControlReviewComplete(state) {
    return SIMPLIFICATION_CONTROL_REVIEW_RESULTS.includes(readSimplificationResult(state));
}

export function selectDerivedState(state) {
    const candidate = state && typeof state === "object" ? state : {};
    const review = {
        review_complete: hasCompletedReview(candidate.review_history, candidate.plan_version),
        critical_review_complete: hasCompletedCriticalReview(candidate.review_history, candidate.plan_version),
    };
    const simplificationStatus = readSimplificationResult(candidate) ?? "pending";
    const gateReasons = packageDecisionGateReasons(candidate);
    return {
        ...review,
        package_decision_gate: gateReasons.length === 0 ? "open" : "closed",
        package_decision_gate_reasons: gateReasons,
        simplification_status: simplificationStatus,
        simplification_control_review_complete: isSimplificationControlReviewComplete(candidate),
    };
}

/**
 * Decide where a completed decision batch must continue.  A source/context
 * route still passes through review because the workflow phase graph does not
 * permit a direct decisions → source/context transition.
 */
export function normalizeScopeChangeType(value) {
    const candidate = isRecord(value)
        ? value.type ?? value.classification ?? value.kind ?? value.scope_change_type
        : value;
    if (!isNonEmptyString(candidate)) {
        return null;
    }
    const normalized = candidate.trim().toLowerCase();
    if ([
        "inventory/evidence-expansion",
        "inventory-expansion",
        "evidence-expansion",
        "scope-expansion",
        "global-expansion",
        "inventory",
        "evidence",
    ].includes(normalized)) {
        return "inventory/evidence-expansion";
    }
    if ([
        "known-scope-description",
        "known-scope",
        "description-change",
        "scope-description",
        "description",
    ].includes(normalized)) {
        return "known-scope-description";
    }
    return null;
}

export function routeScopeChange(value) {
    const type = normalizeScopeChangeType(value);
    if (type === "inventory/evidence-expansion") {
        return "source/context";
    }
    if (type === "known-scope-description") {
        return "review";
    }
    return null;
}

function declaredScopeChange(question, questionId, options) {
    const optionValue = options.scope_change_type
        ?? options.scopeChangeType
        ?? options.scope_change_classification
        ?? options.scopeChangeClassification
        ?? options.scope_change
        ?? options.scopeChange;
    if (typeof optionValue !== "undefined") {
        return {present: true, value: optionValue, source: `options:${questionId}`};
    }
    for (const field of [
        "scope_change_type",
        "scopeChangeType",
        "scope_change_classification",
        "scopeChangeClassification",
        "scope_change",
        "scopeChange",
    ]) {
        if (typeof question?.[field] !== "undefined") {
            return {present: true, value: question[field], source: `question:${questionId}`};
        }
    }
    return {present: false, value: null, source: null};
}

export function routeDecisionBatch(state, questionIds, options = {}) {
    const ids = normalizePreflightQuestionIds(state, questionIds).ids;
    const scopeChanges = ids.map((questionId) => {
        const question = findQuestion(state, questionId);
        const declaration = declaredScopeChange(question, questionId, options);
        return {
            ...declaration,
            type: declaration.present ? normalizeScopeChangeType(declaration.value) : null,
        };
    });
    const routes = ids.map((questionId) => {
        const question = findQuestion(state, questionId);
        return configuredDecisionRoute(question, questionId, options);
    });
    const reasons = [];
    if (ids.length === 0) {
        reasons.push("no_questions_to_route");
    }
    if (routes.some((route) => !["review", "source/context"].includes(route))) {
        reasons.push("invalid_decision_route");
    }
    if (scopeChanges.some((change) => change.present && change.type === null)) {
        reasons.push("invalid_scope_change_type");
    }
    if (new Set(routes.filter(Boolean)).size > 1) {
        reasons.push("mixed_decision_routes");
    }

    const route = reasons.length === 0 ? (routes[0] ?? "review") : null;
    const transitionPath = route === "source/context"
        ? ["review", "source/context"]
        : route === "review" ? ["review"] : [];
    return {
        route,
        target_phase: route,
        next_phase: transitionPath[0] ?? null,
        transition_path: transitionPath,
        scope_change_types: [...new Set(scopeChanges.map((change) => change.type).filter(Boolean))],
        scope_change_type: [...new Set(scopeChanges.map((change) => change.type).filter(Boolean))].length === 1
            ? scopeChanges.find((change) => change.type)?.type ?? null
            : null,
        reasons,
    };
}

/**
 * Pure gate before a question group is shown to the user.  It does not write
 * a decision or checkpoint.  The state-store wrapper adds the persisted
 * draft/fingerprint check which cannot be performed from state alone.
 */
export function preflightDecisionBatch(state, questionIds, options = {}) {
    const candidate = state && typeof state === "object" ? state : {};
    const reasons = [];
    const addReason = (reason) => {
        if (!reasons.includes(reason)) {
            reasons.push(reason);
        }
    };
    const runtime = validateRuntimeState(candidate);
    const requested = normalizePreflightQuestionIds(candidate, questionIds);
    const ids = requested.ids;
    const projectionStatus = options.projection_status ?? candidate.projection_status;
    const projectionFresh = projectionStatus !== "PROJECTION_STALE"
        && (options.projection_fresh === true
            || (options.projection_fresh !== false && projectionStatus === "PROJECTED"));
    const checkpointFresh = isDecisionCheckpointFresh(candidate);
    const pendingDecisionRefs = pendingDecisionReferences(candidate);
    const availableMutations = Array.isArray(options.available_mutations)
        ? options.available_mutations
        : MUTATION_TYPES;
    const batchPropagationAvailable = options.batch_propagation_available !== false
        && availableMutations.includes("propagate-decisions");
    const semanticRevisionAvailable = options.semantic_revision_available !== false
        && availableMutations.includes("plan-revision");
    const reviewHistoryLength = Array.isArray(candidate.review_history)
        ? candidate.review_history.length
        : 0;
    const reviewBudgetRemaining = Math.max(0, REVIEW_LIMIT - reviewHistoryLength);

    if (!runtime.valid) {
        addReason("invalid_runtime_state");
    }
    if (candidate.workflow_outcome !== "running") {
        addReason("workflow_not_running");
    }
    if (candidate.workflow_phase !== "decisions") {
        addReason("decision_phase_required");
    }
    if (!checkpointFresh) {
        addReason("stale_checkpoint");
    }
    if (!projectionFresh) {
        addReason(projectionStatus === "PROJECTION_STALE" ? "projection_stale" : "projection_not_current");
    }
    if (!batchPropagationAvailable) {
        addReason("batch_propagation_unavailable");
    }
    if (!semanticRevisionAvailable) {
        addReason("semantic_revision_unavailable");
    }
    if (requested.invalid) {
        addReason("invalid_question_ids");
    }
    if (ids.length === 0) {
        addReason("no_questions_to_emit");
    }
    if (pendingDecisionRefs.length > 0) {
        addReason("unpropagated_user_decisions");
    }
    if (reviewBudgetRemaining === 0 || candidate.plan_status === "review-limit-reached") {
        addReason("review_budget_exhausted");
    }

    const maxBatchSize = options.max_batch_size ?? options.maxBatchSize;
    if (typeof maxBatchSize !== "undefined"
        && (!Number.isInteger(maxBatchSize) || maxBatchSize < 1)) {
        addReason("invalid_decision_batch_budget");
    } else if (Number.isInteger(maxBatchSize) && ids.length > maxBatchSize) {
        addReason("decision_batch_budget_exceeded");
    }

    const questions = [];
    const affectedRefsByQuestion = {};
    for (const questionId of ids) {
        const question = findQuestion(candidate, questionId);
        if (!question) {
            addReason("unknown_question");
            continue;
        }
        if (question.resolved === true) {
            addReason("question_already_resolved");
            continue;
        }
        const affectedRefs = preflightAffectedRefs(question, questionId, options);
        const affectedErrors = [
            ...validateAffectedRefs(affectedRefs, candidate.packages),
            ...validateCoveredAffectedRefs(candidate, affectedRefs),
        ];
        if (affectedErrors.length > 0) {
            addReason("question_affected_refs_invalid");
        } else {
            affectedRefsByQuestion[questionId] = affectedRefs;
        }
        questions.push(question);
    }

    const routing = routeDecisionBatch(candidate, ids, {
        ...options,
        affected_refs_by_question: affectedRefsByQuestion,
    });
    for (const reason of routing.reasons) {
        addReason(reason);
    }

    let afterBatch = {ready: false, reasons: ["batch_simulation_unavailable"]};
    let approval = {approved: false, reasons: ["batch_simulation_unavailable"]};
    let semanticAfterReview = {ready: false, reasons: ["semantic_simulation_unavailable"]};
    let semanticApproval = {approved: false, reasons: ["semantic_simulation_unavailable"]};
    if (questions.length === ids.length && Object.keys(affectedRefsByQuestion).length === ids.length) {
        const simulated = simulateDecisionBatch(candidate, questions, affectedRefsByQuestion, options);
        afterBatch = canOpenPackageDecisions(simulated);
        approval = canApprovePlan(simulateApprovalPath(simulated));
        const reviewedSemanticPath = simulateSemanticReviewPath(simulated);
        semanticAfterReview = canOpenPackageDecisions(reviewedSemanticPath);
        semanticApproval = canApprovePlan(simulateApprovalPath(reviewedSemanticPath));
        if (!afterBatch.ready) {
            addReason("package_decision_gate_unavailable");
        }
        if (!approval.approved) {
            addReason("approval_gate_unavailable");
        }
        if (!semanticAfterReview.ready) {
            addReason("semantic_review_gate_unavailable");
        }
        if (!semanticApproval.approved) {
            addReason("semantic_approval_path_unavailable");
        }
    }

    return {
        ready: reasons.length === 0,
        ok: reasons.length === 0,
        code: reasons.length === 0 ? "READY" : "DECISION_PREFLIGHT_BLOCKED",
        reasons,
        runtime_errors: runtime.errors,
        question_ids: ids,
        pending_decision_count: pendingDecisionRefs.length,
        pending_decision_refs: pendingDecisionRefs,
        review_budget_remaining: reviewBudgetRemaining,
        batch_propagation_available: batchPropagationAvailable,
        semantic_revision_available: semanticRevisionAvailable,
        checkpoint_fresh: checkpointFresh,
        projection_fresh: projectionFresh,
        route: routing.route,
        target_phase: routing.target_phase,
        next_phase: routing.next_phase,
        transition_path: routing.transition_path,
        gates: {
            after_batch: afterBatch,
            approval: approval,
            semantic_after_review: semanticAfterReview,
            semantic_approval: semanticApproval,
        },
    };
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

    if (!Array.isArray(candidate.packages) || candidate.packages.length === 0) {
        addReason("no_work_packages");
    }
    if (!hasCompletedReview(candidate.review_history, candidate.plan_version)) {
        addReason("review_incomplete");
    }
    if (!hasCompletedCriticalReview(candidate.review_history, candidate.plan_version)) {
        addReason("critical_review_incomplete");
    }
    for (const reason of reviewHistoryReasons(candidate)) {
        addReason(reason);
    }
    if (!hasCompletedCriticalReview(candidate.review_history, candidate.plan_version)) {
        addReason("critical_review_missing");
    }
    const simplificationResult = readSimplificationResult(candidate);
    if (!["no-change", "simplified"].includes(simplificationResult)) {
        addReason("simplification_not_resolved");
    }
    if (!isSimplificationControlReviewComplete(candidate)) {
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

function isUnresolvedScopeQuestion(question) {
    if (typeof question === "string") {
        return question.trim() !== "";
    }
    return Boolean(question)
        && typeof question === "object"
        && !Array.isArray(question)
        && question.resolved !== true;
}

function normalizePreflightQuestionIds(state, questionIds) {
    const source = typeof questionIds === "undefined"
        ? allQuestions(state).filter((question) => question.resolved !== true).map((question) => question.id)
        : typeof questionIds === "string" ? [questionIds] : questionIds;
    if (!Array.isArray(source)) {
        return {ids: [], invalid: true};
    }

    const ids = [];
    let invalid = false;
    const seen = new Set();
    for (const questionId of source) {
        if (!isNonEmptyString(questionId) || seen.has(questionId)) {
            invalid = true;
            continue;
        }
        seen.add(questionId);
        ids.push(questionId);
    }
    return {ids, invalid};
}

function allQuestions(state) {
    const questions = [];
    appendQuestionRecords(questions, state?.scope_questions);
    for (const packageRecord of state?.packages ?? []) {
        appendQuestionRecords(questions, packageRecord?.questions);
    }
    return questions;
}

function isDecisionCheckpointFresh(state) {
    return isRecord(state?.checkpoint)
        && state.checkpoint.phase === state.workflow_phase
        && state.checkpoint.state_revision === state.revision;
}

function pendingDecisionReferences(state) {
    if (!Array.isArray(state?.user_decisions)) {
        return [];
    }
    return state.user_decisions
        .filter((record) => record && record.propagation_status !== "propagated")
        .map((record) => record.decision_ref)
        .filter(isNonEmptyString);
}

function preflightAffectedRefs(question, questionId, options) {
    const byQuestion = options.affected_refs_by_question
        ?? options.affectedRefsByQuestion
        ?? options.question_affected_refs
        ?? {};
    if (isRecord(byQuestion) && Object.hasOwn(byQuestion, questionId)) {
        return byQuestion[questionId];
    }
    if (Array.isArray(options.affected_refs)) {
        return options.affected_refs;
    }
    return question.affected_refs;
}

function configuredDecisionRoute(question, questionId, options) {
    const scopeChange = declaredScopeChange(question, questionId, options);
    if (scopeChange.present) {
        return routeScopeChange(scopeChange.value);
    }
    const routes = options.routes ?? options.route_by_question ?? options.routeByQuestion;
    if (isRecord(routes) && Object.hasOwn(routes, questionId)) {
        return routes[questionId];
    }
    if (typeof options.route === "string") {
        return options.route;
    }
    if (typeof question?.route === "string") {
        return question.route;
    }
    if (question?.requires_context_refresh === true || question?.next_phase === "source/context") {
        return "source/context";
    }
    return "review";
}

function simulateDecisionBatch(state, questions, affectedRefsByQuestion, options) {
    const simulated = clone(state);
    const fingerprint = planSnapshotFingerprint(state);
    simulated.user_decisions = Array.isArray(simulated.user_decisions)
        ? clone(simulated.user_decisions)
        : [];
    const existingRefs = new Set(simulated.user_decisions.map((record) => record?.decision_ref));

    questions.forEach((question, index) => {
        const simulatedQuestion = findQuestion(simulated, question.id);
        const answer = preflightAnswer(question, question.id, options);
        const record = {
            decision_ref: uniquePreflightDecisionRef(existingRefs, question.id, index),
            question_id: question.id,
            ...answer.recordValue,
            decision_source: "preflight",
            decided_at: PREFLIGHT_DECISION_TIMESTAMP,
            affected_refs: affectedRefsByQuestion[question.id],
            propagation_status: "propagated",
            propagated_at: PREFLIGHT_DECISION_TIMESTAMP,
            propagated_snapshot_fingerprint: fingerprint,
        };
        simulatedQuestion.resolved = true;
        simulatedQuestion.answer = answer.answer;
        simulatedQuestion.decision_source = "preflight";
        simulatedQuestion.decided_at = PREFLIGHT_DECISION_TIMESTAMP;
        simulated.user_decisions.push(record);
    });

    return simulated;
}

function preflightAnswer(question, questionId, options) {
    const answers = options.answers ?? options.simulated_answers ?? options.simulatedAnswers ?? {};
    const configured = isRecord(answers) ? answers[questionId] ?? null : null;
    if (Array.isArray(question.options) && question.options.length > 0) {
        const selectedOption = isRecord(configured) ? configured.selected_option : configured;
        const option = question.options.find((candidate) => candidate?.id === selectedOption)
            ?? question.options[0];
        return {
            answer: option.id,
            recordValue: {selected_option: option.id},
        };
    }
    const answer = isRecord(configured) ? configured.answer : configured;
    const normalized = isNonEmptyString(answer)
        ? answer
        : isNonEmptyString(question.answer) ? question.answer : "__preflight__";
    return {answer: normalized, recordValue: {answer: normalized}};
}

function uniquePreflightDecisionRef(existingRefs, questionId, index) {
    const base = `__preflight__${questionId}__${index + 1}`;
    let candidate = base;
    let suffix = 1;
    while (existingRefs.has(candidate)) {
        candidate = `${base}__${suffix}`;
        suffix += 1;
    }
    existingRefs.add(candidate);
    return candidate;
}

function simulateApprovalPath(state) {
    const candidate = clone(state);
    candidate.plan_status = "awaiting-package-decisions";
    candidate.packages = (candidate.packages ?? []).map((item) => {
        if (TERMINAL_PACKAGE_STATUSES.includes(item?.decision_status)) {
            return item;
        }
        return {...item, decision_status: "accepted"};
    });
    candidate.decisions = Array.isArray(candidate.decisions) ? clone(candidate.decisions) : [];
    for (const packageRecord of candidate.packages) {
        if (!candidate.decisions.some((decision) => {
            return decision?.package_id === packageRecord.id
                && decision.decision === packageRecord.decision_status;
        })) {
            candidate.decisions.push({
                package_id: packageRecord.id,
                decision: packageRecord.decision_status,
                decision_source: "preflight",
            });
        }
    }
    return candidate;
}

function simulateSemanticReviewPath(state) {
    const candidate = clone(state);
    candidate.plan_version += 1;
    candidate.plan_status = "review-pending";
    candidate.simplification = {result: "no-change"};
    const history = Array.isArray(candidate.review_history) ? clone(candidate.review_history) : [];
    const iterations = history
        .map((review) => review?.iteration)
        .filter((iteration) => Number.isInteger(iteration));
    history.push({
        iteration: Math.max(0, ...iterations) + 1,
        plan_version: candidate.plan_version,
        stage: "critical-review",
        complete: true,
        checks: [...REQUIRED_REVIEW_CHECKS],
    });
    candidate.review_history = history;
    return candidate;
}

export function readSimplificationResult(state) {
    const simplification = state && typeof state === "object" ? state.simplification : null;
    if (!simplification || typeof simplification !== "object" || Array.isArray(simplification)) {
        return null;
    }
    return typeof simplification.result === "string" ? simplification.result : null;
}

export function validatePackageRecords(packages, options = {}) {
    const errors = [];
    const records = Array.isArray(packages) ? packages : [];

    for (const [index, item] of records.entries()) {
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

        const packageLabel = item.id ?? `Package ${index + 1}`;
        for (const field of ["confirmed_files", "candidate_paths"]) {
            if (Object.hasOwn(item, field)) {
                errors.push(...validateStringList(item[field], `${packageLabel}.${field}`));
            }
        }
        if (Object.hasOwn(item, "discovery_required")) {
            errors.push(...validateDiscoveryRequirementRecords(item.discovery_required, `${packageLabel}.discovery_required`));
        }
        if (Object.hasOwn(item, "evidence_refs")) {
            errors.push(...validateEvidenceRefList(item.evidence_refs, `${packageLabel}.evidence_refs`));
        }
        if (Object.hasOwn(item, "provenance")) {
            errors.push(...validateProvenance(item.provenance).map((error) => `${packageLabel}: ${error}`));
        }

        const confirmedFiles = Array.isArray(item.confirmed_files) ? item.confirmed_files : [];
        const candidatePaths = Array.isArray(item.candidate_paths) ? item.candidate_paths : [];
        const overlap = confirmedFiles.filter((file) => candidatePaths.includes(file));
        if (overlap.length > 0) {
            errors.push(`${packageLabel} cannot classify a path as both confirmed_files and candidate_paths: ${overlap.join(", ")}.`);
        }
        const evidenceRefs = Array.isArray(item.evidence_refs) && item.evidence_refs.length > 0
            ? item.evidence_refs
            : Array.isArray(item.provenance?.evidence_refs) && item.provenance.evidence_refs.length > 0
                ? item.provenance.evidence_refs
                : options.evidence_refs;
        if (confirmedFiles.length > 0 && (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0)) {
            errors.push(`${packageLabel}.confirmed_files requires direct evidence_refs.`);
        }
    }

    const graphResult = validateDependencyGraph(records);
    errors.push(...graphResult.errors);
    return {valid: errors.length === 0, errors};
}

function validateStringList(value, name) {
    if (!Array.isArray(value)) {
        return [`${name} must be an array.`];
    }
    const errors = [];
    const values = new Set();
    for (const [index, item] of value.entries()) {
        if (!isNonEmptyString(item)) {
            errors.push(`${name}[${index}] must be a non-empty string.`);
            continue;
        }
        if (values.has(item)) {
            errors.push(`${name} contains duplicate value: ${item}.`);
        }
        values.add(item);
    }
    return errors;
}

function validateEvidenceRefList(value, name) {
    return validateStringList(value, name);
}

function validateDiscoveryRequirementRecords(value, name) {
    if (!Array.isArray(value)) {
        return [`${name} must be an array.`];
    }
    const errors = [];
    const ids = new Set();
    for (const [index, item] of value.entries()) {
        if (!isRecord(item)
            || !isNonEmptyString(item.id)
            || !isNonEmptyString(item.reason)
            || !isNonEmptyString(item.owner)
            || !isNonEmptyString(item.target_phase)) {
            errors.push(`${name}[${index}] must contain id, reason, owner and target_phase.`);
            continue;
        }
        if (ids.has(item.id)) {
            errors.push(`${name} contains duplicate id: ${item.id}.`);
        }
        ids.add(item.id);
        if (Object.hasOwn(item, "path") && !isNonEmptyString(item.path)) {
            errors.push(`${name}[${index}].path must be a non-empty string.`);
        }
        if (Object.hasOwn(item, "evidence_refs")) {
            errors.push(...validateEvidenceRefList(item.evidence_refs, `${name}[${index}].evidence_refs`));
        }
    }
    return errors;
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
        if (typeof record.propagated_at !== "undefined"
            && (typeof record.propagated_at !== "string" || Number.isNaN(Date.parse(record.propagated_at)))) {
            errors.push(`${label} propagated_at must be a valid timestamp.`);
        }
        if (typeof record.propagated_snapshot_fingerprint !== "undefined"
            && (!isNonEmptyString(record.propagated_snapshot_fingerprint)
                || !/^[a-f0-9]{64}$/.test(record.propagated_snapshot_fingerprint))) {
            errors.push(`${label} propagated_snapshot_fingerprint must be a SHA-256 fingerprint.`);
        }
        if (record.propagation_status === "propagated"
            && (!isNonEmptyString(record.propagated_at)
                || !isNonEmptyString(record.propagated_snapshot_fingerprint))) {
            errors.push(`${label} propagated status requires propagated_at and propagated_snapshot_fingerprint.`);
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
    if (!["no-change", "simplified"].includes(nestedResult)) {
        reasons.push("simplification_not_resolved");
    }
    if (nestedResult === "simplified"
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
    if (candidate.review_history.length > REVIEW_LIMIT) {
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
    const packageResult = validatePackageRecords(state.packages, {
        evidence_refs: state.provenance?.evidence_refs,
    });
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

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
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
