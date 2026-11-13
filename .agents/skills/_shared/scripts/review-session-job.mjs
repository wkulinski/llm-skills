#!/usr/bin/env node

// One review round delegated to a separate agent session (for example through
// direct CLI). The helper prepares and validates the round; it never starts
// agents or polls. The coordinating agent launches sessions and passes the
// results in. Every operation returns `next`: launch the next attempt, evaluate
// an accepted report, or fall back to the coordinator's own (self) review.

import crypto from "node:crypto";
import {existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {resolveArtifactCacheRoot, resolveRepositoryRoot} from "./artifact-path.mjs";
import {spawnSync} from "./file-process.mjs";
import {isMainModule} from "./is-main-module.mjs";

export const JOB_VERSION = 1;
export const ATTEMPTS = Object.freeze(["1", "2", "3"]);
export const ENVELOPE_STATUSES = Object.freeze(["COMPLETE", "INCOMPLETE", "BLOCKED", "STALE"]);
export const FAILURE_REASONS = Object.freeze([
    "LAUNCH_FAILED",
    "PROVIDER_ERROR",
    "TIMEOUT_STOPPED",
    "TIMEOUT_STOP_UNCONFIRMED",
]);
export const DEFAULT_TIMEOUT_SECONDS = 1200;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PREFIX_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENV_LOADER = fileURLToPath(new URL("./env-load.sh", import.meta.url));
// Keys are positional arguments, never interpolated into shell source.
const CONFIG_SCRIPT = `set +eu
source "$1" >/dev/null || exit 1
ensure_repo_env_loaded "$2" >/dev/null || true
shift 2
for key in "$@"; do printf '%s=%s\\0' "$key" "\${!key:-}"; done
`;

export class JobError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function writeAtomic(filePath, content) {
    const temporary = `${filePath}.${process.pid}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, filePath);
}

function readJson(filePath, code) {
    try {
        return JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
        throw new JobError(code, `Cannot read JSON from ${filePath}: ${error.message}`);
    }
}

function canonicalPath(value) {
    const resolved = path.resolve(value);
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
}

function contains(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function configKeys(prefix) {
    const keys = [`${prefix}_TIMEOUT_SECONDS`];
    for (const attempt of ATTEMPTS) {
        for (const field of ["HARNESS", "MODEL", "THINKING", "MODE"]) {
            keys.push(`${prefix}_${attempt.toUpperCase()}_${field}`);
        }
    }
    return keys;
}

/**
 * Read the review configuration from the project env (env-load.sh), so the
 * consumer project's env files decide the reviewer, not the caller's shell.
 */
export function readProjectConfig(repo, prefix) {
    const keys = configKeys(prefix);
    const result = spawnSync("bash", ["--noprofile", "--norc", "-c", CONFIG_SCRIPT, "review-session-config", ENV_LOADER, repo, ...keys], {
        cwd: repo, env: {...process.env}, encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL",
    });
    if (result.error || result.status !== 0) {
        throw new JobError("CONFIG_UNREADABLE", "Cannot read the review configuration through env-load.sh.");
    }
    const values = {};
    for (const entry of String(result.stdout ?? "").split("\0")) {
        const separator = entry.indexOf("=");
        if (separator > 0) { values[entry.slice(0, separator)] = entry.slice(separator + 1); }
    }
    return values;
}

/**
 * Turn raw env values into attempts. Empty profiles are absent; incomplete
 * profiles produce warnings and are skipped without disabling valid profiles.
 */
export function resolveAttempts(values, prefix) {
    const attempts = [];
    const problems = [];
    const warnings = [];
    for (const name of ATTEMPTS) {
        const read = (field) => String(values[`${prefix}_${name.toUpperCase()}_${field}`] ?? "").trim();
        // HARNESS is the direct CLI: claude (Claude Code), codex (Codex CLI), opencode (OpenCode).
        const fields = {HARNESS: read("HARNESS"), MODEL: read("MODEL"), THINKING: read("THINKING"), MODE: read("MODE")};
        const missing = Object.keys(fields).filter(field => fields[field] === "");
        if (missing.length === 4) { continue; }
        if (missing.length > 0) {
            warnings.push({code: "PROFILE_CONFIG_INVALID", profile: name,
                missing_keys: missing.map(field => `${prefix}_${name}_${field}`),
                message: `Review profile ${name} skipped: required settings are missing (${missing.join(", ")}).`});
            continue;
        }
        attempts.push({name, provider: fields.HARNESS, model: fields.MODEL, thinking: fields.THINKING, mode: fields.MODE});
    }
    const rawTimeout = String(values[`${prefix}_TIMEOUT_SECONDS`] ?? "").trim();
    const timeoutSeconds = rawTimeout === "" ? DEFAULT_TIMEOUT_SECONDS : Number(rawTimeout);
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0) {
        problems.push(`${prefix}_TIMEOUT_SECONDS must be a positive integer`);
    }
    return {attempts, timeoutSeconds, problems, warnings};
}

function jobsRoot(repo) {
    return path.join(resolveArtifactCacheRoot(repo), "review-session");
}

export function jobDirectory(repo, jobId) {
    if (typeof jobId !== "string" || !UUID_PATTERN.test(jobId)) {
        throw new JobError("INVALID_JOB_ID", "job_id must be a lowercase UUID generated by the coordinator.");
    }
    return path.join(jobsRoot(repo), jobId);
}

function bindingHash(refs) {
    return sha256(refs.map((ref) => `${ref.path}\0${ref.sha256}\n`).join(""));
}

/**
 * Keep owner bookkeeping bound, but out of an independent reviewer's inputs.
 * Pure validation and rendering: nothing is written, so a rejected input leaves
 * no job directory behind and the same job_id can be prepared again.
 */
function buildPlanReviewerView({repo, contextRefs}) {
    const read = ref => readFileSync(path.resolve(repo, ref.path), "utf8");
    const requests = contextRefs.flatMap(ref => {
        try {
            const value = JSON.parse(read(ref));
            return value && typeof value.full_review_count === "number" ? [{ref, value}] : [];
        } catch { return []; }
    });
    // Legacy generic jobs without a plan request retain their existing protocol.
    if (requests.length === 0) { return; }
    if (requests.length !== 1) { throw new JobError("INVALID_REVIEW_REQUEST", "Exactly one plan review request is required."); }
    const {value: request} = requests[0];
    const scope = request.review_scope ?? (request.delta_review_count > 0 ? "delta" : "full");
    if (scope !== "full") { return; }
    const plan = read(contextRefs[0]);
    const match = /^(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)([\s\S]*)$/.exec(plan);
    if (!match) { throw new JobError("INVALID_REVIEW_PLAN", "Full review requires a Markdown plan with front matter as its first input."); }
    const metadata = match[2].split(/\r?\n/);
    const evidenceKeys = ["source_artifact", "context_report", "context_criteria"];
    const evidence = evidenceKeys.flatMap(key => {
        const line = metadata.find(line => line.startsWith(`${key}:`));
        if (!line) { return []; }
        const value = line.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, "");
        if (!value || value === "null") { return []; }
        const ref = contextRefs.find(ref => path.resolve(repo, ref.path) === path.resolve(repo, value));
        if (!ref) { throw new JobError("REVIEW_EVIDENCE_UNBOUND", `Missing bound evidence: ${key}`); }
        return [ref];
    });
    // Remove defined top-level workflow fields and their indented YAML values.
    // Never filter the body: decisions, risks and fixes remain reviewable claims.
    const hidden = /^(?:review_[\w]+|reviewed_[\w]+|previous_sha256|revision|status):/;
    let omit = false;
    const visible = metadata.filter(line => {
        if (/^[^ #\s][^:]*:/.test(line)) { omit = hidden.test(line); }
        return !omit;
    });
    return {
        view: match[1] + visible.join("\n") + match[3] + match[4],
        scopeBytes: JSON.stringify({review_scope: "full", independent: true}),
        evidence,
    };
}

function writePlanReviewerView(job, {view, scopeBytes, evidence}) {
    const viewPath = path.join(job.directory, "review-plan.md");
    writeFileSync(viewPath, view);
    const requestPath = path.join(job.directory, "review-scope.json");
    writeFileSync(requestPath, scopeBytes);
    job.reviewer_context_refs = [
        {path: path.relative(job.repo, viewPath), sha256: sha256(view)},
        {path: path.relative(job.repo, requestPath), sha256: sha256(scopeBytes)},
        ...evidence,
    ];
}

function renderPrompt(job, task) {
    const inputs = (job.reviewer_context_refs ?? job.context_refs).map((ref) => `- ${ref.path} (sha256 ${ref.sha256})`).join("\n");
    return `You are a delegated reviewer started by a coordinating agent in a separate session.
You are not the main agent of this repository: do not run \`$context-refresh\` or the
repository-context hybrid, do not follow the startup procedure of AGENTS.md, do not
ask the user questions, and do not start other agents or harness sessions. Do not edit, create
or delete repository files; your own temporary artifacts may go only under
${job.cache_root}.

Job: ${job.job_id}
binding_sha256: ${job.binding_sha256}

Bound inputs (paths relative to ${job.repo}; read them, never modify them):
${inputs}

## Task

${task.trim()}

## Result

Return ONLY one JSON object, with no text or code fence around it:
{"version":${JOB_VERSION},"job_id":"${job.job_id}","binding_sha256":"${job.binding_sha256}","status":"COMPLETE|INCOMPLETE|BLOCKED|STALE","report_markdown":"<report required by the task>","payload":<JSON object required by the task>}
The status describes whether the review work finished, not a verdict. Use STALE when
a bound input no longer matches its sha256, INCOMPLETE when essential input is missing.
`;
}

function selfNext(reason, details = undefined) {
    return details === undefined ? {action: "self", reason} : {action: "self", reason, details};
}

function launchNext(job, attempt) {
    return {
        action: "launch",
        attempt: attempt.name,
        launch: {
            provider: attempt.provider,
            model: attempt.model,
            thinking: attempt.thinking,
            ...(attempt.mode ? {mode: attempt.mode} : {}),
            cwd: job.repo,
            wait_timeout_seconds: job.timeout_seconds,
            title: `${job.kind} ${job.job_id} ${attempt.name}`,
            prompt_path: path.join(path.relative(job.repo, job.directory), "prompt.md"),
        },
    };
}

function profileFingerprint(attempt) {
    return sha256(JSON.stringify([attempt.provider, attempt.model, attempt.thinking, attempt.mode ?? ""]));
}

function previousCycleJob(options, repo, prefix, cwd) {
    if (!options.previousJob) { return null; }
    const file = canonicalPath(path.resolve(cwd, options.previousJob));
    const previous = loadJob(file);
    const expected = path.join(jobDirectory(repo, previous.job_id), "job.json");
    const firstInput = options.context?.[0];
    const firstPath = firstInput ? path.relative(repo, canonicalPath(path.resolve(cwd, firstInput))) : null;
    if (file !== expected || previous.repo !== repo || previous.prefix !== prefix || previous.kind !== options.kind
        || previous.context_refs?.[0]?.path !== firstPath) {
        throw new JobError("CYCLE_JOB_MISMATCH", "The previous job must belong to the same repository, prefix, kind and first bound input.");
    }
    if (!previous.result || !["ACCEPTED", "SELF"].includes(previous.result.decision)) {
        throw new JobError("PREVIOUS_JOB_UNFINISHED", "Finish the previous round before preparing its continuation.");
    }
    return previous;
}

export function prepareJob(options, {cwd = process.cwd(), now = new Date(), readConfig = readProjectConfig} = {}) {
    const repo = canonicalPath(resolveRepositoryRoot(options.root ?? cwd));
    const prefix = String(options.prefix ?? "");
    if (!PREFIX_PATTERN.test(prefix)) {
        throw new JobError("INVALID_PARAMETERS", "--prefix must be an upper-case env prefix, e.g. PLAN_REVIEW.");
    }
    if (typeof options.kind !== "string" || !/^[a-z][a-z0-9-]*$/.test(options.kind)) {
        throw new JobError("INVALID_PARAMETERS", "--kind must be a kebab-case label, e.g. plan-review.");
    }
    if (typeof options.task !== "string" || !existsSync(options.task)) {
        throw new JobError("INVALID_PARAMETERS", "--task must name an existing task file.");
    }
    const directory = jobDirectory(repo, options.jobId);

    const previous = previousCycleJob(options, repo, prefix, cwd);
    let config;
    try {
        config = resolveAttempts(readConfig(repo, prefix), prefix);
    } catch (error) {
        return {job_path: null, next: selfNext("CONFIG_UNREADABLE", error.message)};
    }
    // Jobs form a cycle-local chain; no global provider state or retry timer.
    const disabledProfiles = {...previous?.disabled_profiles};
    const skipped = [];
    config.attempts = config.attempts.filter(attempt => {
        const disabled = disabledProfiles[attempt.name];
        if (!disabled) { return true; }
        if (disabled.fingerprint !== profileFingerprint(attempt)) {
            delete disabledProfiles[attempt.name]; // Explicit profile configuration change enables a new attempt.
            return true;
        }
        skipped.push({profile: attempt.name, reason: disabled.reason});
        return false;
    });
    const newWarnings = config.warnings.filter(warning => !(previous?.config_warnings ?? [])
        .some(old => JSON.stringify(old) === JSON.stringify(warning)));
    const notices = {...(newWarnings.length > 0 ? {warnings: newWarnings} : {}),
        ...(skipped.length > 0 ? {skipped_profiles: skipped} : {})};
    if (config.problems.length > 0) {
        return {job_path: null, ...notices, next: selfNext("CONFIG_INVALID", config.problems)};
    }
    if (config.attempts.length === 0) {
        const reason = skipped.length > 0 ? "CYCLE_PROFILES_EXHAUSTED"
            : config.warnings.length > 0 ? "NO_VALID_PROFILES" : "NOT_CONFIGURED";
        return {job_path: null, ...notices, next: selfNext(reason)};
    }
    if (existsSync(directory)) {
        throw new JobError("JOB_EXISTS", "This job_id was already prepared; prepare a new round with a new job_id.");
    }

    const cacheRoot = canonicalPath(resolveArtifactCacheRoot(repo));
    const contextRefs = (options.context ?? []).map((reference) => {
        const absolute = canonicalPath(path.resolve(cwd, reference));
        if (!existsSync(absolute) || !(contains(repo, absolute) || contains(cacheRoot, absolute))) {
            throw new JobError("INVALID_CONTEXT_REF", `Bound input must be an existing file inside the repository or cache: ${reference}`);
        }
        return {path: path.relative(repo, absolute), sha256: sha256(readFileSync(absolute))};
    });
    if (contextRefs.length === 0) {
        throw new JobError("INVALID_PARAMETERS", "At least one --context input is required; it binds the report to what was reviewed.");
    }

    // Validate the reviewer view before creating the job directory.
    const reviewerView = options.kind === "plan-review" ? buildPlanReviewerView({repo, contextRefs}) : undefined;

    mkdirSync(directory, {recursive: true});
    const job = {
        version: JOB_VERSION,
        job_id: options.jobId,
        kind: options.kind,
        prefix,
        cycle_id: previous?.cycle_id ?? options.jobId,
        previous_job: previous ? path.relative(repo, path.join(previous.directory, "job.json")) : null,
        disabled_profiles: disabledProfiles,
        repo,
        directory,
        cache_root: cacheRoot,
        created_at: now.toISOString(),
        timeout_seconds: config.timeoutSeconds,
        config_warnings: config.warnings,
        context_refs: contextRefs,
        binding_sha256: bindingHash(contextRefs),
        prompt_sha256: null,
        attempts: config.attempts.map((attempt) => ({...attempt, session: null, outcome: null})),
        result: null,
    };
    if (reviewerView) {
        writePlanReviewerView(job, reviewerView);
    }
    const task = readFileSync(options.task, "utf8").replaceAll("<skills_root>", SKILLS_ROOT);
    const prompt = renderPrompt(job, task);
    writeFileSync(path.join(directory, "prompt.md"), prompt);
    job.prompt_sha256 = sha256(prompt);
    const jobPath = path.join(directory, "job.json");
    saveJob(jobPath, job);
    return {job_path: path.relative(repo, jobPath), ...notices, cycle_id: job.cycle_id, next: launchNext(job, job.attempts[0])};
}

function loadJob(jobPath) {
    const job = readJson(jobPath, "INVALID_JOB");
    if (job?.version !== JOB_VERSION || typeof job.job_id !== "string" || !Array.isArray(job.attempts)) {
        throw new JobError("INVALID_JOB", "Unsupported or malformed job file.");
    }
    jobDirectory(job.repo, job.job_id);
    return job;
}

function saveJob(jobPath, job) {
    writeAtomic(jobPath, `${JSON.stringify(job, null, 2)}\n`);
}

function currentAttempt(job) {
    if (job.result !== null) {
        throw new JobError("JOB_FINISHED", "This round already has a final result.", {result: job.result});
    }
    return job.attempts.find((attempt) => attempt.outcome === null) ?? null;
}

// Record a failed attempt and move to the next configured attempt or to self review.
function failAttempt(jobPath, job, attempt, outcome) {
    const changed = inputChanges(job);
    if (changed.length > 0) {
        attempt.outcome = {decision: "STALE", reason: "INPUT_CHANGED", details: changed};
        job.result = {decision: "SELF", reason: "INPUT_CHANGED"};
        saveJob(jobPath, job);
        return {...attempt.outcome, attempt: attempt.name, next: selfNext("INPUT_CHANGED", changed)};
    }
    attempt.outcome = outcome;
    job.disabled_profiles ??= {};
    job.disabled_profiles[attempt.name] = {fingerprint: profileFingerprint(attempt), reason: outcome.reason};
    const following = job.attempts.find((candidate) => candidate.outcome === null);
    const next = following ? launchNext(job, following) : selfNext("ATTEMPTS_EXHAUSTED");
    if (!following) { job.result = {decision: "SELF", reason: "ATTEMPTS_EXHAUSTED"}; }
    saveJob(jobPath, job);
    return {...outcome, attempt: attempt.name, next};
}

function sessionIdentity(inspect) {
    return {
        id: inspect?.id ?? inspect?.Id ?? null,
        parent_id: inspect?.parent_id ?? inspect?.ParentAgentId ?? null,
        provider: inspect?.provider ?? inspect?.Provider ?? null,
        model: inspect?.model ?? inspect?.Model ?? null,
        thinking: inspect?.thinking ?? inspect?.Thinking ?? null,
        cwd: typeof (inspect?.cwd ?? inspect?.Cwd) === "string" ? canonicalPath(inspect.cwd ?? inspect.Cwd) : null,
    };
}

function bindMismatches(identity, attempt, job, parentId) {
    const fields = [];
    if (identity.id === null) { fields.push("id"); }
    if (identity.provider !== attempt.provider) { fields.push("provider"); }
    if (identity.cwd !== job.repo) { fields.push("cwd"); }
    // Providers report model and thinking differently; compare them when reported.
    if (identity.model !== null && identity.model !== attempt.model) { fields.push("model"); }
    if (identity.thinking !== null && identity.thinking !== attempt.thinking) { fields.push("thinking"); }
    if (typeof parentId === "string" && parentId !== "" && identity.parent_id !== parentId) { fields.push("parent_id"); }
    return fields;
}

export function bindSession({jobPath, inspect, parentId = null}) {
    const job = loadJob(jobPath);
    const attempt = currentAttempt(job);
    if (attempt === null) {
        throw new JobError("NO_ATTEMPT_LEFT", "No attempt is waiting for a session.");
    }
    if (attempt.session !== null) {
        throw new JobError("SESSION_ALREADY_BOUND", "The current attempt already has a session.");
    }
    const identity = sessionIdentity(inspect);
    const mismatches = bindMismatches(identity, attempt, job, parentId);
    if (mismatches.length > 0) {
        return {ok: false, ...failAttempt(jobPath, job, attempt, {decision: "REJECTED", reason: "SESSION_MISMATCH", details: mismatches, session_id: identity.id})};
    }
    attempt.session = identity;
    saveJob(jobPath, job);
    return {ok: true, attempt: attempt.name, session: identity, next: {action: "wait", attempt: attempt.name}};
}

function inputChanges(job) {
    const changed = [...job.context_refs, ...(job.reviewer_context_refs ?? [])]
        .filter((ref) => {
            const filePath = path.join(job.repo, ref.path);
            return !existsSync(filePath) || sha256(readFileSync(filePath)) !== ref.sha256;
        })
        .map((ref) => ref.path);
    const promptPath = path.join(job.directory, "prompt.md");
    if (!existsSync(promptPath) || sha256(readFileSync(promptPath)) !== job.prompt_sha256) { changed.push("prompt.md"); }
    return changed;
}

// Harnesses differ in the framing around the final message
// (Codex prefixes a `---` separator). The envelope is the last line that is by
// itself one JSON object; text sharing that line with the JSON is still rejected.
function extractEnvelope(text) {
    const lines = String(text).split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (!lines[index].startsWith("{")) { continue; }
        try {
            const candidate = JSON.parse(lines[index]);
            if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate) && "job_id" in candidate) {
                return candidate;
            }
        } catch {
            // Not an envelope line; keep looking.
        }
    }
    return null;
}

