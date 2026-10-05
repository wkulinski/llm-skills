#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {isMainModule} from "../is-main-module.mjs";
import {hasModelProfile, loadModelHierarchy} from "../model-hierarchy.mjs";

export const PLAN_RESULTS = Object.freeze(["invalid", "blocked", "ready"]);

export const REQUIRED_SECTIONS = Object.freeze([
    "Execution",
    "Work package summaries",
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
    errors.push(...validateSourceCoverage(parsed.body, packageIds));
    errors.push(...validateExecutionEnvironment(parsed.body, packages, options));
    errors.push(...validateExecutionContract(parsed.body, packages));
    errors.push(...validateWorkPackageSummaries(parsed.body, packages));

    const questionResult = parseQuestions(parsed.body);
    errors.push(...questionResult.errors);

    if (options.verifyEvidence !== false) {
        errors.push(...validateEvidence(parsed.metadata, options));
    }

    return result(errors, packages, questionResult.questions, parsed.metadata, {
        contextBlocked: ["INCOMPLETE", "BLOCKED"].includes(parsed.metadata.context_status),
        reviewPending: isReviewPending(parsed.metadata, parsed.body),
    });
}

/**
 * Hash the plan body that a review decision covers.
 *
 * The `## Execution` checklist is excluded so that completing work packages
 * does not withdraw a recorded review.
 */
export function reviewBodyHash(body) {
    const section = realSection(body, /^## Execution[ \t]*$/gm);
    let reviewed = body;
    if (section) {
        reviewed = `${body.slice(0, section.headingStart)}${section.end < body.length ? body.slice(section.end + 1) : ""}`;
    }
    return sha256(reviewed.trim());
}

/**
 * Offset ranges of fenced code blocks (backticks or tildes), using the same
 * fence rules as `validateNamedBullets`. An unclosed fence runs to the end.
 *
 * @param {string} text
 * @returns {{start: number, end: number}[]}
 */
function fencedRanges(text) {
    const ranges = [];
    let offset = 0;
    let open = null;
    for (const line of text.split("\n")) {
        if (open === null) {
            const opening = line.match(/^\s*(`{3,}|~{3,})/);
            if (opening) {
                open = {start: offset, character: opening[1][0], length: opening[1].length};
            }
        } else if (new RegExp(`^\\s*${open.character}{${open.length},}\\s*$`).test(line)) {
            ranges.push({start: open.start, end: offset + line.length});
            open = null;
        }
        offset += line.length + 1;
    }
    if (open !== null) {
        ranges.push({start: open.start, end: text.length});
    }
    return ranges;
}

function isFenced(ranges, offset) {
    return ranges.some((range) => offset >= range.start && offset < range.end);
}

/**
 * Matches of a global, multiline pattern that start on a line outside any
 * fenced code block. Example headings in code blocks are not real headings.
 *
 * @param {string} text
 * @param {RegExp} pattern
 * @returns {RegExpMatchArray[]}
 */
export function realMatches(text, pattern) {
    const ranges = fencedRanges(text);
    return [...text.matchAll(pattern)].filter((match) => !isFenced(ranges, match.index));
}

/**
 * First real `## ` section whose heading matches `headingPattern` (global,
 * multiline). `start` follows the heading match, `end` is the newline before
 * the next real `## ` heading, or the text length.
 *
 * @param {string} text
 * @param {RegExp} headingPattern
 * @returns {{headingStart: number, start: number, end: number}|null}
 */
export function realSection(text, headingPattern) {
    const match = realMatches(text, headingPattern)[0];
    if (!match) {
        return null;
    }
    const start = match.index + match[0].length;
    return {headingStart: match.index, start, end: nextRealSectionBreak(text, start)};
}

/**
 * Index of the newline that precedes the next real `## ` heading at or after
 * `from`, or the text length when there is none.
 *
 * @param {string} text
 * @param {number} from
 * @returns {number}
 */
export function nextRealSectionBreak(text, from) {
    const ranges = fencedRanges(text);
    for (let index = text.indexOf("\n## ", from); index >= 0; index = text.indexOf("\n## ", index + 1)) {
        if (!isFenced(ranges, index + 1)) {
            return index;
        }
    }
    return text.length;
}

/**
 * A plan is ready only while the recorded review matches its current revision
 * and body. A plan without review keys has no recorded review, so it stays
 * readable but is review-pending until `record-review` confirms it.
 */
function isReviewPending(metadata, body) {
    return metadata.reviewed_revision !== metadata.revision
        || metadata.reviewed_body_sha256 !== reviewBodyHash(body);
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
    const section = realSection(body, /^## Work packages\s*$/gm);
    if (!section) {
        return [];
    }
    const matches = realMatches(body, /^###\s+(WP[1-9][0-9]*)\s+[—-]\s+(.+)$/gm)
        .filter((match) => match.index >= section.start && match.index < section.end);
    return matches.map((match, index) => {
        const start = match.index;
        const end = matches[index + 1]?.index ?? section.end;
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

/**
 * Parse `## Work package summaries`: one `- WP<number> — <title>: <summary>`
 * entry per work package; indented continuation lines extend the previous entry.
 */
export function parseWorkPackageSummaries(body, packages = extractPackages(body)) {
    const section = extractSection(body, "Work package summaries");
    const items = [];
    const errors = [];
    const titles = new Map(packages.map((packageRecord) => [packageRecord.id, packageRecord.title]));

    for (const line of section.split(/\r?\n/)) {
        if (line.trim() === "") {
            continue;
        }
        const entry = line.match(/^-\s+(WP[1-9][0-9]*)\s+[—-]\s+(.+?)\s*$/);
        if (entry) {
            const [, id, titleAndSummary] = entry;
            const expectedTitle = titles.get(id);
            const expectedPrefix = expectedTitle === undefined ? null : `${expectedTitle}: `;
            if (expectedPrefix !== null && titleAndSummary.startsWith(expectedPrefix)) {
                items.push({id, title: expectedTitle, summary: titleAndSummary.slice(expectedPrefix.length).trim()});
                continue;
            }

            const summarySeparator = titleAndSummary.indexOf(": ");
            if (summarySeparator >= 0) {
                items.push({
                    id,
                    title: titleAndSummary.slice(0, summarySeparator),
                    summary: titleAndSummary.slice(summarySeparator + 2).trim(),
                });
                continue;
            }

            errors.push(`Invalid Work package summaries entry: ${line.trim()}.`);
            continue;
        }
        if (/^\s+\S/.test(line) && items.length > 0) {
            items[items.length - 1].summary += ` ${line.trim()}`;
            continue;
        }
        errors.push(`Invalid Work package summaries entry: ${line.trim()}.`);
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
    if (!isConcreteValue(environment.defaultModel)) {
        errors.push("Execution environment Default model must be concrete.");
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
        if (!isConcreteValue(override.model)) {
            errors.push(`Execution environment ${override.id} model must be concrete.`);
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
    if (isConcreteValue(environment.defaultModel)
        && isConcreteValue(environment.defaultReasoning)
        && !hasModelProfile(hierarchy, {model: environment.defaultModel, reasoning: environment.defaultReasoning})) {
        errors.push("Execution environment default model/reasoning profile is not present in the project hierarchy.");
    }
    for (const override of environment.overrides) {
        if (isConcreteValue(override.model)
            && isConcreteValue(override.reasoning)
            && !hasModelProfile(hierarchy, override)) {
            errors.push(`Execution environment ${override.id} model/reasoning profile is not present in the project hierarchy.`);
        }
    }
    return errors;
}

export function validateWorkPackageSummaries(body, packages = extractPackages(body)) {
    const sectionCount = realMatches(body, /^## Work package summaries\s*$/gm).length;
    if (sectionCount === 0) {
        // validateRequiredSections already reports the missing section.
        return [];
    }
    const summaries = parseWorkPackageSummaries(body, packages);
    const errors = [...summaries.errors];
    if (sectionCount > 1) {
        errors.push("Plan must contain exactly one ## Work package summaries section.");
    }
    const packageIds = packages.map((packageRecord) => packageRecord.id);
    const itemIds = summaries.items.map((item) => item.id);
    if (itemIds.join("\u0000") !== packageIds.join("\u0000")) {
        errors.push("Work package summaries must reference every work package exactly once and in document order.");
    }
    const titles = new Map(packages.map((packageRecord) => [packageRecord.id, packageRecord.title]));
    for (const item of summaries.items) {
        if (titles.has(item.id) && titles.get(item.id) !== item.title) {
            errors.push(`Work package summary for ${item.id} must use the work package title: ${titles.get(item.id)}.`);
        }
        if (isNone(item.summary)) {
            errors.push(`Work package summary for ${item.id} must be concrete.`);
        }
    }
    return errors;
}

export function validateExecutionContract(body, packages = extractPackages(body)) {
    const contract = parseExecutionContract(body);
    const errors = [...contract.errors];
    if (realMatches(body, /^## Execution\s*$/gm).length !== 1) {
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





























const QUESTION_FIELD = /^ {2}-\s+(Answer|Source):(.*)$/;

/**
 * Parse the `Decisions and open questions` section.
 *
 * `questions` and `errors` keep the question contract used by validation.
 * `entries` lists every decision entry in document order: `D<number>`
 * decisions, `Q<number> [answered|open]` questions with their answer and source,
 * and `N<number> [note]` product notes.
 */
export function parseQuestions(body) {
    const section = extractSection(body, "Decisions and open questions");
    const lines = section.split("\n");
    const questions = [];
    const entries = [];
    const errors = [];
    const ids = new Set();
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const decision = line.match(/^\s*-\s+(D[1-9][0-9]*)\s*:\s*(.+)$/);
        if (decision) {
            entries.push({id: decision[1], type: "decision", text: entryText(decision[2], entryContinuation(lines, index), "  ")});
            continue;
        }
        const note = line.match(/^\s*-\s+(N[1-9][0-9]*)\s+\[note]\s*:\s*(.+)$/);
        if (note) {
            entries.push({id: note[1], type: "note", text: entryText(note[2], entryContinuation(lines, index), "  ")});
            continue;
        }
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
        const block = entryContinuation(lines, index);
        const firstField = block.findIndex((nested) => QUESTION_FIELD.test(nested));
        const question = {id, status, prompt: entryText(prompt, firstField < 0 ? block : block.slice(0, firstField), "  ")};
        if (status === "answered") {
            const fields = questionFields(block);
            question.answer = fields.Answer ? entryText(fields.Answer.first, fields.Answer.continuation, "    ") : "";
            question.source = fields.Source?.first.trim() ?? "";
            if (!question.answer) {
                errors.push(`${id} answered question requires Answer.`);
            }
            if (question.source !== "current conversation") {
                errors.push(`${id} answered question requires Source: current conversation.`);
            }
        }
        questions.push(question);
        entries.push({
            id,
            type: "question",
            status,
            text: question.prompt,
            ...(status === "answered" ? {answer: question.answer, source: question.source} : {}),
        });
    }
    return {questions, entries, errors};
}

/**
 * Indented continuation of the entry at `index`: the following lines up to the
 * first non-indented, non-blank line.
 */
function entryContinuation(lines, index) {
    const block = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (lines[cursor].trim() !== "" && !/^\s/.test(lines[cursor])) {
            break;
        }
        block.push(lines[cursor]);
    }
    return block;
}

/** First `Answer` and `Source` fields of a question block with their continuation lines. */
function questionFields(block) {
    const fields = {};
    let current = null;
    for (const line of block) {
        const field = line.match(QUESTION_FIELD);
        if (field) {
            current = {first: field[2], continuation: []};
            fields[field[1]] ??= current;
            continue;
        }
        current?.continuation.push(line);
    }
    return fields;
}

/** Entry text with continuation lines, keeping their indentation relative to `indentation`. */
function entryText(first, continuation, indentation) {
    const rest = continuation.map((line) => (line.startsWith(indentation) ? line.slice(indentation.length) : line.trim()).trimEnd());
    return [first.trim(), ...rest].join("\n").trim();
}

/**
 * Parse `R<number> [level]: text` entries of `Risks and discovery debt`.
 * A risk is scoped to the work packages named in its text; a risk naming none
 * is plan-wide.
 *
 * @param {string} body
 * @returns {{id: string, level: string, text: string, work_packages: string[]}[]}
 */
export function parseRisks(body) {
    const section = extractSection(body, "Risks and discovery debt");
    const lines = section.split("\n");
    const risks = [];
    for (let index = 0; index < lines.length; index += 1) {
        const match = lines[index].match(/^\s*-\s+(R[1-9][0-9]*)\s+\[([^\]]+)]\s*:\s*(.+)$/);
        if (match) {
            const text = entryText(match[3], entryContinuation(lines, index), "  ");
            risks.push({
                id: match[1],
                level: match[2].trim(),
                text,
                work_packages: [...new Set([...text.matchAll(/\bWP[1-9][0-9]*\b/g)].map((found) => found[0]))],
            });
        }
    }
    return risks;
}

function result(errors, packages, questions, metadata, options = {}) {
    const uniqueErrors = [...new Set(errors)];
    const blockedByContent = options.contextBlocked || questions.some((question) => question.status === "open");
    const reviewPending = uniqueErrors.length === 0 && !blockedByContent && options.reviewPending === true;
    const status = uniqueErrors.length > 0
        ? "invalid"
        : blockedByContent || reviewPending ? "blocked" : "ready";
    return {
        valid: uniqueErrors.length === 0,
        status,
        blocked_reason: reviewPending ? "review_pending" : null,
        errors: uniqueErrors,
        metadata,
        packages,
        questions,
    };
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
    errors.push(...validateReviewMetadata(metadata));
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

function validateReviewMetadata(metadata) {
    const errors = [];
    if (Object.hasOwn(metadata, "previous_sha256")) {
        if (metadata.revision === 1) {
            if (metadata.previous_sha256 !== null) {
                errors.push("Front matter previous_sha256 must be null for revision 1.");
            }
        } else if (Number.isInteger(metadata.revision) && !/^[a-f0-9]{64}$/.test(metadata.previous_sha256 ?? "")) {
            errors.push("Front matter previous_sha256 must be a lowercase SHA-256 hash from revision 2.");
        }
    }
    const hasRevision = Object.hasOwn(metadata, "reviewed_revision");
    const hasHash = Object.hasOwn(metadata, "reviewed_body_sha256");
    if (hasRevision !== hasHash) {
        errors.push("Front matter reviewed_revision and reviewed_body_sha256 must be provided together.");
        return errors;
    }
    if (hasRevision) {
        const revisionSet = metadata.reviewed_revision !== null;
        const hashSet = metadata.reviewed_body_sha256 !== null;
        if (revisionSet !== hashSet) {
            errors.push("Front matter reviewed_revision and reviewed_body_sha256 must both be null or both be set.");
        } else if (revisionSet) {
            if (!Number.isInteger(metadata.reviewed_revision) || metadata.reviewed_revision < 1) {
                errors.push("Front matter reviewed_revision must be a positive integer or null.");
            }
            if (!/^[a-f0-9]{64}$/.test(metadata.reviewed_body_sha256 ?? "")) {
                errors.push("Front matter reviewed_body_sha256 must be a lowercase SHA-256 hash or null.");
            }
        }
    }
    const hasBaseRevision = Object.hasOwn(metadata, "review_base_revision");
    if (hasBaseRevision !== Object.hasOwn(metadata, "review_base_sha256")) {
        errors.push("Front matter review_base_revision and review_base_sha256 must be provided together.");
    } else if (hasBaseRevision) {
        const baseRevisionSet = metadata.review_base_revision !== null;
        if (baseRevisionSet !== (metadata.review_base_sha256 !== null)) {
            errors.push("Front matter review_base_revision and review_base_sha256 must both be null or both be set.");
        } else if (baseRevisionSet) {
            if (!Number.isInteger(metadata.review_base_revision) || metadata.review_base_revision < 1
                || (Number.isInteger(metadata.revision) && metadata.review_base_revision > metadata.revision)) {
                errors.push("Front matter review_base_revision must be a positive integer not greater than revision, or null.");
            }
            if (!/^[a-f0-9]{64}$/.test(metadata.review_base_sha256 ?? "")) {
                errors.push("Front matter review_base_sha256 must be a lowercase SHA-256 hash or null.");
            }
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
        .filter((section) => realSection(body, new RegExp(`^## ${escapeRegex(section)}\\s*$`, "gm")) === null)
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

        if (/^\s*-\s+\[[ xX]\]\s+WP[1-9][0-9]*(?:\s+—\s+\d{4}-\d{2}-\d{2}\s+—\s+.+)?\s*$/.test(line)) {
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
    const section = realSection(body, new RegExp(`^## ${escapeRegex(heading)}\\s*$`, "gm"));
    return section ? body.slice(section.start, section.end) : "";
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

function withoutTrailingPunctuation(value) {
    return value.replace(/[.!;\s]+$/, "");
}

function isNone(value) {
    return typeof value !== "string" || /^(?:none|n\/a|not applicable)$/i.test(withoutTrailingPunctuation(value));
}

function isConcreteValue(value) {
    return typeof value === "string"
        && withoutTrailingPunctuation(value) !== ""
        && !/^(?:none|n\/a|not applicable|unknown|unspecified)$/i.test(withoutTrailingPunctuation(value));
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
        throw new ValidationError("INVALID_ARGUMENT", "Usage: validate.mjs validate --file <plan.md> --root <repo> [--verbose]");
    }
    const root = args.root ?? process.cwd();
    const markdown = fs.readFileSync(path.resolve(args.file), "utf8");
    const validation = validatePlanDocument(markdown, {repoRoot: root});
    const planPath = path.relative(path.resolve(root), path.resolve(args.file)).split(path.sep).join("/");
    const projection = projectValidationOutput(validation, markdown, {verbose: args.verbose === true, planPath});
    process.stdout.write(`${JSON.stringify(projection, null, 2)}\n`);
    if (!validation.valid) {
        process.exitCode = 1;
    }
}

/**
 * Project the CLI validation result without work-package bodies or questions.
 *
 * `validatePlanDocument` keeps its full internal result; only the command-line
 * surface is compacted. Use `verbose` for the complete payload.
 */
export function projectValidationOutput(validation, markdown, {verbose = false, planPath = null} = {}) {
    const projection = {
        ok: validation.valid,
        valid: validation.valid,
        status: validation.status,
        blocked_reason: validation.blocked_reason ?? null,
        changed: false,
        plan_id: validation.metadata?.plan_id ?? null,
        revision: validation.metadata?.revision ?? null,
        content_sha256: sha256(markdown),
        plan_path: planPath,
        changed_sections: [],
        changed_work_packages: [],
        errors: validation.errors ?? [],
        warnings: [],
    };
    if (verbose) {
        return {...projection, ...validation};
    }
    return projection;
}

/**
 * Run the CLI against `argv`. Public entrypoints delegate here, so the
 * implementation stays in this shared module.
 *
 * @param {string[]} [argv]
 * @returns {Promise<void>}
 */
export function runCli(argv = process.argv.slice(2)) {
    return main(argv).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "VALIDATION_ERROR", message: error.message, details: error.details ?? {}})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}

if (isMainModule(import.meta.url)) {
    runCli();
}
