#!/usr/bin/env node

import {readFileSync} from "node:fs";

export function validateCriteriaDocument(document) {
    const errors = [];
    if (!document || typeof document !== "object" || Array.isArray(document) || !Array.isArray(document.criteria)) {
        return {valid: false, errors: ["criteria document must be an object with a criteria array"]};
    }
    if (document.criteria.length === 0) errors.push("criteria must not be empty");
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
    }
    return {valid: errors.length === 0, errors};
}

export function readCriteriaFile(filePath) {
    const document = JSON.parse(readFileSync(filePath, "utf8"));
    const validation = validateCriteriaDocument(document);
    if (!validation.valid) throw new Error(validation.errors.join("\n"));
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
