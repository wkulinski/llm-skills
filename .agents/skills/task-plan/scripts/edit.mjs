#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {
    loadPlan,
    projectPlanOutcome,
    renderPlanDocument,
    resolvePlanPaths,
    savePlan,
} from "../../_shared/scripts/task-plan/store.mjs";
import {parsePlanDocument, sectionContentRange, validatePlanDocument} from "../../_shared/scripts/task-plan/validate.mjs";

const DECISIONS_SECTION = "Decisions and open questions";
const QUESTION_STATUSES = new Set(["open", "answered"]);
const QUESTION_FIELD_RE = /^ {2}-\s+(Answer|Source):(.*)$/;
const SOURCE_LINE = "  - Source: current conversation";

export class PlanEditError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PlanEditError";
        this.code = code;
        this.details = details;
    }
}

/**
 * Apply one deterministic structural edit to a plan body.
 *
 * This function intentionally accepts only schema-shaped selectors. It never
 * searches for arbitrary substrings and rejects missing or duplicate targets.
 */
export function applyOperation(body, operation) {
    assertOperationFields(operation);
    const structure = parseEditableBody(body);
    const lines = [...structure.lines];

    switch (operation?.type) {
        case "add-bullet":
            return addBullet(lines, structure, operation);
        case "edit-bullet":
            return editBullet(lines, structure, operation);
        case "remove-bullet":
            return removeBullet(lines, structure, operation);
        case "answer-question":
            return answerQuestion(lines, structure, operation);
        case "add-question":
            return addQuestion(lines, structure, operation);
        case "edit-question":
            return editQuestion(lines, structure, operation);
        case "remove-question":
            return removeQuestion(lines, structure, operation);
        default:
            throw new PlanEditError("UNSUPPORTED_OPERATION", "Unsupported plan edit operation.", {
                operation: operation?.type ?? null,
            });
    }
}

/**
 * Edit the canonical task-plan file and persist it through store.mjs.
 */
export function editPlan(input = {}, options = {}) {
    const fsOps = options.fsOps ?? fs;
    const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
    const file = requiredString(input.file, "file");
    const absoluteFile = resolveInsideRoot(file, repoRoot);
    const markdown = readPlanFile(absoluteFile, fsOps);
    const parsed = parsePlanDocument(markdown);

    if (parsed.errors.length > 0) {
        throw new PlanEditError("PLAN_STRUCTURE_INVALID", "Plan cannot be structurally edited.", {
            errors: parsed.errors,
        });
    }

    const sourceIdentity = requiredString(parsed.metadata.source_identity, "front matter source_identity");
    const canonicalPaths = resolvePlanPaths({repoRoot, sourceIdentity});
    if (absoluteFile !== canonicalPaths.draftPath) {
        throw new PlanEditError("NON_CANONICAL_PLAN", "The edited file is not the canonical task-plan draft.", {
            file: path.relative(repoRoot, absoluteFile).split(path.sep).join("/"),
            canonical_file: path.relative(repoRoot, canonicalPaths.draftPath).split(path.sep).join("/"),
        });
    }

    const loaded = loadPlan({repoRoot, sourceIdentity, fsOps});
    if (!loaded.validation?.valid) {
        throw new PlanEditError("PLAN_INVALID", "The current plan must pass structural and evidence validation before editing.", {
            errors: loaded.validation?.errors ?? [],
        });
    }
    if (loaded.markdown !== markdown) {
        throw new PlanEditError("PLAN_CHANGED_DURING_READ", "The plan changed while the edit was being prepared.");
    }

    const operations = resolveOperations(input);
    let body = parsed.body;
    let changed = false;
    for (const operation of operations) {
        const result = applyOperation(body, operation);
        body = result.body;
        changed = changed || result.changed;
    }
    const dryRun = input.dry_run === true;
    if (!changed || dryRun) {
        const candidateValidation = changed
            ? validatePlanDocument(
                renderPlanDocument(body, loaded.metadata),
                {repoRoot, fsOps},
            )
            : loaded.validation;
        if (!candidateValidation.valid) {
            throw new PlanEditError("EDIT_INVALID", "The proposed edit would produce an invalid plan.", {
                errors: candidateValidation.errors,
            });
        }
        const candidateMarkdown = changed ? renderPlanDocument(body, loaded.metadata) : loaded.markdown;
        return projectPlanOutcome({
            status: candidateValidation.status,
            changed,
            planId: parsed.metadata.plan_id,
            revision: loaded.metadata?.revision ?? null,
            contentSha256: sha256(loaded.markdown),
            previousSha256: changed ? sha256(loaded.markdown) : loaded.metadata?.previous_sha256 ?? null,
            planPath: path.relative(repoRoot, absoluteFile).split(path.sep).join("/"),
            beforeMarkdown: loaded.markdown,
            afterMarkdown: candidateMarkdown,
            errors: candidateValidation.errors,
            blockedReason: candidateValidation.blocked_reason ?? null,
            verbose: options.verbose === true,
            extra: {
                dry_run: dryRun,
                next_revision: changed ? Number(loaded.metadata?.revision ?? 0) + 1 : loaded.metadata?.revision ?? null,
                operation: operationType(operations),
                file: path.relative(repoRoot, absoluteFile).split(path.sep).join("/"),
            },
        });
    }

    const saved = savePlan({
        repo_root: repoRoot,
        source_identity: sourceIdentity,
        plan_id: parsed.metadata.plan_id,
        markdown_body: body,
        expected_revision: loaded.metadata.revision,
        base_sha256: sha256(markdown),
    }, {fsOps, verbose: true});
    return projectPlanOutcome({
        status: saved.status,
        changed: saved.changed,
        planId: parsed.metadata.plan_id,
        revision: saved.metadata?.revision ?? null,
        contentSha256: saved.content_sha256 ?? sha256(saved.markdown ?? ""),
        previousSha256: saved.previous_sha256 ?? null,
        planPath: path.relative(repoRoot, absoluteFile).split(path.sep).join("/"),
        beforeMarkdown: loaded.markdown,
        afterMarkdown: saved.markdown ?? body,
        errors: saved.validation?.errors ?? [],
        blockedReason: saved.blocked_reason ?? null,
        full: {
            markdown: saved.markdown ?? null,
            metadata: saved.metadata ?? null,
            validation: saved.validation ?? null,
            paths: saved.paths ?? null,
        },
        verbose: options.verbose === true,
        extra: {
            dry_run: false,
            operation: operationType(operations),
            file: path.relative(repoRoot, absoluteFile).split(path.sep).join("/"),
        },
    });
}

