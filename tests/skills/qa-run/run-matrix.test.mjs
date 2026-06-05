import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const runnerPath = path.join(repoRoot, ".agents/skills/qa-run/scripts/run-matrix.mjs");
const {parseConfig} = await import(pathToFileURL(runnerPath).href);
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

    it("reports config notices for commands with available machine parsers", () => {
        const result = runMatrix({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL", "SKIPPED_CHANGED"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        "node -e \"console.log('ok')\" -- phpstan",
                        {
                            cmd: "node -e \"console.log('ok')\" -- eslint",
                            parser: "eslint-json",
                        },
                        {
                            cmd: "node -e \"console.log('ok')\" -- phpstan --error-format=json",
                            parser: "phpstan-json",
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
                SKIPPED_CHANGED: {
                    patterns: ["never-matched/**"],
                    commands: [
                        "node -e \"console.log('not reached')\" -- phpstan",
                    ],
                    runOn: ["rerun"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Config notices:");
        expect(result.stdout).toContain("NOTICE [ALWAYS_FULL] PHPStan command uses parser=generic-tail");
        expect(result.stdout).toContain("NOTICE [ALWAYS_FULL] ESLint command uses parser=eslint-json, but --format json is not visible");
        expect(result.stdout).not.toContain("NOTICE [SKIPPED_CHANGED]");

        const summary = readSummary(result);
        expect(summary.configNotices).toHaveLength(2);
        expect(summary.configNotices.map((notice) => notice.code)).toEqual([
            "machine-parser-available",
            "machine-parser-flag-not-visible",
        ]);
    });

    it("does not report config notices for commands already using supported machine output", () => {
        const result = runMatrix({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        {
                            cmd: "node -e \"console.log('ok')\" -- phpstan --error-format=json",
                            parser: "phpstan-json",
                        },
                        {
                            cmd: "node -e \"console.log('ok')\" -- eslint --format json",
                            parser: "eslint-json",
                        },
                        {
                            cmd: "node -e \"console.log('ok')\" -- eslint -f json",
                            parser: "eslint-json",
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(result.status).toBe(0);
        expect(result.stdout).not.toContain("Config notices:");

        const summary = readSummary(result);
        expect(summary.configNotices).toEqual([]);
    });

    it("parses the repo matrix and bundled dist template", () => {
        const matrixPaths = [
            ".agents/qa-run.matrix.json",
            ".agents/skills/qa-run/templates/qa-run.matrix.dist.json",
        ];

        for (const matrixPath of matrixPaths) {
            const config = parseConfig(readFileSync(path.join(repoRoot, matrixPath), "utf-8"), matrixPath);

            expect(config.sectionOrder.length, matrixPath).toBeGreaterThan(0);
            expect(Object.keys(config.sections).sort(), matrixPath).toEqual([...config.sectionOrder].sort());
        }
    });

    it("rejects unknown parser names in command output config", () => {
        expect(() => parseTestConfig({
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
        })).toThrow("parser must be one of: generic-tail, phpstan-json, eslint-json");
    });

    it("rejects command objects that use the removed command alias", () => {
        expect(() => parseTestConfig({
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
        })).toThrow('command object requires non-empty "cmd"');
    });

    it("rejects invalid rerun reason and snapshot argument combinations", () => {
        const {configPath, tempRoot} = writeMatrixConfig({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: ["node -e \"console.log('not reached')\""],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        });

        const cases = [
            {
                args: ["--rerun-reason", "initial", "--delta-from-snapshot", "snapshot.json"],
                stderr: "Initial rerun cannot use --delta-from-snapshot",
            },
            {
                args: ["--rerun-reason", "post-fix-delta"],
                stderr: "Delta rerun requires --delta-from-snapshot",
            },
            {
                args: ["--rerun-reason", "review-fix-delta"],
                stderr: "Delta rerun requires --delta-from-snapshot",
            },
            {
                args: ["--rerun-reason", "full-final-pass", "--delta-from-snapshot", "snapshot.json"],
                stderr: "Full final pass cannot use --delta-from-snapshot",
            },
            {
                args: ["--rerun-reason", "unknown-reason"],
                stderr: "Invalid value for --rerun-reason: unknown-reason",
            },
        ];

        for (const testCase of cases) {
            const result = runMatrixConfig(configPath, tempRoot, testCase.args);

            expect(result.status, testCase.stderr).toBe(2);
            expect(result.stderr, testCase.stderr).toContain(testCase.stderr);
        }
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

    it("tracks pending final full pass through delta and clears it on full-final-pass", () => {
        const repoTempRoot = mkdtempSync(path.join(repoRoot, "qa-run-session-vitest-"));
        tempRoots.push(repoTempRoot);
        const repoTempName = path.basename(repoTempRoot);
        const {configPath, tempRoot} = writeMatrixConfig({
            outputDefaults: outputDefaults(),
            sectionOrder: ["RISK_CHANGED"],
            sections: {
                RISK_CHANGED: {
                    patterns: [`${repoTempName}/**/*.txt`],
                    commands: ["node -e \"console.log('risk command ran')\""],
                    runOn: ["full", "rerun"],
                    requiresFinalFullPass: true,
                },
            },
        });
        const snapshotPath = path.join(tempRoot, "snapshot.json");
        const sessionPath = path.join(tempRoot, "session.json");

        expect(runMatrixConfig(configPath, tempRoot, ["--snapshot-only", "--snapshot-write", snapshotPath]).status).toBe(0);
        writeFileSync(path.join(repoTempRoot, "changed.txt"), "changed\n", "utf-8");

        const delta = runMatrixConfig(configPath, tempRoot, [
            "--session",
            sessionPath,
            ...deltaArgs(snapshotPath),
        ]);

        expect(delta.status).toBe(0);
        expect(delta.stdout).toContain("- pending_final_full_pass=1");

        const deltaSummary = readSummary(delta);
        expect(deltaSummary.pendingFinalFullPass).toBe(true);
        expect(deltaSummary.pendingFinalFullPassReasons).toEqual([
            "section_requires_final_full_pass:RISK_CHANGED",
        ]);

        const pendingSession = readJson(sessionPath);
        expect(pendingSession.pendingFinalFullPass).toBe(true);
        expect(pendingSession.pendingReasons).toEqual([
            "section_requires_final_full_pass:RISK_CHANGED",
        ]);

        const finalFull = runMatrixConfig(configPath, tempRoot, [
            "--session",
            sessionPath,
            "--rerun-reason",
            "full-final-pass",
        ]);

        expect(finalFull.status).toBe(0);
        expect(finalFull.stdout).toContain("PASS [RISK_CHANGED]");
        expect(finalFull.stdout).toContain("- pending_final_full_pass=0");

        const finalSummary = readSummary(finalFull);
        expect(finalSummary.mode).toBe("full");
        expect(finalSummary.pendingFinalFullPass).toBe(false);
        expect(finalSummary.pendingFinalFullPassReasons).toEqual([]);

        const clearedSession = readJson(sessionPath);
        expect(clearedSession.pendingFinalFullPass).toBe(false);
        expect(clearedSession.pendingReasons).toEqual([]);
        expect(clearedSession.lastFullPass).toEqual(expect.objectContaining({
            matrixHash: clearedSession.matrixHash,
        }));
    });

    it("uses @git-visible for any changed repo file and rejects overriding built-in pattern sets", () => {
        const repoTempRoot = mkdtempSync(path.join(repoRoot, "qa-run-git-visible-vitest-"));
        tempRoots.push(repoTempRoot);
        const repoTempName = path.basename(repoTempRoot);
        const {configPath, tempRoot} = writeMatrixConfig({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ANY_CHANGED"],
            sections: {
                ANY_CHANGED: {
                    patterns: ["@git-visible"],
                    commands: ["node -e \"console.log('git visible command ran')\""],
                    runOn: ["rerun"],
                    requiresFinalFullPass: false,
                },
            },
        });
        const snapshotPath = path.join(tempRoot, "snapshot.json");

        expect(runMatrixConfig(configPath, tempRoot, ["--snapshot-only", "--snapshot-write", snapshotPath]).status).toBe(0);
        writeFileSync(path.join(repoTempRoot, "changed.anything"), "changed\n", "utf-8");

        const result = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));

        expect(result.status).toBe(0);
        expect(result.stdout).toContain("- ANY_CHANGED=1");
        expect(result.stdout).toContain("PASS [ANY_CHANGED]");

        const summary = readSummary(result);
        expect(summary.activeSections).toEqual(["ANY_CHANGED"]);
        expect(summary.commands[0].status).toBe("PASS");

        for (const builtInName of ["git-visible", "php-safe", "js-ts-safe"]) {
            expect(() => parseTestConfig({
                patternSets: {
                    [builtInName]: [`${repoTempName}/**/*`],
                },
                outputDefaults: outputDefaults(),
                sectionOrder: ["ANY_CHANGED"],
                sections: {
                    ANY_CHANGED: {
                        patterns: [`@${builtInName}`],
                        commands: ["node -e \"console.log('not reached')\""],
                        runOn: ["rerun"],
                        requiresFinalFullPass: false,
                    },
                },
            })).toThrow(`Config patternSets cannot override built-in pattern set "@${builtInName}".`);
        }
    });

    it("skips cached rerun commands and invalidates them when inputs change", () => {
        const {config, inputPath, tempRoot} = createCacheConfig("changed.mjs");
        const counterPath = path.join(tempRoot, "counter.txt");
        config.patternSets = {
            "repo-node": ["@js-ts-safe"],
        };
        config.sections.CACHE_CHANGED.patterns = ["@repo-node"];
        config.sections.CACHE_CHANGED.cache = {
            enabled: true,
        };
        config.sections.CACHE_CHANGED.commands = [counterCommand(counterPath)];
        const {configPath} = writeMatrixConfig(config, tempRoot);
        const snapshotPath = path.join(tempRoot, "snapshot.json");

        expect(runMatrixConfig(configPath, tempRoot, ["--snapshot-only", "--snapshot-write", snapshotPath]).status).toBe(0);
        writeFileSync(inputPath, "first\n", "utf-8");

        const first = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));
        expect(first.status).toBe(0);
        expect(first.stdout).toContain("PASS [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(1);

        const second = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));
        expect(second.status).toBe(0);
        expect(second.stdout).toContain("SKIP-CACHED [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(1);

        const summary = readSummary(second);
        expect(summary.commands[0].status).toBe("SKIP-CACHED");
        expect(summary.commands[0].cached).toBe(true);
        expect(summary.commands[0].cache.hit).toBe(true);
        expect(summary.commands[0].stdoutLog.startsWith(`${summary.artifactsDir}/commands/`)).toBe(true);
        expect(summary.commands[0].cache.previousStdoutLog).not.toBe(summary.commands[0].stdoutLog);
        expect(readArtifact(summary.commands[0].stdoutLog)).toContain("SKIP-CACHED");
        expect(readArtifact(summary.commands[0].stdoutLog)).toContain(`previous_stdout=${summary.commands[0].cache.previousStdoutLog}`);

        const clean = runMatrixConfig(configPath, tempRoot, [
            ...deltaArgs(snapshotPath),
            "--no-cache",
        ]);
        expect(clean.status).toBe(0);
        expect(clean.stdout).toContain("PASS [CACHE_CHANGED]");
        expect(clean.stdout).not.toContain("SKIP-CACHED [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(2);

        writeFileSync(inputPath, "second\n", "utf-8");
        const third = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));

        expect(third.status).toBe(0);
        expect(third.stdout).toContain("PASS [CACHE_CHANGED]");
        expect(third.stdout).not.toContain("SKIP-CACHED [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(3);

        const fourth = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));
        expect(fourth.status).toBe(0);
        expect(fourth.stdout).toContain("SKIP-CACHED [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(3);
    });

    it("stores mutating command cache under the post-command fingerprint", () => {
        const {config, inputPath, tempRoot} = createCacheConfig("changed.txt");
        const counterPath = path.join(tempRoot, "counter.txt");
        config.sections.CACHE_CHANGED.cache = {
            enabled: true,
        };
        config.sections.CACHE_CHANGED.commands = [mutatingInputCommand(inputPath, counterPath)];
        const {configPath} = writeMatrixConfig(config, tempRoot);
        const snapshotPath = path.join(tempRoot, "snapshot.json");

        expect(runMatrixConfig(configPath, tempRoot, ["--snapshot-only", "--snapshot-write", snapshotPath]).status).toBe(0);
        writeFileSync(inputPath, "needs fix\n", "utf-8");

        const first = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));
        expect(first.status).toBe(0);
        expect(first.stdout).toContain("PASS [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(1);
        expect(readFileSync(inputPath, "utf-8")).toBe("fixed\n");

        const second = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));
        expect(second.status).toBe(0);
        expect(second.stdout).toContain("SKIP-CACHED [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(1);
        expect(readSummary(second).commands[0].cache.mutatedInputs).toBe(true);

        writeFileSync(inputPath, "needs fix\n", "utf-8");
        const third = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));
        expect(third.status).toBe(0);
        expect(third.stdout).toContain("PASS [CACHE_CHANGED]");
        expect(third.stdout).not.toContain("SKIP-CACHED [CACHE_CHANGED]");
        expect(readCounter(counterPath)).toBe(2);
        expect(readFileSync(inputPath, "utf-8")).toBe("fixed\n");
    });

    it("disables section cache when patterns are empty or enabled is not true", () => {
        const config = parseTestConfig({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL", "FILES_CHANGED"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    cache: {
                        enabled: true,
                    },
                    commands: ["node -e \"console.log('not reached')\""],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
                FILES_CHANGED: {
                    patterns: ["**/*.mjs"],
                    commands: ["node -e \"console.log('not reached')\""],
                    runOn: ["rerun"],
                    requiresFinalFullPass: false,
                },
            },
        });

        expect(config.sections.ALWAYS_FULL.cache.enabled).toBe(false);
        expect(config.sections.FILES_CHANGED.cache.enabled).toBe(false);
    });

    it("does not store failing command results as reusable pass cache", () => {
        const {config, inputPath, tempRoot} = createCacheConfig("changed.txt");
        const counterPath = path.join(tempRoot, "counter.txt");
        config.sections.CACHE_CHANGED.cache = {
            enabled: true,
        };
        config.sections.CACHE_CHANGED.commands = [`${counterCommand(counterPath)}; exit 6`];
        const {configPath} = writeMatrixConfig(config, tempRoot);
        const snapshotPath = path.join(tempRoot, "snapshot.json");

        expect(runMatrixConfig(configPath, tempRoot, ["--snapshot-only", "--snapshot-write", snapshotPath]).status).toBe(0);
        writeFileSync(inputPath, "first\n", "utf-8");

        const first = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));
        const second = runMatrixConfig(configPath, tempRoot, deltaArgs(snapshotPath));

        expect(first.status).toBe(6);
        expect(second.status).toBe(6);
        expect(second.stdout).not.toContain("SKIP-CACHED");
        expect(readCounter(counterPath)).toBe(2);
    });

    it("rejects command cache and invalid pattern set declarations", () => {
        expect(() => parseTestConfig({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: [
                        {
                            cmd: "node -e \"console.log('not reached')\"",
                            cache: {
                                enabled: true,
                            },
                        },
                    ],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        })).toThrow("command cache is not supported");

        expect(() => parseTestConfig({
            outputDefaults: outputDefaults(),
            sectionOrder: ["FILES_CHANGED"],
            sections: {
                FILES_CHANGED: {
                    patterns: ["**/*.mjs"],
                    cache: {
                        enabled: true,
                        envkeys: ["NODE_ENV"],
                    },
                    commands: ["node -e \"console.log('not reached')\""],
                    runOn: ["rerun"],
                    requiresFinalFullPass: false,
                },
            },
        })).toThrow('cache supports only "enabled" and "envKeys"; unknown keys: envkeys');

        expect(() => parseTestConfig({
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: ["@missing-set"],
                    commands: ["node -e \"console.log('not reached')\""],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        })).toThrow('Unknown pattern set "@missing-set"');

        expect(() => parseTestConfig({
            patternSets: {
                first: ["@second"],
                second: ["@first"],
            },
            outputDefaults: outputDefaults(),
            sectionOrder: ["ALWAYS_FULL"],
            sections: {
                ALWAYS_FULL: {
                    patterns: [],
                    commands: ["node -e \"console.log('not reached')\""],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        })).toThrow("Circular pattern set reference");
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

function writeMatrixConfig(config, existingTempRoot = null) {
    const tempRoot = existingTempRoot ?? mkdtempSync(path.join(os.tmpdir(), "qa-run-vitest-"));
    if (!tempRoots.includes(tempRoot)) {
        tempRoots.push(tempRoot);
    }
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

function readJson(jsonPath) {
    return JSON.parse(readFileSync(jsonPath, "utf-8"));
}

function parseTestConfig(config) {
    return parseConfig(JSON.stringify(config), "test-matrix.json");
}

function createCacheConfig(inputFileName) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-vitest-"));
    tempRoots.push(tempRoot);
    const repoTempRoot = mkdtempSync(path.join(repoRoot, "qa-run-cache-vitest-"));
    tempRoots.push(repoTempRoot);
    const repoTempName = path.basename(repoTempRoot);
    const inputPath = path.join(repoTempRoot, inputFileName);

    return {
        config: {
            outputDefaults: outputDefaults(),
            sectionOrder: ["CACHE_CHANGED"],
            sections: {
                CACHE_CHANGED: {
                    patterns: [`${repoTempName}/**/*`],
                    commands: [],
                    runOn: ["rerun"],
                    requiresFinalFullPass: false,
                },
            },
        },
        inputPath,
        tempRoot,
    };
}

function counterCommand(counterPath) {
    const script = [
        "const fs = require('node:fs')",
        `const p = ${JSON.stringify(counterPath)}`,
        "const n = fs.existsSync(p) ? Number(fs.readFileSync(p, 'utf-8')) : 0",
        "fs.writeFileSync(p, String(n + 1))",
    ].join("; ");
    return `node -e ${JSON.stringify(script)}`;
}

function mutatingInputCommand(inputPath, counterPath) {
    const script = [
        "const fs = require('node:fs')",
        `const input = ${JSON.stringify(inputPath)}`,
        `const counter = ${JSON.stringify(counterPath)}`,
        "const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf-8')) : 0",
        "fs.writeFileSync(counter, String(n + 1))",
        "if (fs.readFileSync(input, 'utf-8').includes('needs fix')) fs.writeFileSync(input, 'fixed\\n')",
    ].join("; ");
    return `node -e ${JSON.stringify(script)}`;
}

function deltaArgs(snapshotPath) {
    return [
        "--rerun-reason",
        "post-fix-delta",
        "--delta-from-snapshot",
        snapshotPath,
    ];
}

function readCounter(counterPath) {
    return Number(readFileSync(counterPath, "utf-8"));
}
