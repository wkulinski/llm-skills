#!/usr/bin/env node
import crypto from "node:crypto";
import {createWriteStream, existsSync} from "node:fs";
import {chmod, copyFile, lstat, mkdir, readdir, readFile, readlink, rename, symlink, writeFile} from "node:fs/promises";
import {spawn, spawnSync} from "node:child_process";
import {join, resolve} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const VALIDATOR = join(REPO_ROOT, ".agents/skills/_shared/scripts/context-scout-report.mjs");
const PRIMARY_BENCHMARK_AGENT = "context-scout-benchmark-primary";
const FALLBACK_BENCHMARK_AGENT = "context-scout-benchmark-fallback";
const HARNESS_CLASS = "model-isolation";
const PROTOCOL_VERSION = "legacy-model-isolation";
const BENCHMARK_AGENT_CONFIGS = {
    [PRIMARY_BENCHMARK_AGENT]: `---
description: Primary adapter for the context-scout-fast immutable benchmark.
mode: primary
model: opencode-go/deepseek-v4-flash
color: info
steps: 48
options:
    thinking:
        type: disabled
permission:
    edit: deny
    bash:
        "*": deny
        "node ./.agents/skills/_shared/scripts/context-criteria.mjs validate *": allow
        "node ./.agents/skills/_shared/scripts/context-handoff.mjs validate *": allow
        "node ./.agents/skills/_shared/scripts/context-manifest.mjs validate *": allow
        "node ./.agents/skills/_shared/scripts/context-manifest.mjs verify *": allow
        "node ./.agents/skills/_shared/scripts/context-scout-report-builder.mjs *": allow
    task: deny
    todowrite: deny
    question: deny
    skill: deny
    webfetch: deny
    "github_*": deny
    "context7_*": deny
    "mate_*": deny
    "serena*": deny
    "codebase-memory*": allow
---

You are the primary context-scout-fast benchmark adapter. Follow the repository-context-scout-playbook and the exact immutable inputs in the task prompt. Work read-only, never delegate, and produce only the requested validated report.
`,
    [FALLBACK_BENCHMARK_AGENT]: `---
description: Fallback adapter for the context-scout immutable benchmark.
mode: primary
model: openai/gpt-5.6-luna
variant: low
color: info
steps: 36
permission:
    edit: deny
    bash:
        "*": deny
        "node ./.agents/skills/_shared/scripts/context-criteria.mjs validate *": allow
        "node ./.agents/skills/_shared/scripts/context-handoff.mjs validate *": allow
        "node ./.agents/skills/_shared/scripts/context-manifest.mjs validate *": allow
        "node ./.agents/skills/_shared/scripts/context-manifest.mjs verify *": allow
        "node ./.agents/skills/_shared/scripts/context-scout-report-builder.mjs *": allow
    task: deny
    todowrite: deny
    question: deny
    skill: deny
    webfetch: deny
    "github_*": deny
    "context7_*": deny
    "mate_*": deny
    "serena*": deny
    "codebase-memory*": deny
---

You are the independent context-scout fallback benchmark adapter. Follow the repository-context-scout-playbook and the exact immutable inputs in the task prompt. Work read-only, never delegate, and do not inspect primary output.
`,
};

export function parseArgs(args) {
    const options = {
        fixtureRoot: "/tmp/opencode/context-scout-live",
        outputDir: join(REPO_ROOT, ".owe/benchmarks/context-scout-fast"),
        repoDir: REPO_ROOT,
        snapshotDir: null,
        opencode: process.env.OPENCODE_BIN ?? "opencode",
        repetitions: 3,
        concurrency: 1,
        variants: ["a", "b", "c"],
        fallback: true,
        cbmBinary: process.env.CBM_BINARY ? resolve(process.env.CBM_BINARY) : null,
    };
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
        else if (key === "--fallback") { options.fallback = value === "true" || value === "1"; }
        else { throw new Error(`Unknown argument: ${key}`); }
    }
    if (!Number.isSafeInteger(options.repetitions) || options.repetitions < 1) { throw new Error("--repetitions must be positive"); }
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 2) { throw new Error("--concurrency must be 1 or 2"); }
    if (options.variants.length === 0 || options.variants.some((variant) => !/^[a-z0-9_-]+$/i.test(variant))) { throw new Error("--variants must contain simple comma-separated names"); }
    if (options.snapshotDir && !existsSync(options.snapshotDir)) { throw new Error(`Snapshot directory does not exist: ${options.snapshotDir}`); }
    return options;
}

