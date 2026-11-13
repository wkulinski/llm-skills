#!/usr/bin/env node

import {spawnSync} from "../../_shared/scripts/file-process.mjs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.resolve(skillDir, "..");
const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
    usage();
}
if (rawArgs[0] === "--help" || rawArgs[0] === "-h") {
    usage({help: true});
}

let repoRoot;
const phpactorArgs = normalizeArgs(rawArgs);
try {
    repoRoot = findRepoRoot();
    const phpactor = resolveTool("phpactor");
    const result = spawnSync(phpactor[0], [...phpactor.slice(1), ...phpactorArgs], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
    });
    reportResult(result);
} catch (error) {
    reportResult({status: null, error, stdout: "", stderr: ""});
}

function reportResult(result) {
    const parsedJson = parseJsonOutput(result.stdout ?? "");
    const ok = !result.error && !result.signal && result.status === 0;
    writeJson({
        ok,
        tool: "phpactor",
        mode: "cli",
        command: detectCommand(rawArgs),
        args: phpactorArgs,
        status: result.status,
        signal: result.signal || void 0,
        error: result.error ? {code: result.error.code, message: result.error.message} : void 0,
        json: parsedJson ? summarizeJson(parsedJson) : void 0,
        stdout: parsedJson ? void 0 : summarizeText(result.stdout ?? ""),
        stderr: result.stderr?.trim() || void 0,
    });
    process.exitCode = ok ? 0 : (result.status || 1);
}

function usage({help = false} = {}) {
    const output = `Usage:
    phpactor-cli.mjs <phpactor-command> [phpactor arguments/options...]

Adapter behavior:
    Commands and options pass through to Phpactor.
    Paths and option values pass through unchanged to the project entrypoint.
    The wrapper adds --no-interaction and --no-ansi when they are not supplied.
    --help and -h show this wrapper help before git/tool resolution.

Examples:
    phpactor-cli.mjs list --format=json
    phpactor-cli.mjs help class:move --format=json
    phpactor-cli.mjs class:move src/Old.php src/New.php --type=file
    phpactor-cli.mjs offset:info src/Foo.php 123 --format=json

Use help <command> to request help from the backend Phpactor command.`;
    (help ? process.stdout : process.stderr).write(`${output}\n`);
    process.exit(help ? 0 : 2);
}

function normalizeArgs(inputArgs) {
    const normalized = [...inputArgs];
    if (!hasOption(normalized, "no-interaction") && !normalized.includes("-n")) {
        normalized.push("--no-interaction");
    }
    if (!hasOption(normalized, "no-ansi")) {
        normalized.push("--no-ansi");
    }
    return normalized;
}

function hasOption(inputArgs, name) {
    return inputArgs.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
}

function detectCommand(inputArgs) {
    for (let index = 0; index < inputArgs.length; index += 1) {
        const arg = inputArgs[index];
        if (!arg.startsWith("-")) {
            return arg;
        }
        if (optionConsumesNextValue(arg) && !arg.includes("=")) {
            index += 1;
        }
    }
    return null;
}

function optionConsumesNextValue(option) {
    return [
        "--working-dir",
        "-d",
        "--config-extra",
        "--format",
        "--output-format",
    ].includes(option);
}

function parseJsonOutput(stdout) {
    const raw = extractJson(stdout);
    if (!raw) {
        return null;
    }

    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
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
        return null;
    }

    return trimmed.slice(Math.min(...indexes));
}

function summarizeJson(payload) {
    if (payload && typeof payload === "object" && Array.isArray(payload.commands)) {
        return summarizeCommandList(payload);
    }

    if (payload && typeof payload === "object" && payload.name && payload.definition) {
        return summarizeCommandHelp(payload);
    }

    return compact(normalizePaths(payload));
}

function summarizeCommandList(payload) {
    const commands = payload.commands.map((entry) => ({
        name: entry.name,
        description: entry.description,
        hidden: entry.hidden || void 0,
    }));

    return {
        application: payload.application,
        commandCount: commands.length,
        commands,
        namespaces: Array.isArray(payload.namespaces)
            ? payload.namespaces.map((namespace) => ({
                id: namespace.id,
                commands: namespace.commands,
            }))
            : void 0,
    };
}

function summarizeCommandHelp(payload) {
    const options = Object.values(payload.definition.options ?? {}).map((option) => ({
        name: option.name,
        shortcut: option.shortcut || void 0,
        acceptsValue: option.accept_value,
        requiredValue: option.is_value_required,
        multiple: option.is_multiple,
        description: option.description,
        default: option.default,
    }));

    return {
        name: payload.name,
        description: payload.description,
        usage: payload.usage,
        arguments: Object.values(payload.definition.arguments ?? {}).map((argument) => ({
            name: argument.name,
            required: argument.is_required,
            array: argument.is_array,
            description: argument.description,
            default: argument.default,
        })),
        options,
        flags: {
            hasDryRun: options.some((option) => option.name === "--dry-run"),
            hasFormat: options.some((option) => option.name === "--format" || option.name === "--output-format"),
            hasFilesystem: options.some((option) => option.name === "--filesystem"),
            hasNoInteraction: options.some((option) => option.name === "--no-interaction"),
        },
    };
}

function compact(value) {
    if (Array.isArray(value)) {
        return value.slice(0, 80).map(compact);
    }

    if (value && typeof value === "object") {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            output[key] = compactEntry(item, 800);
        }
        return output;
    }

    return value;
}

function compactEntry(item, limit) {
    if (typeof item === "string" && item.length > limit) {
        return `${item.slice(0, limit)}...`;
    }

    return compact(item);
}

function summarizeText(stdout) {
    const text = stdout.trim();
    if (!text) {
        return void 0;
    }

    const lines = text.split("\n");
    return {
        lineCount: lines.length,
        preview: lines.slice(0, 80).join("\n"),
        omittedLines: Math.max(0, lines.length - 80),
    };
}

function resolveTool(tool) {
    const envLoadPath = path.join(skillsRoot, "_shared/scripts/env-load.sh");
    const script = `source ${shellQuote(envLoadPath)}; resolve_tool_cmd ${shellQuote(tool)}`;
    const resolved = spawnSync("bash", ["-lc", script], {
        cwd: repoRoot,
        encoding: "utf8",
    });
    if (resolved.status !== 0 || !resolved.stdout.trim()) {
        throw new Error(`Unable to resolve tool: ${tool}. ${resolved.error?.message ?? resolved.stderr.trim()}`);
    }
    return [resolved.stdout.trim()];
}

function findRepoRoot() {
    const gitResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: process.cwd(),
        encoding: "utf8",
    });
    if (gitResult.status !== 0) {
        throw new Error("Not inside a git repository");
    }
    return gitResult.stdout.trim();
}

function relativePath(filePath) {
    if (!repoRoot || !path.isAbsolute(filePath)) {
        return filePath;
    }
    const relative = path.relative(repoRoot, filePath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return filePath;
    }
    return relative || ".";
}

function normalizePaths(value) {
    if (Array.isArray(value)) {
        return value.map(normalizePaths);
    }

    if (value && typeof value === "object") {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            output[key] = normalizePathEntry(key, item);
        }
        return output;
    }

    return value;
}

function normalizePathEntry(key, item) {
    if (typeof item === "string" && isPathKey(key)) {
        return relativePath(item);
    }

    return normalizePaths(item);
}

function isPathKey(key) {
    return key === "path" || key.endsWith("_path") || key.endsWith("Path") || key === "file";
}

function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function writeJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
