#!/usr/bin/env node

import {spawn, spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import {performance} from "node:perf_hooks";
import process from "node:process";
import {fileURLToPath, pathToFileURL} from "node:url";

const DEFAULT_CONFIG_REL_PATH = ".agents/qa-run.matrix.json";
const DEFAULT_CONFIG_TEMPLATE_REL_PATH = "../templates/qa-run.matrix.dist.json";
const CACHE_VERSION = 1;
const SNAPSHOT_VERSION = 1;
const SESSION_VERSION = 1;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_CONFIG = {
    failTailLines: 120,
    maxOutputBytes: 20000,
    outputMode: "quiet-on-pass",
    parser: "generic-tail",
    parserInputBytes: 5 * 1024 * 1024,
    stripAnsi: true,
};
const OUTPUT_MODES = new Set(["quiet-on-pass", "silent"]);
const PARSERS = new Set(["generic-tail", "phpstan-json", "eslint-json"]);
const MACHINE_PARSER_HINTS = [
    {
        commandPattern: /(?:^|[^a-z0-9_-])phpstan(?:[^a-z0-9_-]|$)/i,
        flagPattern: /--error-format(?:=|\s+)json/i,
        flagSuggestion: "--error-format=json",
        parser: "phpstan-json",
        tool: "PHPStan",
    },
    {
        commandPattern: /(?:^|[^a-z0-9_-])eslint(?:[^a-z0-9_-]|$)/i,
        flagPattern: /(?:--format(?:=|\s+)json|(?:^|\s)-f(?:=|\s+)json)/i,
        flagSuggestion: "--format json",
        parser: "eslint-json",
        tool: "ESLint",
    },
];
const GIT_VISIBLE_PATTERN_SET = "git-visible";
const BUILT_IN_PATTERN_SETS = {
    "php-source": [
        "**/*.php",
    ],
    "php-tooling": [
        "composer.json",
        "composer.lock",
        "phpstan*.neon",
        "phpstan*.neon.dist",
        "phpstan-baseline*.neon",
        "psalm*.xml",
        "psalm*.xml.dist",
        "phpunit*.xml",
        "phpunit*.xml.dist",
        "rector*.php",
        "ecs*.php",
        "pint.json",
        ".php-cs-fixer*.php",
        "deptrac*.yaml",
        "deptrac*.yml",
        "config/**/*.php",
        "config/**/*.yaml",
        "config/**/*.yml",
        "config/**/*.xml",
        "bin/**",
        "migrations/**/*.php",
        "stubs/**/*.php",
    ],
    "php-safe": [
        "@php-source",
        "@php-tooling",
    ],
    "js-ts-source": [
        "**/*.js",
        "**/*.jsx",
        "**/*.mjs",
        "**/*.cjs",
        "**/*.ts",
        "**/*.tsx",
        "**/*.mts",
        "**/*.cts",
        "**/*.vue",
        "**/*.svelte",
    ],
    "js-ts-tooling": [
        "package.json",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lock",
        "bun.lockb",
        "tsconfig*.json",
        "jsconfig*.json",
        "eslint.config.*",
        ".eslintrc",
        ".eslintrc.*",
        "prettier.config.*",
        ".prettierrc",
        ".prettierrc.*",
        "vitest.config.*",
        "vite.config.*",
        "jest.config.*",
        "babel.config.*",
        "postcss.config.*",
        "tailwind.config.*",
    ],
    "js-ts-tests": [
        "**/*.test.js",
        "**/*.test.jsx",
        "**/*.test.mjs",
        "**/*.test.cjs",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.js",
        "**/*.spec.jsx",
        "**/*.spec.mjs",
        "**/*.spec.cjs",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "tests/**/*.js",
        "tests/**/*.jsx",
        "tests/**/*.mjs",
        "tests/**/*.cjs",
        "tests/**/*.ts",
        "tests/**/*.tsx",
    ],
    "js-ts-safe": [
        "@js-ts-source",
        "@js-ts-tooling",
        "@js-ts-tests",
    ],
};

const RERUN_REASONS = new Set([
    "initial",
    "post-fix-delta",
    "review-fix-delta",
    "full-final-pass",
]);

function parseArgs(argv) {
    const args = [...argv];
    const result = {
        configPath: DEFAULT_CONFIG_REL_PATH,
        deltaFromSnapshotPath: null,
        help: false,
        noCache: false,
        rerunReason: "initial",
        sessionPath: null,
        snapshotOnly: false,
        snapshotWritePath: null,
    };

    while (args.length > 0) {
        const arg = args.shift();
        if (arg === "--help" || arg === "-h") {
            result.help = true;
            continue;
        }

        if (arg === "--config") {
            result.configPath = readRequiredArgValue(args, "--config");
            continue;
        }

        if (arg === "--delta-from-snapshot") {
            result.deltaFromSnapshotPath = readRequiredArgValue(args, "--delta-from-snapshot");
            continue;
        }

        if (arg === "--snapshot-only") {
            result.snapshotOnly = true;
            continue;
        }

        if (arg === "--no-cache") {
            result.noCache = true;
            continue;
        }

        if (arg === "--rerun-reason") {
            result.rerunReason = readRequiredArgValue(args, "--rerun-reason");
            continue;
        }

        if (arg === "--session") {
            result.sessionPath = readRequiredArgValue(args, "--session");
            continue;
        }

        if (arg === "--snapshot-write") {
            result.snapshotWritePath = readRequiredArgValue(args, "--snapshot-write");
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (result.snapshotOnly && !result.snapshotWritePath) {
        throw new Error("--snapshot-only requires --snapshot-write <path>.");
    }

    if (!RERUN_REASONS.has(result.rerunReason)) {
        throw new Error(
            `Invalid value for --rerun-reason: ${result.rerunReason}. Expected one of: ${[...RERUN_REASONS].join(", ")}.`
        );
    }

    return result;
}

function readRequiredArgValue(args, flagName) {
    const value = args.shift();
    if (value) {
        return value;
    }

    throw new Error(`Missing value for ${flagName}`);
}

function printHelp() {
    console.log(`Usage: node ./scripts/run-matrix.mjs [options]

Options:
  --config <path>                Use custom matrix JSON config.
  --rerun-reason <reason>        Rerun intent: initial | post-fix-delta | review-fix-delta | full-final-pass.
  --session <path>               Persist deterministic QA session ledger.
  --snapshot-write <path>        Write current dirty working-tree snapshot to JSON.
  --snapshot-only                Write snapshot and exit without running commands.
  --delta-from-snapshot <path>   Run only sections affected by changes since snapshot.
  --no-cache                     Ignore configured cache and execute commands normally.
  --help, -h                     Show this help.

Deterministic QA runner for $qa-run:
- detects changed files (tracked staged/unstaged + untracked),
- maps changes to configured sections,
- loads repo config from JSON,
- runs commands section by section (fail-fast on first command error),
- supports snapshot-based delta reruns after repair iterations,
- can persist a session ledger for deferred final full pass decisions,
- copies config from the bundled dist template when missing.

Default config path: ${DEFAULT_CONFIG_REL_PATH}`);
}

function run(command, args, options = {}) {
    return spawnSync(command, args, {
        encoding: "utf-8",
        ...options,
    });
}

function getRepoRoot() {
    const result = run("git", ["rev-parse", "--show-toplevel"]);
    if (result.status !== 0) {
        throw new Error("Not a git repository (git rev-parse failed).");
    }
    return result.stdout.trim();
}

function resolveRepoPath(repoRoot, maybeAbsPath) {
    return path.isAbsolute(maybeAbsPath)
        ? maybeAbsPath
        : path.join(repoRoot, maybeAbsPath);
}

function gitLines(repoRoot, args) {
    const result = run("git", args, {cwd: repoRoot});
    if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed.`);
    }
    return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

function detectChangedFiles(repoRoot) {
    const trackedUnstaged = gitLines(repoRoot, [
        "diff",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
    ]);
    const trackedStaged = gitLines(repoRoot, [
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
    ]);
    const untracked = gitLines(repoRoot, ["ls-files", "--others", "--exclude-standard"]);

    return [...new Set([...trackedUnstaged, ...trackedStaged, ...untracked])].sort();
}

function fingerprintDirtyFile(repoRoot, filePath) {
    const absPath = path.join(repoRoot, filePath);
    if (!existsSync(absPath)) {
        return {
            exists: false,
            hash: null,
        };
    }

    const content = readFileSync(absPath);
    return {
        exists: true,
        hash: createHash("sha256").update(content).digest("hex"),
    };
}

function collectWorkingTreeState(repoRoot) {
    const files = detectChangedFiles(repoRoot);
    const snapshotFiles = {};

    for (const filePath of files) {
        snapshotFiles[filePath] = fingerprintDirtyFile(repoRoot, filePath);
    }

    return {
        version: SNAPSHOT_VERSION,
        createdAt: new Date().toISOString(),
        files: snapshotFiles,
        repoRoot,
    };
}

function ensureConfig(configAbsPath) {
    if (existsSync(configAbsPath)) {
        return false;
    }

    const templateAbsPath = path.resolve(SCRIPT_DIR, DEFAULT_CONFIG_TEMPLATE_REL_PATH);
    if (!existsSync(templateAbsPath)) {
        throw new Error(`Default QA matrix template not found: ${templateAbsPath}`);
    }

    mkdirSync(path.dirname(configAbsPath), {recursive: true});
    copyFileSync(templateAbsPath, configAbsPath);
    return true;
}

function loadConfig(configAbsPath) {
    const raw = readConfigRaw(configAbsPath);
    return parseConfig(raw, configAbsPath);
}

function readConfigRaw(configAbsPath) {
    try {
        return readFileSync(configAbsPath, "utf-8");
    } catch (error) {
        throw new Error(`Cannot read config file: ${configAbsPath}`);
    }
}

function parseConfig(raw, configAbsPath) {
    const parsed = parseJsonConfig(raw, configAbsPath);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalizeConfig(parsed);
    }

    throw new Error("Config root must be a JSON object.");
}

function parseJsonConfig(raw, configAbsPath) {
    try {
        return JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON config: ${configAbsPath}`);
    }
}

function normalizeConfig(config) {
    const outputDefaults = normalizeOutputConfig("root outputDefaults", config.outputDefaults ?? {});
    const patternSets = normalizePatternSets(config.patternSets ?? {});
    const sections = normalizeSections(config, outputDefaults, patternSets);
    const sectionOrder = normalizeSectionOrder(config, sections);

    return {
        outputDefaults,
        patternSets,
        raw: config,
        sectionOrder,
        sections,
    };
}

function normalizeSections(config, outputDefaults, patternSets) {
    if (!config.sections || typeof config.sections !== "object" || Array.isArray(config.sections)) {
        throw new Error('Config field "sections" must be an object.');
    }

    const sections = {};
    for (const [sectionName, sectionConfig] of Object.entries(config.sections)) {
        sections[sectionName] = normalizeSectionConfig(sectionName, sectionConfig, outputDefaults, patternSets);
    }

    return sections;
}

function normalizeSectionOrder(config, sections) {
    if (!Array.isArray(config.sectionOrder)) {
        throw new Error('Config field "sectionOrder" must be an array of section names.');
    }

    const sectionOrder = normalizeRootStringList("sectionOrder", config.sectionOrder);
    const uniqueSectionOrder = [...new Set(sectionOrder)];
    for (const sectionName of uniqueSectionOrder) {
        if (!Object.hasOwn(sections, sectionName)) {
            throw new Error(`Config sectionOrder references missing section "${sectionName}".`);
        }
    }

    const unorderedSections = Object.keys(sections)
        .filter((sectionName) => !uniqueSectionOrder.includes(sectionName));
    if (unorderedSections.length > 0) {
        throw new Error(`Config sections missing from sectionOrder: ${unorderedSections.join(", ")}.`);
    }

    return uniqueSectionOrder;
}

function normalizeSectionConfig(sectionName, value, outputDefaults, patternSets) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" must be an object.`);
    }

    assertRequiredSectionField(sectionName, value, "commands");
    assertRequiredSectionField(sectionName, value, "patterns");
    assertRequiredSectionField(sectionName, value, "runOn");
    assertRequiredSectionField(sectionName, value, "requiresFinalFullPass");

    const sectionOutput = {
        ...DEFAULT_OUTPUT_CONFIG,
        ...outputDefaults,
        ...normalizeOutputConfig(`section "${sectionName}" output`, value.output ?? {}),
    };
    const patterns = normalizeStringList(sectionName, "patterns", value.patterns);
    const resolvedPatterns = resolvePatternEntries(patterns, patternSets);

    return {
        cache: normalizeSectionCacheConfig(sectionName, value.cache, resolvedPatterns),
        name: sectionName,
        commands: normalizeSectionCommandList(sectionName, value.commands, sectionOutput),
        output: sectionOutput,
        patterns,
        requiresFinalFullPass: normalizeBoolean(sectionName, "requiresFinalFullPass", value.requiresFinalFullPass),
        resolvedPatterns,
        runOn: normalizeRunOn(sectionName, value.runOn),
    };
}

