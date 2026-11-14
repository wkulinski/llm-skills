#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "./file-process.mjs";
import {isMainModule} from "./is-main-module.mjs";
import {assertArtifactPath, resolveArtifactCacheRoot, resolveRepositoryRoot} from "./artifact-path.mjs";
import {preflightCriteriaFile} from "./context-criteria.mjs";
import {currentGitMetadata, getWorktreeFingerprint} from "./context-manifest.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_TOOL = path.join(SCRIPT_DIR, "context-manifest.mjs");
const HANDOFF_TOOL = path.join(SCRIPT_DIR, "context-handoff.mjs");
const REPORT_BUILDER = path.join(SCRIPT_DIR, "context-scout-report-builder.mjs");
export const SCOUT_PROTOCOL_VERSION = 6;
const FAILURE_CLASSES = {INPUT_INVALID: "INPUT_INVALID", SNAPSHOT_STALE: "SNAPSHOT_STALE"};
function usage() {
    return "Usage: context-scout-run.mjs prepare --prompt-file <file> --manifest <file> --handoff <file> --criteria <file> [--output-dir <dir>] [--title <name>]\n"
        + "       context-scout-run.mjs claim|settle|abort --state <file> --run-id <id> [--token <claim-token>]\n"
        + "One scout; settle returns RETURN_RESULT, REPAIR_REPORT for the same agent, or STOP. No automatic discovery retry.\n";
}
export function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith("--")) {
            if (!args._) { args._ = []; }
            args._.push(item);
            continue;
        }
        const key = item.slice(2);
        const next = argv[index + 1];
        if (!next || next.startsWith("--")) {
            args[key] = true;
            continue;
        }
        args[key] = next;
        index += 1;
    }
    return args;
}

function required(args, key) {
    if (!args[key] || typeof args[key] !== "string") {
        throw new Error(`Missing required option --${key}`);
    }
    return args[key];
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporaryPath, filePath);
}

function withStateLock(statePath, callback) {
    const lockPath = `${statePath}.lock`;
    let descriptor;
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            descriptor = fs.openSync(lockPath, "wx");
            fs.writeFileSync(descriptor, `${process.pid}\n`);
            break;
        } catch (error) {
            if (error?.code !== "EEXIST") { throw error; }
            try {
                if (Date.now() - fs.statSync(lockPath).mtimeMs > 30_000) {
                    fs.unlinkSync(lockPath);
                    continue;
                }
            } catch {
                continue;
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
        }
    }
    if (descriptor === undefined) { throw new Error("Could not acquire scout state lock"); }
    try {
        return callback();
    } finally {
        fs.closeSync(descriptor);
        try { fs.unlinkSync(lockPath); } catch (error) {
            if (error?.code !== "ENOENT") { throw error; }
        }
    }
}

function resolveExisting(cwd, value, label) {
    const resolved = assertArtifactPath(value, label, cwd);
    if (!fs.existsSync(resolved)) { throw new Error(`${label} does not exist: ${resolved}`); }
    return resolved;
}

function validateManifest(manifestPath, cwd) {
    for (const command of ["validate", "verify"]) {
        const result = spawnSync(process.execPath, [MANIFEST_TOOL, command, manifestPath], {
            cwd,
            encoding: "utf8",
        });
        if (result.status !== 0) {
            const detail = result.stderr?.trim() || result.stdout?.trim() || "unknown error";
            const error = new Error(`manifest ${command} failed: ${detail}`);
            if (command === "validate" && error.message.includes("MANIFEST_REGENERATION_REQUIRED")) {
                error.code = "MANIFEST_REGENERATION_REQUIRED";
                error.failure_class = FAILURE_CLASSES.INPUT_INVALID;
                error.next_action = "STOP";
            } else if (command === "verify" && /^(?:repository|branch|head|worktree\.)[^\n]*:/m.test(detail)) {
                error.code = "SNAPSHOT_STALE";
                error.failure_class = FAILURE_CLASSES.SNAPSHOT_STALE;
                error.next_action = "STOP";
                error.snapshot_changed = true;
            } else if (command === "verify") {
                error.code = "MANIFEST_VERIFY_FAILED";
                error.failure_class = FAILURE_CLASSES.INPUT_INVALID;
                error.next_action = "STOP";
                error.snapshot_changed = false;
            }
            throw error;
        }
    }
}

