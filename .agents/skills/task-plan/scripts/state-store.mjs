#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {writeFileAtomic} from "./atomic-file.mjs";
import {
    buildDraftMetadata,
    parseDraftDocument,
    replaceExecutionHandoffSection,
    replaceGeneratedStateSection,
    replaceQuestionSection,
    replaceSessionStrategySection,
    renderGeneratedStateSection,
    renderExecutionHandoff,
    renderInitialDraftDocument,
    renderQuestionSections,
    renderSessionStrategyProjection,
    serializeFrontMatter,
    validateDraftDocument,
} from "./draft.mjs";
import {
    applyStateMutation,
    MUTATION_TYPES,
    createInitialState,
    planSnapshotFingerprint,
    preflightDecisionBatch as preflightStateDecisionBatch,
    selectDerivedState,
    StateError,
    validateRuntimeState,
} from "./state.mjs";

export {MUTATION_TYPES};

export const ARTIFACT_SET_INCOMPLETE = "ARTIFACT_SET_INCOMPLETE";
export const PROJECTION_STALE = "PROJECTION_STALE";
export const PROJECTED = "PROJECTED";

const CLI_CONTRACT_REJECTIONS = new Set([
    ARTIFACT_SET_INCOMPLETE,
    "INITIAL_MUTATION_REQUIRED",
    "UNKNOWN_MUTATION",
    "INVALID_MUTATION",
    "EXPECTED_REVISION_REQUIRED",
    "STALE_REVISION",
    "STALE_CHECKPOINT",
    "SOURCE_FETCH_NOT_APPLICABLE",
    "WORKFLOW_BLOCKED",
    "DUPLICATE_PROPAGATION_REF",
    "INVALID_PROPAGATION",
    "INVALID_PROPAGATION_SNAPSHOT",
    "LEGACY_PROPAGATION_PAYLOAD",
    "PLAN_STALE",
    "INVALID_DRAFT_PROJECTION",
    "PROJECTION_STALE",
    "RESTART_REQUIRED",
]);

export class StateStoreError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "StateStoreError";
        this.code = code;
        this.details = details;
    }
}

export function buildPlanId(plan) {
    if (!plan || typeof plan !== "object") {
        throw new StateStoreError("INVALID_PLAN", "Plan must be an object.");
    }
    const raw = String(plan.plan_id ?? plan.source_identity ?? "plan").trim();
    const slug = slugifyIdentifier(raw) || "plan";
    const prefix = slug.replace(/-[a-f0-9]{12}$/, "") || "plan";
    const hash = shortHash({
        plan_id: prefix,
        source_identity: plan.source_identity,
        draft_path: plan.draft_path,
    });
    if (/^[a-z0-9][a-z0-9-]*-[a-f0-9]{12}$/.test(slug) && slug.endsWith(`-${hash}`)) {
        return slug;
    }
    return `${prefix.slice(0, 64)}-${hash}`;
}

export function loadState(plan, options = {}) {
    const normalized = normalizePlan(plan, options);
    const paths = resolveArtifactPaths(normalized);
    const hasState = normalized.fsOps.existsSync(paths.statePath);
    const hasDraft = normalized.fsOps.existsSync(paths.draftPath);

    if (!hasState && !hasDraft) {
        return makeLoadResult(
            ensureState(normalized, options),
            "virtual-initial",
            paths,
        );
    }
    if (hasState !== hasDraft) {
        return {
            status: ARTIFACT_SET_INCOMPLETE,
            lifecycle: ARTIFACT_SET_INCOMPLETE,
            code: ARTIFACT_SET_INCOMPLETE,
            state: null,
            paths: publicPaths(paths),
        };
    }

    let state;
    try {
        state = JSON.parse(normalized.fsOps.readFileSync(paths.statePath, "utf8"));
    } catch (error) {
        throw new StateStoreError("STATE_READ_FAILED", `Could not read state ${paths.statePath}.`, {
            cause: error instanceof Error ? error.message : String(error),
            path: paths.statePath,
        });
    }
    assertValidState(state);
    return makeLoadResult(state, "persisted", paths);
}

