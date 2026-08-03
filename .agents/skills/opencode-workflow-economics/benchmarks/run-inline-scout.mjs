#!/usr/bin/env node
import {createWriteStream, existsSync} from "node:fs";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const VALIDATOR = join(REPO_ROOT, ".agents/skills/_shared/scripts/context-scout-report.mjs");

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.concurrency > 2) { throw new Error("--concurrency cannot exceed 2"); }
    await mkdir(options.outputDir, {recursive: true});
    const manifest = JSON.parse(await readFile(join(options.fixtureRoot, "manifest.json"), "utf8"));
    if (options.snapshotDir) { options.repoDir = options.snapshotDir; }
    const jobs = options.variants.flatMap((variant) => Array.from({length: options.repetitions}, (_, index) => ({variant, repetition: index + 1, manifest})));
    const results = await runPool(jobs, options);
    const summary = {arm: "inline", repetitions: options.repetitions, concurrency: options.concurrency, variants: options.variants, repo_dir: options.repoDir, results};
    await writeFile(join(options.outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {mode: 0o600});
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (results.some((result) => result.exit_code !== 0 || !result.valid || result.delegation_tools > 0)) { process.exitCode = 1; }
}

async function runPool(jobs, options) {
    const results = [];
    let cursor = 0;
    async function worker() {
        while (cursor < jobs.length) { results.push(await runJob(jobs[cursor++], options)); }
    }
    await Promise.all(Array.from({length: Math.min(options.concurrency, jobs.length)}, worker));
    return results.sort((a, b) => a.variant.localeCompare(b.variant) || a.repetition - b.repetition);
}

async function runJob(job, options) {
    const name = `inline-${job.variant}-${job.repetition}`;
    const outputDir = join(options.outputDir, name);
    const fixtureDir = join(options.fixtureRoot, `test-${job.variant}`);
    await mkdir(outputDir, {recursive: true});
    const reportPath = join(outputDir, "report.json");
    const eventsPath = join(outputDir, "events.jsonl");
    const logPath = join(outputDir, "stderr.log");
    const prompt = buildInlinePrompt({
        promptPath: join(fixtureDir, "prompt.txt"),
        manifestPath: join(options.fixtureRoot, "manifest.json"),
        handoffPath: join(fixtureDir, "handoff.json"),
        criteriaPath: join(fixtureDir, "criteria.json"),
        reportPath,
    });
    const started = Date.now();
    const exitCode = await runProcess(options.opencode, ["run", "--pure", "--agent", "build", "--format", "json", "--title", name, "--dir", options.repoDir, prompt], eventsPath, logPath, options.repoDir);
    const durationMs = Date.now() - started;
    const events = await readEvents(eventsPath);
    const validation = await validateReport(reportPath, job.manifest.head, join(fixtureDir, "criteria.json"), options.repoDir);
    const report = existsSync(reportPath) ? JSON.parse(await readFile(reportPath, "utf8")) : null;
    const valid = isInlineValid(validation, report);
    const sessionIds = [...new Set(events.map((event) => event.sessionID ?? event.session_id).filter(Boolean))].sort();
    return {variant: job.variant, repetition: job.repetition, name, exit_code: exitCode, duration_ms: durationMs, report_status: report?.status ?? null, valid, validation_reason: validation.reason, delegation_tools: events.filter((event) => event.part?.type === "tool" && event.part.tool === "task").length, tool_events: events.filter((event) => event.part?.type === "tool").length, session_ids: sessionIds, session_id: sessionIds[0] ?? null, report_path: reportPath};
}

