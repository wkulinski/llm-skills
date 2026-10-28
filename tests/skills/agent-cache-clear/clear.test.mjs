import {existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {resolveCacheRoot, runAgentCacheClear} from "../../../.agents/skills/agent-cache-clear/scripts/clear.mjs";
import {assertRepositoryFilePath, resolvePersistentAgentRoot, resolveRepositoryRoot} from "../../../.agents/skills/_shared/scripts/artifact-path.mjs";

describe("agent-cache-clear", () => {
    it("creates an empty cache directory when missing", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "agent-cache-clear-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache-root");
            const result = runAgentCacheClear({cachePath, cwd: tempRoot});

            expect(result).toEqual({
                code: 0,
                stdout: `${cachePath} (created; nothing to clear)\n`,
            });
            expect(readdirSync(cachePath)).toEqual([]);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("clears the cache contents without removing the root directory", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "agent-cache-clear-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache-root");
            mkdirSync(path.join(cachePath, "nested"), {recursive: true});
            writeFileSync(path.join(cachePath, "file.txt"), "hello\n", "utf-8");
            writeFileSync(path.join(cachePath, "nested", "other.txt"), "world\n", "utf-8");

            const result = runAgentCacheClear({cachePath, cwd: tempRoot});

            expect(result).toEqual({
                code: 0,
                stdout: `${cachePath} (cleared)\n`,
            });
            expect(readdirSync(cachePath)).toEqual([]);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("normalizes trailing slashes while keeping the display path", () => {
        const resolved = resolveCacheRoot("var/agent/cache///");

        expect(resolved.display).toBe("var/agent/cache");
        expect(resolved.absolute).toContain("var/agent/cache");
    });

    it.each([".", "..", "/", "var/agent", "var/agent/task-plan", "var/agent/task-plan/nested",
        "var/agent/plan-execute", "var/agent/code-implement", "docs", "docs/plans/nested"])(
        "refuses unsafe cache %s before modifying anything", (cachePath) => {
            const cwd = mkdtempSync(path.join(os.tmpdir(), "cache-boundary-"));
            try {
                mkdirSync(path.join(cwd, "var/agent/task-plan"), {recursive: true});
                const sentinel = path.join(cwd, "var/agent/task-plan/source.json");
                writeFileSync(sentinel, "preserved");
                expect(() => runAgentCacheClear({cachePath, cwd})).toThrow();
                expect(readFileSync(sentinel, "utf8")).toBe("preserved");
                expect(existsSync(path.join(cwd, "docs"))).toBe(false);
            } finally {
                rmSync(cwd, {recursive: true, force: true});
            }
        });

    it.each(["cache", "cache/missing/child"])("refuses symlink ancestors of %s", (cachePath) => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), "cache-symlink-"));
        try {
            mkdirSync(path.join(cwd, "target"));
            writeFileSync(path.join(cwd, "target/keep"), "safe");
            symlinkSync(path.join(cwd, "target"), path.join(cwd, "cache"));
            expect(() => runAgentCacheClear({cachePath, cwd})).toThrow(/symlinks/);
            expect(readdirSync(path.join(cwd, "target"))).toEqual(["keep"]);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    it("preserves durable directories and only unlinks cache-entry symlinks", () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), "cache-durable-"));
        try {
            for (const directory of ["task-plan", "plan-execute", "code-implement"]) {
                mkdirSync(path.join(cwd, "var/agent", directory), {recursive: true});
                writeFileSync(path.join(cwd, "var/agent", directory, "keep"), directory);
            }
            mkdirSync(path.join(cwd, "custom-cache"));
            symlinkSync(path.join(cwd, "var/agent/task-plan"), path.join(cwd, "custom-cache/link"));
            runAgentCacheClear({cwd, cachePath: "custom-cache"});
            expect(readdirSync(path.join(cwd, "custom-cache"))).toEqual([]);
            expect(readFileSync(path.join(cwd, "var/agent/task-plan/keep"), "utf8")).toBe("task-plan");
            expect(resolvePersistentAgentRoot("code-implement", cwd)).toBe(path.join(cwd, "var/agent/code-implement"));
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    it("rejects invalid layouts for durable writes too", () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), "durable-layout-"));
        const previous = process.env.CACHE_PATH;
        try {
            process.env.CACHE_PATH = "var/agent";
            expect(() => resolvePersistentAgentRoot("task-plan", cwd)).toThrow(/overlaps/);
            expect(readdirSync(cwd)).toEqual([]);
            process.env.CACHE_PATH = "cache";
            mkdirSync(path.join(cwd, "var/agent"), {recursive: true});
            mkdirSync(path.join(cwd, "target"));
            symlinkSync(path.join(cwd, "target"), path.join(cwd, "var/agent/task-plan"));
            expect(() => resolvePersistentAgentRoot("task-plan", cwd)).toThrow(/symlinks/);
            expect(() => runAgentCacheClear({cwd, cachePath: "cache"})).toThrow(/symlinks/);
            expect(existsSync(path.join(cwd, "cache"))).toBe(false);
        } finally {
            if (typeof previous === "undefined") { delete process.env.CACHE_PATH; } else { process.env.CACHE_PATH = previous; }
            rmSync(cwd, {recursive: true, force: true});
        }
    });

    it("accepts a repository reached through a symlink above its root", () => {
        const base = mkdtempSync(path.join(os.tmpdir(), "logical-root-"));
        try {
            mkdirSync(path.join(base, "real/repo/var/agent/cache/nested"), {recursive: true});
            writeFileSync(path.join(base, "real/repo/var/agent/cache/nested/file"), "x");
            symlinkSync(path.join(base, "real"), path.join(base, "link"));
            const logicalRoot = path.join(base, "link/repo");
            expect(resolvePersistentAgentRoot("task-plan", logicalRoot)).toBe(path.join(logicalRoot, "var/agent/task-plan"));
            expect(assertRepositoryFilePath("var/agent/cache/nested/file", logicalRoot)).toBe(path.join(logicalRoot, "var/agent/cache/nested/file"));
            runAgentCacheClear({cwd: logicalRoot, cachePath: "var/agent/cache"});
            expect(readdirSync(path.join(base, "real/repo/var/agent/cache"))).toEqual([]);
        } finally {
            rmSync(base, {recursive: true, force: true});
        }
    });

    it("resolves the repository root from a subdirectory", () => {
        const cwd = mkdtempSync(path.join(os.tmpdir(), "repo-root-"));
        try {
            mkdirSync(path.join(cwd, ".git"));
            mkdirSync(path.join(cwd, "src/nested"), {recursive: true});
            expect(resolveRepositoryRoot(path.join(cwd, "src/nested"))).toBe(cwd);
        } finally {
            rmSync(cwd, {recursive: true, force: true});
        }
    });
});
