#!/usr/bin/env node

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.resolve(skillDir, '..');
const repoRoot = findRepoRoot();
const rawArgs = process.argv.slice(2);

if (rawArgs.length === 0) {
    usage();
}

const phpactor = resolveTool('phpactor');
let toolWorkingDirForOutput = null;
const args = normalizeArgs(rewritePathArgs(rawArgs, phpactor));
const result = spawnSync(phpactor[0], [...phpactor.slice(1), ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
});

const command = detectCommand(rawArgs);
const parsedJson = parseJsonOutput(result.stdout);
const ok = result.status === 0;

writeJson({
    ok,
    tool: 'phpactor',
    mode: 'cli',
    command,
    args: args.map(normalizeArgForOutput),
    status: result.status,
    json: parsedJson ? summarizeJson(parsedJson) : undefined,
    stdout: parsedJson ? undefined : summarizeText(result.stdout),
    stderr: debugStderr(result.stderr),
});

process.exit(ok ? 0 : (result.status ?? 1));

function usage() {
    console.error(`Usage:
    phpactor-cli.mjs <phpactor-command> [phpactor arguments/options...]

Examples:
    phpactor-cli.mjs list --format=json
    phpactor-cli.mjs help class:move --format=json
    phpactor-cli.mjs class:move src/Old.php src/New.php --type=file
    phpactor-cli.mjs offset:info src/Foo.php 123 --format=json`);
    process.exit(2);
}

function normalizeArgs(args) {
    const normalized = [...args];
    if (!hasOption(normalized, 'no-interaction') && !normalized.includes('-n')) {
        normalized.push('--no-interaction');
    }
    if (!hasOption(normalized, 'no-ansi')) {
        normalized.push('--no-ansi');
    }
    return normalized;
}

function rewritePathArgs(args, toolCommand) {
    let toolRoot = null;

    return args.map((arg) => {
        const rewritten = rewritePathValue(arg, () => {
            toolRoot ??= findToolWorkingDir(toolCommand);
            return toolRoot;
        });
        return rewritten;
    });
}

function rewritePathValue(value, toolRootResolver) {
    if (!value || value.startsWith('-') && !value.includes('=')) {
        return value;
    }

    const equalsIndex = value.indexOf('=');
    if (value.startsWith('--') && equalsIndex > 0) {
        const option = value.slice(0, equalsIndex + 1);
        const optionValue = value.slice(equalsIndex + 1);
        return `${option}${rewritePathValue(optionValue, toolRootResolver)}`;
    }

    const repoRelative = repoRelativePathCandidate(value);
    if (repoRelative === null) {
        return value;
    }

    return path.posix.join(toolRootResolver(), ...repoRelative.split(path.sep));
}

function repoRelativePathCandidate(value) {
    if (value.startsWith('{') || value.startsWith('[')) {
        return null;
    }

    if (path.isAbsolute(value)) {
        const relative = path.relative(repoRoot, value);
        if (!relative.startsWith('..') && relative !== '') {
            return relative;
        }
        return null;
    }

    if (!value.includes('/') && !value.startsWith('.')) {
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

    const result = spawnSync(toolCommand[0], [...toolCommand.slice(1), 'status', '--no-interaction', '--no-ansi'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
    });
    const match = result.stdout.match(/^Working directory:\s*(.+)$/m);
    if (result.status === 0 && match) {
        toolWorkingDirForOutput = match[1].trim();
        return toolWorkingDirForOutput;
    }

    return repoRoot;
}

function hasOption(args, name) {
    return args.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
}

function detectCommand(args) {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg.startsWith('-')) {
            return arg;
        }
        if (optionConsumesNextValue(arg) && !arg.includes('=')) {
            index += 1;
        }
    }
    return null;
}

function optionConsumesNextValue(option) {
    return [
        '--working-dir',
        '-d',
        '--config-extra',
        '--format',
        '--output-format',
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
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return trimmed;
    }

    const objectIndex = trimmed.indexOf('{');
    const arrayIndex = trimmed.indexOf('[');
    const indexes = [objectIndex, arrayIndex].filter((index) => index >= 0);
    if (indexes.length === 0) {
        return null;
    }

    return trimmed.slice(Math.min(...indexes));
}