function resolveOperations(input) {
    if (typeof input.operations !== "undefined" && typeof input.operation !== "undefined") {
        throw new PlanEditError("INVALID_ARGUMENT", "Provide either operation or operations, not both.");
    }
    if (typeof input.operations === "undefined") {
        return [input.operation];
    }
    if (!Array.isArray(input.operations) || input.operations.length === 0) {
        throw new PlanEditError("INVALID_ARGUMENT", "operations must be a non-empty array.");
    }
    return input.operations;
}

function operationType(operations) {
    return operations.length === 1 ? operations[0]?.type ?? null : null;
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function addBullet(lines, structure, operation) {
    const range = selectContainer(structure, operation);
    const id = requiredBulletId(operation.id);
    const value = requiredMultilineValue(operation.value, "value");
    const status = optionalStatus(operation.status);
    if (isQuestionId(id)) {
        throw new PlanEditError("STRUCTURED_BULLET", "Questions must be changed with question operations.", {id});
    }
    if (findBullets(lines, range.start, range.end, structure.fenced).some((bullet) => bullet.id === id)) {
        throw new PlanEditError("DUPLICATE_TARGET", `Duplicate bullet id: ${id}.`, {id});
    }
    const insertAt = trailingBlankStart(lines, range.start, range.end);
    lines.splice(insertAt, 0, ...formatBullet(id, status, value));
    return {body: lines.join("\n"), changed: true};
}

function assertOperationFields(operation) {
    const allowed = {
        "add-bullet": new Set(["type", "section", "work_package", "id", "value", "status", "target", "field", "next"]),
        "edit-bullet": new Set(["type", "section", "work_package", "id", "value", "status", "target", "field", "next"]),
        "remove-bullet": new Set(["type", "section", "work_package", "id", "value", "status", "target", "field", "next"]),
        "answer-question": new Set(["type", "id", "answer", "source"]),
        "add-question": new Set(["type", "id", "prompt", "status", "answer"]),
        "edit-question": new Set(["type", "id", "prompt", "status", "answer"]),
        "remove-question": new Set(["type", "id"]),
    }[operation?.type];
    if (!allowed || !operation || typeof operation !== "object") {
        return;
    }
    for (const key of Object.keys(operation)) {
        if (!allowed.has(key)) {
            throw new PlanEditError("UNSUPPORTED_OPTION", `Unsupported operation field: ${key}.`, {key});
        }
    }
}

function editBullet(lines, structure, operation) {
    const range = selectContainer(structure, operation);
    const id = requiredBulletId(operation.id);
    if (isQuestionId(id)) {
        throw new PlanEditError("STRUCTURED_BULLET", "Questions must be changed with question operations.", {id});
    }
    const hasValue = typeof operation.value !== "undefined";
    const hasStatus = typeof operation.status !== "undefined";
    if (!hasValue && !hasStatus) {
        throw new PlanEditError("INVALID_ARGUMENT", "edit-bullet requires value or status.");
    }
    const bullet = uniqueBullet(findBullets(lines, range.start, range.end, structure.fenced), id);
    const end = bulletBlockEnd(lines, bullet.index, range.end, structure.fenced);
    const current = lines.slice(bullet.index, end);
    const status = hasStatus ? optionalStatus(operation.status) : bullet.status;
    const replacement = hasValue
        ? formatBullet(bullet.id, status, requiredMultilineValue(operation.value, "value"))
        : [formatBullet(bullet.id, status, bullet.value)[0], ...current.slice(1)];
    const changed = replacement.join("\n") !== current.join("\n");
    lines.splice(bullet.index, end - bullet.index, ...replacement);
    return {body: lines.join("\n"), changed};
}

function removeBullet(lines, structure, operation) {
    if (typeof operation.value !== "undefined" || typeof operation.status !== "undefined") {
        throw new PlanEditError("UNSUPPORTED_OPTION", "remove-bullet accepts only a container and an id.");
    }
    const range = selectContainer(structure, operation);
    const id = requiredBulletId(operation.id);
    if (isQuestionId(id)) {
        throw new PlanEditError("STRUCTURED_BULLET", "Questions must be removed with question operations.", {id});
    }
    const bullet = uniqueBullet(findBullets(lines, range.start, range.end, structure.fenced), id);
    return removeBlock(lines, bullet.index, bulletBlockEnd(lines, bullet.index, range.end, structure.fenced), range);
}

function answerQuestion(lines, structure, operation) {
    const id = validQuestionId(operation.id);
    const answer = requiredMultilineValue(operation.answer, "answer");
    const source = operation.source ?? "current conversation";
    if (source !== "current conversation") {
        throw new PlanEditError("INVALID_SOURCE", "Answered task-plan questions must use Source: current conversation.", {source});
    }
    const question = uniqueTarget(structure.questions.filter((record) => record.id === id), "question", id);
    const block = questionBlock(lines, question, structure.fenced);
    const prompt = [withQuestionStatus(block.prompt[0], "answered"), ...block.prompt.slice(1)];
    return replaceQuestion(lines, question, [...prompt, ...formatAnswer(answer), SOURCE_LINE]);
}

function editQuestion(lines, structure, operation) {
    const id = validQuestionId(operation.id);
    const question = uniqueTarget(structure.questions.filter((record) => record.id === id), "question", id);
    const block = questionBlock(lines, question, structure.fenced);
    const hasPrompt = typeof operation.prompt !== "undefined";
    const hasStatus = typeof operation.status !== "undefined";
    const hasAnswer = typeof operation.answer !== "undefined";
    if (!hasStatus && !hasAnswer && !hasPrompt) {
        throw new PlanEditError("INVALID_ARGUMENT", "edit-question requires prompt, status, or answer.", {id});
    }

    let status = hasStatus ? questionStatus(operation.status) : question.status;
    if (question.status === "open" && hasAnswer && !hasStatus) {
        status = "answered";
    }
    if (status === "open" && hasAnswer) {
        throw new PlanEditError("INVALID_ARGUMENT", "An open question must not include answer.", {id});
    }

    const prompt = hasPrompt
        ? formatQuestion(id, status, requiredPromptValue(operation.prompt))
        : [withQuestionStatus(block.prompt[0], status), ...block.prompt.slice(1)];
    if (status === "open") {
        return replaceQuestion(lines, question, prompt);
    }
    let answer = block.answer;
    if (hasAnswer) {
        answer = formatAnswer(requiredMultilineValue(operation.answer, "answer"));
    } else if (answer === null) {
        throw new PlanEditError("INVALID_ARGUMENT", "Answered questions require answer.", {id});
    }
    return replaceQuestion(lines, question, [...prompt, ...answer, SOURCE_LINE]);
}

function removeQuestion(lines, structure, operation) {
    const id = validQuestionId(operation.id);
    const question = uniqueTarget(structure.questions.filter((record) => record.id === id), "question", id);
    questionBlock(lines, question, structure.fenced);
    const section = structure.sections.find((record) => record.name === DECISIONS_SECTION);
    return removeBlock(lines, question.index, question.end, section);
}

/** Empty folded sections keep only the required blank line after summary.
 * Trim whitespace from the edited content range, never from neighboring sections.
 */
function removeBlock(lines, start, end, container) {
    const removed = end - start;
    lines.splice(start, removed);
    const remainingEnd = container.end - removed;
    if (container.wrapped && lines.slice(container.start, remainingEnd).every((line) => line.trim() === "")) {
        lines.splice(container.start, remainingEnd - container.start);
    }
    return {body: lines.join("\n"), changed: true};
}

function addQuestion(lines, structure, operation) {
    const id = validQuestionId(operation.id);
    const prompt = requiredPromptValue(operation.prompt);
    const status = questionStatus(operation.status);
    if (structure.questions.some((question) => question.id === id)) {
        throw new PlanEditError("DUPLICATE_TARGET", `Duplicate question id: ${id}.`, {id});
    }

    const answer = operation.answer;
    if (status === "answered" && !answer) {
        throw new PlanEditError("INVALID_ARGUMENT", "Answered questions require answer.", {id});
    }
    if (status === "open" && typeof answer !== "undefined") {
        throw new PlanEditError("INVALID_ARGUMENT", "Open questions must not include answer.", {id});
    }
    const decisionSection = uniqueTarget(
        structure.sections.filter((section) => section.name === DECISIONS_SECTION),
        "section",
        DECISIONS_SECTION,
    );
    const insertAt = trailingBlankStart(lines, decisionSection.start, decisionSection.end);
    const block = formatQuestion(id, status, prompt);
    if (status === "answered") {
        block.push(...formatAnswer(requiredMultilineValue(answer, "answer")), SOURCE_LINE);
    }
    lines.splice(insertAt, 0, ...block);
    return {body: lines.join("\n"), changed: true};
}

/**
 * Split a question block into raw line segments: the prompt (the question line
 * and its continuation), the `Answer` field with its continuation, and the
 * `Source` field. Fields are bullets indented by two spaces; continuation lines
 * of `Answer` are indented by at least four spaces.
 */
function questionBlock(lines, question, fenced) {
    const segments = {prompt: [lines[question.index]], answer: null, source: null};
    let current = segments.prompt;
    let currentField = null;
    for (let index = question.index + 1; index < question.end; index += 1) {
        const line = lines[index];
        const field = fenced[index] ? null : line.match(QUESTION_FIELD_RE);
        if (field) {
            currentField = field[1] === "Answer" ? "answer" : "source";
            if (segments[currentField] !== null) {
                throw new PlanEditError("DUPLICATE_TARGET", `Duplicate ${question.id}: ${field[1]}.`, {label: field[1], target: question.id});
            }
            segments[currentField] = [line];
            current = segments[currentField];
            continue;
        }
        const continuesField = currentField === "answer" && (fenced[index] || /^ {4,}\S/.test(line));
        if (currentField !== null && line.trim() !== "" && !continuesField) {
            throw new PlanEditError("MALFORMED_QUESTION", "Question blocks may contain only the prompt, Answer and Source fields.", {id: question.id});
        }
        current.push(line);
    }

    const answer = segments.answer?.[0].match(QUESTION_FIELD_RE)[2].trim() ?? null;
    const source = segments.source?.[0].match(QUESTION_FIELD_RE)[2].trim() ?? null;
    if (question.status === "open" && (segments.answer || segments.source)) {
        throw new PlanEditError("MALFORMED_QUESTION", "An open question must not contain an answer block.", {id: question.id});
    }
    if (question.status === "answered" && (!answer || source !== "current conversation")) {
        throw new PlanEditError("MALFORMED_QUESTION", "An answered question requires Answer and Source: current conversation.", {id: question.id});
    }
    return segments;
}

function replaceQuestion(lines, question, block) {
    const changed = block.join("\n") !== lines.slice(question.index, question.end).join("\n");
    lines.splice(question.index, question.end - question.index, ...block);
    return {body: lines.join("\n"), changed};
}

function withQuestionStatus(line, status) {
    return line.replace(/^(-\s+Q[1-9][0-9]*\s+)\[(?:open|answered)]/, `$1[${status}]`);
}

function formatAnswer(answer) {
    const [first, ...continuation] = answer.split("\n");
    return [`  - Answer: ${first}`, ...continuation.map((line) => (line.trim() === "" ? "" : `    ${line}`))];
}

function requiredPromptValue(value) {
    const prompt = requiredMultilineValue(value, "prompt");
    if (prompt.split("\n").slice(1).some((line) => /^-\s+(?:Answer|Source):/.test(line))) {
        throw new PlanEditError("INVALID_ARGUMENT", "A prompt continuation line must not start an Answer or Source field.", {name: "prompt"});
    }
    return prompt;
}

function questionStatus(value) {
    const status = requiredString(value, "status");
    if (!QUESTION_STATUSES.has(status)) {
        throw new PlanEditError("INVALID_QUESTION_STATUS", "Question status must be open or answered.", {status});
    }
    return status;
}

function formatQuestion(id, status, prompt) {
    return formatBullet(id, status, prompt);
}

function parseEditableBody(body) {
    if (typeof body !== "string") {
        throw new PlanEditError("INVALID_BODY", "Plan body must be a string.");
    }
    if (body.includes("\r")) {
        throw new PlanEditError("UNSUPPORTED_LINE_ENDINGS", "Structural editing requires LF line endings.");
    }

    const lines = body.split("\n");
    const fenced = fenceMap(lines);
    assertNamedBullets(lines, fenced);
    const headings = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (fenced[index]) {
            continue;
        }
        const heading = parseHeading(lines[index]);
        if (heading) {
            headings.push({...heading, index});
        }
    }

    const sectionHeadings = headings.filter((heading) => heading.level === 2);
    const sections = sectionHeadings.map((heading, index) => {
        const startLine = heading.index + 1;
        const endLine = sectionHeadings[index + 1]?.index ?? lines.length;
        const raw = lines.slice(startLine, endLine).join("\n");
        const content = sectionContentRange(raw, 0, raw.length);
        const start = startLine + raw.slice(0, content.start).split("\n").length - 1;
        const end = content.start === content.end ? start : startLine + raw.slice(0, content.end).split("\n").length;
        return {
            name: heading.name,
            heading: heading.index,
            start: content.start === 0 ? startLine : start,
            end: content.end === raw.length ? endLine : end,
            wrapped: content.start !== 0,
        };
    });
    assertUniqueIds(sections, "section", (record) => record.name);

    const packages = [];
    for (const section of sections) {
        const packageHeadings = headings.filter((heading) => (
            heading.level === 3
            && heading.index > section.heading
            && heading.index < section.end
            && heading.packageId !== null
        ));
        packageHeadings.forEach((heading, index) => {
            packages.push({
                id: heading.packageId,
                title: heading.title,
                heading: heading.index,
                start: heading.index + 1,
                end: packageHeadings[index + 1]?.index ?? section.end,
            });
        });
    }
    assertUniqueIds(packages, "work package", (record) => record.id);

    const decisionSection = sections.find((section) => section.name === DECISIONS_SECTION);
    const questions = decisionSection ? parseQuestions(lines, decisionSection, fenced) : [];
    assertUniqueIds(questions, "question", (record) => record.id);

    return {lines, fenced, sections, packages, questions};
}

