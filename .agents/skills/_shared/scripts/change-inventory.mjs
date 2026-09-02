#!/usr/bin/env node

import crypto from "node:crypto";
import {lstatSync, mkdirSync, readFileSync, readlinkSync, writeFileSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function gitOutput(args, {cwd, execFile} = {}) {
    const exec = execFile ?? execFileSync;
    try {
        return String(exec("git", args, {
            cwd: cwd ?? process.cwd(),
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        }));
    } catch (error) {
        const command = ["git", ...args].join(" ");
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Git command failed: ${command}: ${reason}`, {cause: error});
    }
}

export function getWorktreeFingerprint({cwd = process.cwd(), execFile = execFileSync} = {}) {
    const context = {cwd: resolveRepositoryRoot(cwd, execFile), execFile};

    const stagedOutput = gitOutput([
        "diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--",
    ], context);
    const staged_sha256 = sha256(stagedOutput);

    const unstagedOutput = gitOutput([
        "diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--",
    ], context);
    const unstaged_sha256 = sha256(unstagedOutput);

    const listed = gitOutput(["ls-files", "--others", "--exclude-standard", "-z", "--"], context);
    const relativePaths = [...new Set(listed.split("\0").filter(Boolean))].sort();
    const representation = crypto.createHash("sha256");

    for (const relativePath of relativePaths) {
        const absolutePath = path.resolve(context.cwd, relativePath);
        const stats = lstatSync(absolutePath);
        representation.update(`path:${relativePath}\0mode:${stats.mode & 0o7777}\0`);
        if (stats.isSymbolicLink()) {
            representation.update(`link:${readlinkSync(absolutePath)}\0`);
        } else if (stats.isFile()) {
            representation.update(readFileSync(absolutePath));
            representation.update("\0");
        } else {
            throw new Error(`Unsupported untracked entry type: ${relativePath}`);
        }
    }

    const untracked_sha256 = representation.digest("hex");

    const combined_sha256 = sha256([
        "worktree-fingerprint-v2",
        staged_sha256,
        unstaged_sha256,
        untracked_sha256,
    ].join("\0"));

    return {staged_sha256, unstaged_sha256, untracked_sha256, combined_sha256};
}

function deriveSubsystem(filePath) {
    const parts = filePath.split("/");
    if (parts.length <= 1) {
        return ".";
    }
    const topLevel = parts[0];
    if (topLevel === ".agents" && parts[1] === "skills" && parts.length >= 3) {
        return `.agents/skills/${parts[2]}`;
    }
    return topLevel;
}

function splitNull(output) {
    return output.split("\0").filter(Boolean);
}

function resolveRepositoryRoot(cwd, execFile = execFileSync) {
    const output = gitOutput(["rev-parse", "--show-toplevel"], {cwd, execFile}).trim();
    if (!output) {
        throw new Error("Git command failed: not inside a git repository.");
    }
    return path.resolve(output);
}

function describeUntrackedEntry(relativePath, cwd) {
    const absolutePath = path.resolve(cwd, relativePath);
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
        return {kind: "symlink"};
    }
    if (stats.isFile()) {
        return {kind: "file"};
    }
    throw new Error(`Unsupported untracked entry type: ${relativePath}`);
}

function parseNameStatus(output) {
    const tokens = splitNull(output);
    if (tokens.length % 2 !== 0) {
        throw new Error("Invalid NUL-separated git name-status output.");
    }

    const result = [];
    for (let index = 0; index < tokens.length; index += 2) {
        result.push({git_status: tokens[index], path: tokens[index + 1]});
    }
    return result;
}

function parseNumstatValue(value) {
    if (value === "-") {
        return null;
    }
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) {
        throw new Error(`Invalid git numstat value: ${value}`);
    }
    return number;
}

function parseNumstat(numstatOutput) {
    const result = new Map();
    for (const record of splitNull(numstatOutput)) {
        const firstTab = record.indexOf("\t");
        const secondTab = record.indexOf("\t", firstTab + 1);
        if (firstTab < 1 || secondTab < 0 || secondTab === record.length - 1) {
            throw new Error("Invalid NUL-separated git numstat output.");
        }

        const added = record.slice(0, firstTab);
        const deleted = record.slice(firstTab + 1, secondTab);
        const file = record.slice(secondTab + 1);
        result.set(file, {
            insertions: parseNumstatValue(added),
            deletions: parseNumstatValue(deleted),
        });
    }
    return result;
}

function diffArgs(mode, format) {
    return mode === "staged"
        ? ["diff", "--cached", format, "-z", "--no-renames", "--no-textconv", "--"]
        : ["diff", format, "-z", "--no-renames", "--no-textconv", "--"];
}

function readTrackedSurface(mode, context) {
    const changes = parseNameStatus(gitOutput(diffArgs(mode, "--name-status"), context));
    const stats = parseNumstat(gitOutput(diffArgs(mode, "--numstat"), context));

    return changes.map(({git_status, path: filePath}) => ({
        path: filePath,
        git_status,
        ...(stats.get(filePath) ?? {insertions: null, deletions: null}),
    }));
}

function aggregateKnownStats(files, field) {
    const values = files
        .flatMap((file) => [file.staged, file.unstaged])
        .filter(Boolean)
        .map((surface) => surface[field]);
    return values.some((value) => value === null)
        ? null
        : values.reduce((sum, value) => sum + value, 0);
}

export function buildChangeInventory({cwd = process.cwd(), execFile = execFileSync, now = new Date()} = {}) {
    const repositoryRoot = resolveRepositoryRoot(cwd, execFile);
    const context = {cwd: repositoryRoot, execFile};

    const staged = readTrackedSurface("staged", context);
    const unstaged = readTrackedSurface("unstaged", context);
    const untrackedFiles = splitNull(gitOutput(["ls-files", "--others", "--exclude-standard", "-z", "--"], context));

    const worktree = getWorktreeFingerprint(context);

    const filesByPath = new Map();
    const ensureFile = (filePath) => {
        if (!filesByPath.has(filePath)) {
            filesByPath.set(filePath, {path: filePath, staged: null, unstaged: null, untracked: null});
        }
        return filesByPath.get(filePath);
    };

    for (const surface of staged) {
        ensureFile(surface.path).staged = {
            git_status: surface.git_status,
            insertions: surface.insertions,
            deletions: surface.deletions,
        };
    }
    for (const surface of unstaged) {
        ensureFile(surface.path).unstaged = {
            git_status: surface.git_status,
            insertions: surface.insertions,
            deletions: surface.deletions,
        };
    }
    for (const filePath of untrackedFiles) {
        ensureFile(filePath).untracked = describeUntrackedEntry(filePath, context.cwd);
    }

    const files = [...filesByPath.values()]
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((file) => {
            const surfaces = ["staged", "unstaged", "untracked"].filter((name) => file[name] !== null);
            if (surfaces.length === 0) {
                throw new Error(`Inventory invariant violated: no change surface for ${file.path}`);
            }
            return {
                ...file,
                status: surfaces.join("+"),
                subsystem: deriveSubsystem(file.path),
            };
        });

    const subsystemMap = new Map();
    for (const file of files) {
        if (!subsystemMap.has(file.subsystem)) {
            subsystemMap.set(file.subsystem, []);
        }
        subsystemMap.get(file.subsystem).push(file.path);
    }

    const subsystems = [...subsystemMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, paths]) => ({name, paths}));

    const inventory = {
        generated_at: now.toISOString(),
        worktree_fingerprint: worktree,
        files,
        stats: {
            total: files.length,
            tracked_insertions: aggregateKnownStats(files, "insertions"),
            tracked_deletions: aggregateKnownStats(files, "deletions"),
            staged_files: files.filter((file) => file.staged).length,
            unstaged_files: files.filter((file) => file.unstaged).length,
            untracked_files: files.filter((file) => file.untracked).length,
        },
        subsystems,
    };

    return inventory;
}

function usage() {
    return [
        "Usage: node change-inventory.mjs build [--output <path>]",
        "",
        "Builds a structured JSON inventory of working-tree changes from git.",
        "",
        "Commands:",
        "  build    Build the change inventory",
        "",
        "Options:",
        "  --output <path>   Write JSON to file instead of stdout",
        "  --help            Show this help message",
    ].join("\n");
}

function parseCliArgs(args) {
    const parsed = {command: null, outputPath: null};

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];

        if (arg === "--help") {
            parsed.help = true;
            return parsed;
        }

        if (arg === "build" && parsed.command === null) {
            parsed.command = "build";
            continue;
        }

        if (arg === "--output") {
            const value = args[i + 1];
            if (value === undefined) {
                throw new TypeError("Missing value for --output");
            }
            parsed.outputPath = value;
            i += 1;
            continue;
        }

        throw new TypeError(`Unknown argument: ${arg}`);
    }

    return parsed;
}

function main(argv) {
    try {
        const parsed = parseCliArgs(argv);

        if (parsed.help) {
            process.stdout.write(`${usage()}\n`);
            return 0;
        }

        if (parsed.command !== "build") {
            process.stderr.write("Expected command: build\n");
            process.stderr.write(`${usage()}\n`);
            return 2;
        }

        const inventory = buildChangeInventory();
        const json = `${JSON.stringify(inventory, null, 2)}\n`;

        if (parsed.outputPath) {
            mkdirSync(path.dirname(path.resolve(parsed.outputPath)), {recursive: true});
            writeFileSync(parsed.outputPath, json, "utf8");
            process.stdout.write(`${parsed.outputPath}\n`);
        } else {
            process.stdout.write(json);
        }

        return 0;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main(process.argv.slice(2));
}
