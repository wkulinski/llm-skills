#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {writeFileAtomic} from "./atomic-file.mjs";
import {buildPlanId, loadPersistedSource, resolveSourceArtifactPath} from "./source.mjs";
import {
    extractPackages,
    parseExecutionContract,
    parsePlanDocument,
    validatePlanDocument,
} from "./validate.mjs";

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
        content_sha256: sha256(markdown),
        metadata: parsed.metadata,
        validation,
        source,
        paths: publicPaths(paths),
    };
}

export function loadPlanFile({repoRoot = process.cwd(), planPath, fsOps = fs} = {}) {
    const root = path.resolve(repoRoot);
    const absolute = resolveInside(root, requiredString(planPath, "planPath"), "planPath");
    if (!fsOps.existsSync(absolute)) {
        throw new StoreError("PLAN_NOT_FOUND", `Plan does not exist: ${relativePath(root, absolute)}.`);
    }
    let parsed;
    try {
        parsed = parsePlanDocument(fsOps.readFileSync(absolute, "utf8"));
    } catch (error) {
        throw new StoreError("PLAN_READ_FAILED", `Could not read ${absolute}.`, causeDetails(error));
    }
    const sourceIdentity = requiredString(parsed.metadata.source_identity, "front matter source_identity");
    const expected = resolvePlanPaths({repoRoot: root, sourceIdentity});
    if (absolute !== expected.draftPath) {
        throw new StoreError("NON_CANONICAL_PLAN_PATH", "Plan path does not match its source identity.");
    }
    return loadPlan({repoRoot: root, sourceIdentity, fsOps});
}

export function completeWorkPackage({repoRoot = process.cwd(), planPath, wpId, evidence, fsOps = fs} = {}, options = {}) {
    const loaded = loadPlanFile({repoRoot, planPath, fsOps});
    if (loaded.status !== "ready") {
        throw new StoreError("PLAN_NOT_READY", `Plan cannot be executed while validation status is ${loaded.status}.`, {
            errors: loaded.validation?.errors ?? [],
        });
    }

    const id = requiredString(wpId, "wpId");
    const verification = requiredSingleLine(evidence, "evidence");
    const contract = parseExecutionContract(parsePlanDocument(loaded.markdown).body);
    const selected = contract.items.find((item) => item.id === id);
    if (!selected) {
        throw new StoreError("UNKNOWN_WORK_PACKAGE", `Unknown work package: ${id}.`);
    }
    if (selected.completed) {
        return projectPlanOutcome({
            status: loaded.status,
            changed: false,
            planId: loaded.metadata?.plan_id ?? null,
            revision: loaded.metadata?.revision ?? null,
            contentSha256: sha256(loaded.markdown),
            planPath: loaded.paths.draft_path,
            errors: loaded.validation?.errors ?? [],
            full: {
                markdown: loaded.markdown,
                metadata: loaded.metadata,
                validation: loaded.validation,
                paths: loaded.paths,
            },
            verbose: options.verbose === true,
            extra: {completed: selected},
        });
    }
    const next = contract.items.find((item) => !item.completed);
    if (next?.id !== id) {
        throw new StoreError("WORK_PACKAGE_OUT_OF_ORDER", `${id} cannot be completed before ${next?.id ?? "the current work package"}.`);
    }

    const timestamp = validTimestamp(options.now ?? new Date().toISOString(), "updated_at");
    const completedAt = new Date(timestamp).toISOString().slice(0, 10);
    const parsed = parsePlanDocument(loaded.markdown);
    const markdownBody = replacePendingExecutionEntry(parsed.body, id, `- [x] ${id} — ${completedAt} — ${verification}`);
    const saved = savePlan({
        repo_root: repoRoot,
        source_identity: loaded.metadata.source_identity,
        markdown_body: markdownBody,
        expected_revision: loaded.metadata.revision,
        base_sha256: sha256(loaded.markdown),
    }, {now: timestamp, fsOps, verbose: options.verbose === true});
    return {
        ...saved,
        changed: true,
        completed: {id, completed: true, completedAt, verification},
    };
}

