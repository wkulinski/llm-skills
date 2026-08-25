#!/usr/bin/env node
import crypto from "node:crypto";
import {createWriteStream, existsSync, readFileSync} from "node:fs";
import {mkdir, readFile, writeFile, copyFile} from "node:fs/promises";
import {spawn, spawnSync} from "node:child_process";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

import {
    claimAttempt,
    HYBRID_PROTOCOL_VERSION,
    prepareHybrid,
    settleAttempt,
} from "../../../skills/_shared/scripts/context-scout-hybrid-run.mjs";
import {assertArtifactPath} from "../../../skills/_shared/scripts/artifact-path.mjs";
import {validateContextManifest} from "../../../skills/_shared/scripts/context-manifest.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const INLINE_RUNNER = join(REPO_ROOT, ".agents/skills/opencode-workflow-economics/benchmarks/run-inline-scout.mjs");
const HARNESS_CLASS = "canonical-equivalence-smoke";

function usage() {
    return "Usage: node run-context-scout-equivalence-smoke.mjs --output-dir <new-dir> [--fixture-root <dir>] [--repo-dir <dir>] [--opencode <cmd>] [--variants a,b,c] [--repetitions 1]\n";
}

export function parseArgs(args) {
    if (args.includes("--help") || args.includes("-h")) { return {help: true}; }
    const options = {
        fixtureRoot: join(REPO_ROOT, "docs/benchmark/fixtures/context-scout-live"),
        outputDir: null,
        repoDir: REPO_ROOT,
        opencode: process.env.OPENCODE_BIN ?? "opencode",
        variants: ["a", "b", "c"],
        repetitions: 1,
    };
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (key === "--fixture-root") { options.fixtureRoot = resolve(value); }
        else if (key === "--output-dir") { options.outputDir = resolve(value); }
        else if (key === "--repo-dir") { options.repoDir = resolve(value); }
        else if (key === "--opencode") { options.opencode = value; }
        else if (key === "--variants") { options.variants = value.split(",").map((item) => item.trim()).filter(Boolean); }
        else if (key === "--repetitions") { options.repetitions = Number(value); }
        else { throw new Error(`Unknown argument: ${key}`); }
    }
    if (!options.outputDir) { throw new Error("--output-dir is required; use a new directory under var/agent/cache or the system temporary directory"); }
    assertArtifactPath(options.outputDir, "benchmark output directory", options.repoDir);
    if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1) { throw new Error("--repetitions must be positive"); }
    if (options.variants.length === 0 || options.variants.some((variant) => !/^[a-z0-9_-]+$/i.test(variant))) { throw new Error("--variants must contain simple comma-separated names"); }
    if (existsSync(options.outputDir)) { throw new Error(`Output directory already exists: ${options.outputDir}`); }
    return options;
}

function gitValue(repoDir, args) {
    const result = spawnSync("git", args, {cwd: repoDir, encoding: "utf8"});
    return result.status === 0 ? result.stdout.trim() : "";
}

function gitMetadata(repoDir) {
    return {
        repository: gitValue(repoDir, ["config", "--get", "remote.origin.url"]).replace(/^git@[^:]+:/, "").replace(/\.git$/, ""),
        branch: gitValue(repoDir, ["branch", "--show-current"]) || "detached",
        head: gitValue(repoDir, ["rev-parse", "HEAD"]),
    };
}

function hashFile(filePath) {
    return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function workspaceHash(repoDir) {
    const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {cwd: repoDir, encoding: "buffer"});
    if (listed.status !== 0) { throw new Error("git ls-files failed"); }
    const files = listed.stdout.toString("utf8").split("\0").filter((item) => item && !item.startsWith("var/") && !item.startsWith(".git/"));
    const hash = crypto.createHash("sha256");
    for (const relativePath of files.sort()) {
        const absolutePath = join(repoDir, relativePath);
        if (!existsSync(absolutePath)) { continue; }
        hash.update(relativePath).update("\0").update(readFileSync(absolutePath)).update("\0");
    }
    return {file_count: files.length, sha256: hash.digest("hex")};
}

