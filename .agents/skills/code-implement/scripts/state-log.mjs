#!/usr/bin/env node
import {existsSync, readFileSync, writeFileSync} from "node:fs";

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {formatIsoSeconds, insertLogLine, resolveStatePath} from "./state-utils.mjs";

function usage() {
    return [
        "Usage: state-log.mjs <message...>",
        "Appends a timestamped entry to the iteration log of the code-implement state file.",
        "Help (`--help` or `-h`) exits with code 0 without requiring state or writing a log entry.",
        "A message must not start with `--`; unknown options are rejected instead of being logged.",
    ].join("\n");
}

export function runStateLog(argv, {cachePath, now = new Date()} = {}) {
    if (argv[0] === "--help" || argv[0] === "-h") {
        return {code: 0, stdout: `${usage()}\n`};
    }
    if (argv[0]?.startsWith("--")) {
        return {code: 2, stderr: `ERROR: unknown option: ${argv[0]}\n${usage()}\n`};
    }

    const {absolute: statePath} = resolveStatePath(cachePath);

    if (!existsSync(statePath)) {
        return {code: 1, stderr: `ERROR: missing state file: ${statePath}\n`};
    }

    if (argv.length === 0) {
        return {code: 1, stderr: "ERROR: missing log message\n"};
    }

    const logLine = `- [${formatIsoSeconds(now)}] ${argv.join(" ")}`;
    const content = readFileSync(statePath, "utf-8");
    writeFileSync(statePath, insertLogLine(content, "### Dziennik iteracji", logLine), "utf-8");
    return {code: 0};
}

async function main(argv) {
    const result = runStateLog(argv);
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
