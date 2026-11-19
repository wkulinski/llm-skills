import {validateVerification, validateHistoryCoverage} from "./verification.mjs";
import {createHash} from "node:crypto";

export const SCHEMA_VERSION = 1;
export const RULES = Object.freeze({normalization: 1, analysis: 4});
export const STATES = Object.freeze({
    completeness: ["complete", "partial"],
    analysis: ["pending", "complete", "needs_decision"],
    delivery: ["not_required", "delivery_pending", "applied", "declined"],
    historical: ["fixed", "rejected", "accepted", "suggestion", "unresolved"],
    currency: ["current_application", "existing_coverage", "existing_safeguard", "historical", "superseded", "no_evidence"],
});

function assert(condition, code, message) {
    if (!condition) { throw Object.assign(new Error(message), {code}); }
}
function object(value) {
    assert(value !== null && typeof value === "object" && !Array.isArray(value), "INVALID_FORMAT", "Expected object");
}
function string(value) {
    assert(typeof value === "string" && value.length > 0, "INVALID_FORMAT", "Expected non-empty string");
}
function list(value) {
    assert(Array.isArray(value), "INVALID_FORMAT", "Expected array");
}
function member(value, values) {
    assert(values.includes(value), "INVALID_STATE", `Invalid state: ${value}`);
}
function hash(value) {
    assert(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "INVALID_HASH", "Expected SHA-256");
}
function sha(value) {
    assert(typeof value === "string" && /^[a-f0-9]{40,64}$/.test(value), "INVALID_SHA", "Expected Git SHA");
}
function unique(items, key = "id") {
    list(items);
    const ids = items.map((item) => { string(item[key]); return item[key]; });
    assert(new Set(ids).size === ids.length, "DUPLICATE_ID", `Duplicate ${key}`);
    return new Set(ids);
}
function envelope(value, kind) {
    object(value);
    assert(value.schemaVersion === SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", "Unsupported schema version");
    assert(value.kind === kind, "INVALID_FORMAT", `Expected ${kind}`);
    repository(value.repository);
}
function repository(value) {
    object(value);
    for (const field of ["id", "name", "branch"]) { string(value[field]); }
}
export function assertRepository(actual, expected) {
    repository(actual);
    repository(expected);
    assert(["id", "name", "branch"].every((key) => actual[key] === expected[key]), "REPOSITORY_CONFLICT", "Repository identity or branch differs");
}
function rules(value) {
    object(value);
    for (const key of Object.keys(RULES)) {
        assert(Number.isInteger(value[key]) && value[key] > 0, "INVALID_FORMAT", `Invalid rule version: ${key}`);
    }
}

// Explicit projection excludes fetchedAt, ETag and any unknown transport fields.
export const SOURCE_FIELDS = Object.freeze([
    "id", "kind", "prId", "body", "url", "author", "createdAt", "updatedAt",
    "replyToId", "reviewId", "threadId", "reviewState", "threadResolved", "threadOutdated",
    "path", "line", "side", "startLine", "startSide", "originalLine", "originalStartLine",
    "diffHunk", "commitSha", "originalCommitSha",
]);
function source(value) {
    object(value);
    for (const key of ["id", "prId", "url", "createdAt"]) { string(value[key]); }
    member(value.kind, ["review", "review_comment", "issue_comment", "thread"]);
    assert(typeof value.body === "string", "INVALID_FORMAT", "Source body must be a string, including empty body");
    for (const key of SOURCE_FIELDS) {
        assert(Object.hasOwn(value, key), "INVALID_FORMAT", `Missing normalized source field: ${key}`);
    }
    for (const key of ["replyToId", "reviewId", "threadId", "reviewState", "path", "side", "startSide", "diffHunk", "updatedAt", "commitSha", "originalCommitSha"]) {
        assert(value[key] === null || typeof value[key] === "string", "INVALID_FORMAT", `Invalid source field: ${key}`);
    }
    assert(value.author === null || (typeof value.author?.id === "string" && typeof value.author?.login === "string"), "INVALID_FORMAT", "Invalid author");
    for (const key of ["line", "startLine", "originalLine", "originalStartLine"]) {
        assert(value[key] === null || (Number.isInteger(value[key]) && value[key] > 0), "INVALID_FORMAT", `Invalid line: ${key}`);
    }
    for (const key of ["threadResolved", "threadOutdated"]) {
        assert(value[key] === null || typeof value[key] === "boolean", "INVALID_FORMAT", `Invalid thread state: ${key}`);
    }
}
export function canonicalJson(value) {
    if (value === null || typeof value === "string" || typeof value === "boolean") { return JSON.stringify(value); }
    if (typeof value === "number" && Number.isFinite(value)) { return JSON.stringify(value); }
    if (Array.isArray(value)) { return `[${value.map(canonicalJson).join(",")}]`; }
    object(value);
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
export function fingerprint(value) {
    return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
function byId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
export function canonicalSources(sources) {
    unique(sources);
    return sources.map((item) => {
        source(item);
        const projected = Object.fromEntries(SOURCE_FIELDS.map((key) => [key, item[key]]));
        if (projected.author !== null) {
            projected.author = {id: projected.author.id, login: projected.author.login};
        }
        return projected;
    }).sort(byId);
}
export function sourceFingerprint(sources) { return fingerprint(canonicalSources(sources)); }

export function validateSources(value) {
    envelope(value, "sources");
    rules(value.rules);
    object(value.read);
    string(value.read.startedAt);
    string(value.read.finishedAt);
    sha(value.read.targetSha);
    member(value.read.completeness, STATES.completeness);
    list(value.read.gaps);
    if (value.read.completeness === "complete") {
        assert(value.read.gaps.length === 0, "INCOMPLETE_READ", "Complete read has gaps");
    }
    const prs = unique(value.prs);
    for (const pr of value.prs) {
        assert(Number.isInteger(pr.number) && pr.number > 0, "INVALID_FORMAT", "Invalid PR number");
        string(pr.mergedAt);
        sha(pr.baseSha);
        sha(pr.headSha);
        assert(pr.mergeSha === null || /^[a-f0-9]{40,64}$/.test(pr.mergeSha), "INVALID_SHA", "Invalid merge SHA");
    }
    const ids = unique(value.sources);
    for (const item of canonicalSources(value.sources)) {
        assert(prs.has(item.prId), "UNKNOWN_REFERENCE", "Unknown PR");
        for (const key of ["replyToId", "reviewId", "threadId"]) {
            if (item[key] !== null) {
                assert(ids.has(item[key]), "UNKNOWN_REFERENCE", `Unknown ${key}`);
                assert(value.sources.find((target) => target.id === item[key]).prId === item.prId, "UNKNOWN_REFERENCE", "Cross-PR source reference");
            }
        }
    }
    return value;
}
function documentPath(path) {
    string(path);
    assert(!path.startsWith("/") && !path.includes("\\") && !path.split("/").some((part) => ["", ".", "..", ".git"].includes(part)) && !/^[a-z]:/i.test(path), "INVALID_PATH", "Expected a repository-relative document path");
}
function documents(items) {
    unique(items, "path");
    for (const item of items) {
        documentPath(item.path);
        if (item.beforeHash !== null) { hash(item.beforeHash); }
        hash(item.afterHash);
    }
}
function context(value) {
    object(value);
    hash(value.fingerprint);
    unique(value.files, "path");
    for (const file of value.files) {
        documentPath(file.path);
        member(file.mode, ["100644", "100755", "120000", "160000"]);
        hash(file.hash);
    }
    string(value.environmentScope);
}
export function validatePrepared(value, sources) {
    envelope(value, "prepared");
    validateSources(sources);
    assertRepository(value.repository, sources.repository);
    rules(value.rules);
    assert(canonicalJson(value.rules) === canonicalJson(sources.rules), "RULES_CONFLICT", "Prepared rules differ from sources");
    sha(value.projectSha);
    context(value.context);
    if (value.expectedLockHash !== null) { hash(value.expectedLockHash); }
    const ids = unique(value.items, "prId");
    for (const item of value.items) {
        assert(sources.prs.some((pr) => pr.id === item.prId), "UNKNOWN_REFERENCE", "Unknown prepared PR");
        hash(item.sourceFingerprint);
        assert(item.sourceFingerprint === sourceFingerprint(sources.sources.filter((s) => s.prId === item.prId)), "SOURCE_CONFLICT", "Sources differ");
        unique(item.sourceIds.map((id) => ({id})));
        const expected = sources.sources.filter((s) => s.prId === item.prId).map((s) => s.id).sort();
        assert(canonicalJson([...item.sourceIds].sort()) === canonicalJson(expected), "SOURCE_CONFLICT", "Prepared source coverage differs");
        list(item.reasons);
        list(item.materials);
        for (const material of item.materials) {
            string(material.id);
            member(material.status, ["available", "missing"]);
            string(material.provenance);
        }
    }
    assert(Number.isInteger(value.totalPending) && value.totalPending >= ids.size, "INVALID_FORMAT", "Invalid pending count");
    return value;
}
function assessment(value, sourceIds) {
    string(value.id);
    member(value.historical, STATES.historical);
    member(value.currency, STATES.currency);
    string(value.rationale);
    string(value.verificationScope);
    list(value.evidence);
    list(value.sources);
    assert(value.sources.length > 0, "UNKNOWN_REFERENCE", "Assessment requires a source");
    for (const ref of value.sources) {
        assert(sourceIds.has(ref.id) ? ref.unavailable !== true : ref.unavailable === true, "UNKNOWN_REFERENCE", `Unknown or incorrectly marked source ${ref.id}`);
        if (ref.unavailable === true) { assert(!ref.quote, "INVALID_REFERENCE", "Unavailable source requires its stored range"); }
        assert((typeof ref.quote === "string" && ref.quote.length > 0) || (Number.isInteger(ref.start) && Number.isInteger(ref.end) && ref.start >= 0 && ref.end > ref.start), "INVALID_REFERENCE", "Expected quote or text range");
    }
}
function entry(value, sourceIds) {
    rules(value.rules);
    string(value.prId);
    hash(value.sourceFingerprint);
    sha(value.projectSha);
    hash(value.contextFingerprint);
    member(value.sourceCompleteness, STATES.completeness);
    member(value.analysis, STATES.analysis);
    member(value.delivery, STATES.delivery);
    unique(value.assessments);
    for (const item of value.assessments) {
        assessment(item, sourceIds);
        if (value.rules.analysis >= 2) { validateVerification(item, sourceIds, value.projectSha); }
    }
    unique(value.dispositions, "sourceId");
    for (const item of value.dispositions) {
        assert(sourceIds.has(item.sourceId), "UNKNOWN_REFERENCE", "Unknown disposition source");
        member(item.status, ["assessed", "no_learning", "unresolved"]);
        string(item.rationale);
        list(item.assessmentIds);
        for (const id of item.assessmentIds) {
            assert(value.assessments.some((a) => a.id === id && a.sources.some((s) => s.id === item.sourceId)), "UNKNOWN_REFERENCE", "Unknown or unrelated assessment");
        }
        assert(item.status !== "assessed" || item.assessmentIds.length > 0, "INVALID_STATE", "Assessed source needs an assessment");
    }
    const covered = new Set(value.dispositions.map((item) => item.sourceId));
    assert([...sourceIds].every((id) => covered.has(id)), "INCOMPLETE_COVERAGE", "Missing source disposition");
    if (value.analysis === "complete") {
        assert(value.sourceCompleteness === "complete" && value.dispositions.every((s) => s.status !== "unresolved") && value.assessments.every((a) => a.historical !== "unresolved" && a.currency !== "no_evidence"), "INVALID_STATE", "Unresolved analysis cannot be complete");
    }
    documents(value.documents);
    if (["delivery_pending", "applied"].includes(value.delivery)) {
        assert(value.documents.length > 0, "INVALID_STATE", "Delivery requires documents");
    }
    if (value.delivery === "declined") { string(value.userDecisionRef); }
    if (value.delivery === "applied") { assert(value.finalDocumentsReviewed === true, "INVALID_STATE", "Final document review required"); }
}
export function validateResult(value, prepared, sources) {
    envelope(value, "result");
    validatePrepared(prepared, sources);
    assertRepository(value.repository, prepared.repository);
    assert(canonicalJson(value.rules) === canonicalJson(prepared.rules), "RULES_CONFLICT", "Rules differ");
    assert(value.expectedLockHash === prepared.expectedLockHash, "LOCK_CONFLICT", "Lock token differs");
    assert(value.inputContextFingerprint === prepared.context.fingerprint, "CONTEXT_CONFLICT", "Input context differs");
    unique(value.entries, "prId");
    assert(value.entries.length === prepared.items.length, "INCOMPLETE_COVERAGE", "Missing prepared PR");
    for (const item of value.entries) {
        assert(canonicalJson(item.rules) === canonicalJson(value.rules), "RULES_CONFLICT", "Entry rules differ");
        const input = prepared.items.find((p) => p.prId === item.prId);
        assert(input, "UNKNOWN_REFERENCE", "PR outside prepared batch");
        assert(item.sourceFingerprint === input.sourceFingerprint && item.projectSha === prepared.projectSha && item.contextFingerprint === prepared.context.fingerprint, "SNAPSHOT_CONFLICT", "Result snapshot differs");
        assert(item.sourceCompleteness === sources.read.completeness, "INCOMPLETE_READ", "Result completeness differs from collection");
        entry(item, new Set(input.sourceIds));
        if (item.rules.analysis >= 2) { validateHistoryCoverage(item, input, sources); }
    }
    return value;
}
export function validateLock(value, expectedRepository) {
    envelope(value, "lock");
    if (expectedRepository) { assertRepository(value.repository, expectedRepository); }
    rules(value.rules);
    unique(value.entries, "prId");
    for (const item of value.entries) {
        unique(item.sourceIds.map((id) => ({id})));
        entry(item, new Set(item.sourceIds));
    }
    return value;
}
export function pendingReasons(entryValue, {sourceFingerprint: currentSources, contextFingerprint, rules: currentRules}, previousRules = entryValue.rules) {
    const reasons = [];
    if (entryValue.sourceFingerprint !== currentSources) { reasons.push("sources_changed"); }
    if (entryValue.contextFingerprint !== contextFingerprint) { reasons.push("context_changed"); }
    if (canonicalJson(previousRules) !== canonicalJson(currentRules)) { reasons.push("rules_changed"); }
    if (entryValue.sourceCompleteness !== "complete") { reasons.push("incomplete_sources"); }
    if (entryValue.analysis !== "complete") { reasons.push("analysis_pending"); }
    if (entryValue.delivery === "delivery_pending") { reasons.push("delivery_pending"); }
    return reasons;
}
