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
import {CommandExecutor, runSectionCommands} from "../execution/command-executor.mjs";
import {resolveToolExecutable} from "../execution/tool-resolver.mjs";
import {contextSafeText} from "../reporting/context-safety.mjs";
import {detectActiveSections} from "../patterns/section-activation.mjs";
import {
    printConfigNotices,
    printDetectedChanges,
    printRiskSummary,
    printRunResult,
    printSessionSummary,
} from "../reporting/console-reporter.mjs";
import {
    buildRunSummary,
    writeRunSummary,
} from "../reporting/summary-writer.mjs";
import {
    assertSelectionInsideCache,
    buildScopedPlan,
    loadSelection,
    RUN_SCOPES,
} from "../selection/scoped-selection.mjs";
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
        const cli = parseCliOrExit(argv);

        if (cli.help) {
            printHelp();
            process.exit(0);
        }

        enforceRerunReasonOrExit(cli);

        const repoRoot = getRepoRootOrExit();
        const currentState = collectWorkingTreeStateOrExit(repoRoot);
        const snapshotPaths = resolveSnapshotPaths(repoRoot, cli);
        writeSnapshotIfRequested(snapshotPaths.snapshotWriteAbsPath, currentState);

        if (cli.snapshotOnly) {
            console.log("Result: snapshot created.");
            process.exit(0);
        }

        const {files, mode} = resolveRunScopeOrExit(repoRoot, currentState, snapshotPaths.deltaFromSnapshotAbsPath);
        const config = loadConfigOrExit(resolveConfigPath(repoRoot, cli.configPath));

        const sessionAbsPath = cli.sessionPath
            ? resolveRepoPath(repoRoot, cli.sessionPath)
            : null;
        const session = loadSessionOrExit(sessionAbsPath);
        enforceSessionLifecycleOrExit(cli, session, sessionAbsPath);

        const activeSections = detectActiveSections(files, config, mode);
        const riskAssessment = includeSessionRiskForFullFinalPass(
            assessRiskForFullFinalPass(activeSections, config),
            session,
            config,
            mode
        );
        const runResult = cli.scope === "full"
            ? await runFullMatrix({activeSections, cli, config, files, mode, repoRoot})
            : await runScopedSelectionOrExit({cli, config, repoRoot});

        const outcome = {
            postRunState: collectWorkingTreeStateOrExit(repoRoot),
            selection: runResult.selection,
            status: runResult.failure ? "FAIL" : "PASS",
        };
        const nextSession = updateSession(session, cli, mode, currentState, config, riskAssessment, outcome);
        const summary = buildRunSummary({
            activeSections: runResult.activeSections,
            artifacts: runResult.artifacts,
            cli,
            commands: runResult.executed,
            config,
            configNotices: runResult.configNotices,
            evidence: nextSession.lastRun,
            failures: runResult.failure ? [runResult.failure] : [],
            files,
            mode,
            riskAssessment,
            session: nextSession,
            skippedNoChanges: runResult.skippedNoChanges,
            skippedNoCommands: runResult.skippedNoCommands,
            status: outcome.status,
        });

        if (!nextSession.lastRun.evidenceCurrent) {
            console.error("WARN: working tree changed during QA; this result does not verify the current version.");
        }

        if (runResult.failure) {
            persistRunOrExit(sessionAbsPath, nextSession, runResult.artifacts, summary);
            printRunResult(summary, runResult.artifacts);
            console.error(`INFO: QA summary written: ${runResult.artifacts.summaryJson}`);
            process.exit(runResult.exitCode);
        }

        persistRunOrExit(sessionAbsPath, nextSession, runResult.artifacts, summary);
        if (mode === "delta") {
            printRiskSummary(riskAssessment);
        }
        if (sessionAbsPath) {
            printSessionSummary(nextSession);
        }
        printRunResult(summary, runResult.artifacts);
        console.log(`INFO: QA summary written: ${runResult.artifacts.summaryJson}`);
    }
}

// A runner I/O failure must never look like a passing QA run.
function persistRunOrExit(sessionAbsPath, session, artifacts, summary) {
    try {
        saveSession(sessionAbsPath, session);
        writeRunSummary(artifacts, summary);
    } catch (error) {
        console.error(`ERROR: QA ${summary.status} result could not be persisted: ${contextSafeText(error.message)}`);
        console.error(`ERROR: artifacts=${artifacts.relativeDir}`);
        process.exit(summary.status === "PASS" ? 1 : summary.failures[0]?.exitCode || 1);
    }
}

