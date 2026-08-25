#!/usr/bin/env node
import {existsSync, readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {readCriteriaFile} from "./context-criteria.mjs";
import {normalizeReadObservation} from "./read-purpose.mjs";

const STATUSES = new Set(["COMPLETE", "INCOMPLETE", "BLOCKED"]);
const MODES = new Set(["targeted", "cross-layer"]);
const COVERAGE_STATUSES = new Set(["covered", "not_applicable", "blocked"]);
const CLAIM_TYPES = new Set(["observed", "structural", "inferred"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);
const MAX_EVIDENCE_SPAN = 80;
const MAX_COVERED_PATHS = 10;
const MAX_FOLLOW_UP_PATHS = 8;
const FORBIDDEN_NEGATIVE_PATTERNS = [
    /\b(?:does not exist|is missing|is absent|not present)\b/i,
    /\bno\s+(?:(?:dedicated|standalone|sample|matching|relevant)\s+)?(?:[a-z0-9_.-]+\s+){0,3}(?:test|tests|file|files|config|configuration|route|entrypoint|artifact)\b/i,
    /\bthe only\b/i,
    /\b(?:nie istnieje|nie ma|nie znaleziono|jedyny|jedyna|jedyne|żaden|żadna|żadne)\b/i,
    /\bbrak(?:uje|ują|owało)?\b/i,
];

// Stable failure classification contract (WP3). The hybrid helper imports
// these constants and helpers so that one owner defines the retry policy.
export const FAILURE_CLASSES = Object.freeze({
    INPUT_INVALID: "INPUT_INVALID",
    SCOPE_INVALID: "SCOPE_INVALID",
    SNAPSHOT_STALE: "SNAPSHOT_STALE",
    AGENT_INCOMPLETE: "AGENT_INCOMPLETE",
    AGENT_TIMEOUT: "AGENT_TIMEOUT",
    REPORT_MISSING: "REPORT_MISSING",
    REPORT_INVALID: "REPORT_INVALID",
    REPORT_WRITE_FAILED: "REPORT_WRITE_FAILED",
});

export const RETRYABLE_FAILURE_CLASSES = Object.freeze(new Set([
    FAILURE_CLASSES.AGENT_INCOMPLETE,
    FAILURE_CLASSES.AGENT_TIMEOUT,
    FAILURE_CLASSES.REPORT_MISSING,
    FAILURE_CLASSES.REPORT_INVALID,
    FAILURE_CLASSES.REPORT_WRITE_FAILED,
]));

export function isRetryableFailureClass(failureClass) {
    return RETRYABLE_FAILURE_CLASSES.has(failureClass);
}

export function classifyReportValidation({valid = false, reportExists = true, ioFailure = false, schemaValid = false, status = null, modeMatches = true} = {}) {
    if (!reportExists) { return FAILURE_CLASSES.REPORT_MISSING; }
    if (ioFailure) { return FAILURE_CLASSES.REPORT_WRITE_FAILED; }
    if (valid && modeMatches) { return null; }
    if (schemaValid && (status === "INCOMPLETE" || status === "BLOCKED")) { return FAILURE_CLASSES.AGENT_INCOMPLETE; }
    return FAILURE_CLASSES.REPORT_INVALID;
}

export function nextActionForFailureClass(failureClass, attempt = "primary") {
    if (failureClass === null || failureClass === undefined) { return "FINALIZE"; }
    if (failureClass === FAILURE_CLASSES.SNAPSHOT_STALE) { return "ABORT"; }
    if (failureClass === FAILURE_CLASSES.INPUT_INVALID || failureClass === FAILURE_CLASSES.SCOPE_INVALID) { return "STOP"; }
    if (isRetryableFailureClass(failureClass)) { return attempt === "primary" ? "CLAIM_FALLBACK" : "FINALIZE"; }
    return "STOP";
}

function normalizeCriteria(criteria) {
    if (criteria === null) { return {ids: null, entries: new Map()}; }
    if (criteria instanceof Set) { return {ids: criteria, entries: new Map()}; }
    if (Array.isArray(criteria)) {
        return {
            ids: new Set(criteria.map((criterion) => criterion.id)),
            entries: new Map(criteria.map((criterion) => [criterion.id, criterion])),
        };
    }
    throw new Error("criteria must be null, a Set of ids, or an array of criterion objects");
}

function parseArgs(argv) {
    const [command, reportPath, ...rest] = argv;
    const options = {};
    const allowed = new Set(["head", "criteria"]);
    for (let index = 0; index < rest.length; index += 1) {
        if (!rest[index].startsWith("--")) {
            throw new Error(`unexpected argument: ${rest[index]}`);
        }
        const key = rest[index].slice(2);
        if (!allowed.has(key)) { throw new Error(`unknown option: --${key}`); }
        const value = rest[index + 1];
        if (!value || value.startsWith("--")) { throw new Error(`option --${key} requires a value`); }
        options[key] = value;
        index += 1;
    }
    return {command, reportPath, options};
}

export function readSnapshotFile(path, head) {
    if (head) {
        try {
            const changed = String(execFileSync("git", ["diff", "--name-only", head, "--", path], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
            })).trim() !== "";
            if (!changed) {
                return String(execFileSync("git", ["show", `${head}:${path}`], {
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "ignore"],
                }));
            }
        } catch {
            // Fall back to the workspace for ignored or untracked project files.
        }
    }

    return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function validateEvidence(evidence, head, errors, location, evidenceIndex) {
    if (typeof evidence !== "object" || evidence === null || Array.isArray(evidence)) {
        errors.push(`${location}.evidence[${evidenceIndex}] must be an object`);
        return;
    }

    const path = evidence.path;
    if (typeof path !== "string" || path.trim() === "" || path.startsWith("/") || path.includes("..") || path.includes("...")) {
        errors.push(`${location}.evidence[${evidenceIndex}].path must be a repo-relative path without shorthand`);
        return;
    }

    const lineStart = evidence.line_start;
    const lineEnd = evidence.line_end;
    if (!Number.isInteger(lineStart) || lineStart < 1 || !Number.isInteger(lineEnd) || lineEnd < lineStart) {
        errors.push(`${location}.evidence[${evidenceIndex}] has an invalid line range`);
        return;
    }
    if (lineEnd - lineStart + 1 > MAX_EVIDENCE_SPAN) {
        errors.push(`${location}.evidence[${evidenceIndex}] spans more than ${MAX_EVIDENCE_SPAN} lines`);
    }

    const content = readSnapshotFile(path, head);
    if (content === null) {
        errors.push(`${location}.evidence[${evidenceIndex}].path does not exist at the selected snapshot: ${path}`);
        return;
    }

    const lineCount = content.split("\n").length;
    if (lineEnd > lineCount) {
        errors.push(`${location}.evidence[${evidenceIndex}] line_end exceeds ${path} (${lineCount})`);
    }

    for (const key of ["locator", "relation"]) {
        if (key in evidence && typeof evidence[key] !== "string") {
            errors.push(`${location}.evidence[${evidenceIndex}].${key} must be a string`);
        }
    }
    validateReadPurpose(evidence, errors, location, evidenceIndex);
}

function validateReadPurpose(evidence, errors, location, evidenceIndex) {
    const purposeKeys = ["event", "purpose", "source", "read_mode"];
    if (!purposeKeys.some((key) => Object.hasOwn(evidence, key))) { return; }
    const missing = purposeKeys.filter((key) => !Object.hasOwn(evidence, key));
    if (missing.length > 0) {
        errors.push(`${location}.evidence[${evidenceIndex}] read-purpose: structured metadata must include ${purposeKeys.join(", ")}; missing ${missing.join(", ")}`);
        return;
    }
    const result = normalizeReadObservation({
        event: evidence.event,
        purpose: evidence.purpose,
        source: evidence.source ?? "scout",
        read_mode: evidence.read_mode ?? "range",
        resource_kind: "path",
        path: evidence.path,
    });
    for (const error of result.errors) {
        errors.push(`${location}.evidence[${evidenceIndex}] read-purpose: ${error}`);
    }
}

function validateAnchors(item, key, index, head, errors) {
    if (!Array.isArray(item.anchors) || item.anchors.length === 0 || item.anchors.some((anchor) => typeof anchor !== "string" || anchor.trim() === "")) {
        errors.push(`${key}[${index}].anchors must contain non-empty literal terms`);
        return;
    }
    const evidenceText = item.evidence.map((evidence) => {
        const content = readSnapshotFile(evidence.path, head);
        if (content === null) { return ""; }
        return content.split("\n").slice(evidence.line_start - 1, evidence.line_end).join("\n");
    }).join("\n");
    for (const anchor of item.anchors) {
        if (!evidenceText.includes(anchor)) {
            errors.push(`${key}[${index}].anchors term is absent from its evidence: ${anchor}`);
        }
    }
}

function validateClaimMetadata(item, key, index, errors) {
    if (!CLAIM_TYPES.has(item.claim_type)) {
        errors.push(`${key}[${index}].claim_type must be observed, structural or inferred`);
    }
    if (!CONFIDENCES.has(item.confidence)) {
        errors.push(`${key}[${index}].confidence must be high, medium or low`);
    }
}

function validateClaimItem(item, key, index, head, errors, criteria) {
    if (typeof item === "string") {
        return;
    }
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
        errors.push(`${key}[${index}] must be a string or an evidence object`);
        return;
    }
    if (typeof item.claim !== "string" || item.claim.trim() === "") {
        errors.push(`${key}[${index}].claim must be a non-empty string`);
    }
    validateClaimMetadata(item, key, index, errors);
    if (criteria !== null && (typeof item.criterion_id !== "string" || !criteria.has(item.criterion_id))) {
        errors.push(`${key}[${index}].criterion_id must reference a supplied acceptance criterion`);
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
        errors.push(`${key}[${index}].evidence must contain at least one item`);
        return;
    }
    validateAnchors(item, key, index, head, errors);
    item.evidence.forEach((evidence, evidenceIndex) => validateEvidence(evidence, head, errors, `${key}[${index}]`, evidenceIndex));
}

