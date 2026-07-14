import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    CommandExecutor,
    isSuccessfulCommandStatus,
} from "../../../.agents/skills/qa-run/scripts/run-matrix/execution/command-executor.mjs";

const tempRoots = [];
let consoleLogSpy;

afterEach(() => {
    while (tempRoots.length > 0) {
        const tempRoot = tempRoots.pop();
        rmSync(tempRoot, {force: true, recursive: true});
    }
    consoleLogSpy?.mockRestore();
    consoleLogSpy = void 0;
});

beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => null);
});

describe("run-matrix command executor", () => {
    it("classifies only pass and cache-hit statuses as successful", () => {
        expect(isSuccessfulCommandStatus("PASS")).toBe(true);
        expect(isSuccessfulCommandStatus("SKIP-CACHED")).toBe(true);
        expect(isSuccessfulCommandStatus("FAIL")).toBe(false);
        expect(isSuccessfulCommandStatus("ERROR")).toBe(false);
    });

    it("runs commands in order, writes logs, and stops on first failure", async () => {
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-executor-unit-"));
        tempRoots.push(repoRoot);
        const commandsDir = path.join(repoRoot, "commands");
        const reports = [];
        let commandIndex = 0;
        let nowValue = 0;
        const executor = new CommandExecutor({
            artifacts: {
                commandsDir,
                relativeDir: "artifacts",
            },
            cli: {
                noCache: false,
                rerunReason: "initial",
            },
            commandCounter: {
                next() {
                    commandIndex += 1;
                    return commandIndex;
                },
            },
            config: {
                raw: {},
            },
            now() {
                nowValue += 25;
                return nowValue;
            },
            reporter(commandResult) {
                reports.push(commandResult);
            },
            repoRoot,
        });

        const result = await executor.runSectionCommands({
            cache: {
                enabled: false,
            },
            name: "EXEC_CHANGED",
        }, [
            {
                cmd: "node -e \"console.log('first')\"",
                output: outputConfig(),
            },
            {
                cmd: "node -e \"console.error('second failed'); process.exit(7)\"",
                output: outputConfig(),
            },
            {
                cmd: "node -e \"console.log('third should not run')\"",
                output: outputConfig(),
            },
        ]);

        expect(result.ok).toBe(false);
        expect(result.exitCode).toBe(7);
        expect(result.executed).toHaveLength(2);
        expect(result.executed.map((entry) => entry.status)).toEqual(["PASS", "FAIL"]);
        expect(result.executed.map((entry) => entry.command)).toEqual([
            "node -e \"console.log('first')\"",
            "node -e \"console.error('second failed'); process.exit(7)\"",
        ]);
        expect(result.failure).toEqual(result.executed[1]);
        expect(result.failure.summary).toEqual(["second failed"]);
        expect(reports).toHaveLength(2);
        expect(commandIndex).toBe(2);

        expect(readFileSync(path.join(repoRoot, result.executed[0].stdoutLog), "utf-8")).toBe("first\n");
        expect(readFileSync(path.join(repoRoot, result.executed[1].stderrLog), "utf-8")).toBe("second failed\n");
    });
});

function outputConfig() {
    return {
        failTailLines: 10,
        maxOutputBytes: 1000,
        outputMode: "quiet-on-pass",
        parser: "generic-tail",
        parserInputBytes: 1000,
        stripAnsi: true,
    };
}