export function ensureState(plan, options = {}) {
    const normalized = normalizePlan(plan, options);
    return createInitialState(normalized, {now: clockNow(normalized.clock)});
}

export function updateState(plan, mutation, options = {}) {
    assertKnownMutation(mutation);
    const normalized = normalizePlan(plan, options);
    const loaded = loadState(normalized, options);
    if (loaded.code === ARTIFACT_SET_INCOMPLETE) {
        throw new StateStoreError(
            ARTIFACT_SET_INCOMPLETE,
            "Draft and state must be restarted together; automatic reconstruction is disabled.",
            {paths: loaded.paths},
        );
    }

    const current = loaded.state;
    if (loaded.status === "virtual-initial" && mutation.type !== "create-initial") {
        throw new StateStoreError("INITIAL_MUTATION_REQUIRED", "The first materializing mutation must be create-initial.");
    }
    if (loaded.status === "persisted" && !isDraftRevisionCurrent(normalized, current)) {
        throw new StateStoreError(PROJECTION_STALE, "Draft state_revision does not match persisted state; use retryProjection() or explicitly restart.");
    }
    if (current.plan_status === "review-limit-reached") {
        throw new StateStoreError("RESTART_REQUIRED", "The review limit is terminal for this plan identity; explicitly restart.");
    }
    if (current.workflow_outcome === "blocked"
        && current.projection_status !== PROJECTION_STALE
        && mutation.type === "checkpoint"
        && mutation.payload?.resume === true
        && typeof (mutation.expected_revision ?? normalized.expected_revision) === "undefined") {
        throw new StateStoreError("EXPECTED_REVISION_REQUIRED", "A resume checkpoint requires expected_revision.");
    }
    assertExpectedRevision(normalized, current, mutation);
    if (current.workflow_outcome === "blocked") {
        if (current.projection_status === PROJECTION_STALE) {
            throw new StateStoreError("WORKFLOW_BLOCKED", "Workflow has a stale projection; use retryProjection() or explicitly restart.");
        }
        const resumeCheckpoint = mutation.type === "checkpoint"
            && mutation.payload?.resume === true
            && typeof mutation.payload?.reason === "string"
            && mutation.payload.reason.trim() !== "";
        if (!resumeCheckpoint) {
            throw new StateStoreError("WORKFLOW_BLOCKED", "Workflow is blocked and requires an explicit resume checkpoint or restart.");
        }
    }

    const now = clockNow(normalized.clock);
    const nextState = applyStateMutation(current, mutation, {now});
    if (mutation.type === "propagate-decisions"
        && stableStringify(nextState) === stableStringify(current)) {
        return {
            ok: true,
            code: "NOOP",
            projection_status: current.projection_status,
            state: current,
            paths: publicPaths(resolveArtifactPaths(normalized)),
        };
    }
    updateMutationBookkeeping(nextState, current, now);
    assertValidState(nextState);
    writeState(normalized, nextState, options);

    return projectAndFinalize(normalized, nextState, mutation.type === "create-initial", now, options);
}

/**
 * Run the question-group preflight against the persisted state and its draft.
 * This is deliberately read-only: no checkpoint, decision, or projection is
 * written when the path is blocked.
 */
