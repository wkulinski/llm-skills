#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.resolve(skillDir, "..");
const repoRoot = findRepoRoot();
const args = parseOptions(process.argv.slice(2));
const phpactor = resolveTool("phpactor");
const rpcRequest = rewriteRequestPaths(buildRequest(args), phpactor);
const rpcResult = spawnSync(phpactor[0], [...phpactor.slice(1), "rpc"], {
    cwd: repoRoot,
    input: JSON.stringify(rpcRequest),
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
});

if (rpcResult.status !== 0) {
    writeJson({
        ok: false,
        tool: "phpactor",
        mode: "rpc",
        status: rpcResult.status,
        stderr: rpcResult.stderr.trim(),
        stdout: rpcResult.stdout.trim(),
    });
    process.exit(rpcResult.status ?? 1);
}

let payload;
try {
    payload = JSON.parse(rpcResult.stdout);
} catch (error) {
    writeJson({
        ok: false,
        tool: "phpactor",
        mode: "rpc",
        error: `Unable to parse phpactor JSON: ${error.message}`,
        stdoutPreview: rpcResult.stdout.slice(0, 2000),
        stderr: debugStderr(rpcResult.stderr),
    });
    process.exit(1);
}

const rpcSummary = summarizeAction(payload, parsePositiveInt(args.limit, 12));
writeJson({
    ok: true,
    tool: "phpactor",
    mode: "rpc",
    request: {
        action: rpcRequest.action,
        parameterKeys: Object.keys(rpcRequest.parameters ?? {}),
    },
    effects: collectEffects(rpcSummary),
    summary: rpcSummary,
    stderr: debugStderr(rpcResult.stderr),
});

function usage() {
    console.error(`Usage:
    phpactor-rpc.mjs --action <rpc_action> [--params-json <json> | --params-file <file>] [--limit <n>]
    phpactor-rpc.mjs --request-json <json> [--limit <n>]
    phpactor-rpc.mjs --request-file <file> [--limit <n>]`);
    process.exit(2);
}

function buildRequest(opts) {
    if (opts["request-json"] || opts["request-file"]) {
        const requestValue = readJsonOption(opts, "request");
        if (!requestValue || typeof requestValue !== "object" || !requestValue.action) {
            throw new Error("RPC request must be an object with an action field");
        }
        return requestValue;
    }

    const action = opts.action;
    if (!action) {
        usage();
    }

    const parameters = opts["params-json"] || opts["params-file"]
        ? readJsonOption(opts, "params")
        : {};

    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
        throw new Error("RPC parameters must be a JSON object");
    }

    return {action, parameters};
}

function readJsonOption(opts, prefix) {
    const jsonValue = opts[`${prefix}-json`];
    const fileValue = opts[`${prefix}-file`];
    if (jsonValue && fileValue) {
        throw new Error(`Use either --${prefix}-json or --${prefix}-file, not both`);
    }
    if (!jsonValue && !fileValue) {
        usage();
    }

    const raw = jsonValue ?? fs.readFileSync(absolutePath(fileValue), "utf8");
    return JSON.parse(raw);
}

function rewriteRequestPaths(request, toolCommand) {
    let toolRoot = null;
    return rewritePathObject(request, (value) => {
        const repoRelative = repoRelativePathCandidate(value);
        if (repoRelative === null) {
            return value;
        }

        toolRoot ??= findToolWorkingDir(toolCommand);
        return path.posix.join(toolRoot, ...repoRelative.split(path.sep));
    });
}

function rewritePathObject(value, rewritePath) {
    if (Array.isArray(value)) {
        return value.map((item) => rewritePathObject(item, rewritePath));
    }

    if (value && typeof value === "object") {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            output[key] = rewritePathEntry(key, item, rewritePath);
        }
        return output;
    }

    return value;
}

function rewritePathEntry(key, item, rewritePath) {
    if (typeof item === "string" && isPathKey(key)) {
        return rewritePath(item);
    }

    return rewritePathObject(item, rewritePath);
}

function repoRelativePathCandidate(value) {
    if (!value || value.startsWith("{") || value.startsWith("[")) {
        return null;
    }

    if (path.isAbsolute(value)) {
        const relative = path.relative(repoRoot, value);
        if (!relative.startsWith("..") && relative !== "") {
            return relative;
        }
        return null;
    }

    if (!value.includes("/") && !value.startsWith(".")) {
        return null;
    }

    const absolute = path.resolve(repoRoot, value);
    const parent = path.dirname(absolute);
    if (fs.existsSync(absolute) || fs.existsSync(parent)) {
        return path.relative(repoRoot, absolute);
    }

    return null;
}

function findToolWorkingDir(toolCommand) {
    if (process.env.PHP_STRUCTURE_TOOL_REPO_ROOT) {
        return process.env.PHP_STRUCTURE_TOOL_REPO_ROOT;
    }

    const statusResult = spawnSync(toolCommand[0], [...toolCommand.slice(1), "status", "--no-interaction", "--no-ansi"], {
        cwd: repoRoot,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
    });
    const match = statusResult.stdout.match(/^Working directory:\s*(.+)$/m);
    if (statusResult.status === 0 && match) {
        return match[1].trim();
    }

    return repoRoot;
}

