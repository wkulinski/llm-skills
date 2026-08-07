#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {slugifyTitle} from "../../_shared/scripts/slugify-title.mjs";
import {
    PLAN_STATUSES,
    SIMPLIFICATION_STATUSES,
    TERMINAL_PACKAGE_STATUSES,
    validateQuestionRecords,
    validateSessionStrategy,
} from "./state.mjs";

export const DRAFT_SECTIONS = Object.freeze([
    "## Source",
    "## Session strategy",
    "## Goal and scope",
    "## Work packages",
    "## Decisions and open questions",
    "## Evidence, risks and review",
    "## Acceptance and verification",
    "## Next action",
    "## Execution handoff (when implementation is requested)",
]);

export const SESSION_STRATEGY_LABELS = Object.freeze([
    "Mode:",
    "Rationale:",
    "Stages:",
    "Work packages:",
    "Session boundary recommendation:",
    "Dependencies:",
    "Entry criteria:",
    "Exit criteria:",
]);

export const DEFAULT_PENDING_TITLE = "Pending title";

export const INITIAL_SESSION_STRATEGY = Object.freeze({
    mode: "staged",
    rationale: "Initial draft created before source fetch; strategy is finalized after source intake.",
    stages: [
        {
            id: "S1",
            title: "Source intake",
            rationale: "Fetch and assess the source before defining implementation packages.",
            work_package_ids: [],
            dependencies: [],
            session_boundary: "same-session",
            entry_criteria: ["Intent gate passed."],
            exit_criteria: ["Source fetched and profile assigned."],
        },
    ],
    session_boundary_recommendation: "Resume in a new session after source intake.",
    dependencies: ["source fetch"],
    entry_criteria: ["Source fetched, assessed and profile assigned."],
    exit_criteria: ["Every blocking question has an explicit user decision."],
});

export const DETAILED_PLAN_SECTIONS = Object.freeze([
    "## Source plan",
    "## Review findings",
    "## Revised plan",
]);

export const SOURCE_KINDS = Object.freeze([
    "github-issue",
    "file",
    "user-input",
    "derived-work-package",
]);

export const INPUT_PROFILES = Object.freeze([
    "title-only",
    "brief-request",
    "specification",
    "detailed-plan",
]);

const CLI_CONTRACT_REJECTIONS = Object.freeze([
    "UNSAFE_PATH",
    "SOURCE_IDENTITY_MISMATCH",
]);

export class DraftError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "DraftError";
        this.code = code;
        this.details = details;
    }
}

export function parseFrontMatter(source) {
    if (typeof source !== "string") {
        throw new DraftError("INVALID_DOCUMENT", "Draft document must be a string.");
    }

    const normalized = source.replace(/\r\n/g, "\n");
    const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
    if (!match) {
        throw new DraftError("MISSING_FRONT_MATTER", "Draft document must start with YAML front matter.");
    }

    const metadata = {};
    for (const line of match[1].split("\n")) {
        if (line.trim() === "") {
            continue;
        }
        const separator = line.indexOf(":");
        if (separator < 1) {
            throw new DraftError("INVALID_FRONT_MATTER", `Invalid front matter line: ${line}.`);
        }

        const key = line.slice(0, separator).trim();
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
            throw new DraftError("INVALID_FRONT_MATTER", `Invalid front matter key: ${key}.`);
        }
        if (Object.hasOwn(metadata, key)) {
            throw new DraftError("DUPLICATE_FRONT_MATTER_KEY", `Duplicate front matter key: ${key}.`);
        }
        metadata[key] = parseScalar(line.slice(separator + 1).trim());
    }

    return {
        metadata,
        body: normalized.slice(match[0].length),
    };
}

export function serializeFrontMatter(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new DraftError("INVALID_METADATA", "Front matter metadata must be an object.");
    }

    const lines = ["---"];
    for (const key of Object.keys(metadata)) {
        if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
            throw new DraftError("INVALID_FRONT_MATTER", `Invalid front matter key: ${key}.`);
        }
        const value = metadata[key];
        if (value === null || typeof value === "object") {
            throw new DraftError("INVALID_FRONT_MATTER", `Front matter value must be scalar: ${key}.`);
        }
        lines.push(`${key}: ${formatScalar(value)}`);
    }
    lines.push("---", "");
    return `${lines.join("\n")}\n`;
}