export function parseEnvelope(text) {
    let envelope = null;
    try {
        envelope = JSON.parse(String(text).trim());
    } catch {
        envelope = extractEnvelope(text);
    }
    if (envelope === null) {
        return {ok: false, errors: ["envelope is not a single JSON object"]};
    }
    if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
        return {ok: false, errors: ["envelope must be an object"]};
    }
    const errors = [];
    if (envelope.version !== JOB_VERSION) { errors.push("version must be 1"); }
    if (typeof envelope.job_id !== "string") { errors.push("job_id is required"); }
    if (typeof envelope.binding_sha256 !== "string") { errors.push("binding_sha256 is required"); }
    if (!ENVELOPE_STATUSES.includes(envelope.status)) { errors.push("status is not supported"); }
    if (typeof envelope.report_markdown !== "string" || envelope.report_markdown.trim() === "") {
        errors.push("report_markdown must be non-empty text");
    }
    if (envelope.status === "COMPLETE"
        && (envelope.payload === null || typeof envelope.payload !== "object" || Array.isArray(envelope.payload))) {
        errors.push("payload must be an object when status is COMPLETE");
    }
    return errors.length === 0 ? {ok: true, envelope} : {ok: false, errors};
}

/**
 * Accept or reject the final message of the current attempt. A changed bound
 * input means the review covered something else: the round ends in self review
 * of the current state instead of another external attempt.
 */