function normalizePatternSets(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error('Config field "patternSets" must be an object.');
    }

    const result = {};
    for (const [name, entries] of Object.entries(value)) {
        const normalizedName = normalizePatternSetName(name);
        if (normalizedName === GIT_VISIBLE_PATTERN_SET || Object.hasOwn(BUILT_IN_PATTERN_SETS, normalizedName)) {
            throw new Error(`Config patternSets cannot override built-in pattern set "@${normalizedName}".`);
        }
        result[normalizedName] = normalizeRootStringList(`patternSets.${name}`, entries);
        if (result[normalizedName].length === 0) {
            throw new Error(`Config patternSets.${name} must contain at least one entry.`);
        }
    }

    for (const [name, entries] of Object.entries(result)) {
        validatePatternReferences(`patternSets.${name}`, entries, result);
    }
    for (const name of Object.keys(result)) {
        resolvePatternEntries([`@${name}`], result);
    }

    return result;
}

function normalizePatternSetName(name) {
    if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error("Config patternSets names must be non-empty strings.");
    }

    return name.trim().replace(/^@/, "");
}

function normalizeSectionCacheConfig(sectionName, value, resolvedPatterns) {
    if (value === undefined) {
        return {enabled: false, envKeys: []};
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" cache must be an object.`);
    }

    const allowedKeys = new Set(["enabled", "envKeys"]);
    const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
        throw new Error(
            `Config section "${sectionName}" cache supports only "enabled" and "envKeys"; unknown keys: ${unknownKeys.join(", ")}.`
        );
    }

    if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
        throw new Error(`Config section "${sectionName}" cache enabled must be a boolean.`);
    }

    const envKeys = value.envKeys === undefined
        ? []
        : normalizeCacheStringList(`section "${sectionName}" cache`, "envKeys", value.envKeys);

    if (value.enabled !== true) {
        return {enabled: false, envKeys: [...new Set(envKeys)].sort()};
    }

    if (!resolvedPatterns.includeGitVisible && resolvedPatterns.patterns.length === 0) {
        return {enabled: false, envKeys: [...new Set(envKeys)].sort()};
    }

    return {
        enabled: true,
        envKeys: [...new Set(envKeys)].sort(),
    };
}

function assertRequiredSectionField(sectionName, value, fieldName) {
    if (!Object.hasOwn(value, fieldName)) {
        throw new Error(`Config section "${sectionName}" field "${fieldName}" is required.`);
    }
}

