#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {upgradeLock, validateSources, validateInventory, sourceFingerprint, canonicalJson} from "./contracts.mjs";
import {withConsumerLock} from "./lock-store.mjs";
import {createLearningStore, readLearningLock, durablePath, sameLearningState, readPrHistory} from "./learning-store.mjs";
import {archiveAnalysis, proofsOf} from "./learning-history.mjs";
import {createGitReader} from "./prepare.mjs";
import {resolveArtifactCacheRoot, assertRepositoryDirectoryPath, assertRepositoryFilePath} from "../../_shared/scripts/artifact-path.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function *files(directory, root) {
    assertRepositoryDirectoryPath(directory, root);
    if (!fs.existsSync(directory)) { return; }
    for (const item of fs.readdirSync(directory, {withFileTypes: true})) {
        if (item.isSymbolicLink()) { throw new Error("Symlink in migration input"); }
        const file = path.join(directory, item.name);
        if (item.isDirectory() && !["materials", "contexts"].includes(item.name)) { yield *files(file, root); }
        else if (item.isFile()) { yield assertRepositoryFilePath(file, root); }
    }
}
function recoverSnapshotBytes(value, retain) {
    const payloads = value.flatMap((snapshot) => [snapshot.beforeBytes, snapshot.afterBytes]);
    for (const payload of payloads) {
        if (typeof payload === "string") { retain(Buffer.from(payload, "base64")); }
    }
}
function recoverPreparedBytes(value, wanted, retain) {
    const materials = value.items.flatMap((item) => item.materials);
    for (const material of materials) {
        if (wanted.has(material.hash) && material.bytes) { retain(Buffer.from(material.bytes, "base64")); }
    }
}
function recoverInputs(root, lock) {
    const directory = path.join(resolveArtifactCacheRoot(root), "gh-review-learn");
    const wanted = new Set(lock.entries.flatMap(proofsOf).map((proof) => proof.hash));
    const proofBytes = new Map();
    const retain = (bytes) => { const h = hash(bytes); if (wanted.has(h)) { proofBytes.set(h, bytes); } };
    const versions = new Map(); const contexts = new Map(); const archives = []; const operations = []; const patches = []; let inventory = null;
    for (const file of files(directory, root)) {
        if (file.endsWith(".diff")) { patches.push(file); continue; }
        if (!file.endsWith(".json")) { if (/\.(?:before|after)$/.test(file)) { retain(fs.readFileSync(file)); } continue; }
        let value;
        try { value = JSON.parse(fs.readFileSync(file)); } catch { continue; }
        if (file.endsWith("snapshots.json") && Array.isArray(value)) {
            recoverSnapshotBytes(value, retain);
        }
        if (value.status && (value.data?.event || value.data?.delivery?.event)) {
            const {report, ...data} = value.data;
            if (data.delivery?.report) { const {report: nestedReport, ...delivery} = data.delivery; data.delivery = delivery; }
            operations.push({kind: "operation-event", originalName: path.relative(directory, file), status: value.status, data, errors: value.errors ?? []});
        }
        if (canonicalJson(value.repository ?? null) !== canonicalJson(lock.repository)) { continue; }
        if (value.kind === "result") { operations.push(value); }
        if (value.kind === "sources") {
            validateSources(value); archives.push(value);
            for (const pr of value.prs) {
                const sources = value.sources.filter((source) => source.prId === pr.id);
                versions.set(`${pr.id}:${sourceFingerprint(sources)}`, {...value, prs: [pr], sources});
            }
        } else if (value.kind === "inventory") {
            validateInventory(value);
            if (value.read.completeness === "complete" && (!inventory || value.read.finishedAt > inventory.read.finishedAt)) { inventory = value; }
        } else if (value.kind === "prepared" && value.context?.fingerprint) {
            contexts.set(value.context.fingerprint, value.context);
            recoverPreparedBytes(value, wanted, retain);
        }
    }
    for (const entry of lock.entries) {
        if (contexts.has(entry.contextFingerprint)) { continue; }
        const file = assertRepositoryFilePath(path.join(directory, "contexts", `${entry.contextFingerprint}.json`), root);
        if (fs.existsSync(file)) {
            contexts.set(entry.contextFingerprint, JSON.parse(fs.readFileSync(file)));
        }
    }
    for (const h of wanted) {
        const file = assertRepositoryFilePath(path.join(directory, "materials", `${h}.blob`), root);
        if (fs.existsSync(file)) { retain(fs.readFileSync(file)); }
    }
    return {versions, contexts, archives, operations, patches, inventory, directory, proofBytes};
}
/** Explicit lossless V1/V2 -> plain JSON V4 migration, with exact original backup. */
export async function compactLock({cwd = process.cwd(), dryRun = false, recoverHistory = false, fsOps = fs} = {}) {
    resolveArtifactCacheRoot(cwd);
    return withConsumerLock({cwd, fsOps}, ({root, current, bytes, commit}) => {
        if (!current) { throw new Error("No consumer review-learning.lock.json to migrate"); }
        const fromVersion = JSON.parse(bytes).schemaVersion;
        const next = upgradeLock(current);
        if ((fromVersion === 4 && !recoverHistory) || dryRun) { return {fromVersion, toVersion: 4, entries: next.entries.length, beforeBytes: bytes.length, dryRun, changed: false, backup: null}; }
        if (fromVersion === 4) {
            const recovered = recoverInputs(root, next); const store = createLearningStore({cwd: root, fsOps}); const histories = {};
            for (const entry of next.entries) {
                const old = readPrHistory(current, entry.prId)[0].history;
                if (!old || !old.gaps.some((gap) => gap.proof && recovered.proofBytes.has(gap.proof.hash))) { continue; }
                histories[entry.prId] = {...old,
                    proofs: old.proofs.map((item) => item.unavailable && recovered.proofBytes.has(item.proof.hash) ? {proof: item.proof, artifact: store.putBytes("evidence-bytes", recovered.proofBytes.get(item.proof.hash))} : item),
                    gaps: old.gaps.filter((gap) => !(gap.kind === "evidence" && recovered.proofBytes.has(gap.proof.hash)))};
            }
            const archives = recovered.operations.map((operation) => store.put("operation-archives", store.normalize(operation)));
            const result = commit(next, {expectedLockHash: hash(bytes), histories, archives});
            return {fromVersion, toVersion: 4, changed: result.changed, enrichedPrs: Object.keys(histories).length, entries: next.entries.length};
        }
        const backupRelative = `review-learning/backups/${hash(bytes)}.lock.json`;
        const backup = durablePath(root, backupRelative, fsOps);
        fsOps.mkdirSync(path.dirname(backup), {recursive: true, mode: 0o700});
        try { fsOps.writeFileSync(backup, bytes, {flag: "wx", mode: 0o600}); }
        catch (error) { if (error.code !== "EEXIST" || !fsOps.lstatSync(backup).isFile() || !fsOps.readFileSync(backup).equals(bytes)) { throw error; } }
        const store = createLearningStore({cwd: root, fsOps});
        const recovered = recoverInputs(root, next); const histories = {}; const archives = [];
        const git = createGitReader(root);
        for (const operation of recovered.operations) { archives.push(store.put("operation-archives", store.normalize(operation))); }
        for (const sources of recovered.archives) { archives.push(store.put("collections", store.normalize(sources))); }
        for (const file of recovered.patches) { archives.push(store.put("patches", {originalName: path.relative(recovered.directory, file), artifact: store.putBytes("patch-bytes", fs.readFileSync(assertRepositoryFilePath(file, root)))})); }
        for (const entry of next.entries) {
            const sources = recovered.versions.get(`${entry.prId}:${entry.sourceFingerprint}`) ?? null;
            const pr = sources?.prs[0] ?? recovered.inventory?.prs.find((item) => item.id === entry.prId) ?? null;
            histories[entry.prId] = archiveAnalysis({entry, sources, pr, context: recovered.contexts.get(entry.contextFingerprint), root, git, legacy: true, recoveredBytes: recovered.proofBytes});
        }
        const deliveries = path.join(recovered.directory, "deliveries");
        for (const file of files(deliveries, root)) {
            const rel = path.relative(deliveries, file).split(path.sep).join("/");
            const ref = store.putBytes("legacy-delivery-bytes", fs.readFileSync(file));
            archives.push(store.put("delivery-archives", {originalName: rel, artifact: ref}));
            if (path.basename(file) === "changes.diff") {
                const target = durablePath(root, `review-learning/deliveries/${rel}`, fsOps);
                fsOps.mkdirSync(path.dirname(target), {recursive: true, mode: 0o700});
                fsOps.writeFileSync(target, fs.readFileSync(file), {mode: 0o600});
            }
        }
        const saved = commit(next, {expectedLockHash: hash(bytes), compact: true, histories, inventory: recovered.inventory, archives});
        const reloaded = readLearningLock({cwd: root, fsOps});
        if (!sameLearningState(next, reloaded)) { throw new Error("Migrated logical content differs"); }
        return {fromVersion, toVersion: 4, entries: next.entries.length, beforeBytes: bytes.length, afterBytes: fsOps.statSync(path.join(root, "review-learning.lock.json")).size,
            dryRun, changed: saved.changed, backup: backupRelative, recoveredCollections: recovered.archives.length,
            historyGaps: Object.values(histories).reduce((count, history) => count + history.gaps.length, 0)};
    });
}
export async function main(argv = process.argv.slice(2), {cwd = process.cwd()} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { return {code: 0, stdout: "Usage: compact-lock.mjs [--dry-run | --recover-history]\nExplicit V1/V2 migration to durable plain JSON V4, with exact backup and recovery of available historical sources/proofs. V4 is a no-op by default. --recover-history can fill existing gaps with exact bytes from legacy working artifacts. Use status.mjs --pr N for targeted inspection.\n"}; }
    try {
        if (argv.length > 1 || argv.some((arg) => !["--dry-run", "--recover-history"].includes(arg))) { throw new Error("Expected --dry-run, --recover-history or no arguments"); }
        const data = await compactLock({cwd: requireRepositoryRoot(cwd), dryRun: argv[0] === "--dry-run", recoverHistory: argv[0] === "--recover-history"});
        return {code: 0, stdout: `${JSON.stringify({status: "complete", data, errors: []})}\n`};
    } catch (error) { return {code: 1, stdout: `${JSON.stringify({status: "error", data: null, errors: [{code: error.code ?? "MIGRATION_ERROR", message: error.message}]})}\n`}; }
}
if (isMainModule(import.meta.url)) { const result = await main(); process.stdout.write(result.stdout); process.exitCode = result.code; }
