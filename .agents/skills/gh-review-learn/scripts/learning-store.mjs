import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {writeFileAtomic} from "../../_shared/scripts/task-plan/atomic-file.mjs";
import {assertStorageLayout} from "../../_shared/scripts/artifact-path.mjs";
import {storedEntries} from "./entry-state.mjs";
export {isStoredEntry, storedEntryMetrics} from "./entry-state.mjs";
import {canonicalJson, validateLock, validateStoredEntry} from "./contracts.mjs";

export const STORE_DIRECTORY = "review-learning";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (message) => Object.assign(new Error(message), {code: "STORAGE_CONFLICT"});
const snapshots = new WeakMap();
const detailCaches = new WeakMap();
const metadataFields = ["prId", "rules", "sourceFingerprint", "projectSha", "contextFingerprint", "sourceCompleteness", "analysis", "delivery", "sourceIds", "documents", "documentationChangeIds", "historicalDocumentation"];
const freeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
};

/** Durable paths are deliberately unrelated to CACHE_PATH. Never follow links. */
export function durablePath(root, name, fsOps = fs) {
    if (typeof name !== "string" || !name.startsWith(`${STORE_DIRECTORY}/`) || name.includes("\\") || name.split("/").some((part) => !part || [".", "..", ".git"].includes(part))) { throw fail("Unsafe learning-store path"); }
    const parts = name.split("/");
    for (let i = 1; i <= parts.length; i++) {
        try { if (fsOps.lstatSync(path.join(root, ...parts.slice(0, i))).isSymbolicLink()) { throw fail("Symlink in learning-store path"); } }
        catch (error) { if (error.code !== "ENOENT") { throw error; } }
    }
    return path.join(root, ...parts);
}

export function createLearningStore({cwd = process.cwd(), fsOps = fs} = {}) {
    const root = requireRepositoryRoot(cwd);
    let writeLayoutChecked = false;
    function readBytes(ref) {
        if (!ref || !/^[a-f0-9]{64}$/.test(ref.hash) || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0 || !["json", "raw"].includes(ref.encoding)) { throw fail("Invalid durable reference"); }
        const file = durablePath(root, ref.path, fsOps);
        if (path.basename(file) !== `${ref.hash}.${ref.encoding === "json" ? "json" : "blob"}`) { throw fail("Durable reference identity differs"); }
        let bytes;
        try { if (!fsOps.lstatSync(file).isFile()) { throw fail("Expected regular learning record"); } bytes = fsOps.readFileSync(file); }
        catch (error) { throw fail(`Learning record unavailable: ${ref.path}: ${error.message}`); }
        if (bytes.length !== ref.byteLength || digest(bytes) !== ref.hash) { throw fail(`Learning record corrupted: ${ref.path}`); }
        return bytes;
    }
    function putBytes(category, bytes, encoding = "raw") {
        if (!writeLayoutChecked) { assertStorageLayout({cwd: root}); writeLayoutChecked = true; }
        if (!/^[a-z-]+$/.test(category)) { throw fail("Invalid record category"); }
        const hash = digest(bytes);
        const ref = {path: `${STORE_DIRECTORY}/${category}/${hash}.${encoding === "json" ? "json" : "blob"}`, hash, byteLength: bytes.length, encoding};
        const file = durablePath(root, ref.path, fsOps);
        if (fsOps.existsSync(file)) { readBytes(ref); }
        else {
            fsOps.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
            try { writeFileAtomic(file, bytes, {rootDir: root, fsOps, exclusive: true}); }
            catch (error) {
                // A concurrent preparer may publish the same immutable record.
                if (!fsOps.existsSync(file)) { throw error; } readBytes(ref);
            }
            fsOps.chmodSync(file, 0o600);
        }
        return ref;
    }
    const put = (category, value) => putBytes(category, Buffer.from(`${canonicalJson(value)}\n`), "json");
    const read = (ref) => { if (ref.encoding !== "json") { throw fail("Expected JSON record"); } return JSON.parse(readBytes(ref).toString("utf8")); };
    // Only domain records are interned: no file per scalar, checkbox or field.
    function normalize(value, key = "") {
        if (Array.isArray(value)) { return value.map((item) => normalize(item, key)); }
        if (!value || typeof value !== "object") { return value; }
        if (Object.hasOwn(value, "$learningRef")) { throw fail("Reserved learning reference field"); }
        const category = key === "documentationChanges" && value.id && value.revision ? "documentation-changes" : value.fingerprint && Array.isArray(value.files) ? "contexts" : key === "rules" ? "rule-sets" : typeof value.body === "string" && value.id && value.prId ? "sources" : ["git_file", "git_diff", "worktree_file", "source"].includes(value.kind) && value.hash ? "evidence" : null;
        if (category) { return {$learningRef: put(category, value)}; }
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, normalize(item, name)]));
    }
    function expand(value) {
        if (Array.isArray(value)) { return value.map(expand); }
        if (!value || typeof value !== "object") { return value; }
        if (Object.hasOwn(value, "$learningRef")) {
            if (Object.keys(value).length !== 1) { throw fail("Reference shadows data"); }
            return read(value.$learningRef);
        }
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, expand(item)]));
    }
    return {root, read, put, readBytes, putBytes, normalize, expand};
}

