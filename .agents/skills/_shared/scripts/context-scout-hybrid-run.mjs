#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readCriteriaFile} from "./context-criteria.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const VALIDATOR = path.join(SCRIPT_DIR, "context-scout-report.mjs");
const REPORT_BUILDER = path.join(SCRIPT_DIR, "context-scout-report-builder.mjs");
const MANIFEST_TOOL = path.join(SCRIPT_DIR, "context-manifest.mjs");
const HANDOFF_TOOL = path.join(SCRIPT_DIR, "context-handoff.mjs");
const PROTOCOL_VERSION = 3;
const PRIMARY_AGENT = "context-scout-fast";
const FALLBACK_AGENT = "context-scout";

function usage() {
    return `Usage:
  node context-scout-hybrid-run.mjs prepare \\
    --prompt-file <file> --manifest <file> --handoff <file> --criteria <file> \\
    [--output-dir <dir>] [--title <name>]
  node context-scout-hybrid-run.mjs claim \\
     --state <file> --run-id <id> --attempt primary|fallback
  node context-scout-hybrid-run.mjs evaluate \\
    --state <file> --run-id <id> --attempt primary|fallback --token <dispatch-token> \\
    [--duration-ms <ms>] [--ack '<compact-json>']
  node context-scout-hybrid-run.mjs settle \\
     --state <file> --run-id <id> --attempt primary|fallback --token <dispatch-token>
  node context-scout-hybrid-run.mjs settle-batch   # JSON list on stdin
  node context-scout-hybrid-run.mjs finalize --state <file> --run-id <id>
  node context-scout-hybrid-run.mjs abort --state <file> --run-id <id>

The helper never starts OpenCode or any agent. prepare validates inputs and
creates artifacts; the main agent claims each attempt (idempotent dispatch guard)
to obtain a one-time token and the task prompt, delegates through the native task
tool, then evaluates. settle performs evaluate+finalize in one shot.
`;
}

function readStdinSync() {
    try {
        return fs.readFileSync(0, "utf8");
    } catch {
        return "";
    }
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
            throw new Error(`manifest ${command} failed: ${result.stderr?.trim() || result.stdout?.trim() || "unknown error"}`);
        }
    }
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

function assertInputsUnchanged(state) {
    for (const [key, expectedHash] of Object.entries(state.inputHashes)) {
        if (!fs.existsSync(state.inputs[key]) || hashFile(state.inputs[key]) !== expectedHash) {
            throw new Error(`Hybrid input changed after prepare: ${key}`);
        }
    }
}

function assertRun(state, runId) {
    if (state.protocolVersion !== PROTOCOL_VERSION) { throw new Error("Unsupported hybrid protocol version"); }
    if (state.runId !== runId) { throw new Error("Hybrid run-id does not match state"); }
    assertInputsUnchanged(state);
}