export function preflightDecisionBatch(plan, questionIds, options = {}) {
    try {
        const normalized = normalizePlan(plan, options);
        const loaded = loadState(normalized, options);
        if (loaded.code === ARTIFACT_SET_INCOMPLETE) {
            return blockedPreflightResult(ARTIFACT_SET_INCOMPLETE, loaded, "Draft and state form an incomplete artifact pair.");
        }
        if (loaded.status === "virtual-initial") {
            return blockedPreflightResult("INITIAL_MUTATION_REQUIRED", loaded, "Initial state and draft must be materialized before questions can be shown.");
        }

        const current = loaded.state;
        const projectionFresh = current.projection_status === PROJECTED
            && isDraftRevisionCurrent(normalized, current);
        const result = preflightStateDecisionBatch(current, questionIds, {
            ...options,
            projection_fresh: projectionFresh,
            projection_status: current.projection_status,
        });
        return {
            ...result,
            state: current,
            lifecycle: loaded.lifecycle,
            status: loaded.status,
            paths: loaded.paths,
        };
    } catch (error) {
        const code = error?.code ?? "PREFLIGHT_FAILED";
        return {
            ready: false,
            ok: false,
            code,
            reasons: ["preflight_error"],
            errors: [error instanceof Error ? error.message : String(error)],
        };
    }
}

function blockedPreflightResult(code, loaded, message) {
    return {
        ready: false,
        ok: false,
        code,
        reasons: [code === ARTIFACT_SET_INCOMPLETE ? "artifact_set_incomplete" : "state_not_materialized"],
        errors: [message],
        state: loaded.state ?? null,
        lifecycle: loaded.lifecycle,
        status: loaded.status,
        paths: loaded.paths,
    };
}

export function retryProjection(plan, options = {}) {
    const normalized = normalizePlan(plan, options);
    const loaded = loadState(normalized, options);
    if (loaded.code === ARTIFACT_SET_INCOMPLETE || loaded.status === "virtual-initial") {
        return {
            ok: false,
            code: "RESTART_REQUIRED",
            state: loaded.state ?? null,
            paths: loaded.paths,
        };
    }

    const current = loaded.state;
    assertExpectedRevision(normalized, current, {expected_revision: options.expected_revision});
    const paths = resolveArtifactPaths(normalized);
    if (!normalized.fsOps.existsSync(paths.draftPath)) {
        return {ok: false, code: "RESTART_REQUIRED", state: current, paths: publicPaths(paths)};
    }
    const revisionCurrent = isDraftRevisionCurrent(normalized, current, paths);
    if (current.projection_status !== PROJECTION_STALE && revisionCurrent) {
        return {
            ok: true,
            code: PROJECTED,
            projection_status: PROJECTED,
            state: current,
            paths: publicPaths(paths),
        };
    }

    const now = clockNow(normalized.clock);
    const projectionState = clone(current);
    projectionState.workflow_outcome = current.projection_status === PROJECTION_STALE
        ? (current.projection_resume_outcome ?? "running")
        : current.workflow_outcome;
    projectionState.checkpoint = synchronizedCheckpoint(projectionState.checkpoint, now, projectionState.revision);
    try {
        projectDraft(normalized, projectionState, false, paths, options);
    } catch (error) {
        return persistProjectionFailure(normalized, current, now, error, options);
    }

    projectionState.projection_status = PROJECTED;
    projectionState.updated_at = now;
    delete projectionState.projection_error;
    delete projectionState.projection_resume_outcome;
    writeState(normalized, projectionState, options);
    return {
        ok: true,
        code: "RETRIED",
        projection_status: PROJECTED,
        state: projectionState,
        paths: publicPaths(paths),
    };
}

