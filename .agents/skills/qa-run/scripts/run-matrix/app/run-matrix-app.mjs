import {mkdirSync} from "node:fs";
import path from "node:path";
import process from "node:process";

import {
    assertSnapshotRepoRoot,
    detectChangedFilesFromSnapshot,
    loadSnapshot,
    writeSnapshot,
} from "../change-detection/snapshot.mjs";
import {
    collectWorkingTreeState,
    getRepoRoot,
} from "../change-detection/working-tree.mjs";
import {ensureConfig, loadConfig} from "../config/loader.mjs";
import {collectConfigNotices} from "../config/notices.mjs";
import {normalizeCommands} from "../config/normalizer.mjs";
import {runSectionCommands} from "../execution/command-executor.mjs";
import {detectActiveSections} from "../patterns/section-activation.mjs";
import {
    printConfigNotices,
    printDetectedChanges,
    printRiskSummary,
    printSessionSummary,
    printSummary,
} from "../reporting/console-reporter.mjs";
import {
    buildRunSummary,
    writeRunSummary,
} from "../reporting/summary-writer.mjs";
import {
    assessRiskForFullFinalPass,
    includeSessionRiskForFullFinalPass,
} from "../session/risk-assessment.mjs";
import {
    loadSession,
    saveSession,
    updateSession,
} from "../session/session-store.mjs";
import {
    formatDateForPath,
    getCacheRoot,
    resolveRepoPath,
    sanitizePathPart,
    toRepoRelativePath,
} from "../shared/paths.mjs";

const DEFAULT_CONFIG_REL_PATH = ".agents/qa-run.matrix.json";
const RERUN_REASONS = new Set([
    "initial",
    "post-fix-delta",
    "review-fix-delta",
    "full-final-pass",
]);

export class RunMatrixApp {
    async run(argv = process.argv.slice(2)) {
        let cli;
        try {
            cli = parseArgs(argv);
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

            try {
                assertSnapshotRepoRoot(snapshot, repoRoot);
            } catch (error) {
                console.error(`ERROR: ${error.message}`);
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
                writeRunSummary(artifacts, failureSummary);
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
        writeRunSummary(artifacts, passSummary);
        console.log(`INFO: QA summary written: ${artifacts.summaryJson}`);
    }
}

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

function enforceRerunReasonConsistency(cli) {
    if (cli.snapshotOnly) {
        return;
    }

    if (cli.rerunReason === "initial") {
        if (cli.deltaFromSnapshotPath) {
            throw new Error(
                "Initial rerun cannot use --delta-from-snapshot. Use --rerun-reason post-fix-delta instead."
            );
        }

        return;
    }

    if (cli.rerunReason === "post-fix-delta" || cli.rerunReason === "review-fix-delta") {
        if (!cli.deltaFromSnapshotPath) {
            throw new Error(
                "Delta rerun requires --delta-from-snapshot <path>."
            );
        }

        return;
    }

    if (cli.rerunReason === "full-final-pass" && cli.deltaFromSnapshotPath) {
        throw new Error(
            "Full final pass cannot use --delta-from-snapshot. Run it as a full rerun after a successful delta rerun."
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

function createCommandCounter() {
    let value = 0;
    return {
        next() {
            value += 1;
            return value;
        },
    };
}

export async function main() {
    const app = new RunMatrixApp();
    await app.run();
}
