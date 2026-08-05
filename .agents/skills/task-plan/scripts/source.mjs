#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

import {slugifyTitle} from "../../_shared/scripts/slugify-title.mjs";

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
    "UNSAFE_SOURCE_PATH",
    "EMPTY_USER_INPUT",
    "INVALID_PROFILE",
]);

export class SourceError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "SourceError";
        this.code = code;
        this.details = details;
    }
}

export function classifyInputProfile(input = {}) {
    const profileHint = input.profile_hint ?? input.input_profile;
    if (profileHint) {
        if (!INPUT_PROFILES.includes(profileHint)) {
            throw new SourceError("INVALID_PROFILE", `Unsupported input profile: ${profileHint}.`);
        }
        return profileHint;
    }

    const title = String(input.title ?? "").trim();
    const body = String(input.body ?? "").trim();
    const comments = normalizeComments(input.comments);
    if (title !== "" && body === "" && comments.length === 0) {
        return "title-only";
    }
    return "brief-request";
}

export function normalizeGitHubIssue(input, options = {}) {
    const owner = requireIdentifier(input?.owner, "owner");
    const repo = requireIdentifier(input?.repo, "repo");
    const issueNumber = requireIssueNumber(input?.issue_number ?? input?.number);
    const title = requireString(input?.title, "title");
    const body = String(input?.body ?? "");
    const comments = normalizeComments(input?.comments);
    const sourceRef = input?.url ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`;

    return {
        source_kind: "github-issue",
        source_ref: sourceRef,
        owner,
        repo,
        issue_number: String(issueNumber),
        title,
        body,
        comments,
        authors: normalizeAuthors(input?.author, comments),
        source_updated_at: input?.updatedAt ?? input?.source_updated_at ?? null,
        fetched_at: options.fetchedAt ?? input?.fetched_at ?? null,
        branch: input?.branch ?? null,
        base_ref: input?.base_ref ?? input?.base ?? null,
        input_profile: classifyInputProfile({
            title,
            body,
            comments,
            profile_hint: options.profileHint ?? input?.input_profile,
        }),
    };
}

export function normalizeFileSource({filePath, repoRoot, fsOps = fs, options = {}} = {}) {
    const safePath = resolveSafePath(filePath, repoRoot, fsOps);
    let body;
    try {
        body = fsOps.readFileSync(safePath.absolutePath, "utf8");
    } catch (error) {
        throw new SourceError("SOURCE_FILE_READ_FAILED", `Could not read source file ${safePath.relativePath}.`, {
            path: safePath.relativePath,
            cause: error instanceof Error ? error.message : String(error),
        });
    }

    const title = options.title ?? firstMarkdownHeading(body) ?? "";
    return {
        source_kind: "file",
        source_ref: safePath.relativePath,
        title,
        body,
        comments: [],
        authors: [],
        repository_root: safePath.rootPath,
        fetched_at: options.fetchedAt ?? null,
        source_updated_at: options.sourceUpdatedAt ?? null,
        input_profile: classifyInputProfile({
            title,
            body,
            profile_hint: options.profileHint,
        }),
    };
}

export function normalizeUserInput(input = {}) {
    const title = String(input.title ?? "").trim();
    const body = String(input.body ?? "");
    if (title === "" && body.trim() === "") {
        throw new SourceError("EMPTY_USER_INPUT", "User input must contain a title or body.");
    }

    return {
        source_kind: "user-input",
        source_ref: input.source_ref ?? (slugifyTitle(title || body) || "conversation"),
        title,
        body,
        comments: normalizeComments(input.comments),
        authors: normalizeAuthors(input.author, input.comments),
        repository_root: input.repository_root ?? null,
        branch: input.branch ?? null,
        base_ref: input.base_ref ?? null,
        fetched_at: input.fetched_at ?? null,
        source_updated_at: input.source_updated_at ?? null,
        input_profile: classifyInputProfile({
            title,
            body,
            comments: input.comments,
            profile_hint: input.profile_hint,
        }),
    };
}

export function fetchGitHubIssue({
    owner,
    repo,
    issueNumber,
    repoRoot = process.cwd(),
    execCommand,
    resolveCommand,
    fetchedAt,
    branch,
    base,
    baseRef,
} = {}) {
    const normalizedOwner = requireIdentifier(owner, "owner");
    const normalizedRepo = requireIdentifier(repo, "repo");
    const normalizedIssue = requireIssueNumber(issueNumber);
    const command = resolveCommand
        ? resolveCommand(repoRoot)
        : resolveGhCommand(repoRoot);
    const executor = execCommand ?? createExecutor(repoRoot);
    const result = executor(command, [
        "issue",
        "view",
        normalizedIssue,
        "--repo",
        `${normalizedOwner}/${normalizedRepo}`,
        "--json",
        "number,title,body,comments,author,updatedAt,url",
    ]);

    if (!result || result.status !== 0) {
        throw new SourceError("SOURCE_GITHUB_COMMAND_FAILED", "GitHub issue fetch failed.", {
            status: result?.status ?? null,
            stderr: result?.stderr ?? "",
        });
    }

    let payload;
    try {
        payload = JSON.parse(result.stdout);
    } catch (error) {
        throw new SourceError("SOURCE_GITHUB_INVALID_JSON", "GitHub issue output was not valid JSON.", {
            cause: error instanceof Error ? error.message : String(error),
        });
    }

    return normalizeGitHubIssue({
        ...payload,
        owner: normalizedOwner,
        repo: normalizedRepo,
        issue_number: normalizedIssue,
        branch,
        base_ref: baseRef ?? base,
    }, {fetchedAt: fetchedAt ?? null});
}

export function refreshSource({currentSource, fetchSource, explicit = false} = {}) {
    if (explicit !== true) {
        throw new SourceError("EXPLICIT_REFRESH_REQUIRED", "Refreshing source material requires an explicit request.");
    }
    if (typeof fetchSource !== "function") {
        throw new SourceError("INVALID_REFRESH_HANDLER", "fetchSource must be a function.");
    }

    const nextSource = fetchSource();
    return {
        ...compareSourceSnapshots(currentSource, nextSource),
        source: nextSource,
    };
}

export function compareSourceSnapshots(previous, next) {
    const fields = ["title", "body", "comments", "source_updated_at", "source_ref"];
    const changedFields = fields.filter((field) => stableJson(previous?.[field]) !== stableJson(next?.[field]));
    return {
        changed: changedFields.length > 0,
        changed_fields: changedFields,
    };
}

export function resolveSafePath(filePath, repoRoot, fsOps = fs) {
    const rootPath = requirePath(repoRoot, "repoRoot");
    const requestedPath = requirePath(filePath, "filePath");
    const absoluteRoot = path.resolve(rootPath);
    const candidate = path.resolve(absoluteRoot, requestedPath);
    const relativeCandidate = path.relative(absoluteRoot, candidate);
    if (relativeCandidate === ".." || relativeCandidate.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCandidate)) {
        throw new SourceError("UNSAFE_SOURCE_PATH", "Source file must remain inside repository root.", {
            filePath: requestedPath,
            repoRoot: absoluteRoot,
        });
    }

    let realRoot = absoluteRoot;
    let realCandidate = candidate;
    try {
        if (typeof fsOps.realpathSync === "function") {
            realRoot = fsOps.realpathSync(absoluteRoot);
            realCandidate = fsOps.realpathSync(candidate);
        }
    } catch (error) {
        throw new SourceError("SOURCE_FILE_READ_FAILED", `Could not resolve source path ${requestedPath}.`, {
            cause: error instanceof Error ? error.message : String(error),
        });
    }

    const realRelative = path.relative(realRoot, realCandidate);
    if (realRelative === ".." || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        throw new SourceError("UNSAFE_SOURCE_PATH", "Symlinked source file must remain inside repository root.", {
            filePath: requestedPath,
            repoRoot: realRoot,
        });
    }

    return {
        absolutePath: realCandidate,
        relativePath: realRelative.split(path.sep).join("/"),
        rootPath: realRoot,
    };
}

export function resolveGhCommand(repoRoot) {
    const root = path.resolve(requirePath(repoRoot, "repoRoot"));
    const envLoader = path.join(root, ".agents/skills/_shared/scripts/env-load.sh");
    const result = spawnSync("bash", ["-lc", `source ${shellQuote(envLoader)} && resolve_tool_cmd gh gh`], {
        cwd: root,
        encoding: "utf8",
    });
    if (result.status !== 0 || result.stdout.trim() === "") {
        throw new SourceError("TOOL_RESOLUTION_FAILED", "Could not resolve gh through env-load.sh.", {
            stderr: result.stderr,
        });
    }
    return result.stdout.trim();
}

export function createExecutor(repoRoot) {
    return (command, args) => spawnSync(command, args, {
        cwd: path.resolve(repoRoot),
        encoding: "utf8",
        shell: false,
    });
}

function normalizeComments(comments) {
    if (!Array.isArray(comments)) {
        return [];
    }
    return comments.map((comment) => {
        if (typeof comment === "string") {
            return {body: comment};
        }
        return {
            body: String(comment?.body ?? ""),
            author: comment?.author?.login ?? comment?.author ?? null,
            created_at: comment?.createdAt ?? comment?.created_at ?? null,
            updated_at: comment?.updatedAt ?? comment?.updated_at ?? null,
        };
    });
}

function normalizeAuthors(author, comments) {
    const authors = [];
    const issueAuthor = typeof author === "string" ? author : author?.login;
    if (issueAuthor) {
        authors.push(issueAuthor);
    }
    for (const comment of normalizeComments(comments)) {
        if (comment.author && !authors.includes(comment.author)) {
            authors.push(comment.author);
        }
    }
    return authors;
}

function firstMarkdownHeading(body) {
    const match = String(body).match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
}

function requireIdentifier(value, name) {
    const result = requireString(value, name);
    if (!/^[A-Za-z0-9_.-]+$/.test(result)) {
        throw new SourceError("INVALID_IDENTIFIER", `${name} contains unsupported characters.`);
    }
    return result;
}

function requireIssueNumber(value) {
    const result = requireString(value, "issueNumber");
    if (!/^[1-9][0-9]*$/.test(result)) {
        throw new SourceError("INVALID_ISSUE_NUMBER", "Issue number must be a positive integer.");
    }
    return result;
}

function requireString(value, name) {
    if (typeof value !== "string" && typeof value !== "number") {
        throw new SourceError("INVALID_SOURCE", `${name} is required.`);
    }
    const result = String(value).trim();
    if (result === "") {
        throw new SourceError("INVALID_SOURCE", `${name} is required.`);
    }
    return result;
}

function requirePath(value, name) {
    return requireString(value, name);
}

function stableJson(value) {
    return JSON.stringify(value ?? null);
}

function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parseArgs(args) {
    const parsed = {command: args.shift() ?? null, values: {}};
    while (args.length > 0) {
        const key = args.shift();
        if (!key.startsWith("--")) {
            throw new SourceError("INVALID_ARGUMENT", `Unexpected argument: ${key}.`);
        }
        const value = args.shift();
        if (typeof value !== "string") {
            throw new SourceError("INVALID_ARGUMENT", `Missing value for ${key}.`);
        }
        parsed.values[key.slice(2)] = value;
    }
    return parsed;
}

function cliResult(parsed) {
    if (parsed.command === "normalize-file") {
        return normalizeFileSource({
            filePath: parsed.values.path,
            repoRoot: parsed.values.root,
            options: {title: parsed.values.title},
        });
    }
    if (parsed.command === "normalize-user") {
        return normalizeUserInput({
            title: parsed.values.title,
            body: parsed.values.body,
            source_ref: parsed.values["source-ref"],
        });
    }
    if (parsed.command === "fetch-github") {
        return fetchGitHubIssue({
            owner: parsed.values.owner,
            repo: parsed.values.repo,
            issueNumber: parsed.values.issue,
            repoRoot: parsed.values.root ?? process.cwd(),
            fetchedAt: new Date().toISOString(),
            branch: parsed.values.branch,
            baseRef: parsed.values["base-ref"] ?? parsed.values.base,
        });
    }
    throw new SourceError("INVALID_COMMAND", "Use normalize-file, normalize-user, or fetch-github.");
}

function main(args) {
    if (args[0] === "--help") {
        process.stdout.write("Usage: source.mjs normalize-file --root <repo> --path <file> | normalize-user --title <title> [--body <body>] | fetch-github --root <repo> --owner <owner> --repo <repo> --issue <number> [--branch <branch>] [--base-ref <ref>]\n");
        return 0;
    }
    try {
        process.stdout.write(`${JSON.stringify(cliResult(parseArgs(args)))}\n`);
        return 0;
    } catch (error) {
        const result = error instanceof SourceError
            ? {valid: false, code: error.code, message: error.message}
            : {valid: false, code: "UNEXPECTED_ERROR", message: String(error)};
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return CLI_CONTRACT_REJECTIONS.includes(result.code) ? 1 : 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