function normalizePlan(plan, options) {
    if (!plan || typeof plan !== "object") {
        throw new StateStoreError("INVALID_PLAN", "Plan must be an object.");
    }
    if (typeof plan.repo_root !== "string" || plan.repo_root.trim() === "") {
        throw new StateStoreError("INVALID_PLAN", "Plan requires repo_root.");
    }
    if (typeof plan.draft_path !== "string" || plan.draft_path.trim() === "") {
        throw new StateStoreError("INVALID_PLAN", "Plan requires draft_path.");
    }
    if (typeof plan.source_identity === "undefined" || plan.source_identity === null) {
        throw new StateStoreError("INVALID_PLAN", "Plan requires source_identity.");
    }

    const repoRoot = path.resolve(plan.repo_root);
    const draftPath = resolveInsideRoot(plan.draft_path, repoRoot, "draft_path");
    const stateRootInput = plan.state_root ?? "var/agent/task-plan";
    const stateRoot = path.isAbsolute(stateRootInput)
        ? path.resolve(stateRootInput)
        : path.resolve(repoRoot, stateRootInput);
    const draftRelativePath = path.relative(repoRoot, draftPath).split(path.sep).join("/");
    const clock = options.clock ?? plan.clock ?? {now: () => new Date().toISOString()};
    const fsOps = options.fsOps ?? plan.fsOps ?? fs;
    for (const method of ["existsSync", "readFileSync"]) {
        if (typeof fsOps[method] !== "function") {
            throw new StateStoreError("INVALID_IO", `fsOps must implement ${method}.`);
        }
    }

    return {
        ...plan,
        repo_root: repoRoot,
        state_root: stateRoot,
        plan_id: buildPlanId({...plan, draft_path: draftRelativePath}),
        draft_path: draftRelativePath,
        source_identity: clone(plan.source_identity),
        clock,
        fsOps,
    };
}

function resolveArtifactPaths(plan) {
    const planDirectory = path.join(plan.state_root, plan.plan_id);
    return {
        statePath: path.join(planDirectory, "state.json"),
        draftPath: path.resolve(plan.repo_root, plan.draft_path),
        planDirectory,
        stateRoot: plan.state_root,
        draftRelativePath: plan.draft_path,
    };
}

function publicPaths(paths) {
    return {
        state_path: paths.statePath,
        draft_path: paths.draftPath,
        plan_directory: paths.planDirectory,
    };
}

function makeLoadResult(state, lifecycle, paths) {
    return {
        ...state,
        state,
        status: lifecycle,
        lifecycle,
        paths: publicPaths(paths),
    };
}

function assertKnownMutation(mutation) {
    if (!mutation || typeof mutation !== "object") {
        throw new StateStoreError("INVALID_MUTATION", "Mutation must be an object.");
    }
    if (!MUTATION_TYPES.includes(mutation.type)) {
        throw new StateStoreError("UNKNOWN_MUTATION", `Unsupported state mutation: ${mutation.type ?? ""}.`);
    }
}

function assertExpectedRevision(plan, state, mutation) {
    const expected = typeof mutation.expected_revision !== "undefined"
        ? mutation.expected_revision
        : plan.expected_revision;
    if (typeof expected === "undefined" || expected === null) {
        return;
    }
    if (Number(expected) !== state.revision) {
        throw new StateStoreError("STALE_REVISION", `Expected revision ${expected}, current revision is ${state.revision}.`, {
            expected_revision: Number(expected),
            actual_revision: state.revision,
        });
    }
}

function updateMutationBookkeeping(nextState, current, now) {
    nextState.revision = current.revision + 1;
    nextState.updated_at = now;
}

function projectAndFinalize(plan, state, initial, now, options) {
    const paths = resolveArtifactPaths(plan);
    try {
        projectDraft(plan, state, initial, paths, options);
    } catch (error) {
        return persistProjectionFailure(plan, state, now, error, options);
    }

    const finalized = clone(state);
    finalized.projection_status = PROJECTED;
    delete finalized.projection_error;
    delete finalized.projection_resume_outcome;
    try {
        writeState(plan, finalized, options);
    } catch (error) {
        return persistProjectionFailure(plan, state, now, error, options);
    }
    return {
        ok: true,
        code: "APPLIED",
        projection_status: PROJECTED,
        state: finalized,
        paths: publicPaths(paths),
    };
}