export function savePlan(input = {}, options = {}) {
    rejectSidecarInput(input);
    const fsOps = options.fsOps ?? fs;
    const repoRoot = path.resolve(input.repo_root ?? options.repoRoot ?? process.cwd());
    const sourceIdentity = requiredString(input.source_identity, "source_identity");
    const source = loadPersistedSource({repoRoot, sourceIdentity, fsOps});
    const paths = resolvePlanPaths({repoRoot, sourceIdentity, planId: input.plan_id});
    return withPlanLock(paths.draftPath, fsOps, () => {
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
        if (existing) {
            assertUpdateToken(input, existing);
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
        if (existing && isSamePlanContent(existing, body, metadata)) {
            const existingValidation = validatePlanDocument(existing.markdown, {repoRoot, fsOps});
            return projectPlanOutcome({
                status: validation.status,
                changed: false,
                planId: paths.planId,
                revision: existing.metadata.revision,
                contentSha256: sha256(existing.markdown),
                planPath: publicPaths(paths).draft_path,
                beforeMarkdown: existing.markdown,
                afterMarkdown: existing.markdown,
                errors: existingValidation.errors,
                full: {
                    markdown: existing.markdown,
                    metadata: existing.metadata,
                    validation: existingValidation,
                    paths: publicPaths(paths),
                },
                verbose: options.verbose === true,
            });
        }
        writeFileAtomic(paths.draftPath, markdown, {rootDir: repoRoot, fsOps});
        return projectPlanOutcome({
            status: validation.status,
            changed: true,
            planId: paths.planId,
            revision: metadata.revision,
            contentSha256: sha256(markdown),
            planPath: publicPaths(paths).draft_path,
            beforeMarkdown: existing?.markdown ?? null,
            afterMarkdown: markdown,
            errors: validation.errors,
            full: {
                markdown,
                metadata,
                validation,
                paths: publicPaths(paths),
            },
            verbose: options.verbose === true,
        });
    });
}

/**
 * Build the compact public outcome shared by save/edit/validate/complete-wp.
 *
 * The default projection never carries the full Markdown or work-package
 * bodies. `verbose` restores the full document and validation payload for an
 * explicit read.
 */
export function projectPlanOutcome({
    status,
    changed,
    planId = null,
    revision = null,
    contentSha256 = null,
    planPath = null,
    beforeMarkdown = null,
    afterMarkdown = null,
    errors = [],
    full = {},
    verbose = false,
    extra = {},
} = {}) {
    const delta = diffPlanSections(beforeMarkdown, afterMarkdown);
    const result = {
        ok: true,
        status,
        changed,
        plan_id: planId,
        revision,
        content_sha256: contentSha256,
        plan_path: planPath,
        changed_sections: delta.sections,
        changed_work_packages: delta.workPackages,
        errors,
        warnings: [],
        ...extra,
    };
    if (verbose) {
        return {
            ...result,
            markdown: full.markdown ?? null,
            metadata: full.metadata ?? null,
            validation: full.validation ?? null,
            paths: full.paths ?? null,
        };
    }
    return result;
}

/**
 * Compare two plan documents by section and work-package content.
 *
 * Returns the names of sections and the ids of work packages whose bodies
 * differ. A null or missing side marks every section/package on the other side
 * as changed.
 */
function diffPlanSections(beforeMarkdown, afterMarkdown) {
    if (typeof afterMarkdown !== "string") {
        return {sections: [], workPackages: []};
    }
    const before = typeof beforeMarkdown === "string" ? beforeMarkdown : "";
    const sections = changedSectionNames(before, afterMarkdown);
    const workPackages = changedWorkPackageIds(before, afterMarkdown);
    return {sections, workPackages};
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

function splitSectionBodies(markdown) {
    const bodies = new Map();
    if (typeof markdown !== "string" || markdown === "") {
        return bodies;
    }
    const matches = [...markdown.matchAll(/^## (.+?)\s*$/gm)];
    matches.forEach((match, index) => {
        const start = match.index;
        const end = matches[index + 1]?.index ?? markdown.length;
        bodies.set(match[1].trim(), markdown.slice(start, end));
    });
    return bodies;
}

function changedSectionNames(beforeMarkdown, afterMarkdown) {
    const before = splitSectionBodies(beforeMarkdown);
    const after = splitSectionBodies(afterMarkdown);
    const names = [...after.keys(), ...[...before.keys()].filter((name) => !after.has(name))];
    return names.filter((name) => (before.get(name) ?? null) !== (after.get(name) ?? null));
}

function executionEntryLines(markdown) {
    const entries = new Map();
    if (typeof markdown !== "string") {
        return entries;
    }
    const heading = /^## Execution[ \t]*$/m.exec(markdown);
    if (!heading) {
        return entries;
    }
    const start = heading.index + heading[0].length;
    const nextHeading = markdown.indexOf("\n## ", start);
    const section = markdown.slice(start, nextHeading >= 0 ? nextHeading : markdown.length);
    for (const line of section.split("\n")) {
        const match = line.match(/^\s*-\s+\[[ xX]\]\s+(WP[1-9][0-9]*)\b/);
        if (match) {
            entries.set(match[1], line.trim());
        }
    }
    return entries;
}

function changedWorkPackageIds(beforeMarkdown, afterMarkdown) {
    const beforePackages = new Map(extractPackages(typeof beforeMarkdown === "string" ? beforeMarkdown : "").map((record) => [record.id, record.body]));
    const afterPackages = new Map(extractPackages(afterMarkdown).map((record) => [record.id, record.body]));
    const beforeEntries = executionEntryLines(beforeMarkdown);
    const afterEntries = executionEntryLines(afterMarkdown);
    const ids = [...afterPackages.keys(), ...[...beforePackages.keys()].filter((id) => !afterPackages.has(id))];
    return ids.filter((id) => (
        (beforePackages.get(id) ?? null) !== (afterPackages.get(id) ?? null)
        || (beforeEntries.get(id) ?? null) !== (afterEntries.get(id) ?? null)
    ));
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

const PLAN_LOCK_STALE_MS = 30_000;
const PLAN_LOCK_ATTEMPTS = 200;
const PLAN_STALE_CLAIM_SUFFIX = ".stale-claim";

function withPlanLock(planPath, fsOps, callback) {
    const lockPath = `${planPath}.lock`;
    const claimPath = staleClaimPath(lockPath);
    fsOps.mkdirSync(path.dirname(planPath), {recursive: true});
    let descriptor = null;
    for (let attempt = 0; attempt < PLAN_LOCK_ATTEMPTS; attempt += 1) {
        try {
            descriptor = fsOps.openSync(lockPath, "wx");
            fsOps.writeFileSync(descriptor, `${process.pid}:${crypto.randomUUID()}\n`);
            if (pathExists(claimPath, fsOps)) {
                releasePlanLock(lockPath, descriptor, fsOps);
                descriptor = null;
                clearDeadStaleClaim(claimPath, fsOps);
                waitForPlanLock();
                continue;
            }
            break;
        } catch (error) {
            if (descriptor !== null) {
                cleanupFailedPlanLock(lockPath, descriptor, fsOps);
                descriptor = null;
            }
            if (error?.code !== "EEXIST") {
                throw new StoreError("PLAN_LOCK_FAILED", `Could not lock ${planPath}.`, causeDetails(error));
            }
            if (removeStalePlanLock(lockPath, fsOps)) {
                continue;
            }
            waitForPlanLock();
        }
    }
    if (descriptor === null) {
        throw new StoreError("PLAN_LOCK_TIMEOUT", `Could not acquire the plan lock for ${planPath}.`);
    }
    try {
        return callback();
    } finally {
        releasePlanLock(lockPath, descriptor, fsOps);
    }
}

function cleanupFailedPlanLock(lockPath, descriptor, fsOps) {
    try {
        fsOps.closeSync(descriptor);
    } catch {
        // Cleanup below is still attempted when descriptor closing fails.
    }
    try {
        fsOps.unlinkSync(lockPath);
    } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
            throw new StoreError("PLAN_LOCK_FAILED", `Could not clean up ${lockPath}.`, causeDetails(cleanupError));
        }
    }
}

function removeStalePlanLock(lockPath, fsOps) {
    let observed;
    try {
        observed = readLockSnapshot(lockPath, fsOps);
    } catch {
        return true;
    }
    if (!isStalePlanLock(observed)) {
        return false;
    }

    const claim = acquireStaleClaim(lockPath, fsOps);
    if (!claim) {
        return false;
    }
    try {
        let current;
        try {
            current = readLockSnapshot(lockPath, fsOps);
        } catch (error) {
            if (error?.code === "ENOENT") {
                return true;
            }
            throw error;
        }
        if (!sameLockSnapshot(observed, current) || !isStalePlanLock(current)) {
            return false;
        }
        try {
            fsOps.unlinkSync(lockPath);
        } catch (error) {
            if (error?.code !== "ENOENT") {
                throw error;
            }
        }
        return true;
    } finally {
        releaseStaleClaim(claim, fsOps);
    }
}

function staleClaimPath(lockPath) {
    return `${lockPath}${PLAN_STALE_CLAIM_SUFFIX}`;
}

function acquireStaleClaim(lockPath, fsOps) {
    const claimPath = staleClaimPath(lockPath);
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let created = false;
        try {
            fsOps.mkdirSync(claimPath);
            created = true;
            fsOps.writeFileSync(path.join(claimPath, "owner"), `${process.pid}\n`);
            return {path: claimPath};
        } catch (error) {
            if (created) {
                removeDirectory(claimPath, fsOps);
            }
            if (error?.code !== "EEXIST") {
                throw new StoreError("PLAN_LOCK_FAILED", `Could not claim stale lock ${lockPath}.`, causeDetails(error));
            }
            if (!clearDeadStaleClaim(claimPath, fsOps)) {
                return null;
            }
        }
    }
    return null;
}

function clearDeadStaleClaim(claimPath, fsOps) {
    let stat;
    try {
        stat = fsOps.statSync(claimPath);
    } catch (error) {
        return error?.code === "ENOENT";
    }
    const ownerPath = path.join(claimPath, "owner");
    let owner = "";
    try {
        owner = fsOps.readFileSync(ownerPath, "utf8");
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw new StoreError("PLAN_LOCK_FAILED", `Could not inspect stale lock claim ${claimPath}.`, causeDetails(error));
        }
    }
    const ownerPid = parseOwnerPid(owner);
    const claimIsOld = Date.now() - stat.mtimeMs > PLAN_LOCK_STALE_MS;
    if (ownerPid !== null && isProcessAlive(ownerPid)) {
        return false;
    }
    if (ownerPid === null && !claimIsOld) {
        return false;
    }
    try {
        removeDirectory(claimPath, fsOps);
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw new StoreError("PLAN_LOCK_FAILED", `Could not remove stale lock claim ${claimPath}.`, causeDetails(error));
        }
    }
    return true;
}

