import {spawn} from "node:child_process";
import {createWriteStream} from "node:fs";
import {performance} from "node:perf_hooks";

import {
    buildCachedCommandResult,
    prepareCommandCache,
    prepareCompletedCommandCache,
    readCommandCache,
    writeCachedCommandLogs,
    writeCommandCache,
} from "../cache/command-cache.mjs";
import {buildFailureSummary} from "../parsers/failure-summary.mjs";
import {printCommandResult} from "../reporting/console-reporter.mjs";
import {commandLabel, contextSafeLines, contextSafeText} from "../reporting/context-safety.mjs";
import {hashJson} from "../shared/hashing.mjs";
import {createCommandLogs} from "./command-logs.mjs";
import {createOutputCollector} from "./output-collector.mjs";

export class CommandExecutor {
    constructor({
        artifacts,
        cli,
        commandCounter,
        config,
        now = () => performance.now(),
        reporter = printCommandResult,
        repoRoot,
    }) {
        this.artifacts = artifacts;
        this.cli = cli;
        this.commandCounter = commandCounter;
        this.config = config;
        this.now = now;
        this.reporter = reporter;
        this.repoRoot = repoRoot;
    }

    async runSectionCommands(section, commands) {
        return this.runEntries(commands.map((command) => ({command, section})));
    }

    async runEntries(entries) {
        const executed = [];
        for (const {command, section} of entries) {
            const commandIndex = this.commandCounter.next();
            const commandResult = await this.executeCommand(section, command, commandIndex);
            executed.push(commandResult);
            if (!isSuccessfulCommandStatus(commandResult.status)) {
                return {ok: false, exitCode: commandResult.exitCode, executed, failure: commandResult};
            }
        }

        return {ok: true, exitCode: 0, executed, failure: null};
    }

    async executeCommand(section, command, commandIndex) {
        try {
            return await this.executeCommandWithLogs(section, command, commandIndex);
        } catch (error) {
            const errorResult = buildRunnerErrorResult(section, command, error);
            this.reporter(errorResult, command.output);
            return errorResult;
        }
    }

    async executeCommandWithLogs(section, command, commandIndex) {
        const commandCache = prepareCommandCache(this.repoRoot, section, command, this.config, this.cli);
        if (commandCache.enabled) {
            const cacheHit = readCommandCache(commandCache);
            if (cacheHit) {
                const logs = createCommandLogs(this.repoRoot, this.artifacts.commandsDir, commandIndex, section.name, command.cmd);
                writeCachedCommandLogs(logs, cacheHit);
                const cachedResult = {
                    ...buildCachedCommandResult(section.name, command, cacheHit, logs),
                    label: commandLabel(command),
                };
                this.reporter(cachedResult, command.output);
                return cachedResult;
            }
        }

        const startedAt = this.now();
        const logs = createCommandLogs(this.repoRoot, this.artifacts.commandsDir, commandIndex, section.name, command.cmd);
        const stdoutCollector = createOutputCollector(command.output.maxOutputBytes, command.output.parserInputBytes);
        const stderrCollector = createOutputCollector(command.output.maxOutputBytes, command.output.parserInputBytes);
        const result = await spawnCommandToLogs(this.repoRoot, command.argv ?? command.cmd, logs, stdoutCollector, stderrCollector);
        const durationMs = Math.max(0, Math.round(this.now() - startedAt));
        const stdoutTail = stdoutCollector.tailContent();
        const stderrTail = stderrCollector.tailContent();
        const stdoutParserInput = stdoutCollector.parserContent();
        const stderrParserInput = stderrCollector.parserContent();
        const exitCode = result.error ? 1 : result.exitCode;
        const status = result.error ? "ERROR" : exitCode === 0 ? "PASS" : "FAIL";
        const failureSummary = status === "PASS"
            ? []
            : contextSafeLines(buildFailureSummary(
                command.output,
                stdoutTail,
                stderrTail,
                result.error?.message ?? "",
                stdoutParserInput,
                stderrParserInput
            ));

        const commandResult = {
            command: command.cmd,
            commandHash: hashJson(command.cmd),
            durationMs,
            exitCode,
            label: commandLabel(command),
            parser: command.output.parser,
            section: section.name,
            status,
            stderrLog: logs.stderrLog,
            stdoutLog: logs.stdoutLog,
            summary: failureSummary,
        };

        if (result.error) {
            commandResult.error = contextSafeText(result.error.message);
        }

        this.reporter(commandResult, command.output);
        if (commandCache.enabled && commandResult.status === "PASS") {
            const completedCache = prepareCompletedCommandCache(this.repoRoot, section, command, this.config, commandCache);
            writeCommandCache(completedCache, commandResult, this.artifacts);
        }
        return commandResult;
    }
}

export async function runSectionCommands(repoRoot, section, commands, artifacts, commandCounter, config, cli) {
    const executor = new CommandExecutor({
        artifacts,
        cli,
        commandCounter,
        config,
        repoRoot,
    });

    return executor.runSectionCommands(section, commands);
}

function buildRunnerErrorResult(section, command, error) {
    const message = contextSafeText(`runner error: ${error.message}`);
    return {
        command: command.cmd,
        commandHash: hashJson(command.cmd),
        durationMs: 0,
        error: message,
        exitCode: 1,
        label: commandLabel(command),
        parser: command.output.parser,
        section: section.name,
        status: "ERROR",
        stderrLog: null,
        stdoutLog: null,
        summary: [message],
    };
}

export function isSuccessfulCommandStatus(status) {
    return status === "PASS" || status === "SKIP-CACHED";
}

/**
 * Runs a trusted matrix command string through `bash -c`, or an argv command
 * (`{file, args}`) directly without a shell, so dynamic arguments stay literal.
 */
export function spawnCommandToLogs(repoRoot, command, logs, stdoutCollector, stderrCollector) {
    return new Promise((resolve) => {
        const stdoutStream = createWriteStream(logs.stdoutAbsPath, {mode: 0o600});
        const stderrStream = createWriteStream(logs.stderrAbsPath, {mode: 0o600});
        let logError = null;
        const recordLogError = (error) => {
            logError ??= new Error(`cannot write command log: ${error.message}`);
        };
        stdoutStream.on("error", recordLogError);
        stderrStream.on("error", recordLogError);
        const [file, args] = typeof command === "string"
            ? ["bash", ["-c", command]]
            : [command.file, command.args];
        const child = spawn(file, args, {
            cwd: repoRoot,
            shell: false,
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
                        error: spawnError ?? logError,
                        exitCode: exitCode ?? 1,
                    });
                });
            });
        });
    });
}
