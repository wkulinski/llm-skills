#!/usr/bin/env node
import {rmSync} from "node:fs";
import {pathToFileURL} from "node:url";

import {resolveStatePath, stateExists} from "./state-utils.mjs";

export function runStateClear({cachePath} = {}) {
    const {absolute: statePath, display} = resolveStatePath(cachePath);

    if (!stateExists(statePath)) {
        return {code: 0, stdout: `${display} (missing; nothing to clear)\n`};
    }

    rmSync(statePath, {force: true});
    return {code: 0, stdout: `${display} (cleared)\n`};
}

async function main() {
    const result = runStateClear();
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
