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

async function main() {
    const result = runStateClear();
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
