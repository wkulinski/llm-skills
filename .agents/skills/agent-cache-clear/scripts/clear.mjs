#!/usr/bin/env node
import {existsSync, mkdirSync, readdirSync, rmSync} from "node:fs";
import {isAbsolute, join} from "node:path";
import {fileURLToPath} from "node:url";

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export function resolveCacheRoot(cachePath = process.env.CACHE_PATH || "var/agent/cache") {
    const normalized = String(cachePath).replace(/\/+$/, "");
    return {
        display: normalized || "var/agent/cache",
        absolute: isAbsolute(normalized) ? normalized : join(repoRoot, normalized || "var/agent/cache"),
    };
}

export function runAgentCacheClear({cachePath} = {}) {
    const {absolute, display} = resolveCacheRoot(cachePath);

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