export function buildInlinePrompt({promptPath, manifestPath, handoffPath, criteriaPath, reportPath}) {
    return [
        "You are the main agent performing one bounded inline repository-context scout task.",
        "This is the inline arm of an equivalence experiment; execute the same task envelope as a canonical child without delegation.",
        "Do not call task, delegate to any subagent, invoke context-scout-hybrid-run.mjs, implement changes, or run QA.",
        "Before discovery, read and follow ./.agents/skills/_shared/references/repository-context-scout-playbook.md.",
        "Read these exact immutable inputs:",
        `- original prompt: ${promptPath}`,
        `- context manifest: ${manifestPath}`,
        `- handoff: ${handoffPath}`,
        `- acceptance criteria: ${criteriaPath}`,
        "Use the report-builder and the repository context contract.",
        "Use at most 10 relevant files, 5 symbols, and 3 tests/commands; stop after one discovery pass and one direct verification pass once criteria are covered.",
        "Every finding must declare claim_type, confidence, literal anchors, and evidence ranges no longer than 80 lines.",
        "Treat every required_evidence entry as a hard gate and do not make negative claims in COMPLETE.",
        "Initialize the ledger exactly once. Build the complete report in memory and use one batch-render operation; do not use add-evidence, add-finding, set-coverage, check, or separate render operations.",
        `Use one final batch-render command and write the validated report exactly to ${reportPath}.`,
        "Read-only; do not modify source. Return only a compact acknowledgement after writing the report.",
    ].join("\n");
}

function runProcess(command, args, eventsPath, logPath, cwd) {
    return new Promise((resolveProcess) => {
        const child = spawn(command, args, {cwd, stdio: ["ignore", "pipe", "pipe"]});
        const events = createWriteStream(eventsPath, {mode: 0o600});
        const logs = createWriteStream(logPath, {mode: 0o600});
        child.stdout.pipe(events);
        child.stderr.pipe(logs);
        child.on("close", (code) => { events.close(); logs.close(); resolveProcess(code ?? 1); });
        child.on("error", () => resolveProcess(1));
    });
}

async function readEvents(path) {
    if (!existsSync(path)) { return []; }
    return (await readFile(path, "utf8")).split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
    });
}

async function validateReport(reportPath, head, criteriaPath, cwd) {
    if (!existsSync(reportPath)) { return {valid: false, reason: "missing_report"}; }
    return new Promise((done) => {
        const child = spawn(process.execPath, [VALIDATOR, "validate", reportPath, "--head", head, "--criteria", criteriaPath], {cwd, stdio: ["ignore", "pipe", "pipe"]});
        let output = "";
        child.stdout.on("data", (data) => { output += data; });
        child.stderr.on("data", (data) => { output += data; });
        child.on("close", (code) => done({valid: code === 0, reason: output.trim().split("\n").pop() ?? ""}));
        child.on("error", (error) => done({valid: false, reason: error.message}));
    });
}

export function isInlineValid(validation, report) {
    return Boolean(validation?.valid) && report?.status === "COMPLETE";
}

function parseArgs(args) {
    const options = {fixtureRoot: "/tmp/opencode/context-scout-live", outputDir: join(REPO_ROOT, ".owe/benchmarks/inline-scout"), repoDir: REPO_ROOT, snapshotDir: null, opencode: process.env.OPENCODE_BIN ?? "opencode", repetitions: 5, concurrency: 2, variants: ["a", "b", "c"]};
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index];
        const value = args[index + 1];
        if (key === "--fixture-root") { options.fixtureRoot = resolve(value); }
        else if (key === "--output-dir") { options.outputDir = resolve(value); }
        else if (key === "--repo-dir") { options.repoDir = resolve(value); }
        else if (key === "--snapshot-dir") { options.snapshotDir = resolve(value); }
        else if (key === "--opencode") { options.opencode = value; }
        else if (key === "--repetitions") { options.repetitions = Number(value); }
        else if (key === "--concurrency") { options.concurrency = Number(value); }
        else if (key === "--variants") { options.variants = value.split(",").map((item) => item.trim()).filter(Boolean); }
        else { throw new Error(`Unknown argument: ${key}`); }
    }
    if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1) { throw new Error("--repetitions must be positive"); }
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) { throw new Error("--concurrency must be positive"); }
    if (options.variants.length === 0 || options.variants.some((variant) => !/^[a-z0-9_-]+$/i.test(variant))) { throw new Error("--variants must contain simple comma-separated names"); }
    if (options.snapshotDir && !existsSync(options.snapshotDir)) { throw new Error(`Snapshot directory does not exist: ${options.snapshotDir}`); }
    return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
