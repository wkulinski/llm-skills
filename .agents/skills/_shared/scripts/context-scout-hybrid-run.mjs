#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {assertArtifactPath} from "./artifact-path.mjs";
import {preflightCriteriaFile} from "./context-criteria.mjs";
import {
    FAILURE_CLASSES,
    classifyReportValidation,
    isRetryableFailureClass,
    nextActionForFailureClass,
} from "./context-scout-report.mjs";
import {currentGitMetadata, getWorktreeFingerprint} from "./context-manifest.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const VALIDATOR = path.join(SCRIPT_DIR, "context-scout-report.mjs");
const REPORT_BUILDER = path.join(SCRIPT_DIR, "context-scout-report-builder.mjs");
const MANIFEST_TOOL = path.join(SCRIPT_DIR, "context-manifest.mjs");
const HANDOFF_TOOL = path.join(SCRIPT_DIR, "context-handoff.mjs");
const PROTOCOL_VERSION = 3;
const PRIMARY_AGENT = "context-scout-fast";
const FALLBACK_AGENT = "context-scout";
export const DISCOVERY_BUDGETS = Object.freeze({
    targeted: Object.freeze({
        default_file_budget: 6,
        verification_margin: 2,
        hard_file_budget: 6,
        default_symbol_budget: 3,
        hard_symbol_budget: 3,
        default_test_budget: 2,
        hard_test_budget: 2,
    }),
    "cross-layer": Object.freeze({
        default_file_budget: 10,
        verification_margin: 2,
        hard_file_budget: 10,
        default_symbol_budget: 5,
        hard_symbol_budget: 5,
        default_test_budget: 3,
        hard_test_budget: 3,
    }),
});

function usage() {
    return `Usage:
  node context-scout-hybrid-run.mjs prepare \\
    --prompt-file <file> --manifest <file> --handoff <file> --criteria <file> \\
    [--output-dir <dir>] [--title <name>] [--retry-aborted <run-id>] [--debug]
  node context-scout-hybrid-run.mjs claim \\
     --state <file> --run-id <id> --attempt primary|fallback
  node context-scout-hybrid-run.mjs evaluate \\
    --state <file> --run-id <id> --attempt primary|fallback --token <dispatch-token> \\
    [--duration-ms <ms>] [--ack '<compact-json>']
  node context-scout-hybrid-run.mjs settle \\
     --state <file> --run-id <id> --attempt primary|fallback --token <dispatch-token>
  node context-scout-hybrid-run.mjs finalize --state <file> --run-id <id>
  node context-scout-hybrid-run.mjs abort --state <file> --run-id <id>

The helper never starts OpenCode or any agent. prepare validates inputs and
creates artifacts; the main agent claims each attempt (idempotent dispatch guard)
to obtain a one-time token and the task prompt, delegates through the native task
tool, then evaluates. settle performs evaluate+finalize in one shot.
`;
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
    if (descriptor === undefined) { throw new Error("Could not acquire hybrid state lock"); }
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
    const resolved = path.resolve(cwd, value);
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

function errorEnvelope(error, debug = false) {
    const details = {
        code: error?.code ?? "UNEXPECTED_ERROR",
        message: error instanceof Error ? error.message : String(error),
        failure_class: error?.failure_class ?? FAILURE_CLASSES.INPUT_INVALID,
        next_action: error?.next_action ?? "STOP",
        ...(error?.criteriaErrors !== undefined ? {criteria_errors: error.criteriaErrors} : {}),
        ...(error?.logical_input_hash !== undefined ? {logical_input_hash: error.logical_input_hash} : {}),
        ...(error?.rerun_of !== undefined ? {rerun_of: error.rerun_of} : {}),
        ...(error?.snapshot_changed !== undefined ? {snapshot_changed: error.snapshot_changed} : {}),
        ...(error?.preflight !== undefined ? {preflight: error.preflight} : {}),
        ...(error?.diagnostics !== undefined ? {diagnostics: error.diagnostics} : {}),
        ...(debug && error?.stack ? {stack: error.stack} : {}),
    };
    return {protocolVersion: PROTOCOL_VERSION, ok: false, error: details};
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

function canonicalize(value) {
    if (Array.isArray(value)) { return value.map((item) => canonicalize(item)); }
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
}

function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
}

export function calculateLogicalInputHash({prompt, manifest, handoff, criteria, strategy, budget}) {
    return crypto.createHash("sha256").update(canonicalJson({
        version: 1,
        prompt,
        manifest,
        handoff,
        criteria,
        strategy,
        budget,
    })).digest("hex");
}

function findPreviousLogicalRun(outputDir, title, logicalInputHash) {
    if (!fs.existsSync(outputDir)) { return null; }

    return fs.readdirSync(outputDir)
        .filter((entry) => entry.endsWith(".state.json"))
        .map((entry) => {
            try {
                return readJson(path.join(outputDir, entry));
            } catch {
                return null;
            }
        })
        .filter((state) => state?.title === title && state.logical_input_hash === logicalInputHash)
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
        .at(-1) ?? null;
}

function withLogicalRunLock(outputDir, title, logicalInputHash, callback) {
    fs.mkdirSync(outputDir, {recursive: true});
    const lockPath = path.join(outputDir, `.logical-${safeName(title)}-${logicalInputHash}.lock`);
    let descriptor;
    for (let attempt = 0; attempt < 2; attempt += 1) {
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
            } catch (lockError) {
                if (lockError?.code === "ENOENT") { continue; }
                throw lockError;
            }
            const lockError = new Error(`Logical run is already being prepared: ${title}`);
            lockError.code = "LOGICAL_RUN_IN_PROGRESS";
            lockError.failure_class = FAILURE_CLASSES.INPUT_INVALID;
            lockError.next_action = "STOP";
            throw lockError;
        }
    }
    if (descriptor === undefined) {
        throw new Error("Could not acquire logical run lock");
    }

    try {
        return callback();
    } finally {
        fs.closeSync(descriptor);
        try { fs.unlinkSync(lockPath); } catch (error) {
            if (error?.code !== "ENOENT") { throw error; }
        }
    }
}

