#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {writeFileAtomic} from "./atomic-file.mjs";
import {buildPlanId, loadPersistedSource, resolveSourceArtifactPath} from "./source.mjs";
import {parsePlanDocument, validatePlanDocument} from "./validate.mjs";

export class StoreError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "StoreError";
        this.code = code;
        this.details = details;
    }
}

export function resolvePlanPaths({repoRoot = process.cwd(), sourceIdentity, planId} = {}) {
    const sourcePaths = resolveSourceArtifactPath({repoRoot, sourceIdentity});
    if (typeof planId !== "undefined" && planId !== sourcePaths.planId) {
        throw new StoreError("PLAN_ID_MISMATCH", `plan_id must equal ${sourcePaths.planId} for this source identity.`);
    }
    return {
        repoRoot: sourcePaths.repoRoot,
        planId: sourcePaths.planId,
        sourcePath: sourcePaths.artifactPath,
        draftPath: resolveInside(
            sourcePaths.repoRoot,
            path.join(sourcePaths.repoRoot, "docs", "plans", `${sourcePaths.planId}.md`),
            "draft_path",
        ),
    };
}

export function loadPlan({repoRoot = process.cwd(), sourceIdentity, fsOps = fs} = {}) {
    const source = loadPersistedSource({repoRoot, sourceIdentity, fsOps});
    const paths = resolvePlanPaths({repoRoot, sourceIdentity});
    if (!fsOps.existsSync(paths.draftPath)) {
        return {
            status: "source-only",
            markdown: null,
            metadata: null,
            validation: null,
            source,
            paths: publicPaths(paths),
        };
    }
    let markdown;
    try {
        markdown = fsOps.readFileSync(paths.draftPath, "utf8");
    } catch (error) {
        throw new StoreError("PLAN_READ_FAILED", `Could not read ${paths.draftPath}.`, causeDetails(error));
    }
    const parsed = parsePlanDocument(markdown);
    const validation = validatePlanDocument(markdown, {repoRoot: paths.repoRoot, fsOps});
    const consistencyErrors = validateSourceMetadata(parsed.metadata, source, paths);
    if (consistencyErrors.length > 0) {
        validation.valid = false;
        validation.status = "invalid";
        validation.errors = [...new Set([...validation.errors, ...consistencyErrors])];
    }
    return {
        status: validation.status,
        markdown,
        metadata: parsed.metadata,
        validation,
        source,
        paths: publicPaths(paths),
    };
}

export function savePlan(input = {}, options = {}) {
    rejectSidecarInput(input);
    const fsOps = options.fsOps ?? fs;
    const repoRoot = path.resolve(input.repo_root ?? options.repoRoot ?? process.cwd());
    const sourceIdentity = requiredString(input.source_identity, "source_identity");
    const source = loadPersistedSource({repoRoot, sourceIdentity, fsOps});
    const paths = resolvePlanPaths({repoRoot, sourceIdentity, planId: input.plan_id});
    const existing = readExistingPlan(paths.draftPath, fsOps);
    if (existing && existing.metadata.source_identity !== sourceIdentity) {
        throw new StoreError("PLAN_IDENTITY_MISMATCH", "Existing plan belongs to a different source identity.");
    }
    if (existing
        && (existing.metadata.source_artifact !== source.source_artifact
            || existing.metadata.source_sha256 !== source.source_sha256)) {
        throw new StoreError(
            "SOURCE_ARTIFACT_CHANGED",
            "Persisted source changed after the plan was created; explicitly restart from the new source instead of overwriting its provenance.",
            {
                expected_artifact: existing.metadata.source_artifact,
                actual_artifact: source.source_artifact,
                expected_sha256: existing.metadata.source_sha256,
                actual_sha256: source.source_sha256,
            },
        );
    }
    const revision = existing ? Number(existing.metadata.revision) + 1 : 1;
    if (!Number.isInteger(revision) || revision < 1) {
        throw new StoreError("INVALID_EXISTING_PLAN", "Existing plan revision is invalid.");
    }
    const context = typeof input.context === "undefined"
        ? contextFromMetadata(existing?.metadata)
        : normalizeContext(input.context, repoRoot, fsOps);
    const updatedAt = validTimestamp(options.now ?? input.updated_at ?? new Date().toISOString(), "updated_at");
    const metadata = {
        plan_id: paths.planId,
        revision,
        source_identity: sourceIdentity,
        source_artifact: source.source_artifact,
        source_sha256: source.source_sha256,
        ...context,
        updated_at: updatedAt,
    };
    const body = normalizeMarkdownBody(input.markdown_body ?? input.markdown);
    const markdown = renderPlanDocument(body, metadata);
    const validation = validatePlanDocument(markdown, {repoRoot, fsOps});
    if (!validation.valid) {
        throw new StoreError("INVALID_PLAN", validation.errors.join(" "), {errors: validation.errors});
    }
    writeFileAtomic(paths.draftPath, markdown, {rootDir: repoRoot, fsOps});
    return {ok: true, status: validation.status, metadata, markdown, validation, paths: publicPaths(paths)};
}

