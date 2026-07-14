#!/usr/bin/env node
import {existsSync, readFileSync, rmSync} from "node:fs";
import {pathToFileURL} from "node:url";

import {DEFAULT_POINTER_FILE} from "./snapshot-tools.mjs";

function usage() {
    return "Usage: snapshot-clean.mjs [--current | <snapshot_dir>]\n";
}

function parseArgs(argv) {
    const args = [...argv];
    const parsed = {snapshotDir: args[0] ?? ""};
    if (args.length > 0 && args[0] === "--current") {
        parsed.snapshotDir = "--current";
    }
    return parsed;
}

export function runSnapshotClean(argv, {pointerFile = DEFAULT_POINTER_FILE, repoRoot = process.cwd()} = {}) {
    const parsed = parseArgs(argv);
    let snapshotDir = parsed.snapshotDir;

    if (!snapshotDir || snapshotDir === "--current") {
        if (!existsSync(pointerFile)) {
            return {code: 2, stderr: `Missing snapshot pointer: ${pointerFile}\n${usage()}`};
        }
        snapshotDir = String(readFileSync(pointerFile, "utf-8"))
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => line.startsWith("snapshot_dir="))
            ?.slice("snapshot_dir=".length) ?? "";

        if (!snapshotDir) {
            return {code: 2, stderr: `Missing snapshot pointer: ${pointerFile}\n${usage()}`};
        }
    }

    if (!snapshotDir.startsWith("/tmp/agent-git-commit-snapshot-")) {
        return {code: 2, stderr: `Refusing to delete non-snapshot path: ${snapshotDir}\n`};
    }

    if (!existsSync(snapshotDir)) {
        const lines = [`${snapshotDir} (missing; nothing to delete)`];
        if (existsSync(pointerFile)) {
            rmSync(pointerFile, {force: true});
            lines.push(`${pointerFile} (deleted)`);
        }
        return {code: 0, stdout: `${lines.join("\n")}\n`};
    }

    rmSync(snapshotDir, {force: true, recursive: true});
    const lines = [`${snapshotDir} (deleted)`];
    if (existsSync(pointerFile)) {
        rmSync(pointerFile, {force: true});
        lines.push(`${pointerFile} (deleted)`);
    }
    return {code: 0, stdout: `${lines.join("\n")}\n`};
}

async function main(argv) {
    const result = runSnapshotClean(argv);
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
