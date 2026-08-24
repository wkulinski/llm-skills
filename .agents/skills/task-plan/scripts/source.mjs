#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {writeFileAtomic} from "./atomic-file.mjs";

export class SourceError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "SourceError";
        this.code = code;
        this.details = details;
    }
}

export function normalizeGitHubIssue(input = {}, options = {}) {
    const owner = requiredString(input.owner, "owner");
    const repo = requiredString(input.repo, "repo");
    const issueNumber = positiveInteger(input.issue_number ?? input.issue, "issue_number");
    const body = optionalString(input.body);
    const comments = normalizeComments(input.comments);
    const title = optionalString(input.title);
    const fetchedAt = timestamp(options.fetched_at ?? input.fetched_at ?? new Date().toISOString(), "fetched_at");
    const updatedAt = nullableTimestamp(input.source_updated_at ?? input.updated_at, "source_updated_at");

    return freezeSource({
        source_kind: "github-issue",
        source_ref: input.source_ref ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
        identity: `${owner}/${repo}#${issueNumber}`,
        title,
        body,
        comments,
        authors: normalizeAuthors(input.authors ?? [input.author ?? input.user].filter(Boolean)),
        fetched_at: fetchedAt,
        source_updated_at: updatedAt,
        owner,
        repo,
        issue_number: issueNumber,
    });
}

export function normalizeFileSource({filePath, repoRoot = process.cwd(), fsOps = fs, options = {}} = {}) {
    const absolute = resolveSafePath(filePath, repoRoot);
    let body;
    try {
        body = fsOps.readFileSync(absolute, "utf8");
    } catch (error) {
        throw new SourceError("SOURCE_READ_FAILED", `Could not read ${absolute}.`, {
            cause: error instanceof Error ? error.message : String(error),
            path: absolute,
        });
    }
    const relative = path.relative(path.resolve(repoRoot), absolute).split(path.sep).join("/");
    const contentHash = sha256(body);
    return freezeSource({
        source_kind: "file",
        source_ref: `./${relative}`,
        identity: `file:${relative}:${contentHash.slice(0, 12)}`,
        title: optionalString(options.title) || path.basename(relative),
        body,
        comments: [],
        authors: normalizeAuthors(options.authors),
        fetched_at: timestamp(options.fetched_at ?? new Date().toISOString(), "fetched_at"),
        source_updated_at: nullableTimestamp(options.source_updated_at, "source_updated_at"),
    });
}

export function normalizeUserInput(input = {}, options = {}) {
    const body = requiredString(input.body ?? input.text, "body");
    const explicitIdentity = optionalString(input.identity ?? options.identity);
    const identity = explicitIdentity || `user-input:${sha256(body).slice(0, 12)}`;
    return freezeSource({
        source_kind: "user-input",
        source_ref: optionalString(input.source_ref) || identity,
        identity,
        title: optionalString(input.title),
        body,
        comments: normalizeComments(input.comments),
        authors: normalizeAuthors(input.authors),
        fetched_at: timestamp(options.fetched_at ?? input.fetched_at ?? new Date().toISOString(), "fetched_at"),
        source_updated_at: nullableTimestamp(input.source_updated_at, "source_updated_at"),
    });
}

export function validateNormalizedSource(source) {
    const errors = [];
    if (!source || typeof source !== "object" || Array.isArray(source)) {
        return {valid: false, errors: ["Source must be an object."]};
    }
    if (!["github-issue", "file", "user-input"].includes(source.source_kind)) {
        errors.push("source_kind is invalid.");
    }
    for (const field of ["source_ref", "identity", "fetched_at"]) {
        if (typeof source[field] !== "string" || source[field].trim() === "") {
            errors.push(`${field} must be a non-empty string.`);
        }
    }
    if (typeof source.body !== "string") {
        errors.push("body must be a string.");
    } else if (source.body.trim() === ""
        && (source.source_kind !== "github-issue" || typeof source.title !== "string" || source.title.trim() === "")) {
        errors.push("body must be non-empty unless a GitHub issue has a non-empty title.");
    }
    if (typeof source.fetched_at === "string" && Number.isNaN(Date.parse(source.fetched_at))) {
        errors.push("fetched_at must be a valid timestamp.");
    }
    if (!Array.isArray(source.comments)) {
        errors.push("comments must be an array.");
    }
    if (!Array.isArray(source.authors)) {
        errors.push("authors must be an array.");
    }
    return {valid: errors.length === 0, errors};
}

export function sourceArtifact(source) {
    const result = validateNormalizedSource(source);
    if (!result.valid) {
        throw new SourceError("INVALID_SOURCE", result.errors.join(" "), {errors: result.errors});
    }
    const content = `${stableStringify(source, 2)}\n`;
    return {content, sha256: sha256(content)};
}

