#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

export const PLAN_RESULTS = Object.freeze(["invalid", "blocked", "ready"]);

export const REQUIRED_SECTIONS = Object.freeze([
    "Source and objective",
    "Source assessment",
    "Scope",
    "Direction, simplicity and consistency",
    "Source coverage",
    "Work packages",
    "Order and dependencies",
    "Decisions and open questions",
    "Risks and discovery debt",
    "Acceptance and verification",
    "Execution environment",
    "Execution",
    "Next action",
]);

export const REQUIRED_PACKAGE_FIELDS = Object.freeze([
    "Source",
    "Goal",
    "Scope",
    "Out of scope",
    "Confirmed paths",
    "Candidate paths",
    "Discovery required",
    "Dependencies",
    "Estimated size",
    "Acceptance criteria",
    "Verification",
]);

const ESSENTIAL_PACKAGE_FIELDS = new Set(["Source", "Goal", "Scope", "Estimated size", "Acceptance criteria", "Verification"]);
export const EXECUTION_STATUSES = Object.freeze(["not_started", "in_progress", "complete", "blocked"]);
export const EXECUTION_WP_STATUSES = Object.freeze(["pending", "in_progress", "done", "blocked"]);
const CONCRETE_MODEL_PATTERN = /^[^/\s]+\/[^/\s]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const REQUIRED_DIRECTION_FIELDS = Object.freeze([
    "Existing mechanism reused",
    "Simpler alternative considered",
    "Why the selected approach is minimal",
    "Duplicate or parallel responsibilities",
    "Cross-WP consistency and ownership",
]);

export const REQUIRED_SOURCE_ASSESSMENT_FIELDS = Object.freeze([
    "Requested outcome",
    "Observed symptoms",
    "Explicit constraints",
    "Suggested diagnosis or solution",
    "Claims verified in evidence",
    "Claims corrected or still unverified",
]);

const CONTEXT_STATUSES = Object.freeze(["NOT_REQUIRED", "COMPLETE", "INCOMPLETE", "BLOCKED"]);
const FORBIDDEN_METADATA = Object.freeze(["status", "blocking_questions", "reviewed_at", "last_error"]);
const PLACEHOLDER_PATTERNS = Object.freeze([
    /<!--\s*task-plan:placeholder\s*-->/i,
    /\[(?:TBD|TODO|PLACEHOLDER)\]/i,
    /<(?:TBD|TODO|PLACEHOLDER)>/i,
    /\bTBD\b/i,
    /\bTODO\b/i,
    /To be (?:established|determined)\b/i,
    /Original source material is pending intake/i,
    /Source fetch pending/i,
    /^\s*- None yet\.\s*$/im,
]);

export class ValidationError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "ValidationError";
        this.code = code;
        this.details = details;
    }
}

export function validatePlanDocument(markdown, options = {}) {
    const errors = [];
    if (typeof markdown !== "string" || markdown.trim() === "") {
        return result(["Plan Markdown must be a non-empty string."], [], [], {});
    }

    const parsed = parsePlanDocument(markdown);
    errors.push(...parsed.errors);
    errors.push(...validateMetadata(parsed.metadata));
    errors.push(...validateRequiredSections(parsed.body));
    errors.push(...validatePlaceholders(parsed.body));
    errors.push(...validateNamedBullets(parsed.body));
    errors.push(...validateLabeledSection(
        parsed.body,
        "Source assessment",
        REQUIRED_SOURCE_ASSESSMENT_FIELDS,
        "Source assessment",
        {forbidNone: true},
    ));
    errors.push(...validateLabeledSection(
        parsed.body,
        "Direction, simplicity and consistency",
        REQUIRED_DIRECTION_FIELDS,
        "Direction review",
        {forbidNone: true},
    ));

    const packages = extractPackages(parsed.body);
    if (packages.length === 0) {
        errors.push("Plan must contain at least one work package.");
    }
    const packageIds = new Set();
    for (const packageRecord of packages) {
        if (packageIds.has(packageRecord.id)) {
            errors.push(`Duplicate work package id: ${packageRecord.id}.`);
        }
        packageIds.add(packageRecord.id);
        errors.push(...validatePackage(packageRecord));
    }
    errors.push(...validatePackageDependencies(packages));
    errors.push(...validateSourceCoverage(parsed.body, packageIds));
    errors.push(...validateExecutionContract(parsed.body, packages));

    const questionResult = parseQuestions(parsed.body);
    errors.push(...questionResult.errors);

    if (options.verifyEvidence !== false) {
        errors.push(...validateEvidence(parsed.metadata, options));
    }

    return result(errors, packages, questionResult.questions, parsed.metadata, {
        contextBlocked: parsed.metadata.context_status === "BLOCKED",
    });
}