async function createInputs(options) {
    const inputRoot = join(options.outputDir, "inputs");
    await mkdir(inputRoot, {recursive: true});
    const metadata = gitMetadata(options.repoDir);
    const sourceManifest = JSON.parse(await readFile(join(options.fixtureRoot, "manifest.json"), "utf8"));
    const manifest = {
        ...sourceManifest,
        repository: metadata.repository || sourceManifest.repository,
        branch: metadata.branch,
        head: metadata.head,
        generated_at: new Date().toISOString(),
    };
    const validation = validateContextManifest(manifest);
    if (!validation.valid) { throw new Error(`Generated manifest invalid: ${validation.errors.join("; ")}`); }
    const manifestPath = join(inputRoot, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o600});
    for (const variant of options.variants) {
        const source = join(options.fixtureRoot, `test-${variant}`);
        const target = join(inputRoot, `test-${variant}`);
        await mkdir(target, {recursive: true});
        for (const name of ["prompt.txt", "handoff.json", "criteria.json"]) {
            await copyFile(join(source, name), join(target, name));
        }
    }
    return {inputRoot, manifestPath, metadata};
}

function runProcess(command, args, outputDir, cwd) {
    return new Promise((resolveProcess) => {
        const eventsPath = join(outputDir, "events.jsonl");
        const logPath = join(outputDir, "stderr.log");
        const child = spawn(command, args, {cwd, stdio: ["ignore", "pipe", "pipe"]});
        const events = requireWriteStream(eventsPath);
        const logs = requireWriteStream(logPath);
        child.stdout.pipe(events);
        child.stderr.pipe(logs);
        child.on("close", (code) => { events.close(); logs.close(); resolveProcess({code: code ?? 1, eventsPath, logPath}); });
        child.on("error", (error) => resolveProcess({code: 1, eventsPath, logPath, error: error.message}));
    });
}

function requireWriteStream(filePath) {
    return createWriteStream(filePath, {mode: 0o600});
}

function parseEvents(raw) {
    const events = String(raw).split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
    });
    const sessionIds = [...new Set(events.map((event) => event.sessionID ?? event.session_id).filter(Boolean))].sort();
    const toolNames = events.map((event) => event?.part?.tool ?? event?.tool ?? event?.tool_name).filter(Boolean);
    return {
        session_ids: sessionIds,
        tool_events: toolNames.length,
        task_tools: toolNames.filter((name) => name === "task").length,
        tool_names: [...new Set(toolNames)].sort(),
    };
}

async function controllerRun(options, dispatch, outputDir, title, attempt) {
    const prompt = [
        "You are only a benchmark controller for one canonical repository-context attempt.",
        "Do not perform discovery, read source files, call the hybrid helper, edit files, or run QA yourself.",
        `Use exactly one native task call with subagent_type ${JSON.stringify(dispatch.subagent_type)} and description ${JSON.stringify(dispatch.description)}.`,
        "Pass the exact task prompt below verbatim; do not summarize, wrap, or replace it.",
        "After the child task returns, respond with a compact acknowledgement only.",
        "BEGIN EXACT TASK PROMPT",
        dispatch.prompt,
        "END EXACT TASK PROMPT",
    ].join("\n");
    const runDir = join(outputDir, attempt);
    await mkdir(runDir, {recursive: true});
    const started = Date.now();
    const process = await runProcess(options.opencode, ["run", "--pure", "--agent", "build", "--format", "json", "--title", title, "--dir", options.repoDir, prompt], runDir, options.repoDir);
    const events = parseEvents(await readFile(process.eventsPath, "utf8"));
    return {...process, duration_ms: Date.now() - started, ...events};
}

