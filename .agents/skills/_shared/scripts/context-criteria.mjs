#!/usr/bin/env node

import {readFileSync, readdirSync, statSync} from "node:fs";
import path from "node:path";

import {isMainModule} from "./is-main-module.mjs";

const DECLARED_SURFACE_FIELDS = Object.freeze(["required_tests", "required_symbols"]);
export const CRITERIA_SCHEMA_VERSION = 2;
export const ANCHOR_MODES = Object.freeze(["scout-selected", "required-literal"]);

function isSafeRelativePath(value) {
    return typeof value === "string" && value.trim() !== "" && !value.startsWith("/") && !value.includes("..") && !value.includes("...");
}

function selectorFor(requirement) {
    return requirement.path ?? requirement.path_prefix;
}

function preflightError(code, criterion, requirement, details = {}) {
    return {
        code,
        criterion_id: criterion.id,
        path: selectorFor(requirement),
        ...details,
    };
}

function validateDeclaredSurface(value, location, errors) {
    if (value === undefined) { return; }
    if (Number.isInteger(value) && value >= 0) { return; }
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
        errors.push(`${location} must be a non-negative integer or an array of non-empty strings`);
    }
}

function validateRequiredEvidence(value, criterionIndex, errors) {
    if (value === undefined) { return; }
    if (!Array.isArray(value) || value.length === 0) {
        errors.push(`criteria[${criterionIndex}].required_evidence must contain one or more items`);
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
        if (requirement.anchors !== undefined && (!Array.isArray(requirement.anchors) || requirement.anchors.length === 0 || requirement.anchors.some((anchor) => typeof anchor !== "string" || anchor.trim() === ""))) {
            errors.push(`${location}.anchors must contain one or more non-empty strings`);
        }
        if (requirement.anchor_mode !== undefined && !ANCHOR_MODES.includes(requirement.anchor_mode)) {
            errors.push(`${location}.anchor_mode must be scout-selected or required-literal`);
        }
        if (requirement.anchor_mode === "required-literal" && requirement.anchors === undefined) {
            errors.push(`${location}.anchors are required for required-literal anchor_mode`);
        }
        if (requirement.anchor_mode === "scout-selected" && requirement.anchors !== undefined) {
            errors.push(`${location}.anchors must be omitted for scout-selected anchor_mode`);
        }
    }
}

export function validateCriteriaDocument(document) {
    const errors = [];
    if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.criteria)) {
        return {valid: false, errors: ["criteria document must be an object with a criteria array"]};
    }
    if (document.criteria.length === 0) { errors.push("criteria must not be empty"); }
    if (document.version !== undefined && (!Number.isInteger(document.version) || ![1, CRITERIA_SCHEMA_VERSION].includes(document.version))) {
        errors.push(`criteria version must be 1 or ${CRITERIA_SCHEMA_VERSION}`);
    }
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
        for (const field of DECLARED_SURFACE_FIELDS) {
            validateDeclaredSurface(criterion[field], `criteria[${index}].${field}`, errors);
        }
        validateRequiredEvidence(criterion.required_evidence, index, errors);
    }
    return {valid: errors.length === 0, errors};
}

function normalizedAnchorMode(requirement) {
    if (requirement.anchor_mode !== undefined) { return requirement.anchor_mode; }
    return requirement.anchors === undefined ? "scout-selected" : "required-literal";
}

export function normalizeCriteriaDocument(document) {
    const validation = validateCriteriaDocument(document);
    if (!validation.valid) { throw new Error(validation.errors.join("\n")); }

    return {
        ...document,
        version: CRITERIA_SCHEMA_VERSION,
        criteria: document.criteria.map((criterion) => ({
            ...criterion,
            ...(criterion.required_evidence !== undefined ? {
                required_evidence: criterion.required_evidence.map((requirement) => ({
                    ...requirement,
                    anchor_mode: normalizedAnchorMode(requirement),
                })),
            } : {}),
        })),
    };
}

function isValidRelation(value) {
    return typeof value === "string"
        && value.trim() === value
        && value.length > 0
        && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
}

