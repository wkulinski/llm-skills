import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {resolveCacheRoot, runAgentCacheClear} from "../../../.agents/skills/agent-cache-clear/scripts/clear.mjs";

describe("agent-cache-clear", () => {
    it("creates an empty cache directory when missing", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "agent-cache-clear-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache-root");
            const result = runAgentCacheClear({cachePath});

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

            const result = runAgentCacheClear({cachePath});

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
});