function errorEnvelope(error) {
    return {protocolVersion: SCOUT_PROTOCOL_VERSION, ok: false, error: {
        code: error.code ?? "SCOUT_ERROR", message: error.message,
        failure_class: error.failure_class ?? "INPUT_INVALID", next_action: "STOP",
    }};
}

function validateHandoff(handoffPath, cwd) {
    const result = spawnSync(process.execPath, [HANDOFF_TOOL, "validate", handoffPath], {
        cwd,
        encoding: "utf8",
    });
    if (result.status !== 0) {
        throw new Error(`handoff validation failed: ${result.stderr?.trim() || result.stdout?.trim() || "unknown error"}`);
    }
}

function safeName(value) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function hashFile(filePath) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function inputHashes(inputs) {
    return Object.fromEntries(Object.entries(inputs).map(([key, filePath]) => [key, hashFile(filePath)]));
}

function markSnapshotStale(state, statePath) {
    if (statePath !== null && state.phase !== "ABORTED" && state.phase !== "FINALIZED") {
        state.failure_class = FAILURE_CLASSES.SNAPSHOT_STALE;
        state.snapshot_changed = true;
        state.phase = "ABORTED";
        writeJson(statePath, state);
    }
}

function snapshotStaleError(message, state, statePath, attempt) {
    const error = new Error(message);
    error.failure_class = FAILURE_CLASSES.SNAPSHOT_STALE;
    error.next_action = "ABORT";
    error.snapshot_changed = true;
    markSnapshotStale(state, statePath, attempt);
    return error;
}

function assertInputsUnchanged(state, statePath = null, attempt = null) {
    for (const [key, expectedHash] of Object.entries(state.inputHashes)) {
        if (!fs.existsSync(state.inputs[key]) || hashFile(state.inputs[key]) !== expectedHash) {
            throw snapshotStaleError(`Scout input changed after prepare: ${key}`, state, statePath, attempt);
        }
    }
}

function assertWorktreeUnchanged(state, statePath = null, attempt = null) {
    const expected = state.manifestSnapshot;
    if (!expected?.worktree) {
        throw snapshotStaleError("Scout manifest has no worktree fingerprint", state, statePath, attempt);
    }

    let current;
    try {
        const metadata = currentGitMetadata(state.cwd);
        const worktree = getWorktreeFingerprint({cwd: state.cwd});
        current = {...metadata, worktree};
    } catch (error) {
        throw snapshotStaleError(`Scout worktree fingerprint unavailable: ${error.message}`, state, statePath, attempt);
    }

    const metadataMismatches = ["repository", "branch", "head"]
        .filter((key) => expected[key] && current[key] && expected[key] !== current[key]);
    const fingerprintMismatches = ["staged_sha256", "unstaged_sha256", "untracked_sha256", "combined_sha256"]
        .filter((key) => expected.worktree[key] !== current.worktree[key]);
    if (metadataMismatches.length > 0 || fingerprintMismatches.length > 0) {
        const details = [
            ...metadataMismatches.map((key) => `${key} changed`),
            ...fingerprintMismatches.map((key) => `worktree.${key} changed`),
        ].join(", ");
        throw snapshotStaleError(`Scout snapshot changed after prepare: ${details}`, state, statePath, attempt);
    }
}