function persistProjectionFailure(plan, state, now, error, options) {
    const stale = clone(state);
    stale.projection_resume_outcome ??= state.workflow_outcome;
    stale.workflow_outcome = "blocked";
    stale.projection_status = PROJECTION_STALE;
    stale.projection_error = error instanceof Error ? error.message : String(error);
    stale.updated_at = now;
    stale.checkpoint = {
        ...stale.checkpoint,
        completed_at: now,
        next_allowed_action: "retry projection or explicitly restart",
        reason: "Draft projection failed after state commit.",
        state_revision: stale.revision,
    };
    try {
        writeState(plan, stale, options);
    } catch (writeError) {
        return {
            ok: false,
            code: PROJECTION_STALE,
            projection_status: PROJECTION_STALE,
            state: stale,
            state_persistence_error: writeError instanceof Error ? writeError.message : String(writeError),
        };
    }
    return {
        ok: false,
        code: PROJECTION_STALE,
        projection_status: PROJECTION_STALE,
        workflow_outcome: "blocked",
        state: stale,
        error: stale.projection_error,
        paths: publicPaths(resolveArtifactPaths(plan)),
    };
}

function synchronizedCheckpoint(checkpoint, completedAt, revision) {
    return {
        ...checkpoint,
        completed_at: completedAt,
        next_allowed_action: checkpoint.next_allowed_action === "retry projection or explicitly restart"
            ? "continue current workflow phase"
            : checkpoint.next_allowed_action,
        reason: "Draft projection is synchronized with state.",
        state_revision: revision,
    };
}

function projectDraft(plan, state, initial, paths, options) {
    const customProjector = options.projectDraft ?? plan.projectDraft;
    if (typeof customProjector === "function") {
        customProjector({plan, state, initial, paths});
        return;
    }
    if (!initial && !plan.fsOps.existsSync(paths.draftPath)) {
        throw new StateStoreError("DRAFT_REQUIRED", "All mutations except create-initial require an existing draft.");
    }
    const content = initial
        ? renderInitialProjection(plan, state)
        : renderStateProjection(plan, state, paths);
    const validation = validateDraftDocument(content, {
        kind: "main",
        state,
        requireProjectionFingerprint: true,
    });
    if (!validation.valid) {
        const stale = validation.errors.some((error) => error.startsWith("PLAN_STALE"));
        throw new StateStoreError(
            stale ? "PLAN_STALE" : "INVALID_DRAFT_PROJECTION",
            validation.errors.join(" "),
            {errors: validation.errors},
        );
    }
    const customWriter = options.writeDraft ?? plan.writeDraft;
    if (typeof customWriter === "function") {
        customWriter(paths.draftPath, content, {initial, state});
        return;
    }
    writeFileAtomic(paths.draftPath, content, {rootDir: plan.repo_root, fsOps: plan.fsOps});
}

function renderInitialProjection(plan, state) {
    const source = projectionSource(plan, state);
    const metadata = buildDraftMetadata(source, {
        source_fetch_status: state.source_fetch_status,
        fetched_at: state.fetched_at,
        source_updated_at: state.source_updated_at,
        source_fetch_error: state.source_fetch_error,
        now: state.created_at,
    });
    const content = renderInitialDraftDocument(
        {...metadata, ...projectionMetadata(state)},
        {state, source},
    );
    const validation = validateDraftDocument(content, {
        kind: "main",
        state,
        requireProjectionFingerprint: true,
    });
    if (!validation.valid) {
        const stale = validation.errors.some((error) => error.startsWith("PLAN_STALE"));
        throw new StateStoreError(
            stale ? "PLAN_STALE" : "INVALID_DRAFT_PROJECTION",
            validation.errors.join(" "),
            {errors: validation.errors},
        );
    }
    return content;
}