async function runCanonicalJob(options, inputs, variant, repetition) {
    const outputDir = join(options.outputDir, `hybrid-${variant}-${repetition}`);
    await mkdir(outputDir, {recursive: true});
    const fixtureDir = join(inputs.inputRoot, `test-${variant}`);
    let prepared = null;
    const attempts = [];
    try {
        prepared = prepareHybrid({
            "prompt-file": join(fixtureDir, "prompt.txt"),
            manifest: inputs.manifestPath,
            handoff: join(fixtureDir, "handoff.json"),
            criteria: join(fixtureDir, "criteria.json"),
            "output-dir": outputDir,
            title: `canonical-${variant}-${repetition}`,
        }, options.repoDir);
        let claim = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
        let run = await controllerRun(options, claim.dispatch, outputDir, `canonical-${variant}-${repetition}-primary`, "primary");
        const primaryOutputObserved = existsSync(claim.reportPath) || existsSync(claim.ledgerPath);
        let settlement = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: claim.dispatchToken, "duration-ms": run.duration_ms, ack: {session_ids: run.session_ids, task_tools: run.task_tools, tool_events: run.tool_events, output_observed: primaryOutputObserved}});
        attempts.push({attempt: "primary", run, evaluation: settlement.evaluate, output_observed: primaryOutputObserved});
        if (settlement.evaluate.next.action === "CLAIM_FALLBACK") {
            claim = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback"});
            run = await controllerRun(options, claim.dispatch, outputDir, `canonical-${variant}-${repetition}-fallback`, "fallback");
            settlement = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: claim.dispatchToken, "duration-ms": run.duration_ms, ack: {session_ids: run.session_ids, task_tools: run.task_tools, tool_events: run.tool_events, output_observed: existsSync(claim.reportPath) || existsSync(claim.ledgerPath)}});
            attempts.push({attempt: "fallback", run, evaluation: settlement.evaluate, output_observed: existsSync(claim.reportPath) || existsSync(claim.ledgerPath)});
        }
        const final = settlement.finalized;
        if (!final) { throw new Error("Canonical settlement did not finalize the run"); }
        return {
            variant,
            repetition,
            attempts,
            primary_output_observed: attempts.find((item) => item.attempt === "primary")?.output_observed === true,
            primary_failure_class: attempts.find((item) => item.attempt === "primary")?.output_observed === true ? null : "PRIMARY_OUTPUT_MISSING",
            final,
            valid: final.hybrid_final,
            session_ids: attempts.flatMap((item) => item.run.session_ids),
        };
    } catch (error) {
        if (prepared) {
            const abort = spawnSync(process.execPath, [join(REPO_ROOT, ".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs"), "abort", "--state", prepared.statePath, "--run-id", prepared.runId], {cwd: options.repoDir, encoding: "utf8"});
            if (abort.status !== 0) { process.stderr.write(abort.stderr ?? ""); }
        }
        throw error;
    }
}

