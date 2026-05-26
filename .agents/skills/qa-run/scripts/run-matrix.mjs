#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const DEFAULT_CONFIG_REL_PATH = ".agents/qa-run.matrix.json";
const DEFAULT_CONFIG_TEMPLATE_REL_PATH = "../templates/qa-run.matrix.dist.json";
const SNAPSHOT_VERSION = 1;
const SESSION_VERSION = 1;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

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
    const sections = normalizeSections(config);
    const sectionOrder = normalizeSectionOrder(config, sections);

    return {
        raw: config,
        sectionOrder,
        sections,
    };
}

function normalizeSections(config) {
    if (!config.sections || typeof config.sections !== "object" || Array.isArray(config.sections)) {
        throw new Error('Config field "sections" must be an object.');
    }

    const sections = {};
    for (const [sectionName, sectionConfig] of Object.entries(config.sections)) {
        sections[sectionName] = normalizeSectionConfig(sectionName, sectionConfig);
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

function normalizeSectionConfig(sectionName, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" must be an object.`);
    }

    assertRequiredSectionField(sectionName, value, "commands");
    assertRequiredSectionField(sectionName, value, "patterns");
    assertRequiredSectionField(sectionName, value, "runOn");
    assertRequiredSectionField(sectionName, value, "requiresFinalFullPass");

    return {
        name: sectionName,
        commands: normalizeSectionCommandList(sectionName, value.commands),
        patterns: normalizeStringList(sectionName, "patterns", value.patterns),
        requiresFinalFullPass: normalizeBoolean(sectionName, "requiresFinalFullPass", value.requiresFinalFullPass),
        runOn: normalizeRunOn(sectionName, value.runOn),
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

    return section.patterns.some((pattern) => files.some((file) => matchGlob(pattern, file)));
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

function printDetectedChanges(mode, rerunReason, files, activeSections, config, snapshotAbsPath = null) {
    console.log("Detected changes:");
    console.log(`- mode=${mode}`);
    console.log(`- rerun_reason=${rerunReason}`);
    if (snapshotAbsPath) {
        console.log(`- delta_from_snapshot=${snapshotAbsPath}`);
    }
    console.log(`- files_count=${files.length}`);
    for (const section of config.sectionOrder) {
        console.log(`- ${section}=${activeSections[section] ? 1 : 0}`);
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

    const activeSections = detectActiveSections(files, config, mode);
    printDetectedChanges(mode, cli.rerunReason, files, activeSections, config, deltaFromSnapshotAbsPath);

    const executed = [];
    const skippedNoCommands = [];
    const skippedNoChanges = [];

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

        const sectionResult = runSectionCommands(repoRoot, sectionName, commands);
        if (!sectionResult.ok) {
            process.exit(sectionResult.exitCode);
        }
        sectionResult.executed.forEach((entry) => executed.push(entry));
    }

    printSummary(executed, skippedNoChanges, skippedNoCommands);

    const riskAssessment = includeSessionRiskForFullFinalPass(
        assessRiskForFullFinalPass(activeSections, config),
        session,
        config,
        mode
    );
    if (mode === "delta") {
        printRiskSummary(riskAssessment);
    }

    const nextSession = updateSession(session, cli, mode, currentState, config, riskAssessment);
    printSessionSummary(nextSession);
    saveSession(sessionAbsPath, nextSession);
}

main();