export function isDraftRevisionCurrent(plan, state, paths = resolveArtifactPaths(plan)) {
    try {
        if (!plan.fsOps.existsSync(paths.draftPath)) {
            return false;
        }
        const draft = parseDraftDocument(plan.fsOps.readFileSync(paths.draftPath, "utf8"));
        const expectedFingerprint = `- Plan snapshot fingerprint: \`${planSnapshotFingerprint(state)}\``;
        const fingerprints = draft.body.match(/^- Plan snapshot fingerprint: `[^`]+`$/gm) ?? [];
        return Number(draft.metadata?.state_revision) === state.revision
            && fingerprints.length === 1
            && fingerprints[0] === expectedFingerprint;
    } catch {
        return false;
    }
}

export function renderStateProjection(plan, state, paths) {
    const source = plan.fsOps.readFileSync(paths.draftPath, "utf8");
    const parsed = parseDraftDocument(source);
    const metadata = {...parsed.metadata};
    for (const key of [
        "fetched_at",
        "source_updated_at",
        "source_fetch_error",
        "source_fetch_failed_at",
        "package_decision_gate",
        "simplification_status",
        "review_complete",
        "critical_review_complete",
        "simplification_control_review_complete",
    ]) {
        delete metadata[key];
    }
    Object.assign(metadata, projectionMetadata(state));
    const generatedBody = replaceGeneratedStateSection(parsed.body, renderGeneratedStateSection(state));
    const questionBody = replaceQuestionSection(generatedBody, renderQuestionSections({
        ...state,
        derived_state: selectDerivedState(state),
    }));
    const body = replaceSessionStrategySection(questionBody, renderSessionStrategyProjection(state.session_strategy));
    const handoffBody = replaceExecutionHandoffSection(body, renderExecutionHandoff(state));
    return `${serializeFrontMatter(metadata)}${handoffBody}`;
}

function projectionSource(plan, state) {
    const source = plan.source && typeof plan.source === "object"
        ? {...plan.source}
        : {
            source_kind: plan.source_kind,
            source_ref: plan.source_ref,
            title: plan.title,
            issue_number: plan.issue_number,
            owner: plan.owner,
            repo: plan.repo,
        };
    const hasSourceRef = typeof source.source_ref === "string" && source.source_ref.trim() !== "";
    const canDeriveGitHubRef = source.source_kind === "github-issue"
        && typeof source.owner === "string" && source.owner.trim() !== ""
        && typeof source.repo === "string" && source.repo.trim() !== ""
        && typeof (source.issue_number ?? source.issue) !== "undefined";
    if (typeof source.source_kind !== "string" || source.source_kind.trim() === ""
        || (!hasSourceRef && !canDeriveGitHubRef)) {
        throw new StateStoreError(
            "INVALID_SOURCE_ENVELOPE",
            "Initial draft projection requires source_kind and a source_ref or derivable GitHub source identity from the normalized source envelope.",
        );
    }
    return {
        ...source,
        input_profile: state.input_profile,
        source_fetch_status: state.source_fetch_status,
        fetched_at: state.fetched_at,
        source_updated_at: state.source_updated_at,
        source_fetch_error: state.source_fetch_error,
        source_fetch_failed_at: state.source_fetch_failed_at,
    };
}

function projectionMetadata(state) {
    const metadata = {
        source_identity: serializeIdentity(state.source_identity),
        input_profile: state.input_profile,
        workflow_phase: state.workflow_phase,
        workflow_outcome: state.workflow_outcome,
        state_revision: String(state.revision),
        source_fetch_status: state.source_fetch_status,
        plan_status: state.plan_status,
        plan_version: String(state.plan_version),
    };
    if (state.source_fetch_status === "complete") {
        metadata.fetched_at = state.fetched_at;
        metadata.source_updated_at = state.source_updated_at;
    }
    if (state.source_fetch_status === "failed") {
        metadata.source_fetch_error = state.source_fetch_error;
        metadata.source_fetch_failed_at = state.source_fetch_failed_at;
    }
    return metadata;
}

function writeState(plan, state, options) {
    const paths = resolveArtifactPaths(plan);
    const customWriter = options.writeState ?? plan.writeState;
    const content = `${JSON.stringify(state, null, 2)}\n`;
    assertValidState(state);
    try {
        if (typeof customWriter === "function") {
            customWriter(paths.statePath, content, state);
            return;
        }
        writeFileAtomic(paths.statePath, content, {rootDir: paths.stateRoot, fsOps: plan.fsOps});
    } catch (error) {
        throw new StateStoreError("STATE_WRITE_FAILED", `Could not write state ${paths.statePath}.`, {
            cause: error instanceof Error ? error.message : String(error),
            path: paths.statePath,
        });
    }
}

function assertValidState(state) {
    const result = validateRuntimeState(state);
    if (!result.valid) {
        throw new StateStoreError("INVALID_STATE", result.errors.join(" "), {errors: result.errors});
    }
}

function resolveInsideRoot(candidate, root, name) {
    const absolute = path.resolve(root, candidate);
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new StateStoreError("UNSAFE_PATH", `${name} must remain inside repo_root.`);
    }
    return absolute;
}

function slugifyIdentifier(value) {
    return String(value)
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function shortHash(value) {
    return crypto.createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 12);
}

function stableStringify(value) {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value ?? null);
}

function serializeIdentity(value) {
    return typeof value === "string" ? value : stableStringify(value);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function clockNow(clock) {
    if (!clock || typeof clock.now !== "function") {
        throw new StateStoreError("INVALID_CLOCK", "clock.now must be a function.");
    }
    const value = clock.now();
    const timestamp = value instanceof Date
        ? value.toISOString()
        : typeof value === "number"
            ? new Date(value).toISOString()
            : String(value);
    if (Number.isNaN(Date.parse(timestamp))) {
        throw new StateStoreError("INVALID_CLOCK", "clock.now must return a valid timestamp.");
    }
    return timestamp;
}

function parseArgs(args) {
    const parsed = {command: args.shift() ?? null, values: {}};
    while (args.length > 0) {
        const key = args.shift();
        if (!key.startsWith("--")) {
            throw new StateStoreError("INVALID_ARGUMENT", `Unexpected argument: ${key}.`);
        }
        const value = args.shift();
        if (typeof value !== "string") {
            throw new StateStoreError("INVALID_ARGUMENT", `Missing value for ${key}.`);
        }
        parsed.values[key.slice(2)] = value;
    }
    return parsed;
}

function cliResult(parsed) {
    const plan = readJsonFile(parsed.values.plan, "plan");
    if (parsed.command === "load") {
        return loadState(plan);
    }
    if (parsed.command === "ensure") {
        return ensureState(plan);
    }
    if (parsed.command === "update") {
        const mutation = parsed.values.mutation
            ? readJsonFile(parsed.values.mutation, "mutation")
            : {
                type: parsed.values.type,
                payload: parsed.values.payload ? JSON.parse(parsed.values.payload) : {},
            };
        return updateState(plan, mutation);
    }
    if (parsed.command === "retry-projection") {
        return retryProjection(plan, {
            expected_revision: parsed.values["expected-revision"],
        });
    }
    throw new StateStoreError("INVALID_COMMAND", "Use load, ensure, update or retry-projection.");
}

function readJsonFile(filePath, name) {
    if (typeof filePath !== "string" || filePath.trim() === "") {
        throw new StateStoreError("INVALID_ARGUMENT", `Missing ${name} JSON path.`);
    }
    try {
        return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
    } catch (error) {
        throw new StateStoreError("INVALID_ARGUMENT", `Could not read ${name} JSON.`, {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
}

function main(args) {
    if (args[0] === "--help") {
        process.stdout.write("Usage: state-store.mjs load|ensure|retry-projection --plan <json> | update --plan <json> --mutation <json>\n");
        return 0;
    }
    try {
        const result = cliResult(parseArgs(args));
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return result.ok === false || result.code === ARTIFACT_SET_INCOMPLETE ? 1 : 0;
    } catch (error) {
        const result = error instanceof StateStoreError || error instanceof StateError
            ? {valid: false, code: error.code, message: error.message}
            : {valid: false, code: "UNEXPECTED_ERROR", message: String(error)};
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return CLI_CONTRACT_REJECTIONS.has(result.code) ? 1 : 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