export function parsePlanDocument(markdown) {
    const errors = [];
    if (!markdown.startsWith("---\n")) {
        return {metadata: {}, body: markdown, errors: ["Plan must start with managed front matter."]};
    }
    const end = markdown.indexOf("\n---\n", 4);
    if (end < 0) {
        return {metadata: {}, body: markdown, errors: ["Plan front matter is not closed."]};
    }
    const metadata = {};
    for (const line of markdown.slice(4, end).split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        const separator = line.indexOf(":");
        if (separator < 1) {
            errors.push(`Invalid front matter line: ${line}.`);
            continue;
        }
        const key = line.slice(0, separator).trim();
        const raw = line.slice(separator + 1).trim();
        try {
            metadata[key] = JSON.parse(raw);
        } catch {
            metadata[key] = raw;
        }
    }
    return {metadata, body: markdown.slice(end + 5), errors};
}

export function extractPackages(body) {
    const matches = [...body.matchAll(/^###\s+(WP[1-9][0-9]*)\s+[—-]\s+(.+)$/gm)];
    return matches.map((match, index) => {
        const start = match.index;
        const nextPackage = matches[index + 1]?.index ?? body.length;
        const nextSection = body.indexOf("\n## ", start + 1);
        const end = nextSection >= 0 && nextSection < nextPackage ? nextSection : nextPackage;
        return {id: match[1], title: match[2].trim(), body: body.slice(start, end)};
    });
}

export function parseExecutionContract(body) {
    const environmentSection = extractSection(body, "Execution environment");
    const executionSection = extractSection(body, "Execution");
    const progressSection = extractSubsection(executionSection, "Progress");
    const logSection = extractSubsection(executionSection, "Execution log");
    const overrides = labeledBlock(environmentSection, "WP overrides");

    return {
        environment: {
            rankingSource: labeledValue(environmentSection, "Ranking source"),
            rankingUpdatedAt: labeledValue(environmentSection, "Ranking updated at"),
            assessedAt: labeledValue(environmentSection, "Assessed at"),
            allowedModelFamilies: labeledValue(environmentSection, "Allowed model families"),
            qwenPolicy: labeledValue(environmentSection, "Qwen policy"),
            projectFamilyOverride: labeledValue(environmentSection, "Project family override"),
            defaultModel: labeledValue(environmentSection, "Default model"),
            defaultReasoning: labeledValue(environmentSection, "Default reasoning"),
            escalationModel: labeledValue(environmentSection, "Escalation model"),
            escalationReasoning: labeledValue(environmentSection, "Escalation reasoning"),
            escalationTrigger: labeledValue(environmentSection, "Escalation trigger"),
            wpOverrides: overrides.value,
            wpOverrideEntries: overrides.nested,
        },
        execution: {
            status: labeledValue(executionSection, "Status"),
            nextWp: labeledValue(executionSection, "Next WP"),
            progressRows: parseProgressRows(progressSection),
            log: logSection.trim(),
        },
    };
}

export function validateExecutionContract(body, packages = extractPackages(body)) {
    const contract = parseExecutionContract(body);
    const errors = validateExecutionSections(body);
    errors.push(...validateExecutionEnvironment(contract.environment, packages));

    errors.push(...validateExecutionProgress(contract.execution, packages));

    return errors;
}

function validateExecutionSections(body) {
    return ["Execution environment", "Execution"]
        .filter((heading) => countExactHeading(body, "##", heading) !== 1)
        .map((heading) => `Plan must contain exactly one ## ${heading} section.`);
}

function validateExecutionEnvironment(environment, packages) {
    const errors = [];
    const requiredFields = [
        ["Ranking source", environment.rankingSource],
        ["Ranking updated at", environment.rankingUpdatedAt],
        ["Assessed at", environment.assessedAt],
        ["Allowed model families", environment.allowedModelFamilies],
        ["Qwen policy", environment.qwenPolicy],
        ["Default model", environment.defaultModel],
        ["Default reasoning", environment.defaultReasoning],
        ["WP overrides", environment.wpOverrides || environment.wpOverrideEntries.join("\n")],
    ];
    for (const [label, value] of requiredFields) {
        if (String(value ?? "").trim() === "") {
            errors.push(`Execution environment is missing non-empty field: ${label}.`);
        }
    }
    if (cleanCell(environment.rankingSource) !== "https://aicodingdaily.com/leaderboard") {
        errors.push("Execution environment Ranking source must be https://aicodingdaily.com/leaderboard.");
    }
    for (const [label, value] of [["Ranking updated at", environment.rankingUpdatedAt], ["Assessed at", environment.assessedAt]]) {
        if (!isIsoDate(cleanCell(value))) {
            errors.push(`Execution environment ${label} must use YYYY-MM-DD.`);
        }
    }
    const allowedFamilies = cleanCell(environment.allowedModelFamilies).toLowerCase().match(/[a-z][a-z0-9_-]*/g) ?? [];
    for (const family of ["openai", "deepseek", "tencent"]) {
        if (!allowedFamilies.includes(family)) {
            errors.push(`Execution environment Allowed model families must include ${family}.`);
        }
    }
    if (!cleanCell(environment.qwenPolicy).toLowerCase().includes("frontend-design")) {
        errors.push("Execution environment Qwen policy must limit Qwen to frontend-design work.");
    }
    validateConcreteEnvironmentValue(environment.defaultModel, "Default model", errors);
    validateReasoning(environment.defaultReasoning, "Default reasoning", errors);
    if (environment.projectFamilyOverride && !isNone(environment.projectFamilyOverride) && cleanCell(environment.projectFamilyOverride).length === 0) {
        errors.push("Execution environment Project family override must be non-empty when provided.");
    }
    if (environment.escalationModel || environment.escalationReasoning || environment.escalationTrigger) {
        validateConcreteEnvironmentValue(environment.escalationModel, "Escalation model", errors);
        validateReasoning(environment.escalationReasoning, "Escalation reasoning", errors);
        if (isNone(environment.escalationTrigger)) {
            errors.push("Execution environment Escalation trigger must be justified when escalation is declared.");
        }
    }
    validateOverrides(environment, packages, errors);
    return errors;
}

function validateExecutionProgress(execution, packages) {
    const errors = [];
    if (!EXECUTION_STATUSES.includes(cleanCell(execution.status))) {
        errors.push(`Execution Status must be one of: ${EXECUTION_STATUSES.join(", ")}.`);
    }
    if (String(execution.nextWp ?? "").trim() === "") {
        errors.push("Execution is missing non-empty field: Next WP.");
    } else if (cleanCell(execution.nextWp) !== "none" && !packages.some((packageRecord) => packageRecord.id === cleanCell(execution.nextWp))) {
        errors.push(`Execution Next WP references unknown package: ${cleanCell(execution.nextWp)}.`);
    }
    if (execution.progressRows.length === 0) {
        errors.push("Execution must contain a Progress table with at least one WP row.");
    }
    if (execution.log === "") {
        errors.push("Execution must contain a non-empty Execution log.");
    }

    const packageIds = packages.map((packageRecord) => packageRecord.id);
    const rowsById = new Map();
    for (const row of execution.progressRows) {
        if (row.error) {
            errors.push(row.error);
            continue;
        }
        if (rowsById.has(row.id)) {
            errors.push(`Execution Progress contains duplicate WP: ${row.id}.`);
        }
        rowsById.set(row.id, row);
        errors.push(...validateProgressRow(row, packageIds));
    }
    if (rowsById.size !== packageIds.length || packageIds.some((id) => !rowsById.has(id))) {
        errors.push("Execution Progress must reference every defined WP exactly once.");
    }
    errors.push(...validateExecutionStatus(execution, packageIds, rowsById));
    return errors;
}

function validateProgressRow(row, packageIds) {
    const errors = [];
    if (!packageIds.includes(row.id)) {
        errors.push(`Execution Progress references unknown package: ${row.id}.`);
    }
    if (!EXECUTION_WP_STATUSES.includes(row.status)) {
        errors.push(`Execution Progress ${row.id} has invalid status: ${row.status}.`);
    }
    if (row.status === "done") {
        if (isNone(row.completedAt)) {
            errors.push(`Execution Progress ${row.id} done status requires Completed at evidence.`);
        } else if (Number.isNaN(Date.parse(cleanCell(row.completedAt)))) {
            errors.push(`Execution Progress ${row.id} Completed at must be a valid date.`);
        }
        if (isNone(row.verification)) {
            errors.push(`Execution Progress ${row.id} done status requires Verification evidence.`);
        }
    } else if (!isNone(row.completedAt)) {
        errors.push(`Execution Progress ${row.id} must use Completed at: none until done.`);
    }
    return errors;
}

function validateExecutionStatus(execution, packageIds, rowsById) {
    const errors = [];
    const executionStatus = cleanCell(execution.status);
    const rowStatuses = [...rowsById.values()].map((row) => row.status);
    if (executionStatus === "not_started" && rowStatuses.some((status) => status !== "pending")) {
        errors.push("Execution not_started status requires every WP to be pending.");
    }
    if (executionStatus === "not_started" && packageIds.length > 0 && cleanCell(execution.nextWp) !== packageIds[0]) {
        errors.push("Execution not_started status must point Next WP to the first defined WP.");
    }
    if (executionStatus === "complete") {
        if (rowStatuses.some((status) => status !== "done")) {
            errors.push("Execution complete status requires every WP to be done.");
        }
        if (cleanCell(execution.nextWp) !== "none") {
            errors.push("Execution complete status requires Next WP: none.");
        }
    } else if (rowStatuses.length > 0 && rowStatuses.every((status) => status === "done")) {
        errors.push("Execution requires complete status when every WP is done.");
    }
    if (executionStatus === "in_progress" && rowStatuses.every((status) => status === "pending")) {
        errors.push("Execution in_progress status requires at least one non-pending WP.");
    }
    if (executionStatus === "blocked" && !rowStatuses.includes("blocked")) {
        errors.push("Execution blocked status requires at least one blocked WP.");
    }
    return errors;
}

function validateOverrides(environment, packages, errors) {
    const value = cleanCell(environment.wpOverrides);
    if (isNone(value)) {
        if (environment.wpOverrideEntries.length > 0) {
            errors.push("Execution environment WP overrides cannot list entries after declaring none.");
        }
        return;
    }
    if (environment.wpOverrideEntries.length === 0) {
        errors.push("Execution environment WP overrides must list each override with a justification.");
        return;
    }
    const packageIds = new Set(packages.map((packageRecord) => packageRecord.id));
    const seen = new Set();
    for (const line of environment.wpOverrideEntries) {
        const match = line.trim().match(/^[-*]\s+(WP[1-9][0-9]*):\s*model=([^;]+);\s*reasoning=([^;]+);\s*justification=(.+)$/i);
        if (!match) {
            errors.push(`Invalid WP override: ${line.trim()}.`);
            continue;
        }
        const [, id, model, reasoning, justification] = match;
        if (!packageIds.has(id)) {
            errors.push(`Execution environment WP override references unknown package: ${id}.`);
        }
        if (seen.has(id)) {
            errors.push(`Execution environment contains duplicate WP override: ${id}.`);
        }
        seen.add(id);
        validateConcreteEnvironmentValue(model, `${id} override model`, errors);
        validateReasoning(reasoning, `${id} override reasoning`, errors);
        if (isNone(justification)) {
            errors.push(`${id} override requires a non-empty justification.`);
        }
    }
}

function validateConcreteEnvironmentValue(value, label, errors) {
    const cleaned = cleanCell(value);
    if (!CONCRETE_MODEL_PATTERN.test(cleaned)) {
        errors.push(`Execution environment ${label} must be a concrete provider/model identifier.`);
    }
}

function validateReasoning(value, label, errors) {
    const cleaned = cleanCell(value).toLowerCase();
    if (cleaned === "" || cleaned === "none" || cleaned === "unknown" || cleaned === "unspecified") {
        errors.push(`Execution environment ${label} must be a concrete reasoning level.`);
    }
}

function parseProgressRows(section) {
    const rows = [];
    const tableLines = section.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
    if (tableLines.length === 0) {
        return rows;
    }
    const header = splitTableRow(tableLines[0]);
    const expectedHeader = ["WP", "Status", "Completed at", "Verification"];
    if (header.join("\u0000") !== expectedHeader.join("\u0000")) {
        rows.push({error: "Execution Progress table must use columns: WP, Status, Completed at, Verification."});
    }
    for (const line of tableLines.slice(1)) {
        const cells = splitTableRow(line);
        if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
            continue;
        }
        if (cells.length !== 4 || !/^WP[1-9][0-9]*$/.test(cells[0])) {
            rows.push({error: `Invalid Execution Progress row: ${line.trim()}.`});
            continue;
        }
        rows.push({
            id: cells[0],
            status: cells[1],
            completedAt: cells[2],
            verification: cells[3],
        });
    }
    return rows;
}

function splitTableRow(line) {
    const trimmed = line.trim();
    const cells = trimmed.endsWith("|") ? trimmed.split("|").slice(1, -1) : trimmed.split("|").slice(1);
    return cells.map((cell) => cleanCell(cell));
}

function labeledBlock(section, label) {
    const lines = section.split(/\r?\n/);
    const start = lines.findIndex((line) => new RegExp(`^\\s*-\\s+${escapeRegex(label)}:\\s*`).test(line));
    if (start < 0) {
        return {value: "", nested: []};
    }
    const valueMatch = lines[start].match(new RegExp(`^\\s*-\\s+${escapeRegex(label)}:\\s*(.*)$`));
    const nested = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (/^\s*$/.test(line)) {
            continue;
        }
        if (/^\s+-\s+/.test(line)) {
            nested.push(line.trim());
            continue;
        }
        break;
    }
    return {value: valueMatch?.[1]?.trim() ?? "", nested};
}