function inputHashes(inputs) {
    return Object.fromEntries(Object.entries(inputs).map(([key, filePath]) => [key, hashFile(filePath)]));
}

function markSnapshotStale(state, statePath, attempt) {
    if (statePath !== null && state.phase !== "ABORTED" && state.phase !== "FINALIZED") {
        state.failure_class = FAILURE_CLASSES.SNAPSHOT_STALE;
        state.snapshot_changed = true;
        if (attempt !== null && state[attempt]) {
            state[attempt].failure_class = FAILURE_CLASSES.SNAPSHOT_STALE;
        }
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
            throw snapshotStaleError(`Hybrid input changed after prepare: ${key}`, state, statePath, attempt);
        }
    }
}

function assertWorktreeUnchanged(state, statePath = null, attempt = null) {
    const expected = state.manifestSnapshot;
    if (!expected?.worktree) {
        throw snapshotStaleError("Hybrid manifest has no worktree fingerprint", state, statePath, attempt);
    }

    let current;
    try {
        const metadata = currentGitMetadata(state.cwd);
        const worktree = getWorktreeFingerprint({cwd: state.cwd});
        current = {...metadata, worktree};
    } catch (error) {
        throw snapshotStaleError(`Hybrid worktree fingerprint unavailable: ${error.message}`, state, statePath, attempt);
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
        throw snapshotStaleError(`Hybrid snapshot changed after prepare: ${details}`, state, statePath, attempt);
    }
}

function assertRun(state, runId, statePath = null, attempt = null) {
    if (state.protocolVersion !== PROTOCOL_VERSION) { throw new Error("Unsupported hybrid protocol version"); }
    if (state.runId !== runId) { throw new Error("Hybrid run-id does not match state"); }
    assertInputsUnchanged(state, statePath, attempt);
    assertWorktreeUnchanged(state, statePath, attempt);
}