export function parseDraftDocument(source) {
    const parsed = parseFrontMatter(source);
    return {
        ...parsed,
        source: source.replace(/\r\n/g, "\n"),
    };
}

export function validateDraftDocument(document, options = {}) {
    let parsed;
    const errors = [];
    try {
        parsed = typeof document === "string" ? parseDraftDocument(document) : document;
    } catch (error) {
        return {
            valid: false,
            errors: [error instanceof DraftError ? error.message : String(error)],
            metadata: {},
            missingSections: [...DRAFT_SECTIONS],
        };
    }

    if (!parsed || typeof parsed !== "object" || !parsed.metadata || typeof parsed.body !== "string") {
        return {
            valid: false,
            errors: ["Draft document must contain metadata and body."],
            metadata: {},
            missingSections: [...DRAFT_SECTIONS],
        };
    }

    errors.push(...validateDraftMetadata(parsed.metadata, options));
    const requiredSections = [
        ...(options.requiredSections ?? DRAFT_SECTIONS),
        ...(parsed.metadata?.input_profile === "detailed-plan" ? DETAILED_PLAN_SECTIONS : []),
    ];
    const missingSections = requiredSections.filter((section) => !parsed.body.includes(section));
    if (missingSections.length > 0) {
        errors.push(`Missing draft sections: ${missingSections.join(", ")}.`);
    }
    errors.push(...validateQuestionPresentation(parsed.body, parsed.metadata));
    errors.push(...validateSessionStrategyPresentation(parsed.body));

    return {
        valid: errors.length === 0,
        errors,
        metadata: parsed.metadata,
        missingSections,
    };
}

export function validateDraftMetadata(metadata, options = {}) {
    const kind = options.kind ?? (metadata?.source_kind === "derived-work-package" ? "derived" : "main");
    return [
        ...validateRequiredMetadata(metadata),
        ...validateMetadataEnums(metadata),
        ...validateMetadataTimestamps(metadata),
        ...validateProfileMetadata(metadata),
        ...validateKindMetadata(metadata, kind),
    ];
}

export function buildSourceIdentity(source) {
    const kind = source?.source_kind;
    if (kind === "github-issue") {
        const issue = requireIssueId(source.issue_number ?? source.issue);
        const owner = source.owner ?? parseGitHubSourceRef(source.source_ref).owner;
        const repo = source.repo ?? parseGitHubSourceRef(source.source_ref).repo;
        requireIdentifier(owner, "owner");
        requireIdentifier(repo, "repo");
        return `${owner}/${repo}/${issue}`;
    }
    if (kind === "file") {
        return `file:${requireValue(source.source_ref, "source_ref")}`;
    }
    if (kind === "user-input") {
        return `user:${requireValue(source.source_ref ?? source.title, "source_ref")}`;
    }
    if (kind === "derived-work-package") {
        const parent = requireValue(source.parent_identity ?? source.parent_draft, "parent_identity");
        const packageId = requireValue(source.work_package_id, "work_package_id");
        return `${parent}/wp/${packageId}`;
    }
    throw new DraftError("INVALID_SOURCE_IDENTITY", `Unsupported source kind: ${kind ?? ""}.`);
}

export function buildDraftPath(source, options = {}) {
    const draftRoot = safeRelativePath(options.draftRoot ?? "docs/draft", "draftRoot");
    const maxLength = options.maxSlugLength ?? 80;
    const kind = source?.source_kind;
    let filename;

    if (kind === "github-issue") {
        const issue = requireIssueId(source.issue_number ?? source.issue);
        filename = `issue-${issue}-plan.md`;
    } else if (kind === "derived-work-package") {
        const issue = requireIssueId(source.issue_number ?? source.issue);
        const packageId = requirePackageId(source.work_package_id).toLowerCase();
        filename = `issue-${issue}-wp-${packageId}-plan.md`;
    } else if (kind === "file") {
        const title = source?.title ?? source?.package_title ?? source?.source_ref ?? "";
        const slug = slugifyTitle(title, {maxLength}) || "task";
        filename = `task-file-${slug}-plan.md`;
    } else if (kind === "user-input") {
        const title = source?.title ?? source?.package_title ?? source?.source_ref ?? "";
        const slug = slugifyTitle(title, {maxLength}) || "task";
        filename = `task-${slug}-plan.md`;
    } else {
        throw new DraftError("INVALID_DRAFT_PATH", `Unsupported source kind: ${kind ?? ""}.`);
    }

    return path.posix.join(draftRoot, filename);
}