function assertRun(state, runId, statePath = null, attempt = null) {
    if (state.protocolVersion !== SCOUT_PROTOCOL_VERSION) { throw new Error("Unsupported scout protocol version"); }
    if (state.runId !== runId) { throw new Error("Scout run-id does not match state"); }
    assertInputsUnchanged(state, statePath, attempt);
    assertWorktreeUnchanged(state, statePath, attempt);
}


function buildTaskPrompt(state) {
    const playbook = path.join(SCRIPT_DIR, "../references/repository-context-scout-playbook.md");
    const protocol = fs.readFileSync(path.join(SCRIPT_DIR, "../references/context-scout-report-protocol.md"), "utf8");
    const template = protocol.match(/```json\n([\s\S]*?)\n```/);
    if (!template) { throw new Error("Missing minimal BLOCKED envelope in report protocol"); }
    return [
        "Act as context-scout for one read-only repository-context task. Do not delegate or perform implementation, QA, runtime diagnostics or context-refresh.",
        `Consumer project root: ${state.cwd}; branch: ${state.manifestSnapshot.branch}; mode: ${state.mode}.`,
        "Read documentation and known paths with file tools. Use Serena for symbols only when its active project root is the consumer root; never activate or switch its project, and otherwise use file reads. Do not change that root to read installation instructions.",
        `If file tools are unavailable, use read-only shell commands (rg, sed, cat, head, tail, ls) with working directory ${state.cwd}.`,
        "Read only the consumer project and the supplied installation instructions and their required references. Never execute applications, tests, installers, interpreters, helpers or validators; never redirect writes or execute file contents.",
        `Read the installation playbook: ${playbook}`,
        ...Object.entries(state.inputs).map(([key, value]) => `Read immutable ${key}: ${value}`),
        "Check these reads with your own tools before discovery; if unavailable, write BLOCKED with literal denials. Use CMM only with confirmed private store/runtime and index readiness in the handoff; otherwise use file discovery and record why.",
        "There are no numeric limits on files, symbols, reads, steps or report length. Read another source only to resolve a concrete uncertainty; finish when criteria have sufficient evidence. Narrow reads after output truncation rather than treating it as exhausted budget.",
        "Keep claims proportional to directly verified evidence. Each finding needs criterion_id, claim, claim_type, confidence, literal anchors and source evidence with exact repo-relative paths and valid line_start/line_end. Use the smallest sufficient evidence; no fixed line limit applies.",
        "Use COMPLETE only when every criterion is covered; use INCOMPLETE with validated findings and explicit gaps, or BLOCKED with no findings if required access is unavailable. Do not invent absence or exclusivity claims; honor required_evidence gates and forbid_negative_claims.",
        "read_coverage is optional metadata about actual reads. Follow-ups may name an already-read file when a reason identifies the remaining range or uncertainty. Do not reread without a concrete purpose.",
        "Build the report in memory with version: 1, status, actual mode, findings, coverage for all actual criteria, risks, omitted and next_step. Risks may be strings; object risks require claim metadata and evidence.",
        "Minimal BLOCKED envelope (replace mode and criterion IDs with all actual inputs):",
        template[1],
        `Write only your full report JSON via native write/apply_patch to: ${state.scoutPath}`,
        "Do not run the controller or validator. Return only a compact acknowledgement with status and scout_path. If the controller returns validation errors, correct this report in the same agent context; do not restart discovery. Stop and diagnose repeated errors without progress.",
    ].join("\n");
}

