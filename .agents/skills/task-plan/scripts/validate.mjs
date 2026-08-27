#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {hasModelProfile, loadModelHierarchy} from "../../_shared/scripts/model-hierarchy.mjs";

export const PLAN_RESULTS = Object.freeze(["invalid", "blocked", "ready"]);

export const REQUIRED_SECTIONS = Object.freeze([
    "Source and objective",
    "Source assessment",
    "Scope",
    "Direction, simplicity and consistency",
    "Source coverage",
    "Work packages",
    "Order",
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
    "Estimated size",
    "Acceptance criteria",
    "Verification",
]);

const ESSENTIAL_PACKAGE_FIELDS = new Set(["Source", "Goal", "Scope", "Estimated size", "Acceptance criteria", "Verification"]);
const CONCRETE_MODEL_PATTERN = /^[^/\s]+\/[^/\s]+$/;

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
    errors.push(...validateSourceCoverage(parsed.body, packageIds));
    errors.push(...validateExecutionEnvironment(parsed.body, packages, options));
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
    const executionSection = extractSection(body, "Execution");
    const items = [];
    const errors = [];

    for (const line of executionSection.split(/\r?\n/)) {
        if (line.trim() === "") {
            continue;
        }
        const pending = line.match(/^\s*-\s+\[ \]\s+(WP[1-9][0-9]*)\s*$/);
        if (pending) {
            items.push({id: pending[1], completed: false, completedAt: null, verification: null});
            continue;
        }
        const completed = line.match(/^\s*-\s+\[[xX]\]\s+(WP[1-9][0-9]*)\s+—\s+(\d{4}-\d{2}-\d{2})\s+—\s+(.+?)\s*$/);
        if (completed && isIsoDate(completed[2])) {
            items.push({id: completed[1], completed: true, completedAt: completed[2], verification: completed[3]});
            continue;
        }
        errors.push(`Invalid Execution entry: ${line.trim()}.`);
    }

    return {items, errors};
}

export function parseExecutionEnvironment(body) {
    const section = extractSection(body, "Execution environment");
    const overrides = labeledBlock(section, "WP overrides");
    const parsedOverrides = [];
    const errors = [];

    for (const line of overrides.nested) {
        const match = line.match(/^[-*]\s+(WP[1-9][0-9]*):\s*model=([^;]+);\s*reasoning=([^;]+);\s*justification=(.+)$/i);
        if (!match) {
            errors.push(`Invalid WP override: ${line}.`);
            continue;
        }
        parsedOverrides.push({
            id: match[1],
            model: match[2].trim(),
            reasoning: match[3].trim(),
            justification: match[4].trim(),
        });
    }

    return {
        defaultModel: labeledValue(section, "Default model"),
        defaultReasoning: labeledValue(section, "Default reasoning"),
        wpOverrides: overrides.value,
        overrides: parsedOverrides,
        errors,
    };
}

export function validateExecutionEnvironment(body, packages = extractPackages(body), options = {}) {
    const environment = parseExecutionEnvironment(body);
    const errors = [...environment.errors];
    if (!CONCRETE_MODEL_PATTERN.test(environment.defaultModel)) {
        errors.push("Execution environment Default model must be a concrete provider/model identifier.");
    }
    if (!isConcreteValue(environment.defaultReasoning)) {
        errors.push("Execution environment Default reasoning must be concrete.");
    }

    const packageIds = new Set(packages.map((packageRecord) => packageRecord.id));
    const seen = new Set();
    if (isNone(environment.wpOverrides)) {
        if (environment.overrides.length > 0) {
            errors.push("Execution environment cannot list WP overrides after declaring none.");
        }
    } else if (environment.overrides.length === 0) {
        errors.push("Execution environment WP overrides must be none or a justified list.");
    }
    for (const override of environment.overrides) {
        if (!packageIds.has(override.id)) {
            errors.push(`Execution environment WP override references unknown package: ${override.id}.`);
        }
        if (seen.has(override.id)) {
            errors.push(`Execution environment contains duplicate WP override: ${override.id}.`);
        }
        seen.add(override.id);
        if (!CONCRETE_MODEL_PATTERN.test(override.model)) {
            errors.push(`Execution environment ${override.id} model must be a concrete provider/model identifier.`);
        }
        if (!isConcreteValue(override.reasoning)) {
            errors.push(`Execution environment ${override.id} reasoning must be concrete.`);
        }
        if (!isConcreteValue(override.justification)) {
            errors.push(`Execution environment ${override.id} override requires a concrete justification.`);
        }
    }

    let hierarchy;
    try {
        hierarchy = loadModelHierarchy({repoRoot: options.repoRoot ?? process.cwd(), fsOps: options.fsOps ?? fs});
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
        return errors;
    }
    if (CONCRETE_MODEL_PATTERN.test(environment.defaultModel)
        && isConcreteValue(environment.defaultReasoning)
        && !hasModelProfile(hierarchy, {model: environment.defaultModel, reasoning: environment.defaultReasoning})) {
        errors.push("Execution environment default model/reasoning profile is not present in the project hierarchy.");
    }
    for (const override of environment.overrides) {
        if (CONCRETE_MODEL_PATTERN.test(override.model)
            && isConcreteValue(override.reasoning)
            && !hasModelProfile(hierarchy, override)) {
            errors.push(`Execution environment ${override.id} model/reasoning profile is not present in the project hierarchy.`);
        }
    }
    return errors;
}

