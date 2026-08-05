#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {slugifyTitle} from "../../_shared/scripts/slugify-title.mjs";
import {
    PLAN_STATUSES,
    SIMPLIFICATION_STATUSES,
} from "./state.mjs";

export const DRAFT_SECTIONS = Object.freeze([
    "## Source",
    "## Goal and scope",
    "## Work packages",
    "## Decisions and open questions",
    "## Evidence, risks and review",
    "## Acceptance and verification",
    "## Next action",
    "## Execution handoff (when implementation is requested)",
]);

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
    const title = source?.title ?? source?.package_title ?? source?.source_ref ?? "";
    const slug = slugifyTitle(title, {maxLength}) || "task";
    let filename;

    if (kind === "github-issue") {
        const issue = requireIssueId(source.issue_number ?? source.issue);
        filename = `issue-${issue}-${slug}-plan.md`;
    } else if (kind === "derived-work-package") {
        const issue = requireIssueId(source.issue_number ?? source.issue);
        const packageId = requirePackageId(source.work_package_id).toLowerCase();
        filename = `issue-${issue}-wp-${packageId}-${slug}-plan.md`;
    } else if (kind === "file") {
        filename = `task-file-${slug}-plan.md`;
    } else if (kind === "user-input") {
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
        source_ref: requireValue(source?.source_ref, "source_ref"),
        input_profile: source.input_profile ?? "brief-request",
        plan_status: options.planStatus ?? (source.input_profile === "title-only" ? "needs-clarification" : "awaiting-package-decisions"),
        plan_version: String(options.planVersion ?? 1),
        simplification_status: options.simplificationStatus ?? "pending",
        fetched_at: source.fetched_at ?? now,
        source_updated_at: source.source_updated_at ?? now,
    };

    if (metadata.input_profile === "title-only") {
        metadata.plan_status = "needs-clarification";
    }
    if (kind === "github-issue") {
        metadata.issue = requireIssueId(source.issue_number ?? source.issue);
        metadata.title = requireValue(source.title, "title");
    }
    if (kind === "derived-work-package") {
        metadata.parent_draft = requireValue(source.parent_draft, "parent_draft");
        metadata.parent_issue = requireIssueId(source.issue_number ?? source.issue);
        metadata.work_package_id = requirePackageId(source.work_package_id);
        metadata.plan_status = "needs-clarification";
    }

    return metadata;
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

function validateRequiredMetadata(metadata) {
    const errors = [];
    const required = [
        "source_kind",
        "source_ref",
        "input_profile",
        "plan_status",
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
    throw new DraftError("INVALID_COMMAND", "Use path or validate.");
}

function main(args) {
    if (args[0] === "--help") {
        process.stdout.write("Usage: draft.mjs path --source-kind <kind> [--issue <id>] [--title <title>] | validate --file <path> [--kind <main|derived>]\n");
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