function validateCoverageEntry(entry, head, errors, index, criteria, evidenceBackedCriteria) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        errors.push(`coverage[${index}] must be an object`);
        return;
    }
    if (typeof entry.criterion_id !== "string" || entry.criterion_id.trim() === "") {
        errors.push(`coverage[${index}].criterion_id must be a non-empty string`);
    } else if (criteria !== null && !criteria.has(entry.criterion_id)) {
        errors.push(`coverage[${index}].criterion_id must reference a supplied acceptance criterion`);
    }
    if (!COVERAGE_STATUSES.has(entry.status)) {
        errors.push(`coverage[${index}].status must be covered, not_applicable or blocked`);
        return;
    }
    if (entry.status === "covered") {
        if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
            if (!evidenceBackedCriteria.has(entry.criterion_id)) {
                errors.push(`coverage[${index}] with covered status needs direct evidence or an observed/structural finding with evidence for the same criterion`);
            }
        } else {
            entry.evidence.forEach((evidence, evidenceIndex) => validateEvidence(evidence, head, errors, `coverage[${index}]`, evidenceIndex));
        }
    }
    if (["not_applicable", "blocked"].includes(entry.status) && (typeof entry.reason !== "string" || entry.reason.trim() === "")) {
        errors.push(`coverage[${index}].reason must be a non-empty string for ${entry.status} status`);
    }
}

