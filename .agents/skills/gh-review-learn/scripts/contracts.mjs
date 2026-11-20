import {validateVerification, validateHistoryCoverage} from "./verification.mjs";
import {createHash} from "node:crypto";

export const SCHEMA_VERSION = 2;
export const SOURCE_SCHEMA_VERSION = 1;
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
    assert((["sources", "inventory"].includes(kind) ? [SOURCE_SCHEMA_VERSION] : [1, SCHEMA_VERSION]).includes(value.schemaVersion), "UNSUPPORTED_SCHEMA", "Unsupported schema version");
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
export function validateInventory(value) {
    envelope(value, "inventory");
    validateSources({...value, kind: "sources", sources: []});
    string(value.read.boundary);
    return value;
}
export function assertBatchSources(batch, sources, entries = []) {
    if (batch && !sources.batchId) {
        assertRepository(sources.repository, batch.repository);
        assert(sources.prs.every((pr) => entries.some((stored) => stored.prId === pr.id)), "BATCH_CONFLICT", "Only stored PRs can be reassessed outside the active batch");
        return;
    }
    assert((sources.batchId ?? null) === (batch?.id ?? null), "BATCH_CONFLICT", "Resume the active batch before preparing or recording analysis");
    if (!batch) { return; }
    assertRepository(sources.repository, batch.repository);
    assert(sources.read.boundary === batch.boundary, "BATCH_CONFLICT", "Batch read boundary differs");
    for (const pr of sources.prs) {
        assert(batch.prIds.includes(pr.id) && !batch.recordedPrIds.includes(pr.id), "BATCH_CONFLICT", "PR is outside the unfinished batch");
        assert(canonicalJson(batch.members.find((item) => item.id === pr.id)) === canonicalJson(pr), "BATCH_CONFLICT", "Batch member metadata changed");
    }
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
/** A format upgrade is explicit and lossless; reading never migrates a file. */
export function upgradeLock(value) {
    validateLock(value);
    const next = structuredClone(value);
    if (next.schemaVersion === 1) {
        next.schemaVersion = SCHEMA_VERSION;
        next.documentationChanges = [];
        next.activeBatch = null;
        next.activeDelivery = null;
        next.lastDelivery = null;
        for (const item of next.entries) {
            item.documentationChangeIds = [];
            item.historicalDocumentation = {schemaVersion: 1, details: "unavailable"};
        }
    }
    return next;
}
export function deliveryState(changes) {
    if (changes.some((change) => change.status === "proposed")) { return "delivery_pending"; }
    if (changes.some((change) => change.status === "applied")) { return "applied"; }
    return changes.length ? "declined" : "not_required";
}
function targetContent(change) {
    return {path: change.path, section: change.section, description: change.description, beforeHash: change.beforeHash, afterHash: change.afterHash};
}
export function validateChangeRevisions(previous, changes) {
    for (const old of previous) {
        const next = changes.find((change) => change.id === old.id);
        assert(next, "CHANGE_CONFLICT", "A stored proposal cannot disappear");
        const changed = canonicalJson(targetContent(old)) !== canonicalJson(targetContent(next));
        if (changed) {
            assert(next.revision === old.revision + 1 && next.status === "proposed", "REVISION_CONFLICT", "Changed content requires a new proposed revision");
        } else {
            assert(next.revision === old.revision, "REVISION_CONFLICT", "Unchanged content must keep its revision");
            if (["applied", "declined"].includes(old.status)) {
                assert(next.status === old.status, "REVISION_CONFLICT", "A completed decision cannot change without a new proposed revision");
                assert(["appliedOperationId", "appliedAt", "finalDocumentsReviewed", "userDecisionRef"].every((key) => next[key] === old[key]), "REVISION_CONFLICT", "A completed decision must preserve its provenance");
            }
        }
    }
    for (const change of changes.filter((item) => !previous.some((old) => old.id === item.id))) {
        assert(change.revision === 1, "REVISION_CONFLICT", "A new proposal starts at revision 1");
    }
}
export function validateDocumentationChanges(changes, entries) {
    const ids = unique(changes);
    unique(entries, "prId");
    for (const change of changes) {
        assert(Number.isSafeInteger(change.revision) && change.revision > 0, "INVALID_FORMAT", "Invalid proposal revision");
        documentPath(change.path);
        assert(change.path !== "review-learning.lock.json", "INVALID_PATH", "Lock is not a documentation destination");
        for (const key of ["section", "description", "rationale"]) { string(change[key]); }
        if (change.beforeHash !== null) { hash(change.beforeHash); }
        hash(change.afterHash);
        member(change.status, ["proposed", "applied", "declined"]);
        if (change.status === "declined") { string(change.userDecisionRef); }
        if (change.status === "applied") { assert(change.finalDocumentsReviewed === true, "INVALID_STATE", "Applied proposal needs final document review"); }
        if (change.status === "proposed") {
            assert(["userDecisionRef", "finalDocumentsReviewed", "appliedOperationId", "appliedAt"].every((key) => !Object.hasOwn(change, key)), "INVALID_STATE", "A proposal cannot inherit a delivery decision");
        }
        list(change.references);
        assert(change.references.length > 0, "UNKNOWN_REFERENCE", "Proposal needs an assessment reference");
        const references = new Set();
        for (const ref of change.references) {
            string(ref.prId); string(ref.assessmentId);
            const key = canonicalJson([ref.prId, ref.assessmentId]);
            assert(!references.has(key), "DUPLICATE_ID", "Duplicate assessment reference"); references.add(key);
            const pr = entries.find((item) => item.prId === ref.prId);
            assert(pr?.assessments.some((item) => item.id === ref.assessmentId) && pr.documentationChangeIds?.includes(change.id), "UNKNOWN_REFERENCE", "Unknown or unrelated assessment reference");
        }
    }
    for (const pr of entries) {
        list(pr.documentationChangeIds);
        unique(pr.documentationChangeIds.map((id) => ({id})));
        for (const id of pr.documentationChangeIds) {
            assert(ids.has(id) && changes.find((change) => change.id === id).references.some((ref) => ref.prId === pr.prId), "UNKNOWN_REFERENCE", "Unknown or unrelated proposal");
        }
        if (pr.historicalDocumentation) {
            assert(pr.historicalDocumentation.schemaVersion === 1 && pr.historicalDocumentation.details === "unavailable" && pr.documentationChangeIds.length === 0, "INVALID_STATE", "Historical entry cannot invent proposal details");
            continue;
        }
        const related = changes.filter((change) => pr.documentationChangeIds.includes(change.id));
        assert(pr.delivery === deliveryState(related), "INVALID_STATE", "PR delivery differs from individual proposals");
        const paths = new Set(related.map((change) => change.path));
        assert(pr.documents.length === paths.size && pr.documents.every((doc) => paths.has(doc.path)), "DOCUMENT_CONFLICT", "PR document manifest differs from proposals");
    }
    return changes;
}
function operationSelection(operation, changes) {
    string(operation.operationId);
    string(operation.userDecisionRef);
    unique(operation.changes);
    assert(operation.changes.length > 0, "INVALID_STATE", "Delivery needs a selected proposal");
    for (const item of operation.changes) {
        assert(changes.some((change) => change.id === item.id && change.revision === item.revision), "UNKNOWN_REFERENCE", "Unknown delivery proposal revision");
    }
    documents(operation.documents);
    assert(operation.documents.length > 0, "INVALID_STATE", "Delivery needs a document manifest");
    const paths = new Set(operation.changes.map((item) => changes.find((change) => change.id === item.id).path));
    assert(operation.documents.length === paths.size && operation.documents.every((doc) => paths.has(doc.path)), "DOCUMENT_CONFLICT", "Delivery manifest differs from selected proposals");
}
function validateOperations(value, entries) {
    if (value.lastAbandonedDelivery) {
        const abandoned = value.lastAbandonedDelivery;
        string(abandoned.operationId); string(abandoned.userDecisionRef); string(abandoned.originalDecisionRef); string(abandoned.abandonedAt);
        documents(abandoned.documents); unique(abandoned.changes); unique(abandoned.observed, "path");
        assert(abandoned.changes.length > 0 && abandoned.documents.length > 0, "INVALID_STATE", "Abandoned delivery needs selected changes and documents");
        for (const ref of abandoned.changes) {
            assert(Number.isSafeInteger(ref.revision) && ref.revision > 0 && value.documentationChanges.some((change) => change.id === ref.id && change.revision >= ref.revision), "UNKNOWN_REFERENCE", "Unknown abandoned delivery revision");
        }
        assert(abandoned.observed.length === abandoned.documents.length && abandoned.observed.every((doc) => abandoned.documents.some((item) => item.path === doc.path)), "DOCUMENT_CONFLICT", "Abandoned delivery observation differs from its manifest");
    }
    for (const field of ["activeBatch", "activeDelivery", "lastDelivery"]) {
        assert(Object.hasOwn(value, field), "INVALID_FORMAT", `Missing ${field}`);
        if (value[field] !== null) { object(value[field]); }
    }
    if (value.activeBatch) {
        const batch = value.activeBatch;
        string(batch.id); string(batch.boundary); string(batch.selectedAt); hash(batch.scopeFingerprint);
        assert(Number.isSafeInteger(batch.limit) && batch.limit > 0, "INVALID_FORMAT", "Invalid batch limit");
        list(batch.prIds);
        unique(batch.prIds.map((id) => ({id})));
        assert(batch.prIds.length > 0 && batch.prIds.length <= batch.limit, "INVALID_STATE", "Invalid batch selection");
        if (batch.members) {
            repository(batch.repository); assertRepository(batch.repository, value.repository);
            unique(batch.members);
            assert(canonicalJson(batch.prIds) === canonicalJson(batch.members.map((pr) => pr.id)), "INVALID_STATE", "Batch membership differs");
            assert(canonicalJson(batch.prNumbers) === canonicalJson(batch.members.map((pr) => pr.number)), "INVALID_STATE", "Batch numbers differ");
            unique(batch.recordedPrIds.map((id) => ({id})));
            assert(batch.recordedPrIds.every((id) => batch.prIds.includes(id) && entries.some((stored) => stored.prId === id)), "UNKNOWN_REFERENCE", "Unknown recorded batch member");
        }
    }
    if (value.activeDelivery) {
        const operation = value.activeDelivery;
        operationSelection(operation, value.documentationChanges);
        string(operation.startedAt); context(operation.inputContext);
        unique(operation.sourceFingerprints, "prId");
        const selected = value.documentationChanges.filter((change) => operation.changes.some((item) => item.id === change.id));
        assert(selected.every((change) => change.status === "proposed"), "INVALID_STATE", "Active delivery must select pending proposals");
        const prIds = new Set(selected.flatMap((change) => change.references.map((ref) => ref.prId)));
        assert(operation.sourceFingerprints.length === prIds.size, "UNKNOWN_REFERENCE", "Delivery source coverage differs");
        for (const item of operation.sourceFingerprints) {
            hash(item.sourceFingerprint);
            assert(prIds.has(item.prId) && entries.some((stored) => stored.prId === item.prId && stored.sourceFingerprint === item.sourceFingerprint), "UNKNOWN_REFERENCE", "Unknown delivery source fingerprint");
        }
    }
    if (value.lastDelivery) {
        // A receipt describes a past revision; later revisions may supersede it.
        const receipt = value.lastDelivery;
        string(receipt.operationId); string(receipt.userDecisionRef); string(receipt.confirmedAt); hash(receipt.contextFingerprint);
        unique(receipt.changes);
        assert(receipt.changes.length > 0, "INVALID_STATE", "Receipt needs selected proposals");
        for (const item of receipt.changes) {
            assert(Number.isSafeInteger(item.revision) && item.revision > 0 && value.documentationChanges.some((change) => change.id === item.id && change.revision >= item.revision), "UNKNOWN_REFERENCE", "Unknown receipt revision");
        }
        documents(receipt.documents);
        assert(receipt.documents.length > 0, "INVALID_STATE", "Receipt needs document hashes");
    }
}
export function validatePrepared(value, sources) {
    envelope(value, "prepared");
    validateSources(sources);
    assertRepository(value.repository, sources.repository);
    assert((value.batchId ?? null) === (sources.batchId ?? null), "BATCH_CONFLICT", "Prepared batch differs from source batch");
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
    if (value.schemaVersion === 2) {
        validateLock({schemaVersion: 2, kind: "lock", repository: value.repository, rules: value.rules,
            entries: value.previousEntries, documentationChanges: value.documentationChanges,
            activeBatch: value.activeBatch, activeDelivery: value.activeDelivery, lastDelivery: value.lastDelivery});
    }
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
function entry(value, sourceIds, individual = false) {
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
    if (value.delivery === "declined" && (!individual || value.historicalDocumentation)) { string(value.userDecisionRef); }
    if (value.delivery === "applied") { assert(value.finalDocumentsReviewed === true, "INVALID_STATE", "Final document review required"); }
}
export function validateResult(value, prepared, sources) {
    envelope(value, "result");
    validatePrepared(prepared, sources);
    assertRepository(value.repository, prepared.repository);
    assert((value.batchId ?? null) === (prepared.batchId ?? null), "BATCH_CONFLICT", "Result batch differs from prepared batch");
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
        entry(item, new Set(input.sourceIds), value.schemaVersion === 2);
        if (item.rules.analysis >= 2) { validateHistoryCoverage(item, input, sources); }
        if (value.schemaVersion === 2 && item.historicalDocumentation) {
            assert(prepared.previousEntries?.some((old) => old.prId === item.prId && canonicalJson(old.historicalDocumentation ?? null) === canonicalJson(item.historicalDocumentation)), "INVALID_STATE", "New results cannot invent historical metadata");
        }
    }
    if (value.schemaVersion === 2) {
        const entries = [...(prepared.previousEntries ?? []).filter((old) => !value.entries.some((item) => item.prId === old.prId)), ...value.entries];
        validateDocumentationChanges(value.documentationChanges, entries);
        validateChangeRevisions(prepared.documentationChanges ?? [], value.documentationChanges);
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
        entry(item, new Set(item.sourceIds), value.schemaVersion === 2);
    }
    if (value.schemaVersion === 2) {
        validateDocumentationChanges(value.documentationChanges, value.entries);
        validateOperations(value, value.entries);
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
