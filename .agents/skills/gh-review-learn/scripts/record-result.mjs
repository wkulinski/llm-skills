#!/usr/bin/env node
import fs from "node:fs";
import {archiveAnalysis} from "./learning-history.mjs";
import {readLearningLock, storedEntryMetrics, sameLearningState, createLearningStore, durablePath} from "./learning-store.mjs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildReportModel, readReportDiff} from "./report.mjs";
import {checkResult, fail, loadArguments, errorResponse, hashBytes, documentHash, inspectDelivery, checkDeliveryContext, unconfirmedDelivery} from "./validate-result.mjs";
import {canonicalJson, RULES, upgradeLock, SCHEMA_VERSION, assertBatchSources, validatePrepared, validateLock, sourceFingerprint, fingerprint, deliveryState} from "./contracts.mjs";
import {buildContext, createGitReader} from "./prepare.mjs";
import {withConsumerLock} from "./lock-store.mjs";
import {createGhTransport, revalidateSources} from "./collect.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {resolveArtifactCacheRoot} from "../../_shared/scripts/artifact-path.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {validateMaterialArtifacts} from "./storage.mjs";

function compactAssessment(assessment, sources, previous) {
    const refs = assessment.sources.map((ref) => {
        if (ref.unavailable === true) {
            const url = previous?.sources.find((source) => source.id === ref.id)?.url;
            return {id: ref.id, start: ref.start, end: ref.end, unavailable: true, ...(url ? {url} : {})};
        }
        if (ref.quote) {
            const text = sources.sources.find((s) => s.id === ref.id).body;
            const start = text.indexOf(ref.quote);
            if (start < 0 || text.indexOf(ref.quote, start + 1) >= 0) { throw fail("INVALID_REFERENCE", "Quote must identify one exact range, or supply explicit start/end"); }
            return {id: ref.id, start, end: start + ref.quote.length, url: sources.sources.find((source) => source.id === ref.id).url};
        }
        const text = sources.sources.find((s) => s.id === ref.id).body;
        if (ref.end > text.length) { throw fail("INVALID_REFERENCE", "Source text range exceeds body"); }
        const url = ref.url ?? sources.sources.find((source) => source.id === ref.id)?.url;
        return {id: ref.id, start: ref.start, end: ref.end, ...(url ? {url} : {})};
    });
    return {id: assessment.id, sources: refs, historical: assessment.historical, currency: assessment.currency, verificationScope: assessment.verificationScope, rationale: assessment.rationale, evidence: assessment.evidence, verification: assessment.verification};
}
function compactEntry(entry, input, context, sources, schemaVersion) {
    return {prId: entry.prId, rules: {...RULES}, sourceFingerprint: entry.sourceFingerprint, projectSha: entry.projectSha, contextFingerprint: context.fingerprint, sourceCompleteness: entry.sourceCompleteness, analysis: entry.analysis, delivery: entry.delivery,
        sourceIds: [...input.sourceIds].sort(), assessments: entry.assessments.map((a) => compactAssessment(a, sources, input.previous?.assessments.find((item) => item.id === a.id))).sort((a, b) => a.id.localeCompare(b.id)), dispositions: [...entry.dispositions].sort((a, b) => a.sourceId.localeCompare(b.sourceId)), documents: [...entry.documents].sort((a, b) => a.path.localeCompare(b.path)),
        ...(entry.userDecisionRef ? {userDecisionRef: entry.userDecisionRef} : {}), ...(entry.delivery === "applied" ? {finalDocumentsReviewed: true} : {}),
        documentationChangeIds: schemaVersion === 1 ? [] : [...entry.documentationChangeIds].sort(),
        ...(schemaVersion === 1 ? {historicalDocumentation: {schemaVersion: 1, details: "unavailable"}} : entry.historicalDocumentation ? {historicalDocumentation: {...entry.historicalDocumentation}} : {})};
}
function report(lock, sources, changed, dryRun, prepared) {
    return {event: dryRun ? "dry_run" : "analysis_recorded", recordedThisRun: changed ? prepared.items.length : 0, newAnalyses: changed ? prepared.items.filter((item) => !(prepared.previousEntries ?? []).some((entry) => entry.prId === item.prId)).length : 0,
        changed, dryRun, completeness: sources.read.completeness, read: sources.read, refreshedPrIds: prepared.items.map((item) => item.prId), processedSources: sources.sources.length, missingMaterials: prepared.items.flatMap((i) => i.materials).filter((m) => m.status === "missing").length, deliveryPending: lock.entries.filter((e) => e.delivery === "delivery_pending").length, missingEvidence: lock.entries.reduce((n, entry) => n + (storedEntryMetrics(entry)?.missingEvidence ?? entry.assessments.filter((a) => a.currency === "no_evidence").length), 0), conflicts: 0};
}
function operationPath(root, operationId) {
    if (typeof operationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) { throw fail("INVALID_ARGUMENT", "Expected a stable operation ID using letters, digits, hyphens or underscores"); }
    return durablePath(root, `review-learning/deliveries/${operationId}`);
}
function documentDiff(git, before, after) {
    try { return git(["diff", "--no-index", "--binary", "--no-ext-diff", "--no-textconv", "--", before, after]).toString("utf8"); }
    catch (error) { if (error.status !== 1 || !error.stdout) { throw error; } return error.stdout.toString("utf8"); }
}
function sameOperation(request, operation) {
    return request.operationId === operation.operationId && request.userDecisionRef === operation.userDecisionRef && canonicalJson(request.changes) === canonicalJson(operation.changes) &&
        canonicalJson(request.documents.map(({path: name, beforeHash, afterHash}) => ({path: name, beforeHash, afterHash}))) === canonicalJson(operation.documents);
}
async function refreshDeliverySources(operation, sources, transport, root) {
    const ids = operation.sourceFingerprints.map((item) => item.prId);
    if (ids.some((id) => !sources.prs.some((pr) => pr.id === id))) { throw fail("SOURCE_CONFLICT", "Delivery requires every linked PR source"); }
    for (const item of operation.sourceFingerprints) {
        if (sourceFingerprint(sources.sources.filter((source) => source.prId === item.prId)) !== item.sourceFingerprint) { throw fail("SOURCE_CONFLICT", "Sources differ from delivery intent"); }
    }
    const selected = {...sources, prs: sources.prs.filter((pr) => ids.includes(pr.id)), sources: sources.sources.filter((source) => ids.includes(source.prId))};
    if (canonicalJson([...selected.prs].sort((a, b) => a.id.localeCompare(b.id))) !== canonicalJson([...operation.sourcePrs].sort((a, b) => a.id.localeCompare(b.id)))) { throw fail("SOURCE_CONFLICT", "PR version metadata differs from delivery intent"); }
    const refreshed = await revalidateSources(selected, {transport: transport ?? createGhTransport({cwd: root})});
    if (canonicalJson([...refreshed.prs].sort((a, b) => a.id.localeCompare(b.id))) !== canonicalJson([...selected.prs].sort((a, b) => a.id.localeCompare(b.id)))) { throw fail("SOURCE_CONFLICT", "PR version changed during source refresh"); }
    return refreshed;
}
function priorDelivery(receipt, cacheRoot, root) {
    return {event: "previously_confirmed", operationId: receipt.operationId, changed: false, newlyApplied: [], changedFiles: [], refreshedPrIds: [], receipt,
        diffAvailable: readReportDiff(cacheRoot, receipt, root).diff !== null};
}
export async function beginDelivery({sources, prepared, intent, cwd = process.cwd(), cacheRoot = resolveArtifactCacheRoot(cwd), transport, dryRun = false, fsOps = fs}) {
    const root = requireRepositoryRoot(cwd);
    const directory = operationPath(root, intent?.operationId);
    validatePrepared(prepared, sources);
    validateMaterialArtifacts(prepared, {cwd: root, cacheRoot});
    return withConsumerLock({cwd: root, repository: sources.repository, fsOps}, async ({current, commit}) => {
        if (!current || current.schemaVersion !== 2) { throw fail("DELIVERY_CONFLICT", "Record individual proposals before beginning delivery"); }
        if (current.lastDelivery?.operationId === intent.operationId) {
            if (!sameOperation(intent, current.lastDelivery)) { throw fail("DELIVERY_CONFLICT", "Operation ID already confirmed with different inputs"); }
            return priorDelivery(current.lastDelivery, cacheRoot, root);
        }
        if (current.activeDelivery) {
            if (!sameOperation(intent, current.activeDelivery)) { throw fail("DELIVERY_CONFLICT", "Resolve the active delivery before starting another"); }
            return {event: "intent_exists", changed: false, operationId: intent.operationId, observed: inspectDelivery(current.activeDelivery, root)};
        }
        if (current.lastAbandonedDelivery?.operationId === intent.operationId) { throw fail("DELIVERY_CONFLICT", "Use a new operation ID after abandoning a delivery"); }
        const baseline = buildContext({cwd: root, cacheRoot});
        if (fingerprint(prepared.context.files) !== prepared.context.fingerprint || baseline.fingerprint !== prepared.context.fingerprint) { throw fail("CONTEXT_CONFLICT", "Prepare current context before recording the delivery intent"); }
        const selected = intent.changes?.map((ref) => current.documentationChanges.find((change) => change.id === ref.id && change.revision === ref.revision && change.status === "proposed"));
        if (!selected?.length || selected.some((change) => !change)) { throw fail("DELIVERY_CONFLICT", "Select known pending proposal revisions"); }
        const prIds = [...new Set(selected.flatMap((change) => change.references.map((ref) => ref.prId)))];
        const entries = prIds.map((id) => current.entries.find((entry) => entry.prId === id));
        if (entries.some((entry) => entry.contextFingerprint !== baseline.fingerprint || canonicalJson(entry.rules) !== canonicalJson(RULES))) { throw fail("CONTEXT_CONFLICT", "Reassess proposals against current context before delivery"); }
        const operation = {operationId: intent.operationId, userDecisionRef: intent.userDecisionRef, changes: structuredClone(intent.changes),
            documents: intent.documents.map(({path: name, beforeHash, afterHash}) => ({path: name, beforeHash, afterHash})), startedAt: new Date().toISOString(),
            inputContext: buildContext({cwd: root, cacheRoot, extraPaths: intent.documents.map((doc) => doc.path)}),
            sourceFingerprints: entries.map((entry) => ({prId: entry.prId, sourceFingerprint: entry.sourceFingerprint})), sourcePrs: sources.prs.filter((pr) => prIds.includes(pr.id))};
        const next = upgradeLock(current); next.activeDelivery = operation; validateLock(next);
        const snapshots = intent.documents.map((doc) => {
            const beforeHash = documentHash(root, doc.path);
            if (beforeHash !== doc.beforeHash || doc.beforeHash === doc.afterHash) { throw fail("DOCUMENT_CONFLICT", `Delivery baseline differs or does not change bytes: ${doc.path}`); }
            if (typeof doc.afterBytes !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(doc.afterBytes)) { throw fail("INVALID_FORMAT", "Supply exact selected-set afterBytes as base64"); }
            const after = Buffer.from(doc.afterBytes, "base64");
            if (hashBytes(after) !== doc.afterHash) { throw fail("DOCUMENT_CONFLICT", "Selected-set bytes differ from expected hash"); }
            return {path: doc.path, beforeBytes: beforeHash === null ? null : fs.readFileSync(path.join(root, doc.path)).toString("base64"), afterBytes: after.toString("base64")};
        });
        const refreshed = await refreshDeliverySources(operation, sources, transport, root);
        checkDeliveryContext({operation, cwd: root, cacheRoot});
        if (!dryRun) {
            fs.mkdirSync(directory, {recursive: true, mode: 0o700});
            const git = createGitReader(root); const diffs = [];
            for (const [index, snapshot] of snapshots.entries()) {
                const before = path.join(directory, `${index}.before`); const after = path.join(directory, `${index}.after`);
                fs.writeFileSync(before, snapshot.beforeBytes === null ? Buffer.alloc(0) : Buffer.from(snapshot.beforeBytes, "base64"), {mode: 0o600});
                fs.writeFileSync(after, Buffer.from(snapshot.afterBytes, "base64"), {mode: 0o600});
                diffs.push(documentDiff(git, before, after));
            }
            const diff = diffs.join("\n"); operation.diffHash = hashBytes(diff);
            fs.writeFileSync(path.join(directory, "changes.diff"), diff, {mode: 0o600});
            const store = createLearningStore({cwd: root});
            operation.artifacts = {diff: store.putBytes("delivery-bytes", Buffer.from(diff)), snapshots: snapshots.map((snapshot) => ({path: snapshot.path,
                before: snapshot.beforeBytes === null ? null : store.putBytes("delivery-bytes", Buffer.from(snapshot.beforeBytes, "base64")),
                after: store.putBytes("delivery-bytes", Buffer.from(snapshot.afterBytes, "base64"))}))};
        }
        const saved = commit(next, {expectedLockHash: prepared.expectedLockHash, dryRun});
        return {event: dryRun ? "dry_run" : "intent_recorded", operationId: operation.operationId, changed: saved.changed, newlyApplied: [], changedFiles: [], read: refreshed.read, refreshedPrIds: refreshed.prs.map((pr) => pr.id)};
    });
}
export async function confirmDelivery({sources, prepared, operationId, finalDocumentsReviewed, cwd = process.cwd(), cacheRoot = resolveArtifactCacheRoot(cwd), transport, dryRun = false, fsOps = fs}) {
    const root = requireRepositoryRoot(cwd); operationPath(root, operationId);
    return withConsumerLock({cwd: root, repository: sources.repository, fsOps}, async ({current, commit}) => {
        if (current?.lastDelivery?.operationId === operationId) { return priorDelivery(current.lastDelivery, cacheRoot, root); }
        const operation = current?.activeDelivery;
        if (!operation || operation.operationId !== operationId) { throw fail("DELIVERY_CONFLICT", "No matching durable delivery intent"); }
        try {
            validatePrepared(prepared, sources);
            validateMaterialArtifacts(prepared, {cwd: root, cacheRoot});
            if (finalDocumentsReviewed !== true) { throw fail("INVALID_STATE", "Review the entire final document set before confirmation"); }
            const beforeRefresh = checkDeliveryContext({operation, cwd: root, cacheRoot});
            const refreshed = await refreshDeliverySources(operation, sources, transport, root);
            const checked = checkDeliveryContext({operation, cwd: root, cacheRoot});
            if (beforeRefresh.context.fingerprint !== checked.context.fingerprint) { throw fail("CONTEXT_CONFLICT", "Delivery files changed during source refresh"); }
            if (checked.state === "not_applied") { return {event: "not_applied", changed: false, newlyApplied: [], changedFiles: [], operationId, read: refreshed.read, refreshedPrIds: refreshed.prs.map((pr) => pr.id)}; }
            const next = upgradeLock(current);
            next.entries = next.entries.map((entry) => operation.sourceFingerprints.some((item) => item.prId === entry.prId) ? structuredClone(entry) : entry);
            const confirmedAt = new Date().toISOString();
            for (const ref of operation.changes) {
                Object.assign(next.documentationChanges.find((change) => change.id === ref.id && change.revision === ref.revision), {status: "applied", finalDocumentsReviewed: true, appliedOperationId: operationId, appliedAt: confirmedAt});
            }
            for (const entry of next.entries.filter((stored) => operation.sourceFingerprints.some((item) => item.prId === stored.prId))) {
                entry.delivery = deliveryState(next.documentationChanges.filter((change) => entry.documentationChangeIds.includes(change.id)));
                if (entry.delivery === "applied") { entry.finalDocumentsReviewed = true; }
                entry.contextFingerprint = checked.context.fingerprint;
                entry.documents = entry.documents.map((doc) => operation.documents.find((item) => item.path === doc.path) ?? doc);
            }
            next.activeDelivery = null;
            next.lastDelivery = {operationId, userDecisionRef: operation.userDecisionRef, changes: operation.changes, documents: operation.documents, confirmedAt, contextFingerprint: checked.context.fingerprint,
                ...(operation.diffHash ? {diffHash: operation.diffHash} : {}), ...(operation.artifacts ? {artifacts: operation.artifacts} : {}), sourceFingerprints: operation.sourceFingerprints, sourcePrs: operation.sourcePrs};
            const contexts = Object.fromEntries(operation.sourceFingerprints.map((entry) => [entry.prId, checked.context]));
            const saved = commit(next, {expectedLockHash: prepared.expectedLockHash, dryRun, contexts});
            return {event: dryRun ? "dry_run" : "confirmed", changed: saved.changed, operationId, newlyApplied: dryRun ? [] : operation.changes,
                changedFiles: checked.observed.filter((doc) => doc.actualHash !== doc.beforeHash).map((doc) => doc.path), receipt: dryRun ? null : next.lastDelivery, read: refreshed.read, refreshedPrIds: refreshed.prs.map((pr) => pr.id),
                diffAvailable: readReportDiff(cacheRoot, next.lastDelivery, root).diff !== null};
        } catch (error) {
            error.delivery = unconfirmedDelivery(operation, root);
            throw error;
        }
    });
}
export async function recordResult({sources, prepared, result, cwd = process.cwd(), dryRun = false, cacheRoot = resolveArtifactCacheRoot(cwd), transport, fsOps = fs}) {
    const root = requireRepositoryRoot(cwd);
    return withConsumerLock({cwd: root, repository: sources.repository, fsOps}, async ({current, commit}) => {
        const active = current?.activeBatch;
        const batchRetry = prepared.batchId && !active && current?.lastBatch?.id === prepared.batchId && current.lastBatch.status !== "abandoned";
        if (active) {
            assertBatchSources({...active, recordedPrIds: []}, sources, current.entries);
            if (prepared.batchId && result.entries.some((entry) => entry.analysis === "pending")) { throw fail("BATCH_CONFLICT", "Only persisted analysis outcomes complete batch members"); }
        } else if (prepared.batchId && !batchRetry) { throw fail("BATCH_CONFLICT", "Prepared batch is no longer active"); }
        const checked = checkResult({sources, prepared, result, cwd: root, cacheRoot});
        if (current?.activeDelivery) { throw fail("DELIVERY_CONFLICT", "Confirm or resolve the active intent before recording another analysis"); }
        if (result.entries.some((entry) => entry.delivery === "applied" && !current?.entries.some((old) => old.prId === entry.prId && old.delivery === "applied")) ||
            (result.documentationChanges ?? []).some((change) => change.status === "applied" && !current?.documentationChanges?.some((old) => old.id === change.id && old.revision === change.revision && old.status === "applied"))) { throw fail("DELIVERY_REQUIRED", "New applied states require a durable intent and explicit confirmation"); }
        const refreshed = await revalidateSources({...sources, prs: sources.prs.filter((pr) => prepared.items.some((i) => i.prId === pr.id)), sources: sources.sources.filter((s) => prepared.items.some((i) => i.prId === s.prId))}, {transport: transport ?? createGhTransport({cwd: root})});
        const beforePrs = sources.prs.filter((p) => prepared.items.some((i) => i.prId === p.id)).sort((a, b) => a.id.localeCompare(b.id));
        const afterPrs = [...refreshed.prs].sort((a, b) => a.id.localeCompare(b.id));
        if (canonicalJson(beforePrs) !== canonicalJson(afterPrs)) { throw fail("SOURCE_CONFLICT", "PR version metadata changed during analysis"); }
        // Network reads may take time. Check the filesystem again after them.
        const final = checkResult({sources, prepared, result, cwd: root, cacheRoot});
        if (final.context.fingerprint !== checked.context.fingerprint) { throw fail("CONTEXT_CONFLICT", "Context changed during source refresh"); }
        const replacements = result.entries.map((entry) => compactEntry(entry, prepared.items.find((p) => p.prId === entry.prId), final.context, sources, result.schemaVersion));
        const base = current ? upgradeLock(current) : {schemaVersion: SCHEMA_VERSION, kind: "lock", repository: sources.repository, rules: {...RULES}, entries: [], documentationChanges: [], activeBatch: null, activeDelivery: null, lastDelivery: null};
        const next = {...base, rules: {...RULES}, entries: [...base.entries.filter((e) => !replacements.some((r) => r.prId === e.prId)), ...replacements].sort((a, b) => a.prId.localeCompare(b.prId)),
            documentationChanges: result.schemaVersion === 2 ? structuredClone(result.documentationChanges) : base.documentationChanges};
        if (active && prepared.batchId) {
            next.activeBatch.recordedPrIds = active.prIds.filter((id) => active.recordedPrIds.includes(id) || replacements.some((entry) => entry.prId === id));
            if (next.activeBatch.recordedPrIds.length === active.prIds.length) {
                next.lastBatch = {...next.activeBatch, completedAt: new Date().toISOString()};
                next.activeBatch = null;
            }
        }
        if (batchRetry && !sameLearningState(next, base)) { throw fail("BATCH_CONFLICT", "A closed batch only permits an identical retry"); }
        if (current === null && replacements.length === 0) { return report(next, refreshed, false, dryRun, prepared); }
        const histories = {};
        if (!dryRun && !sameLearningState(current, next)) {
            const analyzedAt = new Date().toISOString(); const git = createGitReader(root);
            for (const entry of replacements) {
                histories[entry.prId] = archiveAnalysis({entry, sources: refreshed, context: final.context, root, git, analyzedAt});
                histories[entry.prId].materialDispositions = result.entries.find((item) => item.prId === entry.prId).materialDispositions;
                histories[entry.prId].materialInventory = prepared.items.find((item) => item.prId === entry.prId).materials.map(({id, kind, provenance, status, reason}) => ({id, kind, provenance, status, ...(reason ? {reason} : {})}));
            }
        }
        const saved = commit(next, {expectedLockHash: prepared.expectedLockHash, dryRun, histories});
        return report(saved.lock, refreshed, saved.changed, dryRun, prepared);
    });
}
export async function abandonDelivery({sources, prepared, intent, cwd = process.cwd(), dryRun = false, fsOps = fs}) {
    const root = requireRepositoryRoot(cwd);
    if (typeof intent?.operationId !== "string" || !intent.operationId.trim() || typeof intent.userDecisionRef !== "string" || !intent.userDecisionRef.trim()) { throw fail("INVALID_ARGUMENT", "Abandon delivery requires an operation ID and explicit user decision reference"); }
    return withConsumerLock({cwd: root, repository: sources.repository, fsOps}, ({current, commit}) => {
        if (!current?.activeDelivery && current?.lastAbandonedDelivery?.operationId === intent.operationId && current.lastAbandonedDelivery.userDecisionRef === intent.userDecisionRef) {
            return {event: "delivery_abandoned", changed: false, operationId: intent.operationId, changedFiles: [], newlyApplied: [], abandoned: true};
        }
        const operation = current?.activeDelivery;
        if (operation?.operationId !== intent.operationId) { throw fail("DELIVERY_CONFLICT", "No matching active delivery to abandon"); }
        const observed = unconfirmedDelivery(operation, root);
        const next = upgradeLock(current);
        next.lastAbandonedDelivery = {operationId: operation.operationId, userDecisionRef: intent.userDecisionRef, originalDecisionRef: operation.userDecisionRef,
            changes: operation.changes, documents: operation.documents, observed: observed.observed, abandonedAt: new Date().toISOString()};
        next.activeDelivery = null;
        const saved = commit(next, {expectedLockHash: prepared.expectedLockHash, dryRun});
        return {...observed, event: dryRun ? "dry_run" : observed.changedFiles.length ? "progress_unconfirmed" : "delivery_abandoned", changed: saved.changed, abandoned: !dryRun};
    });
}
export async function main(argv = process.argv.slice(2), {cwd = process.cwd(), transport} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { return {code: 0, stdout: "Usage: record-result.mjs --sources path --prepared path --result path [--begin-delivery | --confirm-delivery | --abandon-delivery] [--lock review-learning.lock.json] [--dry-run]\nDefault records analysis; delivery modes use result.delivery. Begin stores intent before edits; confirm checks final review; abandon preserves documents and unconfirmed edit evidence for reassessment. Never edits documentation.\n"}; }
    let options;
    const readLock = () => {
        const root = requireRepositoryRoot(cwd);
        const file = path.join(root, "review-learning.lock.json");
        return fs.existsSync(file) ? readLearningLock({cwd: root}) : {schemaVersion: 2, repository: options.sources.repository, documentationChanges: [], entries: [], activeBatch: null};
    };
    const modelFor = (event) => {
        const root = requireRepositoryRoot(cwd); const cacheRoot = resolveArtifactCacheRoot(root);
        const lock = readLock();
        const reportEvent = lock.activeDelivery ? unconfirmedDelivery(lock.activeDelivery, root) : event;
        const reportPrs = new Set([...(options.prepared.items ?? []).map((item) => item.prId), ...lock.documentationChanges.flatMap((change) => change.references.map((ref) => ref.prId))]);
        const scoped = {...lock, entries: lock.entries.filter((entry) => reportPrs.has(entry.prId))};
        return buildReportModel({lock: scoped, progressLock: lock, sources: options.sources, prepared: options.prepared, event: reportEvent, root, cacheRoot,
            scriptsDir: path.dirname(fileURLToPath(import.meta.url)), ...readReportDiff(cacheRoot, reportEvent.receipt, root)});
    };
    try {
        options = {...loadArguments(argv, cwd), transport};
        const data = options.beginDelivery ? await beginDelivery({...options, intent: options.result.delivery})
            : options.confirmDelivery ? await confirmDelivery({...options, operationId: options.result.delivery?.operationId, finalDocumentsReviewed: options.result.delivery?.finalDocumentsReviewed})
                : options.abandonDelivery ? await abandonDelivery({...options, intent: options.result.delivery}) : await recordResult(options);
        let reportModel; let reportGap;
        try { reportModel = modelFor(data); } catch (error) { reportModel = null; reportGap = error.message; }
        return {code: 0, stdout: `${JSON.stringify({status: "complete", data: {...data, report: reportModel, ...(reportGap ? {reportGap} : {})}, errors: []})}\n`};
    } catch (error) {
        if (options && !error.delivery) {
            try {
                const lock = readLock();
                error.delivery = lock.activeDelivery ? unconfirmedDelivery(lock.activeDelivery, requireRepositoryRoot(cwd)) : null;
            } catch { /* An unreadable lock cannot establish delivery progress. */ }
        }
        const response = errorResponse(error);
        if (options) {
            try { const value = JSON.parse(response.stdout); value.data.report = modelFor(error.delivery ?? {event: "error", reason: error.message}); response.stdout = `${JSON.stringify(value)}\n`; }
            catch { /* Preserve the operation error if its reporting inputs cannot be read. */ }
        }
        return response;
    }
}
if (isMainModule(import.meta.url)) {
    const result = await main(); process.stdout.write(result.stdout); if (result.stderr) { process.stderr.write(result.stderr); } process.exitCode = result.code;
}
