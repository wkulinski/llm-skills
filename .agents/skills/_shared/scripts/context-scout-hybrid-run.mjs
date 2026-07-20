#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readCriteriaFile} from "./context-criteria.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.join(SCRIPT_DIR, "context-scout-report.mjs");
const MANIFEST_TOOL = path.join(SCRIPT_DIR, "context-manifest.mjs");
const HANDOFF_TOOL = path.join(SCRIPT_DIR, "context-handoff.mjs");
const PROTOCOL_VERSION = 2;
const PRIMARY_AGENT = "context-scout-fast";
const FALLBACK_AGENT = "context-scout";
const DEFAULT_LOCK_TIMEOUT_MS = 7_200_000;

function usage() {
    return `Usage:
  node context-scout-hybrid-run.mjs prepare \\
    --prompt-file <file> --manifest <file> --handoff <file> --criteria <file> \\
    [--output-dir <dir>] [--title <name>] [--lock-file <file>] [--lock-timeout-ms <ms>]
  node context-scout-hybrid-run.mjs evaluate \\
    --state <file> --run-id <id> --attempt primary|fallback [--duration-ms <ms>]
  node context-scout-hybrid-run.mjs finalize --state <file> --run-id <id>
  node context-scout-hybrid-run.mjs abort --state <file> --run-id <id>

The helper never starts OpenCode or any agent. The main agent delegates the
returned task prompt through the native task tool, then calls evaluate/finalize.
`;
}

