#!/usr/bin/env node
import {existsSync, mkdirSync, readdirSync, rmSync} from "node:fs";
import {join} from "node:path";

import {assertStorageLayout, resolveRepositoryRoot} from "../../_shared/scripts/artifact-path.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

export function resolveCacheRoot(cachePath = process.env.CACHE_PATH || "var/agent/cache", cwd = resolveRepositoryRoot()) {
    const normalized = String(cachePath).replace(/\/+$/, "") || "/";
    return {
        display: normalized,
        absolute: assertStorageLayout({cwd, cachePath}).cacheRoot,
    };
}

export function runAgentCacheClear({cachePath, cwd = resolveRepositoryRoot()} = {}) {
    const {absolute, display} = resolveCacheRoot(cachePath, cwd);

    if (!existsSync(absolute)) {
        mkdirSync(absolute, {recursive: true});
        return {code: 0, stdout: `${display} (created; nothing to clear)\n`};
    }

    for (const entry of readdirSync(absolute, {withFileTypes: true})) {
        rmSync(join(absolute, entry.name), {force: true, recursive: true});
    }

    return {code: 0, stdout: `${display} (cleared)\n`};
}

async function main() {
    if (process.argv.includes("--help") || process.argv.includes("-h")) {
        process.stdout.write("Usage: clear.mjs [--help]\nExplicitly empty repository-local CACHE_PATH with workflows stopped; preserve durable storage.\n");
        return;
    }
    if (process.argv.length > 2) { throw new Error("Usage: clear.mjs [--help]"); }
    const result = runAgentCacheClear();
    if (result.stdout) { process.stdout.write(result.stdout); }
    if (result.stderr) { process.stderr.write(result.stderr); }
    process.exitCode = result.code;
}

if (isMainModule(import.meta.url)) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