function validateReadCoverage(readCoverage, head, errors) {
    if (readCoverage === undefined) { return; }
    if (typeof readCoverage !== "object" || readCoverage === null || Array.isArray(readCoverage)) {
        errors.push("read_coverage must be an object");
        return;
    }
    const covered = readCoverage.covered;
    if (!Array.isArray(covered) || covered.length > MAX_COVERED_PATHS) {
        errors.push(`read_coverage.covered must be an array with at most ${MAX_COVERED_PATHS} items`);
    } else {
        covered.forEach((evidence, index) => validateEvidence(evidence, head, errors, "read_coverage.covered", index));
    }
    const coveredPaths = new Set((covered ?? []).map((evidence) => evidence?.path).filter(Boolean));
    const followUp = readCoverage.follow_up;
    if (!Array.isArray(followUp) || followUp.length > MAX_FOLLOW_UP_PATHS) {
        errors.push(`read_coverage.follow_up must be an array with at most ${MAX_FOLLOW_UP_PATHS} items`);
    } else {
        followUp.forEach((item, index) => {
            if (typeof item !== "object" || item === null || Array.isArray(item)) {
                errors.push(`read_coverage.follow_up[${index}] must be an object`);
                return;
            }
            if (typeof item.path !== "string" || item.path.trim() === "" || item.path.startsWith("/") || item.path.includes("..") || item.path.includes("...")) {
                errors.push(`read_coverage.follow_up[${index}].path must be a repo-relative path without shorthand`);
            }
            if (coveredPaths.has(item.path)) {
                errors.push(`read_coverage.follow_up[${index}].path is already covered: ${item.path}`);
            }
            if (typeof item.reason !== "string" || item.reason.trim() === "") {
                errors.push(`read_coverage.follow_up[${index}].reason must be non-empty`);
            }
        });
    }
}