function buildTaskPrompt({agent, inputs, reportPath, ledgerPath, mode, budget}) {
    const primary = agent === PRIMARY_AGENT;
    const finalizationDeadline = primary ? 24 : 22;
    const discoveryBudget = primary && mode === "targeted"
        ? `Use a bounded targeted discovery budget: at most ${budget.effective_file_budget} relevant files, ${budget.effective_symbol_budget} symbols, and ${budget.effective_test_budget} tests/commands; stop after one discovery pass and one direct verification pass once criteria are covered.`
        : `Use a bounded discovery budget: at most ${budget.effective_file_budget} relevant files, ${budget.effective_symbol_budget} symbols, and ${budget.effective_test_budget} tests/commands; stop after one discovery pass and one direct verification pass once criteria are covered.`;
    return [
        `Act strictly as ${agent} for one read-only repository-context attempt.`,
        "Do not delegate, invoke another agent, run context-scout-hybrid-run.mjs, or perform QA/review/implementation.",
        "Before discovery, read and follow ./.agents/skills/_shared/references/repository-context-scout-playbook.md.",
        "Read these exact, immutable inputs:",
        `- original prompt: ${inputs.prompt}`,
        `- context manifest: ${inputs.manifest}`,
        `- handoff: ${inputs.handoff}`,
        `- acceptance criteria: ${inputs.criteria}`,
        "Use context-scout-report-builder.mjs and the repository contract to produce the report.",
        `Initialize the report ledger exactly at: ${ledgerPath}`,
        discoveryBudget,
        `Budget contract: minimum_file_budget=${budget.minimum_file_budget}; verification_margin=${budget.verification_margin}; effective_file_budget=${budget.effective_file_budget}; hard_file_budget=${budget.hard_file_budget}; effective_symbol_budget=${budget.effective_symbol_budget}; effective_test_budget=${budget.effective_test_budget}. Do not exceed these limits or broaden the criteria.`,
        "Record read_coverage.covered for exact paths read and read_coverage.follow_up for at most 8 parent follow-ups with concrete reasons. When a covered path has a meaningful declared purpose, include purpose/source/read_mode from the shared read-purpose enum; these fields are context metadata, not freshness proof.",
        "Every finding must declare claim_type (observed, structural, inferred), confidence (high, medium, low), and anchors containing literal terms present in the cited evidence; never infer a field or behavior from a filename, symbol name, or analogy.",
        "For required_evidence entries, anchor_mode=required-literal means every declared anchor is a preflight-verified hard gate; anchor_mode=scout-selected means the path, path_prefix, and optional relation are gates while the scout selects literal anchors from directly read evidence. Legacy anchors without anchor_mode are required-literal, and entries without anchors are scout-selected.",
        primary ? "Default to exactly one compact, parent-ready finding per criterion and keep the complete report near 1000 tokens. Add a second finding only when one criterion spans independent roles that cannot be supported honestly by one claim." : "",
        primary ? "Use at most three minimal evidence ranges per finding. When finding evidence already proves the criterion, keep coverage[].evidence empty instead of duplicating the same ranges; record actual reads only in read_coverage.covered." : "",
        primary ? "If the prompt or criterion names a concrete file, agent, symbol, test, configuration, route, or entrypoint, search for that exact name and directly read its defining source before accepting substitute references from tests or documentation. CMM silence cannot establish that an untracked file is absent." : "",
        "Treat every criteria[].required_evidence entry as a hard validator gate. Satisfy its exact path or path_prefix, optional relation, and all literal anchors with finding evidence for the same criterion; substitute documentation or tests do not satisfy a defining-source requirement. When forbid_negative_claims is true, avoid absolute absence or exclusivity claims in COMPLETE.",
        primary ? "A COMPLETE report must not claim that an artifact does not exist, is missing, is the only one, or that no test covers it. If a named target is not directly located, leave that criterion uncovered and return INCOMPLETE with the bounded statement that it was not located; never recommend creating an allegedly missing file unless the user explicitly requested it." : "",
        primary ? "Add risks, omitted paths, next_step, and read_coverage.follow_up only when they change the parent's decision. Never direct the parent to reread a path already present in read_coverage.covered." : "",
        "After input validation, initialize the ledger exactly once. Do not call add-evidence, add-finding, set-coverage, check, batch, or render separately. Build the complete report JSON in memory and send it directly to batch-render as the second and final builder operation.",
        "Keep every evidence range at or below 80 lines and use the smallest range that proves the claim.",
        `Before any optional enrichment, complete the minimum-report checkpoint: choose exactly one final status and reserve the remaining steps for batch-render and the compact acknowledgement. Do not spend more than ${finalizationDeadline} steps on discovery and verification; optional enrichment must never delay batch-render.`,
        "Use exactly one finalization branch:",
        "- COMPLETE: every criterion has direct evidence and valid coverage; include findings for the covered criteria.",
        "- INCOMPLETE: discovery or verification ran out of bounded time/budget; include only validated findings, mark uncovered criteria blocked with concrete reasons, and do not claim COMPLETE.",
        "- BLOCKED: a hard input, permission, or safety boundary prevents discovery; write no findings and mark every criterion blocked or not_applicable with a concrete reason.",
        "The report payload status and the --status value must be the same selected status. A claimed attempt must still write INCOMPLETE or BLOCKED when COMPLETE is not honest; never finish silently without an artifact.",
        "Finalize with one mandatory batch-render command for the selected status. Replace <STATUS> with COMPLETE, INCOMPLETE, or BLOCKED and <STATUS_REPORT_JSON> with the matching complete JSON object; run the opening command, payload, and closing marker as one bash call:",
        `node ./.agents/skills/_shared/scripts/context-scout-report-builder.mjs batch-render ${ledgerPath} --status <STATUS> --output ${reportPath} <<'REPORT_JSON'`,
        "<STATUS_REPORT_JSON>",
        "REPORT_JSON",
        "The builder reads the complete report JSON from this heredoc, validates it against the ledger, stores it, and renders the artifact in one step. Do not run batch-render with empty stdin. Do not create a separate input file or use cat, touch, printf, echo, process substitution, separate batch, or separate render.",
        `Write the full report artifact to exactly: ${reportPath}`,
        "After writing the report artifact, return ONLY a compact JSON acknowledgement whose status matches the report (no other text):",
        '  {"status":"<STATUS>","report_path":"' + reportPath + '","findings_count":<n>,"covered_criteria":<COVERED_CRITERIA_JSON>}',
        "The helper remains authoritative, computes the report hash, and validates the report file; the acknowledgement is metadata only. Do not include or inspect another attempt's output.",
    ].filter(Boolean).join("\n");
}