export function prepareScout(args, workingDirectory = process.cwd()) {
    const cwd = resolveRepositoryRoot(workingDirectory);
    const inputs = Object.fromEntries([["prompt", "prompt-file"], ["manifest", "manifest"], ["handoff", "handoff"], ["criteria", "criteria"]]
        .map(([key, flag]) => [key, resolveExisting(cwd, required(args, flag), key)]));
    validateHandoff(inputs.handoff, cwd);
    validateManifest(inputs.manifest, cwd);
    const manifest = readJson(inputs.manifest);
    const handoff = readJson(inputs.handoff);
    const preflight = preflightCriteriaFile(inputs.criteria, cwd);
    if (!preflight.valid) { throw new Error(JSON.stringify(preflight.errors)); }
    const outputDir = assertArtifactPath(args["output-dir"] ?? path.join(resolveArtifactCacheRoot(cwd), "context-scout"), "scout output directory", cwd);
    fs.mkdirSync(outputDir, {recursive: true});
    const runId = crypto.randomUUID();
    const prefix = path.join(outputDir, `${safeName(args.title ?? "context-scout")}-${runId}`);
    const statePath = `${prefix}.state.json`;
    const state = {
        protocolVersion: SCOUT_PROTOCOL_VERSION, runId, phase: "PREPARED", cwd,
        createdAt: new Date().toISOString(), inputs, inputHashes: inputHashes(inputs),
        manifestHead: manifest.head,
        manifestSnapshot: {repository: manifest.repository, branch: manifest.branch, head: manifest.head, worktree: manifest.worktree},
        mode: handoff.mode, scoutPath: `${prefix}.scout.json`, reportPath: `${prefix}.report.json`,
        ledgerPath: `${prefix}.ledger.json`, metadataPath: `${prefix}.meta.json`, validationHistory: [],
    };
    // Validate installation dependencies before leaving a claimable run.
    buildTaskPrompt(state);
    writeJson(statePath, state);
    return {protocolVersion: SCOUT_PROTOCOL_VERSION, runId, statePath, phase: state.phase, next: {action: "CLAIM_SCOUT"}};
}

function loadRun(args, statePath, verify = true) {
    const state = readJson(statePath);
    if (state.protocolVersion !== SCOUT_PROTOCOL_VERSION) { throw new Error("Unsupported scout protocol; historical runs are read-only, prepare a new run"); }
    if (state.runId !== required(args, "run-id")) { throw new Error("Scout run-id does not match state"); }
    if (verify) { assertRun(state, state.runId, statePath); }
    return state;
}

export function claimScout(args) {
    const statePath = path.resolve(required(args, "state"));
    return withStateLock(statePath, () => {
        const state = loadRun(args, statePath);
        if (state.phase !== "PREPARED") { throw new Error(`Cannot claim scout while phase is ${state.phase}`); }
        const prompt = buildTaskPrompt(state);
        state.phase = "RUNNING"; state.dispatchToken = crypto.randomUUID(); state.startedAtMs = Date.now();
        writeJson(statePath, state);
        return {protocolVersion: SCOUT_PROTOCOL_VERSION, runId: state.runId, statePath,
            dispatchToken: state.dispatchToken, scoutPath: state.scoutPath,
            dispatch: {subagent_type: "context-scout", description: "Scout repository context", prompt}};
    });
}

function buildReport(state) {
    let payload;
    try { payload = JSON.parse(fs.readFileSync(state.scoutPath, "utf8")); }
    catch (error) { return {stage: "read-scout", scoutPath: state.scoutPath, message: error.message}; }
    if (!["COMPLETE", "INCOMPLETE", "BLOCKED"].includes(payload?.status)) {
        return {stage: "scout-status", scoutPath: state.scoutPath, message: "Invalid report status"};
    }
    for (const args of [
        ["init", state.ledgerPath, "--head", state.manifestHead, "--criteria", state.inputs.criteria, "--mode", state.mode],
        ["batch-render", state.ledgerPath, "--status", payload.status, "--output", state.reportPath],
    ]) {
        const result = spawnSync(process.execPath, [REPORT_BUILDER, ...args], {
            cwd: state.cwd, encoding: "utf8", ...(args[0] === "batch-render" ? {input: JSON.stringify(payload)} : {}),
        });
        if (result.error || result.status !== 0) {
            return {stage: args[0], scoutPath: state.scoutPath, exitCode: result.status,
                signal: result.signal ?? null, message: result.error?.message ?? result.stderr ?? "Report builder failed"};
        }
    }
    if (payload.mode !== state.mode) { return {stage: "report-mode", scoutPath: state.scoutPath, message: `Report mode must be ${state.mode}`}; }
    return null;
}