export function renderPlanDocument(body, metadata) {
    const fields = [
        "plan_id",
        "revision",
        "source_identity",
        "source_artifact",
        "source_sha256",
        "context_status",
        "context_report",
        "context_report_sha256",
        "context_criteria",
        "context_criteria_sha256",
        "updated_at",
    ];
    const lines = ["---"];
    for (const field of fields) {
        lines.push(`${field}: ${JSON.stringify(metadata[field] ?? null)}`);
    }
    lines.push("---", "");
    return `${lines.join("\n")}${body.trim()}\n`;
}

function normalizeContext(value, repoRoot, fsOps) {
    if (value === null || typeof value === "undefined") {
        return emptyContext("NOT_REQUIRED");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new StoreError("INVALID_CONTEXT", "context must be an object or null.");
    }
    const status = value.status;
    if (!["NOT_REQUIRED", "COMPLETE", "INCOMPLETE", "BLOCKED"].includes(status)) {
        throw new StoreError("INVALID_CONTEXT", "context.status is invalid.");
    }
    const report = artifactReference(value.report_path, value.report_sha256, repoRoot, fsOps, "context report");
    const criteria = artifactReference(value.criteria_path, value.criteria_sha256, repoRoot, fsOps, "context criteria");
    if (status === "COMPLETE" && (!report.path || !criteria.path)) {
        throw new StoreError("INVALID_CONTEXT", "COMPLETE context requires report_path and criteria_path.");
    }
    return {
        context_status: status,
        context_report: report.path,
        context_report_sha256: report.sha256,
        context_criteria: criteria.path,
        context_criteria_sha256: criteria.sha256,
    };
}

function contextFromMetadata(metadata) {
    if (!metadata) {
        return emptyContext("NOT_REQUIRED");
    }
    return {
        context_status: metadata.context_status ?? "NOT_REQUIRED",
        context_report: metadata.context_report ?? null,
        context_report_sha256: metadata.context_report_sha256 ?? null,
        context_criteria: metadata.context_criteria ?? null,
        context_criteria_sha256: metadata.context_criteria_sha256 ?? null,
    };
}

function emptyContext(status) {
    return {
        context_status: status,
        context_report: null,
        context_report_sha256: null,
        context_criteria: null,
        context_criteria_sha256: null,
    };
}

function artifactReference(filePath, expectedHash, repoRoot, fsOps, label) {
    if (filePath === null || typeof filePath === "undefined" || filePath === "") {
        return {path: null, sha256: null};
    }
    const absolute = resolveInside(repoRoot, requiredString(filePath, `${label} path`), `${label} path`);
    if (!fsOps.existsSync(absolute)) {
        throw new StoreError("CONTEXT_ARTIFACT_MISSING", `${label} does not exist: ${filePath}.`);
    }
    const actualHash = sha256(fsOps.readFileSync(absolute));
    if (expectedHash && expectedHash !== actualHash) {
        throw new StoreError("CONTEXT_HASH_MISMATCH", `${label} hash does not match.`, {expected: expectedHash, actual: actualHash});
    }
    return {path: relativePath(repoRoot, absolute), sha256: actualHash};
}