function normalizeRootStringList(fieldName, value) {
    if (!Array.isArray(value)) {
        throw new Error(`Config field "${fieldName}" must be an array of strings.`);
    }

    const strings = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            throw new Error(`Config field "${fieldName}" must contain only strings.`);
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
            strings.push(trimmed);
        }
    }

    return strings;
}

function normalizeBoolean(sectionName, fieldName, value) {
    if (typeof value !== "boolean") {
        throw new Error(`Config section "${sectionName}" field "${fieldName}" must be a boolean.`);
    }

    return value;
}

function normalizeStringList(sectionName, fieldName, value) {
    if (!Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" field "${fieldName}" must be an array of strings.`);
    }

    const strings = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            throw new Error(`Config section "${sectionName}" field "${fieldName}" must contain only strings.`);
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
            strings.push(trimmed);
        }
    }

    return strings;
}

function normalizeRunOn(sectionName, value) {
    const runOn = normalizeStringList(sectionName, "runOn", value);
    for (const mode of runOn) {
        if (mode !== "full" && mode !== "rerun") {
            throw new Error(`Config section "${sectionName}" field "runOn" supports only "full" and "rerun".`);
        }
    }

    return [...new Set(runOn)];
}

function normalizeCommands(config, sectionName) {
    const section = config.sections[sectionName] ?? null;
    if (!section) {
        return [];
    }

    return section.commands;
}

function normalizeSectionCommandList(sectionName, value, sectionOutput) {
    if (!Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" must be an array of command strings/objects.`);
    }

    const commands = [];
    for (const entry of value) {
        if (typeof entry === "string") {
            const trimmed = entry.trim();
            if (trimmed.length > 0) {
                commands.push(normalizeCommandObject(sectionName, {cmd: trimmed}, sectionOutput));
            }
            continue;
        }

        commands.push(normalizeCommandObject(sectionName, entry, sectionOutput));
    }
    return commands;
}

function normalizeCommandObject(sectionName, entry, sectionOutput) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Config section "${sectionName}" command must be a string or object.`);
    }

    const command = typeof entry.cmd === "string" ? entry.cmd.trim() : "";

    if (command.length === 0) {
        throw new Error(`Config section "${sectionName}" command object requires non-empty "cmd".`);
    }

    const commandOutput = normalizeOutputConfig(`section "${sectionName}" command output`, entry.output ?? {});
    const inlineOutput = normalizeOutputConfig(`section "${sectionName}" command inline output`, {
        failTailLines: entry.failTailLines,
        maxOutputBytes: entry.maxOutputBytes,
        outputMode: entry.outputMode,
        parser: entry.parser,
        parserInputBytes: entry.parserInputBytes,
        stripAnsi: entry.stripAnsi,
    });

    if (entry.cache !== undefined) {
        throw new Error(`Config section "${sectionName}" command cache is not supported. Configure cache at section level.`);
    }

    return {
        cmd: command,
        output: {
            ...sectionOutput,
            ...commandOutput,
            ...inlineOutput,
        },
    };
}

function collectConfigNotices(config, activeSections) {
    const notices = [];
    for (const sectionName of config.sectionOrder) {
        if (!activeSections[sectionName]) {
            continue;
        }

        for (const command of normalizeCommands(config, sectionName)) {
            notices.push(...collectCommandConfigNotices(sectionName, command));
        }
    }

    return notices;
}

function collectCommandConfigNotices(sectionName, command) {
    const notices = [];
    for (const hint of MACHINE_PARSER_HINTS) {
        if (!hint.commandPattern.test(command.cmd)) {
            continue;
        }

        if (command.output.parser !== hint.parser) {
            notices.push({
                code: "machine-parser-available",
                command: command.cmd,
                message: `${hint.tool} command uses parser=${command.output.parser}; consider parser=${hint.parser} and ${hint.flagSuggestion}.`,
                parser: command.output.parser,
                recommendedParser: hint.parser,
                section: sectionName,
                severity: "NOTICE",
                tool: hint.tool,
            });
            continue;
        }

        if (!hint.flagPattern.test(command.cmd)) {
            notices.push({
                code: "machine-parser-flag-not-visible",
                command: command.cmd,
                message: `${hint.tool} command uses parser=${hint.parser}, but ${hint.flagSuggestion} is not visible in cmd; ensure the wrapper emits JSON.`,
                parser: command.output.parser,
                recommendedFlag: hint.flagSuggestion,
                section: sectionName,
                severity: "NOTICE",
                tool: hint.tool,
            });
        }
    }

    return notices;
}

function normalizeCacheStringList(context, fieldName, value) {
    if (!Array.isArray(value)) {
        throw new Error(`Config ${context} ${fieldName} must be an array of strings.`);
    }

    const strings = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            throw new Error(`Config ${context} ${fieldName} must contain only strings.`);
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
            strings.push(trimmed);
        }
    }

    return strings;
}

function validatePatternReferences(context, patterns, patternSets) {
    for (const entry of patterns) {
        if (!entry.startsWith("@")) {
            continue;
        }

        const name = normalizePatternSetName(entry);
        if (name === GIT_VISIBLE_PATTERN_SET) {
            continue;
        }

        if (!Object.hasOwn(BUILT_IN_PATTERN_SETS, name) && !Object.hasOwn(patternSets, name)) {
            throw new Error(`Config ${context} references unknown pattern set "@${name}".`);
        }
    }
}

function normalizeOutputConfig(context, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Config ${context} must be an object.`);
    }

    const normalized = {};
    if (value.outputMode !== undefined) {
        if (typeof value.outputMode !== "string" || !OUTPUT_MODES.has(value.outputMode)) {
            throw new Error(
                `Config ${context} outputMode must be one of: ${[...OUTPUT_MODES].join(", ")}.`
            );
        }
        normalized.outputMode = value.outputMode;
    }

    if (value.failTailLines !== undefined) {
        normalized.failTailLines = normalizePositiveInteger(context, "failTailLines", value.failTailLines);
    }

    if (value.maxOutputBytes !== undefined) {
        normalized.maxOutputBytes = normalizePositiveInteger(context, "maxOutputBytes", value.maxOutputBytes);
    }

    if (value.stripAnsi !== undefined) {
        if (typeof value.stripAnsi !== "boolean") {
            throw new Error(`Config ${context} stripAnsi must be a boolean.`);
        }
        normalized.stripAnsi = value.stripAnsi;
    }

    if (value.parser !== undefined) {
        normalized.parser = normalizeParser(context, value.parser);
    }

    if (value.parserInputBytes !== undefined) {
        normalized.parserInputBytes = normalizePositiveInteger(context, "parserInputBytes", value.parserInputBytes);
    }

    return normalized;
}

