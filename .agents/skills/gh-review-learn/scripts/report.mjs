#!/usr/bin/env node
import fs from "node:fs";
import {readLearningLock, createLearningStore, durablePath} from "./learning-store.mjs";
import {decodeLock} from "./storage.mjs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {canonicalJson, RULES, validateSources, validateInventory, assertRepository, sourceFingerprint} from "./contracts.mjs";
import {unconfirmedDelivery} from "./validate-result.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {resolveArtifactCacheRoot, assertArtifactPath} from "../../_shared/scripts/artifact-path.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

const fail = (code, message) => Object.assign(new Error(message), {code});
export const shellCommand = (args) => args.map((value) => `'${String(value).replaceAll("'", "'\\''")}'`).join(" ");
const anchor = (section) => section.startsWith("#") ? section.slice(1) : section.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
function assessmentLinks(refs, lock, sources) {
    return refs.flatMap((ref) => {
        const assessment = lock.entries.find((entry) => entry.prId === ref.prId)?.assessments.find((item) => item.id === ref.assessmentId);
        return (assessment?.sources ?? []).map((source) => ({...ref, sourceId: source.id,
            url: sources?.sources.find((item) => item.prId === ref.prId && item.id === source.id)?.url ?? source.url ?? null}));
    });
}
function buildProgress({lock, sources, prepared, inventory, event, scriptsDir, cacheRoot}) {
    const batch = lock.activeBatch ?? lock.lastBatch ?? prepared?.lastBatch ?? null;
    const fullInventory = inventory?.kind === "inventory" && inventory.read.completeness === "complete";
    const newRemaining = fullInventory ? inventory.prs.filter((pr) => !lock.entries.some((entry) => entry.prId === pr.id)).length : null;
    const repository = lock.repository;
    const sourcesPath = path.join(cacheRoot, "gh-review-learn", "sources.json");
    const inventoryPath = path.join(cacheRoot, "gh-review-learn", "inventory.json");
    let nextCommand = null; let continuation;
    if (lock.activeBatch) {
        nextCommand = shellCommand(["node", path.join(scriptsDir, "batch.mjs"), "resume", "--batch", lock.activeBatch.id]);
        continuation = `Wznów aktywną partię ${lock.activeBatch.id}.`;
    } else if (fullInventory && newRemaining === 0) {
        continuation = "Koniec nowej historii w odczytanym inwentarzu. Wcześniejsze nierozstrzygnięcia i propozycje pozostają osobnymi kolejkami.";
    } else if (batch) {
        nextCommand = shellCommand(["node", path.join(scriptsDir, "collect.mjs"), "--repo", repository.name, "--branch", repository.branch, "--inventory-only", "--output", inventoryPath]) + "\n" +
            shellCommand(["node", path.join(scriptsDir, "batch.mjs"), "select", "--inventory", inventoryPath, "--batch-size", batch.limit]);
        continuation = `Następna partia tego samego rozmiaru: ${batch.limit}.`;
    } else {
        nextCommand = shellCommand(["node", path.join(scriptsDir, "collect.mjs"), "--repo", repository.name, "--branch", repository.branch, "--output", sourcesPath]);
        continuation = "Kontynuuj ten sam zakres analizy po świeżym odczycie źródeł.";
    }
    const contextFingerprint = event.receipt?.contextFingerprint ?? prepared?.context.fingerprint;
    const refreshedPrIds = event.refreshedPrIds ?? (event.read?.completeness === "complete" ? sources?.prs.map((pr) => pr.id) ?? [] : []);
    const reassessment = lock.entries.filter((entry) => (contextFingerprint && entry.contextFingerprint !== contextFingerprint) || canonicalJson(entry.rules) !== canonicalJson(RULES) ||
        (sources && refreshedPrIds.includes(entry.prId) && entry.sourceFingerprint !== sourceFingerprint(sources.sources.filter((source) => source.prId === entry.prId))));
    return {repository, projectSha: prepared?.projectSha ?? sources?.read.targetSha ?? null, read: event.read ?? sources?.read ?? null,
        refreshedPrIds, uncheckedPrIds: lock.entries.filter((entry) => !refreshedPrIds.includes(entry.prId)).map((entry) => entry.prId), batchId: batch?.id ?? null, batchPrNumbers: batch?.prNumbers ?? [],
        newAnalyses: event.newAnalyses ?? 0, recordedThisRun: event.recordedThisRun ?? 0, persistedResults: lock.entries.length,
        unresolved: lock.entries.filter((entry) => entry.analysis !== "complete").length, reassessment: reassessment.length,
        pendingDelivery: lock.entries.filter((entry) => entry.delivery === "delivery_pending").length,
        newRemaining, inventoryReadAt: fullInventory ? inventory.read.finishedAt : null, continuation, nextCommand};
}
/** Pure: the operation event, not an applied flag in the lock, determines new edits. */
export function buildReportModel({lock: storedLock, sources = null, prepared = null, inventory = null, event = {}, progressLock = null, diff = null, diffArtifact = null, root = "", scriptsDir = ".agents/skills/gh-review-learn/scripts", cacheRoot = "var/agent/cache"}) {
    const lock = decodeLock(storedLock);
    const changes = lock.documentationChanges ?? [];
    const applied = event.event === "confirmed" ? changes.filter((change) => event.newlyApplied?.some((ref) => ref.id === change.id && ref.revision === change.revision) && change.status === "applied") : [];
    const changedFiles = event.changedFiles ?? [];
    const unconfirmed = event.event === "progress_unconfirmed" && changedFiles.length > 0;
    let reason = event.reason ?? (changes.some((change) => change.status === "proposed") ? "Przygotowano propozycje; oczekują na zlecenie zastosowania." : "Analiza nie wskazała nowych zmian dokumentacji.");
    if (event.event === "previously_confirmed") { reason = `Operacja ${event.operationId} została potwierdzona wcześniej; ten odczyt nie wykonał nowych edycji.`; }
    else if (event.event === "intent_recorded" || event.event === "intent_exists" || event.event === "not_applied") { reason = "Zamiar jest zapisany; zastosowanie nie zostało potwierdzone."; }
    else if (event.event === "dry_run") { reason = "Wykonano dry run; nie potwierdzono zastosowania."; }
    else if (!event.event) { reason = "Odczytano utrwalony stan; wcześniejsze zastosowania nie są nowymi edycjami."; }
    const describe = (change) => ({id: change.id, revision: change.revision, status: change.status, path: change.path, section: change.section,
        documentLink: `${root ? path.join(root, change.path) : change.path}#${anchor(change.section)}`, description: change.description, rationale: change.rationale,
        sourceLinks: assessmentLinks(change.references, lock, sources), userDecisionRef: change.userDecisionRef ?? null});
    const findings = lock.entries.flatMap((entry) => entry.assessments.filter((assessment) => !changes.some((change) => change.references.some((ref) => ref.prId === entry.prId && ref.assessmentId === assessment.id)))
        .map((assessment) => ({prId: entry.prId, assessmentId: assessment.id, rationale: assessment.rationale, historical: assessment.historical, currency: assessment.currency,
            sourceLinks: assessmentLinks([{prId: entry.prId, assessmentId: assessment.id}], lock, sources)})));
    for (const entry of lock.entries) {
        for (const disposition of entry.dispositions ?? []) {
            if (disposition.status !== "no_learning") { continue; }
            const source = sources?.sources.find((item) => item.id === disposition.sourceId && item.prId === entry.prId);
            findings.push({prId: entry.prId, assessmentId: disposition.sourceId, rationale: disposition.rationale, historical: "no_learning", currency: "not_required",
                sourceLinks: source ? [{prId: entry.prId, assessmentId: disposition.sourceId, sourceId: disposition.sourceId, url: source.url}] : []});
        }
    }
    const diffLines = diff === null ? null : diff.replace(/\n$/, "").split("\n").length;
    return {
        introduction: unconfirmed ? "Dokumentacja została zmieniona, ale zapis postępu nie został potwierdzony" : applied.length ? "Wprowadzono zmiany do dokumentacji" : "Nie wprowadzono zmian do dokumentacji",
        reason: applied.length || unconfirmed ? null : reason, operationId: event.operationId ?? null, changedFiles,
        applied: applied.map(describe), proposals: changes.filter((change) => change.status !== "applied").map(describe), findings,
        historicalGaps: lock.entries.filter((entry) => entry.historicalDocumentation || lock.schemaVersion === 1).map((entry) => ({prId: entry.prId, delivery: entry.delivery, paths: entry.documents.map((doc) => doc.path)})),
        previousApplications: changes.filter((change) => change.status === "applied" && !applied.some((item) => item.id === change.id)).map((change) => ({id: change.id, revision: change.revision})),
        abandonedDelivery: lock.lastAbandonedDelivery ?? null,
        diff: {inline: applied.length && diff !== null && diffLines <= 80 ? diff : null, artifact: applied.length ? diffArtifact : null, available: applied.length > 0 && diff !== null, lines: diffLines,
            gap: applied.length && diff === null ? "Brak dokładnego diffu w cache; zachowano trwałe opisy i hashe." : null},
        progress: buildProgress({lock: progressLock ?? lock, sources, prepared, inventory, event, scriptsDir, cacheRoot}),
    };
}
function sourceText(links) {
    if (!links.length) { return "brak szczegółowych referencji"; }
    return links.map((link) => link.url ? `[${link.prId}/${link.assessmentId}](${link.url})` : `${link.prId}/${link.assessmentId}: brak zapisanego URL`).join(", ");
}
export function renderReport(model) {
    const lines = [`${model.introduction}.`, ...(model.reason ? [model.reason] : []), "", "## Wprowadzone zmiany", ""];
    for (const change of model.applied) { lines.push(`- [${change.path} — ${change.section}](${change.documentLink}): ${change.description}`, `  Uzasadnienie: ${change.rationale}. Źródła: ${sourceText(change.sourceLinks)}.`); }
    if (!model.applied.length) { lines.push(model.changedFiles.length ? `Pliki z edycjami: ${model.changedFiles.join(", ")}.` : "Brak nowych potwierdzonych zmian."); }
    if (model.diff.inline !== null) { lines.push("", "```diff", model.diff.inline.replace(/\n$/, ""), "```"); }
    if (model.diff.artifact) { lines.push("", `[Pełny diff](${model.diff.artifact})`); }
    if (model.diff.gap) { lines.push("", model.diff.gap); }
    if (model.previousApplications.length) { lines.push("", `Wcześniejsze zastosowania, bez nowych edycji: ${model.previousApplications.map((item) => `${item.id}@${item.revision}`).join(", ")}.`); }
    if (model.abandonedDelivery) {
        const abandoned = model.abandonedDelivery;
        const edited = abandoned.observed.filter((doc) => doc.state !== "base").map((doc) => doc.path);
        lines.push("", `Porzucony zamiar ${abandoned.operationId}; decyzja: ${abandoned.userDecisionRef}. Dokumenty zachowano bez potwierdzenia zastosowania.`, `Pliki zmienione lub nieczytelne w chwili porzucenia: ${edited.join(", ") || "brak"}.`);
    }
    lines.push("", "## Propozycje niezastosowane", "");
    for (const change of model.proposals) { lines.push(`- ${change.id}@${change.revision} (${change.status}): [${change.path} — ${change.section}](${change.documentLink}) — ${change.description}. Uzasadnienie: ${change.rationale}. Źródła: ${sourceText(change.sourceLinks)}.${change.userDecisionRef ? ` Decyzja: ${change.userDecisionRef}.` : ""}`); }
    if (!model.proposals.length) { lines.push("Brak."); }
    lines.push("", "## Ustalenia bez zmiany dokumentacji", "");
    for (const finding of model.findings) { lines.push(`- ${finding.prId}/${finding.assessmentId} (${finding.historical}, ${finding.currency}): ${finding.rationale}. Źródła: ${sourceText(finding.sourceLinks)}.`); }
    for (const entry of model.historicalGaps) { lines.push(`- ${entry.prId}: historyczny stan ${entry.delivery}; brak szczegółowego opisu zmian V1${entry.paths.length ? ` (${entry.paths.join(", ")})` : ""}.`); }
    if (!model.findings.length && !model.historicalGaps.length) { lines.push("Brak dodatkowych ustaleń."); }
    const p = model.progress;
    lines.push("", "## Postęp i kontynuacja", "", `Repo: ${p.repository.name}; gałąź: ${p.repository.branch}; SHA: ${p.projectSha ?? "nieznany"}.`,
        p.read ? `Odczyt: ${p.read.startedAt} — ${p.read.finishedAt}; kompletność: ${p.read.completeness}; granica: ${p.read.boundary ?? "niezapisana"}.` : "Przedział odczytu źródeł: nieznany.",
        `Odświeżone źródła PR: ${p.refreshedPrIds.join(", ") || "brak"}; źródła niesprawdzone: ${p.uncheckedPrIds.join(", ") || "brak"}.`,
        `Partia: ${p.batchId ?? "brak"}; dokładne PR-y: ${p.batchPrNumbers.join(", ") || "brak"}.`,
        `Nowe analizy: ${p.newAnalyses}; zapisane w tym przebiegu: ${p.recordedThisRun}; utrwalone wyniki: ${p.persistedResults}; nierozstrzygnięcia: ${p.unresolved}; ponowne oceny: ${p.reassessment}; oczekujące zastosowania: ${p.pendingDelivery}.`,
        "Kolejki mogą się nakładać; ich suma nie jest liczbą różnych PR-ów.",
        p.newRemaining === null ? "Pozostałe nowe PR-y: liczba nieznana (brak kompletnego inwentarza)." : `Pozostałe nowe PR-y: ${p.newRemaining}; pełny inwentarz odczytano ${p.inventoryReadAt}.`, p.continuation);
    if (p.nextCommand) { lines.push("", "```bash", p.nextCommand, "```"); }
    return `${lines.join("\n")}\n`;
}
export function readReportDiff(cacheRoot, receipt, root = process.cwd()) {
    if (!receipt?.diffHash || !/^[A-Za-z0-9_-]{1,128}$/.test(receipt.operationId)) { return {diff: null, diffArtifact: null}; }
    if (receipt.artifacts?.diff) {
        const bytes = createLearningStore({cwd: root}).readBytes(receipt.artifacts.diff);
        if (createHash("sha256").update(bytes).digest("hex") !== receipt.diffHash) { throw fail("STORAGE_CONFLICT", "Durable delivery diff differs"); }
        return {diff: bytes.toString("utf8"), diffArtifact: path.join(root, receipt.artifacts.diff.path)};
    }
    const file = durablePath(root, `review-learning/deliveries/${receipt.operationId}/changes.diff`);
    if (!fs.existsSync(file)) { return {diff: null, diffArtifact: null}; }
    const bytes = fs.readFileSync(file);
    if (createHash("sha256").update(bytes).digest("hex") !== receipt.diffHash) { return {diff: null, diffArtifact: null}; }
    return {diff: bytes.toString("utf8"), diffArtifact: file};
}
export function main(argv = process.argv.slice(2), {cwd = process.cwd()} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { return {code: 0, stdout: "Usage: report.mjs [--sources cache/path] [--prepared cache/path] [--inventory cache/path] [--event cache/path] --output cache/report.md\nRender the operation report from the consumer lock and optional evidence. Writes only cache.\n"}; }
    try {
        const args = {};
        for (let index = 0; index < argv.length; index += 2) {
            const name = argv[index];
            if (!["--sources", "--prepared", "--inventory", "--event", "--output"].includes(name) || Object.hasOwn(args, name) || !argv[index + 1]) { throw fail("INVALID_ARGUMENT", `Invalid argument: ${name}`); }
            args[name] = argv[index + 1];
        }
        if (!args["--output"]) { throw fail("INVALID_ARGUMENT", "--output is required"); }
        const root = requireRepositoryRoot(cwd); const cacheRoot = resolveArtifactCacheRoot(root);
        const read = (name) => args[`--${name}`] ? JSON.parse(fs.readFileSync(assertArtifactPath(path.resolve(root, args[`--${name}`]), name, root), "utf8")) : null;
        const lock = readLearningLock({cwd: root});
        const sources = read("sources"); if (sources) { validateSources(sources); assertRepository(sources.repository, lock.repository); }
        const inventory = read("inventory"); if (inventory) { validateInventory(inventory); assertRepository(inventory.repository, lock.repository); }
        const prepared = read("prepared"); if (prepared) { assertRepository(prepared.repository, lock.repository); }
        const inputEvent = read("event"); let event = inputEvent?.data?.delivery ?? inputEvent?.data ?? inputEvent ?? {};
        if (lock.activeDelivery) { event = unconfirmedDelivery(lock.activeDelivery, root); }
        const model = buildReportModel({lock, sources, prepared, inventory, event, root, cacheRoot, scriptsDir: path.dirname(fileURLToPath(import.meta.url)), ...readReportDiff(cacheRoot, event.receipt, root)});
        const output = assertArtifactPath(path.resolve(root, args["--output"]), "Report", root);
        fs.mkdirSync(path.dirname(output), {recursive: true, mode: 0o700}); fs.writeFileSync(output, renderReport(model), {mode: 0o600});
        return {code: 0, stdout: `${JSON.stringify({status: "complete", data: {output, report: model}, errors: []})}\n`};
    } catch (error) { return {code: 1, stdout: `${JSON.stringify({status: "error", data: null, errors: [{code: error.code ?? "REPORT_ERROR", message: error.message, scope: "report"}]})}\n`, stderr: `${error.message}\n`}; }
}
if (isMainModule(import.meta.url)) {
    const response = main(); process.stdout.write(response.stdout); if (response.stderr) { process.stderr.write(response.stderr); } process.exitCode = response.code;
}
