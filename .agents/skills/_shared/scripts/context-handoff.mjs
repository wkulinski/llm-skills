#!/usr/bin/env node

import {readFileSync} from "node:fs";

const REQUIRED_KEYS = [
    "mode",
    "task_brief",
    "decisions",
    "constraints",
];
const SECRET_PATTERNS = [
    /gh[pousr]_[A-Za-z0-9_-]+/,
    /sk-[A-Za-z0-9_-]{12,}/,
    /-----BEGIN [A-Z ]+ PRIVATE KEY-----/,
    /(?:api[_-]?key|password|secret|token)\s*[:=]/i,
];

function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateHandoff(handoff) {
    const errors = [];
    if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
        return {valid: false, errors: ["handoff must be an object"]};
    }
    for (const key of REQUIRED_KEYS) {
        if (!(key in handoff)) errors.push(`missing key: ${key}`);
    }
    for (const key of ["task_brief"]) {
        if (key in handoff && (typeof handoff[key] !== "string" || handoff[key].trim() === "")) {
            errors.push(`${key} must be a non-empty string`);
        }
    }
    for (const key of ["decisions", "constraints"]) {
        if (key in handoff && !isStringArray(handoff[key])) errors.push(`${key} must be an array of strings`);
    }
    if (!new Set(["targeted", "cross-layer"]).has(handoff.mode)) errors.push("mode must be targeted or cross-layer");
    if ("issue" in handoff || "issue_comments" in handoff || "document_contents" in handoff || "secrets" in handoff) {
        errors.push("handoff must not contain issue/comments/document contents/secrets");
    }
    if (SECRET_PATTERNS.some((pattern) => pattern.test(JSON.stringify(handoff)))) errors.push("handoff appears to contain a secret");
    return {valid: errors.length === 0, errors};
}

function main(argv) {
    const [command, handoffPath] = argv;
    if (command !== "validate" || !handoffPath) {
        process.stderr.write("Usage: context-handoff.mjs validate <handoff.json>\n");
        return 2;
    }
    const result = validateHandoff(JSON.parse(readFileSync(handoffPath, "utf8")));
    if (!result.valid) {
        process.stderr.write(`${result.errors.join("\n")}\n`);
        return 1;
    }
    process.stdout.write("context handoff: valid\n");
    return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