function resolveWithinRoot(root, relativePath) {
    const resolvedRoot = path.resolve(root);
    const resolvedPath = path.resolve(resolvedRoot, relativePath);
    return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`) ? resolvedPath : null;
}

function filesUnder(directory) {
    const files = [];
    const pending = [directory];
    while (pending.length > 0) {
        const current = pending.pop();
        for (const entry of readdirSync(current, {withFileTypes: true})) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                pending.push(entryPath);
            } else if (entry.isFile()) {
                files.push(entryPath);
            }
        }
    }
    return files;
}

function anchorFound(requirement, root, anchor) {
    const selector = selectorFor(requirement);
    const resolved = resolveWithinRoot(root, selector);
    if (!resolved) { return false; }

    let candidates;
    if (requirement.path !== undefined) {
        candidates = [resolved];
    } else {
        candidates = filesUnder(resolved);
    }

    return candidates.some((candidate) => {
        try {
            return readFileSync(candidate, "utf8").includes(anchor);
        } catch {
            return false;
        }
    });
}

function preflightRequirement(criterion, requirement, root) {
    const selector = selectorFor(requirement);
    const resolved = resolveWithinRoot(root, selector);
    if (!resolved) {
        return preflightError("INVALID_CRITERIA_PATH", criterion, requirement, {message: "path escapes the repository root"});
    }

    let stats;
    try {
        stats = statSync(resolved);
    } catch {
        return preflightError("INVALID_CRITERIA_PATH", criterion, requirement, {message: "required path does not exist"});
    }

    if (requirement.path !== undefined && !stats.isFile()) {
        return preflightError("INVALID_CRITERIA_PATH", criterion, requirement, {message: "path must point to a file"});
    }
    if (requirement.path_prefix !== undefined && !stats.isDirectory()) {
        return preflightError("INVALID_CRITERIA_PATH", criterion, requirement, {message: "path_prefix must point to a directory"});
    }
    if (requirement.path_prefix !== undefined) {
        try {
            if (filesUnder(resolved).length === 0) {
                return preflightError("INVALID_CRITERIA_PATH", criterion, requirement, {message: "path_prefix must contain at least one file"});
            }
        } catch {
            return preflightError("INVALID_CRITERIA_PATH", criterion, requirement, {message: "path_prefix cannot be read"});
        }
    }

    if (requirement.relation !== undefined && !isValidRelation(requirement.relation)) {
        return preflightError("INVALID_CRITERIA_RELATION", criterion, requirement, {
            relation: requirement.relation,
            message: "relation must be a trimmed identifier",
        });
    }

    if (requirement.anchor_mode === "required-literal") {
        for (const anchor of requirement.anchors) {
            if (!anchorFound(requirement, root, anchor)) {
                return preflightError("INVALID_CRITERIA_ANCHOR", criterion, requirement, {
                    anchor,
                    message: "required literal anchor does not occur in the selected evidence path",
                });
            }
        }
    }

    return null;
}

function findContradictoryRequirements(criteria) {
    const errors = [];
    for (const criterion of criteria) {
        const bySelectorAndRelation = new Map();
        for (const requirement of criterion.required_evidence ?? []) {
            const key = `${selectorFor(requirement)}\u0000${requirement.relation ?? ""}`;
            const previous = bySelectorAndRelation.get(key);
            if (previous && previous.anchor_mode !== requirement.anchor_mode) {
                errors.push(preflightError("INVALID_CRITERIA_RELATION", criterion, requirement, {
                    relation: requirement.relation,
                    message: "duplicate evidence selectors use conflicting anchor modes",
                }));
            }
            bySelectorAndRelation.set(key, requirement);
        }
    }
    return errors;
}

export function preflightCriteriaDocument(document, root = process.cwd()) {
    const normalized = normalizeCriteriaDocument(document);
    const errors = findContradictoryRequirements(normalized.criteria);
    for (const criterion of normalized.criteria) {
        for (const requirement of criterion.required_evidence ?? []) {
            const error = preflightRequirement(criterion, requirement, root);
            if (error) { errors.push(error); }
        }
    }
    return {valid: errors.length === 0, errors, document: normalized};
}

export function preflightCriteriaFile(filePath, root = process.cwd()) {
    const document = JSON.parse(readFileSync(filePath, "utf8"));
    return preflightCriteriaDocument(document, root);
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

if (isMainModule(import.meta.url)) {
    try {
        process.exitCode = main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