function evidenceText(evidence, head) {
    const content = readSnapshotFile(evidence.path, head);
    if (content === null) { return ""; }
    return content.split("\n").slice(evidence.line_start - 1, evidence.line_end).join("\n");
}

function evidenceMatchesRequirement(evidence, requirement, head) {
    const candidates = evidence.filter((item) => {
        if (requirement.path !== undefined && item.path !== requirement.path) { return false; }
        if (requirement.path_prefix !== undefined) {
            const prefix = requirement.path_prefix.replace(/\/+$/, "");
            if (item.path !== prefix && !item.path.startsWith(`${prefix}/`)) { return false; }
        }
        return requirement.relation === undefined || item.relation === requirement.relation;
    });
    if (candidates.length === 0) { return false; }
    const source = candidates.map((item) => evidenceText(item, head)).join("\n");
    return (requirement.anchors ?? []).every((anchor) => source.includes(anchor));
}

function validateSemanticRequirements(report, criteriaEntries, head, errors) {
    if (report.status !== "COMPLETE" || criteriaEntries.size === 0) { return; }
    for (const [criterionId, criterion] of criteriaEntries) {
        const findings = (report.findings ?? []).filter((finding) => finding?.criterion_id === criterionId);
        if (criterion.forbid_negative_claims === true) {
            const texts = [
                ...findings.map((finding) => finding.claim),
                ...(report.risks ?? []).map((risk) => typeof risk === "string" ? risk : risk?.claim),
                report.next_step,
            ].filter((value) => typeof value === "string");
            for (const text of texts) {
                if (FORBIDDEN_NEGATIVE_PATTERNS.some((pattern) => pattern.test(text))) {
                    errors.push(`COMPLETE report uses a forbidden negative or exhaustive claim for ${criterionId}: ${text}`);
                }
            }
        }
        const evidence = findings.flatMap((finding) => Array.isArray(finding.evidence) ? finding.evidence : []);
        for (const [requirementIndex, requirement] of (criterion.required_evidence ?? []).entries()) {
            if (!evidenceMatchesRequirement(evidence, requirement, head)) {
                const selector = requirement.path ?? `${requirement.path_prefix}*`;
                errors.push(`COMPLETE report does not satisfy required_evidence[${requirementIndex}] for ${criterionId}: ${selector}`);
            }
        }
    }
}