export function parseArgs(argv) {
    const args = {};
    for (let index = 0; index < argv.length; index += 1) {
        const item = argv[index];
        if (!item.startsWith("--")) {
            if (!args._) args._ = [];
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

function resolveExisting(cwd, value, label) {
    const resolved = path.resolve(cwd, value);
    if (!fs.existsSync(resolved)) throw new Error(`${label} does not exist: ${resolved}`);
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

function lockAgeMs(lockPath, lock) {
    const createdAt = Date.parse(lock?.createdAt ?? "");
    if (Number.isFinite(createdAt)) return Date.now() - createdAt;
    return Date.now() - fs.statSync(lockPath).mtimeMs;
}

function acquireLock(lockPath, lock, timeoutMs) {
    fs.mkdirSync(path.dirname(lockPath), {recursive: true});
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const fd = fs.openSync(lockPath, "wx");
            try {
                fs.writeFileSync(fd, `${JSON.stringify(lock, null, 2)}\n`);
            } finally {
                fs.closeSync(fd);
            }
            return;
        } catch (error) {
            if (error.code !== "EEXIST") throw error;
            let current = null;
            try { current = readJson(lockPath); } catch { /* The age check below handles malformed locks. */ }
            if (lockAgeMs(lockPath, current) <= timeoutMs) {
                throw new Error(`Repository-context hybrid already active: ${lockPath}`);
            }
            fs.unlinkSync(lockPath);
        }
    }
    throw new Error(`Unable to acquire repository-context hybrid lock: ${lockPath}`);
}

function assertLock(state) {
    if (!fs.existsSync(state.lockPath)) throw new Error("Repository-context hybrid lock is missing");
    const lock = readJson(state.lockPath);
    if (lock.runId !== state.runId) throw new Error("Repository-context hybrid lock belongs to another run");
}

function releaseLock(state) {
    assertLock(state);
    fs.unlinkSync(state.lockPath);
}

function assertRun(state, runId) {
    if (state.protocolVersion !== PROTOCOL_VERSION) throw new Error("Unsupported hybrid protocol version");
    if (state.runId !== runId) throw new Error("Hybrid run-id does not match state");
    assertLock(state);
    assertInputsUnchanged(state);
}

function buildTaskPrompt({agent, inputs, reportPath}) {
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
        `Write the final report JSON to exactly: ${reportPath}`,
        "Then return the exact same report JSON as your only response. Do not include or inspect another attempt's output.",
    ].join("\n");
}

export function validateReport({reportPath, manifestHead, criteriaPath, expectedMode, cwd}) {
    if (!reportPath || !fs.existsSync(reportPath)) {
        return {valid: false, schemaValid: false, status: null, reason: "missing_report"};
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
    if (!manifest.head) throw new Error("Manifest does not contain head");

    const outputDir = path.resolve(cwd, args["output-dir"] ?? "var/agent/cache/context-scout-hybrid");
    const title = safeName(args.title ?? "context-scout-hybrid");
    const lockPath = path.resolve(cwd, args["lock-file"] ?? "var/agent/cache/context-scout-hybrid.lock");
    const lockTimeoutMs = Number(args["lock-timeout-ms"] ?? DEFAULT_LOCK_TIMEOUT_MS);
    if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs <= 0) throw new Error("Invalid --lock-timeout-ms");
    fs.mkdirSync(outputDir, {recursive: true});

    const runId = crypto.randomUUID();
    const artifactPrefix = `${title}-${runId}`;
    const statePath = path.join(outputDir, `${artifactPrefix}.state.json`);
    const primaryReportPath = path.join(outputDir, `${artifactPrefix}-primary.report.json`);
    const fallbackReportPath = path.join(outputDir, `${artifactPrefix}-fallback.report.json`);
    acquireLock(lockPath, {protocolVersion: PROTOCOL_VERSION, runId, title, outputDir, createdAt: new Date().toISOString()}, lockTimeoutMs);

    const state = {
        protocolVersion: PROTOCOL_VERSION,
        runId,
        phase: "PRIMARY_PENDING",
        createdAt: new Date().toISOString(),
        cwd: path.resolve(cwd),
        title,
        artifactPrefix,
        outputDir,
        lockPath,
        inputs,
        inputHashes: inputHashes(inputs),
        manifestHead: manifest.head,
        mode: handoff.mode,
        primary: {agent: PRIMARY_AGENT, reportPath: primaryReportPath, evaluated: false, startedAtMs: Date.now()},
        fallback: {agent: FALLBACK_AGENT, reportPath: fallbackReportPath, used: false, evaluated: false},
    };
    try {
        writeJson(statePath, state);
    } catch (error) {
        if (fs.existsSync(lockPath)) {
            const lock = readJson(lockPath);
            if (lock.runId === runId) fs.unlinkSync(lockPath);
        }
        throw error;
    }
    return {
        protocolVersion: PROTOCOL_VERSION,
        runId,
        statePath,
        phase: state.phase,
        next: {
            action: "DELEGATE_PRIMARY",
            agent: PRIMARY_AGENT,
            reportPath: primaryReportPath,
            taskPrompt: buildTaskPrompt({agent: PRIMARY_AGENT, inputs, reportPath: primaryReportPath}),
        },
    };
}

function parseDuration(args, startedAtMs) {
    const duration = args["duration-ms"] === undefined ? Date.now() - startedAtMs : Number(args["duration-ms"]);
    if (!Number.isFinite(duration) || duration < 0) throw new Error("Invalid --duration-ms");
    return duration;
}

function discardReport(attemptState) {
    if (attemptState.reportPath && fs.existsSync(attemptState.reportPath)) fs.unlinkSync(attemptState.reportPath);
    return {...attemptState, reportDiscarded: true};
}

export function evaluateAttempt(args) {
    const statePath = path.resolve(required(args, "state"));
    const runId = required(args, "run-id");
    const attempt = required(args, "attempt");
    if (!["primary", "fallback"].includes(attempt)) throw new Error("--attempt must be primary or fallback");
    const state = readJson(statePath);
    assertRun(state, runId);
    const expectedPhase = attempt === "primary" ? "PRIMARY_PENDING" : "FALLBACK_PENDING";
    if (state.phase !== expectedPhase) throw new Error(`Cannot evaluate ${attempt} while phase is ${state.phase}`);

    const validation = validateReport({
        reportPath: state[attempt].reportPath,
        manifestHead: state.manifestHead,
        criteriaPath: state.inputs.criteria,
        expectedMode: state.mode,
        cwd: state.cwd,
    });
    const storedValidation = {valid: validation.valid, schemaValid: validation.schemaValid, status: validation.status};
    state[attempt] = {
        ...state[attempt],
        evaluated: true,
        durationMs: parseDuration(args, state[attempt].startedAtMs),
        validation: storedValidation,
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
            action: "DELEGATE_FALLBACK",
            agent: FALLBACK_AGENT,
            reportPath: state.fallback.reportPath,
            taskPrompt: buildTaskPrompt({agent: FALLBACK_AGENT, inputs: state.inputs, reportPath: state.fallback.reportPath}),
        };
    } else {
        if (!validation.valid) state.fallback = discardReport(state.fallback);
        state.phase = validation.valid ? "FALLBACK_ACCEPTED" : "FALLBACK_FAILED";
        next = {action: "FINALIZE"};
    }
    writeJson(statePath, state);
    return {protocolVersion: PROTOCOL_VERSION, runId, statePath, attempt, validation, phase: state.phase, next};
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
            reportPath: primaryValid ? state.primary.reportPath : null,
        },
        fallback: {
            used: state.fallback.used,
            valid: fallbackValid,
            status: state.fallback.validation?.status ?? null,
            durationMs: state.fallback.durationMs ?? null,
            reportPath: fallbackValid ? state.fallback.reportPath : null,
        },
        final: {
            agent: finalAttempt.agent,
            valid: primaryValid || fallbackValid,
            status: finalAttempt.validation?.status ?? "INCOMPLETE",
            reportPath: primaryValid || fallbackValid ? finalAttempt.reportPath : null,
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
    releaseLock(state);
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
    if (state.runId !== runId) throw new Error("Hybrid run-id does not match state");
    if (state.phase === "FINALIZED") throw new Error("Cannot abort a finalized hybrid run");
    if (state.phase === "ABORTED") return {protocolVersion: PROTOCOL_VERSION, runId, statePath, phase: state.phase};
    releaseLock(state);
    state.phase = "ABORTED";
    state.abortedAt = new Date().toISOString();
    writeJson(statePath, state);
    return {protocolVersion: PROTOCOL_VERSION, runId, statePath, phase: state.phase};
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));
    const command = args._?.[0];
    if (!command || args.help || !["prepare", "evaluate", "finalize", "abort"].includes(command)) {
        process.stdout.write(usage());
        process.exit(args.help ? 0 : 2);
    }
    try {
        const result = command === "prepare" ? prepareHybrid(args)
            : command === "evaluate" ? evaluateAttempt(args)
                : command === "finalize" ? finalizeHybrid(args)
                    : abortHybrid(args);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (command === "finalize" && result.hybrid_final === false) process.exitCode = 1;
    } catch (error) {
        process.stderr.write(`${error.stack || error}\n`);
        process.exit(2);
    }
}