function parseQuestions(lines, section, fenced) {
    const questions = [];
    for (let index = section.start; index < section.end; index += 1) {
        if (fenced[index]) {
            continue;
        }
        const match = lines[index].match(/^-\s+(Q[1-9][0-9]*)\s+\[(open|answered)]\s*:\s*(.+)$/);
        if (!match) {
            continue;
        }
        questions.push({
            id: match[1],
            status: match[2],
            index,
            end: bulletBlockEnd(lines, index, section.end, fenced),
        });
    }
    return questions;
}

function selectContainer(structure, operation) {
    if (typeof operation.next !== "undefined" || typeof operation.target !== "undefined" || typeof operation.field !== "undefined") {
        throw new PlanEditError("UNSUPPORTED_OPTION", "Bullet operations require an explicit id and do not support target, field, or next.");
    }
    const section = typeof operation.section === "undefined" ? null : requiredSingleLine(operation.section, "section");
    const workPackage = typeof operation.work_package === "undefined"
        ? null
        : requiredSingleLine(operation.work_package, "work-package");
    if ((section === null) === (workPackage === null)) {
        throw new PlanEditError("INVALID_SELECTOR", "Provide exactly one of section or work-package.");
    }
    if (section !== null) {
        return uniqueTarget(
            structure.sections.filter((record) => record.name === section),
            "section",
            section,
        );
    }
    return uniqueTarget(
        structure.packages.filter((record) => record.id === workPackage),
        "work package",
        workPackage,
    );
}