function buildTaskPrompt({agent, inputs, reportPath, ledgerPath, mode}) {
    const primary = agent === PRIMARY_AGENT;
    const finalizationDeadline = primary ? 24 : 22;
    const discoveryBudget = primary && mode === "targeted"
        ? "Use a bounded targeted discovery budget: at most 6 relevant files, 3 symbols, and 2 tests/commands; stop after one discovery pass and one direct verification pass once criteria are covered."
        : "Use a bounded discovery budget: at most 10 relevant files, 5 symbols, and 3 tests/commands; stop after one discovery pass and one direct verification pass once criteria are covered.";
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
        "Record read_coverage.covered for exact paths read and read_coverage.follow_up for at most 8 parent follow-ups with concrete reasons. When a covered path has a meaningful declared purpose, include purpose/source/read_mode from the shared read-purpose enum; these fields are context metadata, not freshness proof.",
        "Every finding must declare claim_type (observed, structural, inferred), confidence (high, medium, low), and anchors containing literal terms present in the cited evidence; never infer a field or behavior from a filename, symbol name, or analogy.",
        primary ? "Default to exactly one compact, parent-ready finding per criterion and keep the complete report near 1000 tokens. Add a second finding only when one criterion spans independent roles that cannot be supported honestly by one claim." : "",
        primary ? "Use at most three minimal evidence ranges per finding. When finding evidence already proves the criterion, keep coverage[].evidence empty instead of duplicating the same ranges; record actual reads only in read_coverage.covered." : "",
        primary ? "If the prompt or criterion names a concrete file, agent, symbol, test, configuration, route, or entrypoint, search for that exact name and directly read its defining source before accepting substitute references from tests or documentation. CMM silence cannot establish that an untracked file is absent." : "",
        "Treat every criteria[].required_evidence entry as a hard validator gate. Satisfy its exact path or path_prefix, optional relation, and all literal anchors with finding evidence for the same criterion; substitute documentation or tests do not satisfy a defining-source requirement. When forbid_negative_claims is true, avoid absolute absence or exclusivity claims in COMPLETE.",
        primary ? "A COMPLETE report must not claim that an artifact does not exist, is missing, is the only one, or that no test covers it. If a named target is not directly located, leave that criterion uncovered and return INCOMPLETE with the bounded statement that it was not located; never recommend creating an allegedly missing file unless the user explicitly requested it." : "",
        primary ? "Add risks, omitted paths, next_step, and read_coverage.follow_up only when they change the parent's decision. Never direct the parent to reread a path already present in read_coverage.covered." : "",
        primary ? "After input validation, initialize the ledger exactly once. Do not call add-evidence, add-finding, set-coverage, check, batch, or render separately. Build the complete report JSON with one finding per criterion in memory and send it directly to batch-render as the second and final builder operation." : "",
        "Keep every evidence range at or below 80 lines and use the smallest range that proves the claim.",
        `Before any optional enrichment, complete the minimum-report checkpoint: every criterion must have direct evidence and a valid covered status. Do not spend more than ${finalizationDeadline} steps on discovery and verification; reserve the remaining steps for batch-render and the compact acknowledgement. Optional enrichment must never delay batch-render.`,
        "Finalize with a single mandatory command once every criterion has minimal evidence. Replace <COMPLETE_REPORT_JSON> with the complete JSON object and run the opening command, payload, and closing marker as one bash call:",
        `node ./.agents/skills/_shared/scripts/context-scout-report-builder.mjs batch-render ${ledgerPath} --status COMPLETE --output ${reportPath} <<'REPORT_JSON'`,
        "<COMPLETE_REPORT_JSON>",
        "REPORT_JSON",
        "The builder reads the complete report JSON from this heredoc, validates it against the ledger, stores it, and renders the artifact in one step. Do not run batch-render with empty stdin. Do not create a separate input file or use cat, touch, printf, echo, process substitution, separate batch, or separate render.",
        `Write the full report artifact to exactly: ${reportPath}`,
        "After writing the report artifact, return ONLY a compact JSON acknowledgement (no other text):",
        '  {"status":"COMPLETE","report_path":"' + reportPath + '","findings_count":<n>,"covered_criteria":["C1"]}',
        "The helper remains authoritative, computes the report hash, and validates the report file; the acknowledgement is metadata only. Do not include or inspect another attempt's output.",
    ].filter(Boolean).join("\n");
}

function recoverReportFromLedger(state, attempt) {
    const attemptState = state[attempt];
    if (fs.existsSync(attemptState.reportPath) || !attemptState.ledgerPath || !fs.existsSync(attemptState.ledgerPath)) { return false; }
    const check = spawnSync(process.execPath, [REPORT_BUILDER, "check", attemptState.ledgerPath], {
        cwd: state.cwd,
        encoding: "utf8",
    });
    if (check.status !== 0) { return false; }
    const render = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "render",
        attemptState.ledgerPath,
        "--status",
        "COMPLETE",
        "--output",
        attemptState.reportPath,
    ], {cwd: state.cwd, encoding: "utf8"});
    return render.status === 0 && fs.existsSync(attemptState.reportPath);
}