function normalizePositiveInteger(context, fieldName, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Config ${context} ${fieldName} must be a positive integer.`);
    }

    return value;
}

function normalizeParser(context, value) {
    if (typeof value === "string") {
        if (!PARSERS.has(value)) {
            throw new Error(`Config ${context} parser must be one of: ${[...PARSERS].join(", ")}.`);
        }
        return value;
    }

    throw new Error(`Config ${context} parser must be a string.`);
}

function writeSnapshot(snapshotAbsPath, workingTreeState) {
    mkdirSync(path.dirname(snapshotAbsPath), {recursive: true});
    writeFileSync(snapshotAbsPath, `${JSON.stringify(workingTreeState, null, 2)}\n`, "utf-8");
}

function loadSnapshot(snapshotAbsPath) {
    let raw;
    try {
        raw = readFileSync(snapshotAbsPath, "utf-8");
    } catch (error) {
        throw new Error(`Cannot read snapshot file: ${snapshotAbsPath}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON snapshot: ${snapshotAbsPath}`);
    }

    validateSnapshot(parsed, snapshotAbsPath);
    return parsed;
}

function validateSnapshot(snapshot, snapshotAbsPath) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new Error(`Snapshot must be a JSON object: ${snapshotAbsPath}`);
    }

    if (snapshot.version !== SNAPSHOT_VERSION) {
        throw new Error(
            `Unsupported snapshot version in ${snapshotAbsPath}: ${snapshot.version ?? "missing"}`
        );
    }

    if (!snapshot.files || typeof snapshot.files !== "object" || Array.isArray(snapshot.files)) {
        throw new Error(`Snapshot "files" must be an object: ${snapshotAbsPath}`);
    }

    for (const [filePath, fingerprint] of Object.entries(snapshot.files)) {
        if (!fingerprint || typeof fingerprint !== "object" || Array.isArray(fingerprint)) {
            throw new Error(`Invalid fingerprint for "${filePath}" in ${snapshotAbsPath}`);
        }

        if (typeof fingerprint.exists !== "boolean") {
            throw new Error(`Snapshot fingerprint "exists" must be boolean for "${filePath}"`);
        }

        const hashIsValid = fingerprint.hash === null || typeof fingerprint.hash === "string";
        if (!hashIsValid) {
            throw new Error(`Snapshot fingerprint "hash" must be string|null for "${filePath}"`);
        }
    }
}

function fingerprintEquals(left, right) {
    if (!left && !right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    return left.exists === right.exists && left.hash === right.hash;
}

function detectChangedFilesFromSnapshot(currentState, snapshot) {
    const currentFiles = currentState.files ?? {};
    const snapshotFiles = snapshot.files ?? {};
    const allFiles = new Set([
        ...Object.keys(snapshotFiles),
        ...Object.keys(currentFiles),
    ]);

    return [...allFiles]
        .filter((filePath) => !fingerprintEquals(snapshotFiles[filePath], currentFiles[filePath]))
        .sort();
}

function detectActiveSections(files, config, mode) {
    const active = {};
    const runKind = mode === "full" ? "full" : "rerun";

    for (const sectionName of config.sectionOrder) {
        const section = config.sections[sectionName];
        active[sectionName] = isSectionActive(section, files, runKind);
    }

    return active;
}

function isSectionActive(section, files, runKind) {
    if (!section.runOn.includes(runKind)) {
        return false;
    }

    if (section.name === "ALWAYS_FULL") {
        return runKind === "full";
    }

    if (section.name === "ALWAYS_ON_RERUN") {
        return runKind === "rerun" && files.length > 0;
    }

    return files.some((file) => matchesResolvedPatterns(section.resolvedPatterns, file));
}

function matchesResolvedPatterns(resolvedPatterns, filePath) {
    if (resolvedPatterns.includeGitVisible) {
        return true;
    }

    return resolvedPatterns.patterns.some((pattern) => matchGlob(pattern, filePath));
}

function matchGlob(pattern, filePath) {
    return globToRegExp(pattern).test(filePath);
}

function globToRegExp(pattern) {
    let source = "^";

    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
        if (char === "*") {
            const replacement = starGlobReplacement(pattern, index);
            source += replacement.source;
            index += replacement.consumed;
            continue;
        }

        if (char === "?") {
            source += "[^/]";
            continue;
        }

        source += escapeRegExp(char);
    }

    source += "$";
    return new RegExp(source);
}

function starGlobReplacement(pattern, index) {
    if (pattern[index + 1] !== "*") {
        return {source: "[^/]*", consumed: 0};
    }

    if (pattern[index + 2] === "/") {
        return {source: "(?:.*/)?", consumed: 2};
    }

    return {source: ".*", consumed: 1};
}

function escapeRegExp(char) {
    return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function getActiveSectionNames(activeSections) {
    return Object.entries(activeSections)
        .filter(([, isActive]) => isActive)
        .map(([sectionName]) => sectionName);
}

function assessRiskForFullFinalPass(activeSections, config) {
    const changedSections = getActiveSectionNames(activeSections)
        .filter((sectionName) => sectionName !== "ALWAYS_FULL" && sectionName !== "ALWAYS_ON_RERUN");
    const reasons = [];

    for (const section of changedSections) {
        if (config.sections[section]?.requiresFinalFullPass) {
            reasons.push(`section_requires_final_full_pass:${section}`);
        }
    }

    return {
        changedSections,
        reasons,
        shouldRunFullFinalPass: reasons.length > 0,
    };
}

function includeSessionRiskForFullFinalPass(riskAssessment, session, config, mode) {
    const matrixChangedSinceLastFullPass = mode === "delta"
        && session.lastFullPass?.matrixHash
        && session.lastFullPass.matrixHash !== hashJson(config.raw);

    if (!matrixChangedSinceLastFullPass) {
        return riskAssessment;
    }

    return {
        ...riskAssessment,
        reasons: [
            ...new Set([
                ...riskAssessment.reasons,
                "matrix_changed_since_last_full_pass",
            ]),
        ],
        shouldRunFullFinalPass: true,
    };
}

async function runSectionCommands(repoRoot, section, commands, artifacts, commandCounter, config, cli) {
    const executed = [];
    for (const command of commands) {
        const commandIndex = commandCounter.next();
        const commandResult = await executeCommand(repoRoot, section, command, artifacts, commandIndex, config, cli);
        executed.push(commandResult);
        if (!isSuccessfulCommandStatus(commandResult.status)) {
            return {ok: false, exitCode: commandResult.exitCode, executed, failure: commandResult};
        }
    }

    return {ok: true, exitCode: 0, executed, failure: null};
}

async function executeCommand(repoRoot, section, command, artifacts, commandIndex, config, cli) {
    const commandCache = prepareCommandCache(repoRoot, section, command, config, cli);
    if (commandCache.enabled) {
        const cacheHit = readCommandCache(commandCache);
        if (cacheHit) {
            const logs = createCommandLogs(repoRoot, artifacts.commandsDir, commandIndex, section.name, command.cmd);
            writeCachedCommandLogs(logs, cacheHit);
            const cachedResult = buildCachedCommandResult(section.name, command, cacheHit, logs);
            printCommandResult(cachedResult, command.output);
            return cachedResult;
        }
    }

    console.log(`RUN [${section.name}] ${command.cmd}`);
    const startedAt = performance.now();
    const logs = createCommandLogs(repoRoot, artifacts.commandsDir, commandIndex, section.name, command.cmd);
    const stdoutCollector = createOutputCollector(command.output.maxOutputBytes, command.output.parserInputBytes);
    const stderrCollector = createOutputCollector(command.output.maxOutputBytes, command.output.parserInputBytes);
    const result = await spawnCommandToLogs(repoRoot, command.cmd, logs, stdoutCollector, stderrCollector);
    const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
    const stdoutTail = stdoutCollector.tailContent();
    const stderrTail = stderrCollector.tailContent();
    const stdoutParserInput = stdoutCollector.parserContent();
    const stderrParserInput = stderrCollector.parserContent();
    const exitCode = result.error ? 1 : result.exitCode;
    const status = result.error ? "ERROR" : exitCode === 0 ? "PASS" : "FAIL";
    const failureSummary = status === "PASS"
        ? []
        : buildFailureSummary(
            command.output,
            stdoutTail,
            stderrTail,
            result.error?.message ?? "",
            stdoutParserInput,
            stderrParserInput
        );

    const commandResult = {
        command: command.cmd,
        commandHash: hashJson(command.cmd),
        durationMs,
        exitCode,
        parser: command.output.parser,
        section: section.name,
        status,
        stderrLog: logs.stderrLog,
        stdoutLog: logs.stdoutLog,
        summary: failureSummary,
    };

    if (result.error) {
        commandResult.error = result.error.message;
    }

    printCommandResult(commandResult, command.output);
    if (commandCache.enabled && commandResult.status === "PASS") {
        const completedCache = prepareCompletedCommandCache(repoRoot, section, command, config, commandCache);
        writeCommandCache(completedCache, commandResult, artifacts);
    }
    return commandResult;
}

function isSuccessfulCommandStatus(status) {
    return status === "PASS" || status === "SKIP-CACHED";
}

function prepareCommandCache(repoRoot, section, command, config, cli) {
    if (cli.noCache || cli.rerunReason !== "post-fix-delta" && cli.rerunReason !== "review-fix-delta") {
        return {enabled: false};
    }

    if (!section.cache.enabled) {
        return {enabled: false};
    }

    return createCommandCache(repoRoot, buildCommandCacheFingerprint(repoRoot, section, command, config));
}

function prepareCompletedCommandCache(repoRoot, section, command, config, startedCache) {
    const completedCache = createCommandCache(
        repoRoot,
        buildCommandCacheFingerprint(repoRoot, section, command, config)
    );

    return {
        ...completedCache,
        beforeFingerprint: startedCache.fingerprint,
        mutatedInputs: startedCache.fingerprint.cacheKey !== completedCache.fingerprint.cacheKey,
    };
}

function createCommandCache(repoRoot, fingerprint) {
    const cacheRoot = path.join(getCacheRoot(repoRoot), "qa-run", "cache", `v${CACHE_VERSION}`);
    return {
        enabled: true,
        fingerprint,
        path: path.join(cacheRoot, `${fingerprint.cacheKey}.json`),
    };
}

function buildCommandCacheFingerprint(repoRoot, section, command, config) {
    const inputFiles = collectPatternFiles(repoRoot, section.resolvedPatterns);
    const inputFingerprints = {};
    for (const filePath of inputFiles) {
        inputFingerprints[filePath] = fingerprintDirtyFile(repoRoot, filePath);
    }
    const env = {};
    for (const key of section.cache.envKeys) {
        env[key] = process.env[key] ?? null;
    }

    const material = {
        cacheVersion: CACHE_VERSION,
        command: command.cmd,
        env,
        inputFingerprints,
        patternSets: section.resolvedPatterns.patternSets,
        patterns: section.resolvedPatterns.patterns,
        matrixHash: hashJson(config.raw),
        section: section.name,
    };

    return {
        cacheKey: hashJson(material),
        envHash: hashJson(env),
        inputFilesHash: hashJson(inputFingerprints),
        patternSets: section.resolvedPatterns.patternSets,
        patterns: section.resolvedPatterns.patterns,
        materialHash: hashJson(material),
    };
}

function resolvePatternEntries(entries, patternSets) {
    const state = {
        includeGitVisible: false,
        patternSets: [],
        patterns: [],
    };

    for (const entry of entries) {
        resolvePatternEntry(entry, patternSets, state, []);
    }

    return {
        includeGitVisible: state.includeGitVisible,
        patternSets: [...new Set(state.patternSets)].sort(),
        patterns: [...new Set(state.patterns)].sort(),
    };
}

function resolvePatternEntry(entry, patternSets, state, stack) {
    if (!entry.startsWith("@")) {
        state.patterns.push(entry);
        return;
    }

    const name = normalizePatternSetName(entry);
    if (name === GIT_VISIBLE_PATTERN_SET) {
        state.includeGitVisible = true;
        state.patternSets.push(`@${name}`);
        return;
    }

    if (stack.includes(name)) {
        throw new Error(`Circular pattern set reference: ${[...stack, name].map((item) => `@${item}`).join(" -> ")}.`);
    }

    const entries = Object.hasOwn(BUILT_IN_PATTERN_SETS, name)
        ? BUILT_IN_PATTERN_SETS[name]
        : patternSets[name];
    if (!entries) {
        throw new Error(`Unknown pattern set "@${name}".`);
    }

    state.patternSets.push(`@${name}`);
    for (const nestedEntry of entries) {
        resolvePatternEntry(nestedEntry, patternSets, state, [...stack, name]);
    }
}

function collectPatternFiles(repoRoot, resolvedPatterns) {
    const visibleFiles = listGitVisibleFiles(repoRoot);
    if (resolvedPatterns.includeGitVisible) {
        return visibleFiles;
    }

    return visibleFiles
        .filter((filePath) => resolvedPatterns.patterns.some((pattern) => matchGlob(pattern, filePath)))
        .sort();
}

function listGitVisibleFiles(repoRoot) {
    const tracked = gitLines(repoRoot, ["ls-files"]);
    const untracked = gitLines(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
    return [...new Set([...tracked, ...untracked])].sort();
}

function readCommandCache(commandCache) {
    if (!existsSync(commandCache.path)) {
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(readFileSync(commandCache.path, "utf-8"));
    } catch (error) {
        return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }

    if (
        parsed.version !== CACHE_VERSION
        || parsed.status !== "PASS"
        || parsed.fingerprint?.cacheKey !== commandCache.fingerprint.cacheKey
    ) {
        return null;
    }

    return parsed;
}

function buildCachedCommandResult(section, command, cacheHit, logs) {
    return {
        cache: {
            beforeCacheKey: cacheHit.beforeFingerprint?.cacheKey ?? cacheHit.fingerprint.cacheKey,
            cacheKey: cacheHit.fingerprint.cacheKey,
            hit: true,
            mutatedInputs: cacheHit.mutatedInputs === true,
            previousArtifactsDir: cacheHit.artifactsDir,
            previousPassedAt: cacheHit.completedAt,
            previousStderrLog: cacheHit.stderrLog,
            previousStdoutLog: cacheHit.stdoutLog,
        },
        cached: true,
        command: command.cmd,
        commandHash: hashJson(command.cmd),
        durationMs: 0,
        exitCode: 0,
        parser: command.output.parser,
        section,
        status: "SKIP-CACHED",
        stderrLog: logs.stderrLog,
        stdoutLog: logs.stdoutLog,
        summary: [],
    };
}

function writeCachedCommandLogs(logs, cacheHit) {
    const lines = [
        "SKIP-CACHED",
        `previous_pass=${cacheHit.completedAt}`,
        `previous_artifacts=${cacheHit.artifactsDir}`,
        `previous_stdout=${cacheHit.stdoutLog}`,
        `previous_stderr=${cacheHit.stderrLog}`,
        `cache_key=${cacheHit.fingerprint.cacheKey}`,
        `mutated_inputs=${cacheHit.mutatedInputs === true ? "1" : "0"}`,
    ];
    writeFileSync(logs.stdoutAbsPath, `${lines.join("\n")}\n`, "utf-8");
    writeFileSync(logs.stderrAbsPath, "", "utf-8");
}

function writeCommandCache(commandCache, commandResult, artifacts) {
    mkdirSync(path.dirname(commandCache.path), {recursive: true});
    const entry = {
        artifactsDir: artifacts.relativeDir,
        command: commandResult.command,
        commandHash: commandResult.commandHash,
        completedAt: new Date().toISOString(),
        durationMs: commandResult.durationMs,
        exitCode: commandResult.exitCode,
        beforeFingerprint: commandCache.beforeFingerprint ?? commandCache.fingerprint,
        fingerprint: commandCache.fingerprint,
        mutatedInputs: commandCache.mutatedInputs === true,
        parser: commandResult.parser,
        section: commandResult.section,
        status: "PASS",
        stderrLog: commandResult.stderrLog,
        stdoutLog: commandResult.stdoutLog,
        version: CACHE_VERSION,
    };
    writeFileSync(commandCache.path, `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
}