function findBullets(lines, start, end, fenced) {
    const bullets = [];
    for (let index = start; index < end; index += 1) {
        if (fenced[index]) {
            continue;
        }
        const bullet = parseBulletLine(lines[index], "");
        if (bullet) {
            bullets.push({...bullet, index});
        }
    }
    return bullets;
}

function uniqueBullet(bullets, id) {
    const matches = bullets.filter((bullet) => bullet.id === id);
    if (matches.length === 0) {
        throw new PlanEditError("TARGET_NOT_FOUND", `Bullet not found: ${id}.`, {id});
    }
    if (matches.length > 1) {
        throw new PlanEditError("DUPLICATE_TARGET", `Duplicate bullet id: ${id}.`, {id});
    }
    return matches[0];
}

/**
 * Lines of a bullet block. Continuation lines of a multi-line value keep their
 * relative indentation and are indented by two spaces under the bullet.
 */
function formatBullet(id, status, value) {
    const statusSuffix = status === null ? "" : ` [${status}]`;
    const [first, ...continuation] = value.split("\n");
    return [
        `- ${id}${statusSuffix}: ${first}`,
        ...continuation.map((line) => (line.trim() === "" ? "" : `  ${line}`)),
    ];
}

function isQuestionId(id) {
    return /^Q[1-9][0-9]*$/.test(id);
}

