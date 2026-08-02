#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectBundle } from "./lib/collector.mjs";
import { loadConfig, loadPricing } from "./lib/config.mjs";
import { OpenCodeReader } from "./lib/opencode.mjs";
import { parseSince } from "./lib/util.mjs";
import { createClient } from "./lib/client.mjs";
import { writeLayeredReport } from "./lib/report-files.mjs";
import { listReportItems, readReportBrief, showReportItem } from "./lib/report-query.mjs";
import { withManagedServer } from "./lib/server.mjs";

async function main() {
    const args = parseArgs(process.argv.slice(2));
    await loadEnvironment(resolve(flagOne(args, "directory") ?? process.cwd()));
    switch (args.command) {
        case "prepare":
            await prepare(args);
            return;
        case "inspect":
            await inspect(args);
            return;
        case "list":
            await list(args);
            return;
        case "brief":
            await brief(args);
            return;
        case "show":
            await show(args);
            return;
        case "doctor":
            await doctor(args);
            return;
        case "init":
            await init(args);
            return;
        case "help":
        case "--help":
        case "-h":
        case "":
            printHelp();
            return;
        default:
            throw new Error(`Unknown command: ${args.command}`);
    }
}

async function prepare(args) {
    const cwd = resolve(flagOne(args, "directory") ?? process.cwd());
    assertNoRemovedOutputFlags(args);
    const configPath = resolve(cwd, flagOne(args, "config") ?? ".owe/config.json");
    const pricingPath = resolve(cwd, flagOne(args, "pricing") ?? ".owe/pricing.json");
    const analysisDir = resolve(cwd, flagOne(args, "analysis-dir") ?? defaultAnalysisDir(cwd));
    const config = withOverrides(await loadRuntimeConfig(configPath), args, cwd);
    const pricing = await loadPricing(pricingPath);
    const sessions = flagMany(args, "session");
    const sinceLabel = flagOne(args, "since") ?? "30d";
    const contentMode = parseContentMode(flagOne(args, "content") ?? config.collection.content_mode);
    await withManagedServer({
        base_url: config.opencode.base_url,
        directory: config.opencode.directory,
        cwd: config.opencode.directory,
        mode: flagOne(args, "server") ?? "auto",
    }, async ({base_url}) => {
        const client = await createClient(base_url);
        const bundle = await collectBundle(client, config, pricing, {
            since_ms: sessions.length > 0 ? null : parseSince(sinceLabel),
            since_label: sessions.length > 0 ? null : sinceLabel,
            session_ids: sessions,
            limit: numberFlag(args, "limit", config.collection.max_sessions),
            content_mode: contentMode,
        });
        const reportOptions = { analysis_dir: analysisDir, brief: config.reporting.brief };
        const report = await writeLayeredReport(bundle, reportOptions);
        console.log(`OWE report: ${report.report_path}`);
        console.log("OWE brief: owe brief");
        console.log(`OWE details: ${report.analysis_dir} (${report.detail_counts.patterns} patterns, ${report.detail_counts.overlaps} overlaps, ${report.detail_counts.roots} roots)`);
        console.log(`Roots: ${bundle.summary.root_sessions}; steps: ${bundle.summary.model_steps}; delegations: ${bundle.summary.delegations}; fallback attempts: ${bundle.summary.fallback_attempts}`);
        console.log(`Estimated reading size: brief ${report.report_sizes.estimated_brief_tokens} tokens; report ${report.report_sizes.estimated_report_tokens} tokens`);
        if (bundle.warnings.length > 0) { console.log(`Warnings: ${bundle.warnings.join(", ")}`); }
    });
}

async function inspect(args) {
    const sessionId = args.positionals[0];
    if (!sessionId) { throw new Error("Usage: node .agents/skills/opencode-workflow-economics/scripts/owe.mjs inspect <session-id> [options]"); }
    const cwd = resolve(flagOne(args, "directory") ?? process.cwd());
    args.flags.set("session", [sessionId]);
    if (!args.flags.has("content")) { args.flags.set("content", ["full"]); }
    args.flags.set("analysis-dir", [resolve(defaultAnalysisDir(cwd), `inspect-${safeId(sessionId)}`)]);
    await prepare(args);
}