function finalize(state, statePath, validation, action) {
    state.phase = "FINALIZED";
    const metadata = {
        protocolVersion: SCOUT_PROTOCOL_VERSION, runId: state.runId, status: validation.status ?? null,
        schemaValid: validation.schemaValid, complete: validation.schemaValid && validation.status === "COMPLETE",
        durationMs: Date.now() - state.startedAtMs, validationHistory: state.validationHistory,
        diagnostics: validation.diagnostics ?? null,
        final: {reportPath: validation.schemaValid ? state.reportPath : null},
        criteriaPath: state.inputs.criteria, manifestHead: state.manifestHead,
    };
    writeJson(state.metadataPath, metadata); writeJson(statePath, state);
    return {runId: state.runId, statePath, phase: state.phase, validation, next: {action}, finalized: metadata};
}

export function settleScout(args) {
    const statePath = path.resolve(required(args, "state"));
    return withStateLock(statePath, () => {
        const state = loadRun(args, statePath);
        if (!["RUNNING", "REPAIR_REQUIRED"].includes(state.phase)) { throw new Error(`Cannot settle while phase is ${state.phase}`); }
        if (state.dispatchToken !== required(args, "token")) { throw new Error("Matching scout token required"); }
        const diagnostics = buildReport(state);
        const validation = diagnostics ? {schemaValid: false, diagnostics} : {schemaValid: true, status: readJson(state.reportPath).status};
        if (!diagnostics) { return finalize(state, statePath, validation, "RETURN_RESULT"); }
        // Repeated diagnostics, including cycles, indicate that repair is not making progress.
        const signature = crypto.createHash("sha256").update(JSON.stringify(diagnostics)).digest("hex");
        const repeated = state.validationHistory.some(item => item.signature === signature);
        state.validationHistory.push({signature, diagnostics});
        if (repeated) { return finalize(state, statePath, {...validation, reason: "NO_REPAIR_PROGRESS"}, "STOP"); }
        state.phase = "REPAIR_REQUIRED"; writeJson(statePath, state);
        return {runId: state.runId, statePath, phase: state.phase, validation,
            next: {action: "REPAIR_REPORT", scoutPath: state.scoutPath,
                prompt: `Correct only your report at ${state.scoutPath} using native write/apply_patch. Stay in the same scout context, preserve verified findings and do not repeat discovery. Validation errors: ${JSON.stringify(diagnostics)}. If the missing evidence cannot be supplied honestly from existing reads, mark the criterion blocked and use INCOMPLETE. Return a compact acknowledgement.`}};
    });
}

export function abortScout(args) {
    const statePath = path.resolve(required(args, "state"));
    return withStateLock(statePath, () => {
        const state = loadRun(args, statePath, false);
        if (state.phase === "FINALIZED") { throw new Error("Cannot abort a finalized scout run"); }
        state.phase = "ABORTED"; writeJson(statePath, state);
        return {runId: state.runId, statePath, phase: state.phase};
    });
}

if (isMainModule(import.meta.url)) {
    const args = parseArgs(process.argv.slice(2));
    const command = args._?.[0];
    if (args.help || !["prepare", "claim", "settle", "abort"].includes(command)) {
        process.stdout.write(usage()); process.exitCode = args.help ? 0 : 2;
    } else {
        try {
            const result = {prepare: prepareScout, claim: claimScout, settle: settleScout, abort: abortScout}[command](args);
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            if (result.next?.action === "STOP") { process.exitCode = 1; }
        } catch (error) {
            process.stderr.write(`${JSON.stringify(errorEnvelope(error))}\n`); process.exitCode = 2;
        }
    }
}
