#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const REVIEW_ACTIONS = Object.freeze({
    FINISH_READY: "finish-ready",
    APPLY_REPAIR: "apply-repair",
    BLOCK: "blocked",
});

export const REVIEW_VERDICTS = Object.freeze([
    "PLAN READY",
    "PLAN READY WITH CAVEAT",
    "PLAN DISCUSS",
    "PLAN CHANGES REQUESTED",
    "PLAN BLOCKED",
]);

const VERDICTS = new Set(REVIEW_VERDICTS);
const CLASSIFICATIONS = new Set(["finding", "QUESTION", "SUGGESTION"]);
const SEVERITIES = new Set(["BLOCKER", "MAJOR", "MINOR"]);
const RESOLUTION_STATUSES = new Set(["resolved", "current", "accepted"]);
const PROVENANCE_KINDS = new Set(["changed_section", "changed_work_package", "direct_dependency"]);
const FINDING_ID_PATTERN = /^F[1-9][0-9]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SEVERITY_RANK = Object.freeze({BLOCKER: 3, MAJOR: 2, MINOR: 1});
const MAX_FULL_REVIEWS = 1;
const MAX_DELTA_REVIEWS = 3;

/** @typedef {{code: string, message: string, finding_id?: string}} ValidationIssue */
/** @typedef {Record<string, any>} JsonObject */

/**
 * Derive one owner action from explicit review assessments and counters.
 * Semantic claims such as recurrence and provenance are trusted inputs; this
 * helper validates their completeness and consistency, not their truth.
 *
 * @param {JsonObject} [input]
 * @returns {{ok: boolean, action: string, reason: string, actionable_finding_ids: string[], errors: ValidationIssue[]}}
 */
export function decideReviewCycle(input = {}) {
    const errors = validateReviewCycleInput(input);
    const source = isRecord(input) ? input : {};
    const findings = Array.isArray(source.findings) ? source.findings : [];
    const actionable = findings.filter(isActionableFinding);

    if (errors.length > 0) {
        return decision(REVIEW_ACTIONS.BLOCK, "invalid-review-input", actionable, errors);
    }

    if (findings.some(isApprovalAffectingQuestion)) {
        return decision(REVIEW_ACTIONS.BLOCK, "approval-decision-required", actionable);
    }

    if (source.verdict === "PLAN DISCUSS") {
        return decision(REVIEW_ACTIONS.BLOCK, "review-requires-discussion", actionable);
    }
    if (source.verdict === "PLAN BLOCKED") {
        return decision(REVIEW_ACTIONS.BLOCK, "review-blocked", actionable);
    }

    if (source.verdict === "PLAN READY") {
        return actionable.length === 0
            ? decision(REVIEW_ACTIONS.FINISH_READY, "plan-ready", actionable)
            : decision(REVIEW_ACTIONS.BLOCK, "ready-verdict-has-actionable-findings", actionable);
    }

    if (source.verdict === "PLAN READY WITH CAVEAT") {
        return actionable.length === 0
            ? decision(REVIEW_ACTIONS.FINISH_READY, "nonactionable-or-accepted-caveat", actionable)
            : decision(REVIEW_ACTIONS.BLOCK, "caveat-has-actionable-findings", actionable);
    }

    if (actionable.length === 0) {
        return decision(REVIEW_ACTIONS.BLOCK, "changes-requested-without-actionable-findings", actionable);
    }
    if (actionable.some((finding) => finding.requires_user_decision === true)) {
        return decision(REVIEW_ACTIONS.BLOCK, "repair-requires-user-decision", actionable);
    }
    if (actionable.some((finding) => finding.requires_external_evidence === true)) {
        return decision(REVIEW_ACTIONS.BLOCK, "repair-requires-external-evidence", actionable);
    }
    if (source.delta_review_count >= MAX_DELTA_REVIEWS) {
        return decision(REVIEW_ACTIONS.BLOCK, "delta-review-budget-exhausted", actionable);
    }
    if (actionable.some((finding) => finding.repair_attempts >= 2)) {
        return decision(REVIEW_ACTIONS.BLOCK, "finding-survived-two-repair-attempts", actionable);
    }

    if (source.delta_review_count > 0) {
        const resolutions = source.previous_resolutions;
        const previousById = new Map(source.previous_findings.map((finding) => [finding.id, finding]));
        if (resolutions.some((resolution) => isWorsenedResolution(resolution, previousById.get(resolution.id)))) {
            return decision(REVIEW_ACTIONS.BLOCK, "previous-finding-worsened", actionable);
        }
        if (actionable.some(isUnsupportedRecurrence)) {
            return decision(REVIEW_ACTIONS.BLOCK, "recurrence-without-new-evidence", actionable);
        }
        if (!resolutions.some((resolution) => isProgressResolution(resolution, previousById.get(resolution.id)))) {
            return decision(REVIEW_ACTIONS.BLOCK, "no-measurable-progress", actionable);
        }
    }

    return decision(REVIEW_ACTIONS.APPLY_REPAIR, "repair-all-actionable-findings", actionable);
}

