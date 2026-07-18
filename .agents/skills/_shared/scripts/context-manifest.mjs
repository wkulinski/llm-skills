#!/usr/bin/env node
import {readFileSync, writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

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
];

const ROLES = new Set(["primary", "context-refresher"]);
const PATH_KEYS = ["rules", "documentation", "already_read", "omitted"];
const SECRET_PATTERNS = [
    /gh[pousr]_[A-Za-z0-9_\-]+/,
    /sk-[A-Za-z0-9_\-]{12,}/,
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----/,
    /(?:api[_-]?key|password|secret|token)\s*[:=]/i,
];

function gitValue(args, execFile = execFileSync) {
    try {
        return String(execFile("git", args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]})).trim();
    } catch {
        return "";
    }
}

function normalizeRepository(value) {
    return String(value ?? "")
        .trim()
        .replace(/^git@[^:]+:/, "")
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/\.git$/, "");
}

export function enrichContextManifest(manifest, {execFile = execFileSync, now = new Date()} = {}) {
    return {
        ...manifest,
        version: manifest.version ?? 1,
        repository: manifest.repository || normalizeRepository(gitValue(["remote", "get-url", "origin"], execFile)),
        branch: manifest.branch || gitValue(["branch", "--show-current"], execFile) || "detached",
        head: manifest.head || gitValue(["rev-parse", "HEAD"], execFile),
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

    for (const key of PATH_KEYS) {
        if (isStringArray(manifest[key]) && manifest[key].some((value) => value.startsWith("/") || value.startsWith("~"))) {
            errors.push(`${key} must contain repo-relative paths`);
        }
    }

    if ("issue" in manifest || "issue_comments" in manifest || "document_contents" in manifest) {
        errors.push("manifest must not contain issue/comments/document contents");
    }

    if (SECRET_PATTERNS.some((pattern) => pattern.test(JSON.stringify(manifest)))) {
        errors.push("manifest appears to contain a secret");
    }

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

function currentGitMetadata() {
    return {
        repository: normalizeRepository(gitValue(["remote", "get-url", "origin"])),
        branch: gitValue(["branch", "--show-current"]) || "detached",
        head: gitValue(["rev-parse", "HEAD"]),
    };
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

        const current = currentGitMetadata();
        if (!current.head || !current.branch) {
            process.stderr.write("cannot verify manifest: current git metadata is unavailable\n");
            return 1;
        }
        const mismatches = ["repository", "branch", "head"]
            .filter((key) => manifest[key] && current[key] && manifest[key] !== current[key])
            .map((key) => `${key}: manifest=${manifest[key]} current=${current[key]}`);
        if (mismatches.length > 0) {
            process.stderr.write(`${mismatches.join("\n")}\n`);
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