function createCommandLogs(repoRoot, commandsDir, commandIndex, section, command) {
    mkdirSync(commandsDir, {recursive: true});
    const commandHash = createHash("sha256").update(command).digest("hex").slice(0, 12);
    const prefix = `${String(commandIndex).padStart(3, "0")}-${sanitizePathPart(section)}-${commandHash}`;
    const stdoutPath = path.join(commandsDir, `${prefix}.stdout.log`);
    const stderrPath = path.join(commandsDir, `${prefix}.stderr.log`);

    return {
        stderrAbsPath: stderrPath,
        stderrLog: toRepoRelativePath(repoRoot, stderrPath),
        stdoutAbsPath: stdoutPath,
        stdoutLog: toRepoRelativePath(repoRoot, stdoutPath),
    };
}

function spawnCommandToLogs(repoRoot, command, logs, stdoutCollector, stderrCollector) {
    return new Promise((resolve) => {
        const stdoutStream = createWriteStream(logs.stdoutAbsPath);
        const stderrStream = createWriteStream(logs.stderrAbsPath);
        const child = spawn("bash", ["-c", command], {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
        });
        let spawnError = null;

        child.stdout.on("data", (chunk) => {
            stdoutStream.write(chunk);
            stdoutCollector.append(chunk);
        });
        child.stderr.on("data", (chunk) => {
            stderrStream.write(chunk);
            stderrCollector.append(chunk);
        });
        child.on("error", (error) => {
            spawnError = error;
        });
        child.on("close", (exitCode) => {
            stdoutStream.end(() => {
                stderrStream.end(() => {
                    resolve({
                        error: spawnError,
                        exitCode: exitCode ?? 1,
                    });
                });
            });
        });
    });
}

