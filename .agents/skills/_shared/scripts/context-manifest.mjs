#!/usr/bin/env node
import crypto from "node:crypto";
import {lstatSync, readFileSync, readlinkSync, writeFileSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";

import {formatSecretValidationErrors} from "./secret-detector.mjs";

const REQUIRED_KEYS = [
    "version",
    "role",
    "repository",
    "branch",
    "head",
    "rules",
    "documentation",
    "active_overrides",
    "constraints",
    "already_read",
    "omitted",
    "worktree",
];

const ROLES = new Set(["primary", "context-refresher"]);
const PATH_KEYS = ["rules", "documentation", "already_read", "omitted"];
const WORKTREE_HASH_KEYS = ["staged_sha256", "unstaged_sha256", "untracked_sha256", "combined_sha256"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
function gitValue(args, execFile = execFileSync, cwd = process.cwd()) {
    try {
        return String(execFile("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]})).trim();
    } catch {
        return "";
    }
}

function gitOutput(args, {cwd, execFile}) {
    return String(execFile("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}));
}

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalDiffHash(args, context) {
    return sha256(gitOutput(args, context));
}

function canonicalUntrackedHash({cwd, execFile}) {
    const listed = gitOutput(["ls-files", "--others", "--exclude-standard", "-z", "--"], {cwd, execFile});
    const relativePaths = [...new Set(listed.split("\0").filter(Boolean))].sort();
    const representation = crypto.createHash("sha256");

    for (const relativePath of relativePaths) {
        const absolutePath = path.resolve(cwd, relativePath);
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

    return representation.digest("hex");
}

export function getWorktreeFingerprint({cwd = process.cwd(), execFile = execFileSync} = {}) {
    const context = {cwd: path.resolve(cwd), execFile};
    const staged_sha256 = canonicalDiffHash([
        "diff", "--cached", "--binary", "--full-index", "--no-ext-diff", "--no-color", "--no-renames", "--",
    ], context);
    const unstaged_sha256 = canonicalDiffHash([
        "diff", "--binary", "--full-index", "--no-ext-diff", "--no-color", "--no-renames", "--",
    ], context);
    const untracked_sha256 = canonicalUntrackedHash(context);
    const combined_sha256 = sha256([
        "worktree-fingerprint-v1",
        staged_sha256,
        unstaged_sha256,
        untracked_sha256,
    ].join("\0"));

    return {staged_sha256, unstaged_sha256, untracked_sha256, combined_sha256};
}

function normalizeRepository(value) {
    return String(value ?? "")
        .trim()
        .replace(/^git@[^:]+:/, "")
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/\.git$/, "");
}

export function enrichContextManifest(manifest, {execFile = execFileSync, now = new Date(), cwd = process.cwd()} = {}) {
    const repositoryRoot = path.resolve(cwd);
    return {
        ...manifest,
        version: manifest.version ?? 1,
        repository: manifest.repository || normalizeRepository(gitValue(["remote", "get-url", "origin"], execFile, repositoryRoot)),
        branch: manifest.branch || gitValue(["branch", "--show-current"], execFile, repositoryRoot) || "detached",
        head: manifest.head || gitValue(["rev-parse", "HEAD"], execFile, repositoryRoot),
        worktree: getWorktreeFingerprint({cwd: repositoryRoot, execFile}),
        generated_at: manifest.generated_at || now.toISOString(),
    };
}

function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateContextManifest(manifest) {
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
        return {valid: false, errors: ["manifest must be an object"]};
    }

    const errors = REQUIRED_KEYS
        .filter((key) => !(key in manifest))
        .map((key) => `missing key: ${key}`);

    if (manifest.version !== 1) { errors.push("version must be 1"); }
    if (!ROLES.has(manifest.role)) { errors.push("role must be primary or context-refresher"); }
    for (const key of ["repository", "branch", "head"]) {
        if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
            errors.push(`${key} must be a non-empty string`);
        }
    }
    for (const key of ["rules", "documentation", "active_overrides", "constraints", "already_read", "omitted"]) {
        if (!isStringArray(manifest[key])) {
            errors.push(`${key} must be an array of strings`);
        }
    }

    if (typeof manifest.worktree !== "object" || manifest.worktree === null || Array.isArray(manifest.worktree)) {
        errors.push("MANIFEST_REGENERATION_REQUIRED: regenerate the manifest with context-manifest.mjs write before prepare");
        errors.push("worktree must be an object");
    } else {
        for (const key of WORKTREE_HASH_KEYS) {
            if (typeof manifest.worktree[key] !== "string" || !SHA256_PATTERN.test(manifest.worktree[key])) {
                errors.push(`worktree.${key} must be a lowercase sha256 hash`);
            }
        }
    }

    for (const key of PATH_KEYS) {
        if (isStringArray(manifest[key]) && manifest[key].some((value) => value.startsWith("/") || value.startsWith("~"))) {
            errors.push(`${key} must contain repo-relative paths`);
        }
    }

    if ("issue" in manifest || "issue_comments" in manifest || "document_contents" in manifest) {
        errors.push("manifest must not contain issue/comments/document contents");
    }

    errors.push(...formatSecretValidationErrors("manifest", manifest));

    return {valid: errors.length === 0, errors};
}

export function renderContextManifestSummary(manifest) {
    const validation = validateContextManifest(manifest);
    if (!validation.valid) {
        throw new Error(validation.errors.join("; "));
    }

    return [
        `context-manifest v${manifest.version} (${manifest.role})`,
        `repository=${manifest.repository} branch=${manifest.branch}`,
        `head=${manifest.head ?? "unknown"}`,
        `rules=${manifest.rules.length} documentation=${manifest.documentation.length} already_read=${manifest.already_read.length}`,
        `overrides=${manifest.active_overrides.length} constraints=${manifest.constraints.length} omitted=${manifest.omitted.length}`,
    ].join("\n") + "\n";
}

function readJson(path) {
    return JSON.parse(readFileSync(path, "utf8"));
}

function parseOutputPath(args) {
    const outputIndex = args.indexOf("--output");
    return outputIndex >= 0 ? args[outputIndex + 1] : "";
}

export function currentGitMetadata(cwd = process.cwd()) {
    return {
        repository: normalizeRepository(gitValue(["remote", "get-url", "origin"], execFileSync, cwd)),
        branch: gitValue(["branch", "--show-current"], execFileSync, cwd) || "detached",
        head: gitValue(["rev-parse", "HEAD"], execFileSync, cwd),
    };
}

export function verifyContextManifest(manifest, cwd = process.cwd()) {
    const validation = validateContextManifest(manifest);
    if (!validation.valid) { return validation; }

    const current = currentGitMetadata(cwd);
    if (!current.head || !current.branch) {
        return {valid: false, errors: ["cannot verify manifest: current git metadata is unavailable"]};
    }

    const mismatches = ["repository", "branch", "head"]
        .filter((key) => manifest[key] && current[key] && manifest[key] !== current[key])
        .map((key) => `${key}: manifest=${manifest[key]} current=${current[key]}`);
    let currentWorktree;
    try {
        currentWorktree = getWorktreeFingerprint({cwd});
    } catch (error) {
        return {valid: false, errors: [`cannot verify worktree fingerprint: ${error.message}`]};
    }
    for (const key of WORKTREE_HASH_KEYS) {
        if (manifest.worktree[key] !== currentWorktree[key]) {
            mismatches.push(`worktree.${key}: manifest=${manifest.worktree[key]} current=${currentWorktree[key]}`);
        }
    }

    return {valid: mismatches.length === 0, errors: mismatches};
}

function main(argv) {
    const [command, inputPath] = argv;
    if (command === "validate" && inputPath) {
        const manifest = readJson(inputPath);
        const validation = validateContextManifest(manifest);
        if (!validation.valid) {
            process.stderr.write(`${validation.errors.join("\n")}\n`);
            return 1;
        }
        process.stdout.write(renderContextManifestSummary(manifest));
        return 0;
    }

    if (command === "write") {
        const outputPath = parseOutputPath(argv.slice(1));
        if (!outputPath) {
            process.stderr.write("write wymaga --output <manifest.json>\n");
            return 2;
        }
        const manifest = enrichContextManifest(JSON.parse(readFileSync(0, "utf8")));
        const validation = validateContextManifest(manifest);
        if (!validation.valid) {
            process.stderr.write(`${validation.errors.join("\n")}\n`);
            return 1;
        }
        writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
        process.stdout.write(`${outputPath}\n`);
        return 0;
    }

    if (command === "summary" && inputPath) {
        process.stdout.write(renderContextManifestSummary(readJson(inputPath)));
        return 0;
    }

    if (command === "verify" && inputPath) {
        const manifest = readJson(inputPath);
        const validation = validateContextManifest(manifest);
        if (!validation.valid) {
            process.stderr.write(`${validation.errors.join("\n")}\n`);
            return 1;
        }

        const verification = verifyContextManifest(manifest);
        if (!verification.valid) {
            process.stderr.write(`${verification.errors.join("\n")}\n`);
            return 1;
        }
        process.stdout.write("context manifest: current\n");
        return 0;
    }

    process.stderr.write("Usage: context-manifest.mjs validate <manifest.json> | write --output <manifest.json> | summary <manifest.json> | verify <manifest.json>\n");
    return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exitCode = main(process.argv.slice(2));
}
