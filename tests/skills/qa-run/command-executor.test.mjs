import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync} from "node:fs";
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

    it("keeps a noisy successful run out of the console while preserving raw logs", async () => {
        const {executor, repoRoot} = createExecutor({reporter: null});
        const noisy = "for (let i = 0; i < 50; i++) console.log('\\u001b[32m✔ scenario ' + i + '\\u001b[0m'); process.stderr.write('[=====>    ] 60%\\r[==========] 100%\\n')";

        const result = await executor.runEntries([{
            command: {argv: {args: ["-e", noisy], file: process.execPath}, cmd: "node -e <noisy>", label: "noisy.test.mjs", output: outputConfig()},
            section: {cache: {enabled: false}, name: "targeted:unit"},
        }]);

        const consoleText = consoleLogSpy.mock.calls.flat().join("\n");
        expect(result.ok).toBe(true);
        expect(consoleText).toMatch(/^PASS \[targeted:unit\] noisy\.test\.mjs \d+\.\ds$/);
        expect(consoleText).not.toContain("scenario");
        expect(consoleText).not.toContain("node -e");
        expect(consoleText).not.toContain("100%");
        expect(readFileSync(path.join(repoRoot, result.executed[0].stdoutLog), "utf-8")).toContain("\u001b[32m✔ scenario 49");
        expect(readFileSync(path.join(repoRoot, result.executed[0].stderrLog), "utf-8")).toContain("[==========] 100%");
        expect(statSync(path.join(repoRoot, result.executed[0].stdoutLog)).mode & 0o777).toBe(0o600);
        expect(statSync(path.join(repoRoot, "commands")).mode & 0o777).toBe(0o700);
    });

    it("reports a process start failure as ERROR with a non-zero exit code", async () => {
        const {executor} = createExecutor();

        const result = await executor.runEntries([{
            command: {argv: {args: [], file: "/nonexistent/qa-run-tool"}, cmd: "missing", label: "a.test.mjs", output: outputConfig()},
            section: {cache: {enabled: false}, name: "targeted:unit"},
        }]);

        expect(result.ok).toBe(false);
        expect(result.failure.status).toBe("ERROR");
        expect(result.exitCode).not.toBe(0);
        expect(result.failure.error).toContain("ENOENT");
    });

    it("reports a log write failure as ERROR instead of PASS", async () => {
        const {executor, repoRoot} = createExecutor();
        const command = {cmd: "node -e \"console.log('ok')\"", output: outputConfig(), sourceIndex: 0};
        await executor.runEntries([{command, section: {cache: {enabled: false}, name: "LOG_FAIL"}}]);
        const [stdoutLogName] = readdirSync(path.join(repoRoot, "commands")).filter((name) => name.endsWith(".stdout.log"));
        const blockedPath = path.join(repoRoot, "commands", stdoutLogName.replace(/^001-/, "002-"));
        mkdirSync(blockedPath);

        const result = await executor.runEntries([{command, section: {cache: {enabled: false}, name: "LOG_FAIL"}}]);

        expect(result.ok).toBe(false);
        expect(result.failure.status).toBe("ERROR");
        expect(result.exitCode).not.toBe(0);
        expect(result.failure.error).toContain("cannot write command log");
    });

    it("omits suspected secrets from the context summary but keeps them in the local log", async () => {
        const {executor, repoRoot} = createExecutor();
        const secret = syntheticToken();
        const script = `console.error('assertion failed'); console.error('token used: ${secret}'); process.exit(3)`;

        const result = await executor.runEntries([{
            command: {argv: {args: ["-e", script], file: process.execPath}, cmd: "node -e <script>", label: "a.test.mjs", output: outputConfig()},
            section: {cache: {enabled: false}, name: "targeted:unit"},
        }]);

        expect(result.exitCode).toBe(3);
        expect(result.failure.summary).toEqual([
            "assertion failed",
            "1 diagnostic line(s) omitted: possible secret; see local stdout/stderr logs.",
        ]);
        expect(JSON.stringify(result.failure.summary)).not.toContain(secret);
        expect(readFileSync(path.join(repoRoot, result.failure.stderrLog), "utf-8")).toContain(secret);
    });

    it("executes argv commands without a shell so arguments stay literal", async () => {
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-executor-unit-"));
        tempRoots.push(repoRoot);
        const literal = "$(echo injected) `id`; echo next";
        const executor = new CommandExecutor({
            artifacts: {commandsDir: path.join(repoRoot, "commands"), relativeDir: "artifacts"},
            cli: {noCache: false, rerunReason: "initial", scope: "point"},
            commandCounter: {next: () => 1},
            config: {raw: {}},
            reporter: () => null,
            repoRoot,
        });

        const result = await executor.runEntries([{
            command: {
                argv: {args: ["-e", "console.log(JSON.stringify(process.argv.slice(1)))", literal], file: process.execPath},
                cmd: "node -e <print-args> <literal>",
                output: outputConfig(),
            },
            section: {cache: {enabled: false}, name: "targeted:unit"},
        }]);

        expect(result.ok).toBe(true);
        expect(JSON.parse(readFileSync(path.join(repoRoot, result.executed[0].stdoutLog), "utf-8"))).toEqual([literal]);
    });
});

function createExecutor({reporter = () => null} = {}) {
    const repoRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-executor-unit-"));
    tempRoots.push(repoRoot);
    let commandIndex = 0;
    const executor = new CommandExecutor({
        artifacts: {commandsDir: path.join(repoRoot, "commands"), relativeDir: "artifacts"},
        cli: {noCache: false, rerunReason: "initial", scope: "point"},
        commandCounter: {next: () => ++commandIndex},
        config: {raw: {}},
        ...(reporter ? {reporter} : {}),
        repoRoot,
    });

    return {executor, repoRoot};
}

function syntheticToken() {
    return ["gh", "p_"].join("") + "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVcXz";
}

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
