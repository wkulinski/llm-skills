#!/usr/bin/env node
import fs from "node:fs";
import {hydratePrepared} from "./learning-store.mjs";
import {validateMaterialArtifacts} from "./storage.mjs";
import path from "node:path";
import {createHash} from "node:crypto";
import {verifyEvidenceBytes} from "./verification.mjs";
import {validateResult, canonicalJson, fingerprint, RULES} from "./contracts.mjs";
import {buildContext, createGitReader} from "./prepare.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {assertArtifactPath, resolveArtifactCacheRoot} from "../../_shared/scripts/artifact-path.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

export const fail = (code, message) => Object.assign(new Error(message), {code});
export const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function documentHash(root, name) {
    if (typeof name !== "string" || !name || path.isAbsolute(name) || name.includes("\\") || /^[a-z]:/i.test(name) || name.split("/").some((p) => ["", ".", "..", ".git"].includes(p)) || name === "review-learning.lock.json" || name.startsWith("review-learning/")) {
        throw fail("INVALID_PATH", `Invalid document path: ${name}`);
    }
    const parts = name.split("/");
    for (let index = 1; index <= parts.length; index += 1) {
        const target = path.join(root, ...parts.slice(0, index));
        try {
            const stat = fs.lstatSync(target);
            if (stat.isSymbolicLink()) { throw fail("INVALID_PATH", `Symlink in document path: ${name}`); }
            if (index === parts.length && !stat.isFile()) { throw fail("INVALID_PATH", `Document is not a regular file: ${name}`); }
        } catch (error) { if (error.code === "ENOENT") { return null; } throw error; }
    }
    return hashBytes(fs.readFileSync(path.join(root, name)));
}
export function inspectDelivery(operation, root) {
    return operation.documents.map((doc) => {
        const actualHash = documentHash(root, doc.path);
        return {...doc, actualHash, state: actualHash === doc.afterHash ? "expected" : actualHash === doc.beforeHash ? "base" : "conflict"};
    });
}
export function unconfirmedDelivery(operation, root) {
    const observed = operation.documents.map((doc) => {
        try { return inspectDelivery({documents: [doc]}, root)[0]; }
        catch { return {...doc, state: "unreadable"}; }
    });
    const changedFiles = observed.filter((doc) => doc.state === "unreadable" || doc.actualHash !== doc.beforeHash).map((doc) => doc.path);
    return {event: changedFiles.length ? "progress_unconfirmed" : "not_applied", operationId: operation.operationId,
        changedFiles, observed, newlyApplied: [], progressConfirmed: false};
}
export function checkDeliveryContext({operation, cwd, cacheRoot = resolveArtifactCacheRoot(cwd)}) {
    if (fingerprint(operation.inputContext.files) !== operation.inputContext.fingerprint) { throw fail("CONTEXT_CONFLICT", "Delivery baseline digest differs"); }
    const observed = inspectDelivery(operation, cwd);
    const current = buildContext({cwd, cacheRoot, extraPaths: operation.documents.map((doc) => doc.path)});
    const before = new Map(operation.inputContext.files.map((file) => [file.path, file]));
    const after = new Map(current.files.map((file) => [file.path, file]));
    for (const name of new Set([...before.keys(), ...after.keys()])) {
        if (canonicalJson(before.get(name) ?? null) === canonicalJson(after.get(name) ?? null)) { continue; }
        const doc = observed.find((item) => item.path === name);
        const old = before.get(name); const actual = after.get(name);
        if (!doc || doc.state !== "expected" || actual?.hash !== doc.afterHash || actual.mode !== (old?.missing ? "100644" : old?.mode ?? "100644")) { throw fail("CONTEXT_CONFLICT", `Unexpected change since delivery intent: ${name}`); }
    }
    if (observed.some((doc) => doc.state === "conflict") || (observed.some((doc) => doc.state === "base") && observed.some((doc) => doc.state === "expected"))) { throw fail("DOCUMENT_CONFLICT", "Delivery documents contain mixed or unknown bytes; reassess before confirmation"); }
    return {context: current, observed, state: observed.every((doc) => doc.state === "base") ? "not_applied" : "expected"};
}
function registerOutput(outputs, doc) {
    const existing = outputs.get(doc.path);
    if (existing && canonicalJson(existing) !== canonicalJson(doc)) { throw fail("DOCUMENT_CONFLICT", `Conflicting output manifests: ${doc.path}`); }
    outputs.set(doc.path, doc);
}
export function checkResult({sources, prepared, result, cwd = process.cwd(), cacheRoot = resolveArtifactCacheRoot(cwd), git = createGitReader(cwd)}) {
    hydratePrepared(prepared, {cwd});
    validateResult(result, prepared, sources);
    validateMaterialArtifacts(prepared, {cwd, cacheRoot});
    if (canonicalJson(result.rules) !== canonicalJson(RULES)) { throw fail("RULES_CONFLICT", "Result uses obsolete rules"); }
    if (sources.read.completeness !== "complete") { throw fail("INCOMPLETE_READ", "Complete source read is required before recording"); }
    if (fingerprint(prepared.context.files) !== prepared.context.fingerprint) { throw fail("CONTEXT_CONFLICT", "Prepared context manifest has an invalid digest"); }
    const root = requireRepositoryRoot(cwd);
    const origin = git(["remote", "get-url", "origin"]).toString("utf8").trim();
    const match = origin.match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    if (!match || match[1].toLowerCase() !== sources.repository.name.toLowerCase()) { throw fail("REPOSITORY_CONFLICT", "Consumer origin differs from source repository"); }
    const outputs = new Map();
    for (const entry of result.entries) {
        const appliedPaths = new Set((result.documentationChanges ?? []).filter((change) => change.status === "applied" && entry.documentationChangeIds?.includes(change.id)).map((change) => change.path));
        verifyEvidenceBytes(entry, sources, {git, readWorktree: (name) => documentHash(root, name)});
        const input = prepared.items.find((item) => item.prId === entry.prId);
        const decisions = entry.materialDispositions;
        if (!Array.isArray(decisions) || new Set(decisions.map((d) => d.id)).size !== decisions.length || decisions.length !== input.materials.length || decisions.some((d) => !input.materials.some((m) => m.id === d.id) || !["used", "unavailable", "not_needed"].includes(d.status) || typeof d.rationale !== "string" || !d.rationale)) {
            throw fail("INCOMPLETE_MATERIAL_COVERAGE", `Every prepared material needs an explicit disposition: ${entry.prId}`);
        }
        for (const disposition of decisions) {
            const material = input.materials.find((m) => m.id === disposition.id);
            if ((disposition.status === "used" && material.status !== "available") || (disposition.status === "unavailable" && material.status !== "missing")) { throw fail("INVALID_MATERIAL_STATE", `Material availability contradicts its disposition: ${material.id}`); }
        }
        for (const doc of entry.documents) {
            const target = path.resolve(root, doc.path);
            const cache = path.resolve(root, cacheRoot);
            if (target === cache || target.startsWith(`${cache}${path.sep}`)) { throw fail("INVALID_PATH", "Documentation cannot be stored in workflow cache"); }
            const actual = documentHash(root, doc.path);
            const baseline = prepared.context.files.find((file) => file.path === doc.path);
            if (doc.beforeHash !== (baseline && !baseline.missing ? baseline.hash : null)) { throw fail("DOCUMENT_CONFLICT", `Document baseline differs: ${doc.path}`); }
            const applied = entry.delivery === "applied" || appliedPaths.has(doc.path);
            const expected = applied ? doc.afterHash : doc.beforeHash;
            if (actual !== expected) { throw fail("DOCUMENT_CONFLICT", `Actual document bytes differ: ${doc.path}`); }
            if (applied) {
                registerOutput(outputs, doc);
            }
        }
    }
    const context = buildContext({cwd: root, cacheRoot, git, extraPaths: [...outputs.keys()]});
    const before = new Map(prepared.context.files.map((file) => [file.path, file]));
    const after = new Map(context.files.map((file) => [file.path, file]));
    for (const name of new Set([...before.keys(), ...after.keys()])) {
        if (canonicalJson(before.get(name) ?? null) !== canonicalJson(after.get(name) ?? null)) {
            const output = outputs.get(name);
            if (!output || after.get(name)?.hash !== output.afterHash || !["100644", "100755"].includes(after.get(name)?.mode)) { throw fail("CONTEXT_CONFLICT", `Undeclared context change: ${name}`); }
        }
    }
    return {context, root};
}
export function loadArguments(argv, cwd) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const name = argv[index];
        if (["--dry-run", "--begin-delivery", "--confirm-delivery", "--abandon-delivery"].includes(name) && !args[name]) { args[name] = true; continue; }
        if (!["--sources", "--prepared", "--result", "--lock"].includes(name) || Object.hasOwn(args, name) || !argv[index + 1] || argv[index + 1].startsWith("--")) { throw fail("INVALID_ARGUMENT", `Invalid argument: ${name}`); }
        args[name] = argv[++index];
    }
    const root = requireRepositoryRoot(cwd);
    if (args["--lock"] && path.resolve(root, args["--lock"]) !== path.join(root, "review-learning.lock.json")) { throw fail("INVALID_PATH", "Lock must be consumer review-learning.lock.json"); }
    if (["--begin-delivery", "--confirm-delivery", "--abandon-delivery"].filter((flag) => args[flag]).length > 1) { throw fail("INVALID_ARGUMENT", "Choose one delivery operation"); }
    const options = {cwd: root, dryRun: Boolean(args["--dry-run"]), beginDelivery: Boolean(args["--begin-delivery"]), confirmDelivery: Boolean(args["--confirm-delivery"]), abandonDelivery: Boolean(args["--abandon-delivery"])};
    for (const name of ["sources", "prepared", "result"]) {
        if (!args[`--${name}`]) { throw fail("INVALID_ARGUMENT", `--${name} is required`); }
        options[name] = JSON.parse(fs.readFileSync(assertArtifactPath(path.resolve(root, args[`--${name}`]), name, root), "utf8"));
    }
    hydratePrepared(options.prepared, {cwd: root});
    return options;
}
export function errorResponse(error) {
    return {code: 1, stdout: `${JSON.stringify({status: "error", data: {conflicts: /CONFLICT/.test(error.code) ? 1 : 0, ...(error.delivery ? {delivery: error.delivery} : {})}, errors: [{code: error.code ?? "RESULT_ERROR", scope: "result", message: error.message}]})}\n`, stderr: `${error.message}\n`};
}
export function main(argv = process.argv.slice(2), {cwd = process.cwd()} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { return {code: 0, stdout: "Usage: validate-result.mjs --sources path --prepared path --result path [--lock review-learning.lock.json]\nValidate coverage, references and actual document/context bytes. Does not refresh GitHub or write files.\n"}; }
    try {
        const options = loadArguments(argv, cwd);
        const {context, root} = checkResult(options);
        const lockPath = path.join(root, "review-learning.lock.json");
        if (fs.existsSync(lockPath) && fs.lstatSync(lockPath).isSymbolicLink()) { throw fail("INVALID_PATH", "Lock cannot be a symlink"); }
        const actual = fs.existsSync(lockPath) ? hashBytes(fs.readFileSync(lockPath)) : null;
        if (actual !== options.prepared.expectedLockHash) { throw fail("LOCK_CONFLICT", "Lock base differs; record-result alone can recognize an identical retry"); }
        return {code: 0, stdout: `${JSON.stringify({status: "complete", data: {valid: true, contextFingerprint: context.fingerprint}, errors: []})}\n`}; } catch (error) { return errorResponse(error); }
}
if (isMainModule(import.meta.url)) {
    const result = main(); process.stdout.write(result.stdout); if (result.stderr) { process.stderr.write(result.stderr); } process.exitCode = result.code;
}