async function runFullMatrix({activeSections, cli, config, files, mode, repoRoot}) {
    const artifacts = createArtifactsOrExit(repoRoot, cli.rerunReason);
    printDetectedChanges(mode, cli.rerunReason, files, activeSections);
    const configNotices = collectConfigNotices(config, activeSections);
    printConfigNotices(configNotices);

    const executed = [];
    const skippedNoCommands = [];
    const skippedNoChanges = [];
    const commandCounter = createCommandCounter();
    const result = {
        activeSections,
        artifacts,
        configNotices,
        executed,
        exitCode: 0,
        failure: null,
        selection: null,
        skippedNoChanges,
        skippedNoCommands,
    };

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
            result.exitCode = sectionResult.exitCode;
            result.failure = sectionResult.failure;
            return result;
        }
    }

    return result;
}

async function runScopedSelectionOrExit({cli, config, repoRoot}) {
    let entries;
    try {
        const selectionAbsPath = resolveRepoPath(repoRoot, cli.selectionPath);
        assertSelectionInsideCache(selectionAbsPath, getCacheRoot(repoRoot));
        entries = buildScopedPlan({
            config,
            resolveTool: (tool) => resolveToolExecutable(repoRoot, tool),
            scope: cli.scope,
            selection: loadSelection(selectionAbsPath),
        });
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
        throw error;
    }

    const artifacts = createArtifactsOrExit(repoRoot, `${cli.scope}-${cli.rerunReason}`);
    console.log(`Scoped run: scope=${cli.scope} checks=${entries.length}`);
    const executor = new CommandExecutor({
        artifacts,
        cli,
        commandCounter: createCommandCounter(),
        config,
        repoRoot,
    });
    const result = await executor.runEntries(entries);

    return {
        activeSections: {},
        artifacts,
        configNotices: [],
        executed: result.executed,
        exitCode: result.exitCode,
        failure: result.ok ? null : result.failure,
        selection: entries.map((entry) => entry.check),
        skippedNoChanges: [],
        skippedNoCommands: [],
    };
}

function parseCliOrExit(argv) {
    try {
        return parseArgs(argv);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        printHelp();
        process.exit(2);
        throw error;
    }
}

function enforceRerunReasonOrExit(cli) {
    try {
        enforceRerunReasonConsistency(cli);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
        throw error;
    }
}

function getRepoRootOrExit() {
    try {
        return getRepoRoot();
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
        throw error;
    }
}

function collectWorkingTreeStateOrExit(repoRoot) {
    try {
        return collectWorkingTreeState(repoRoot);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(3);
        throw error;
    }
}

function resolveSnapshotPaths(repoRoot, cli) {
    return {
        deltaFromSnapshotAbsPath: cli.deltaFromSnapshotPath
            ? resolveRepoPath(repoRoot, cli.deltaFromSnapshotPath)
            : null,
        snapshotWriteAbsPath: cli.snapshotWritePath
            ? resolveRepoPath(repoRoot, cli.snapshotWritePath)
            : null,
    };
}

function writeSnapshotIfRequested(snapshotWriteAbsPath, currentState) {
    if (!snapshotWriteAbsPath) {
        return;
    }

    writeSnapshot(snapshotWriteAbsPath, currentState);
    console.log(`INFO: Snapshot written: ${snapshotWriteAbsPath}`);
}

function resolveRunScopeOrExit(repoRoot, currentState, deltaFromSnapshotAbsPath) {
    if (!deltaFromSnapshotAbsPath) {
        return {
            files: Object.keys(currentState.files).sort(),
            mode: "full",
        };
    }

    const snapshot = loadSnapshotOrExit(deltaFromSnapshotAbsPath);
    assertSnapshotRepoRootOrExit(snapshot, repoRoot);
    return {
        files: detectChangedFilesFromSnapshot(currentState, snapshot),
        mode: "delta",
    };
}