function requiredBulletId(value) {
    const id = requiredSingleLine(value, "id");
    if (/[:\[\]]/.test(id)) {
        throw new PlanEditError("INVALID_ID", "Bullet id must not contain colon or square brackets.", {id});
    }
    return id;
}

function optionalStatus(value) {
    if (typeof value === "undefined") {
        return null;
    }
    const status = requiredSingleLine(value, "status");
    if (/[:\[\]]/.test(status)) {
        throw new PlanEditError("INVALID_STATUS", "Status must not contain colon or square brackets.", {status});
    }
    return status;
}

/**
 * End (exclusive) of the bullet block that starts at `index`: the bullet line
 * plus every following indented line, without trailing blank lines. Lines of a
 * fenced code block belong to the block only when the fence starts indented,
 * so an unindented example after the bullet ends it. A non-indented line, such
 * as the next bullet or a heading, ends the block.
 */
function bulletBlockEnd(lines, index, end, fenced) {
    let blockEnd = index + 1;
    for (let cursor = index + 1; cursor < end; cursor += 1) {
        if (fenced[cursor]) {
            const opener = !fenced[cursor - 1];
            if (opener && !/^\s+\S/.test(lines[cursor])) {
                break;
            }
            blockEnd = cursor + 1;
            continue;
        }
        if (/^\s+\S/.test(lines[cursor])) {
            blockEnd = cursor + 1;
            continue;
        }
        if (lines[cursor].trim() !== "") {
            break;
        }
    }
    return blockEnd;
}

