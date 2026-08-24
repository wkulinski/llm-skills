#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {
    DRAFT_SECTIONS,
    parseDraftDocument,
    renderSessionStrategyProjection,
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
    REVIEW_LIMIT,
    REDUNDANT_DESIGN_ELEMENT,
    SIMPLIFICATION_RESULTS,
    STATE_LIFECYCLES,
    TERMINAL_PACKAGE_STATUSES,
    WORKFLOW_PHASES,
    WORKFLOW_OUTCOMES,
    isCanonicalState,
    validateQuestionRecords,
    validateOwnershipRedundancyReview,
    validateApprovalState,
    validateStateSourceMetadata,
    validateStateLifecycle,
    validateRuntimeState,
    validateIntakeAssessment,
    validateProvenance,
} from "./state.mjs";

export {STATE_LIFECYCLES, validateStateLifecycle};

export const FINDING_SEVERITIES = Object.freeze(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
export const FINDING_STATUSES = Object.freeze(["open", "resolved", "accepted", "reopened"]);
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
    if (Object.hasOwn(simplification.before, "evidence")
        || Object.hasOwn(simplification.after, "evidence")) {
        snapshotFields.push("evidence");
    }
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
    if (snapshotFields.includes("evidence")
        && !containsAll(simplification.after.evidence, simplification.before.evidence)) {
        errors.push("Simplification removed evidence.");
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

export function validatePlanState(input, options = {}) {
    const mode = options.mode ?? "runtime";
    if (!["runtime", "approval"].includes(mode)) {
        return {
            valid: false,
            errors: [`Invalid validation mode: ${mode}. Use runtime or approval.`],
            approval: {approved: false, reasons: ["invalid_validation_mode"]},
            mode,
        };
    }
    const lifecycle = validateStateLifecycle(input);
    const state = lifecycle.state;
    const errors = [...lifecycle.errors];

    if (errors.length === 0 && lifecycle.lifecycle !== "absent") {
        const canonical = isCanonicalState(state);
        const stateErrors = canonical
            ? mode === "runtime"
                ? [...validateRuntimeState(state).errors]
                : [
                    ...validateApprovalState(state).errors,
                ]
            : [
                ...validateStateMetadata(state),
                ...validateStateSourceMetadata(state),
                ...validateStatePackages(state),
                ...validateStateRecords(state),
            ];
        errors.push(...stateErrors);
        if (!canonical
            && Object.hasOwn(state, "workflow_outcome")
            && !WORKFLOW_OUTCOMES.includes(state.workflow_outcome)) {
            errors.push(`Invalid workflow_outcome: ${state.workflow_outcome ?? ""}.`);
        }
        if (canonical) {
            errors.push(...validateCanonicalProjection(state));
            errors.push(...validateCanonicalHybridAttempt(state));
        }
    }

    const approval = buildApprovalResult(state);
    if (mode !== "runtime" && !isCanonicalState(state)) {
        errors.push(...validateStateApproval(state, approval));
    }

    return {
        valid: errors.length === 0,
        errors,
        approval,
        mode,
    };
}

function validateCanonicalProjection(state) {
    if (state.projection_status === "PROJECTION_STALE") {
        return ["State projection is stale and cannot be treated as a valid plan."];
    }
    return [];
}

function validateCanonicalHybridAttempt(state) {
    const errors = [];
    for (const field of ["hybrid_attempt_id", "hybrid_attempt_hash", "hybrid_attempt"]) {
        if (!Object.hasOwn(state, field)) {
            errors.push(`State is missing ${field}.`);
        }
    }

    const attempt = state.hybrid_attempt;
    if (attempt === null || typeof attempt === "undefined") {
        if (state.hybrid_attempt_id !== null || state.hybrid_attempt_hash !== null) {
            errors.push("Empty hybrid_attempt must have null reference fields.");
        }
        return errors;
    }
    if (!isRecord(attempt)) {
        return [...errors, "hybrid_attempt must be an object or null."];
    }

    for (const field of [
        "run_id",
        "attempt_id",
        "attempt_hash",
        "criteria_hash",
        "strategy_hash",
        "phase",
        "status",
    ]) {
        if (!isMeaningfulString(attempt[field])) {
            errors.push(`hybrid_attempt is missing ${field}.`);
        }
    }
    if (isMeaningfulString(attempt.phase) && !WORKFLOW_PHASES.includes(attempt.phase)) {
        errors.push(`hybrid_attempt has invalid phase: ${attempt.phase}.`);
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
    return errors;
}

function buildApprovalResult(state) {
    const approval = canApprovePlan(state);
    if (!isRecord(state)) {
        return approval;
    }

    const reasons = [...approval.reasons];
    const addReason = (reason) => {
        if (!reasons.includes(reason)) {
            reasons.push(reason);
        }
    };
    if (isCanonicalState(state) && state.workflow_outcome === "blocked") {
        addReason("workflow_blocked");
    }
    return {approved: reasons.length === 0, reasons};
}

function validateStateMetadata(state) {
    const errors = [];
    if (!Number.isInteger(state.plan_version) || state.plan_version < 1) {
        errors.push("Plan state must contain a positive integer plan_version.");
    }
    if (!PLAN_STATUSES.includes(state.plan_status)) {
        errors.push(`Invalid plan_status: ${state.plan_status ?? ""}.`);
    }
    if (Object.hasOwn(state, "blockers") && !Array.isArray(state.blockers)) {
        errors.push("Plan state blockers must be an array.");
    }
    if (Object.hasOwn(state, "scope_questions") && !Array.isArray(state.scope_questions)) {
        errors.push("Plan state scope_questions must be an array.");
    } else if (Array.isArray(state.scope_questions)) {
        errors.push(...validateQuestionRecords(state.scope_questions, {scope: "scope"}).map((error) => {
            return `scope_questions: ${error}`;
        }));
    }
    if (Object.hasOwn(state, "intake_assessment")) {
        errors.push(...validateIntakeAssessment(state.intake_assessment));
    }
    if (Object.hasOwn(state, "provenance")) {
        errors.push(...validateProvenance(state.provenance));
    }
    return errors;
}

function validateStatePackages(state, options = {}) {
    const errors = [];
    if (!Array.isArray(state.packages)) {
        errors.push("Plan state must contain a packages array.");
    } else if (["awaiting-package-decisions", "approved"].includes(state.plan_status) && state.packages.length === 0) {
        errors.push("Plan state must contain at least one work package before package decisions or approval.");
    }
    if (!options.canonical) {
        errors.push(...validatePackageRecords(state.packages, {
            evidence_refs: state.provenance?.evidence_refs,
        }).errors);
    }
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

function validateStateRecords(state, options = {}) {
    const errors = [];
    const decisions = state.decisions ?? [];
    if (!options.canonical) {
        errors.push(...validateDecisionHistory(decisions));
    }
    if (Array.isArray(state.packages) && Array.isArray(decisions)) {
        for (const item of state.packages) {
            if (item && TERMINAL_PACKAGE_STATUSES.includes(item.decision_status)
                && !decisions.some((decision) => decision.package_id === item.id && decision.decision === item.decision_status)) {
                errors.push(`Package ${item.id} is missing its decision history.`);
            }
        }
    }
    errors.push(...validateFindings(state.findings ?? []));
    if (!options.canonical) {
        errors.push(...validateOwnershipRedundancyReview(state.ownership_redundancy_review, state.findings));
    }
    errors.push(...validateReviewHistory(state.review_history ?? []));
    errors.push(...validateSimplification(state.simplification, {
        requireOwnershipReview: true,
    }));
    if (!options.canonical) {
        errors.push(...validateSessionStrategy(state.session_strategy).map((error) => {
            return `session_strategy: ${error}`;
        }));
        errors.push(...validateUserDecisionRecords(state.user_decisions ?? [], {packages: state.packages}).map((error) => {
            return `user_decisions: ${error}`;
        }));
    }
    errors.push(...validateQuestionDecisionPropagation(state));
    return errors;
}

function validateStateApproval(state, approval) {
    const errors = [];
    if (!isRecord(state)) {
        return errors;
    }
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
    const lifecycleState = options.state
        ? validateStateLifecycle(options.state).state
        : null;
    const draftOptions = {
        kind: options.kind ?? "main",
        ...(lifecycleState ? {state: lifecycleState} : {}),
        requireProjectionFingerprint: options.requireProjectionFingerprint
            ?? (((options.kind ?? "main") !== "derived")
                && lifecycleState?.projection_status === "PROJECTED"),
    };
    const draftResult = typeof document === "string"
        ? validateDraftDocument(document, draftOptions)
        : validateDraftObject(document, draftOptions);
    const errors = [...draftResult.errors];
    let draftBody = typeof document?.body === "string" ? document.body : "";
    if (typeof document === "string") {
        try {
            draftBody = parseDraftDocument(document).body;
        } catch {
            draftBody = "";
        }
    }

    if (options.state) {
        errors.push(...validatePlanState(options.state, {
            mode: options.validation_mode ?? options.validationMode ?? "runtime",
        }).errors);
        errors.push(...validateDraftStateConsistency(
            draftResult.metadata,
            lifecycleState,
            draftBody,
        ));
    }

    return {
        valid: errors.length === 0,
        errors,
        metadata: draftResult.metadata,
        missingSections: draftResult.missingSections,
    };
}

function validateDraftStateConsistency(metadata, state, body = "") {
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
    if (typeof state.source_ref === "string"
        && typeof metadata?.source_ref === "string"
        && state.source_ref !== metadata.source_ref) {
        errors.push("Draft/state source_ref mismatch.");
    }
    if (typeof state.input_profile === "string"
        && typeof metadata?.input_profile === "string"
        && state.input_profile !== metadata.input_profile) {
        errors.push("Draft/state input_profile mismatch.");
    }
    if (typeof state.issue !== "undefined" && typeof metadata?.issue !== "undefined"
        && String(state.issue) !== String(metadata.issue)) {
        errors.push("Draft/state issue mismatch.");
    }
    if (isCanonicalState(state)) {
        if (metadata?.source_identity !== serializeIdentity(state.source_identity)) {
            errors.push("Draft/state source_identity mismatch.");
        }
        for (const field of ["workflow_phase", "workflow_outcome"]) {
            if (metadata?.[field] !== state[field]) {
                errors.push(`Draft/state ${field} mismatch.`);
            }
        }
    }
    if (Number.isInteger(state.revision)) {
        if (!isNonNegativeInteger(metadata?.state_revision)) {
            errors.push("Draft/state state_revision is missing or invalid.");
        } else if (Number(metadata.state_revision) !== state.revision) {
            errors.push(`Draft/state state_revision mismatch: draft=${metadata.state_revision}, state=${state.revision}.`);
        }
    }
    if (Object.hasOwn(state, "source_fetch_status")) {
        if (metadata?.source_fetch_status !== state.source_fetch_status) {
            errors.push(`Draft/state source_fetch_status mismatch: draft=${metadata?.source_fetch_status ?? ""}, state=${state.source_fetch_status}.`);
        }
        for (const field of ["fetched_at", "source_updated_at", "source_fetch_error", "source_fetch_failed_at"]) {
            const stateValue = state[field];
            if (stateValue !== null && typeof stateValue !== "undefined"
                && metadata?.[field] !== stateValue) {
                errors.push(`Draft/state ${field} mismatch.`);
            }
        }
    }
    if (state.session_strategy && typeof body === "string"
        && !body.includes(renderSessionStrategyProjection(state.session_strategy).trimEnd())) {
        errors.push("Draft/state session_strategy mismatch.");
    }
    return errors;
}

export function validateFinalApproval(state) {
    const result = validatePlanState(state, {mode: "approval"});
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
        return validateDraftDocument(draft, {
            kind: options.kind ?? "main",
            state: options.state,
            requireProjectionFingerprint: options.requireProjectionFingerprint,
        });
    }
    return validateDraftDocument(document, {
        kind: options.kind ?? "main",
        state: options.state,
        requireProjectionFingerprint: options.requireProjectionFingerprint,
    });
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

function serializeIdentity(value) {
    if (typeof value === "string") {
        return value;
    }
    return stableStringify(value);
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

function isNonNegativeInteger(value) {
    return (typeof value === "number" && Number.isInteger(value) && value >= 0)
        || (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value));
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
        return validatePlanDocument(source, {
            kind: parsed.values.kind ?? "main",
            state,
            validation_mode: parsed.values.mode ?? "runtime",
        });
    }
    if (parsed.command === "validate-state") {
        const state = JSON.parse(fs.readFileSync(path.resolve(parsed.values.file), "utf8"));
        return validatePlanState(state, {mode: parsed.values.mode ?? "runtime"});
    }
    throw new Error("Use validate or validate-state.");
}

function main(args) {
    if (args[0] === "--help") {
        process.stdout.write("Usage: validate-plan.mjs validate --file <draft> [--state <json>] [--mode <runtime|approval>] | validate-state --file <json> [--mode <runtime|approval>]\n");
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