/**
 * @param {JsonObject} [input]
 * @returns {ValidationIssue[]}
 */
export function validateReviewCycleInput(input = {}) {
    /** @type {ValidationIssue[]} */
    const errors = [];
    if (!isRecord(input)) {
        return [error("INVALID_INPUT", "Review-cycle input must be an object.")];
    }

    if (!VERDICTS.has(input.verdict)) {
        errors.push(error("INVALID_VERDICT", "verdict must be a supported plan review verdict."));
    }
    validateCounter(input.full_review_count, "full_review_count", errors);
    validateCounter(input.delta_review_count, "delta_review_count", errors);
    if (Number.isInteger(input.full_review_count) && input.full_review_count !== MAX_FULL_REVIEWS) {
        errors.push(error("INVALID_FULL_REVIEW_COUNT", "Exactly one full review must precede a cycle decision."));
    }
    if (Number.isInteger(input.delta_review_count) && input.delta_review_count > MAX_DELTA_REVIEWS) {
        errors.push(error("INVALID_DELTA_REVIEW_COUNT", "delta_review_count must not exceed three."));
    }

    const findings = validateArray(input.findings, "findings", errors);
    const previous = validateArray(input.previous_findings, "previous_findings", errors);
    const resolutions = validateArray(input.previous_resolutions, "previous_resolutions", errors);
    validateUniqueRecords(findings, "finding", validateFinding, errors);
    validateUniqueRecords(previous, "previous finding", validatePreviousFinding, errors);
    validateUniqueRecords(resolutions, "previous resolution", validateResolution, errors);

    const previousById = new Map(previous.filter(isRecord).map((finding) => [finding.id, finding]));
    const resolutionsById = new Map(resolutions.filter(isRecord).map((resolution) => [resolution.id, resolution]));

    for (const previousFinding of previous) {
        if (isRecord(previousFinding) && !resolutionsById.has(previousFinding.id)) {
            errors.push(error("MISSING_PREVIOUS_RESOLUTION", `Previous finding ${previousFinding.id} requires an explicit resolution.`, previousFinding.id));
        }
    }
    for (const resolution of resolutions) {
        if (!isRecord(resolution) || !previousById.has(resolution.id)) {
            if (isRecord(resolution) && validFindingId(resolution.id)) {
                errors.push(error("UNKNOWN_PREVIOUS_RESOLUTION", `Resolution ${resolution.id} does not reference a previous finding.`, resolution.id));
            }
            continue;
        }
        validateResolutionConsistency(resolution, findings, errors);
    }
    for (const finding of findings) {
        if (!isRecord(finding) || typeof finding.previous_id === "undefined") {
            continue;
        }
        if (!previousById.has(finding.previous_id)) {
            errors.push(error("UNKNOWN_PREVIOUS_FINDING", `Finding ${finding.id} references unknown previous finding ${finding.previous_id}.`, finding.id));
        }
    }

    if (Number.isInteger(input.delta_review_count) && input.delta_review_count > 0) {
        const deltaErrors = validateDeltaReviewInput(input.delta_review);
        errors.push(...deltaErrors);
        validateDeltaPreviousIds(input.delta_review, previousById, errors);
        validateDeltaFindingProvenance(findings, previousById, input.delta_review, errors);
    } else if (typeof input.delta_review !== "undefined" && input.delta_review !== null) {
        errors.push(error("UNEXPECTED_DELTA_INPUT", "delta_review is only valid after at least one delta review."));
    }

    return errors;
}

/**
 * @param {JsonObject} [input]
 * @returns {ValidationIssue[]}
 */
