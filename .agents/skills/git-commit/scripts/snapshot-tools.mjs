#!/usr/bin/env node
import {copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import crypto from "node:crypto";
import {dirname, join, resolve} from "node:path";
import {pathToFileURL} from "node:url";

export const DEFAULT_POINTER_FILE = "/tmp/agent-git-commit-snapshot-pointer.txt";

export function splitLines(output) {
    return String(output ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort();
}

export function runCommand(command, args, options = {}) {
    return spawnSync(command, args, {
        encoding: "utf-8",
        ...options,
    });
}

export function readPointer(pointerFile, repoRoot) {
    if (!existsSync(pointerFile)) {
        return null;
    }

    const lines = splitLines(readFileSync(pointerFile, "utf-8"));
    const repoRootLine = lines.find((line) => line.startsWith("repo_root="));
    const snapshotDirLine = lines.find((line) => line.startsWith("snapshot_dir="));

    if (!repoRootLine || !snapshotDirLine) {
        return null;
    }

    const pointerRepoRoot = repoRootLine.slice("repo_root=".length);
    const snapshotDir = snapshotDirLine.slice("snapshot_dir=".length);

    if (pointerRepoRoot !== repoRoot) {
        return null;
    }

    if (!existsSync(snapshotDir)) {
        return null;
    }

    return snapshotDir;
}

export function resolveSnapshotDir({forceNew = false, pointerFile = DEFAULT_POINTER_FILE, repoRoot, now = new Date(), randomHex = () => crypto.randomBytes(8).toString("hex")} = {}) {
    if (!repoRoot) {
        throw new Error("Missing repoRoot.");
    }

    if (!forceNew) {
        const existing = readPointer(pointerFile, repoRoot);
        if (existing) {
            return existing;
        }
    }

    const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
    return `/tmp/agent-git-commit-snapshot-${timestamp}-${randomHex()}`;
}

function ensureParentDir(filePath) {
    mkdirSync(dirname(filePath), {recursive: true});
}

function copyEntry(sourcePath, destinationPath) {
    ensureParentDir(destinationPath);
    copyFileSync(sourcePath, destinationPath);
}

function writeLines(filePath, lines) {
    ensureParentDir(filePath);
    writeFileSync(filePath, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, "utf-8");
}

function copySnapshotFiles({filesToCopy, repoRoot, snapshotDir}) {
    const missing = [];
    for (const relativePath of filesToCopy) {
        const sourcePath = join(repoRoot, relativePath);
        const destinationPath = join(snapshotDir, "files", relativePath);
        if (existsSync(sourcePath)) {
            copyEntry(sourcePath, destinationPath);
        } else {
            missing.push(relativePath);
        }
    }

    if (missing.length > 0) {
        writeLines(join(snapshotDir, "missing-at-snapshot.txt"), missing);
    }
}

export function createSnapshot({
    execCommand = runCommand,
    forceNew = false,
    pointerFile = DEFAULT_POINTER_FILE,
    repoRoot = process.cwd(),
    now = new Date(),
    randomHex,
} = {}) {
    const snapshotDir = resolveSnapshotDir({forceNew, pointerFile, repoRoot, now, randomHex});

    if (!forceNew && readPointer(pointerFile, repoRoot) === snapshotDir) {
        return snapshotDir;
    }

    mkdirSync(join(snapshotDir, "files"), {recursive: true});

    const statusResult = execCommand("git", ["-C", repoRoot, "status", "-sb"]);
    if (statusResult.status !== 0) {
        throw new Error(statusResult.stderr || "git status -sb failed");
    }
    writeFileSync(join(snapshotDir, "git-status-sb.txt"), statusResult.stdout ?? "", "utf-8");

    const baseHeadResult = execCommand("git", ["-C", repoRoot, "rev-parse", "HEAD"]);
    if (baseHeadResult.status !== 0) {
        throw new Error(baseHeadResult.stderr || "git rev-parse HEAD failed");
    }
    writeFileSync(join(snapshotDir, "base-head.txt"), `${String(baseHeadResult.stdout ?? "").trim()}\n`, "utf-8");

    const changedTrackedResult = execCommand("git", ["-C", repoRoot, "diff", "--name-only"]);
    if (changedTrackedResult.status !== 0) {
        throw new Error(changedTrackedResult.stderr || "git diff --name-only failed");
    }
    const changedTracked = splitLines(changedTrackedResult.stdout);
    writeLines(join(snapshotDir, "changed-tracked.txt"), changedTracked);

    const untrackedResult = execCommand("git", ["-C", repoRoot, "ls-files", "--others", "--exclude-standard"]);
    if (untrackedResult.status !== 0) {
        throw new Error(untrackedResult.stderr || "git ls-files --others --exclude-standard failed");
    }
    const untracked = splitLines(untrackedResult.stdout);
    writeLines(join(snapshotDir, "untracked.txt"), untracked);

    const filesToCopy = uniqueSorted([...changedTracked, ...untracked]);
    writeLines(join(snapshotDir, "files-to-copy.txt"), filesToCopy);

    copySnapshotFiles({filesToCopy, repoRoot, snapshotDir});

    writeFileSync(join(snapshotDir, "SNAPSHOT_PATH.txt"), `${snapshotDir}\n`, "utf-8");
    writeFileSync(pointerFile, `repo_root=${repoRoot}\nsnapshot_dir=${snapshotDir}\ncreated_at=${now.toISOString()}\n`, "utf-8");

    return snapshotDir;
}

export function loadSnapshotContext({pointerFile = DEFAULT_POINTER_FILE, repoRoot = process.cwd(), snapshotDir = ""} = {}) {
    const resolvedSnapshotDir = snapshotDir === "" || snapshotDir === "--current"
        ? readPointer(pointerFile, repoRoot)
        : snapshotDir;

    if (!resolvedSnapshotDir) {
        throw new Error(`Missing snapshot pointer: ${pointerFile}`);
    }

    if (!existsSync(resolvedSnapshotDir)) {
        throw new Error(`Snapshot dir does not exist: ${resolvedSnapshotDir}`);
    }

    const baseHeadPath = join(resolvedSnapshotDir, "base-head.txt");
    if (!existsSync(baseHeadPath)) {
        throw new Error(`Missing snapshot file: ${baseHeadPath}`);
    }

    return {
        baseHead: readFileSync(baseHeadPath, "utf-8").trim(),
        repoRoot,
        snapshotDir: resolvedSnapshotDir,
    };
}

function listCurrentFiles({execCommand, repoRoot}) {
    const trackedResult = execCommand("git", ["-C", repoRoot, "diff", "--name-only"]);
    if (trackedResult.status !== 0) {
        throw new Error(trackedResult.stderr || "git diff --name-only failed");
    }

    const untrackedResult = execCommand("git", ["-C", repoRoot, "ls-files", "--others", "--exclude-standard"]);
    if (untrackedResult.status !== 0) {
        throw new Error(untrackedResult.stderr || "git ls-files --others --exclude-standard failed");
    }

    return {
        nowTracked: splitLines(trackedResult.stdout),
        nowUntracked: splitLines(untrackedResult.stdout),
    };
}

export function listSnapshotDelta({
    execCommand = runCommand,
    pointerFile = DEFAULT_POINTER_FILE,
    repoRoot = process.cwd(),
    snapshotDir = "",
} = {}) {
    const context = loadSnapshotContext({pointerFile, repoRoot, snapshotDir});
    const current = listCurrentFiles({execCommand, repoRoot});
    const snapTracked = splitLines(readFileSync(join(context.snapshotDir, "changed-tracked.txt"), "utf-8"));
    const snapUntracked = splitLines(readFileSync(join(context.snapshotDir, "untracked.txt"), "utf-8"));
    const missingAtSnapshotPath = join(context.snapshotDir, "missing-at-snapshot.txt");
    const missingAtSnapshot = new Set(
        existsSync(missingAtSnapshotPath)
            ? splitLines(readFileSync(missingAtSnapshotPath, "utf-8"))
            : [],
    );

    const nowAll = uniqueSorted([...current.nowTracked, ...current.nowUntracked]);
    const snapAll = uniqueSorted([...snapTracked, ...snapUntracked]);

    const deltaNewDirty = nowAll.filter((path) => !snapAll.includes(path));
    const deltaContentChanged = [];
    const deltaMissingNow = [];

    for (const relativePath of snapAll) {
        const currentPath = join(repoRoot, relativePath);
        const existsNow = existsSync(currentPath);
        if (!existsNow && !missingAtSnapshot.has(relativePath)) {
            deltaMissingNow.push(relativePath);
        }
        if (!existsNow) {
            continue;
        }

        const snapCopy = join(context.snapshotDir, "files", relativePath);
        if (!existsSync(snapCopy) || !readFileSync(snapCopy).equals(readFileSync(currentPath))) {
            deltaContentChanged.push(relativePath);
        }
    }

    const deltaAll = uniqueSorted([...deltaNewDirty, ...deltaContentChanged, ...deltaMissingNow]);
    writeLines(join(context.snapshotDir, "now-changed-tracked.txt"), current.nowTracked);
    writeLines(join(context.snapshotDir, "now-untracked.txt"), current.nowUntracked);
    writeLines(join(context.snapshotDir, "now-all.txt"), nowAll);
    writeLines(join(context.snapshotDir, "snap-all.txt"), snapAll);
    writeLines(join(context.snapshotDir, "delta-new-dirty.txt"), deltaNewDirty);
    writeLines(join(context.snapshotDir, "delta-content-changed.txt"), deltaContentChanged);
    writeLines(join(context.snapshotDir, "delta-missing-now.txt"), deltaMissingNow);
    writeLines(join(context.snapshotDir, "delta-all.txt"), deltaAll);

    if (deltaAll.length > 0) {
        return `DELTA_PRESENT\n${deltaAll.map((path) => `- ${path}`).join("\n")}\n`;
    }

    return "DELTA_EMPTY\n";
}

function hashFile(path) {
    const hash = crypto.createHash("sha256");
    hash.update(readFileSync(path));
    return hash.digest("hex");
}

function printMeta(path) {
    const size = statSync(path).size;
    return `  size: ${size} bytes\n  sha256: ${hashFile(path)}\n`;
}

function isBinaryDiff({execCommand, from, to}) {
    const result = execCommand("git", ["diff", "--no-index", "--numstat", "--", from, to]);
    return String(result.stdout ?? "").includes("-\t-\t");
}

function diffText({execCommand, from, to, full = false}) {
    const args = ["diff", "--no-index"];
    if (!full) {
        args.push("--stat");
    }
    args.push("--", from, to);
    return execCommand("git", args).stdout ?? "";
}

function showOne({
    execCommand,
    filePath,
    full = false,
    repoRoot,
    snapshotDir,
}) {
    const snapCopy = join(snapshotDir, "files", filePath);
    const currentPath = join(repoRoot, filePath);
    let output = `File: ${filePath}\n`;

    if (existsSync(snapCopy)) {
        if (!existsSync(currentPath)) {
            output += "  status: missing now (was present in snapshot)\n";
            output += "  snapshot metadata:\n";
            output += printMeta(snapCopy);
            return output;
        }

        if (isBinaryDiff({execCommand, from: snapCopy, to: currentPath})) {
            output += "  status: binary/non-text diff (snapshot -> now)\n";
            output += "  snapshot metadata:\n";
            output += printMeta(snapCopy);
            output += "  now metadata:\n";
            output += printMeta(currentPath);
            return output;
        }

        if (full) {
            return output + diffText({execCommand, from: snapCopy, to: currentPath, full: true});
        }

        if (statSync(currentPath).size > 200000 || /(composer\.lock|yarn\.lock)$/.test(filePath)) {
            output += diffText({execCommand, from: snapCopy, to: currentPath, full: false});
            output += "  (use --full for full diff)\n";
            return output;
        }

        return output + diffText({execCommand, from: snapCopy, to: currentPath, full: true});
    }

    const currentExists = existsSync(currentPath);
    if (!currentExists) {
        return `${output}  status: file does not exist now (and not in base HEAD or snapshot copy)\n`;
    }

    const baseHeadPath = join(snapshotDir, "base-head.txt");
    const baseHead = readFileSync(baseHeadPath, "utf-8").trim();
    const baseCheck = execCommand("git", ["cat-file", "-e", `${baseHead}:${filePath}`]);
    if (baseCheck.status === 0) {
        const tempBase = join(snapshotDir, ".tmp-base");
        writeFileSync(tempBase, execCommand("git", ["show", `${baseHead}:${filePath}`]).stdout ?? "", "utf-8");

        if (isBinaryDiff({execCommand, from: tempBase, to: currentPath})) {
            output += "  status: binary/non-text diff (base HEAD -> now)\n";
            output += "  base HEAD metadata:\n";
            output += printMeta(tempBase);
            output += "  now metadata:\n";
            output += printMeta(currentPath);
            rmSync(tempBase, {force: true});
            return output;
        }

        if (full) {
            const rendered = output + diffText({execCommand, from: tempBase, to: currentPath, full: true});
            rmSync(tempBase, {force: true});
            return rendered;
        }

        if (statSync(currentPath).size > 200000 || /(composer\.lock|yarn\.lock)$/.test(filePath)) {
            output += diffText({execCommand, from: tempBase, to: currentPath, full: false});
            output += "  (use --full for full diff)\n";
            rmSync(tempBase, {force: true});
            return output;
        }

        const rendered = output + diffText({execCommand, from: tempBase, to: currentPath, full: true});
        rmSync(tempBase, {force: true});
        return rendered;
    }

    if (isBinaryDiff({execCommand, from: "/dev/null", to: currentPath})) {
        return `${output}  status: new binary file\n  now metadata:\n${printMeta(currentPath)}`;
    }

    if (full) {
        return output + diffText({execCommand, from: "/dev/null", to: currentPath, full: true});
    }

    if (statSync(currentPath).size > 200000 || /(composer\.lock|yarn\.lock)$/.test(filePath)) {
        output += diffText({execCommand, from: "/dev/null", to: currentPath, full: false});
        output += "  (use --full for full diff)\n";
        return output;
    }

    return output + diffText({execCommand, from: "/dev/null", to: currentPath, full: true});
}

export function showSnapshotDelta({
    execCommand = runCommand,
    full = false,
    pointerFile = DEFAULT_POINTER_FILE,
    repoRoot = process.cwd(),
    snapshotDir = "",
    target = "",
} = {}) {
    const context = loadSnapshotContext({pointerFile, repoRoot, snapshotDir});

    if (!target) {
        throw new Error("Missing target.");
    }

    if (target === "--all") {
        const deltaAllPath = join(context.snapshotDir, "delta-all.txt");
        if (!existsSync(deltaAllPath)) {
            throw new Error(`Missing ${deltaAllPath}. Run snapshot-tools.mjs list first.`);
        }

        const paths = splitLines(readFileSync(deltaAllPath, "utf-8"));
        return `${paths.map((path) => `${showOne({execCommand, filePath: path, full, repoRoot, snapshotDir: context.snapshotDir})}\n`).join("")}`;
    }

    return showOne({execCommand, filePath: target, full, repoRoot, snapshotDir: context.snapshotDir});
}

function usage() {
    return [
        "Usage:",
        "  snapshot-tools.mjs create [--new|--force-new]",
        "  snapshot-tools.mjs list [--current|<snapshot-dir>]",
        "  snapshot-tools.mjs show [--current|<snapshot-dir>] <path|--all> [--full]",
        "",
        "create reuses the current snapshot unless --new or --force-new is given.",
        "list reports the delta; show displays one path or all paths from delta-all.txt.",
        "Help (`--help` or `-h`) exits with code 0 before git resolution, even after a command, and creates no snapshot.",
    ].join("\n");
}

function hasHelpFlag(argv) {
    return argv.some((argument) => argument === "--help" || argument === "-h");
}

export async function runSnapshotTools(argv, {execCommand = runCommand, pointerFile = DEFAULT_POINTER_FILE} = {}) {
    if (hasHelpFlag(argv)) {
        process.stdout.write(`${usage()}\n`);
        return 0;
    }

    const [command = "", ...rest] = argv;
    const repoRootResult = execCommand("git", ["rev-parse", "--show-toplevel"]);
    if (repoRootResult.status !== 0) {
        throw new Error(repoRootResult.stderr || "git rev-parse --show-toplevel failed");
    }

    const repoRoot = String(repoRootResult.stdout ?? "").trim();

    switch (command) {
        case "create": {
            const forceNew = rest[0] === "--new" || rest[0] === "--force-new";
            const snapshotDir = createSnapshot({execCommand, forceNew, pointerFile, repoRoot});
            process.stdout.write(`${snapshotDir}\n`);
            return 0;
        }
        case "list": {
            const snapshotDir = rest[0] ?? "";
            process.stdout.write(listSnapshotDelta({execCommand, pointerFile, repoRoot, snapshotDir}));
            return 0;
        }
        case "show": {
            const snapshotDir = rest[0] ?? "";
            const target = rest[1] ?? "";
            const full = rest[2] === "--full";
            process.stdout.write(showSnapshotDelta({execCommand, full, pointerFile, repoRoot, snapshotDir, target}));
            return 0;
        }
        default:
            throw new Error("Usage: snapshot-tools.mjs <create|list|show> ...");
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runSnapshotTools(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