function releaseStaleClaim(claim, fsOps) {
    try {
        removeDirectory(claim.path, fsOps);
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw new StoreError("PLAN_LOCK_FAILED", `Could not release stale lock claim ${claim.path}.`, causeDetails(error));
        }
    }
}

function removeDirectory(directory, fsOps) {
    fsOps.rmSync(directory, {recursive: true, force: false});
}

function pathExists(candidate, fsOps) {
    try {
        fsOps.statSync(candidate);
        return true;
    } catch (error) {
        if (error?.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}

function readLockSnapshot(lockPath, fsOps) {
    return {
        stat: fsOps.statSync(lockPath),
        content: fsOps.readFileSync(lockPath, "utf8"),
    };
}

function isStalePlanLock(snapshot) {
    if (Date.now() - snapshot.stat.mtimeMs <= PLAN_LOCK_STALE_MS) {
        return false;
    }
    const ownerPid = parseOwnerPid(snapshot.content);
    return ownerPid === null || !isProcessAlive(ownerPid);
}

function sameLockSnapshot(first, second) {
    const firstIdentity = fileIdentity(first.stat);
    const secondIdentity = fileIdentity(second.stat);
    if (firstIdentity !== null && secondIdentity !== null) {
        return firstIdentity === secondIdentity && first.content === second.content;
    }
    return first.content === second.content
        && first.stat.mtimeMs === second.stat.mtimeMs
        && first.stat.size === second.stat.size;
}

function fileIdentity(stat) {
    if (typeof stat?.dev !== "number" || typeof stat?.ino !== "number" || stat.ino === 0) {
        return null;
    }
    return `${stat.dev}:${stat.ino}`;
}

function parseOwnerPid(content) {
    const match = String(content ?? "").trim().match(/^([1-9][0-9]*)(?::|$)/);
    return match ? Number(match[1]) : null;
}

function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error?.code === "EPERM";
    }
}