function metadata(entry) {
    return Object.fromEntries(metadataFields.filter((key) => Object.hasOwn(entry, key)).map((key) => [key, entry[key]]));
}
export function snapshotOf(lock) { return snapshots.get(lock) ?? null; }

function lazyEntry(record, store) {
    if (!record?.metadata || typeof record.metadata.prId !== "string" || !Array.isArray(record.keys) || record.keys.some((key) => typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key))) { throw fail("Invalid PR index record"); }
    if (!detailCaches.has(store)) { detailCaches.set(store, new Map()); }
    const cache = detailCaches.get(store);
    const load = () => {
        let loaded = cache.get(record.analysis.hash);
        if (!loaded) {
            const saved = store.read(record.analysis);
            loaded = store.expand(saved.entry);
            validateStoredEntry(loaded);
            freeze(loaded);
            // Sequential audits and comparisons retain at most one full PR per snapshot.
            cache.clear(); cache.set(record.analysis.hash, loaded);
        }
        if (canonicalJson(metadata(loaded)) !== canonicalJson(record.metadata) || canonicalJson(Object.keys(loaded).sort()) !== canonicalJson([...record.keys].sort()) ||
            canonicalJson(loaded.assessments.map((item) => item.id)) !== canonicalJson(record.assessmentIds) || loaded.assessments.length !== record.assessmentCount ||
            loaded.assessments.filter((item) => item.currency === "no_evidence").length !== record.missingEvidence) { throw fail("Analysis and PR index differ"); }
        return loaded;
    };
    const result = {...freeze(record.metadata)};
    for (const key of record.keys) {
        if (!Object.hasOwn(result, key)) { Object.defineProperty(result, key, {enumerable: true, get: () => load()[key]}); }
    }
    storedEntries.set(result, {record, store});
    return Object.freeze(result);
}

export function readSnapshot(manifest, {cwd = process.cwd(), fsOps = fs} = {}) {
    if (manifest?.schemaVersion !== 4 || manifest.kind !== "lock" || manifest.storage !== "plain-json-records") { throw fail("Unsupported learning manifest"); }
    const store = createLearningStore({cwd, fsOps});
    const index = store.read(manifest.index);
    if (!Array.isArray(index.entries) || index.kind !== "pr-index" || canonicalJson(index.repository) !== canonicalJson(manifest.repository)) { throw fail("Invalid PR index"); }
    const state = store.expand(store.read(manifest.state));
    if (canonicalJson(state.repository) !== canonicalJson(manifest.repository)) { throw fail("State repository differs"); }
    const lock = {...state, entries: index.entries.map((entry) => lazyEntry(entry, store))};
    snapshots.set(lock, {manifest, index, store});
    validateLock(lock);
    return lock;
}
export function readLearningLock({cwd = process.cwd(), fsOps = fs} = {}) {
    const root = requireRepositoryRoot(cwd); const file = path.join(root, "review-learning.lock.json");
    if (!fsOps.existsSync(file)) { return null; }
    if (!fsOps.lstatSync(file).isFile() || fsOps.lstatSync(file).isSymbolicLink()) { throw fail("Lock must be a regular file"); }
    const stored = JSON.parse(fsOps.readFileSync(file));
    return stored.schemaVersion === 4 ? readSnapshot(stored, {cwd: root, fsOps}) : validateLock(stored);
}