export function acceptResult({jobPath, envelopeText, inspect, validateReport = null}) {
    const job = loadJob(jobPath);
    const attempt = currentAttempt(job);
    if (attempt === null || attempt.session === null) {
        throw new JobError("SESSION_NOT_BOUND", "Bind the launched session before accepting its result.");
    }
    const changed = inputChanges(job);
    if (changed.length > 0) {
        attempt.outcome = {decision: "STALE", reason: "INPUT_CHANGED", details: changed};
        job.result = {decision: "SELF", reason: "INPUT_CHANGED"};
        saveJob(jobPath, job);
        return {...attempt.outcome, attempt: attempt.name, next: selfNext("INPUT_CHANGED", changed)};
    }
    const identity = sessionIdentity(inspect);
    if (identity.id !== attempt.session.id) {
        return failAttempt(jobPath, job, attempt, {decision: "REJECTED", reason: "SESSION_MISMATCH", details: ["id"]});
    }
    if ((inspect?.pending_permissions ?? inspect?.PendingPermissions ?? []).length > 0) {
        return failAttempt(jobPath, job, attempt, {decision: "BLOCKED", reason: "PERMISSION_PENDING"});
    }
    const parsed = parseEnvelope(envelopeText);
    if (!parsed.ok) {
        return failAttempt(jobPath, job, attempt, {decision: "REJECTED", reason: "REPORT_INVALID", details: parsed.errors});
    }
    const {envelope} = parsed;
    if (envelope.job_id !== job.job_id) {
        return failAttempt(jobPath, job, attempt, {decision: "REJECTED", reason: "JOB_MISMATCH"});
    }
    if (envelope.binding_sha256 !== job.binding_sha256) {
        return failAttempt(jobPath, job, attempt, {decision: "REJECTED", reason: "BINDING_MISMATCH"});
    }
    if (envelope.status === "STALE") {
        attempt.outcome = {decision: "STALE", reason: "EXECUTOR_REPORTED_STALE"};
        job.result = {decision: "SELF", reason: "EXECUTOR_REPORTED_STALE"};
        saveJob(jobPath, job);
        return {...attempt.outcome, attempt: attempt.name, next: selfNext("EXECUTOR_REPORTED_STALE")};
    }
    if (envelope.status !== "COMPLETE") {
        return failAttempt(jobPath, job, attempt, {decision: "REJECTED", reason: `EXECUTOR_${envelope.status}`, details: [envelope.report_markdown.slice(0, 500)]});
    }
    const reviewer = {mode: "external", attempt: attempt.name, provider: attempt.provider, model: attempt.model, thinking: attempt.thinking, session_id: attempt.session.id};
    const result = {
        decision: "ACCEPTED",
        job_id: job.job_id,
        binding_sha256: job.binding_sha256,
        context_refs: job.context_refs,
        ...(job.reviewer_context_refs ? {independent_full_review: true} : {}),
        reviewer,
        report_markdown: envelope.report_markdown,
        payload: envelope.payload,
        next: {action: "evaluate"},
    };
    // Validate the consumer's protocol before finalizing the attempt. A valid
    // blocking verdict is a completed review, not a transport failure.
    if (validateReport !== null) {
        const validation = validateReport(result);
        if (validation.ok !== true) {
            return failAttempt(jobPath, job, attempt, {decision: "REJECTED", reason: "REPORT_PAYLOAD_INVALID", details: validation.errors});
        }
    }
    writeAtomic(path.join(job.directory, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
    attempt.outcome = {decision: "ACCEPTED"};
    job.result = {decision: "ACCEPTED", reviewer};
    saveJob(jobPath, job);
    return result;
}

export function recordFailure({jobPath, reason}) {
    if (!FAILURE_REASONS.includes(reason)) {
        throw new JobError("INVALID_ARGUMENTS", `--reason must be one of: ${FAILURE_REASONS.join(", ")}.`);
    }
    const job = loadJob(jobPath);
    const attempt = currentAttempt(job);
    if (attempt === null) {
        throw new JobError("NO_ATTEMPT_LEFT", "No attempt is running.");
    }
    return failAttempt(jobPath, job, attempt, {decision: "FAILED", reason, session_id: attempt.session?.id ?? null});
}

/**
 * The runner was stopped (signal, or its own death found on restart) while an
 * attempt was bound. This is neither a provider failure nor a verdict about the
 * profile: it stays enabled for later rounds, and this round ends in self review.
 */
export function recordInterruption({jobPath, stopped = true}) {
    const job = loadJob(jobPath);
    const attempt = currentAttempt(job);
    if (attempt === null) {
        throw new JobError("NO_ATTEMPT_LEFT", "No attempt is running.");
    }
    attempt.outcome = {
        decision: "INTERRUPTED",
        reason: stopped ? "RUNNER_INTERRUPTED" : "RUNNER_INTERRUPTED_STOP_UNCONFIRMED",
        session_id: attempt.session?.id ?? null,
    };
    job.result = {decision: "SELF", reason: "INTERRUPTED"};
    saveJob(jobPath, job);
    return {...attempt.outcome, attempt: attempt.name, next: selfNext("INTERRUPTED")};
}

function usage() {
    return `Usage:
  review-session-job.mjs prepare --prefix <ENV_PREFIX> --kind <label> --job-id <uuid> --task <file> --context <file>... [--root <repo>] [--previous-job <job.json>]
  review-session-job.mjs bind-session --job <job.json> --inspect <identity.json> [--parent-id <agent-id>]
  review-session-job.mjs accept --job <job.json> --envelope <final-message.txt> --inspect <identity.json>
  review-session-job.mjs record-failure --job <job.json> --reason <${FAILURE_REASONS.join("|")}>

Configuration comes from the project env: <PREFIX>_<N>_{HARNESS,MODEL,THINKING,MODE}
for N=1,2,3 in preference order (empty profiles are skipped; incomplete ones are
skipped with warnings), and <PREFIX>_TIMEOUT_SECONDS
(default ${DEFAULT_TIMEOUT_SECONDS}). HARNESS is the direct CLI (claude, codex,
opencode); MODEL and THINKING are native harness identifiers.
Pass --previous-job only for another round of the same planning cycle. Unchanged
failed profiles are skipped; changed settings enable retries. Omit it for a new
cycle. skipped_profiles is a brief progress notice, not a blocker.
Every result carries "next": launch, wait,
evaluate or self. The helper never starts agents, executes harnesses, or polls.
`;
}

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const options = {command, context: []};
    for (let index = 0; index < rest.length; index += 1) {
        const key = rest[index];
        const value = rest[index + 1];
        if (!key.startsWith("--") || index + 1 >= rest.length) {
            throw new JobError("INVALID_ARGUMENTS", `Unexpected argument: ${key}`);
        }
        index += 1;
        if (key === "--context") { options.context.push(value); continue; }
        options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    return options;
}

function run(argv) {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
        process.stdout.write(usage());
        return 0;
    }
    const options = parseArgs(argv);
    let result;
    if (options.command === "prepare") {
        result = prepareJob(options);
    } else if (options.command === "bind-session") {
        result = bindSession({jobPath: options.job, inspect: readJson(options.inspect, "INVALID_INSPECT"), parentId: options.parentId ?? null});
    } else if (options.command === "accept") {
        result = acceptResult({jobPath: options.job, envelopeText: readFileSync(options.envelope, "utf8"), inspect: readJson(options.inspect, "INVALID_INSPECT")});
    } else if (options.command === "record-failure") {
        result = recordFailure({jobPath: options.job, reason: options.reason});
    } else {
        throw new JobError("INVALID_ARGUMENTS", `Unknown command: ${options.command}`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
}

if (isMainModule(import.meta.url)) {
    try {
        process.exitCode = run(process.argv.slice(2));
    } catch (error) {
        const payload = {error: error.code ?? "UNEXPECTED", message: error.message, details: error.details ?? {}};
        process.stderr.write(`${JSON.stringify(payload)}\n`);
        process.exitCode = 1;
    }
}