function releasePlanLock(lockPath, descriptor, fsOps) {
    try {
        fsOps.closeSync(descriptor);
    } catch {
        // Closing is best effort; the lock file is still removed below.
    }
    try {
        fsOps.unlinkSync(lockPath);
    } catch (error) {
        if (error?.code !== "ENOENT") {
            throw error;
        }
    }
}

function waitForPlanLock() {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
}

function assertUpdateToken(input, existing) {
    const expectedSha = typeof input.base_sha256 === "string" ? input.base_sha256.toLowerCase() : null;
    const expectedRevision = Number(input.expected_revision);
    const actualRevision = Number(existing.metadata.revision);
    const actualSha = sha256(existing.markdown);
    const hasRevision = input.expected_revision !== null
        && typeof input.expected_revision !== "undefined"
        && String(input.expected_revision).trim() !== ""
        && Number.isInteger(expectedRevision);
    const hasSha = expectedSha !== null && /^[a-f0-9]{64}$/.test(expectedSha);
    if (!hasRevision || !hasSha) {
        throw new StoreError(
            "PLAN_CONFLICT",
            "Updating an existing plan requires expected_revision and base_sha256 from the current snapshot.",
            {
                expected_revision: typeof input.expected_revision === "undefined" ? null : input.expected_revision,
                actual_revision: existing.metadata.revision ?? null,
                expected_sha256: expectedSha,
                actual_sha256: actualSha,
            },
        );
    }
    if (expectedRevision !== actualRevision || expectedSha !== actualSha) {
        throw new StoreError(
            "PLAN_CONFLICT",
            "Plan update base no longer matches the canonical plan revision or content hash.",
            {
                expected_revision: expectedRevision,
                actual_revision: existing.metadata.revision ?? null,
                expected_sha256: expectedSha,
                actual_sha256: actualSha,
            },
        );
    }
}

