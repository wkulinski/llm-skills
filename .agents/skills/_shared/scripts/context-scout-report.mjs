#!/usr/bin/env node
import {existsSync, readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {readCriteriaIds} from "./context-criteria.mjs";

const STATUSES = new Set(["COMPLETE", "INCOMPLETE", "BLOCKED"]);
const MODES = new Set(["targeted", "cross-layer"]);
const COVERAGE_STATUSES = new Set(["covered", "not_applicable", "blocked"]);

function parseArgs(argv) {
    const [command, reportPath, ...rest] = argv;
    const options = {};
    const allowed = new Set(["head", "criteria"]);
    for (let index = 0; index < rest.length; index += 1) {
        if (!rest[index].startsWith("--")) {
            throw new Error(`unexpected argument: ${rest[index]}`);
        }
        const key = rest[index].slice(2);
        if (!allowed.has(key)) throw new Error(`unknown option: --${key}`);
        const value = rest[index + 1];
        if (!value || value.startsWith("--")) throw new Error(`option --${key} requires a value`);
        options[key] = value;
        index += 1;
    }
    return {command, reportPath, options};
}

function readSnapshotFile(path, head) {
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
    if (criteria !== null && (typeof item.criterion_id !== "string" || !criteria.has(item.criterion_id))) {
        errors.push(`${key}[${index}].criterion_id must reference a supplied acceptance criterion`);
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
        errors.push(`${key}[${index}].evidence must contain at least one item`);
        return;
    }
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
                errors.push(`coverage[${index}] with covered status needs evidence or a finding with evidence for the same criterion`);
            }
        } else {
            entry.evidence.forEach((evidence, evidenceIndex) => validateEvidence(evidence, head, errors, `coverage[${index}]`, evidenceIndex));
        }
    }
    if (["not_applicable", "blocked"].includes(entry.status) && (typeof entry.reason !== "string" || entry.reason.trim() === "")) {
        errors.push(`coverage[${index}].reason must be a non-empty string for ${entry.status} status`);
    }
}

export function validateScoutReport(report, {head = "", criteria = null} = {}) {
    const errors = [];
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
            if (criteria !== null && (typeof finding.criterion_id !== "string" || !criteria.has(finding.criterion_id))) {
                errors.push(`findings[${findingIndex}].criterion_id must reference a supplied acceptance criterion`);
            }
            if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
                errors.push(`findings[${findingIndex}].evidence must contain at least one item`);
                return;
            }
            finding.evidence.forEach((evidence, evidenceIndex) => validateEvidence(evidence, head, errors, `findings[${findingIndex}]`, evidenceIndex));
        });
    }

    const evidenceBackedCriteria = new Set((report.findings ?? [])
        .filter((finding) => finding && typeof finding.criterion_id === "string" && Array.isArray(finding.evidence) && finding.evidence.length > 0)
        .map((finding) => finding.criterion_id));
    if (!Array.isArray(report.coverage)) {
        errors.push("coverage must be an array");
    } else {
        const seenCoverage = new Set();
        report.coverage.forEach((entry, index) => {
            validateCoverageEntry(entry, head, errors, index, criteria, evidenceBackedCriteria);
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

    if (report.status === "COMPLETE" && criteria !== null) {
        const coverage = new Map((report.coverage ?? []).map((entry) => [entry.criterion_id, entry.status]));
        for (const criterionId of criteria) {
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
        criteria: new Set(readCriteriaIds(options.criteria)),
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