export function buildDraftMetadata(source, options = {}) {
    const now = requireTimestamp(options.now, "now");
    const kind = source?.source_kind;
    const metadata = {
        source_kind: kind,
        source_ref: requireValue(deriveSourceRef(source, kind), "source_ref"),
        input_profile: source.input_profile ?? "brief-request",
        plan_status: options.planStatus ?? (source.input_profile === "title-only" ? "needs-clarification" : "review-pending"),
        package_decision_gate: options.packageDecisionGate ?? "closed",
        plan_version: String(options.planVersion ?? 1),
        simplification_status: options.simplificationStatus ?? "pending",
        fetched_at: source.fetched_at ?? now,
        source_updated_at: source.source_updated_at ?? now,
    };

    if (metadata.input_profile === "title-only") {
        metadata.plan_status = "needs-clarification";
        metadata.package_decision_gate = "closed";
    }
    if (kind === "github-issue") {
        metadata.issue = requireIssueId(source.issue_number ?? source.issue);
        metadata.title = source.title
            ? requireValue(source.title, "title")
            : (options.placeholderTitle ?? DEFAULT_PENDING_TITLE);
    }
    if (kind === "derived-work-package") {
        metadata.parent_draft = requireValue(source.parent_draft, "parent_draft");
        metadata.parent_issue = requireIssueId(source.issue_number ?? source.issue);
        metadata.work_package_id = requirePackageId(source.work_package_id);
        metadata.plan_status = "needs-clarification";
        metadata.package_decision_gate = "closed";
    }

    return metadata;
}

export function renderQuestionSections(input = {}) {
    const scopeQuestions = input.scope_questions ?? input.scopeQuestions ?? [];
    const packages = input.packages ?? [];
    const packageDecisionGate = input.package_decision_gate
        ?? input.packageDecisionGate
        ?? (["awaiting-package-decisions", "approved"].includes(input.plan_status) ? "open" : "closed");
    const errors = validateQuestionRecords(scopeQuestions, {scope: "scope"});

    if (!["open", "closed"].includes(packageDecisionGate)) {
        errors.push("package_decision_gate must be open or closed.");
    }

    if (!Array.isArray(packages)) {
        errors.push("packages must be an array.");
    }

    const packageRecords = Array.isArray(packages) ? packages : [];
    for (const [index, packageRecord] of packageRecords.entries()) {
        if (!packageRecord || typeof packageRecord !== "object" || Array.isArray(packageRecord)) {
            errors.push(`Package ${index + 1} must be an object.`);
            continue;
        }
        let packageId;
        try {
            packageId = requirePackageId(packageRecord.id);
        } catch (error) {
            errors.push(error instanceof DraftError ? error.message : String(error));
            continue;
        }
        if (!Array.isArray(packageRecord.questions)) {
            errors.push(`${packageId} must declare questions as an array.`);
            continue;
        }
        errors.push(...validateQuestionRecords(packageRecord.questions, {packageId}).map((error) => {
            return `${packageId}: ${error}`;
        }));
    }

    if (errors.length > 0) {
        throw new DraftError("INVALID_QUESTION_RECORDS", errors.join(" "), {errors});
    }
    if (packageDecisionGate === "open" && scopeQuestions.some((question) => question.resolved !== true)) {
        throw new DraftError(
            "PACKAGE_DECISION_GATE_FAILED",
            "Package decision gate cannot open while scope questions remain unresolved.",
        );
    }

    const lines = [
        "## Decisions and open questions",
        "",
        "### Decyzje zakresowe przed decyzjami pakietowymi",
        "",
        ...renderQuestionList(scopeQuestions),
    ];

    if (packageDecisionGate !== "open") {
        lines.push(
            "",
            "### Decyzje pakietowe",
            "",
            "- Niedostępne: `package_decision_gate` jest zamknięta. Najpierw zakończ review, uproszczenie i decyzje zakresowe.",
        );
        return `${lines.join("\n")}\n`;
    }

    for (const packageRecord of packageRecords) {
        const packageId = requirePackageId(packageRecord.id);
        const title = markdownInline(packageRecord.title ?? packageRecord.goal ?? packageId);
        const questions = packageRecord.questions;
        const blocking = questions.filter((question) => question.blocking === true);
        const nonBlocking = questions.filter((question) => question.blocking !== true);
        const decisionStatus = packageRecord.decision_status ?? "pending";
        const decisionLine = TERMINAL_PACKAGE_STATUSES.includes(decisionStatus)
            ? "**Decyzje:** Pakiet terminalny; ponowne otwarcie wymaga jawnej prośby użytkownika."
            : "**Dostępne decyzje:** `accept` / `revise` / `exclude` / `separate`";
        lines.push(
            "",
            `### ${packageId} — ${title}`,
            "",
            `**Status:** \`${markdownInline(decisionStatus)}\`<br>`,
            decisionLine,
            "",
            "#### Pytania blokujące",
            "",
            ...renderQuestionList(blocking),
            "",
            "#### Pytania nieblokujące",
            "",
            ...renderQuestionList(nonBlocking),
        );
    }

    return `${lines.join("\n")}\n`;
}