function recoverReportFromLedger(state, attempt) {
    const attemptState = state[attempt];
    if (fs.existsSync(attemptState.reportPath) || !attemptState.ledgerPath || !fs.existsSync(attemptState.ledgerPath)) {
        return {attempted: false, recovered: false};
    }
    const check = spawnSync(process.execPath, [REPORT_BUILDER, "check", attemptState.ledgerPath], {
        cwd: state.cwd,
        encoding: "utf8",
    });
    if (check.status !== 0) { return {attempted: true, recovered: false, writeFailed: false}; }
    let status = "COMPLETE";
    try {
        const ledger = readJson(attemptState.ledgerPath);
        if (["COMPLETE", "INCOMPLETE", "BLOCKED"].includes(ledger.batch_report?.status)) {
            status = ledger.batch_report.status;
        }
    } catch {
        return {attempted: true, recovered: false, writeFailed: false};
    }
    const render = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "render",
        attemptState.ledgerPath,
        "--status",
        status,
        "--output",
        attemptState.reportPath,
    ], {cwd: state.cwd, encoding: "utf8"});
    const recovered = render.status === 0 && fs.existsSync(attemptState.reportPath);
    const writeFailed = render.error !== undefined
        || render.status === null
        || /\b(?:EACCES|EISDIR|EIO|ENOTDIR|EPERM)\b/.test(render.stderr ?? "");
    return {attempted: true, recovered, writeFailed};
}

export function validateReport({reportPath, manifestHead, criteriaPath, expectedMode, cwd}) {
    if (!reportPath || !fs.existsSync(reportPath)) {
        return {
            valid: false,
            schemaValid: false,
            status: null,
            reportSha256: undefined,
            reason: "missing_report",
            reportExists: false,
            ioFailure: false,
            modeMatches: false,
            failure_class: FAILURE_CLASSES.REPORT_MISSING,
        };
    }
    const result = spawnSync(process.execPath, [
        VALIDATOR,
        "validate",
        reportPath,
        "--head",
        manifestHead,
        "--criteria",
        criteriaPath,
    ], {cwd, encoding: "utf8"});
    let report = null;
    let ioFailure = false;
    try {
        report = readJson(reportPath);
    } catch (error) {
        ioFailure = ["EISDIR", "EACCES", "EPERM", "ENOTDIR", "EIO"].includes(error?.code);
    }
    const schemaValid = result.status === 0;
    const modeMatches = report?.mode === expectedMode;
    const valid = !ioFailure && schemaValid && report?.status === "COMPLETE" && modeMatches;
    let reportSha256;
    try {
        reportSha256 = hashFile(reportPath);
    } catch {
        reportSha256 = null;
        ioFailure = true;
    }
    const failureClass = classifyReportValidation({valid, reportExists: true, ioFailure, schemaValid, status: report?.status ?? null, modeMatches});
    return {
        valid,
        schemaValid,
        status: report?.status ?? null,
        reportSha256,
        reportExists: true,
        ioFailure,
        modeMatches,
        failure_class: failureClass,
        next_action: nextActionForFailureClass(failureClass),
        stdout: result.stdout?.trim() || undefined,
        stderr: result.stderr?.trim() || undefined,
        reason: valid ? null : (ioFailure ? "report_unreadable" : (!schemaValid ? "validator_failed" : (!modeMatches ? "mode_mismatch" : "status_not_complete"))),
    };
}

export function prepareHybrid(args, cwd = process.cwd()) {
    return prepareHybridUnchecked(args, cwd);
}

