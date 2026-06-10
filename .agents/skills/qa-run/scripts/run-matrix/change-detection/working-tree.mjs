import {spawnSync} from "node:child_process";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";

import {SNAPSHOT_VERSION} from "./snapshot.mjs";
import {hashBuffer} from "../shared/hashing.mjs";

export function run(command, args, options = {}) {
    return spawnSync(command, args, {
        encoding: "utf-8",
        ...options,
    });
}

export function getRepoRoot() {
    const result = run("git", ["rev-parse", "--show-toplevel"]);
    if (result.status !== 0) {
        throw new Error("Not a git repository (git rev-parse failed).");
    }
    return result.stdout.trim();
}

export function gitLines(repoRoot, args) {
    const result = run("git", args, {cwd: repoRoot});
    if (result.status !== 0) {
        throw new Error(`git ${args.join(" ")} failed.`);
    }
    return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
}

export function detectChangedFiles(repoRoot) {
    const trackedUnstaged = gitLines(repoRoot, [
        "diff",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
    ]);
    const trackedStaged = gitLines(repoRoot, [
        "diff",
        "--cached",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
    ]);
    const untracked = gitLines(repoRoot, ["ls-files", "--others", "--exclude-standard"]);

    return [...new Set([...trackedUnstaged, ...trackedStaged, ...untracked])].sort();
}

export function fingerprintDirtyFile(repoRoot, filePath) {
    const absPath = path.join(repoRoot, filePath);
    if (!existsSync(absPath)) {
        return {
            exists: false,
            hash: null,
        };
    }

    const content = readFileSync(absPath);
    return {
        exists: true,
        hash: hashBuffer(content),
    };
}

export function collectWorkingTreeState(repoRoot) {
    const files = detectChangedFiles(repoRoot);
    const snapshotFiles = {};

    for (const filePath of files) {
        snapshotFiles[filePath] = fingerprintDirtyFile(repoRoot, filePath);
    }

    return {
        version: SNAPSHOT_VERSION,
        createdAt: new Date().toISOString(),
        files: snapshotFiles,
        repoRoot,
    };
}