/** Compare one PR at a time. No string or clone of the complete history. */
export function sameLearningState(a, b) {
    if (!a || !b || a.entries.length !== b.entries.length) { return a === b; }
    const header = (lock) => Object.fromEntries(Object.entries(lock).filter(([key]) => key !== "entries"));
    const left = header(a); const right = header(b);
    if (canonicalJson(Object.keys(left).sort()) !== canonicalJson(Object.keys(right).sort())) { return false; }
    for (const key of Object.keys(left)) {
        if (Array.isArray(left[key]) && Array.isArray(right[key])) {
            if (left[key].length !== right[key].length || left[key].some((item, i) => canonicalJson(item) !== canonicalJson(right[key][i]))) { return false; }
        } else if (canonicalJson(left[key]) !== canonicalJson(right[key])) { return false; }
    }
    const entries = new Map(a.entries.map((entry) => [entry.prId, entry]));
    return b.entries.every((entry) => {
        const old = entries.get(entry.prId);
        if (!old) { return false; }
        if (old === entry) { return true; }
        const oldStored = storedEntries.get(old); const newStored = storedEntries.get(entry);
        if (oldStored && newStored && oldStored.store.root === newStored.store.root && canonicalJson(oldStored.record) === canonicalJson(newStored.record)) { return true; }
        return canonicalJson(old) === canonicalJson(entry);
    });
}

function summarizeLearningState(records, lock, knownInventory) {
    const ids = new Set(records.map((record) => record.metadata.prId));
    const latest = records.filter((r) => r.pr?.mergedAt).sort((a, b) => a.pr.mergedAt.localeCompare(b.pr.mergedAt) || a.pr.number - b.pr.number).at(-1);
    const times = records.filter((r) => r.analyzedAt).map((r) => r.analyzedAt).sort();
    const lastTime = times.at(-1) ?? null;
    return {uniquePrs: records.length, complete: records.filter((r) => r.metadata.analysis === "complete").length,
        unresolved: records.filter((r) => r.metadata.analysis !== "complete").length, rulesReassessment: records.filter((r) => canonicalJson(r.metadata.rules) !== canonicalJson(lock.rules)).length, pendingDelivery: records.filter((r) => r.metadata.delivery === "delivery_pending").length,
        assessmentCount: records.reduce((n, r) => n + r.assessmentCount, 0), historyGaps: records.reduce((n, r) => n + r.historyGaps, 0),
        lastAnalysis: lastTime ? {recordedAt: lastTime, prs: records.filter((r) => r.analyzedAt === lastTime).map((r) => ({prId: r.metadata.prId, number: r.pr?.number ?? null}))} : null,
        latestAnalyzedByMerge: latest ? {prId: latest.metadata.prId, number: latest.pr.number, mergedAt: latest.pr.mergedAt} : null,
        activeBatch: lock.activeBatch ? {id: lock.activeBatch.id, selected: lock.activeBatch.prIds.length, recorded: lock.activeBatch.recordedPrIds.length, remaining: lock.activeBatch.prIds.length - lock.activeBatch.recordedPrIds.length} : null,
        inventoryReadAt: knownInventory?.read.finishedAt ?? null,
        newRemaining: knownInventory?.read.completeness === "complete" ? knownInventory.prs.filter((pr) => !ids.has(pr.id)).length : null};
}

function writeAnalysisRecord(store, entry, old, history, savedContext) {
    const bundle = history ? store.put("history", store.normalize(history)) : old ? store.read(old.analysis).history : null;
    const analysis = store.put("analyses", {kind: "pr-analysis", entry: store.normalize(entry), history: bundle, previous: old?.analysis ?? null});
    const pr = history?.pr ?? old?.pr ?? null;
    const context = savedContext ?? history?.context ?? null;
    const contextRef = context ? store.put("contexts", context) : old?.context ?? null;
    return {context: contextRef, metadata: metadata(entry), keys: Object.keys(entry).sort(), pr, analyzedAt: history?.analyzedAt ?? old?.analyzedAt ?? null,
        assessmentIds: entry.assessments.map((item) => item.id), assessmentCount: entry.assessments.length, missingEvidence: entry.assessments.filter((a) => a.currency === "no_evidence").length,
        historyGaps: history?.gaps?.length ?? old?.historyGaps ?? 1, analysis};
}

