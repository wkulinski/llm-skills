#!/usr/bin/env node
import {pathToFileURL} from "node:url";

import {buildStateTemplate, formatLocalDate, formatLocalTime, resolveStatePath, stateExists, writeText} from "./state-utils.mjs";

export function runStateInit({cachePath, now = new Date()} = {}) {
    const {absolute: statePath, display} = resolveStatePath(cachePath);

    if (stateExists(statePath)) {
        return {code: 0, stdout: `${display} (exists)\n`};
    }

    const createdAt = `${formatLocalDate(now)} ${formatLocalTime(now)}`;
    writeText(statePath, buildStateTemplate(createdAt));
    return {code: 0, stdout: `${display} (created)\n`};
}

async function main() {
    const result = runStateInit();
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
