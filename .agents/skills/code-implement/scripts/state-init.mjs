#!/usr/bin/env node

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {buildStateTemplate, formatLocalDate, formatLocalTime, resolveStatePath, stateExists, writeText} from "./state-utils.mjs";

export function runStateInit({repoRoot, now = new Date()} = {}) {
    const {absolute: statePath, display} = resolveStatePath(repoRoot);

    if (stateExists(statePath)) {
        return {code: 0, stdout: `${display} (exists)\n`};
    }

    const createdAt = `${formatLocalDate(now)} ${formatLocalTime(now)}`;
    writeText(statePath, buildStateTemplate(createdAt));
    return {code: 0, stdout: `${display} (created)\n`};
}

function usage() {
    return [
        "Usage: state-init.mjs",
        "Creates the code-implement state file if it does not exist; an existing file is kept unchanged.",
        "Takes no arguments. Help (`--help` or `-h`) exits with code 0 without touching state.",
    ].join("\n");
}

async function main(argv) {
    if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (argv.length > 0) {
        process.stderr.write(`ERROR: unexpected arguments: ${argv.join(" ")}\n${usage()}\n`);
        process.exitCode = 2;
        return;
    }
    const result = runStateInit();
    if (result.stdout) { process.stdout.write(result.stdout); }
    if (result.stderr) { process.stderr.write(result.stderr); }
    process.exitCode = result.code;
}

if (isMainModule(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