function prepareHybridUnchecked(args, cwd) {
    const preflightStartedAtMs = Date.now();
    let inputs;
    let manifest;
    let handoff;
    let criteriaPreflight;
    let outputDir;
    try {
        inputs = {
            prompt: resolveExisting(cwd, required(args, "prompt-file"), "prompt"),
            manifest: resolveExisting(cwd, required(args, "manifest"), "manifest"),
            handoff: resolveExisting(cwd, required(args, "handoff"), "handoff"),
            criteria: resolveExisting(cwd, required(args, "criteria"), "criteria"),
        };
        validateHandoff(inputs.handoff, cwd);
        validateManifest(inputs.manifest, cwd);
        manifest = readJson(inputs.manifest);
        handoff = readJson(inputs.handoff);
        const budgetOptions = DISCOVERY_BUDGETS[handoff.mode] ?? DISCOVERY_BUDGETS.targeted;
        criteriaPreflight = preflightCriteriaFile(inputs.criteria, cwd, budgetOptions);
        if (!criteriaPreflight.valid) {
            const error = new Error(JSON.stringify(criteriaPreflight.errors));
            error.code = criteriaPreflight.errors[0]?.code ?? "INVALID_CRITERIA";
            error.criteriaErrors = criteriaPreflight.errors;
            throw error;
        }
        if (!manifest.head) { throw new Error("Manifest does not contain head"); }
        outputDir = assertArtifactPath(
            args["output-dir"] ?? "var/agent/cache/context-scout-hybrid",
            "hybrid output directory",
            cwd,
        );
    } catch (error) {
        if (error && error.failure_class === undefined) {
            error.failure_class = error.code === "SCOPE_TOO_BROAD" ? FAILURE_CLASSES.SCOPE_INVALID : FAILURE_CLASSES.INPUT_INVALID;
            error.next_action = "STOP";
        }
        if (error && error.preflight === undefined) {
            error.preflight = {
                status: "FAILED",
                durationMs: Date.now() - preflightStartedAtMs,
            };
        }
        if (error && error.diagnostics === undefined) {
            error.diagnostics = {
                input_error_cost_ms: error.preflight.durationMs,
                preflight_cost_ms: error.preflight.durationMs,
                discovery_cost_ms: 0,
            };
        }
        throw error;
    }

    const title = safeName(args.title ?? "context-scout-hybrid");
    const strategy = {
        lifecycle: "primary-first-single-fallback",
        mode: handoff.mode,
        protocolVersion: PROTOCOL_VERSION,
        primaryAgent: PRIMARY_AGENT,
        fallbackAgent: FALLBACK_AGENT,
    };
    const logicalInputHash = calculateLogicalInputHash({
        prompt: fs.readFileSync(inputs.prompt, "utf8"),
        manifest: Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "generated_at")),
        handoff,
        criteria: criteriaPreflight.document,
        strategy,
        budget: criteriaPreflight.budget,
    });
    return withLogicalRunLock(outputDir, title, logicalInputHash, () => {
        const previousRun = findPreviousLogicalRun(outputDir, title, logicalInputHash);
        const retryAborted = args["retry-aborted"];
        const preflight = {
            status: "PASSED",
            durationMs: Date.now() - preflightStartedAtMs,
        };
        const retryingAborted = typeof retryAborted === "string"
            && previousRun?.runId === retryAborted
            && previousRun.phase === "ABORTED";
        if (retryAborted !== undefined && !retryingAborted) {
            const error = new Error(`Cannot retry aborted run: ${retryAborted}`);
            error.code = "RETRY_ABORTED_INVALID";
            error.failure_class = FAILURE_CLASSES.INPUT_INVALID;
            error.next_action = "STOP";
            error.rerun_of = previousRun?.runId ?? null;
            error.preflight = {...preflight, status: "REJECTED"};
            error.diagnostics = {
                input_error_cost_ms: error.preflight.durationMs,
                preflight_cost_ms: error.preflight.durationMs,
                discovery_cost_ms: 0,
            };
            throw error;
        }
        if (previousRun && !retryingAborted) {
            const error = new Error(`Identical logical run already exists: ${previousRun.runId}`);
            error.code = "IDENTICAL_LOGICAL_RUN";
            error.failure_class = FAILURE_CLASSES.INPUT_INVALID;
            error.next_action = "STOP";
            error.logical_input_hash = logicalInputHash;
            error.rerun_of = previousRun.runId;
            error.preflight = {...preflight, status: "REJECTED"};
            error.diagnostics = {
                input_error_cost_ms: error.preflight.durationMs,
                preflight_cost_ms: error.preflight.durationMs,
                discovery_cost_ms: 0,
            };
            throw error;
        }

        fs.mkdirSync(outputDir, {recursive: true});

        const runId = crypto.randomUUID();
        const artifactPrefix = `${title}-${runId}`;
        const statePath = path.join(outputDir, `${artifactPrefix}.state.json`);
        const primaryReportPath = path.join(outputDir, `${artifactPrefix}-primary.report.json`);
        const fallbackReportPath = path.join(outputDir, `${artifactPrefix}-fallback.report.json`);
        const primaryLedgerPath = path.join(outputDir, `${artifactPrefix}-primary.ledger.json`);
        const fallbackLedgerPath = path.join(outputDir, `${artifactPrefix}-fallback.ledger.json`);

        const state = {
            protocolVersion: PROTOCOL_VERSION,
            runId,
            phase: "PRIMARY_PENDING",
            createdAt: new Date().toISOString(),
            cwd: path.resolve(cwd),
            title,
            artifactPrefix,
            outputDir,
            inputs,
            inputHashes: inputHashes(inputs),
            manifestHead: manifest.head,
            manifestSnapshot: {
                repository: manifest.repository,
                branch: manifest.branch,
                head: manifest.head,
                worktree: manifest.worktree,
            },
            mode: handoff.mode,
            budget: criteriaPreflight.budget,
            strategy,
            logical_input_hash: logicalInputHash,
            rerun_of: retryingAborted ? previousRun.runId : null,
            preflight,
            failure_class: null,
            snapshot_changed: false,
            report_written: false,
            primary: {agent: PRIMARY_AGENT, reportPath: primaryReportPath, ledgerPath: primaryLedgerPath, claimed: false, dispatchToken: null, evaluated: false, startedAtMs: null, failure_class: null, partialReportPath: null},
            fallback: {agent: FALLBACK_AGENT, reportPath: fallbackReportPath, ledgerPath: fallbackLedgerPath, used: false, claimed: false, dispatchToken: null, evaluated: false, failure_class: null, partialReportPath: null},
        };
        writeJson(statePath, state);
        return {
            protocolVersion: PROTOCOL_VERSION,
            runId,
            statePath,
            phase: state.phase,
            logical_input_hash: logicalInputHash,
            rerun_of: state.rerun_of,
            preflight,
            next: {
                action: "CLAIM_PRIMARY",
                agent: PRIMARY_AGENT,
                reportPath: primaryReportPath,
                ledgerPath: primaryLedgerPath,
                claim: `node ${path.relative(state.cwd, SCRIPT_PATH)} claim --state ${statePath} --run-id ${runId} --attempt primary`,
            },
        };
    });
}