function createOutputCollector(maxTailBytes, maxParserBytes) {
    const parserChunks = [];
    const tailChunks = [];
    let parserBytes = 0;
    let tailBytes = 0;

    return {
        append(chunk) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            if (parserBytes < maxParserBytes) {
                const remainingParserBytes = maxParserBytes - parserBytes;
                const parserChunk = buffer.length <= remainingParserBytes
                    ? buffer
                    : buffer.subarray(0, remainingParserBytes);
                parserChunks.push(parserChunk);
                parserBytes += parserChunk.length;
            }

            tailChunks.push(buffer);
            tailBytes += buffer.length;

            while (tailBytes > maxTailBytes && tailChunks.length > 0) {
                const first = tailChunks[0];
                const overflow = tailBytes - maxTailBytes;
                if (first.length <= overflow) {
                    tailChunks.shift();
                    tailBytes -= first.length;
                    continue;
                }

                tailChunks[0] = first.subarray(overflow);
                tailBytes -= overflow;
            }
        },
        parserContent() {
            return Buffer.concat(parserChunks).toString("utf-8");
        },
        tailContent() {
            return Buffer.concat(tailChunks).toString("utf-8");
        },
    };
}

function printCommandResult(commandResult, outputConfig) {
    const durationSeconds = (commandResult.durationMs / 1000).toFixed(1);
    const logInfo = `stdout=${commandResult.stdoutLog} stderr=${commandResult.stderrLog}`;
    if (commandResult.status === "SKIP-CACHED") {
        console.log(
            `SKIP-CACHED [${commandResult.section}] ${commandResult.command} previous_pass=${commandResult.cache.previousPassedAt} ${logInfo}`
        );
        return;
    }

    if (commandResult.status === "PASS") {
        console.log(`PASS [${commandResult.section}] ${commandResult.command} duration=${durationSeconds}s ${logInfo}`);
        return;
    }

    console.error(
        `${commandResult.status} [${commandResult.section}] ${commandResult.command} exit=${commandResult.exitCode} duration=${durationSeconds}s ${logInfo}`
    );

    if (commandResult.error) {
        console.error(`Error: ${commandResult.error}`);
    }

    if (outputConfig.outputMode !== "silent" && commandResult.summary.length > 0) {
        console.error("Failure summary:");
        for (const line of commandResult.summary) {
            console.error(`- ${line}`);
        }
    }
}

function buildFailureSummary(outputConfig, stdoutTail, stderrTail, errorMessage, stdoutParserInput, stderrParserInput) {
    const textParts = [stdoutTail, stderrTail, errorMessage].filter((part) => part && part.length > 0);
    const combinedTail = textParts.join("\n");
    const summary = parseFailureSummary(
        outputConfig.parser,
        stdoutParserInput,
        stderrParserInput,
        combinedTail
    );
    return limitSummaryLines(summary, outputConfig);
}

function parseFailureSummary(parser, stdout, stderr, combined) {
    if (parser === "phpstan-json") {
        const parsed = parsePhpStanJson(stdout) ?? parsePhpStanJson(stderr);
        if (parsed && parsed.length > 0) {
            return parsed;
        }
    }

    if (parser === "eslint-json") {
        const parsed = parseEslintJson(stdout) ?? parseEslintJson(stderr);
        if (parsed && parsed.length > 0) {
            return parsed;
        }
    }

    return genericTail(combined);
}

function parsePhpStanJson(text) {
    const parsed = parseJsonOrNull(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }

    const lines = [];
    if (Array.isArray(parsed.errors)) {
        for (const error of parsed.errors) {
            if (typeof error === "string") {
                lines.push(error);
            }
        }
    }

    if (parsed.files && typeof parsed.files === "object" && !Array.isArray(parsed.files)) {
        for (const [filePath, fileReport] of Object.entries(parsed.files)) {
            const messages = Array.isArray(fileReport?.messages) ? fileReport.messages : [];
            for (const message of messages) {
                const line = Number.isInteger(message?.line) ? `:${message.line}` : "";
                const textMessage = typeof message?.message === "string" ? message.message : JSON.stringify(message);
                lines.push(`${filePath}${line} ${textMessage}`);
            }
        }
    }

    return lines;
}

function parseEslintJson(text) {
    const parsed = parseJsonOrNull(text);
    if (!Array.isArray(parsed)) {
        return null;
    }

    const lines = [];
    for (const fileReport of parsed) {
        const filePath = typeof fileReport?.filePath === "string" ? fileReport.filePath : "unknown-file";
        const messages = Array.isArray(fileReport?.messages) ? fileReport.messages : [];
        for (const message of messages) {
            const line = Number.isInteger(message?.line) ? `:${message.line}` : "";
            const column = Number.isInteger(message?.column) ? `:${message.column}` : "";
            const rule = typeof message?.ruleId === "string" && message.ruleId.length > 0
                ? ` [${message.ruleId}]`
                : "";
            const textMessage = typeof message?.message === "string" ? message.message : JSON.stringify(message);
            lines.push(`${filePath}${line}${column}${rule} ${textMessage}`);
        }
    }

    return lines;
}