export function validateDeltaReviewInput(input = {}) {
    /** @type {ValidationIssue[]} */
    const errors = [];
    if (!isRecord(input)) {
        return [error("INVALID_DELTA_INPUT", "delta_review must be an object.")];
    }

    requireString(input.plan_id, "plan_id", errors, "INVALID_DELTA_PLAN_ID");
    validatePositiveInteger(input.base_revision, "base_revision", errors);
    validatePositiveInteger(input.current_revision, "current_revision", errors);
    if (Number.isInteger(input.base_revision) && Number.isInteger(input.current_revision)
        && input.current_revision <= input.base_revision) {
        errors.push(error("INVALID_DELTA_REVISIONS", "current_revision must be greater than base_revision."));
    }
    if (Number.isInteger(input.base_revision) && Number.isInteger(input.current_revision)
        && input.current_revision !== input.base_revision + 1) {
        errors.push(error("NON_SEQUENTIAL_DELTA_REVISION", "current_revision must be the single revision immediately after base_revision."));
    }
    validateHash(input.base_sha256, "base_sha256", errors);
    validateHash(input.current_sha256, "current_sha256", errors);
    if (validHash(input.base_sha256) && validHash(input.current_sha256)
        && input.base_sha256 === input.current_sha256) {
        errors.push(error("UNCHANGED_DELTA_DOCUMENT", "A delta review requires different base and current document hashes."));
    }

    const changedSections = validateStringArray(input.changed_sections, "changed_sections", errors);
    const changedPackages = validateStringArray(input.changed_work_packages, "changed_work_packages", errors);
    const previousFindingIds = validateStringArray(input.previous_finding_ids, "previous_finding_ids", errors, {findingIds: true});
    validateStringArray(input.allowed_direct_dependencies, "allowed_direct_dependencies", errors);
    if (changedSections.length === 0 && changedPackages.length === 0) {
        errors.push(error("EMPTY_DELTA_SCOPE", "A delta review requires at least one changed section or work package."));
    }
    if (previousFindingIds.length === 0) {
        errors.push(error("EMPTY_PREVIOUS_FINDINGS", "A delta review requires at least one previous finding id."));
    }
    return errors;
}

/**
 * @param {JsonObject} [input]
 * @returns {{ok: boolean, delta_review: JsonObject|null, errors: ValidationIssue[]}}
 */
export function buildDeltaReviewInput(input = {}) {
    const errors = validateDeltaReviewInput(input);
    if (errors.length > 0) {
        return {ok: false, delta_review: null, errors};
    }
    return {
        ok: true,
        delta_review: {
            plan_id: input.plan_id.trim(),
            base_revision: input.base_revision,
            current_revision: input.current_revision,
            base_sha256: input.base_sha256,
            current_sha256: input.current_sha256,
            changed_sections: [...input.changed_sections],
            changed_work_packages: [...input.changed_work_packages],
            previous_finding_ids: [...input.previous_finding_ids],
            allowed_direct_dependencies: [...input.allowed_direct_dependencies],
        },
        errors: [],
    };
}

function validateFinding(finding, errors) {
    if (!isRecord(finding)) {
        errors.push(error("INVALID_FINDING", "Each finding must be an object."));
        return;
    }
    validateFindingId(finding.id, errors);
    if (!CLASSIFICATIONS.has(finding.classification)) {
        errors.push(error("INVALID_CLASSIFICATION", `Finding ${finding.id ?? "<unknown>"} has an unsupported classification.`, finding.id));
    }
    if (typeof finding.actionable !== "boolean") {
        errors.push(error("INVALID_ACTIONABLE_FLAG", `Finding ${finding.id ?? "<unknown>"} requires an explicit actionable boolean.`, finding.id));
    }
    if (!Number.isInteger(finding.repair_attempts) || finding.repair_attempts < 0) {
        errors.push(error("INVALID_REPAIR_ATTEMPTS", `Finding ${finding.id ?? "<unknown>"} requires a non-negative repair_attempts counter.`, finding.id));
    }

    if (finding.classification === "finding") {
        if (!SEVERITIES.has(finding.severity)) {
            errors.push(error("INVALID_SEVERITY", `Finding ${finding.id ?? "<unknown>"} requires BLOCKER, MAJOR, or MINOR severity.`, finding.id));
        }
        if (["BLOCKER", "MAJOR"].includes(finding.severity) && finding.actionable !== true && !hasDecisionReference(finding)) {
            errors.push(error("CONTRADICTORY_FINDING", `Finding ${finding.id} cannot make ${finding.severity} nonactionable without a user decision reference.`, finding.id));
        }
    } else if (typeof finding.severity !== "undefined" && finding.severity !== null) {
        errors.push(error("UNEXPECTED_SEVERITY", `Finding ${finding.id ?? "<unknown>"} must not assign severity to ${finding.classification}.`, finding.id));
    }

    if (finding.classification === "SUGGESTION" && finding.actionable === true) {
        errors.push(error("ACTIONABLE_SUGGESTION", `Suggestion ${finding.id} cannot be actionable.`, finding.id));
    }
    if (finding.classification === "QUESTION") {
        if (finding.actionable === true) {
            errors.push(error("ACTIONABLE_QUESTION", `Question ${finding.id} uses approval_affecting instead of actionable.`, finding.id));
        }
        if (typeof finding.approval_affecting !== "boolean") {
            errors.push(error("INVALID_APPROVAL_FLAG", `Question ${finding.id} requires approval_affecting boolean.`, finding.id));
        }
    }
    if (typeof finding.accepted_decision_ref !== "undefined") {
        requireString(finding.accepted_decision_ref, "accepted_decision_ref", errors, "INVALID_DECISION_REFERENCE", finding.id);
    }
    validateOptionalBoolean(finding.requires_user_decision, "requires_user_decision", finding.id, errors);
    validateOptionalBoolean(finding.requires_external_evidence, "requires_external_evidence", finding.id, errors);
    validateRecurrence(finding, errors);
}