function readExistingPlan(draftPath, fsOps) {
    if (!fsOps.existsSync(draftPath)) {
        return null;
    }
    try {
        const markdown = fsOps.readFileSync(draftPath, "utf8");
        return {markdown, ...parsePlanDocument(markdown)};
    } catch (error) {
        throw new StoreError("PLAN_READ_FAILED", `Could not read ${draftPath}.`, causeDetails(error));
    }
}

function validateSourceMetadata(metadata, source, paths) {
    const errors = [];
    if (metadata.plan_id !== paths.planId) {
        errors.push("Front matter plan_id does not match source identity.");
    }
    if (metadata.source_identity !== source.source.identity) {
        errors.push("Front matter source_identity does not match source artifact.");
    }
    if (metadata.source_artifact !== source.source_artifact || metadata.source_sha256 !== source.source_sha256) {
        errors.push("Front matter source reference does not match persisted source artifact.");
    }
    return errors;
}

function rejectSidecarInput(input) {
    for (const field of ["state", "status", "blocking_questions", "reviewed_at", "last_error", "user_decisions", "mutations", "import_state"]) {
        if (Object.hasOwn(input, field)) {
            throw new StoreError("SIDECAR_INPUT_FORBIDDEN", `Task-plan without sidecar does not accept field: ${field}.`);
        }
    }
}

function normalizeMarkdownBody(value) {
    const body = requiredString(value, "markdown_body");
    if (body.startsWith("---\n")) {
        throw new StoreError("MANAGED_FRONT_MATTER", "markdown_body must not contain front matter; store.mjs owns metadata.");
    }
    return body;
}

function validTimestamp(value, name) {
    const candidate = requiredString(value, name);
    if (Number.isNaN(Date.parse(candidate))) {
        throw new StoreError("INVALID_TIMESTAMP", `${name} must be a valid timestamp.`);
    }
    return candidate;
}

function requiredString(value, name) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new StoreError("INVALID_ARGUMENT", `${name} must be a non-empty string.`);
    }
    return value.trim();
}

function resolveInside(root, candidate, name) {
    const absoluteRoot = path.resolve(root);
    const absolute = path.resolve(absoluteRoot, candidate);
    const relative = path.relative(absoluteRoot, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new StoreError("UNSAFE_PATH", `${name} must remain inside repository root.`);
    }
    return absolute;
}

function relativePath(root, candidate) {
    return path.relative(root, candidate).split(path.sep).join("/");
}

function publicPaths(paths) {
    return {
        source_path: relativePath(paths.repoRoot, paths.sourcePath),
        draft_path: relativePath(paths.repoRoot, paths.draftPath),
    };
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function causeDetails(error) {
    return {cause: error instanceof Error ? error.message : String(error)};
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

function readJsonInput(filePath) {
    const content = filePath === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(path.resolve(filePath), "utf8");
    return JSON.parse(content);
}

async function main(argv) {
    const args = parseArgs(argv);
    const command = args._[0];
    let result;
    if (command === "save" && args.input) {
        result = savePlan(readJsonInput(args.input));
    } else if (command === "load" && args.source_identity) {
        result = loadPlan({repoRoot: args.root ?? process.cwd(), sourceIdentity: args.source_identity});
    } else if (command === "paths" && args.source_identity) {
        result = publicPaths(resolvePlanPaths({repoRoot: args.root ?? process.cwd(), sourceIdentity: args.source_identity}));
    } else {
        throw new StoreError("INVALID_ARGUMENT", "Usage: store.mjs save --input <file|-> | load|paths --source-identity <id> [--root <repo>]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "STORE_ERROR", message: error.message, details: error.details ?? {}})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}
