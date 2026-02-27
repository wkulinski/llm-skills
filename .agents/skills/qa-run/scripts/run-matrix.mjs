#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_CONFIG_REL_PATH = ".agents/qa-run.matrix.json";

const SECTION_ORDER = [
    "ALWAYS",
    "COMPOSER_CHANGED",
    "PHP_CHANGED",
    "TWIG_CHANGED",
    "JS_TS_CHANGED",
    "CSS_SCSS_CHANGED",
    "TRANSLATIONS_CHANGED",
    "YAML_CHANGED",
];

const CHANGE_SECTIONS = SECTION_ORDER.filter((s) => s !== "ALWAYS");

const DEFAULT_CONFIG = {
    ALWAYS: [],
    COMPOSER_CHANGED: [],
    PHP_CHANGED: [],
    TWIG_CHANGED: [],
    JS_TS_CHANGED: [],
    CSS_SCSS_CHANGED: [],
    TRANSLATIONS_CHANGED: [],
    YAML_CHANGED: [],
};

function parseArgs(argv) {
    const args = [...argv];
    const result = {
        configPath: DEFAULT_CONFIG_REL_PATH,
        help: false,
    };

    while (args.length > 0) {
        const arg = args.shift();
        if (arg === "--help" || arg === "-h") {
            result.help = true;
            continue;
        }
        if (arg === "--config") {
            const value = args.shift();
            if (!value) {
                throw new Error("Missing value for --config");
            }
            result.configPath = value;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    return result;
}

function printHelp() {
    console.log(`Usage: node ./scripts/run-matrix.mjs [--config <path>]

Deterministic QA runner for $qa-run:
- detects changed files (tracked staged/unstaged + untracked),
- maps changes to fixed sections (*_CHANGED),
- loads repo config from JSON,
- runs commands section by section (fail-fast on first command error),
- auto-creates config file when missing.

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
        "--diff-filter=ACMRTUXB",
    ]);
    const trackedStaged = gitLines(repoRoot, [
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=ACMRTUXB",
    ]);
    const untracked = gitLines(repoRoot, ["ls-files", "--others", "--exclude-standard"]);

    return [...new Set([...trackedUnstaged, ...trackedStaged, ...untracked])];
}

function detectFlags(files) {
    const hasMatch = (regex) => files.some((file) => regex.test(file));

    return {
        COMPOSER_CHANGED: hasMatch(/(^|\/)composer\.(json|lock)$/),
        PHP_CHANGED: hasMatch(/\.php$/),
        TWIG_CHANGED: hasMatch(/\.twig$/),
        JS_TS_CHANGED: hasMatch(/\.(js|jsx|ts|tsx|mjs)$/),
        CSS_SCSS_CHANGED: hasMatch(/\.(css|scss)$/),
        TRANSLATIONS_CHANGED: hasMatch(
            /(^|\/)translations\/|(^|\/)src\/[^/]+\/UI\/Translation\//
        ),
        YAML_CHANGED: hasMatch(/\.(yml|yaml)$/),
    };
}

function ensureConfig(configAbsPath) {
    if (existsSync(configAbsPath)) {
        return false;
    }

    mkdirSync(path.dirname(configAbsPath), {recursive: true});
    writeFileSync(configAbsPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
    return true;
}

function loadConfig(configAbsPath) {
    let raw = "";
    try {
        raw = readFileSync(configAbsPath, "utf-8");
    } catch (error) {
        throw new Error(`Cannot read config file: ${configAbsPath}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`Invalid JSON config: ${configAbsPath}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Config root must be a JSON object.");
    }

    return parsed;
}

function normalizeCommands(config, sectionName) {
    if (sectionName === "ALWAYS") {
        const value = config.ALWAYS;
        if (value === undefined) {
            return [];
        }
        if (!Array.isArray(value)) {
            throw new Error('Config section "ALWAYS" must be an array of command strings.');
        }
        const commands = [];
        for (const entry of value) {
            if (typeof entry !== "string") {
                throw new Error(
                    'Config section "ALWAYS" must contain only strings (invalid entry type).'
                );
            }
            const trimmed = entry.trim();
            if (trimmed.length > 0) {
                commands.push(trimmed);
            }
        }
        return commands;
    }

    const value = config[sectionName];
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" must be an array of command strings.`);
    }
    const commands = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            throw new Error(
                `Config section "${sectionName}" must contain only strings (invalid entry type).`
            );
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
            commands.push(trimmed);
        }
    }
    return commands;
}

function executeCommand(repoRoot, section, command) {
    console.log(`RUN [${section}] ${command}`);
    const result = spawnSync("bash", ["-lc", command], {
        cwd: repoRoot,
        stdio: "inherit",
    });
    if (result.error) {
        console.error(`ERROR [${section}] ${command}`);
        console.error(result.error.message);
        return 1;
    }
    if ((result.status ?? 1) !== 0) {
        console.error(`FAIL [${section}] ${command}`);
        return result.status ?? 1;
    }
    return 0;
}

function main() {
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

    let repoRoot = "";
    try {
        repoRoot = getRepoRoot();
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
    }

    const configAbsPath = path.isAbsolute(cli.configPath)
        ? cli.configPath
        : path.join(repoRoot, cli.configPath);

    const wasCreated = ensureConfig(configAbsPath);
    if (wasCreated) {
        console.log(`INFO: Config file not found. Created default config: ${configAbsPath}`);
    }

    let config;
    try {
        config = loadConfig(configAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
    }

    let files = [];
    try {
        files = detectChangedFiles(repoRoot);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
    }

    const flags = detectFlags(files);

    console.log("Detected changes:");
    console.log(`- files_count=${files.length}`);
    for (const section of CHANGE_SECTIONS) {
        console.log(`- ${section}=${flags[section] ? 1 : 0}`);
    }

    const executed = [];
    const skippedNoCommands = [];
    const skippedNoChanges = [];

    for (const section of SECTION_ORDER) {
        const enabled = section === "ALWAYS" ? true : Boolean(flags[section]);
        if (!enabled) {
            skippedNoChanges.push(section);
            continue;
        }

        let commands;
        try {
            commands = normalizeCommands(config, section);
        } catch (error) {
            console.error(`ERROR: ${error.message}`);
            process.exit(2);
        }

        if (commands.length === 0) {
            skippedNoCommands.push(section);
            console.log(
                `INFO: section ${section} skipped (no commands configured / section missing).`
            );
            continue;
        }

        for (const command of commands) {
            const exitCode = executeCommand(repoRoot, section, command);
            if (exitCode !== 0) {
                process.exit(exitCode);
            }
            executed.push({section, command});
        }
    }

    console.log("\nSummary:");
    console.log(`- executed_commands=${executed.length}`);
    console.log(
        `- skipped_no_changes=${skippedNoChanges.length > 0 ? skippedNoChanges.join(", ") : "none"}`
    );
    console.log(
        `- skipped_no_commands=${skippedNoCommands.length > 0 ? skippedNoCommands.join(", ") : "none"}`
    );

    if (executed.length === 0) {
        console.log("Result: no commands executed.");
    } else {
        console.log("Result: all executed commands passed.");
    }
}

main();