function isSamePlanContent(existing, body, metadata) {
    const revision = Number(existing.metadata.revision);
    const updatedAt = existing.metadata.updated_at;
    if (!Number.isInteger(revision) || typeof updatedAt !== "string") {
        return false;
    }
    const comparable = renderPlanDocument(body, {...metadata, revision, updated_at: updatedAt});
    return comparable === existing.markdown;
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

function replacePendingExecutionEntry(body, wpId, replacement) {
    const sectionMatch = /^## Execution\s*$/m.exec(body);
    if (!sectionMatch) {
        throw new StoreError("INVALID_PLAN", "Plan does not contain ## Execution.");
    }
    const start = sectionMatch.index + sectionMatch[0].length;
    const nextHeading = body.indexOf("\n## ", start);
    const end = nextHeading >= 0 ? nextHeading : body.length;
    const section = body.slice(start, end);
    const pattern = new RegExp(`^[ \\t]*-[ \\t]+\\[ \\]\\s+${escapeRegex(wpId)}[ \\t]*$`, "m");
    if (!pattern.test(section)) {
        throw new StoreError("INVALID_PLAN", `Pending Execution entry not found for ${wpId}.`);
    }
    return `${body.slice(0, start)}${section.replace(pattern, () => replacement)}${body.slice(end)}`;
}

function validTimestamp(value, name) {
    const candidate = value instanceof Date ? value.toISOString() : requiredString(value, name);
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

function requiredSingleLine(value, name) {
    const result = requiredString(value, name);
    if (/\r|\n/.test(result)) {
        throw new StoreError("INVALID_ARGUMENT", `${name} must be a single line.`);
    }
    if (/^(?:none|n\/a|not applicable)$/i.test(result)) {
        throw new StoreError("INVALID_ARGUMENT", `${name} must contain concrete evidence.`);
    }
    return result;
}

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function usage() {
    return [
        "Usage:",
        "  store.mjs save --input <file|-> [--verbose]",
        "  store.mjs load --source-identity <id> [--root <repo>]",
        "  store.mjs paths --source-identity <id> [--root <repo>]",
        "  store.mjs complete-wp --file <plan> --wp <WPn> --evidence <text> [--root <repo>] [--verbose]",
        "",
        "The save JSON input must contain repo_root; save does not use --root.",
        "load, paths and complete-wp use --root for the repository when provided.",
        "--input <file|-> reads JSON from a file; use the literal --input - for stdin.",
        "By default save and complete-wp return a compact projection without Markdown;",
        "--verbose includes the full Markdown, metadata and validation payload.",
        "Help (`--help` or `-h`) exits with code 0 before command dispatch and never changes a plan.",
    ].join("\n");
}

function hasHelpFlag(argv) {
    return argv.some((argument) => argument === "--help" || argument === "-h");
}

async function main(argv) {
    if (hasHelpFlag(argv)) {
        process.stdout.write(`${usage()}\n`);
        return;
    }

    const args = parseArgs(argv);
    const command = args._[0];
    let result;
    const verbose = args.verbose === true;
    if (command === "save" && args.input) {
        result = savePlan(readJsonInput(args.input), {verbose});
    } else if (command === "load" && args.source_identity) {
        result = loadPlan({repoRoot: args.root ?? process.cwd(), sourceIdentity: args.source_identity});
    } else if (command === "complete-wp" && args.file && args.wp && args.evidence) {
        result = completeWorkPackage({
            repoRoot: args.root ?? process.cwd(),
            planPath: args.file,
            wpId: args.wp,
            evidence: args.evidence,
        }, {verbose});
    } else if (command === "paths" && args.source_identity) {
        result = publicPaths(resolvePlanPaths({repoRoot: args.root ?? process.cwd(), sourceIdentity: args.source_identity}));
    } else {
        throw new StoreError("INVALID_ARGUMENT", "Usage: store.mjs save --input <file|-> | load|paths --source-identity <id> [--root <repo>] | complete-wp --file <plan> --wp <WPn> --evidence <text> [--root <repo>]");
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "STORE_ERROR", message: error.message, details: error.details ?? {}})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}