export function prepareResumeMetadata(existingMetadata, incomingSource, options = {}) {
    const existingIdentity = buildSourceIdentity(toSourceIdentityInput(existingMetadata));
    const incomingIdentity = buildSourceIdentity(incomingSource);
    if (existingIdentity !== incomingIdentity) {
        throw new DraftError("SOURCE_IDENTITY_MISMATCH", "Resume source does not match the existing draft.", {
            existingIdentity,
            incomingIdentity,
        });
    }

    if (!isPositiveInteger(existingMetadata?.plan_version)) {
        throw new DraftError("INVALID_METADATA", "Existing draft plan_version must be a positive integer.");
    }

    return {
        ...existingMetadata,
        plan_version: String(Number(existingMetadata.plan_version) + 1),
        fetched_at: options.now ?? existingMetadata.fetched_at,
        source_updated_at: incomingSource.source_updated_at ?? existingMetadata.source_updated_at,
    };
}

export function writeAtomicFile(filePath, contents, options = {}) {
    const fsOps = options.fsOps ?? fs;
    const target = path.resolve(filePath);
    if (options.rootDir) {
        assertInsideRoot(target, options.rootDir);
    }
    const temporary = `${target}.tmp-${process.pid}`;
    try {
        fsOps.mkdirSync(path.dirname(target), {recursive: true});
        fsOps.writeFileSync(temporary, contents, "utf8");
        fsOps.renameSync(temporary, target);
        return {path: target, written: true};
    } catch (error) {
        try {
            fsOps.unlinkSync(temporary);
        } catch {
            // Cleanup is best effort; the original target remains untouched.
        }
        throw new DraftError("DRAFT_WRITE_FAILED", `Could not write draft ${target}.`, {
            cause: error instanceof Error ? error.message : String(error),
            path: target,
        });
    }
}

export function writeSeparatedDraft({derivedPath, derivedContent, parentPath, parentContent, writeFile = writeAtomicFile}) {
    try {
        writeFile(derivedPath, derivedContent);
    } catch (error) {
        return separationFailure(error, false);
    }

    try {
        writeFile(parentPath, parentContent);
    } catch (error) {
        return separationFailure(error, true);
    }

    return {
        ok: true,
        parent_written: true,
        derived_written: true,
        package_status: "separated",
    };
}

export function renderSessionStrategySection(strategy) {
    const errors = validateSessionStrategy(strategy);
    if (errors.length > 0) {
        throw new DraftError("INVALID_SESSION_STRATEGY", errors.join(" "), {errors});
    }
    const stages = strategy.stages.map((stage, index) => {
        const packages = stage.work_package_ids.length > 0 ? stage.work_package_ids.join(", ") : "none yet";
        const dependencies = stage.dependencies.length > 0 ? stage.dependencies.map(markdownInline).join(", ") : "none";
        return `${index + 1}. ${markdownInline(stage.id)} ${markdownInline(stage.title)} — ${markdownInline(stage.rationale)} [${packages}; zależności: ${dependencies}; ${markdownInline(stage.session_boundary)}; wejście: ${stage.entry_criteria.map(markdownInline).join(", ")}; wyjście: ${stage.exit_criteria.map(markdownInline).join(", ")}]`;
    }).join("; ");
    return [
        "## Session strategy",
        "",
        `- Mode: \`${markdownInline(strategy.mode)}\``,
        `- Rationale: ${markdownInline(strategy.rationale)}`,
        `- Stages: ${stages}`,
        `- Work packages: ${strategy.stages.flatMap((stage) => stage.work_package_ids).join(", ") || "none yet"}`,
        `- Session boundary recommendation: ${markdownInline(strategy.session_boundary_recommendation)}`,
        `- Dependencies: ${strategy.dependencies.length > 0 ? strategy.dependencies.join(", ") : "none"}`,
        `- Entry criteria: ${strategy.entry_criteria.map(markdownInline).join("; ")}`,
        `- Exit criteria: ${strategy.exit_criteria.map(markdownInline).join("; ")}`,
        "",
    ].join("\n");
}