export function publishLearningState(lock, {cwd = process.cwd(), previous = null, histories = {}, contexts = {}, inventory = null, archives = [], fsOps = fs, now = () => new Date().toISOString()} = {}) {
    const store = createLearningStore({cwd, fsOps});
    const previousSnapshot = snapshotOf(previous);
    const oldRecords = new Map(previousSnapshot?.index.entries.map((entry) => [entry.metadata.prId, entry]) ?? []);
    const records = [];
    for (const entry of [...lock.entries].sort((a, b) => a.prId.localeCompare(b.prId))) {
        const old = oldRecords.get(entry.prId);
        const stored = storedEntries.get(entry);
        if (stored && stored.store.root === store.root && !histories[entry.prId] && !contexts[entry.prId]) { records.push(stored.record); continue; }
        if (old) {
            const prior = store.expand(store.read(old.analysis).entry);
            if (canonicalJson(prior) === canonicalJson(entry) && !histories[entry.prId] && !contexts[entry.prId]) { records.push(old); continue; }
        }
        records.push(writeAnalysisRecord(store, entry, old, histories[entry.prId] ?? null, contexts[entry.prId]));
    }
    const oldManifest = previousSnapshot?.manifest;
    const inventoryRef = inventory ? store.put("inventories", store.normalize(inventory)) : oldManifest?.inventory ?? null;
    const knownInventory = inventory ?? (inventoryRef ? store.expand(store.read(inventoryRef)) : null);
    // Enrich lightweight PR identities from a dated inventory; never infer ordering from PR numbers.
    for (let i = 0; i < records.length; i++) {
        const pr = knownInventory?.prs.find((item) => item.id === records[i].metadata.prId);
        if (!records[i].pr && pr) { records[i] = {...records[i], pr}; }
    }
    const summary = summarizeLearningState(records, lock, knownInventory);
    const index = store.put("indexes", {kind: "pr-index", repository: lock.repository, entries: records});
    const {entries, ...header} = lock;
    const state = store.put("operations", store.normalize(header));
    const previousRef = oldManifest ? store.put("manifests", oldManifest) : null;
    return {schemaVersion: 4, kind: "lock", storage: "plain-json-records", repository: lock.repository, index, state, inventory: inventoryRef,
        archives: [...new Map([...(oldManifest?.archives ?? []), ...archives].map((ref) => [ref.path, ref])).values()], previous: previousRef, summary, updatedAt: now()};
}

export function hydratePrepared(prepared, {cwd = process.cwd()} = {}) {
    if (!prepared.previousState) { return prepared; }
    if (prepared.previousState.hash !== prepared.expectedLockHash) { throw fail("Prepared prior state differs from its exact-byte lock token"); }
    if (Object.hasOwn(prepared, "previousEntries")) { return prepared; }
    const store = createLearningStore({cwd});
    const lock = readSnapshot(store.read(prepared.previousState), {cwd});
    Object.defineProperty(prepared, "previousEntries", {enumerable: false, value: lock.entries});
    for (const item of prepared.items) {
        if (Object.hasOwn(item, "previous")) { throw fail("Persistent prepared cannot shadow prior state"); }
        Object.defineProperty(item, "previous", {enumerable: false, value: lock.entries.find((entry) => entry.prId === item.prId) ?? null});
    }
    return prepared;
}

export function readPrHistory(lock, prId, {allRevisions = false} = {}) {
    const info = snapshotOf(lock);
    const record = info?.index.entries.find((entry) => entry.metadata.prId === prId);
    if (!record) { throw fail("PR is not in the durable index"); }
    const revisions = []; let ref = record.analysis;
    while (ref) {
        const analysis = info.store.read(ref);
        revisions.push({reference: ref, entry: info.store.expand(analysis.entry), history: analysis.history ? info.store.expand(info.store.read(analysis.history)) : null});
        if (!allRevisions) { break; } ref = analysis.previous;
    }
    return revisions;
}

/** Offline graph audit, one immutable record at a time, including previous revisions. */
export function verifyLearningStore(lock) {
    const info = snapshotOf(lock);
    if (!info) { throw fail("Migrate the lock before auditing durable records"); }
    const pending = [info.manifest]; const seen = new Set(); let bytes = 0;
    while (pending.length) {
        const value = pending.pop();
        if (!value || typeof value !== "object") { continue; }
        if (value.path && value.hash && value.encoding && Number.isSafeInteger(value.byteLength)) {
            if (seen.has(value.path)) { continue; } seen.add(value.path);
            const content = info.store.readBytes(value); bytes += content.length;
            if (value.encoding === "json") { pending.push(JSON.parse(content)); }
        } else { pending.push(...Object.values(value)); }
    }
    // Also validate the logical entries and the index projection, loading only one PR at a time.
    for (const entry of lock.entries) { validateStoredEntry(entry); }
    return {records: seen.size, bytes, uniquePrs: lock.entries.length};
}