function validatePreviousFinding(finding, errors) {
    if (!isRecord(finding)) {
        errors.push(error("INVALID_PREVIOUS_FINDING", "Each previous finding must be an object."));
        return;
    }
    validateFindingId(finding.id, errors);
    if (!SEVERITIES.has(finding.severity)) {
        errors.push(error("INVALID_PREVIOUS_SEVERITY", `Previous finding ${finding.id ?? "<unknown>"} requires a valid severity.`, finding.id));
    }
}

function validateResolution(resolution, errors) {
    if (!isRecord(resolution)) {
        errors.push(error("INVALID_PREVIOUS_RESOLUTION", "Each previous resolution must be an object."));
        return;
    }
    validateFindingId(resolution.id, errors);
    if (!RESOLUTION_STATUSES.has(resolution.status)) {
        errors.push(error("INVALID_RESOLUTION_STATUS", `Resolution ${resolution.id ?? "<unknown>"} has an unsupported status.`, resolution.id));
        return;
    }
    if (resolution.status === "current" && !SEVERITIES.has(resolution.current_severity)) {
        errors.push(error("MISSING_CURRENT_SEVERITY", `Current resolution ${resolution.id} requires current_severity.`, resolution.id));
    }
    if (resolution.status === "accepted") {
        requireString(resolution.decision_ref, "decision_ref", errors, "MISSING_DECISION_REFERENCE", resolution.id);
    }
}

function validateResolutionConsistency(resolution, findings, errors) {
    const linked = findings.filter((finding) => isRecord(finding)
        && (finding.id === resolution.id || finding.previous_id === resolution.id)
        && finding.recurrence?.same_failure_mode !== false);
    if (resolution.status === "current") {
        if (linked.length !== 1) {
            errors.push(error("CURRENT_FINDING_MISMATCH", `Current resolution ${resolution.id} must map to exactly one current finding.`, resolution.id));
            return;
        }
        if (linked[0].severity !== resolution.current_severity) {
            errors.push(error("CURRENT_SEVERITY_MISMATCH", `Resolution ${resolution.id} current_severity must match the current finding.`, resolution.id));
        }
    } else if (linked.some((finding) => isActionableFinding(finding))) {
        errors.push(error("RESOLVED_FINDING_STILL_ACTIONABLE", `Resolution ${resolution.id} conflicts with an actionable current finding.`, resolution.id));
    }
}