export function validateReport({reportPath, manifestHead, criteriaPath, expectedMode, cwd}) {
    if (!reportPath || !fs.existsSync(reportPath)) {
        return {valid: false, schemaValid: false, status: null, reportSha256: undefined, reason: "missing_report"};
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
    let report;
    try { report = readJson(reportPath); } catch { report = null; }
    const schemaValid = result.status === 0;
    const modeMatches = report?.mode === expectedMode;
    const valid = schemaValid && report?.status === "COMPLETE" && modeMatches;
    return {
        valid,
        schemaValid,
        status: report?.status ?? null,
        reportSha256: hashFile(reportPath),
        stdout: result.stdout?.trim() || undefined,
        stderr: result.stderr?.trim() || undefined,
        reason: valid ? null : (!schemaValid ? "validator_failed" : (!modeMatches ? "mode_mismatch" : "status_not_complete")),
    };
}

export function prepareHybrid(args, cwd = process.cwd()) {
    const inputs = {
        prompt: resolveExisting(cwd, required(args, "prompt-file"), "prompt"),
        manifest: resolveExisting(cwd, required(args, "manifest"), "manifest"),
        handoff: resolveExisting(cwd, required(args, "handoff"), "handoff"),
        criteria: resolveExisting(cwd, required(args, "criteria"), "criteria"),
    };
    validateHandoff(inputs.handoff, cwd);
    validateManifest(inputs.manifest, cwd);
    const manifest = readJson(inputs.manifest);
    const handoff = readJson(inputs.handoff);
    readCriteriaFile(inputs.criteria);
    if (!manifest.head) { throw new Error("Manifest does not contain head"); }

    const outputDir = path.resolve(cwd, args["output-dir"] ?? "var/agent/cache/context-scout-hybrid");
    const title = safeName(args.title ?? "context-scout-hybrid");
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
        mode: handoff.mode,
        primary: {agent: PRIMARY_AGENT, reportPath: primaryReportPath, ledgerPath: primaryLedgerPath, claimed: false, dispatchToken: null, evaluated: false, startedAtMs: null},
        fallback: {agent: FALLBACK_AGENT, reportPath: fallbackReportPath, ledgerPath: fallbackLedgerPath, used: false, claimed: false, dispatchToken: null, evaluated: false},
    };
    writeJson(statePath, state);
    return {
        protocolVersion: PROTOCOL_VERSION,
        runId,
        statePath,
        phase: state.phase,
        next: {
            action: "CLAIM_PRIMARY",
            agent: PRIMARY_AGENT,
            reportPath: primaryReportPath,
            ledgerPath: primaryLedgerPath,
            claim: `node ${path.relative(state.cwd, SCRIPT_PATH)} claim --state ${statePath} --run-id ${runId} --attempt primary`,
        },
    };
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

export function claimAttempt(args) {
    const statePath = path.resolve(required(args, "state"));
    const runId = required(args, "run-id");
    const attempt = required(args, "attempt");
    if (!["primary", "fallback"].includes(attempt)) { throw new Error("--attempt must be primary or fallback"); }
    return withStateLock(statePath, () => {
        const state = readJson(statePath);
        assertRun(state, runId);
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
    assertRun(state, runId);
    const expectedPhase = attempt === "primary" ? "PRIMARY_RUNNING" : "FALLBACK_RUNNING";
    if (state.phase !== expectedPhase) {
        throw new Error(`Cannot evaluate ${attempt} while phase is ${state.phase} (expected ${expectedPhase})`);
    }
    if (state[attempt].dispatchToken !== token) {
        throw new Error(`evaluate requires the matching dispatch token for ${attempt}`);
    }

    recoverReportFromLedger(state, attempt);
    const validation = validateReport({
        reportPath: state[attempt].reportPath,
        manifestHead: state.manifestHead,
        criteriaPath: state.inputs.criteria,
        expectedMode: state.mode,
        cwd: state.cwd,
    });
    const storedValidation = {
        valid: validation.valid,
        schemaValid: validation.schemaValid,
        status: validation.status,
        reportSha256: validation.reportSha256,
    };

    let ack;
    if (args.ack !== undefined) {
        try {
            ack = typeof args.ack === "string" ? JSON.parse(args.ack) : args.ack;
        } catch {
            ack = {raw: String(args.ack)};
        }
    }

    state[attempt] = {
        ...state[attempt],
        evaluated: true,
        durationMs: parseDuration(args, state[attempt].startedAtMs),
        validation: storedValidation,
        reportSha256: validation.reportSha256,
        ...(ack !== undefined ? {ack} : {}),
        dispatchAudit: {
            ...(state[attempt].dispatchAudit ?? {runId, attempt, agent: state[attempt].agent}),
            evaluatedAtMs: Date.now(),
            ...(ack !== undefined ? {ack} : {}),
        },
    };

    let next;
    if (attempt === "primary" && validation.valid) {
        state.phase = "PRIMARY_ACCEPTED";
        next = {action: "FINALIZE"};
    } else if (attempt === "primary") {
        state.primary = discardReport(state.primary);
        state.phase = "FALLBACK_PENDING";
        state.fallback.used = true;
        state.fallback.startedAtMs = Date.now();
        next = {
            action: "CLAIM_FALLBACK",
            agent: FALLBACK_AGENT,
            reportPath: state.fallback.reportPath,
            ledgerPath: state.fallback.ledgerPath,
            claim: `node ${path.relative(state.cwd, SCRIPT_PATH)} claim --state ${statePath} --run-id ${runId} --attempt fallback`,
        };
    } else {
        if (!validation.valid) { state.fallback = discardReport(state.fallback); }
        state.phase = validation.valid ? "FALLBACK_ACCEPTED" : "FALLBACK_FAILED";
        next = {action: "FINALIZE"};
    }
    writeJson(statePath, state);
    return {protocolVersion: PROTOCOL_VERSION, runId, statePath, attempt, validation, phase: state.phase, next};
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

export function settleBatch(args, input = readStdinSync()) {
    let entries;
    try {
        entries = JSON.parse(input);
    } catch {
        throw new Error("settle-batch input must be a JSON array of {state, runId, attempt}");
    }
    if (!Array.isArray(entries)) {
        throw new Error("settle-batch input must be a JSON array of {state, runId, attempt}");
    }
    const results = entries.map((entry, index) => {
        try {
            const result = settleAttempt({
                state: entry.state,
                "run-id": entry.runId,
                attempt: entry.attempt,
                token: entry.token,
                ...(entry.durationMs !== undefined ? {"duration-ms": String(entry.durationMs)} : {}),
                ...(entry.ack !== undefined ? {ack: entry.ack} : {}),
            });
            return {index, state: entry.state, runId: entry.runId, attempt: entry.attempt, ok: true, result};
        } catch (error) {
            return {index, state: entry.state, runId: entry.runId, attempt: entry.attempt, ok: false, error: error instanceof Error ? error.message : String(error)};
        }
    });
    return {count: results.length, results};
}

function finalMetadata(state) {
    const primaryValid = state.primary.validation?.valid === true;
    const fallbackValid = state.fallback.validation?.valid === true;
    const fallbackCount = state.fallback.used ? 1 : 0;
    const finalAttempt = primaryValid ? state.primary : state.fallback;
    return {
        protocolVersion: PROTOCOL_VERSION,
        runId: state.runId,
        primaryAgent: PRIMARY_AGENT,
        fallbackAgent: FALLBACK_AGENT,
        fast_first_pass: primaryValid,
        fallback_count: fallbackCount,
        hybrid_final: primaryValid || fallbackValid,
        primary: {
            valid: primaryValid,
            status: state.primary.validation?.status ?? null,
            durationMs: state.primary.durationMs ?? null,
            reportSha256: state.primary.reportSha256 ?? null,
            reportPath: primaryValid ? state.primary.reportPath : null,
            reportDiscardedPath: state.primary.reportDiscardedPath ?? null,
        },
        fallback: {
            used: state.fallback.used,
            valid: fallbackValid,
            status: state.fallback.validation?.status ?? null,
            durationMs: state.fallback.durationMs ?? null,
            reportSha256: state.fallback.reportSha256 ?? null,
            reportPath: fallbackValid ? state.fallback.reportPath : null,
            reportDiscardedPath: state.fallback.reportDiscardedPath ?? null,
        },
        final: {
            agent: finalAttempt.agent,
            valid: primaryValid || fallbackValid,
            status: finalAttempt.validation?.status ?? "INCOMPLETE",
            reportPath: primaryValid || fallbackValid ? finalAttempt.reportPath : null,
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
    assertRun(state, runId);
    if (!["PRIMARY_ACCEPTED", "FALLBACK_ACCEPTED", "FALLBACK_FAILED"].includes(state.phase)) {
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
    if (!command || args.help || !["prepare", "claim", "evaluate", "settle", "settle-batch", "finalize", "abort"].includes(command)) {
        process.stdout.write(usage());
        process.exit(args.help ? 0 : 2);
    }
    try {
        let result;
        if (command === "prepare") { result = prepareHybrid(args); }
        else if (command === "claim") { result = claimAttempt(args); }
        else if (command === "evaluate") { result = evaluateAttempt(args); }
        else if (command === "settle") { result = settleAttempt(args); }
        else if (command === "settle-batch") { result = settleBatch(args); }
        else if (command === "finalize") { result = finalizeHybrid(args); }
        else { result = abortHybrid(args); }
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (command === "finalize" && result.hybrid_final === false) { process.exitCode = 1; }
        if (command === "settle" && result.finalized === null && result.evaluate?.next?.action === "CLAIM_FALLBACK") { process.exitCode = 3; }
    } catch (error) {
        process.stderr.write(`${error.stack || error}\n`);
        process.exit(2);
    }
}