async function list(args) {
    const type = args.positionals[0];
    if (!type) { throw new Error("Usage: owe list patterns|overlaps|roots|subagents|models|activities [options]"); }
    const cwd = resolve(flagOne(args, "directory") ?? process.cwd());
    const analysisDir = resolve(cwd, flagOne(args, "analysis-dir") ?? defaultAnalysisDir(cwd));
    const output = await listReportItems({
        analysis_dir: analysisDir,
        type,
        limit: numberFlag(args, "limit", 20),
        sort: flagOne(args, "sort"),
        view: flagOne(args, "view"),
        diagnostic: flagOne(args, "diagnostic"),
        json: hasFlag(args, "json"),
        max_bytes: numberFlag(args, "max-bytes", 8 * 1024),
    });
    process.stdout.write(output);
}

async function brief(args) {
    const cwd = resolve(flagOne(args, "directory") ?? process.cwd());
    const analysisDir = resolve(cwd, flagOne(args, "analysis-dir") ?? defaultAnalysisDir(cwd));
    const configPath = resolve(cwd, flagOne(args, "config") ?? ".owe/config.json");
    const config = await loadRuntimeConfig(configPath);
    process.stdout.write(await readReportBrief(analysisDir, config.reporting.brief));
}

async function show(args) {
    const type = args.positionals[0];
    const id = args.positionals[1];
    if (!type || !id) { throw new Error("Usage: owe show pattern|overlap|root <id> [--json]"); }
    const cwd = resolve(flagOne(args, "directory") ?? process.cwd());
    const analysisDir = resolve(cwd, flagOne(args, "analysis-dir") ?? defaultAnalysisDir(cwd));
    const output = await showReportItem({
        analysis_dir: analysisDir,
        type,
        id,
        json: hasFlag(args, "json"),
        max_bytes: numberFlag(args, "max-bytes", 16 * 1024),
        max_spans: numberFlag(args, "max-spans", 20),
    });
    process.stdout.write(output);
}

async function doctor(args) {
    const cwd = resolve(flagOne(args, "directory") ?? process.cwd());
    const configPath = resolve(cwd, flagOne(args, "config") ?? ".owe/config.json");
    const pricingPath = resolve(cwd, flagOne(args, "pricing") ?? ".owe/pricing.json");
    const config = withOverrides(await loadRuntimeConfig(configPath), args, cwd);
    await loadPricing(pricingPath);
    await withManagedServer({
        base_url: config.opencode.base_url,
        directory: config.opencode.directory,
        cwd: config.opencode.directory,
        mode: flagOne(args, "server") ?? "auto",
    }, async ({base_url}) => {
        const client = await createClient(base_url);
        const reader = new OpenCodeReader(client, config.opencode.directory);
        const sessions = await reader.listSessions();
        console.log("OWE doctor: ok");
        console.log(`OpenCode: ${base_url}`);
        console.log(`Directory: ${config.opencode.directory}`);
        console.log(`Visible sessions: ${sessions.length}`);
        console.log(`Config: ${configPath}`);
        console.log(`Pricing: ${pricingPath}`);
    });
}

async function init(args) {
    const force = hasFlag(args, "force");
    const cwd = resolve(flagOne(args, "directory") ?? process.cwd());
    const skillRoot = fileURLToPath(new URL("..", import.meta.url));
    const templateSource = resolve(skillRoot, "templates");
    const configDirectory = resolve(cwd, ".owe");
    await mkdir(configDirectory, { recursive: true });
    await copyFilePreserving(resolve(templateSource, "config.json"), resolve(configDirectory, "config.json"), force);
    await copyFilePreserving(resolve(templateSource, "pricing.json"), resolve(configDirectory, "pricing.json"), force);
    console.log(`OWE config: ${resolve(configDirectory, "config.json")}`);
    console.log(`OWE pricing: ${resolve(configDirectory, "pricing.json")}`);
}

function withOverrides(config, args, cwd) {
    return {
        ...config,
        opencode: {
            base_url: flagOne(args, "base-url") ?? config.opencode.base_url,
            directory: resolve(cwd, flagOne(args, "project") ?? config.opencode.directory),
        },
    };
}

async function loadRuntimeConfig(configPath) {
    return loadConfig(configPath, {
        onWarning: (warning) => console.warn(`OWE config warning: ${warning}`),
    });
}

function defaultAnalysisDir(cwd) {
    const configured = process.env.OWC_PATH || resolve(cwd, process.env.CACHE_PATH || "var/agent/cache", "owc");
    return resolve(cwd, configured);
}

async function loadEnvironment(cwd) {
    const externallySet = new Set(["OWC_PATH", "CACHE_PATH"].filter((key) => typeof process.env[key] !== "undefined"));
    for (const filename of [".env", ".env.local"]) {
        let content;
        try {
            content = await readFile(resolve(cwd, filename), "utf8");
        } catch (error) {
            if (error.code === "ENOENT") { continue; }
            throw error;
        }
        for (const line of content.split(/\r?\n/)) {
            const match = /^\s*(OWC_PATH|CACHE_PATH)\s*=\s*(.*?)\s*$/.exec(line);
            if (!match || externallySet.has(match[1])) { continue; }
            const rawValue = match[2];
            process.env[match[1]] = rawValue.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
        }
    }
}

