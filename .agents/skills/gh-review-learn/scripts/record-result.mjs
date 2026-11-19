#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {checkResult, hashBytes, fail, loadArguments, errorResponse} from "./validate-result.mjs";
import {validateLock, canonicalJson, RULES} from "./contracts.mjs";
import {createGhTransport, revalidateSources} from "./collect.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {resolveArtifactCacheRoot} from "../../_shared/scripts/artifact-path.mjs";
import {writeFileAtomic} from "../../_shared/scripts/task-plan/atomic-file.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

function compactAssessment(assessment, sources) {
    const refs = assessment.sources.map((ref) => {
        if (ref.unavailable === true) { return {id: ref.id, start: ref.start, end: ref.end, unavailable: true}; }
        if (ref.quote) {
            const text = sources.sources.find((s) => s.id === ref.id).body;
            const start = text.indexOf(ref.quote);
            if (start < 0 || text.indexOf(ref.quote, start + 1) >= 0) { throw fail("INVALID_REFERENCE", "Quote must identify one exact range, or supply explicit start/end"); }
            return {id: ref.id, start, end: start + ref.quote.length};
        }
        const text = sources.sources.find((s) => s.id === ref.id).body;
        if (ref.end > text.length) { throw fail("INVALID_REFERENCE", "Source text range exceeds body"); }
        return {id: ref.id, start: ref.start, end: ref.end};
    });
    return {id: assessment.id, sources: refs, historical: assessment.historical, currency: assessment.currency, verificationScope: assessment.verificationScope, rationale: assessment.rationale, evidence: assessment.evidence, verification: assessment.verification};
}
function compactEntry(entry, input, context, sources) {
    return {prId: entry.prId, rules: {...RULES}, sourceFingerprint: entry.sourceFingerprint, projectSha: entry.projectSha, contextFingerprint: context.fingerprint, sourceCompleteness: entry.sourceCompleteness, analysis: entry.analysis, delivery: entry.delivery,
        sourceIds: [...input.sourceIds].sort(), assessments: entry.assessments.map((a) => compactAssessment(a, sources)).sort((a, b) => a.id.localeCompare(b.id)), dispositions: [...entry.dispositions].sort((a, b) => a.sourceId.localeCompare(b.sourceId)), documents: [...entry.documents].sort((a, b) => a.path.localeCompare(b.path)),
        ...(entry.delivery === "declined" ? {userDecisionRef: entry.userDecisionRef} : {}), ...(entry.delivery === "applied" ? {finalDocumentsReviewed: true} : {})};
}
function report(lock, sources, changed, dryRun, prepared) {
    return {changed, dryRun, completeness: sources.read.completeness, read: sources.read, processedSources: sources.sources.length, missingMaterials: prepared.items.flatMap((i) => i.materials).filter((m) => m.status === "missing").length, deliveryPending: lock.entries.filter((e) => e.delivery === "delivery_pending").length, missingEvidence: lock.entries.flatMap((e) => e.assessments).filter((a) => a.currency === "no_evidence").length, conflicts: 0};
}
export async function recordResult({sources, prepared, result, cwd = process.cwd(), dryRun = false, cacheRoot = resolveArtifactCacheRoot(cwd), transport, fsOps = fs}) {
    const root = requireRepositoryRoot(cwd);
    const target = path.join(root, "review-learning.lock.json");
    const guard = `${target}.write-lock`;
    let descriptor;
    try { descriptor = fsOps.openSync(guard, "wx", 0o600); } catch (error) {
        if (error.code === "EEXIST") { throw fail("LOCK_CONFLICT", "Another writer owns this consumer lock"); } throw error;
    }
    try {
        // All lock reads, validation and writes are inside the exclusive claim.
        fsOps.writeFileSync(descriptor, JSON.stringify({pid: process.pid}));
        const stat = fsOps.existsSync(target) ? fsOps.lstatSync(target) : null;
        if (stat && (!stat.isFile() || stat.isSymbolicLink())) { throw fail("INVALID_PATH", "Lock must be a regular file"); }
        const bytes = stat ? fsOps.readFileSync(target) : null;
        const current = bytes ? validateLock(JSON.parse(bytes), sources.repository) : null;
        const checked = checkResult({sources, prepared, result, cwd: root, cacheRoot});
        const refreshed = await revalidateSources({...sources, prs: sources.prs.filter((pr) => prepared.items.some((i) => i.prId === pr.id)), sources: sources.sources.filter((s) => prepared.items.some((i) => i.prId === s.prId))}, {transport: transport ?? createGhTransport({cwd: root})});
        const beforePrs = sources.prs.filter((p) => prepared.items.some((i) => i.prId === p.id)).sort((a, b) => a.id.localeCompare(b.id));
        const afterPrs = [...refreshed.prs].sort((a, b) => a.id.localeCompare(b.id));
        if (canonicalJson(beforePrs) !== canonicalJson(afterPrs)) { throw fail("SOURCE_CONFLICT", "PR version metadata changed during analysis"); }
        // Network reads may take time. Check the filesystem again after them.
        const final = checkResult({sources, prepared, result, cwd: root, cacheRoot});
        if (final.context.fingerprint !== checked.context.fingerprint) { throw fail("CONTEXT_CONFLICT", "Context changed during source refresh"); }
        const replacements = result.entries.map((entry) => compactEntry(entry, prepared.items.find((p) => p.prId === entry.prId), final.context, sources));
        const next = {schemaVersion: 1, kind: "lock", repository: sources.repository, rules: {...RULES}, entries: [...(current?.entries ?? []).filter((e) => !replacements.some((r) => r.prId === e.prId)), ...replacements].sort((a, b) => a.prId.localeCompare(b.prId))};
        validateLock(next, sources.repository);
        const identical = current === null ? replacements.length === 0 : canonicalJson({...current, entries: [...current.entries].sort((a, b) => a.prId.localeCompare(b.prId))}) === canonicalJson(next);
        if (!identical && (bytes === null ? null : hashBytes(bytes)) !== prepared.expectedLockHash) { throw fail("LOCK_CONFLICT", "Loaded lock no longer matches the prepared base; reread and prepare again"); }
        const observed = fsOps.existsSync(target) ? fsOps.readFileSync(target) : null;
        if ((observed === null ? null : hashBytes(observed)) !== (bytes === null ? null : hashBytes(bytes))) { throw fail("LOCK_CONFLICT", "Lock changed during validation"); }
        if (!identical && !dryRun) {
            writeFileAtomic(target, `${JSON.stringify(next, null, 2)}\n`, {rootDir: root, fsOps});
        }
        return report(next, refreshed, !identical && !dryRun, dryRun, prepared);
    } finally {
        fsOps.closeSync(descriptor);
        fsOps.unlinkSync(guard);
    }
}
export async function main(argv = process.argv.slice(2), {cwd = process.cwd(), transport} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { return {code: 0, stdout: "Usage: record-result.mjs --sources path --prepared path --result path [--lock review-learning.lock.json] [--dry-run]\nRefresh source batch and validate all inputs under exclusive claim. Writes only the consumer lock.\n"}; }
    try { const data = await recordResult({...loadArguments(argv, cwd), transport}); return {code: 0, stdout: `${JSON.stringify({status: "complete", data, errors: []})}\n`}; } catch (error) { return errorResponse(error); }
}
if (isMainModule(import.meta.url)) {
    const result = await main(); process.stdout.write(result.stdout); if (result.stderr) { process.stderr.write(result.stderr); } process.exitCode = result.code;
}