export function buildScoutPrompt({promptPath, manifestPath, handoffPath, criteriaPath, snapshotHash, mode, criteriaJson, reportPath, cmmAvailable = false, cmmReason = "CBM_BINARY is not configured"}) {
    const criteriaText = typeof criteriaJson === "string" ? criteriaJson : JSON.stringify(criteriaJson);
    return [
        "You are the context-scout-fast agent performing one bounded repository-context scout against a frozen snapshot.",
        "Read these exact immutable inputs by absolute path:",
        `  prompt: ${promptPath}`,
        `  manifest: ${manifestPath}`,
        `  handoff: ${handoffPath}`,
        `  criteria: ${criteriaPath}`,
        `Snapshot SHA-256: ${snapshotHash}.`,
        `Mode: ${mode}.`,
        `Criteria JSON: ${criteriaText}.`,
        `Harness class: ${HARNESS_CLASS}; protocol version: ${PROTOCOL_VERSION}.`,
        `CMM available: ${cmmAvailable}; ${cmmReason}.`,
        "Hard gate: every acceptance criterion listed under required_evidence must be satisfied with literal anchors, or emit a status other than COMPLETE.",
        "Forbid negative claims: do not assert that files, tests, configs, routes, or artifacts do not exist; every claim must be backed by evidence present in the snapshot.",
        "Emit one compact finding per criterion; keep the report tightly scoped to the requested target.",
        "Evidence ranges may span at most 80 lines.",
        "batch-render the full report in a single final artifact; do not stream partial findings across many turns.",
        "Do not call task, delegate to any subagent, implement changes, or run QA.",
        `Write a validated COMPLETE report using the report-builder from the snapshot to ${reportPath}.`,
        "Do not fabricate the report in the host; only the agent may author the final report.",
    ].join("\n");
}

export function buildFallbackPrompt({promptPath, manifestPath, handoffPath, criteriaPath, snapshotHash, mode, criteriaJson, reportPath, cmmAvailable = false, cmmReason = "CBM_BINARY is not configured"}) {
    const criteriaText = typeof criteriaJson === "string" ? criteriaJson : JSON.stringify(criteriaJson);
    return [
        "You are the canonical context-scout agent performing a full repository-context scout fallback against a frozen snapshot.",
        "Read these exact immutable inputs by absolute path:",
        `  prompt: ${promptPath}`,
        `  manifest: ${manifestPath}`,
        `  handoff: ${handoffPath}`,
        `  criteria: ${criteriaPath}`,
        `Snapshot SHA-256: ${snapshotHash}.`,
        `Mode: ${mode}.`,
        `Criteria JSON: ${criteriaText}.`,
        `Harness class: ${HARNESS_CLASS}; protocol version: ${PROTOCOL_VERSION}.`,
        `CMM available: ${cmmAvailable}; ${cmmReason}.`,
        "Hard gate: every acceptance criterion listed under required_evidence must be satisfied with literal anchors, or emit a status other than COMPLETE.",
        "Forbid negative claims: do not assert that files, tests, configs, routes, or artifacts do not exist; every claim must be backed by evidence present in the snapshot.",
        "You may use a broader budget than the fast arm, but each evidence item must stay within the validator's line limits.",
        "batch-render the full report in a single final artifact.",
        "Do not call task, delegate to any subagent, implement changes, or run QA.",
        `Write a validated COMPLETE report using the report-builder from the snapshot to ${reportPath}.`,
        "Do not fabricate the report in the host; only the agent may author the final report.",
    ].join("\n");
}

function isToolEvent(event) {
    return event?.part?.type === "tool" || event?.type === "tool" || event?.type === "tool_use";
}

function toolNameOf(event) {
    return event?.part?.tool ?? event?.tool ?? event?.tool_name ?? null;
}

export function parseJsonEvents(raw) {
    const events = String(raw ?? "").split("\n").filter(Boolean).flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
    });
    const sessionIds = new Set();
    for (const event of events) {
        const id = event?.sessionID ?? event?.session_id;
        if (typeof id === "string" && id) { sessionIds.add(id); }
    }
    const toolEvents = events.filter(isToolEvent).length;
    const taskTools = events.filter((event) => isToolEvent(event) && toolNameOf(event) === "task").length;
    const modelSteps = events.filter((event) => event?.part?.type === "step-finish" || event?.type === "step-finish" || event?.type === "step_finish").length;
    return {
        events,
        session_id: sessionIds.size ? [...sessionIds][0] : null,
        session_ids: [...sessionIds],
        tool_events: toolEvents,
        task_tools: taskTools,
        model_steps: modelSteps,
    };
}

