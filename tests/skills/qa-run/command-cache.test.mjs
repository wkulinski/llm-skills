import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {
    buildCachedCommandResult,
    buildCommandCacheFingerprint,
    readCommandCache,
    writeCachedCommandLogs,
} from "../../../.agents/skills/qa-run/scripts/run-matrix/cache/command-cache.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const tempRoots = [];

afterEach(() => {
    while (tempRoots.length > 0) {
        const tempRoot = tempRoots.pop();
        rmSync(tempRoot, {force: true, recursive: true});
    }
    delete process.env.QA_RUN_CACHE_TEST_ENV;
});

describe("run-matrix command cache", () => {
    it("fingerprints command, env, patterns, matrix, and input files", () => {
        const repoTempRoot = mkdtempSync(path.join(repoRoot, "qa-run-cache-unit-"));
        tempRoots.push(repoTempRoot);
        const repoTempName = path.basename(repoTempRoot);
        const inputPath = path.join(repoTempRoot, "input.txt");
        writeFileSync(inputPath, "first\n", "utf-8");
        process.env.QA_RUN_CACHE_TEST_ENV = "first-env";

        const section = {
            cache: {
                envKeys: ["QA_RUN_CACHE_TEST_ENV"],
            },
            name: "CACHE_CHANGED",
            resolvedPatterns: {
                includeGitVisible: false,
                patternSets: ["unit-set"],
                patterns: [`${repoTempName}/**/*.txt`],
            },
        };
        const command = {
            cmd: "node -e \"console.log('ok')\"",
        };
        const config = {
            raw: {
                sectionOrder: ["CACHE_CHANGED"],
            },
        };

        const first = buildCommandCacheFingerprint(repoRoot, section, command, config);
        writeFileSync(inputPath, "second\n", "utf-8");
        const second = buildCommandCacheFingerprint(repoRoot, section, command, config);

        expect(first.patterns).toEqual([`${repoTempName}/**/*.txt`]);
        expect(first.patternSets).toEqual(["unit-set"]);
        expect(first.cacheKey).not.toBe(second.cacheKey);
        expect(first.inputFilesHash).not.toBe(second.inputFilesHash);
        expect(first.envHash).toBe(second.envHash);
    });

    it("ignores invalid cache files and builds cache-hit results", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-cache-unit-"));
        tempRoots.push(tempRoot);
        const cachePath = path.join(tempRoot, "cache.json");
        const commandCache = {
            fingerprint: {
                cacheKey: "expected-cache-key",
            },
            path: cachePath,
        };
        writeFileSync(cachePath, JSON.stringify({
            fingerprint: {
                cacheKey: "different-cache-key",
            },
            status: "PASS",
            version: 1,
        }), "utf-8");

        expect(readCommandCache(commandCache)).toBeNull();

        const cacheHit = {
            artifactsDir: "previous/artifacts",
            completedAt: "2026-01-01T00:00:00.000Z",
            fingerprint: {
                cacheKey: "expected-cache-key",
            },
            mutatedInputs: true,
            stderrLog: "previous.stderr.log",
            stdoutLog: "previous.stdout.log",
        };
        const result = buildCachedCommandResult("CACHE_CHANGED", {
            cmd: "node -e ok",
            output: {
                parser: "generic-tail",
            },
        }, cacheHit, {
            stderrLog: "current.stderr.log",
            stdoutLog: "current.stdout.log",
        });

        expect(result.status).toBe("SKIP-CACHED");
        expect(result.cache).toEqual(expect.objectContaining({
            cacheKey: "expected-cache-key",
            hit: true,
            mutatedInputs: true,
            previousStdoutLog: "previous.stdout.log",
        }));
    });

    it("writes stable cache-hit log contents", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-cache-unit-"));
        tempRoots.push(tempRoot);
        const stdoutPath = path.join(tempRoot, "stdout.log");
        const stderrPath = path.join(tempRoot, "stderr.log");

        writeCachedCommandLogs({
            stderrAbsPath: stderrPath,
            stdoutAbsPath: stdoutPath,
        }, {
            artifactsDir: "previous/artifacts",
            completedAt: "2026-01-01T00:00:00.000Z",
            fingerprint: {
                cacheKey: "cache-key",
            },
            mutatedInputs: false,
            stderrLog: "previous.stderr.log",
            stdoutLog: "previous.stdout.log",
        });

        expect(readFileSync(stdoutPath, "utf-8")).toBe([
            "SKIP-CACHED",
            "previous_pass=2026-01-01T00:00:00.000Z",
            "previous_artifacts=previous/artifacts",
            "previous_stdout=previous.stdout.log",
            "previous_stderr=previous.stderr.log",
            "cache_key=cache-key",
            "mutated_inputs=0",
            "",
        ].join("\n"));
        expect(readFileSync(stderrPath, "utf-8")).toBe("");
    });
});