function summarizeJson(payload) {
    if (payload && typeof payload === 'object' && Array.isArray(payload.commands)) {
        return summarizeCommandList(payload);
    }

    if (payload && typeof payload === 'object' && payload.name && payload.definition) {
        return summarizeCommandHelp(payload);
    }

    return compact(normalizePaths(payload));
}

function summarizeCommandList(payload) {
    const commands = payload.commands.map((command) => ({
        name: command.name,
        description: command.description,
        hidden: command.hidden || undefined,
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
            : undefined,
    };
}

function summarizeCommandHelp(payload) {
    const options = Object.values(payload.definition.options ?? {}).map((option) => ({
        name: option.name,
        shortcut: option.shortcut || undefined,
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
            hasDryRun: options.some((option) => option.name === '--dry-run'),
            hasFormat: options.some((option) => option.name === '--format' || option.name === '--output-format'),
            hasFilesystem: options.some((option) => option.name === '--filesystem'),
            hasNoInteraction: options.some((option) => option.name === '--no-interaction'),
        },
    };
}

function compact(value) {
    if (Array.isArray(value)) {
        return value.slice(0, 80).map(compact);
    }

    if (value && typeof value === 'object') {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string' && item.length > 800) {
                output[key] = `${item.slice(0, 800)}...`;
            } else {
                output[key] = compact(item);
            }
        }
        return output;
    }

    return value;
}

function summarizeText(stdout) {
    const text = normalizeToolText(stdout.trim());
    if (!text) {
        return undefined;
    }

    const lines = text.split('\n');
    return {
        lineCount: lines.length,
        preview: lines.slice(0, 80).join('\n'),
        omittedLines: Math.max(0, lines.length - 80),
    };
}

function normalizeToolText(text) {
    if (!text) {
        return text;
    }

    const toolRoots = new Set([repoRoot]);
    if (toolWorkingDirForOutput) {
        toolRoots.add(toolWorkingDirForOutput);
    }
    const workingDir = text.match(/^Working directory:\s*(.+)$/m);
    if (workingDir) {
        toolRoots.add(workingDir[1].trim());
    }

    let normalized = text;
    for (const root of toolRoots) {
        normalized = normalized.split(root).join('.');
    }
    return normalized;
}

function normalizeArgForOutput(arg) {
    const equalsIndex = arg.indexOf('=');
    if (arg.startsWith('--') && equalsIndex > 0) {
        return `${arg.slice(0, equalsIndex + 1)}${normalizeArgForOutput(arg.slice(equalsIndex + 1))}`;
    }

    if (path.isAbsolute(arg)) {
        return relativePath(arg);
    }

    return arg;
}

function resolveTool(tool) {
    const envLoadPath = path.join(skillsRoot, '_shared/scripts/env-load.sh');
    const script = `source ${shellQuote(envLoadPath)}; resolve_tool_cmd ${shellQuote(tool)}`;
    const resolved = spawnSync('bash', ['-lc', script], {
        cwd: repoRoot,
        encoding: 'utf8',
    });
    if (resolved.status !== 0 || !resolved.stdout.trim()) {
        throw new Error(`Unable to resolve tool: ${tool}`);
    }
    return [resolved.stdout.trim()];
}

function findRepoRoot() {
    const result = spawnSync('git', ['-C', skillDir, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error('Not inside a git repository');
    }
    return result.stdout.trim();
}

function relativePath(filePath) {
    if (!filePath) {
        return filePath;
    }
    return path.relative(repoRoot, normalizeToolPath(filePath)) || '.';
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

    if (value && typeof value === 'object') {
        const output = {};
        for (const [key, item] of Object.entries(value)) {
            if (typeof item === 'string' && isPathKey(key)) {
                output[key] = relativePath(item);
            } else {
                output[key] = normalizePaths(item);
            }
        }
        return output;
    }

    return value;
}

function isPathKey(key) {
    return key === 'path' || key.endsWith('_path') || key.endsWith('Path') || key === 'file';
}

function shellQuote(value) {
    return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function writeJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function debugStderr(stderr) {
    if (process.env.PHP_STRUCTURE_DEBUG !== '1') {
        return undefined;
    }

    return stderr.trim() || undefined;
}