function parseDuration(args, startedAtMs) {
    const duration = args["duration-ms"] === undefined ? Date.now() - startedAtMs : Number(args["duration-ms"]);
    if (!Number.isFinite(duration) || duration < 0) { throw new Error("Invalid --duration-ms"); }
    return duration;
}

function discardReport(attemptState) {
    if (!attemptState.reportPath || !fs.existsSync(attemptState.reportPath)) {
        return {...attemptState, reportDiscarded: true, reportDiscardedPath: null};
    }
    const discardedPath = `${attemptState.reportPath.replace(/\.report\.json$/, "")}-discarded-${Date.now()}-${process.pid}.report.json`;
    fs.renameSync(attemptState.reportPath, discardedPath);
    return {...attemptState, reportDiscarded: true, reportDiscardedPath: discardedPath};
}

function retainPartialOrDiscard(attemptState, validation) {
    const partial = validation.reportExists
        && !validation.ioFailure
        && validation.schemaValid
        && validation.modeMatches
        && (validation.status === "INCOMPLETE" || validation.status === "BLOCKED");
    if (!partial) { return discardReport(attemptState); }
    return {
        ...attemptState,
        reportDiscarded: false,
        reportDiscardedPath: null,
        partialReportPath: attemptState.reportPath,
    };
}

export function claimAttempt(args) {
    const statePath = path.resolve(required(args, "state"));
    const runId = required(args, "run-id");
    const attempt = required(args, "attempt");
    if (!["primary", "fallback"].includes(attempt)) { throw new Error("--attempt must be primary or fallback"); }
    return withStateLock(statePath, () => {
        const state = readJson(statePath);
        assertRun(state, runId, statePath, attempt);
        const expectedPending = attempt === "primary" ? "PRIMARY_PENDING" : "FALLBACK_PENDING";
        if (state.phase !== expectedPending) {
            throw new Error(`Cannot claim ${attempt} while phase is ${state.phase}`);
        }
        if (state[attempt].claimed) {
            throw new Error(`Duplicate claim rejected for ${attempt} attempt`);
        }
        const dispatchToken = crypto.randomUUID();
        const claimedAtMs = Date.now();
        state.phase = attempt === "primary" ? "PRIMARY_RUNNING" : "FALLBACK_RUNNING";
        state[attempt] = {
            ...state[attempt],
            claimed: true,
            dispatchToken,
            claimedAtMs,
            startedAtMs: claimedAtMs,
            dispatchAudit: {
                runId,
                attempt,
                agent: state[attempt].agent,
                claimedAtMs,
            },
        };
        writeJson(statePath, state);
        return {
            protocolVersion: PROTOCOL_VERSION,
            runId,
            statePath,
            attempt,
            phase: state.phase,
            dispatchToken,
            agent: state[attempt].agent,
            reportPath: state[attempt].reportPath,
            ledgerPath: state[attempt].ledgerPath,
            taskPrompt: buildTaskPrompt({
                agent: state[attempt].agent,
                inputs: state.inputs,
                reportPath: state[attempt].reportPath,
                ledgerPath: state[attempt].ledgerPath,
                mode: state.mode,
                budget: state.budget,
            }),
        };
    });
}

