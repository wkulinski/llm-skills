#!/usr/bin/env node
import {rmSync} from "node:fs";

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {resolveReadEventsPath, resolveStatePath, stateExists} from "./state-utils.mjs";

export function runStateClear({cachePath} = {}) {
    const {absolute: statePath, display} = resolveStatePath(cachePath);
    const {absolute: readEventsPath, display: readEventsDisplay} = resolveReadEventsPath(cachePath);
    const statePresent = stateExists(statePath);
    const readEventsPresent = stateExists(readEventsPath);

    if (!statePresent && !readEventsPresent) {
        return {code: 0, stdout: `${display} (missing; nothing to clear)\n`};
    }

    rmSync(statePath, {force: true});
    rmSync(readEventsPath, {force: true});
    if (statePresent && readEventsPresent) {
        return {code: 0, stdout: `${display} (cleared; ${readEventsDisplay} cleared)\n`};
    }
    return {code: 0, stdout: `${statePresent ? display : readEventsDisplay} (cleared)\n`};
}

function usage() {
    return [
        "Usage: state-clear.mjs",
        "Removes the code-implement state file and its read-event log.",
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
    const result = runStateClear();
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