function cleanCell(value) {
    return String(value ?? "").trim().replace(/^`(.*)`$/, "$1").trim();
}

function isIsoDate(value) {
    if (!DATE_PATTERN.test(value)) {
        return false;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${value}T`);
}

function countExactHeading(body, marker, heading) {
    return [...body.matchAll(new RegExp(`^${escapeRegex(marker)} ${escapeRegex(heading)}\\s*$`, "gm"))].length;
}

export function parseQuestions(body) {
    const section = extractSection(body, "Decisions and open questions");
    const lines = section.split("\n");
    const questions = [];
    const errors = [];
    const ids = new Set();
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!/^\s*-\s+Q[1-9][0-9]*/.test(line)) {
            continue;
        }
        const match = line.match(/^\s*-\s+(Q[1-9][0-9]*)\s+\[(open|answered)]\s*:\s*(.+)$/);
        if (!match) {
            errors.push(`Invalid question entry: ${line.trim()}.`);
            continue;
        }
        const [, id, status, prompt] = match;
        if (ids.has(id)) {
            errors.push(`Duplicate question id: ${id}.`);
            continue;
        }
        ids.add(id);
        const question = {id, status, prompt: prompt.trim()};
        if (status === "answered") {
            const block = [];
            for (let nested = index + 1; nested < lines.length && !/^\s*-\s+Q[1-9][0-9]*/.test(lines[nested]); nested += 1) {
                block.push(lines[nested]);
            }
            question.answer = labeledValue(block, "Answer");
            question.source = labeledValue(block, "Source");
            if (!question.answer) {
                errors.push(`${id} answered question requires Answer.`);
            }
            if (question.source !== "current conversation") {
                errors.push(`${id} answered question requires Source: current conversation.`);
            }
        }
        questions.push(question);
    }
    return {questions, errors};
}

function result(errors, packages, questions, metadata, options = {}) {
    const uniqueErrors = [...new Set(errors)];
    const status = uniqueErrors.length > 0
        ? "invalid"
        : options.contextBlocked || questions.some((question) => question.status === "open") ? "blocked" : "ready";
    return {valid: uniqueErrors.length === 0, status, errors: uniqueErrors, metadata, packages, questions};
}

function validateMetadata(metadata) {
    const errors = [];
    const contextPairs = [
        ["context_report", "context_report_sha256"],
        ["context_criteria", "context_criteria_sha256"],
    ];
    for (const field of ["plan_id", "source_identity", "source_artifact", "source_sha256", "updated_at"]) {
        if (typeof metadata[field] !== "string" || metadata[field].trim() === "") {
            errors.push(`Front matter ${field} must be a non-empty string.`);
        }
    }
    if (!String(metadata.plan_id ?? "").startsWith("v2-")) {
        errors.push("Front matter plan_id must identify a v2 plan.");
    }
    if (!Number.isInteger(metadata.revision) || metadata.revision < 1) {
        errors.push("Front matter revision must be a positive integer.");
    }
    if (!/^[a-f0-9]{64}$/.test(metadata.source_sha256 ?? "")) {
        errors.push("Front matter source_sha256 must be a lowercase SHA-256 hash.");
    }
    if (typeof metadata.updated_at === "string" && Number.isNaN(Date.parse(metadata.updated_at))) {
        errors.push("Front matter updated_at must be a valid timestamp.");
    }
    if (!CONTEXT_STATUSES.includes(metadata.context_status)) {
        errors.push(`Front matter context_status must be one of: ${CONTEXT_STATUSES.join(", ")}.`);
    }
    for (const field of FORBIDDEN_METADATA) {
        if (Object.hasOwn(metadata, field)) {
            errors.push(`Front matter must not contain sidecar-era field: ${field}.`);
        }
    }
    if (metadata.context_status === "COMPLETE") {
        for (const field of ["context_report", "context_report_sha256", "context_criteria", "context_criteria_sha256"]) {
            if (typeof metadata[field] !== "string" || metadata[field].trim() === "") {
                errors.push(`COMPLETE context requires front matter ${field}.`);
            }
        }
    }
    if (metadata.context_status === "NOT_REQUIRED") {
        for (const [pathField, hashField] of contextPairs) {
            if (metadata[pathField] !== null || metadata[hashField] !== null) {
                errors.push(`NOT_REQUIRED context must not reference ${pathField}.`);
            }
        }
    }
    for (const [pathField, hashField] of contextPairs) {
        const hasPath = typeof metadata[pathField] === "string" && metadata[pathField].trim() !== "";
        const hasHash = typeof metadata[hashField] === "string" && metadata[hashField].trim() !== "";
        if (hasPath !== hasHash) {
            errors.push(`Front matter ${pathField} and ${hashField} must be provided together.`);
        }
        if (hasHash && !/^[a-f0-9]{64}$/.test(metadata[hashField])) {
            errors.push(`Front matter ${hashField} must be a lowercase SHA-256 hash.`);
        }
    }
    return errors;
}

function validateEvidence(metadata, options) {
    const errors = [];
    const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : null;
    if (!repoRoot) {
        return ["Evidence validation requires repoRoot."];
    }
    const fsOps = options.fsOps ?? fs;
    errors.push(...verifyFile(metadata.source_artifact, metadata.source_sha256, repoRoot, fsOps, "source artifact"));
    errors.push(...verifyFile(metadata.context_report, metadata.context_report_sha256, repoRoot, fsOps, "context report"));
    errors.push(...verifyFile(metadata.context_criteria, metadata.context_criteria_sha256, repoRoot, fsOps, "context criteria"));
    return errors;
}

function verifyFile(relativePath, expectedHash, repoRoot, fsOps, label) {
    if (typeof relativePath !== "string" || typeof expectedHash !== "string") {
        return [];
    }
    const absolute = resolveInside(repoRoot, relativePath);
    if (!absolute) {
        return [`${label} path escapes repository root.`];
    }
    if (!fsOps.existsSync(absolute)) {
        return [`${label} does not exist: ${relativePath}.`];
    }
    const actual = sha256(fsOps.readFileSync(absolute));
    return actual === expectedHash ? [] : [`${label} hash does not match: ${relativePath}.`];
}

function validateRequiredSections(body) {
    return REQUIRED_SECTIONS
        .filter((section) => !new RegExp(`^## ${escapeRegex(section)}\\s*$`, "m").test(body))
        .map((section) => `Missing section: ## ${section}.`);
}

function validatePlaceholders(body) {
    return PLACEHOLDER_PATTERNS
        .filter((pattern) => pattern.test(body))
        .map((pattern) => `Plan contains placeholder matching ${pattern}.`);
}

function validateNamedBullets(body) {
    const errors = [];
    const lines = body.split("\n");
    let fence = null;

    for (const line of lines) {
        if (fence !== null) {
            if (new RegExp(`^\\s*${fence.character}{${fence.length},}\\s*$`).test(line)) {
                fence = null;
            }
            continue;
        }

        const opening = line.match(/^\s*(`{3,}|~{3,})/);
        if (opening) {
            fence = {character: opening[1][0], length: opening[1].length};
            continue;
        }

        if (/^\s*-\s+/.test(line) && !/^\s*-\s+\S(?:[^:\r\n]*\S)?: /.test(line)) {
            errors.push(`Bullet must have a name followed by ": ": ${line.trim()}.`);
        }
    }

    if (fence !== null) {
        errors.push("Plan contains an unclosed fenced code block.");
    }
    return errors;
}

function validatePackage(packageRecord) {
    const errors = [];
    const values = new Map();
    for (const field of REQUIRED_PACKAGE_FIELDS) {
        const match = packageRecord.body.match(new RegExp(`^\\s*-\\s+${escapeRegex(field)}:\\s*(.*)$`, "m"));
        if (!match || match[1].trim() === "") {
            errors.push(`${packageRecord.id} is missing non-empty field: ${field}.`);
            continue;
        }
        const value = match[1].trim();
        values.set(field, value);
        if (ESSENTIAL_PACKAGE_FIELDS.has(field) && isNone(value)) {
            errors.push(`${packageRecord.id} essential field ${field} cannot be none.`);
        }
    }
    if (isNone(values.get("Confirmed paths")) && isNone(values.get("Discovery required"))) {
        errors.push(`${packageRecord.id} requires confirmed paths or concrete discovery required.`);
    }
    if (!new Set(["small", "medium", "large"]).has(cleanCell(values.get("Estimated size")).toLowerCase())) {
        errors.push(`${packageRecord.id} Estimated size must be small, medium or large.`);
    }
    return errors;
}

function validatePackageDependencies(packages) {
    const errors = [];
    const packageIds = new Set(packages.map((packageRecord) => packageRecord.id));
    const dependenciesById = new Map();

    for (const packageRecord of packages) {
        const dependencies = packageDependencies(packageRecord);
        dependenciesById.set(packageRecord.id, dependencies.filter((dependency) => packageIds.has(dependency) && dependency !== packageRecord.id));
        for (const dependency of dependencies) {
            if (!packageIds.has(dependency)) {
                errors.push(`${packageRecord.id} dependency references unknown package: ${dependency}.`);
            } else if (dependency === packageRecord.id) {
                errors.push(`${packageRecord.id} cannot depend on itself.`);
            }
        }
    }

    const visiting = new Set();
    const visited = new Set();
    const hasCycle = (id) => {
        if (visiting.has(id)) {
            return true;
        }
        if (visited.has(id)) {
            return false;
        }
        visiting.add(id);
        const cyclic = (dependenciesById.get(id) ?? []).some(hasCycle);
        visiting.delete(id);
        visited.add(id);
        return cyclic;
    };
    if (packages.some((packageRecord) => hasCycle(packageRecord.id))) {
        errors.push("Work package dependencies must not contain a cycle.");
    }
    return errors;
}

function packageDependencies(packageRecord) {
    const value = packageRecord.body.match(/^\s*-\s+Dependencies:\s*(.*)$/m)?.[1] ?? "";
    return [...new Set(value.match(/\bWP[1-9][0-9]*\b/g) ?? [])];
}

function validateLabeledSection(body, heading, fields, label, options = {}) {
    const errors = [];
    const section = extractSection(body, heading);
    for (const field of fields) {
        const match = section.match(new RegExp(`^\\s*-\\s+${escapeRegex(field)}:\\s*(.*)$`, "m"));
        if (!match || match[1].trim() === "") {
            errors.push(`${label} is missing non-empty field: ${field}.`);
        } else if (options.forbidNone && isNone(match[1])) {
            errors.push(`${label} field ${field} cannot be none.`);
        }
    }
    return errors;
}

function validateSourceCoverage(body, packageIds) {
    const errors = [];
    const section = extractSection(body, "Source coverage");
    const mappings = section.split("\n").filter((line) => /^\s*-\s+/.test(line));
    if (mappings.length === 0) {
        return ["Source coverage must contain at least one bullet mapping."];
    }
    for (const line of mappings) {
        const ids = [...line.matchAll(/\bWP[1-9][0-9]*\b/g)].map((match) => match[0]);
        const excluded = /(?:→|->)\s*excluded\s*:/i.test(line);
        if (ids.length === 0 && !excluded) {
            errors.push(`Source coverage entry must map to a WP or excluded reason: ${line.trim()}.`);
        }
        for (const id of ids) {
            if (!packageIds.has(id)) {
                errors.push(`Source coverage references unknown package ${id}.`);
            }
        }
    }
    return errors;
}

function extractSection(body, heading) {
    const startMatch = new RegExp(`^## ${escapeRegex(heading)}\\s*$`, "m").exec(body);
    if (!startMatch) {
        return "";
    }
    const start = startMatch.index + startMatch[0].length;
    const end = body.indexOf("\n## ", start);
    return body.slice(start, end >= 0 ? end : body.length);
}

function extractSubsection(section, heading) {
    const startMatch = new RegExp(`^### ${escapeRegex(heading)}\\s*$`, "m").exec(section);
    if (!startMatch) {
        return "";
    }
    const start = startMatch.index + startMatch[0].length;
    const end = section.indexOf("\n### ", start);
    return section.slice(start, end >= 0 ? end : section.length);
}

function labeledValue(lines, label) {
    const content = Array.isArray(lines) ? lines.join("\n") : String(lines ?? "");
    const match = content.match(new RegExp(`^\\s*-\\s+${escapeRegex(label)}:\\s*(.*)$`, "m"));
    return match?.[1]?.trim() ?? "";
}

function isNone(value) {
    return typeof value !== "string" || /^(?:none|n\/a|not applicable)$/i.test(value.trim());
}

function resolveInside(root, candidate) {
    const absolute = path.resolve(root, candidate);
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return null;
    }
    return absolute;
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
    const parsed = {_: []};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            parsed._.push(token);
            continue;
        }
        const key = token.slice(2).replaceAll("-", "_");
        const next = argv[index + 1];
        if (typeof next === "undefined" || next.startsWith("--")) {
            parsed[key] = true;
        } else {
            parsed[key] = next;
            index += 1;
        }
    }
    return parsed;
}

async function main(argv) {
    const args = parseArgs(argv);
    if (args._[0] !== "validate" || !args.file) {
        throw new ValidationError("INVALID_ARGUMENT", "Usage: validate.mjs validate --file <plan.md> --root <repo>");
    }
    const markdown = fs.readFileSync(path.resolve(args.file), "utf8");
    const validation = validatePlanDocument(markdown, {repoRoot: args.root ?? process.cwd()});
    process.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
    if (!validation.valid) {
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "VALIDATION_ERROR", message: error.message, details: error.details ?? {}})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}
