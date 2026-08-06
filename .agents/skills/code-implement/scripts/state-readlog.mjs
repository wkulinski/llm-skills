#!/usr/bin/env node
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {pathToFileURL} from "node:url";

import {formatReadObservation, parseReadEventArgs} from "../../_shared/scripts/read-purpose.mjs";
import {appendJsonLine, formatIsoSeconds, insertLogLine, resolveReadEventsPath, resolveStatePath} from "./state-utils.mjs";

export function runStateReadLog(argv, {cachePath, now = new Date()} = {}) {
    const {absolute: statePath} = resolveStatePath(cachePath);

    if (!existsSync(statePath)) {
        return {code: 1, stderr: `ERROR: missing state file: ${statePath}\n`};
    }

    if (argv.length === 0) {
        return {code: 1, stderr: "ERROR: missing log message\n"};
    }

    const parsed = parseReadEventArgs(argv);
    if (parsed.errors.length > 0) {
        return {code: 1, stderr: `ERROR: ${parsed.errors.join("; ")}\n`};
    }

    const timestamp = formatIsoSeconds(now);
    const logMessage = parsed.structured
        ? [formatReadObservation(parsed.observation), ...parsed.message].join(" ").trim()
        : argv.join(" ");
    const logLine = `- [${timestamp}] ${logMessage}`;
    const content = readFileSync(statePath, "utf-8");
    if (parsed.structured) {
        appendJsonLine(resolveReadEventsPath(cachePath).absolute, {
            version: 1,
            observed_at: timestamp,
            ...parsed.observation,
        });
    }
    writeFileSync(statePath, insertLogLine(content, "### Dziennik odczytów", logLine), "utf-8");
    return {code: 0};
}

async function main(argv) {
    const result = runStateReadLog(argv);
    if (result.stdout) { process.stdout.write(result.stdout); }
    if (result.stderr) { process.stderr.write(result.stderr); }
    process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
