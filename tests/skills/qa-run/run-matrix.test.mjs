import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {afterEach, describe, expect, it} from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const runnerPath = path.join(repoRoot, ".agents/skills/qa-run/scripts/run-matrix.mjs");
const tempRoots = [];

afterEach(() => {
    while (tempRoots.length > 0) {
        const tempRoot = tempRoots.pop();
        rmSync(tempRoot, {force: true, recursive: true});
    }
});

describe("run-matrix output contract", () => {
    it("stores successful command output in artifacts and reports a compact pass summary", () => {
        const result = runMatrix({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: ["node -e \"console.log(Buffer.from('ZnVsbCBvdXRwdXQgc3RheXMgaW4gbG9n', 'base64').toString())\""],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("PASS [ALWAYS_FULL]");
        expect(result.stdout).not.toContain("full output stays in log");

        const summary = readSummary(result);
        expect(summary.status).toBe("PASS");
        expect(summary.commands).toHaveLength(1);
        expect(summary.commands[0].status).toBe("PASS");

        const stdoutLog = readArtifact(summary.commands[0].stdoutLog);
        expect(stdoutLog).toContain("full output stays in log");
    });

    it("reports only the configured generic failure tail while keeping full logs", () => {
        const result = runMatrix({
            outputDefaults: {
                ...outputDefaults(),
                failTailLines: 2,
            },
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        "node -e \"console.error('first error'); console.error('second error'); console.error('third error'); process.exit(7)\"",
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(7);
        expect(result.stderr).toContain("Failure summary:");
        expect(result.stderr).not.toContain("- first error");
        expect(result.stderr).toContain("- second error");
        expect(result.stderr).toContain("- third error");

        const summary = readSummary(result);
        expect(summary.status).toBe("FAIL");
        expect(summary.failures[0].summary).toEqual(["second error", "third error"]);

        const stderrLog = readArtifact(summary.failures[0].stderrLog);
        expect(stderrLog).toContain("first error");
        expect(stderrLog).toContain("second error");
        expect(stderrLog).toContain("third error");
    });

    it("uses command output config before section and root defaults", () => {
        const result = runMatrix({
            outputDefaults: {
                ...outputDefaults(),
                failTailLines: 10,
            },
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    output: {
                        failTailLines: 3,
                    },
                    patterns: [],
                    commands: [
                        {
                            cmd: "node -e \"console.error('root line'); console.error('section line'); console.error('command line'); process.exit(1)\"",
                            output: {
                                failTailLines: 1,
                            },
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(1);
        expect(result.stderr).not.toContain("- root line");
        expect(result.stderr).not.toContain("- section line");
        expect(result.stderr).toContain("- command line");

        const summary = readSummary(result);
        expect(summary.failures[0].summary).toEqual(["command line"]);
    });

    it("keeps failure details in artifacts when output mode is silent", () => {
        const result = runMatrix({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        {
                            cmd: "node -e \"console.error(Buffer.from('c2lsZW50IGZhaWx1cmUgZGV0YWls', 'base64').toString()); process.exit(4)\"",
                            outputMode: "silent",
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(4);
        expect(result.stderr).not.toContain("Failure summary:");
        expect(result.stderr).not.toContain("silent failure detail");

        const summary = readSummary(result);
        expect(summary.failures[0].summary).toEqual(["silent failure detail"]);

        const stderrLog = readArtifact(summary.failures[0].stderrLog);
        expect(stderrLog).toContain("silent failure detail");
    });

    it("extracts PHPStan JSON failures even when the generic tail is small", () => {
        const phpstanJson = JSON.stringify({
            errors: [],
            files: {
                "src/Foo.php": {
                    messages: [
                        {
                            line: 42,
                            message: "Parameter #1 expects X, Y given",
                        },
                    ],
                },
            },
        });
        const result = runMatrix({
            outputDefaults: {
                ...outputDefaults(),
                failTailLines: 1,
                maxOutputBytes: 2000,
                parserInputBytes: 1000,
            },
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        {
                            cmd: `printf '%s\\n' '${phpstanJson}'; exit 1`,
                            parser: "phpstan-json",
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("src/Foo.php:42 Parameter #1 expects X, Y given");

        const summary = readSummary(result);
        expect(summary.failures[0].summary).toEqual([
            "src/Foo.php:42 Parameter #1 expects X, Y given",
        ]);
    });

    it("extracts ESLint JSON failures", () => {
        const eslintJson = JSON.stringify([
            {
                filePath: "src/foo.ts",
                messages: [
                    {
                        line: 7,
                        column: 3,
                        ruleId: "no-unused-vars",
                        message: "x is defined but never used",
                    },
                ],
            },
        ]);
        const result = runMatrix({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        {
                            cmd: `printf '%s\\n' '${eslintJson}'; exit 1`,
                            parser: "eslint-json",
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("src/foo.ts:7:3 [no-unused-vars] x is defined but never used");

        const summary = readSummary(result);
        expect(summary.failures[0].summary).toEqual([
            "src/foo.ts:7:3 [no-unused-vars] x is defined but never used",
        ]);
    });

    it("rejects unknown parser names in command output config", () => {
        const result = runMatrix({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        {
                            cmd: "node -e \"console.log('not reached')\"",
                            parser: "unknown-parser",
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain("parser must be one of: generic-tail, phpstan-json, eslint-json");
        expect(result.stderr).not.toContain("not reached");
    });

    it("rejects command objects that use the removed command alias", () => {
        const result = runMatrix({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        {
                            command: "node -e \"console.log('not reached')\"",
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(2);
        expect(result.stderr).toContain('command object requires non-empty "cmd"');
        expect(result.stderr).not.toContain("not reached");
    });

    it("runs only sections affected by changes since snapshot during delta rerun", () => {
        const repoTempRoot = mkdtempSync(path.join(repoRoot, "qa-run-delta-vitest-"));
        tempRoots.push(repoTempRoot);
        const repoTempName = path.basename(repoTempRoot);
        const config = {
            outputDefaults: outputDefaults(),
            sectionOrder: ["MARKDOWN_CHANGED", "JS_CHANGED"],
            sections: {
                MARKDOWN_CHANGED: {
                    patterns: [`${repoTempName}/**/*.md`],
                    commands: ["node -e \"console.log('markdown command ran')\""],
                    runOn: ["rerun"],
                    requiresFinalFullPass: false,
                },
                JS_CHANGED: {
                    patterns: [`${repoTempName}/**/*.mjs`],
                    commands: ["node -e \"console.log('js command ran')\""],
                    runOn: ["rerun"],
                    requiresFinalFullPass: false,
                },
            },
        };
        const {configPath, tempRoot} = writeMatrixConfig(config);
        const snapshotPath = path.join(tempRoot, "snapshot.json");

        const snapshotResult = runMatrixConfig(configPath, tempRoot, [
            "--snapshot-only",
            "--snapshot-write",
            snapshotPath,
        ]);
        expect(snapshotResult.status).toBe(0);

        writeFileSync(path.join(repoTempRoot, "changed.md"), "# changed\n", "utf-8");

        const result = runMatrixConfig(configPath, tempRoot, [
            "--rerun-reason",
            "post-fix-delta",
            "--delta-from-snapshot",
            snapshotPath,
        ]);

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("- MARKDOWN_CHANGED=1");
        expect(result.stdout).toContain("- JS_CHANGED=0");
        expect(result.stdout).toContain("PASS [MARKDOWN_CHANGED]");
        expect(result.stdout).not.toContain("PASS [JS_CHANGED]");
        expect(result.stdout).not.toContain("js command ran");

        const summary = readSummary(result);
        expect(summary.mode).toBe("delta");
        expect(summary.activeSections).toEqual(["MARKDOWN_CHANGED"]);
        expect(summary.commands).toHaveLength(1);
        expect(summary.commands[0].section).toBe("MARKDOWN_CHANGED");
        expect(summary.skippedNoChanges).toEqual(["JS_CHANGED"]);
    });
});

function outputDefaults() {
    return {
        outputMode: "quiet-on-pass",
        failTailLines: 120,
        maxOutputBytes: 20000,
        parserInputBytes: 5242880,
        stripAnsi: true,
        parser: "generic-tail",
    };
}

function runMatrix(config, args = ["--rerun-reason", "initial"]) {
    const {configPath, tempRoot} = writeMatrixConfig(config);
    return runMatrixConfig(configPath, tempRoot, args);
}

function writeMatrixConfig(config) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-vitest-"));
    tempRoots.push(tempRoot);
    const configPath = path.join(tempRoot, "matrix.json");
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf-8");

    return {configPath, tempRoot};
}

function runMatrixConfig(configPath, tempRoot, args) {
    return spawnSync("node", [
        runnerPath,
        "--config",
        configPath,
        ...args,
    ], {
        cwd: repoRoot,
        encoding: "utf-8",
        env: {
            ...process.env,
            CACHE_PATH: path.join(tempRoot, "cache"),
        },
    });
}

function readSummary(result) {
    const output = `${result.stdout}\n${result.stderr}`;
    const match = output.match(/INFO: QA summary written: (.+)$/m);
    expect(match, output).not.toBeNull();

    const summaryPath = path.resolve(repoRoot, match[1]);
    return JSON.parse(readFileSync(summaryPath, "utf-8"));
}

function readArtifact(artifactPath) {
    return readFileSync(path.resolve(repoRoot, artifactPath), "utf-8");
}