function validateRecurrence(finding, errors) {
    const hasPreviousId = typeof finding.previous_id !== "undefined";
    const hasRecurrence = typeof finding.recurrence !== "undefined" && finding.recurrence !== null;
    if (hasPreviousId && !hasRecurrence) {
        errors.push(error("MISSING_RECURRENCE_ASSESSMENT", `Finding ${finding.id ?? "<unknown>"} with previous_id requires an explicit recurrence assessment.`, finding.id));
        return;
    }
    if (!hasRecurrence) {
        return;
    }
    if (!isRecord(finding.recurrence) || !validFindingId(finding.previous_id)) {
        errors.push(error("INVALID_RECURRENCE", `Finding ${finding.id ?? "<unknown>"} recurrence requires previous_id.`, finding.id));
        return;
    }
    if (typeof finding.recurrence.same_failure_mode !== "boolean"
        || typeof finding.recurrence.new_evidence !== "boolean") {
        errors.push(error("INCOMPLETE_RECURRENCE_ASSESSMENT", `Finding ${finding.id} recurrence requires same_failure_mode and new_evidence booleans.`, finding.id));
    }
    if (finding.recurrence.new_evidence === true) {
        requireString(finding.recurrence.evidence, "recurrence.evidence", errors, "MISSING_RECURRENCE_EVIDENCE", finding.id);
    }
}

function validateDeltaPreviousIds(delta, previousById, errors) {
    if (!isRecord(delta) || !Array.isArray(delta.previous_finding_ids)) {
        return;
    }
    const declared = new Set(delta.previous_finding_ids);
    for (const id of previousById.keys()) {
        if (!declared.has(id)) {
            errors.push(error("DELTA_MISSING_PREVIOUS_ID", `Delta input omits previous finding ${id}.`, id));
        }
    }
    for (const id of declared) {
        if (!previousById.has(id)) {
            errors.push(error("DELTA_UNKNOWN_PREVIOUS_ID", `Delta input references unknown previous finding ${id}.`, id));
        }
    }
}

function validateDeltaFindingProvenance(findings, previousById, delta, errors) {
    if (!isRecord(delta)) {
        return;
    }
    for (const finding of findings.filter(isActionableFinding)) {
        const linkedToPrevious = previousById.has(finding.id)
            || (validFindingId(finding.previous_id) && previousById.has(finding.previous_id));
        const differentFailureMode = finding.recurrence?.same_failure_mode === false;
        if (linkedToPrevious && !differentFailureMode) {
            continue;
        }
        const provenance = finding.provenance;
        if (!isRecord(provenance) || !PROVENANCE_KINDS.has(provenance.kind)) {
            errors.push(error("MISSING_FINDING_PROVENANCE", `New actionable finding ${finding.id} requires delta provenance.`, finding.id));
            continue;
        }
        requireString(provenance.target, "provenance.target", errors, "INVALID_FINDING_PROVENANCE", finding.id);
        requireString(provenance.evidence, "provenance.evidence", errors, "MISSING_PROVENANCE_EVIDENCE", finding.id);
        const scopes = provenance.kind === "changed_section"
            ? delta.changed_sections
            : provenance.kind === "changed_work_package"
                ? delta.changed_work_packages
                : delta.allowed_direct_dependencies;
        if (Array.isArray(scopes) && !scopes.includes(provenance.target)) {
            errors.push(error("PROVENANCE_OUTSIDE_DELTA", `Finding ${finding.id} provenance target is outside the declared delta scope.`, finding.id));
        }
    }
}

function validateUniqueRecords(records, label, validator, errors) {
    const ids = new Set();
    for (const record of records) {
        validator(record, errors);
        if (!isRecord(record) || !validFindingId(record.id)) {
            continue;
        }
        if (ids.has(record.id)) {
            errors.push(error("DUPLICATE_FINDING_ID", `Duplicate ${label} id: ${record.id}.`, record.id));
        }
        ids.add(record.id);
    }
}

function validateFindingId(id, errors) {
    if (!validFindingId(id)) {
        errors.push(error("INVALID_FINDING_ID", "Finding ids must match F<number>."));
    }
}

function validFindingId(id) {
    return typeof id === "string" && FINDING_ID_PATTERN.test(id);
}

function validateCounter(value, name, errors) {
    if (!Number.isInteger(value) || value < 0) {
        errors.push(error("INVALID_COUNTER", `${name} must be a non-negative integer.`));
    }
}

function validatePositiveInteger(value, name, errors) {
    if (!Number.isInteger(value) || value < 1) {
        errors.push(error("INVALID_DELTA_REVISION", `${name} must be a positive integer.`));
    }
}

function validateHash(value, name, errors) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
        errors.push(error("INVALID_DOCUMENT_HASH", `${name} must be a lowercase SHA-256 document hash.`));
    }
}

function validHash(value) {
    return typeof value === "string" && SHA256_PATTERN.test(value);
}

function validateArray(value, name, errors) {
    if (!Array.isArray(value)) {
        errors.push(error("INVALID_ARRAY", `${name} must be an array.`));
        return [];
    }
    return value;
}