export function renderInitialDraftDocument(metadata) {
    const strategySection = renderSessionStrategySection(INITIAL_SESSION_STRATEGY).trimEnd();
    const body = [
        "## Source",
        "",
        "- Source fetch pending; provenance is recorded after intake.",
        "",
        strategySection,
        "",
        "## Goal and scope",
        "",
        "- To be established from the fetched source.",
        "",
        "## Work packages",
        "",
        "- None yet.",
        "",
        "## Decisions and open questions",
        "",
        "### Decyzje zakresowe przed decyzjami pakietowymi",
        "",
        "- Brak.",
        "",
        "### Decyzje pakietowe",
        "",
        "- Niedostępne: `package_decision_gate` jest zamknięta. Najpierw zakończ review, uproszczenie i decyzje zakresowe.",
        "",
        "## Evidence, risks and review",
        "",
        "- No evidence is collected before source fetch.",
        "",
        "## Acceptance and verification",
        "",
        "- To be established from the fetched source.",
        "",
        "## Next action",
        "",
        "- Fetch and assess the source, then update this draft atomically.",
        "",
        "## Execution handoff (when implementation is requested)",
        "",
        "- Not applicable for an initial draft.",
        "",
    ].join("\n");
    return `${serializeFrontMatter(metadata)}${body}`;
}

export function createInitialDraft({source, now, draftRoot = "docs/draft", rootDir, writeFile = writeAtomicFile} = {}) {
    if (!source || typeof source !== "object") {
        throw new DraftError("INVALID_SOURCE_IDENTITY", "Initial draft requires a source identity object.");
    }
    const metadata = buildDraftMetadata(source, {now});
    const relativePath = buildDraftPath(source, {draftRoot});
    const target = rootDir ? path.resolve(rootDir, relativePath) : path.resolve(relativePath);
    const content = renderInitialDraftDocument(metadata);
    writeFile(target, content, rootDir ? {rootDir} : {});
    return {
        path: relativePath,
        target,
        content,
        metadata,
        written: true,
    };
}

function validateRequiredMetadata(metadata) {
    const errors = [];
    const required = [
        "source_kind",
        "source_ref",
        "input_profile",
        "plan_status",
        "package_decision_gate",
        "plan_version",
        "simplification_status",
        "fetched_at",
        "source_updated_at",
    ];

    for (const key of required) {
        if (typeof metadata?.[key] !== "string" || metadata[key].trim() === "") {
            errors.push(`Missing metadata field: ${key}.`);
        }
    }
    return errors;
}

function validateMetadataEnums(metadata) {
    const errors = [];
    if (!SOURCE_KINDS.includes(metadata?.source_kind)) {
        errors.push(`Invalid source_kind: ${metadata?.source_kind ?? ""}.`);
    }
    if (!INPUT_PROFILES.includes(metadata?.input_profile)) {
        errors.push(`Invalid input_profile: ${metadata?.input_profile ?? ""}.`);
    }
    if (!PLAN_STATUSES.includes(metadata?.plan_status)) {
        errors.push(`Invalid plan_status: ${metadata?.plan_status ?? ""}.`);
    }
    if (!SIMPLIFICATION_STATUSES.includes(metadata?.simplification_status)) {
        errors.push(`Invalid simplification_status: ${metadata?.simplification_status ?? ""}.`);
    }
    if (Object.hasOwn(metadata, "package_decision_gate")
        && !["open", "closed"].includes(metadata.package_decision_gate)) {
        errors.push(`Invalid package_decision_gate: ${metadata.package_decision_gate ?? ""}.`);
    }
    if (Object.hasOwn(metadata, "package_decision_gate")) {
        const packageDecisionStatuses = ["awaiting-package-decisions", "approved"];
        const reviewStatuses = ["review-pending", "needs-clarification", "review-limit-reached"];
        if (packageDecisionStatuses.includes(metadata.plan_status) && metadata.package_decision_gate !== "open") {
            errors.push("Package decision gate must be open before package decisions or approval.");
        }
        if (reviewStatuses.includes(metadata.plan_status) && metadata.package_decision_gate !== "closed") {
            errors.push("Package decision gate must be closed before review is complete.");
        }
    }
    if (!isPositiveInteger(metadata?.plan_version)) {
        errors.push("plan_version must be a positive integer.");
    }
    return errors;
}