export function validateScoutReport(report, {head = "", criteria = null} = {}) {
    const errors = [];
    const criteriaSpec = normalizeCriteria(criteria);
    const criterionIds = criteriaSpec.ids;
    if (typeof report !== "object" || report === null || Array.isArray(report)) {
        return {valid: false, errors: ["report must be an object"]};
    }

    if (report.version !== 1) { errors.push("version must be 1"); }
    if (!STATUSES.has(report.status)) { errors.push("status must be COMPLETE, INCOMPLETE or BLOCKED"); }
    if (!MODES.has(report.mode)) { errors.push("mode must be targeted or cross-layer"); }
    if (!Array.isArray(report.findings) || report.findings.length > 12) {
        errors.push("findings must be an array with at most 12 items");
    }

    if (Array.isArray(report.findings)) {
        report.findings.forEach((finding, findingIndex) => {
            if (typeof finding !== "object" || finding === null || Array.isArray(finding)) {
                errors.push(`findings[${findingIndex}] must be an object`);
                return;
            }
            if (typeof finding.claim !== "string" || finding.claim.trim() === "") {
                errors.push(`findings[${findingIndex}].claim must be a non-empty string`);
            }
            validateClaimMetadata(finding, "findings", findingIndex, errors);
            if (criterionIds !== null && (typeof finding.criterion_id !== "string" || !criterionIds.has(finding.criterion_id))) {
                errors.push(`findings[${findingIndex}].criterion_id must reference a supplied acceptance criterion`);
            }
            if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
                errors.push(`findings[${findingIndex}].evidence must contain at least one item`);
                return;
            }
            validateAnchors(finding, "findings", findingIndex, head, errors);
            finding.evidence.forEach((evidence, evidenceIndex) => validateEvidence(evidence, head, errors, `findings[${findingIndex}]`, evidenceIndex));
        });
    }

    // Inferred findings are interpretations, not direct observations, so they
    // must not back empty coverage evidence for a covered criterion.
    const evidenceBackedCriteria = new Set((report.findings ?? [])
        .filter((finding) => finding && finding.claim_type !== "inferred" && typeof finding.criterion_id === "string" && Array.isArray(finding.evidence) && finding.evidence.length > 0)
        .map((finding) => finding.criterion_id));
    if (!Array.isArray(report.coverage)) {
        errors.push("coverage must be an array");
    } else {
        const seenCoverage = new Set();
        report.coverage.forEach((entry, index) => {
            validateCoverageEntry(entry, head, errors, index, criterionIds, evidenceBackedCriteria);
            if (entry && typeof entry.criterion_id === "string") {
                if (seenCoverage.has(entry.criterion_id)) {
                    errors.push(`coverage contains duplicate criterion: ${entry.criterion_id}`);
                }
                seenCoverage.add(entry.criterion_id);
            }
        });
    }

    if (!Array.isArray(report.risks)) {
        errors.push("risks must be an array");
    } else {
        report.risks.forEach((risk, index) => validateClaimItem(risk, "risks", index, head, errors, null));
    }
    if (!Array.isArray(report.omitted) || !report.omitted.every((item) => typeof item === "string")) {
        errors.push("omitted must be an array of strings");
    }
    if (typeof report.next_step !== "string") { errors.push("next_step must be a string"); }

    if (report.status === "BLOCKED" && Array.isArray(report.findings) && report.findings.length > 0) {
        errors.push("BLOCKED reports must not contain findings");
    }

    validateReadCoverage(report.read_coverage, head, errors);
    validateSemanticRequirements(report, criteriaSpec.entries, head, errors);

    if (report.status === "COMPLETE" && criterionIds !== null) {
        const coverage = new Map((report.coverage ?? []).map((entry) => [entry.criterion_id, entry.status]));
        for (const criterionId of criterionIds) {
            if (!coverage.has(criterionId)) {
                errors.push(`COMPLETE report does not cover acceptance criterion: ${criterionId}`);
            } else if (coverage.get(criterionId) === "blocked") {
                errors.push(`COMPLETE report has blocked acceptance criterion: ${criterionId}`);
            }
        }
    }

    return {valid: errors.length === 0, errors};
}

function main(argv) {
    const {command, reportPath, options} = parseArgs(argv);
    if (command !== "validate" || !reportPath || !options.criteria) {
        process.stderr.write("Usage: context-scout-report.mjs validate <report.json> [--head <commit>] --criteria <criteria.json>\n");
        return 2;
    }

    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    const validation = validateScoutReport(report, {
        head: options.head ?? "",
        criteria: readCriteriaFile(options.criteria),
    });
    if (!validation.valid) {
        process.stderr.write(`${validation.errors.join("\n")}\n`);
        return 1;
    }

    process.stdout.write(`context-scout report: valid (${report.status}, ${report.findings.length} findings)\n`);
    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
