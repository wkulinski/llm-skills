#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.resolve(skillDir, "..");
const repoRoot = findRepoRoot();
const fixer = resolveTool("php-cs-fixer");
const args = normalizeArgs(process.argv.slice(2));
const fixerResult = spawnSync(fixer[0], ["fix", ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
});

if (fixerResult.status !== 0 && !fixerResult.stdout.trim()) {
    writeJson({
        ok: false,
        tool: "php-cs-fixer",
        status: fixerResult.status,
        stderr: fixerResult.stderr.trim(),
    });
    process.exit(fixerResult.status ?? 1);
}

let payload;
try {
    payload = JSON.parse(extractJson(fixerResult.stdout));
} catch (error) {
    writeJson({
        ok: false,
        tool: "php-cs-fixer",
        status: fixerResult.status,
        error: `Unable to parse php-cs-fixer JSON: ${error.message}`,
        stdoutPreview: fixerResult.stdout.slice(0, 1200),
        stderr: debugStderr(fixerResult.stderr),
    });
    process.exit(fixerResult.status === 0 ? 0 : (fixerResult.status ?? 1));
}

const files = Array.isArray(payload.files) ? payload.files.map(summarizeFile) : [];

writeJson({
    ok: true,
    fixerStatus: fixerResult.status,
    hasChanges: files.length > 0,
    changedFiles: files.length,
    files,
    time: payload.time,
    memory: payload.memory,
    stderr: debugStderr(fixerResult.stderr),
});

function normalizeArgs(rawArgs) {
    const normalized = [...rawArgs];
    if (!normalized.includes("--dry-run")) {
        normalized.push("--dry-run");
    }
    if (!normalized.includes("--diff")) {
        normalized.push("--diff");
    }
    if (!normalized.some((arg) => arg === "--format=json" || arg === "--format" || arg.startsWith("--format="))) {
        normalized.push("--format=json");
    }
    if (!normalized.some((arg) => arg === "--show-progress=none" || arg === "--show-progress" || arg.startsWith("--show-progress="))) {
        normalized.push("--show-progress=none");
    }
    return normalized;
}

function summarizeFile(file) {
    const diff = file.diff ?? "";
    return {
        file: relativePath(file.name ?? ""),
        diffLines: typeof diff === "string" ? diff.split("\n").length : null,
        diffPreview: typeof diff === "string" ? normalizeDiff(diff).split("\n").slice(0, 40).join("\n") : void 0,
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

function relativePath(filePath) {
    if (!filePath) {
        return filePath;
    }
    return path.relative(repoRoot, normalizeToolPath(filePath)) || ".";
}

function normalizeToolPath(filePath) {
    if (!path.isAbsolute(filePath) || filePath.startsWith(repoRoot)) {
        return filePath;
    }

    const parts = filePath.split(path.sep).filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
        const candidate = path.join(repoRoot, ...parts.slice(index));
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return filePath;
}

function normalizeDiff(diff) {
    return diff
        .split("\n")
        .map((line) => {
            const match = line.match(/^([+-]{3})\s+(.+)$/);
            if (!match) {
                return line;
            }

            return `${match[1]} ${relativePath(match[2])}`;
        })
        .join("\n");
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