export function evaluateAttempt(args) {
    const statePath = path.resolve(required(args, "state"));
    const runId = required(args, "run-id");
    const attempt = required(args, "attempt");
    const token = required(args, "token");
    if (!["primary", "fallback"].includes(attempt)) { throw new Error("--attempt must be primary or fallback"); }
    const state = readJson(statePath);
    assertRun(state, runId, statePath, attempt);
    const expectedPhase = attempt === "primary" ? "PRIMARY_RUNNING" : "FALLBACK_RUNNING";
    if (state.phase !== expectedPhase) {
        throw new Error(`Cannot evaluate ${attempt} while phase is ${state.phase} (expected ${expectedPhase})`);
    }
    if (state[attempt].dispatchToken !== token) {
        throw new Error(`evaluate requires the matching dispatch token for ${attempt}`);
    }

    const recovery = recoverReportFromLedger(state, attempt);
    const validation = validateReport({
        reportPath: state[attempt].reportPath,
        manifestHead: state.manifestHead,
        criteriaPath: state.inputs.criteria,
        expectedMode: state.mode,
        cwd: state.cwd,
    });

    let ack;
    if (args.ack !== undefined) {
        try {
            ack = typeof args.ack === "string" ? JSON.parse(args.ack) : args.ack;
        } catch {
            ack = {raw: String(args.ack)};
        }
    }

    const durationMs = parseDuration(args, state[attempt].startedAtMs);
    const ackTimedOut = ack !== undefined && (ack.timed_out === true || ack.timeout === true);
    // Duration is observational only. A timeout may invalidate an attempt only
    // when an external harness explicitly reports that it interrupted the task.
    const timedOut = ackTimedOut;

    let failureClass;
    if (timedOut) {
        failureClass = FAILURE_CLASSES.AGENT_TIMEOUT;
    } else if (!validation.reportExists) {
        failureClass = recovery.writeFailed ? FAILURE_CLASSES.REPORT_WRITE_FAILED : FAILURE_CLASSES.REPORT_MISSING;
    } else {
        failureClass = classifyReportValidation({
            valid: validation.valid,
            reportExists: validation.reportExists,
            ioFailure: validation.ioFailure,
            schemaValid: validation.schemaValid,
            status: validation.status,
            modeMatches: validation.modeMatches,
        });
    }

    const accepted = validation.valid && !timedOut;
    const reportWritten = validation.reportExists && !validation.ioFailure;
    validation.failure_class = failureClass;
    validation.next_action = nextActionForFailureClass(failureClass, attempt);
    if (timedOut) {
        validation.reason = "agent_timeout";
    }

    const storedValidation = {
        valid: validation.valid,
        schemaValid: validation.schemaValid,
        status: validation.status,
        reportSha256: validation.reportSha256,
        failure_class: failureClass,
        report_written: reportWritten,
        next_action: validation.next_action,
    };

    state[attempt] = {
        ...state[attempt],
        evaluated: true,
        durationMs,
        validation: storedValidation,
        reportSha256: validation.reportSha256,
        failure_class: failureClass,
        report_written: reportWritten,
        ...(ack !== undefined ? {ack} : {}),
        dispatchAudit: {
            ...(state[attempt].dispatchAudit ?? {runId, attempt, agent: state[attempt].agent}),
            evaluatedAtMs: Date.now(),
            ...(ack !== undefined ? {ack} : {}),
        },
    };
    state.report_written = state.report_written || reportWritten;
    if (failureClass !== null) {
        state.failure_class = failureClass;
    }

    let next;
    if (accepted) {
        state.phase = attempt === "primary" ? "PRIMARY_ACCEPTED" : "FALLBACK_ACCEPTED";
        next = {action: "FINALIZE", failure_class: null};
    } else if (attempt === "primary") {
        if (isRetryableFailureClass(failureClass)) {
            state.primary = retainPartialOrDiscard(state.primary, validation);
            state.phase = "FALLBACK_PENDING";
            state.fallback.used = true;
            state.fallback.startedAtMs = Date.now();
            next = {
                action: "CLAIM_FALLBACK",
                failure_class: failureClass,
                agent: FALLBACK_AGENT,
                reportPath: state.fallback.reportPath,
                ledgerPath: state.fallback.ledgerPath,
                claim: `node ${path.relative(state.cwd, SCRIPT_PATH)} claim --state ${statePath} --run-id ${runId} --attempt fallback`,
            };
        } else {
            state.phase = "PRIMARY_FAILED";
            next = {action: "FINALIZE", failure_class: failureClass};
        }
    } else {
        if (!accepted) { state.fallback = retainPartialOrDiscard(state.fallback, validation); }
        state.phase = accepted ? "FALLBACK_ACCEPTED" : "FALLBACK_FAILED";
        next = {action: "FINALIZE", failure_class: failureClass};
    }
    writeJson(statePath, state);
    return {protocolVersion: PROTOCOL_VERSION, runId, statePath, attempt, validation, failure_class: failureClass, phase: state.phase, next};
}

export function settleAttempt(args) {
    const statePath = path.resolve(required(args, "state"));
    const runId = required(args, "run-id");
    const attempt = required(args, "attempt");
    const token = required(args, "token");
    const evaluated = evaluateAttempt({...args, state: statePath, "run-id": runId, attempt, token});
    let finalized = null;
    if (evaluated.next.action === "FINALIZE") {
        finalized = finalizeHybrid({state: statePath, "run-id": runId});
    }
    return {
        protocolVersion: PROTOCOL_VERSION,
        runId,
        statePath,
        attempt,
        phase: evaluated.phase,
        evaluate: {validation: evaluated.validation, next: evaluated.next},
        finalized,
    };
}

function attemptMetadata(attemptState, attempt, valid) {
    return {
        valid,
        failure_class: attemptState.failure_class ?? null,
        next_action: nextActionForFailureClass(attemptState.failure_class, attempt),
        status: attemptState.validation?.status ?? null,
        durationMs: attemptState.durationMs ?? null,
        report_written: attemptState.report_written ?? false,
        reportSha256: attemptState.reportSha256 ?? null,
        reportPath: valid ? attemptState.reportPath : null,
        partialReportPath: attemptState.partialReportPath ?? null,
        reportDiscardedPath: attemptState.reportDiscardedPath ?? null,
    };
}