export function isReportValid(validation, report) {
    return Boolean(validation?.valid) && report?.status === "COMPLETE";
}

export function shouldRunFallback(primaryValid, fallbackEnabled) {
    return Boolean(fallbackEnabled) && !primaryValid;
}

function isRuntimePath(relativePath) {
    return relativePath.split("/").includes("node_modules") || /^\.opencode\/(?:package(?:-lock)?\.json|\.gitignore)$/.test(relativePath);
}

function workspaceFiles(repoDir) {
    const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {cwd: repoDir, encoding: "buffer"});
    if (result.status !== 0) { throw new Error(result.stderr?.toString("utf8").trim() || "git ls-files failed"); }
    return result.stdout.toString("utf8").split("\0").filter(Boolean).sort();
}

async function copyWorkspaceSnapshot(repoDir, snapshotDir) {
    const files = workspaceFiles(repoDir).filter((relativePath) => !isRuntimePath(relativePath));
    const hash = crypto.createHash("sha256");
    let copied = 0;
    for (const relativePath of files) {
        const source = join(repoDir, relativePath);
        if (!existsSync(source)) { continue; }
        const target = join(snapshotDir, relativePath);
        const metadata = await lstat(source);
        await mkdir(join(snapshotDir, relativePath, ".."), {recursive: true});
        hash.update(relativePath).update("\0");
        if (metadata.isSymbolicLink()) {
            const link = await readlink(source);
            await symlink(link, target);
            hash.update(`link:${link}`).update("\0");
        } else if (metadata.isFile()) {
            const content = await readFile(source);
            await copyFile(source, target);
            await chmod(target, metadata.mode);
            hash.update(content).update("\0");
        } else {
            continue;
        }
        copied += 1;
    }
    return {fileCount: copied, sha256: hash.digest("hex"), paths: files};
}

async function listDirFiles(root, relative = "", out = []) {
    const abs = join(root, relative);
    if (!existsSync(abs)) { return out; }
    const metadata = await lstat(abs);
    if (metadata.isSymbolicLink()) {
        if (relative) { out.push(relative); }
        return out;
    }
    if (metadata.isDirectory()) {
        if (relative === ".git" || relative.split("/").includes(".git") || isRuntimePath(relative)) { return out; }
        const entries = (await readdir(abs)).sort();
        for (const entry of entries) {
            await listDirFiles(root, relative ? join(relative, entry) : entry, out);
        }
        return out;
    }
    if (relative && !isRuntimePath(relative)) { out.push(relative); }
    return out;
}

export async function installBenchmarkAgents(snapshotDir) {
    const agentDir = join(snapshotDir, ".opencode", "agent");
    await mkdir(agentDir, {recursive: true});
    for (const [name, content] of Object.entries(BENCHMARK_AGENT_CONFIGS)) {
        await writeFile(join(agentDir, `${name}.md`), content, {mode: 0o600});
    }
}

export function auditBenchmarkAgents(opencode, snapshotDir) {
    const audit = {};
    for (const name of Object.keys(BENCHMARK_AGENT_CONFIGS)) {
        const result = spawnSync(opencode, ["debug", "agent", name], {cwd: snapshotDir, encoding: "utf8"});
        if (result.status !== 0) {
            throw new Error(`opencode debug agent ${name} failed: ${result.stderr?.trim() || result.stdout?.trim() || "unknown error"}`);
        }
        let config;
        try { config = JSON.parse(result.stdout); } catch (error) {
            throw new Error(`opencode debug agent ${name} returned invalid JSON: ${error.message}`);
        }
        if (!config.tools || !Array.isArray(config.permission)) {
            throw new Error(`opencode debug agent ${name} returned an incomplete resolved configuration`);
        }
        audit[name] = {
            mode: config.mode ?? null,
            model: config.model ?? null,
            steps: config.steps ?? null,
            tools_invalid: Boolean(config.tools?.invalid),
            permission_rules: (config.permission ?? []).filter((rule) => ["task", "edit", "codebase-memory*", "context-scout-report-builder.mjs *"].some((pattern) => rule.permission === pattern)),
        };
    }
    return audit;
}

