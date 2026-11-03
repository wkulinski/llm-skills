#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const NO_ACTIVE_RULES_REASON = "Rector config has no active rules or sets.";
const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.resolve(skillDir, "..");
const repoRoot = findRepoRoot();
const rawArgs = process.argv.slice(2);
const rector = resolveTool("rector");
const rectorArgs = normalizeArgs(rawArgs);
const rectorResult = spawnSync(rector[0], ["process", ...rectorArgs], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
});

if (rectorResult.status !== 0 && !rectorResult.stdout.trim()) {
    writeJson({
        ok: false,
        tool: "rector",
        status: rectorResult.status,
        stderr: rectorResult.stderr.trim(),
        stdout: rectorResult.stdout.trim(),
    });
    process.exit(rectorResult.status ?? 1);
}

let payload;
try {
    payload = JSON.parse(extractJson(rectorResult.stdout));
} catch (error) {
    const reason = summarizeNonJsonOutput(rectorResult.stdout);
    writeJson({
        ok: false,
        tool: "rector",
        status: rectorResult.status,
        reason,
        error: reason === NO_ACTIVE_RULES_REASON ? void 0 : `Unable to parse Rector JSON: ${error.message}`,
        stderr: debugStderr(rectorResult.stderr),
    });
    process.exit(rectorResult.status === 0 ? 0 : (rectorResult.status ?? 1));
}

const fileDiffs = payload.file_diffs ?? payload.fileDiffs ?? payload.files ?? [];
const files = Array.isArray(fileDiffs)
    ? fileDiffs.map((entry) => summarizeFileDiff(entry))
    : [];

writeJson({
    ok: true,
    rectorStatus: rectorResult.status,
    hasChanges: files.length > 0,
    changedFiles: files.length,
    files,
    totals: payload.totals ?? payload.summary ?? void 0,
    stderr: debugStderr(rectorResult.stderr),
});

function normalizeArgs(inputArgs) {
    const normalized = [...inputArgs];
    if (!normalized.includes("--dry-run") && !normalized.includes("-n")) {
        normalized.push("--dry-run");
    }
    if (!normalized.some((arg) => arg === "--output-format=json" || arg === "--output-format" || arg.startsWith("--output-format="))) {
        normalized.push("--output-format=json");
    }
    if (!normalized.includes("--no-progress-bar")) {
        normalized.push("--no-progress-bar");
    }
    return normalized;
}

function summarizeFileDiff(entry) {
    const file = entry.file ?? entry.relative_file_path ?? entry.relativeFilePath ?? entry.path ?? "";
    const diff = entry.diff ?? entry.patch ?? "";
    return {
        file,
        appliedRectors: entry.applied_rectors ?? entry.appliedRectors ?? entry.rectors ?? [],
        diffLines: typeof diff === "string" ? diff.split("\n").length : null,
        diffPreview: typeof diff === "string" ? diff.split("\n").slice(0, 40).join("\n") : void 0,
    };
}

function extractJson(stdout) {
    const trimmed = stdout.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return trimmed;
    }

    const objectIndex = trimmed.indexOf("{");
    const arrayIndex = trimmed.indexOf("[");
    const indexes = [objectIndex, arrayIndex].filter((index) => index >= 0);
    if (indexes.length === 0) {
        throw new Error("No JSON object or array found in stdout");
    }

    return trimmed.slice(Math.min(...indexes));
}

function summarizeNonJsonOutput(stdout) {
    const normalized = stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ");

    if (normalized.includes("Register rules or sets")) {
        return NO_ACTIVE_RULES_REASON;
    }

    return normalized.slice(0, 1200);
}

function resolveTool(tool) {
    const envLoadPath = path.join(skillsRoot, "_shared/scripts/env-load.sh");
    const script = `source ${shellQuote(envLoadPath)}; resolve_tool_cmd ${shellQuote(tool)}`;
    const resolved = spawnSync("bash", ["-lc", script], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    if (resolved.status !== 0 || !resolved.stdout.trim()) {
        throw new Error(`Unable to resolve tool: ${tool}`);
    }
    return [resolved.stdout.trim()];
}

function findRepoRoot() {
    const gitResult = spawnSync("git", ["-C", skillDir, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
    });
    if (gitResult.status !== 0) {
        throw new Error("Not inside a git repository");
    }
    return gitResult.stdout.trim();
}

function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function writeJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function debugStderr(stderr) {
    if (process.env.PHP_STRUCTURE_DEBUG !== "1") {
        return void 0;
    }

    return stderr.trim() || void 0;
}