async function copyFilePreserving(source, destination, force) {
    if (!force && await exists(destination)) {
        console.log(`Preserved existing: ${destination}`);
        return;
    }
    await writeFile(destination, await readFile(source), { mode: 0o600 });
}

async function exists(path) {
    try {
        await stat(path);
        return true;
    } catch (error) {
        if (error.code === "ENOENT") { return false; }
        throw error;
    }
}

function parseArgs(values) {
    const command = values.shift() ?? "";
    const flags = new Map();
    const positionals = [];
    for (let index = 0; index < values.length; index += 1) {
        const value = values[index];
        if (!value.startsWith("--")) {
            positionals.push(value);
            continue;
        }
        const [rawName, inline] = value.slice(2).split("=", 2);
        const next = values[index + 1];
        const flagValue = inline ?? (next && !next.startsWith("--") ? (index += 1, next) : "true");
        const flagValues = flags.get(rawName) ?? [];
        flagValues.push(flagValue);
        flags.set(rawName, flagValues);
    }
    return { command, positionals, flags };
}

function flagOne(args, name) {
    return args.flags.get(name)?.at(-1) ?? null;
}

function flagMany(args, name) {
    return args.flags.get(name) ?? [];
}

function hasFlag(args, name) {
    return args.flags.has(name);
}

function assertNoRemovedOutputFlags(args) {
    for (const name of ["out", "summary", "index", "no-full-bundle"]) {
        if (args.flags.has(name)) { throw new Error(`Unsupported option --${name}; OWE writes only report.json.`); }
    }
}

function numberFlag(args, name, fallback) {
    const value = flagOne(args, name);
    if (!value) { return fallback; }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1) { throw new Error(`Invalid --${name}: ${value}`); }
    return parsed;
}

function parseContentMode(value) {
    if (value === "metadata" || value === "compact" || value === "full") { return value; }
    throw new Error(`Invalid --content: ${value}`);
}

function safeId(value) {
    return value.replace(/[^A-Za-z0-9._-]/g, "-");
}

function printHelp() {
    console.log(`OWE — OpenCode Workflow Economics

Prepare layered OpenCode workflow diagnostics for agent-led delegation analysis.

Commands:
  node .agents/skills/opencode-workflow-economics/scripts/owe.mjs init [--force]
  node .agents/skills/opencode-workflow-economics/scripts/owe.mjs doctor [--base-url URL] [--project PATH] [--server auto|existing]
  node .agents/skills/opencode-workflow-economics/scripts/owe.mjs prepare [--since 30d] [--session ID]... [--content metadata|compact|full] [--server auto|existing]
  node .agents/skills/opencode-workflow-economics/scripts/owe.mjs inspect <session-id> [--content full]
  node .agents/skills/opencode-workflow-economics/scripts/owe.mjs brief
  node .agents/skills/opencode-workflow-economics/scripts/owe.mjs list patterns|overlaps|roots|subagents|models|activities [options]
  node .agents/skills/opencode-workflow-economics/scripts/owe.mjs show pattern|overlap|root <id> [--json]

Reporting:
  --analysis-dir PATH  Canonical report directory (default: $OWC_PATH, $CACHE_PATH/owc, or ./var/agent/cache/owc)

Navigation options:
  --sort total-cost|frequency|median-cost|cost|created
  --view VIEW          Pattern view, e.g. high-cost-read-only
  --diagnostic NAME    Filter overlap diagnostics
  --limit N            Maximum rows
  --max-bytes N        Text projection byte budget (list default: 8192; root default: 16384)
  --max-spans N        Maximum spans/delegations in text root output (default: 20)
  --json               Return machine-readable detail/list output

  Common options:
  --directory PATH   Directory containing .owe configuration (default: cwd)
  --project PATH     OpenCode project directory (default from config)
  --config PATH      Config JSON (default: .owe/config.json)
  --pricing PATH     Pricing JSON (default: .owe/pricing.json)
  --base-url URL     Running OpenCode server (default: http://localhost:4096)
  --server MODE      Server lifecycle: auto (default) or existing

  Default analysis directory:
  $OWC_PATH, or $CACHE_PATH/owc, or ./var/agent/cache/owc
`);
}

main().catch((error) => {
    console.error(`owe: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
});
