#!/usr/bin/env node

import {readFileSync} from "node:fs";

const MAX_REQUIRED_EVIDENCE = 4;
const MAX_REQUIRED_ANCHORS = 4;

function isSafeRelativePath(value) {
    return typeof value === "string" && value.trim() !== "" && !value.startsWith("/") && !value.includes("..") && !value.includes("...");
}

function validateRequiredEvidence(value, criterionIndex, errors) {
    if (value === undefined) { return; }
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REQUIRED_EVIDENCE) {
        errors.push(`criteria[${criterionIndex}].required_evidence must contain 1-${MAX_REQUIRED_EVIDENCE} items`);
        return;
    }
    for (const [requirementIndex, requirement] of value.entries()) {
        const location = `criteria[${criterionIndex}].required_evidence[${requirementIndex}]`;
        if (!requirement || typeof requirement !== "object" || Array.isArray(requirement)) {
            errors.push(`${location} must be an object`);
            continue;
        }
        const selectors = ["path", "path_prefix"].filter((key) => requirement[key] !== undefined);
        if (selectors.length !== 1 || !isSafeRelativePath(requirement[selectors[0]])) {
            errors.push(`${location} must define exactly one safe repo-relative path or path_prefix`);
        }
        if (requirement.relation !== undefined && (typeof requirement.relation !== "string" || requirement.relation.trim() === "")) {
            errors.push(`${location}.relation must be a non-empty string`);
        }
        if (requirement.anchors !== undefined && (!Array.isArray(requirement.anchors) || requirement.anchors.length === 0 || requirement.anchors.length > MAX_REQUIRED_ANCHORS || requirement.anchors.some((anchor) => typeof anchor !== "string" || anchor.trim() === ""))) {
            errors.push(`${location}.anchors must contain 1-${MAX_REQUIRED_ANCHORS} non-empty strings`);
        }
    }
}

export function validateCriteriaDocument(document) {
    const errors = [];
    if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.criteria)) {
        return {valid: false, errors: ["criteria document must be an object with a criteria array"]};
    }
    if (document.criteria.length === 0) { errors.push("criteria must not be empty"); }
    const ids = new Set();
    for (const [index, criterion] of document.criteria.entries()) {
        if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) {
            errors.push(`criteria[${index}] must be an object`);
            continue;
        }
        if (typeof criterion.id !== "string" || criterion.id.trim() === "") {
            errors.push(`criteria[${index}].id must be non-empty`);
        } else if (ids.has(criterion.id)) {
            errors.push(`duplicate criterion: ${criterion.id}`);
        } else {
            ids.add(criterion.id);
        }
        if (typeof criterion.description !== "string" || criterion.description.trim() === "") {
            errors.push(`criteria[${index}].description must be non-empty`);
        }
        if (criterion.forbid_negative_claims !== undefined && typeof criterion.forbid_negative_claims !== "boolean") {
            errors.push(`criteria[${index}].forbid_negative_claims must be boolean`);
        }
        validateRequiredEvidence(criterion.required_evidence, index, errors);
    }
    return {valid: errors.length === 0, errors};
}

export function readCriteriaFile(filePath) {
    const document = JSON.parse(readFileSync(filePath, "utf8"));
    const validation = validateCriteriaDocument(document);
    if (!validation.valid) { throw new Error(validation.errors.join("\n")); }
    return document.criteria;
}

export function readCriteriaIds(filePath) {
    return readCriteriaFile(filePath).map((criterion) => criterion.id);
}

function main(argv) {
    const [command, filePath] = argv;
    if (command !== "validate" || !filePath) {
        process.stderr.write("Usage: context-criteria.mjs validate <criteria.json>\n");
        return 2;
    }
    const criteria = readCriteriaFile(filePath);
    process.stdout.write(`context criteria: valid (${criteria.length})\n`);
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