function loadSnapshotOrExit(deltaFromSnapshotAbsPath) {
    try {
        return loadSnapshot(deltaFromSnapshotAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
        throw error;
    }
}

function assertSnapshotRepoRootOrExit(snapshot, repoRoot) {
    try {
        assertSnapshotRepoRoot(snapshot, repoRoot);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
        throw error;
    }
}

function resolveConfigPath(repoRoot, configPath) {
    return path.isAbsolute(configPath)
        ? configPath
        : path.join(repoRoot, configPath);
}

function loadConfigOrExit(configAbsPath) {
    try {
        const wasCreated = ensureConfig(configAbsPath);
        if (wasCreated) {
            console.log(`INFO: Config file not found. Copied default config template to: ${configAbsPath}`);
        }
        return loadConfig(configAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
        throw error;
    }
}

function loadSessionOrExit(sessionAbsPath) {
    try {
        return loadSession(sessionAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
        throw error;
    }
}

function enforceSessionLifecycleOrExit(cli, session, sessionAbsPath) {
    try {
        enforceSessionLifecycle(cli, session, sessionAbsPath);
    } catch (error) {
        console.error(`ERROR: ${error.message}`);
        process.exit(2);
        throw error;
    }
}

export function enforceSessionLifecycle(cli, session, sessionAbsPath) {
    if ((cli.scope ?? "full") !== "full" || cli.rerunReason !== "initial" || !session.lastFullPass) {
        return;
    }

    throw new Error(
        `QA session already has a successful full pass: ${sessionAbsPath}. Use a new --session path for an independent initial run.`
    );
}

function parseArgs(argv) {
    const args = [...argv];
    const result = {
        configPath: DEFAULT_CONFIG_REL_PATH,
        deltaFromSnapshotPath: null,
        help: false,
        noCache: false,
        rerunReason: "initial",
        scope: "full",
        selectionPath: null,
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

        if (arg === "--scope") {
            result.scope = readRequiredArgValue(args, "--scope");
            continue;
        }

        if (arg === "--selection") {
            result.selectionPath = readRequiredArgValue(args, "--selection");
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

    validateScopeArgs(result);
    return result;
}

function validateScopeArgs(cli) {
    if (!RUN_SCOPES.has(cli.scope)) {
        throw new Error(`Invalid value for --scope: ${cli.scope}. Expected one of: ${[...RUN_SCOPES].join(", ")}.`);
    }

    if (cli.scope === "full") {
        if (cli.selectionPath) {
            throw new Error("--selection requires --scope point or --scope partial.");
        }
        return;
    }

    if (!cli.selectionPath) {
        throw new Error(`--scope ${cli.scope} requires --selection <path>.`);
    }

    if (cli.rerunReason === "full-final-pass") {
        throw new Error("--rerun-reason full-final-pass requires --scope full.");
    }

    if (cli.snapshotOnly) {
        throw new Error(`--scope ${cli.scope} cannot be combined with --snapshot-only.`);
    }
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
  --scope <scope>                Execution scope: full (default) | point | partial.
  --selection <path>             Selection JSON under CACHE_PATH; required for point/partial.
  --help, -h                     Show this help.

Deterministic QA runner for $qa-run:
- detects changed files (tracked staged/unstaged + untracked),
- maps changes to configured sections,
- loads repo config from JSON,
- runs commands section by section (fail-fast on first command error),
- supports snapshot-based delta reruns after repair iterations,
- can persist a session ledger for deferred final full pass decisions,
- copies config from the bundled dist template when missing,
- point/partial scopes run only the selected matrix commands and targeted tests,
  without cache or session updates; they never count as a full QA gate.

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

function createArtifactsOrExit(repoRoot, runLabel) {
    try {
        return createArtifacts(repoRoot, runLabel);
    } catch (error) {
        console.error(`ERROR: cannot create QA artifacts: ${contextSafeText(error.message)}`);
        process.exit(1);
        throw error;
    }
}

function createArtifacts(repoRoot, rerunReason) {
    const cacheRoot = getCacheRoot(repoRoot);
    const runId = `${formatDateForPath(new Date())}-${process.pid}-${sanitizePathPart(rerunReason)}`;
    const artifactsDir = path.join(cacheRoot, "qa-run", runId);
    const commandsDir = path.join(artifactsDir, "commands");
    mkdirSync(commandsDir, {mode: 0o700, recursive: true});

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