export function buildPlanId(sourceIdentity) {
    const identity = requiredString(sourceIdentity, "source_identity");
    const hash = sha256(identity).slice(0, 8);
    const issue = identity.match(/#([1-9][0-9]*)$/)?.[1];
    if (issue) {
        return `v2-issue-${issue}-${hash}`;
    }
    const slug = identity
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "plan";
    return `v2-${slug}-${hash}`;
}

export function resolveSourceArtifactPath({repoRoot = process.cwd(), sourceIdentity} = {}) {
    const root = path.resolve(requiredString(repoRoot, "repo_root"));
    const planId = buildPlanId(sourceIdentity);
    const artifactPath = path.resolve(root, "var", "agent", "task-plan", planId, "source.json");
    return {repoRoot: root, planId, artifactPath};
}

export function persistSource(source, options = {}) {
    const fsOps = options.fsOps ?? fs;
    const paths = resolveSourceArtifactPath({repoRoot: options.repoRoot ?? process.cwd(), sourceIdentity: source?.identity});
    const artifact = sourceArtifact(source);
    writeFileAtomic(paths.artifactPath, artifact.content, {rootDir: paths.repoRoot, fsOps});
    return {
        ok: true,
        plan_id: paths.planId,
        source_identity: source.identity,
        source_artifact: relativePath(paths.repoRoot, paths.artifactPath),
        source_sha256: artifact.sha256,
    };
}

export function loadPersistedSource({repoRoot = process.cwd(), sourceIdentity, fsOps = fs} = {}) {
    const paths = resolveSourceArtifactPath({repoRoot, sourceIdentity});
    if (!fsOps.existsSync(paths.artifactPath)) {
        throw new SourceError("SOURCE_ARTIFACT_MISSING", `Source artifact does not exist: ${paths.artifactPath}.`);
    }
    const content = fsOps.readFileSync(paths.artifactPath, "utf8");
    let source;
    try {
        source = JSON.parse(content);
    } catch (error) {
        throw new SourceError("SOURCE_ARTIFACT_INVALID", "Source artifact is not valid JSON.", {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    const result = validateNormalizedSource(source);
    if (!result.valid || source.identity !== sourceIdentity) {
        throw new SourceError("SOURCE_ARTIFACT_INVALID", "Source artifact does not match the requested identity.", {
            errors: result.errors,
        });
    }
    return {
        source,
        content,
        plan_id: paths.planId,
        source_artifact: relativePath(paths.repoRoot, paths.artifactPath),
        source_sha256: sha256(content),
    };
}

export function resolveSafePath(filePath, repoRoot) {
    const root = path.resolve(requiredString(repoRoot, "repoRoot"));
    const absolute = path.resolve(root, requiredString(filePath, "filePath"));
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new SourceError("UNSAFE_PATH", "Source file must remain inside repository root.", {root, path: absolute});
    }
    return absolute;
}

function freezeSource(source) {
    const result = validateNormalizedSource(source);
    if (!result.valid) {
        throw new SourceError("INVALID_SOURCE", result.errors.join(" "), {errors: result.errors});
    }
    return Object.freeze(source);
}

function normalizeComments(value) {
    if (typeof value === "undefined" || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new SourceError("INVALID_SOURCE", "comments must be an array.");
    }
    return value.map((comment, index) => {
        if (typeof comment === "string") {
            return {body: comment, author: null, created_at: null};
        }
        if (!comment || typeof comment !== "object" || Array.isArray(comment)) {
            throw new SourceError("INVALID_SOURCE", `comment ${index + 1} must be a string or object.`);
        }
        return {
            body: requiredString(comment.body, `comments[${index}].body`),
            author: optionalString(comment.author ?? comment.user) || null,
            created_at: nullableTimestamp(comment.created_at, `comments[${index}].created_at`),
        };
    });
}

function normalizeAuthors(value) {
    if (typeof value === "undefined" || value === null) {
        return [];
    }
    const records = Array.isArray(value) ? value : [value];
    return [...new Set(records.map((item) => {
        if (typeof item === "string") {
            return item.trim();
        }
        if (item && typeof item === "object") {
            return optionalString(item.login ?? item.name ?? item.username);
        }
        return "";
    }).filter(Boolean))];
}

function requiredString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new SourceError("INVALID_SOURCE", `${name} must be a non-empty string.`);
    }
    return value.trim();
}

function optionalString(value) {
    return typeof value === "string" ? value.trim() : "";
}

function positiveInteger(value, name) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1) {
        throw new SourceError("INVALID_SOURCE", `${name} must be a positive integer.`);
    }
    return number;
}

function timestamp(value, name) {
    const candidate = requiredString(value, name);
    if (Number.isNaN(Date.parse(candidate))) {
        throw new SourceError("INVALID_SOURCE", `${name} must be a valid timestamp.`);
    }
    return candidate;
}

function nullableTimestamp(value, name) {
    if (typeof value === "undefined" || value === null || value === "") {
        return null;
    }
    return timestamp(value, name);
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function stableStringify(value, space = 0) {
    return JSON.stringify(sortObject(value), null, space);
}

function relativePath(root, candidate) {
    return path.relative(root, candidate).split(path.sep).join("/");
}

function sortObject(value) {
    if (Array.isArray(value)) {
        return value.map(sortObject);
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

function parseArgs(argv) {
    const result = {_: []};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            result._.push(token);
            continue;
        }
        const key = token.slice(2).replaceAll("-", "_");
        const next = argv[index + 1];
        if (typeof next === "undefined" || next.startsWith("--")) {
            result[key] = true;
        } else {
            result[key] = next;
            index += 1;
        }
    }
    return result;
}

function readJson(filePath) {
    const content = filePath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(filePath), "utf8");
    return JSON.parse(content);
}

async function main(argv) {
    const args = parseArgs(argv);
    const command = args._[0];
    let result;
    if (command === "normalize-file") {
        result = normalizeFileSource({filePath: args.path, repoRoot: args.root ?? process.cwd()});
    } else if (command === "normalize-user") {
        result = normalizeUserInput(readJson(args.input));
    } else if (command === "normalize-github") {
        result = normalizeGitHubIssue(readJson(args.input));
    } else if (command === "persist") {
        result = persistSource(readJson(args.input), {repoRoot: args.root ?? process.cwd()});
    } else if (command === "validate") {
        result = validateNormalizedSource(readJson(args.input));
        if (!result.valid) {
            process.exitCode = 1;
        }
    } else {
        throw new SourceError("INVALID_ARGUMENT", "Usage: source.mjs normalize-file|normalize-user|normalize-github|persist|validate ...");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "SOURCE_ERROR", message: error.message, details: error.details ?? {}})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}