/**
 * @param {unknown} value
 * @param {string} name
 * @param {ValidationIssue[]} errors
 * @param {{findingIds?: boolean}} [options]
 * @returns {any[]}
 */
function validateStringArray(value, name, errors, options = {}) {
    const values = validateArray(value, name, errors);
    const seen = new Set();
    for (const item of values) {
        if (typeof item !== "string" || item.trim() === "" || (options.findingIds && !validFindingId(item))) {
            errors.push(error("INVALID_ARRAY_ITEM", `${name} must contain non-empty${options.findingIds ? " finding-id" : ""} strings.`));
            continue;
        }
        if (seen.has(item)) {
            errors.push(error("DUPLICATE_ARRAY_ITEM", `${name} contains duplicate value ${item}.`));
        }
        seen.add(item);
    }
    return values;
}

function validateOptionalBoolean(value, name, findingId, errors) {
    if (typeof value !== "undefined" && typeof value !== "boolean") {
        errors.push(error("INVALID_BOOLEAN", `${name} must be a boolean when provided.`, findingId));
    }
}

function requireString(value, name, errors, code, findingId = null) {
    if (typeof value !== "string" || value.trim() === "") {
        errors.push(error(code, `${name} must be a non-empty string.`, findingId));
    }
}

function hasDecisionReference(finding) {
    return typeof finding.accepted_decision_ref === "string" && finding.accepted_decision_ref.trim() !== "";
}

function isActionableFinding(finding) {
    return isRecord(finding)
        && finding.classification === "finding"
        && finding.actionable === true
        && !hasDecisionReference(finding);
}

function isApprovalAffectingQuestion(finding) {
    return isRecord(finding)
        && finding.classification === "QUESTION"
        && finding.approval_affecting === true;
}

function isProgressResolution(resolution, previousFinding) {
    return resolution.status === "resolved"
        || (resolution.status === "current"
            && SEVERITY_RANK[resolution.current_severity] < SEVERITY_RANK[previousFinding?.severity]);
}

function isWorsenedResolution(resolution, previousFinding) {
    return resolution.status === "current"
        && SEVERITY_RANK[resolution.current_severity] > SEVERITY_RANK[previousFinding?.severity];
}

function isUnsupportedRecurrence(finding) {
    return finding.recurrence?.same_failure_mode === true
        && finding.recurrence?.new_evidence !== true;
}

/**
 * @param {string} action
 * @param {string} reason
 * @param {JsonObject[]} actionable
 * @param {ValidationIssue[]} [errors]
 */
function decision(action, reason, actionable, errors = []) {
    return {
        ok: errors.length === 0,
        action,
        reason,
        actionable_finding_ids: actionable.map((finding) => finding.id),
        errors,
    };
}

/** @returns {ValidationIssue} */
function error(code, message, findingId = null) {
    return typeof findingId === "string" ? {code, message, finding_id: findingId} : {code, message};
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseArgs(argv) {
    const result = {_command: null, input: null, help: false};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (token === "--help" || token === "-h") {
            result.help = true;
        } else if (!result._command && !token.startsWith("--")) {
            result._command = token;
        } else if (token === "--input") {
            result.input = argv[index + 1];
            index += 1;
        } else {
            throw new TypeError(`Unknown argument: ${token}`);
        }
    }
    return result;
}

function readJsonInput(filePath) {
    if (typeof filePath !== "string" || filePath === "") {
        throw new TypeError("--input <file|-> is required.");
    }
    const content = filePath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(filePath), "utf8");
    return JSON.parse(content);
}

function usage() {
    return [
        "Usage:",
        "  review-cycle.mjs decide --input <file|->",
        "  review-cycle.mjs delta-input --input <file|->",
        "",
        "The helper is stateless. Semantic assessments are explicit JSON input.",
    ].join("\n");
}

function main(argv) {
    const args = parseArgs(argv);
    if (args.help) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const input = readJsonInput(args.input);
    const result = args._command === "decide"
        ? decideReviewCycle(input)
        : args._command === "delta-input"
            ? buildDeltaReviewInput(input)
            : null;
    if (result === null) {
        throw new TypeError("Command must be decide or delta-input.");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        main(process.argv.slice(2));
    } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        process.stderr.write(`${JSON.stringify({error: "REVIEW_CYCLE_ERROR", message})}\n`);
        process.exitCode = 2;
    }
}