function uniqueTarget(records, kind, id) {
    if (records.length === 0) {
        throw new PlanEditError("TARGET_NOT_FOUND", `${kind} not found: ${id}.`, {kind, id});
    }
    if (records.length > 1) {
        throw new PlanEditError("DUPLICATE_TARGET", `Duplicate ${kind}: ${id}.`, {kind, id});
    }
    return records[0];
}

function assertUniqueIds(records, kind, getId) {
    const seen = new Set();
    for (const record of records) {
        const id = getId(record);
        if (seen.has(id)) {
            throw new PlanEditError("DUPLICATE_TARGET", `Duplicate ${kind}: ${id}.`, {kind, id});
        }
        seen.add(id);
    }
}

function parseHeading(line) {
    if (/^##\s/.test(line) && !/^###\s/.test(line)) {
        const name = line.slice(3).trim();
        return name === "" ? null : {level: 2, name};
    }
    if (/^###\s/.test(line) && !/^####\s/.test(line)) {
        const text = line.slice(4).trim();
        const match = text.match(/^(WP[1-9][0-9]*)\s+[—-]\s+(.+)$/);
        return match
            ? {level: 3, name: text, packageId: match[1], title: match[2].trim()}
            : {level: 3, name: text, packageId: null, title: null};
    }
    return null;
}

function assertNamedBullets(lines, fenced) {
    for (let index = 0; index < lines.length; index += 1) {
        if (fenced[index]) {
            continue;
        }
        if (/^\s*-\s+\[[ xX]\]\s+WP[1-9][0-9]*(?:\s+—\s+\d{4}-\d{2}-\d{2}\s+—\s+.+)?\s*$/.test(lines[index])) {
            continue;
        }
        if (/^\s*-\s+/.test(lines[index]) && !/^\s*-\s+\S(?:[^:\r\n]*\S)?: /.test(lines[index])) {
            throw new PlanEditError("UNNAMED_BULLET", `Bullet must have a name followed by ": ": ${lines[index].trim()}.`);
        }
    }
}