function summarizeAction(action, limit) {
    const actionName = action.action ?? action.name;
    const parameters = action.parameters ?? {};

    const simpleSummary = summarizeSimpleAction(actionName, parameters);
    if (simpleSummary) {
        return simpleSummary;
    }

    if (actionName === "collection") {
        const actions = parameters.actions ?? [];
        return {
            action: actionName,
            totalActions: actions.length,
            actions: actions.slice(0, limit).map((item) => summarizeAction(item, limit)),
            omittedActions: Math.max(0, actions.length - limit),
        };
    }

    if (actionName === "file_references") {
        const references = parameters.references ?? parameters.file_references ?? [];
        const limitedReferences = references.slice(0, limit);
        const totalReferences = references.reduce((sum, entry) => sum + (entry.references ?? []).length, 0);
        return {
            action: actionName,
            totalFiles: references.length,
            totalReferences,
            shownFiles: limitedReferences.length,
            omittedFiles: Math.max(0, references.length - limitedReferences.length),
            files: limitedReferences.map((entry) => ({
                file: relativePath(entry.file ?? entry.path ?? ""),
                count: (entry.references ?? []).length,
                firstReferences: (entry.references ?? []).slice(0, 5).map((ref) => ({
                    line: ref.line_no ?? ref.line ?? null,
                    col: ref.col ?? ref.character ?? ref.col_no ?? null,
                })),
            })),
        };
    }

    if (actionName === "information") {
        const information = parseJsonString(parameters.information);
        if (information !== null) {
            return {
                action: actionName,
                value: compact(normalizePaths(information)),
            };
        }

        return {
            action: actionName,
            preview: String(parameters.information ?? "").slice(0, 1200),
        };
    }

    return {
        action: actionName,
        parameters: compact(normalizePaths(parameters)),
    };
}

function summarizeSimpleAction(actionName, parameters) {
    const handlers = {
        echo: () => ({action: actionName, preview: String(parameters.message ?? "").slice(0, 1200)}),
        error: () => ({action: actionName, message: String(parameters.message ?? "").slice(0, 1200)}),
        "input_callback": () => ({
            action: actionName,
            callback: parameters.callback ?? parameters.name ?? null,
            label: parameters.label ?? parameters.title ?? null,
            parameters: compact(normalizePaths(parameters)),
        }),
        "open_file": () => ({
            action: actionName,
            file: relativePath(parameters.path ?? ""),
            offset: parameters.offset ?? null,
        }),
        "replace_file_source": () => ({
            action: actionName,
            path: relativePath(parameters.path ?? ""),
            sourceLength: typeof parameters.source === "string" ? parameters.source.length : null,
        }),
        return: () => ({
            action: actionName,
            value: compact(normalizePaths(parameters.value)),
        }),
    };

    return handlers[actionName]?.() ?? null;
}

function collectEffects(actionSummary) {
    const effects = {
        hasInputCallback: false,
        hasReplaceFileSource: false,
    };

    visitSummary(actionSummary, (item) => {
        if (item.action === "input_callback") {
            effects.hasInputCallback = true;
        }
        if (item.action === "replace_file_source") {
            effects.hasReplaceFileSource = true;
        }
    });

    return effects;
}

function visitSummary(value, visitor) {
    if (Array.isArray(value)) {
        for (const item of value) {
            visitSummary(item, visitor);
        }
        return;
    }

    if (value && typeof value === "object") {
        visitor(value);
        for (const item of Object.values(value)) {
            visitSummary(item, visitor);
        }
    }
}

function compact(value) {
    if (Array.isArray(value)) {
        return value.slice(0, 50).map(compact);
    }

    if (value && typeof value === "object") {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            output[key] = compactEntry(item, 500);
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

function parseOptions(rawArgs) {
    const parsed = {};
    for (let index = 0; index < rawArgs.length; index += 1) {
        const rawKey = rawArgs[index];
        if (!rawKey.startsWith("--")) {
            usage();
        }

        const equalsIndex = rawKey.indexOf("=");
        if (equalsIndex > 0) {
            parsed[rawKey.slice(2, equalsIndex)] = rawKey.slice(equalsIndex + 1);
            continue;
        }

        const value = rawArgs[index + 1];
        if (value === void 0 || value.startsWith("--")) {
            usage();
        }

        parsed[rawKey.slice(2)] = value;
        index += 1;
    }
    return parsed;
}

function parsePositiveInt(value, fallback) {
    if (value === void 0) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return fallback;
    }

    return parsed;
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

function absolutePath(filePath) {
    return path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
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
        if (fs.existsSync(candidate) || fs.existsSync(path.dirname(candidate))) {
            return candidate;
        }
    }

    return filePath;
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
    return key === "path" || key === "file" || key.endsWith("_path") || key.endsWith("Path");
}

function parseJsonString(value) {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return null;
    }
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