export function validateExecutionContract(body, packages = extractPackages(body)) {
    const contract = parseExecutionContract(body);
    const errors = [...contract.errors];
    if ([...body.matchAll(/^## Execution\s*$/gm)].length !== 1) {
        errors.push("Plan must contain exactly one ## Execution section.");
    }

    const packageIds = packages.map((packageRecord) => packageRecord.id);
    const itemIds = contract.items.map((item) => item.id);
    if (new Set(itemIds).size !== itemIds.length) {
        errors.push("Execution contains duplicate work-package entries.");
    }
    if (itemIds.join("\u0000") !== packageIds.join("\u0000")) {
        errors.push("Execution must reference every work package exactly once and in document order.");
    }

    let pendingSeen = false;
    for (const item of contract.items) {
        if (!item.completed) {
            pendingSeen = true;
            continue;
        }
        if (isNone(item.verification)) {
            errors.push(`Execution ${item.id} requires concrete verification evidence.`);
        }
        if (pendingSeen) {
            errors.push("Execution work packages must be completed in document order.");
        }
    }
    return errors;
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
    if (!new Set(["small", "medium", "large"]).has(String(values.get("Estimated size") ?? "").trim().toLowerCase())) {
        errors.push(`${packageRecord.id} Estimated size must be small, medium or large.`);
    }
    return errors;
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



function labeledBlock(section, label) {
    const lines = section.split(/\r?\n/);
    const start = lines.findIndex((line) => new RegExp(`^\\s*-\\s+${escapeRegex(label)}:\\s*`).test(line));
    if (start < 0) {
        return {value: "", nested: []};
    }
    const value = lines[start].match(new RegExp(`^\\s*-\\s+${escapeRegex(label)}:\\s*(.*)$`))?.[1]?.trim() ?? "";
    const nested = [];
    for (let index = start + 1; index < lines.length; index += 1) {
        if (lines[index].trim() === "") {
            continue;
        }
        if (/^\s+-\s+/.test(lines[index])) {
            nested.push(lines[index].trim());
            continue;
        }
        break;
    }
    return {value, nested};
}

function labeledValue(lines, label) {
    const content = Array.isArray(lines) ? lines.join("\n") : String(lines ?? "");
    const match = content.match(new RegExp(`^\\s*-\\s+${escapeRegex(label)}:\\s*(.*)$`, "m"));
    return match?.[1]?.trim() ?? "";
}

function isNone(value) {
    return typeof value !== "string" || /^(?:none|n\/a|not applicable)$/i.test(value.trim());
}

function isConcreteValue(value) {
    return typeof value === "string"
        && value.trim() !== ""
        && !/^(?:none|n\/a|not applicable|unknown|unspecified)$/i.test(value.trim());
}

function isIsoDate(value) {
    const date = new Date(`${value}T00:00:00.000Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value)
        && !Number.isNaN(date.getTime())
        && date.toISOString().startsWith(`${value}T`);
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