function parseLabeledLine(line) {
    const match = line.match(/^(\s*)-\s+([^:]+):(.*)$/);
    if (!match) {
        return null;
    }
    const colon = line.indexOf(":", match[1].length + 1);
    return {
        indentation: match[1],
        label: match[2].trim(),
        prefix: line.slice(0, colon + 1),
        value: line.slice(colon + 1).trim(),
    };
}

function parseBulletLine(line, indentation) {
    const labeled = parseLabeledLine(line);
    if (!labeled || labeled.indentation !== indentation) {
        return null;
    }
    const statusMatch = labeled.label.match(/^(.*?)\s+\[([^\]]+)\]$/);
    const id = (statusMatch ? statusMatch[1] : labeled.label).trim();
    if (id === "") {
        return null;
    }
    return {
        ...labeled,
        id,
        status: statusMatch ? statusMatch[2].trim() : null,
    };
}

function fenceMap(lines) {
    const fenced = [];
    let marker = null;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        fenced[index] = marker !== null;
        if (marker !== null) {
            const closing = new RegExp(`^\\s*${marker.character}{${marker.length},}\\s*$`).test(line);
            if (closing) {
                marker = null;
            }
            continue;
        }
        const opening = line.match(/^\s*(`{3,}|~{3,})/);
        if (opening) {
            marker = {character: opening[1][0], length: opening[1].length};
            fenced[index] = true;
        }
    }
    if (marker !== null) {
        throw new PlanEditError("MALFORMED_STRUCTURE", "Plan contains an unclosed fenced code block.");
    }
    return fenced;
}

function trailingBlankStart(lines, start, end) {
    let index = end;
    while (index > start && lines[index - 1] === "") {
        index -= 1;
    }
    return index;
}

function validQuestionId(value) {
    const id = requiredString(value, "id");
    if (!/^Q[1-9][0-9]*$/.test(id)) {
        throw new PlanEditError("INVALID_QUESTION_ID", "Question id must match Q<number>.", {id});
    }
    return id;
}

function requiredMultilineValue(value, name) {
    const result = requiredString(value, name);
    if (result.includes("\r")) {
        throw new PlanEditError("UNSUPPORTED_LINE_ENDINGS", `${name} must use LF line endings.`, {name});
    }
    return result.trim().split("\n").map((line) => line.trimEnd()).join("\n");
}

function requiredSingleLine(value, name) {
    const result = requiredString(value, name);
    if (/[\r\n]/.test(result)) {
        throw new PlanEditError("MULTILINE_VALUE", `${name} must be a single line.`, {name});
    }
    return result;
}

function requiredString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new PlanEditError("INVALID_ARGUMENT", `${name} must be a non-empty string.`, {name});
    }
    return value.trim();
}

function resolveInsideRoot(file, root) {
    const absolute = path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new PlanEditError("UNSAFE_PATH", "file must remain inside the repository root.", {file});
    }
    return absolute;
}

function readPlanFile(file, fsOps = fs) {
    try {
        return fsOps.readFileSync(file, "utf8");
    } catch (error) {
        throw new PlanEditError("PLAN_READ_FAILED", `Could not read ${file}.`, {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
}

function parseArgs(argv) {
    const args = {_: []};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            args._.push(token);
            continue;
        }
        const key = token.slice(2).replaceAll("-", "_");
        const next = argv[index + 1];
        if (typeof next === "undefined" || next.startsWith("--")) {
            args[key] = true;
        } else {
            args[key] = next;
            index += 1;
        }
    }
    return args;
}

function operationFromArgs(args) {
    const command = args._[0];
    if (args._.length !== 1) {
        throw new PlanEditError("INVALID_ARGUMENT", "Exactly one edit command is required.");
    }
    if (["add-bullet", "edit-bullet", "remove-bullet"].includes(command)) {
        assertAllowedArgs(args, new Set(["file", "root", "dry_run", "verbose", "section", "work_package", "id", "value", "status", "target", "field", "next", "_"]));
        if (typeof args.target !== "undefined" || typeof args.field !== "undefined" || typeof args.next !== "undefined") {
            throw new PlanEditError("UNSUPPORTED_OPTION", "Bullet operations use section or work-package and require an explicit id; target and next are not supported.");
        }
        if (command === "remove-bullet" && (typeof args.value !== "undefined" || typeof args.status !== "undefined")) {
            throw new PlanEditError("UNSUPPORTED_OPTION", "remove-bullet accepts only a container and an id.");
        }
        return {
            type: command,
            section: args.section,
            work_package: args.work_package,
            id: args.id,
            value: args.value,
            status: args.status,
        };
    }
    if (command === "answer-question") {
        assertAllowedArgs(args, new Set(["file", "root", "dry_run", "verbose", "id", "answer", "source", "_"]));
        return {
            type: command,
            id: args.id,
            answer: args.answer,
            source: args.source,
        };
    }
    if (command === "edit-question") {
        assertAllowedArgs(args, new Set(["file", "root", "dry_run", "verbose", "id", "prompt", "status", "answer", "_"]));
        return {
            type: command,
            id: args.id,
            prompt: args.prompt,
            status: args.status,
            answer: args.answer,
        };
    }
    if (command === "remove-question") {
        assertAllowedArgs(args, new Set(["file", "root", "dry_run", "verbose", "id", "_"]));
        return {
            type: command,
            id: args.id,
        };
    }
    if (command === "add-question") {
        assertAllowedArgs(args, new Set(["file", "root", "dry_run", "verbose", "id", "prompt", "status", "answer", "_"]));
        return {
            type: command,
            id: args.id,
            prompt: args.prompt,
            status: args.status,
            answer: args.answer,
        };
    }
    throw new PlanEditError("INVALID_ARGUMENT", "Usage: edit.mjs <add-bullet|edit-bullet|remove-bullet|answer-question|add-question|edit-question|remove-question> --file <plan.md> ...");
}

function assertAllowedArgs(args, allowed) {
    for (const key of Object.keys(args)) {
        if (!allowed.has(key)) {
            throw new PlanEditError("UNSUPPORTED_OPTION", `Unsupported option: --${key.replaceAll("_", "-")}.`, {key});
        }
    }
}

function usage() {
    return [
        "Usage:",
        "  edit.mjs add-bullet --file <plan.md> (--section <heading> | --work-package <WP#>) --id <name> --value <value> [--status <status>]",
        "  edit.mjs edit-bullet --file <plan.md> (--section <heading> | --work-package <WP#>) --id <name> [--value <value>] [--status <status>]",
        "  edit.mjs remove-bullet --file <plan.md> (--section <heading> | --work-package <WP#>) --id <name>",
        "  edit.mjs answer-question --file <plan.md> --id <Q#> --answer <answer> [--source \"current conversation\"]",
        "  edit.mjs add-question --file <plan.md> --id <Q#> --prompt <prompt> --status <open|answered> [--answer <answer>]",
        "  edit.mjs edit-question --file <plan.md> --id <Q#> [--prompt <prompt>] [--status <open|answered>] [--answer <answer>]",
        "  edit.mjs remove-question --file <plan.md> --id <Q#>",
        "  edit.mjs apply-operations --file <plan.md> --input <file|->",
        "Options:",
        "  --root <repo>   Repository root (defaults to the current directory).",
        "  --dry-run       Validate and render the structural operation without writing.",
        "  --verbose       Include the full Markdown, metadata and validation payload.",
        "  --input <file|-> JSON with the operations array; apply-operations writes one revision.",
    ].join("\n");
}

async function main(argv) {
    const args = parseArgs(argv);
    if (args.help || args._[0] === "help") {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    const input = args._[0] === "apply-operations"
        ? batchInputFromArgs(args)
        : {file: args.file, dry_run: args.dry_run === true, operation: operationFromArgs(args)};
    const result = editPlan(input, {repoRoot: args.root ?? process.cwd(), verbose: args.verbose === true});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function batchInputFromArgs(args) {
    assertAllowedArgs(args, new Set(["file", "root", "dry_run", "verbose", "input", "_"]));
    const payload = readJsonInput(args.input);
    if (!Array.isArray(payload?.operations) || payload.operations.length === 0) {
        throw new PlanEditError("INVALID_ARGUMENT", "--input must contain a non-empty operations array.");
    }
    return {
        file: args.file,
        dry_run: args.dry_run === true,
        operations: payload.operations,
    };
}

function readJsonInput(filePath) {
    if (typeof filePath !== "string" || filePath === "") {
        throw new PlanEditError("INVALID_ARGUMENT", "apply-operations requires --input <file|->.");
    }
    const content = filePath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(filePath), "utf8");
    try {
        return JSON.parse(content);
    } catch {
        throw new PlanEditError("INVALID_ARGUMENT", "--input must contain valid JSON.");
    }
}

if (isMainModule(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({
            error: error.code ?? "PLAN_EDIT_ERROR",
            message: error.message,
            details: error.details ?? {},
        })}\n`);
        process.exitCode = 1;
    });
}