function validateMetadataTimestamps(metadata) {
    const errors = [];
    for (const key of ["fetched_at", "source_updated_at"]) {
        if (typeof metadata?.[key] === "string" && Number.isNaN(Date.parse(metadata[key]))) {
            errors.push(`${key} must be a valid timestamp.`);
        }
    }
    return errors;
}

function validateProfileMetadata(metadata) {
    if (metadata?.input_profile === "title-only" && metadata?.plan_status !== "needs-clarification") {
        return ["A title-only draft must use plan_status: needs-clarification."];
    }
    return [];
}

function validateKindMetadata(metadata, kind) {
    if (kind === "derived" || metadata?.source_kind === "derived-work-package") {
        return validateDerivedMetadata(metadata);
    }
    if (metadata?.source_kind === "github-issue") {
        return validateGitHubMetadata(metadata);
    }
    return [];
}

function validateSessionStrategyPresentation(body) {
    const headingMatch = /^##\s+Session strategy\s*$/m.exec(body);
    if (!headingMatch) {
        return [];
    }
    const sectionStart = headingMatch.index + headingMatch[0].length;
    const remainder = body.slice(sectionStart);
    const nextSection = remainder.search(/^##\s/m);
    const section = nextSection >= 0 ? remainder.slice(0, nextSection) : remainder;
    return SESSION_STRATEGY_LABELS
        .filter((label) => !section.includes(label))
        .map((label) => `Session strategy section is missing ${label}`);
}

function validateQuestionPresentation(body, metadata = {}) {
    const headingMatch = /^##\s+Decisions and open questions\s*$/m.exec(body);
    if (!headingMatch) {
        return [];
    }
    const sectionStart = headingMatch.index + headingMatch[0].length;
    const remainder = body.slice(sectionStart);
    const nextSection = remainder.search(/^##\s/m);
    const section = nextSection >= 0 ? remainder.slice(0, nextSection) : remainder;
    const errors = [];
    if (!section.includes("### Decyzje zakresowe przed decyzjami pakietowymi")) {
        errors.push("Question section must contain the scope questions subsection.");
    }
    const packageHeadings = [...section.matchAll(/^###\s+(WP[1-9][0-9]*)\s+—\s+.+$/gm)];
    const packageDecisionGate = metadata.package_decision_gate;

    if (packageDecisionGate === "closed") {
        if (packageHeadings.length > 0) {
            errors.push("A closed package decision gate must not contain Work Package decision sections.");
        }
        if (!section.includes("### Decyzje pakietowe")) {
            errors.push("A closed package decision gate must contain the unavailable package decisions notice.");
        }
    }
    if (packageDecisionGate === "open") {
        if (packageHeadings.length === 0) {
            errors.push("An open package decision gate must contain Work Package sections.");
        }
        errors.push(...packageHeadings.flatMap((match, index) => {
            return validatePackageQuestionSection(match, index, packageHeadings, section);
        }));
    }

    if (/\*\*Pytania:\*\*/i.test(section)) {
        errors.push("Questions must be rendered as separate structured records, not an aggregate Pytania paragraph.");
    }
    return errors;
}

function validatePackageQuestionSection(match, index, packageHeadings, section) {
    const packageStart = match.index ?? 0;
    const packageEnd = packageHeadings[index + 1]?.index ?? section.length;
    const packageSection = section.slice(packageStart, packageEnd);
    const requiredSubsections = ["#### Pytania blokujące", "#### Pytania nieblokujące"];
    const errors = requiredSubsections
        .filter((subsection) => !packageSection.includes(subsection))
        .map((subsection) => `${match[1]} is missing ${subsection}.`);

    if (!packageSection.includes("**Status:**")) {
        errors.push(`${match[1]} is missing its status.`);
    }
    if (!packageSection.includes("**Dostępne decyzje:**")
        && !packageSection.includes("**Decyzje:** Pakiet terminalny")) {
        errors.push(`${match[1]} is missing its decision instruction.`);
    }
    return errors;
}

function validateDerivedMetadata(metadata) {
    const errors = [];
    for (const key of ["parent_draft", "work_package_id"]) {
        if (typeof metadata?.[key] !== "string" || metadata[key].trim() === "") {
            errors.push(`Missing derived draft field: ${key}.`);
        }
    }
    if (metadata?.source_kind !== "derived-work-package") {
        errors.push("Derived drafts must use source_kind: derived-work-package.");
    }
    if (metadata?.plan_status !== "needs-clarification") {
        errors.push("A derived draft must start with plan_status: needs-clarification.");
    }
    return errors;
}

function validateGitHubMetadata(metadata) {
    const errors = [];
    for (const key of ["issue", "title"]) {
        if (typeof metadata?.[key] !== "string" || metadata[key].trim() === "") {
            errors.push(`Missing GitHub draft field: ${key}.`);
        }
    }
    if (typeof metadata?.issue === "string" && !/^[1-9][0-9]*$/.test(metadata.issue)) {
        errors.push("issue must be a positive integer string.");
    }
    return errors;
}

function separationFailure(error, derivedWritten) {
    return {
        ok: false,
        parent_written: false,
        derived_written: derivedWritten,
        package_status: "pending",
        error: error instanceof Error ? error.message : String(error),
    };
}

function parseScalar(value) {
    if (value.startsWith('"') && value.endsWith('"')) {
        try {
            return JSON.parse(value);
        } catch {
            throw new DraftError("INVALID_FRONT_MATTER", `Invalid quoted value: ${value}.`);
        }
    }
    if (value.startsWith("'") && value.endsWith("'")) {
        return value.slice(1, -1).replace(/''/g, "'");
    }
    return value;
}

function formatScalar(value) {
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    return String(value);
}

function isPositiveInteger(value) {
    return (typeof value === "number" && Number.isInteger(value) && value > 0)
        || (typeof value === "string" && /^[1-9][0-9]*$/.test(value));
}

function requireValue(value, name) {
    if (typeof value !== "string" && typeof value !== "number") {
        throw new DraftError("INVALID_VALUE", `${name} is required.`);
    }
    const result = String(value).trim();
    if (result === "") {
        throw new DraftError("INVALID_VALUE", `${name} is required.`);
    }
    return result;
}

function requireIssueId(value) {
    const issue = requireValue(value, "issue_number");
    if (!/^[1-9][0-9]*$/.test(issue)) {
        throw new DraftError("INVALID_SOURCE_IDENTITY", "GitHub issue number must be positive.");
    }
    return issue;
}

function requirePackageId(value) {
    const packageId = requireValue(value, "work_package_id");
    if (!/^WP[1-9][0-9]*$/i.test(packageId)) {
        throw new DraftError("INVALID_DRAFT_PATH", "work_package_id must match WP<number>.");
    }
    return packageId;
}

function requireIdentifier(value, name) {
    const identifier = requireValue(value, name);
    if (!/^[A-Za-z0-9_.-]+$/.test(identifier)) {
        throw new DraftError("INVALID_SOURCE_IDENTITY", `${name} contains unsupported characters.`);
    }
    return identifier;
}

function requireTimestamp(value, name) {
    const timestamp = requireValue(value, name);
    if (Number.isNaN(Date.parse(timestamp))) {
        throw new DraftError("INVALID_TIMESTAMP", `${name} must be a valid timestamp.`);
    }
    return timestamp;
}

function safeRelativePath(value, name) {
    const normalized = path.posix.normalize(String(value).replaceAll("\\", "/"));
    if (normalized === "." || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
        throw new DraftError("UNSAFE_PATH", `${name} must be a relative path inside the draft root.`);
    }
    return normalized;
}

function assertInsideRoot(target, rootDir) {
    const root = path.resolve(rootDir);
    const relative = path.relative(root, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new DraftError("UNSAFE_PATH", "Draft target must remain inside rootDir.", {target, root});
    }
}

function parseGitHubSourceRef(value) {
    const sourceRef = typeof value === "string" ? value : "";
    const match = sourceRef.match(/^[a-z]+:\/\/[^/]+\/([^/]+)\/([^/]+)\/issues\/[1-9][0-9]*/i);
    if (!match) {
        throw new DraftError("INVALID_SOURCE_IDENTITY", "GitHub source_ref must contain owner and repo.");
    }
    return {owner: match[1], repo: match[2]};
}

function deriveSourceRef(source, kind) {
    if (source?.source_ref) {
        return source.source_ref;
    }
    if (kind === "github-issue") {
        const owner = source?.owner;
        const repo = source?.repo;
        if (typeof owner === "string" && owner.trim() !== "" && typeof repo === "string" && repo.trim() !== "") {
            const issue = requireIssueId(source.issue_number ?? source.issue);
            return `https://github.com/${owner}/${repo}/issues/${issue}`;
        }
    }
    return null;
}

function toSourceIdentityInput(metadata) {
    return {
        source_kind: metadata.source_kind,
        source_ref: metadata.source_ref,
        issue: metadata.issue,
        title: metadata.title,
        parent_draft: metadata.parent_draft,
        work_package_id: metadata.work_package_id,
        parent_identity: metadata.source_ref,
    };
}

function parseArgs(args) {
    const parsed = {command: args.shift() ?? null, values: {}};
    while (args.length > 0) {
        const key = args.shift();
        if (!key.startsWith("--")) {
            throw new DraftError("INVALID_ARGUMENT", `Unexpected argument: ${key}.`);
        }
        const value = args.shift();
        if (typeof value !== "string") {
            throw new DraftError("INVALID_ARGUMENT", `Missing value for ${key}.`);
        }
        parsed.values[key.slice(2)] = value;
    }
    return parsed;
}

function cliResult(parsed) {
    if (parsed.command === "path") {
        return {
            path: buildDraftPath({
                source_kind: parsed.values["source-kind"],
                issue: parsed.values.issue,
                title: parsed.values.title,
                work_package_id: parsed.values["work-package-id"],
                package_title: parsed.values["package-title"],
            }, {draftRoot: parsed.values.root ?? "docs/draft"}),
        };
    }
    if (parsed.command === "validate") {
        const source = fs.readFileSync(path.resolve(parsed.values.file), "utf8");
        return validateDraftDocument(source, {kind: parsed.values.kind ?? "main"});
    }
    if (parsed.command === "render-questions") {
        const source = JSON.parse(fs.readFileSync(path.resolve(parsed.values.file), "utf8"));
        return {markdown: renderQuestionSections(source)};
    }
    throw new DraftError("INVALID_COMMAND", "Use path or validate.");
}

function main(args) {
    if (args[0] === "--help") {
        process.stdout.write("Usage: draft.mjs path --source-kind <kind> [--issue <id>] [--title <title>] | validate --file <path> [--kind <main|derived>] | render-questions --file <json>\n");
        return 0;
    }
    try {
        const result = cliResult(parseArgs(args));
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result?.valid === false ? 1 : 0;
    } catch (error) {
        const result = error instanceof DraftError
            ? {valid: false, code: error.code, message: error.message}
            : {valid: false, code: "UNEXPECTED_ERROR", message: String(error)};
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return CLI_CONTRACT_REJECTIONS.includes(result.code) ? 1 : 2;
    }
}

function renderQuestionList(questions) {
    if (questions.length === 0) {
        return ["- Brak."];
    }

    return questions.flatMap((question) => {
        const marker = question.blocking ? "BLOCKING" : "NON-BLOCKING";
        const status = question.resolved ? "resolved" : "open";
        const lines = [
            `- **${question.id} [${marker}]** ${markdownInline(question.prompt)}`,
            `  - Wpływ: ${markdownInline(question.impact)}`,
            `  - Wymagana decyzja: ${markdownInline(question.decision_needed)}`,
            `  - Status: \`${status}\``,
        ];
        if (question.context) {
            lines.push(`  - Kontekst: ${markdownInline(question.context)}`);
        }
        if (Array.isArray(question.options) && question.options.length > 0) {
            lines.push("  - Opcje:");
            for (const option of question.options) {
                const optionTitle = markdownInline(option.label ?? option.description ?? option.id);
                lines.push(`    - \`${markdownInline(option.id)}\` — ${optionTitle}`);
                lines.push(`      - Konsekwencja/tradeoff: ${markdownInline(option.consequence)}`);
            }
        }
        if (question.resolved) {
            const selected = Array.isArray(question.options)
                ? question.options.find((option) => option.id === question.answer)
                : null;
            lines.push(selected
                ? `  - Odpowiedź: \`${markdownInline(selected.id)}\` — ${markdownInline(selected.label ?? selected.description ?? selected.id)}`
                : `  - Odpowiedź: ${markdownInline(question.answer)}`);
        }
        return lines;
    });
}

function markdownInline(value) {
    return String(value)
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[\\`*_]/g, "\\$&");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