async function hashSnapshotDir(snapshotDir) {
    const files = (await listDirFiles(snapshotDir)).filter((relativePath) => relativePath && relativePath !== "snapshot.json").sort();
    const hash = crypto.createHash("sha256");
    for (const relativePath of files) {
        const source = join(snapshotDir, relativePath);
        const metadata = await lstat(source);
        hash.update(relativePath).update("\0");
        if (metadata.isSymbolicLink()) {
            hash.update(`link:${await readlink(source)}`).update("\0");
        } else if (metadata.isFile()) {
            hash.update(await readFile(source)).update("\0");
        }
    }
    return {fileCount: files.length, sha256: hash.digest("hex")};
}

async function materializeBenchmarkInputs(options, source) {
    const inputRoot = join(options.outputDir, "inputs");
    if (existsSync(inputRoot)) { throw new Error(`Benchmark input directory already exists: ${inputRoot}`); }
    await mkdir(inputRoot, {recursive: true});
    const sourceManifest = JSON.parse(await readFile(join(options.fixtureRoot, "manifest.json"), "utf8"));
    const manifest = {
        ...sourceManifest,
        repository: source.repository || sourceManifest.repository,
        branch: source.branch,
        head: source.head,
        generated_at: new Date().toISOString(),
    };
    const manifestPath = join(inputRoot, "manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {mode: 0o600});
    const variantHashes = {};
    for (const variant of options.variants) {
        const sourceDir = join(options.fixtureRoot, `test-${variant}`);
        const targetDir = join(inputRoot, `test-${variant}`);
        await mkdir(targetDir, {recursive: true});
        variantHashes[variant] = {};
        for (const name of ["prompt.txt", "handoff.json", "criteria.json"]) {
            const target = join(targetDir, name);
            await copyFile(join(sourceDir, name), target);
            variantHashes[variant][name] = await sha256File(target);
        }
    }
    options.fixtureRoot = inputRoot;
    options.manifestHead = manifest.head;
    options.inputHashes = {manifest: await sha256File(manifestPath), variants: variantHashes};
    return manifestPath;
}

function resolveCmmRuntime(repoDir, configuredBinary) {
    if (!configuredBinary) {
        return {available: false, path: null, reason: "CBM_BINARY is not configured"};
    }
    const binaryPath = configuredBinary.startsWith("/") ? configuredBinary : resolve(repoDir, configuredBinary);
    if (!existsSync(binaryPath)) {
        return {available: false, path: binaryPath, reason: `CBM_BINARY does not exist: ${binaryPath}`};
    }
    return {available: true, path: binaryPath, reason: "CBM_BINARY is available"};
}

async function sha256File(filePath) {
    return crypto.createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function gitMetadata(repoDir) {
    const run = (args) => {
        const result = spawnSync("git", args, {cwd: repoDir, encoding: "utf8"});
        return result.status === 0 ? result.stdout.trim() : null;
    };
    return {
        repository: run(["config", "--get", "remote.origin.url"]),
        branch: run(["branch", "--show-current"]) || "detached",
        head: run(["rev-parse", "HEAD"]),
    };
}

function runProcess(command, args, eventsPath, logPath, cwd, environment = {}) {
    return new Promise((resolveProcess) => {
        const child = spawn(command, args, {cwd, env: {...process.env, ...environment}, stdio: ["ignore", "pipe", "pipe"]});
        const events = createWriteStream(eventsPath, {mode: 0o600});
        const logs = createWriteStream(logPath, {mode: 0o600});
        child.stdout.pipe(events);
        child.stderr.pipe(logs);
        child.on("close", (code) => { events.close(); logs.close(); resolveProcess(code ?? 1); });
        child.on("error", () => resolveProcess(1));
    });
}

async function readEvents(path) {
    if (!existsSync(path)) { return ""; }
    return readFile(path, "utf8");
}

async function readReportMetrics(reportPath) {
    if (!existsSync(reportPath)) {
        return {report: null, bytes: 0, findings: 0, covered: [], error: "missing_report"};
    }
    const raw = await readFile(reportPath, "utf8");
    let report = null;
    try {
        report = JSON.parse(raw);
    } catch {
        return {report: null, bytes: Buffer.byteLength(raw), findings: 0, covered: [], error: "invalid_json"};
    }
    return {
        report,
        bytes: Buffer.byteLength(raw),
        findings: Array.isArray(report.findings) ? report.findings.length : 0,
        covered: Array.isArray(report.coverage) ? report.coverage.filter((entry) => entry && entry.status === "covered").map((entry) => entry.criterion_id) : [],
        error: null,
    };
}

function validateReport(reportPath, head, criteriaPath, cwd) {
    if (!existsSync(reportPath)) { return Promise.resolve({valid: false, reason: "missing_report"}); }
    return new Promise((done) => {
        const child = spawn(process.execPath, [VALIDATOR, "validate", reportPath, "--head", head, "--criteria", criteriaPath], {cwd, stdio: ["ignore", "pipe", "pipe"]});
        let output = "";
        child.stdout.on("data", (data) => { output += data; });
        child.stderr.on("data", (data) => { output += data; });
        child.on("close", (code) => done({valid: code === 0, reason: output.trim().split("\n").pop() ?? ""}));
        child.on("error", (error) => done({valid: false, reason: error.message}));
    });
}

async function runJob(job, options, snapshot) {
    const name = `context-scout-fast-${job.variant}-${job.repetition}`;
    const fixtureDir = join(options.fixtureRoot, `test-${job.variant}`);
    const outputDir = join(options.outputDir, name);
    await mkdir(outputDir, {recursive: true});
    const primaryReportPath = join(outputDir, "primary.report.json");
    const fallbackReportPath = join(outputDir, "fallback.report.json");
    const primaryDiscardedPath = join(outputDir, "primary-discarded.report.json");
    const eventsPath = join(outputDir, "events.jsonl");
    const logPath = join(outputDir, "stderr.log");
    const fallbackEventsPath = join(outputDir, "fallback-events.jsonl");
    const fallbackLogPath = join(outputDir, "fallback-stderr.log");

    const promptPath = join(fixtureDir, "prompt.txt");
    const manifestPath = join(options.fixtureRoot, "manifest.json");
    const handoffPath = join(fixtureDir, "handoff.json");
    const criteriaPath = join(fixtureDir, "criteria.json");
    const [handoffRaw, criteriaRaw] = await Promise.all([readFile(handoffPath, "utf8"), readFile(criteriaPath, "utf8")]);
    const handoff = JSON.parse(handoffRaw);
    const mode = handoff.mode;
    const cmm = resolveCmmRuntime(options.repoDir, options.cbmBinary);
    const fallbackInputHashes = {
        prompt: await sha256File(promptPath),
        manifest: await sha256File(manifestPath),
        handoff: await sha256File(handoffPath),
        criteria: await sha256File(criteriaPath),
        snapshot: snapshot.sha256,
    };
    const processEnvironment = {
        CBM_ALLOWED_ROOT: options.snapshotDir,
        ...(cmm.path ? {CBM_BINARY: cmm.path} : {}),
    };

    const prompt = buildScoutPrompt({
        promptPath,
        manifestPath,
        handoffPath,
        criteriaPath,
        snapshotHash: snapshot.sha256,
        mode,
        criteriaJson: criteriaRaw,
        reportPath: primaryReportPath,
        cmmAvailable: cmm.available,
        cmmReason: cmm.reason,
    });

    const started = Date.now();
    const primaryExit = await runProcess(options.opencode, ["run", "--pure", "--agent", PRIMARY_BENCHMARK_AGENT, "--format", "json", "--title", name, "--dir", options.snapshotDir, prompt], eventsPath, logPath, options.snapshotDir, processEnvironment);
    const primaryDuration = Date.now() - started;
    const primaryParsed = parseJsonEvents(await readEvents(eventsPath));
    const primaryValidation = await validateReport(primaryReportPath, options.manifestHead, criteriaPath, options.snapshotDir);
    const primaryMetrics = await readReportMetrics(primaryReportPath);
    const primaryValid = isReportValid(primaryValidation, primaryMetrics.report);

    const primary = {
        session_id: primaryParsed.session_id,
        exit_code: primaryExit,
        duration_ms: primaryDuration,
        tool_events: primaryParsed.tool_events,
        task_tools: primaryParsed.task_tools,
        model_steps: primaryParsed.model_steps,
        report_status: primaryMetrics.report?.status ?? null,
        report_bytes: primaryMetrics.bytes,
        findings: primaryMetrics.findings,
        covered_criteria: primaryMetrics.covered,
        valid: primaryValid,
        validation_reason: primaryValidation.reason,
        report_path: primaryReportPath,
    };

    let fallbackUsed = false;
    let fallback = null;
    let accepted = primary;
    let primaryReportDiscardedAt = null;
    let fallbackStartedAt = null;

    if (!primaryValid) {
        if (existsSync(primaryReportPath)) {
            await rename(primaryReportPath, primaryDiscardedPath);
            primaryReportDiscardedAt = new Date().toISOString();
        }
        if (shouldRunFallback(primaryValid, options.fallback)) {
            const fallbackName = `${name}-fallback`;
            const fallbackPrompt = buildFallbackPrompt({
                promptPath,
                manifestPath,
                handoffPath,
                criteriaPath,
                snapshotHash: snapshot.sha256,
                mode,
                criteriaJson: criteriaRaw,
                reportPath: fallbackReportPath,
                cmmAvailable: false,
                cmmReason: "Fallback adapter does not use CMM",
            });
            fallbackStartedAt = new Date().toISOString();
            const fallbackStarted = Date.now();
            const fallbackExit = await runProcess(options.opencode, ["run", "--pure", "--agent", FALLBACK_BENCHMARK_AGENT, "--format", "json", "--title", fallbackName, "--dir", options.snapshotDir, fallbackPrompt], fallbackEventsPath, fallbackLogPath, options.snapshotDir, processEnvironment);
            const fallbackDuration = Date.now() - fallbackStarted;
            const fallbackParsed = parseJsonEvents(await readEvents(fallbackEventsPath));
            const fallbackValidation = await validateReport(fallbackReportPath, options.manifestHead, criteriaPath, options.snapshotDir);
            const fallbackMetrics = await readReportMetrics(fallbackReportPath);
            const fallbackValid = isReportValid(fallbackValidation, fallbackMetrics.report);
            fallback = {
                session_id: fallbackParsed.session_id,
                exit_code: fallbackExit,
                duration_ms: fallbackDuration,
                tool_events: fallbackParsed.tool_events,
                task_tools: fallbackParsed.task_tools,
                model_steps: fallbackParsed.model_steps,
                report_status: fallbackMetrics.report?.status ?? null,
                report_bytes: fallbackMetrics.bytes,
                findings: fallbackMetrics.findings,
                covered_criteria: fallbackMetrics.covered,
                valid: fallbackValid,
                validation_reason: fallbackValidation.reason,
                report_path: fallbackReportPath,
            };
            fallbackUsed = true;
            accepted = fallback;
        }
    }

    return {
        arm: "context-scout-fast",
        harness_class: HARNESS_CLASS,
        protocol_version: PROTOCOL_VERSION,
        variant: job.variant,
        repetition: job.repetition,
        name,
        primary,
        fallback_used: fallbackUsed,
        fallback,
        primary_valid: primaryValid,
        fallback_valid: fallback ? fallback.valid : null,
        final_session_id: accepted.session_id,
        final_exit_code: accepted.exit_code,
        final_duration_ms: accepted.duration_ms,
        final_tool_events: accepted.tool_events,
        final_task_tools: accepted.task_tools,
        final_model_steps: accepted.model_steps,
        final_report_status: accepted.report_status,
        final_report_bytes: accepted.report_bytes,
        final_findings: accepted.findings,
        final_covered_criteria: accepted.covered_criteria,
        final_validation_reason: accepted.validation_reason,
        final_report_path: accepted.report_path,
        primary_report_path: primaryReportPath,
        fallback_report_path: fallbackReportPath,
        primary_report_discarded_path: existsSync(primaryDiscardedPath) ? primaryDiscardedPath : null,
        primary_report_discarded_at: primaryReportDiscardedAt,
        fallback_started_at: fallbackStartedAt,
        fallback_input_hashes: fallbackInputHashes,
        cmm_available: cmm.available,
        cmm_reason: cmm.reason,
        valid: accepted.valid,
        task_tools: accepted.task_tools,
        session_id: accepted.session_id,
    };
}

async function runPool(jobs, options, snapshot) {
    const results = [];
    let cursor = 0;
    async function worker() {
        while (cursor < jobs.length) { results.push(await runJob(jobs[cursor++], options, snapshot)); }
    }
    await Promise.all(Array.from({length: Math.min(options.concurrency, jobs.length)}, worker));
    return results.sort((left, right) => left.variant.localeCompare(right.variant) || left.repetition - right.repetition);
}

export function summarizeResult(results, snapshot, options = {}) {
    const validRate = results.length ? results.filter((result) => result.valid).length / results.length : 0;
    const noTaskTools = results.length > 0 && results.every((result) => result.final_task_tools === 0);
    const fallbackRate = results.length ? results.filter((result) => result.fallback_used).length / results.length : 0;
    const sessionIds = [];
    for (const result of results) {
        if (result.primary?.session_id) { sessionIds.push(result.primary.session_id); }
        if (result.fallback?.session_id) { sessionIds.push(result.fallback.session_id); }
    }
    const uniqueSessionIds = [...new Set(sessionIds)].sort();
    const passed = results.length > 0 && results.every((result) => result.valid) && Boolean(snapshot.unchanged) && noTaskTools;
    const cmmStates = [...new Set(results.map((result) => result.cmm_available).filter((value) => typeof value === "boolean"))];
    return {
        arm: "context-scout-fast",
        harness_class: HARNESS_CLASS,
        protocol_version: PROTOCOL_VERSION,
        cmm_available: cmmStates.length === 1 ? cmmStates[0] : "mixed",
        repetitions: options.repetitions ?? null,
        concurrency: options.concurrency ?? null,
        variants: options.variants ?? null,
        input_hashes: options.inputHashes ?? null,
        adapter_audit: options.adapterAudit ?? null,
        snapshot: {...snapshot},
        gates: {
            valid_rate: validRate,
            no_task_tools: noTaskTools,
            fallback_rate: fallbackRate,
            passed,
        },
        results,
        session_ids: uniqueSessionIds,
    };
}

export async function runBenchmark(options) {
    await mkdir(options.outputDir, {recursive: true});
    let snapshotDir;
    let snapshot;
    if (options.snapshotDir) {
        snapshotDir = options.snapshotDir;
    } else {
        snapshotDir = join(options.outputDir, "snapshot");
        if (existsSync(snapshotDir)) { throw new Error(`Snapshot directory already exists: ${snapshotDir}`); }
        await mkdir(snapshotDir, {recursive: true});
        await copyWorkspaceSnapshot(options.repoDir, snapshotDir);
    }
    await installBenchmarkAgents(snapshotDir);
    options.adapterAudit = auditBenchmarkAgents(options.opencode, snapshotDir);
    snapshot = await hashSnapshotDir(snapshotDir);
    options.snapshotDir = snapshotDir;
    const source = gitMetadata(options.repoDir);
    const cmm = resolveCmmRuntime(options.repoDir, options.cbmBinary);
    const snapshotMetadata = {
        source_head: source.head,
        source_branch: source.branch,
        source_repository: source.repository,
        snapshot_sha256: snapshot.sha256,
        file_count: snapshot.fileCount,
        runner_commit: source.head,
        protocol_version: PROTOCOL_VERSION,
        harness_class: HARNESS_CLASS,
        cmm_available: cmm.available,
        cmm_reason: cmm.reason,
    };
    await writeFile(join(options.outputDir, "snapshot.json"), `${JSON.stringify(snapshotMetadata, null, 2)}\n`, {mode: 0o600});
    await materializeBenchmarkInputs(options, source);
    const jobs = options.variants.flatMap((variant) => Array.from({length: options.repetitions}, (_, index) => ({variant, repetition: index + 1})));
    const results = await runPool(jobs, options, snapshot);
    const after = await hashSnapshotDir(snapshotDir);
    const finalSnapshot = {
        fileCount: snapshot.fileCount,
        sha256: snapshot.sha256,
        afterFileCount: after.fileCount,
        afterSha256: after.sha256,
        unchanged: after.sha256 === snapshot.sha256 && after.fileCount === snapshot.fileCount,
        source_head: source.head,
        source_branch: source.branch,
        runner_commit: source.head,
        cmm_available: cmm.available,
        cmm_reason: cmm.reason,
    };
    await writeFile(join(options.outputDir, "snapshot.json"), `${JSON.stringify({...snapshotMetadata, after_sha256: after.sha256, after_file_count: after.fileCount, snapshot_unchanged: finalSnapshot.unchanged}, null, 2)}\n`, {mode: 0o600});
    const summary = summarizeResult(results, finalSnapshot, options);
    await writeFile(join(options.outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, {mode: 0o600});
    return {summary, snapshotDir};
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.concurrency > 2) { throw new Error("--concurrency cannot exceed 2"); }
    const {summary} = await runBenchmark(options);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.gates.passed) { process.exitCode = 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