function parseJsonOrNull(text) {
    if (!text || text.trim().length === 0) {
        return null;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

function genericTail(text) {
    return text
        .split("\n")
        .map((line) => line.trimEnd())
        .filter((line) => line.trim().length > 0);
}

function limitSummaryLines(lines, outputConfig) {
    const normalized = lines.map((line) => outputConfig.stripAnsi ? stripAnsi(line) : line);
    const maxBytes = outputConfig.maxOutputBytes;
    const tailLines = normalized.slice(-outputConfig.failTailLines);
    const limited = [];
    let usedBytes = 0;

    for (const line of tailLines.reverse()) {
        const lineBytes = Buffer.byteLength(line, "utf-8");
        if (usedBytes + lineBytes > maxBytes && limited.length > 0) {
            break;
        }
        limited.push(truncateLineToBytes(line, maxBytes));
        usedBytes += Math.min(lineBytes, maxBytes);
    }

    return limited.reverse();
}

function truncateLineToBytes(line, maxBytes) {
    if (Buffer.byteLength(line, "utf-8") <= maxBytes) {
        return line;
    }

    const suffix = " ...[truncated]";
    const suffixBytes = Buffer.byteLength(suffix, "utf-8");
    const buffer = Buffer.from(line, "utf-8").subarray(0, Math.max(0, maxBytes - suffixBytes));
    return `${buffer.toString("utf-8")}${suffix}`;
}

function stripAnsi(text) {
    return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function sanitizePathPart(value) {
    return value
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "command";
}

function toRepoRelativePath(repoRoot, absPath) {
    return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

function enforceRerunReasonConsistency(cli) {
    if (cli.snapshotOnly) {
        return;
    }

    if (cli.rerunReason === "initial") {
        if (cli.deltaFromSnapshotPath) {
            throw new Error(
                'Initial rerun cannot use --delta-from-snapshot. Use --rerun-reason post-fix-delta instead.'
            );
        }

        return;
    }

    if (cli.rerunReason === "post-fix-delta" || cli.rerunReason === "review-fix-delta") {
        if (!cli.deltaFromSnapshotPath) {
            throw new Error(
                'Delta rerun requires --delta-from-snapshot <path>.'
            );
        }

        return;
    }

    if (cli.rerunReason === "full-final-pass" && cli.deltaFromSnapshotPath) {
        throw new Error(
            'Full final pass cannot use --delta-from-snapshot. Run it as a full rerun after a successful delta rerun.'
        );
    }
}

function createArtifacts(repoRoot, rerunReason) {
    const cacheRoot = getCacheRoot(repoRoot);
    const runId = `${formatDateForPath(new Date())}-${process.pid}-${sanitizePathPart(rerunReason)}`;
    const artifactsDir = path.join(cacheRoot, "qa-run", runId);
    const commandsDir = path.join(artifactsDir, "commands");
    mkdirSync(commandsDir, {recursive: true});

    return {
        commandsDir,
        dir: artifactsDir,
        relativeDir: toRepoRelativePath(repoRoot, artifactsDir),
        summaryJsonAbs: path.join(artifactsDir, "summary.json"),
        summaryJson: toRepoRelativePath(repoRoot, path.join(artifactsDir, "summary.json")),
        summaryTxtAbs: path.join(artifactsDir, "summary.txt"),
        summaryTxt: toRepoRelativePath(repoRoot, path.join(artifactsDir, "summary.txt")),
    };
}

function getCacheRoot(repoRoot) {
    const rawCachePath = stripWrappingQuotes(process.env.CACHE_PATH ?? "var/agent/cache");
    return path.isAbsolute(rawCachePath)
        ? rawCachePath
        : path.join(repoRoot, rawCachePath);
}

function stripWrappingQuotes(value) {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

function formatDateForPath(date) {
    return date.toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+$/, "")
        .replace("T", "-");
}

function printDetectedChanges(mode, rerunReason, files, activeSections, config, snapshotAbsPath = null, artifacts = null) {
    console.log("Detected changes:");
    console.log(`- mode=${mode}`);
    console.log(`- rerun_reason=${rerunReason}`);
    if (artifacts) {
        console.log(`- artifacts=${artifacts.relativeDir}`);
    }
    if (snapshotAbsPath) {
        console.log(`- delta_from_snapshot=${snapshotAbsPath}`);
    }
    console.log(`- files_count=${files.length}`);
    for (const section of config.sectionOrder) {
        console.log(`- ${section}=${activeSections[section] ? 1 : 0}`);
    }
}

function printConfigNotices(configNotices) {
    if (configNotices.length === 0) {
        return;
    }

    console.log("\nConfig notices:");
    for (const notice of configNotices) {
        console.log(`NOTICE [${notice.section}] ${notice.message}`);
    }
}

function printSummary(executed, skippedNoChanges, skippedNoCommands, artifacts) {
    const cachedCommands = executed.filter((command) => command.status === "SKIP-CACHED").length;
    const executedCommands = executed.length - cachedCommands;
    console.log("\nSummary:");
    console.log(`- commands_total=${executed.length}`);
    console.log(`- executed_commands=${executedCommands}`);
    console.log(`- cached_commands=${cachedCommands}`);
    console.log(
        `- skipped_no_changes=${skippedNoChanges.length > 0 ? skippedNoChanges.join(", ") : "none"}`
    );
    console.log(
        `- skipped_no_commands=${skippedNoCommands.length > 0 ? skippedNoCommands.join(", ") : "none"}`
    );

    if (executed.length === 0) {
        console.log("Result: no commands executed.");
    } else {
        console.log("Result: all commands passed or were skipped by cache.");
    }
    console.log(`- artifacts=${artifacts.relativeDir}`);
    console.log(`- summary_json=${artifacts.summaryJson}`);
}

function printRiskSummary(riskAssessment) {
    console.log("\nRisk evaluation:");
    console.log(
        `- changed_sections=${riskAssessment.changedSections.length > 0 ? riskAssessment.changedSections.join(", ") : "none"}`
    );
    console.log(
        `- pending_final_full_pass=${riskAssessment.shouldRunFullFinalPass ? 1 : 0}`
    );
    console.log(
        `- pending_final_full_pass_reasons=${riskAssessment.reasons.length > 0 ? riskAssessment.reasons.join(", ") : "none"}`
    );
}

function hashJson(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function loadSession(sessionAbsPath) {
    if (!sessionAbsPath || !existsSync(sessionAbsPath)) {
        return {
            version: SESSION_VERSION,
            pendingFinalFullPass: false,
            pendingReasons: [],
        };
    }

    let raw;
    try {
        raw = readFileSync(sessionAbsPath, "utf-8");
    } catch (error) {
        throw new Error(`Cannot read session file: ${sessionAbsPath}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON session: ${sessionAbsPath}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Session must be a JSON object: ${sessionAbsPath}`);
    }

    if (parsed.version !== SESSION_VERSION) {
        throw new Error(`Unsupported session version in ${sessionAbsPath}: ${parsed.version ?? "missing"}`);
    }

    return {
        ...parsed,
        pendingFinalFullPass: Boolean(parsed.pendingFinalFullPass),
        pendingReasons: Array.isArray(parsed.pendingReasons) ? parsed.pendingReasons : [],
    };
}

function saveSession(sessionAbsPath, session) {
    if (!sessionAbsPath) {
        return;
    }

    mkdirSync(path.dirname(sessionAbsPath), {recursive: true});
    writeFileSync(sessionAbsPath, `${JSON.stringify(session, null, 2)}\n`, "utf-8");
    console.log(`INFO: Session written: ${sessionAbsPath}`);
}

function updateSession(session, cli, mode, currentState, config, riskAssessment) {
    const matrixHash = hashJson(config.raw);
    const matrixChangedSinceLastFullPass = mode === "delta"
        && session.lastFullPass?.matrixHash
        && session.lastFullPass.matrixHash !== matrixHash;
    const nextSession = {
        ...session,
        version: SESSION_VERSION,
        matrixHash,
        lastRun: {
            completedAt: new Date().toISOString(),
            mode,
            rerunReason: cli.rerunReason,
            snapshotHash: hashJson(currentState.files),
        },
    };

    if (cli.rerunReason === "full-final-pass") {
        nextSession.pendingFinalFullPass = false;
        nextSession.pendingReasons = [];
    } else if (mode === "delta" && (riskAssessment.shouldRunFullFinalPass || matrixChangedSinceLastFullPass)) {
        nextSession.pendingFinalFullPass = true;
        nextSession.pendingReasons = [
            ...new Set([
                ...(nextSession.pendingReasons ?? []),
                ...riskAssessment.reasons,
                ...(matrixChangedSinceLastFullPass ? ["matrix_changed_since_last_full_pass"] : []),
            ]),
        ];
    }

    if (mode === "full") {
        nextSession.lastFullPass = {
            completedAt: nextSession.lastRun.completedAt,
            matrixHash: nextSession.matrixHash,
            snapshotHash: nextSession.lastRun.snapshotHash,
        };
    }

    return nextSession;
}

function printSessionSummary(session) {
    console.log("\nSession:");
    console.log(`- pending_final_full_pass=${session.pendingFinalFullPass ? 1 : 0}`);
    console.log(
        `- pending_final_full_pass_reasons=${session.pendingReasons.length > 0 ? session.pendingReasons.join(", ") : "none"}`
    );
}

function createCommandCounter() {
    let value = 0;
    return {
        next() {
            value += 1;
            return value;
        },
    };
}

function buildRunSummary({
    activeSections,
    artifacts,
    cli,
    commands,
    config,
    configNotices,
    failures,
    files,
    mode,
    riskAssessment,
    session,
    skippedNoChanges,
    skippedNoCommands,
    status,
}) {
    return {
        activeSections: getActiveSectionNames(activeSections),
        artifactsDir: artifacts.relativeDir,
        changedFilesCount: files.length,
        changedFilesHash: hashJson(files),
        commands,
        completedAt: new Date().toISOString(),
        configNotices,
        failures,
        matrixHash: hashJson(config.raw),
        mode,
        pendingFinalFullPass: session.pendingFinalFullPass,
        pendingFinalFullPassReasons: session.pendingReasons ?? [],
        rerunReason: cli.rerunReason,
        riskAssessment: riskAssessment
            ? {
                changedSections: riskAssessment.changedSections,
                pendingFinalFullPass: riskAssessment.shouldRunFullFinalPass,
                pendingFinalFullPassReasons: riskAssessment.reasons,
            }
            : null,
        skippedNoChanges,
        skippedNoCommands,
        status,
    };
}

function writeRunSummary(repoRoot, artifacts, summary) {
    writeFileSync(artifacts.summaryJsonAbs, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
    writeFileSync(artifacts.summaryTxtAbs, renderSummaryText(summary), "utf-8");
}

function renderSummaryText(summary) {
    const cachedCommands = summary.commands.filter((command) => command.status === "SKIP-CACHED").length;
    const executedCommands = summary.commands.length - cachedCommands;
    const lines = [
        `QA: ${summary.status}`,
        `Mode: ${summary.mode}`,
        `Rerun reason: ${summary.rerunReason}`,
        `Commands: ${summary.commands.length} total / ${executedCommands} executed / ${cachedCommands} cached`,
        `Active sections: ${summary.activeSections.length}`,
        `Artifacts: ${summary.artifactsDir}`,
        `Pending final full pass: ${summary.pendingFinalFullPass ? "yes" : "no"}`,
    ];

    if (summary.failures.length === 0) {
        lines.push("Failures: none");
    } else {
        lines.push("Failures:");
        for (const failure of summary.failures) {
            lines.push(`- [${failure.section}] ${failure.command} exit=${failure.exitCode}`);
            for (const detail of failure.summary) {
                lines.push(`  - ${detail}`);
            }
        }
    }

    if (summary.configNotices.length > 0) {
        lines.push("Config notices:");
        for (const notice of summary.configNotices) {
            lines.push(`- [${notice.section}] ${notice.message}`);
        }
    }

    lines.push("");
    return `${lines.join("\n")}\n`;
}

// eslint-disable-next-line complexity
async function main() {
    let cli;
    try {
        cli = parseArgs(process.argv.slice(2));
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        printHelp();
        process.exit(2);
    }

    if (cli.help) {
        printHelp();
        process.exit(0);
    }

    try {
        enforceRerunReasonConsistency(cli);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
    }

    let repoRoot = "";
    try {
        repoRoot = getRepoRoot();
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
    }

    const snapshotWriteAbsPath = cli.snapshotWritePath
        ? resolveRepoPath(repoRoot, cli.snapshotWritePath)
        : null;
    const deltaFromSnapshotAbsPath = cli.deltaFromSnapshotPath
        ? resolveRepoPath(repoRoot, cli.deltaFromSnapshotPath)
        : null;

    let currentState;
    try {
        currentState = collectWorkingTreeState(repoRoot);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
    }

    if (snapshotWriteAbsPath) {
        writeSnapshot(snapshotWriteAbsPath, currentState);
        console.log(`INFO: Snapshot written: ${snapshotWriteAbsPath}`);
    }

    if (cli.snapshotOnly) {
        console.log("Result: snapshot created.");
        process.exit(0);
    }

    let files = Object.keys(currentState.files).sort();
    let mode = "full";

    if (deltaFromSnapshotAbsPath) {
        let snapshot;
        try {
            snapshot = loadSnapshot(deltaFromSnapshotAbsPath);
        } catch (error) {
            console.error(`ERROR: ${error.message}`);
            process.exit(2);
        }

        if (snapshot.repoRoot && snapshot.repoRoot !== repoRoot) {
            console.error(
                `ERROR: Snapshot repo root mismatch: ${snapshot.repoRoot} != ${repoRoot}`
            );
            process.exit(2);
        }

        files = detectChangedFilesFromSnapshot(currentState, snapshot);
        mode = "delta";
    }

    const configAbsPath = path.isAbsolute(cli.configPath)
        ? cli.configPath
        : path.join(repoRoot, cli.configPath);

    let wasCreated = false;
    try {
        wasCreated = ensureConfig(configAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
    }
    if (wasCreated) {
        console.log(`INFO: Config file not found. Copied default config template to: ${configAbsPath}`);
    }

    let config;
    try {
        config = loadConfig(configAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
    }

    const sessionAbsPath = cli.sessionPath
        ? resolveRepoPath(repoRoot, cli.sessionPath)
        : null;

    let session;
    try {
        session = loadSession(sessionAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
    }

    const artifacts = createArtifacts(repoRoot, cli.rerunReason);
    const activeSections = detectActiveSections(files, config, mode);
    printDetectedChanges(mode, cli.rerunReason, files, activeSections, config, deltaFromSnapshotAbsPath, artifacts);
    const configNotices = collectConfigNotices(config, activeSections);
    printConfigNotices(configNotices);

    const executed = [];
    const skippedNoCommands = [];
    const skippedNoChanges = [];
    const commandCounter = createCommandCounter();
    const riskAssessment = includeSessionRiskForFullFinalPass(
        assessRiskForFullFinalPass(activeSections, config),
        session,
        config,
        mode
    );

    for (const sectionName of config.sectionOrder) {
        if (!activeSections[sectionName]) {
            skippedNoChanges.push(sectionName);
            continue;
        }

        let commands;
        try {
            commands = normalizeCommands(config, sectionName);
        } catch (error) {
            console.error(`ERROR: ${error.message}`);
            process.exit(2);
        }

        if (commands.length === 0) {
            skippedNoCommands.push(sectionName);
            console.log(
                `INFO: section ${sectionName} skipped (no commands configured / section missing).`
            );
            continue;
        }

        const sectionResult = await runSectionCommands(repoRoot, config.sections[sectionName], commands, artifacts, commandCounter, config, cli);
        sectionResult.executed.forEach((entry) => executed.push(entry));
        if (!sectionResult.ok) {
            const failureSession = updateSession(session, cli, mode, currentState, config, riskAssessment);
            const failureSummary = buildRunSummary({
                activeSections,
                artifacts,
                cli,
                commands: executed,
                config,
                configNotices,
                failures: [sectionResult.failure],
                files,
                mode,
                riskAssessment,
                session: failureSession,
                skippedNoChanges,
                skippedNoCommands,
                status: "FAIL",
            });
            writeRunSummary(repoRoot, artifacts, failureSummary);
            console.error(`INFO: QA summary written: ${artifacts.summaryJson}`);
            process.exit(sectionResult.exitCode);
        }
    }

    printSummary(executed, skippedNoChanges, skippedNoCommands, artifacts);

    if (mode === "delta") {
        printRiskSummary(riskAssessment);
    }

    const nextSession = updateSession(session, cli, mode, currentState, config, riskAssessment);
    printSessionSummary(nextSession);
    saveSession(sessionAbsPath, nextSession);
    const passSummary = buildRunSummary({
        activeSections,
        artifacts,
        cli,
        commands: executed,
        config,
        configNotices,
        failures: [],
        files,
        mode,
        riskAssessment,
        session: nextSession,
        skippedNoChanges,
        skippedNoCommands,
        status: "PASS",
    });
    writeRunSummary(repoRoot, artifacts, passSummary);
    console.log(`INFO: QA summary written: ${artifacts.summaryJson}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
    });
}

export {
    parseConfig,
};
