#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_CONFIG_REL_PATH = ".agents/qa-run.matrix.json";
const SNAPSHOT_VERSION = 1;

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

const CHANGE_SECTIONS = SECTION_ORDER.filter((section) => section !== "ALWAYS");
const FULL_FINAL_PASS_TRIGGER_SECTIONS = new Set([
    "COMPOSER_CHANGED",
    "PHP_CHANGED",
    "YAML_CHANGED",
]);

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
        deltaFromSnapshotPath: null,
        help: false,
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

        if (arg === "--snapshot-write") {
            result.snapshotWritePath = readRequiredArgValue(args, "--snapshot-write");
            continue;
        }

        throw new Error(`Unknown argument: ${arg}`);
    }

    if (result.snapshotOnly && !result.snapshotWritePath) {
        throw new Error("--snapshot-only requires --snapshot-write <path>.");
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
  --snapshot-write <path>        Write current dirty working-tree snapshot to JSON.
  --snapshot-only                Write snapshot and exit without running commands.
  --delta-from-snapshot <path>   Run only sections affected by changes since snapshot.
  --help, -h                     Show this help.

Deterministic QA runner for $qa-run:
- detects changed files (tracked staged/unstaged + untracked),
- maps changes to fixed sections (*_CHANGED),
- loads repo config from JSON,
- runs commands section by section (fail-fast on first command error),
- supports snapshot-based delta reruns after repair iterations,
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

    mkdirSync(path.dirname(configAbsPath), {recursive: true});
    writeFileSync(configAbsPath, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf-8");
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
        return parsed;
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

function normalizeCommands(config, sectionName) {
    const value = readSectionConfigValue(config, sectionName);
    if (value === null) {
        return [];
    }

    return normalizeSectionCommandList(sectionName, value);
}

function readSectionConfigValue(config, sectionName) {
    if (Object.hasOwn(config, sectionName)) {
        return config[sectionName];
    }

    return null;
}

function normalizeSectionCommandList(sectionName, value) {
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

function getChangedSections(flags) {
    return CHANGE_SECTIONS.filter((section) => Boolean(flags[section]));
}

function assessRiskForFullFinalPass(flags) {
    const changedSections = getChangedSections(flags);
    const reasons = [];

    for (const section of changedSections) {
        if (FULL_FINAL_PASS_TRIGGER_SECTIONS.has(section)) {
            reasons.push(`high_risk_section:${section}`);
        }
    }

    if (changedSections.length > 1) {
        reasons.push("multiple_changed_sections");
    }

    return {
        changedSections,
        reasons,
        shouldRunFullFinalPass: reasons.length > 0,
    };
}

function runSectionCommands(repoRoot, section, commands) {
    const executed = [];
    for (const command of commands) {
        const exitCode = executeCommand(repoRoot, section, command);
        if (exitCode !== 0) {
            return {ok: false, exitCode, executed};
        }
        executed.push({section, command});
    }

    return {ok: true, exitCode: 0, executed};
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

function printDetectedChanges(mode, files, flags, snapshotAbsPath = null) {
    console.log("Detected changes:");
    console.log(`- mode=${mode}`);
    if (snapshotAbsPath) {
        console.log(`- delta_from_snapshot=${snapshotAbsPath}`);
    }
    console.log(`- files_count=${files.length}`);
    for (const section of CHANGE_SECTIONS) {
        console.log(`- ${section}=${flags[section] ? 1 : 0}`);
    }
}

function printSummary(executed, skippedNoChanges, skippedNoCommands) {
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

function printRiskSummary(riskAssessment) {
    console.log("\nRisk evaluation:");
    console.log(
        `- changed_sections=${riskAssessment.changedSections.length > 0 ? riskAssessment.changedSections.join(", ") : "none"}`
    );
    console.log(
        `- full_final_pass_recommended=${riskAssessment.shouldRunFullFinalPass ? 1 : 0}`
    );
    console.log(
        `- full_final_pass_reasons=${riskAssessment.reasons.length > 0 ? riskAssessment.reasons.join(", ") : "none"}`
    );
}

// eslint-disable-next-line complexity
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

    const flags = detectFlags(files);
    printDetectedChanges(mode, files, flags, deltaFromSnapshotAbsPath);

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

    const executed = [];
    const skippedNoCommands = [];
    const skippedNoChanges = [];

    for (const section of SECTION_ORDER) {
        const enabled = section === "ALWAYS"
            ? (mode === "full" || files.length > 0)
            : Boolean(flags[section]);

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

        const sectionResult = runSectionCommands(repoRoot, section, commands);
        if (!sectionResult.ok) {
            process.exit(sectionResult.exitCode);
        }
        sectionResult.executed.forEach((entry) => executed.push(entry));
    }

    printSummary(executed, skippedNoChanges, skippedNoCommands);

    if (mode === "delta") {
        printRiskSummary(assessRiskForFullFinalPass(flags));
    }
}

main();
