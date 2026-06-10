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
        const executed = [];
        for (const command of commands) {
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
        const commandCache = prepareCommandCache(this.repoRoot, section, command, this.config, this.cli);
        if (commandCache.enabled) {
            const cacheHit = readCommandCache(commandCache);
            if (cacheHit) {
                const logs = createCommandLogs(this.repoRoot, this.artifacts.commandsDir, commandIndex, section.name, command.cmd);
                writeCachedCommandLogs(logs, cacheHit);
                const cachedResult = buildCachedCommandResult(section.name, command, cacheHit, logs);
                this.reporter(cachedResult, command.output);
                return cachedResult;
            }
        }

        console.log(`RUN [${section.name}] ${command.cmd}`);
        const startedAt = this.now();
        const logs = createCommandLogs(this.repoRoot, this.artifacts.commandsDir, commandIndex, section.name, command.cmd);
        const stdoutCollector = createOutputCollector(command.output.maxOutputBytes, command.output.parserInputBytes);
        const stderrCollector = createOutputCollector(command.output.maxOutputBytes, command.output.parserInputBytes);
        const result = await spawnCommandToLogs(this.repoRoot, command.cmd, logs, stdoutCollector, stderrCollector);
        const durationMs = Math.max(0, Math.round(this.now() - startedAt));
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

export function isSuccessfulCommandStatus(status) {
    return status === "PASS" || status === "SKIP-CACHED";
}

export function spawnCommandToLogs(repoRoot, command, logs, stdoutCollector, stderrCollector) {
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