async function runInline(options, inputs) {
    const outputDir = join(options.outputDir, "inline");
    const result = spawnSync(process.execPath, [
        INLINE_RUNNER,
        "--fixture-root", inputs.inputRoot,
        "--output-dir", outputDir,
        "--repo-dir", options.repoDir,
        "--opencode", options.opencode,
        "--repetitions", String(options.repetitions),
        "--variants", options.variants.join(","),
        "--concurrency", "1",
    ], {cwd: options.repoDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"]});
    if (result.status !== 0 && !existsSync(join(outputDir, "summary.json"))) {
        throw new Error(`Inline runner failed: ${result.stderr || result.stdout}`);
    }
    return JSON.parse(await readFile(join(outputDir, "summary.json"), "utf8"));
}

function equivalentCriteria(criteriaPath, hybridReport, inlineReport, hybridValid, inlineValid) {
    const criteria = JSON.parse(readFileSync(criteriaPath, "utf8")).criteria.map((entry) => entry.id).sort();
    const covered = (report) => (report?.coverage ?? []).filter((entry) => entry.status === "covered").map((entry) => entry.criterion_id).sort();
    const hybridCovered = covered(hybridReport);
    const inlineCovered = covered(inlineReport);
    return {
        criteria,
        hybrid_covered: hybridCovered,
        inline_covered: inlineCovered,
        complete: hybridValid && inlineValid && hybridCovered.join("\0") === criteria.join("\0") && inlineCovered.join("\0") === criteria.join("\0"),
        criteria_interchangeable: hybridValid && inlineValid && hybridCovered.join("\0") === inlineCovered.join("\0"),
    };
}

export async function runSmoke(options) {
    const before = workspaceHash(options.repoDir);
    const inputs = await createInputs(options);
    const inputHashes = {
        manifest: hashFile(inputs.manifestPath),
        variants: Object.fromEntries(options.variants.map((variant) => {
            const fixtureDir = join(inputs.inputRoot, `test-${variant}`);
            return [variant, Object.fromEntries(["prompt.txt", "handoff.json", "criteria.json"].map((name) => [name, hashFile(join(fixtureDir, name))]))];
        })),
    };
    const hybrid = [];
    for (const variant of options.variants) {
        for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
            hybrid.push(await runCanonicalJob(options, inputs, variant, repetition));
        }
    }
    const inline = await runInline(options, inputs);
    const comparisons = [];
    for (const result of hybrid) {
        const inlineResult = inline.results.find((item) => item.variant === result.variant && item.repetition === result.repetition);
        const hybridReportPath = result.final.final.reportPath;
        const inlineReportPath = inlineResult?.report_path;
        const hybridReport = hybridReportPath && existsSync(hybridReportPath) ? JSON.parse(readFileSync(hybridReportPath, "utf8")) : null;
        const inlineReport = inlineReportPath && existsSync(inlineReportPath) ? JSON.parse(readFileSync(inlineReportPath, "utf8")) : null;
        comparisons.push({
            variant: result.variant,
            repetition: result.repetition,
            hybrid_valid: result.valid,
            inline_valid: Boolean(inlineResult?.valid),
            hybrid_duration_ms: result.attempts.reduce((total, item) => total + item.run.duration_ms, 0),
            inline_duration_ms: inlineResult?.duration_ms ?? null,
            hybrid_fallback_used: result.attempts.some((item) => item.attempt === "fallback"),
            hybrid_session_ids: result.session_ids,
            inline_session_ids: inlineResult?.session_ids ?? [],
            semantic_gate: equivalentCriteria(join(inputs.inputRoot, `test-${result.variant}`, "criteria.json"), hybridReport, inlineReport, result.valid, Boolean(inlineResult?.valid)),
        });
    }
    const after = workspaceHash(options.repoDir);
    const summary = {
        harness_class: HARNESS_CLASS,
        protocol_version: HYBRID_PROTOCOL_VERSION,
        source: inputs.metadata,
        workspace_snapshot: {before, after, unchanged: before.sha256 === after.sha256 && before.file_count === after.file_count},
        inputs: {root: inputs.inputRoot, hashes: inputHashes},
        hybrid,
        dispatch_audit: hybrid.map((item) => ({
            variant: item.variant,
            repetition: item.repetition,
            run_id: item.final.runId,
            primary_agent: item.final.primaryAgent,
            fallback_agent: item.final.fallbackAgent,
            fast_first_pass: item.final.fast_first_pass,
            attempts: item.attempts.map((attempt) => ({
                attempt: attempt.attempt,
                task_tools: attempt.run.task_tools,
                session_ids: attempt.run.session_ids,
                output_observed: attempt.output_observed,
            })),
        })),
        inline,
        comparisons,
        gates: {
            workspace_unchanged: before.sha256 === after.sha256 && before.file_count === after.file_count,
            all_primary_observed: hybrid.every((item) => item.primary_output_observed),
            all_hybrid_valid: hybrid.every((item) => item.valid),
            all_inline_valid: inline.results.every((item) => item.valid),
            criteria_equivalence: comparisons.every((item) => item.semantic_gate.complete && item.semantic_gate.criteria_interchangeable),
            passed: before.sha256 === after.sha256 && before.file_count === after.file_count && hybrid.every((item) => item.primary_output_observed) && hybrid.every((item) => item.valid) && inline.results.every((item) => item.valid) && comparisons.every((item) => item.semantic_gate.complete && item.semantic_gate.criteria_interchangeable),
        },
    };
    await writeFile(join(options.outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {mode: 0o600});
    return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
        process.stdout.write(usage());
        process.exit(0);
    }
    runSmoke(parsed).then((summary) => {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        if (!summary.gates.passed) { process.exitCode = 1; }
    }).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
        process.exitCode = 1;
    });
}