function finalMetadata(state) {
    const primaryValid = state.primary.validation?.valid === true;
    const fallbackValid = state.fallback.validation?.valid === true;
    const fallbackCount = state.fallback.used ? 1 : 0;
    const finalAttempt = primaryValid || !state.fallback.used ? state.primary : state.fallback;
    const partialAttempt = primaryValid || fallbackValid
        ? null
        : state.fallback.partialReportPath != null
            ? state.fallback
            : state.primary.partialReportPath != null ? state.primary : null;
    const primaryDurationMs = state.primary.durationMs ?? 0;
    const fallbackDurationMs = state.fallback.durationMs ?? 0;
    const discoveryCostMs = primaryDurationMs + (state.fallback.used ? fallbackDurationMs : 0);
    const inputErrorCostMs = ["FAILED", "REJECTED"].includes(state.preflight?.status)
        ? state.preflight.durationMs
        : 0;
    const diagnostics = {
        input_error_cost_ms: inputErrorCostMs,
        preflight_cost_ms: state.preflight?.durationMs ?? 0,
        discovery_cost_ms: discoveryCostMs,
        preflight: state.preflight ?? null,
        discovery: {
            primary_duration_ms: primaryDurationMs,
            fallback_duration_ms: state.fallback.used ? fallbackDurationMs : 0,
            total_duration_ms: discoveryCostMs,
            attempts: 1 + fallbackCount,
        },
    };
    return {
        protocolVersion: PROTOCOL_VERSION,
        runId: state.runId,
        logical_input_hash: state.logical_input_hash,
        rerun_of: state.rerun_of ?? null,
        preflight: state.preflight ?? null,
        failure_class: state.failure_class ?? null,
        snapshot_changed: state.snapshot_changed ?? false,
        report_written: state.report_written ?? false,
        budget: state.budget ?? null,
        minimum_file_budget: state.budget?.minimum_file_budget ?? null,
        verification_margin: state.budget?.verification_margin ?? null,
        effective_file_budget: state.budget?.effective_file_budget ?? null,
        hard_file_budget: state.budget?.hard_file_budget ?? null,
        diagnostics,
        primaryAgent: PRIMARY_AGENT,
        fallbackAgent: FALLBACK_AGENT,
        fast_first_pass: primaryValid,
        fallback_count: fallbackCount,
        hybrid_final: primaryValid || fallbackValid,
        primary: attemptMetadata(state.primary, "primary", primaryValid),
        fallback: {
            used: state.fallback.used,
            ...attemptMetadata(state.fallback, "fallback", fallbackValid),
        },
        final: {
            agent: finalAttempt.agent,
            valid: primaryValid || fallbackValid,
            status: finalAttempt.validation?.status ?? "INCOMPLETE",
            failure_class: finalAttempt.failure_class ?? null,
            next_action: nextActionForFailureClass(finalAttempt.failure_class, finalAttempt === state.primary ? "primary" : "fallback"),
            reportPath: primaryValid || fallbackValid ? finalAttempt.reportPath : null,
            partialReportPath: partialAttempt?.partialReportPath ?? null,
        },
        dispatch_audit: {
            primary: state.primary.dispatchAudit ?? null,
            fallback: state.fallback.dispatchAudit ?? null,
        },
    };
}

export function finalizeHybrid(args) {
    const statePath = path.resolve(required(args, "state"));
    const runId = required(args, "run-id");
    const state = readJson(statePath);
    assertRun(state, runId, statePath);
    if (!["PRIMARY_ACCEPTED", "PRIMARY_FAILED", "FALLBACK_ACCEPTED", "FALLBACK_FAILED"].includes(state.phase)) {
        throw new Error(`Cannot finalize while phase is ${state.phase}`);
    }
    const metadata = finalMetadata(state);
    const metadataPath = path.join(state.outputDir, `${state.artifactPrefix}.meta.json`);
    writeJson(metadataPath, metadata);
    state.phase = "FINALIZED";
    state.finalizedAt = new Date().toISOString();
    state.metadataPath = metadataPath;
    writeJson(statePath, state);
    return {...metadata, statePath, metadataPath};
}

export function abortHybrid(args) {
    const statePath = path.resolve(required(args, "state"));
    const runId = required(args, "run-id");
    const state = readJson(statePath);
    if (state.runId !== runId) { throw new Error("Hybrid run-id does not match state"); }
    if (state.phase === "FINALIZED") { throw new Error("Cannot abort a finalized hybrid run"); }
    if (state.phase === "ABORTED") { return {protocolVersion: PROTOCOL_VERSION, runId, statePath, phase: state.phase}; }
    state.phase = "ABORTED";
    state.abortedAt = new Date().toISOString();
    writeJson(statePath, state);
    return {protocolVersion: PROTOCOL_VERSION, runId, statePath, phase: state.phase};
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));
    const command = args._?.[0];
    if (!command || args.help || !["prepare", "claim", "evaluate", "settle", "finalize", "abort"].includes(command)) {
        process.stdout.write(usage());
        process.exit(args.help ? 0 : 2);
    }
    try {
        let result;
        if (command === "prepare") { result = prepareHybrid(args); }
        else if (command === "claim") { result = claimAttempt(args); }
        else if (command === "evaluate") { result = evaluateAttempt(args); }
        else if (command === "settle") { result = settleAttempt(args); }
        else if (command === "finalize") { result = finalizeHybrid(args); }
        else { result = abortHybrid(args); }
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (command === "finalize" && result.hybrid_final === false) { process.exitCode = 1; }
        if (command === "settle" && result.finalized === null && result.evaluate?.next?.action === "CLAIM_FALLBACK") { process.exitCode = 3; }
    } catch (error) {
        process.stderr.write(`${JSON.stringify(errorEnvelope(error, args.debug === true || args.debug === "true"))}\n`);
        process.exit(2);
    }
}
