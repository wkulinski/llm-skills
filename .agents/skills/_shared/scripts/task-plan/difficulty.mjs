#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {isMainModule} from "../is-main-module.mjs";

export const DIFFICULTY_POLICY_PATH = ".agents/config/task-plan-difficulty.json";

export const DIFFICULTY_LEVELS = Object.freeze(["simple", "moderate", "hard", "very-hard"]);

export const DEFAULT_DIFFICULTY_POLICY = Object.freeze({
    version: 1,
    thresholds: Object.freeze({simple: 30, moderate: 40, hard: 50, "very-hard": 60}),
});

const THRESHOLD_KEYS = DIFFICULTY_LEVELS;
const DIMENSION_KEYS = Object.freeze(["dependencies", "logic", "discovery", "verification"]);
const DIMENSION_LABELS = Object.freeze({
    dependencies: "Dependencies",
    logic: "Logic",
    discovery: "Discovery",
    verification: "Verification",
});
const RISK_FLOORS = Object.freeze({
    none: null,
    authorization: "hard",
    "irreversible-migration": "hard",
    "concurrent-financial": "very-hard",
});
const LEVEL_ORDERS = Object.freeze({simple: 0, moderate: 1, hard: 2, "very-hard": 3});
const PLACEHOLDER_RATIONALE = /^(?:none|n\/a|not applicable|unknown)$/i;
const DIFFICULTY_MARKER = /^-\s+Difficulty:/;
const DIFFICULTY_MARKER_VALUE = /^-\s+Difficulty:\s*(.*)$/;

export class DifficultyError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "DifficultyError";
        this.code = code;
        this.details = details;
    }
}

/**
 * Assess one work package against the difficulty rubric and project policy.
 *
 * Pure: no filesystem or network access. Invalid rubric or policy input throws
 * `DifficultyError` with a stable code. The returned level never falls below
 * the level implied by the rubric sum; a risk floor only raises it.
 *
 * @param {{dependencies: {score: number, rationale: string}, logic: {score: number, rationale: string},
 *   discovery: {score: number, rationale: string}, verification: {score: number, rationale: string},
 *   risk: string}} input
 * @param {{version: 1, thresholds: Record<string, number>}} [policy]
 * @returns {{score: number, level: string, minimumPoints: number}}
 */
export function assessDifficulty(input, policy = DEFAULT_DIFFICULTY_POLICY) {
    const normalizedPolicy = validateDifficultyPolicy(policy);
    const rubric = normalizeRubric(input);
    const score = DIMENSION_KEYS.reduce((total, key) => total + rubric[key].score, 0);
    const level = maxLevel(levelForScore(score), RISK_FLOORS[rubric.risk]);
    return {score, level, minimumPoints: normalizedPolicy.thresholds[level]};
}

/**
 * Load the optional project difficulty policy.
 *
 * A missing file returns the documented defaults. An existing file must be a
 * complete, valid version 1 table: invalid JSON, malformed shape, missing or
 * extra threshold keys, non-number or non-finite values, values outside 0..70
 * and decreasing thresholds all fail closed with `DifficultyError`.
 *
 * @param {{repoRoot?: string, fsOps?: typeof fs}} [options]
 * @returns {{version: 1, thresholds: {simple: number, moderate: number, hard: number, "very-hard": number}}}
 */
export function loadDifficultyPolicy({repoRoot = process.cwd(), fsOps = fs} = {}) {
    const root = path.resolve(repoRoot);
    const configPath = path.resolve(root, DIFFICULTY_POLICY_PATH);
    if (!fsOps.existsSync(configPath)) {
        return validateDifficultyPolicy(DEFAULT_DIFFICULTY_POLICY);
    }
    let input;
    try {
        input = JSON.parse(fsOps.readFileSync(configPath, "utf8"));
    } catch (error) {
        throw new DifficultyError("INVALID_DIFFICULTY_POLICY", "Difficulty policy must be valid JSON.", causeDetails(error));
    }
    return validateDifficultyPolicy(input);
}

/**
 * Parse the canonical `Difficulty: v1` block of one work package.
 *
 * Only real (non-fenced) top-level markers are recognized, and only the nested
 * children that follow the marker belong to the block; a normal top-level
 * `- Verification:` package field is never consumed. `present` is true even for
 * a wrong or empty marker, so legacy detection cannot mask it. `assessment` is
 * set only when the whole block is valid.
 *
 * @param {string} body
 * @param {{version: 1, thresholds: Record<string, number>}} [policy]
 * @returns {{present: boolean, errors: string[], assessment: {score: number, level: string, minimumPoints: number}|null}}
 */
export function parsePackageDifficulty(body, policy = DEFAULT_DIFFICULTY_POLICY) {
    const lines = nonFencedLines(String(body ?? ""));
    const markerIndexes = lines
        .map((line, index) => (DIFFICULTY_MARKER.test(line.text) ? index : -1))
        .filter((index) => index >= 0);
    if (markerIndexes.length === 0) {
        return {present: false, errors: [], assessment: null};
    }

    const errors = [];
    if (markerIndexes.length > 1) {
        errors.push("Difficulty contains duplicate markers; each work package allows exactly one Difficulty: v1 block.");
    }
    const markerIndex = markerIndexes[0];
    const version = lines[markerIndex].text.match(DIFFICULTY_MARKER_VALUE)?.[1]?.trim() ?? "";
    if (version !== "v1") {
        errors.push(`Difficulty version must be v1, received: ${version === "" ? "empty" : version}.`);
    }

    const children = new Map();
    for (let cursor = markerIndex + 1; cursor < lines.length; cursor += 1) {
        const text = lines[cursor].text;
        if (text.trim() === "") {
            continue;
        }
        const child = text.match(/^\s+-\s+([^:]+):\s*(.*)$/);
        if (!child) {
            break;
        }
        const label = child[1].trim();
        if (children.has(label)) {
            errors.push(`Difficulty contains a duplicate ${label} field.`);
            continue;
        }
        children.set(label, child[2].trim());
    }

    const rubric = {};
    for (const key of DIMENSION_KEYS) {
        const label = DIMENSION_LABELS[key];
        if (!children.has(label)) {
            errors.push(`Difficulty is missing required field: ${label}.`);
            continue;
        }
        const dimension = parseDimensionValue(label, children.get(label));
        if (dimension.error) {
            errors.push(dimension.error);
            continue;
        }
        rubric[key] = {score: dimension.score, rationale: dimension.rationale};
    }

    let risk = null;
    if (!children.has("Risk floor")) {
        errors.push("Difficulty is missing required field: Risk floor.");
    } else {
        const candidate = normalizeRisk(children.get("Risk floor"));
        if (candidate === null) {
            errors.push(`Difficulty Risk floor must be one of: ${Object.keys(RISK_FLOORS).join(", ")}.`);
        } else {
            risk = candidate;
        }
    }

    const level = children.get("Level")?.trim().toLowerCase() ?? "";
    if (level === "") {
        errors.push("Difficulty is missing required field: Level.");
    }
    if (!isConcreteRationale(children.get("Rationale"))) {
        errors.push("Difficulty requires a concrete Rationale.");
    }

    if (errors.length > 0) {
        return {present: true, errors: [...new Set(errors)], assessment: null};
    }

    const assessment = assessDifficulty({...rubric, risk}, policy);
    if (level !== assessment.level) {
        return {
            present: true,
            errors: [`Difficulty Level must match the computed level: ${assessment.level}.`],
            assessment: null,
        };
    }
    return {present: true, errors: [], assessment};
}

function normalizeRubric(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new DifficultyError(
            "INVALID_DIFFICULTY_RUBRIC",
            "Difficulty assessment must be an object with dependencies, logic, discovery, verification and risk.",
        );
    }
    const rubric = {};
    for (const key of DIMENSION_KEYS) {
        rubric[key] = normalizeDimension(input[key], DIMENSION_LABELS[key]);
    }
    const risk = normalizeRisk(input.risk);
    if (risk === null) {
        throw new DifficultyError(
            "INVALID_DIFFICULTY_RISK",
            `Difficulty risk floor must be one of: ${Object.keys(RISK_FLOORS).join(", ")}.`,
        );
    }
    rubric.risk = risk;
    return rubric;
}

function normalizeDimension(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new DifficultyError("INVALID_DIFFICULTY_RUBRIC", `Difficulty ${label} must be an object with score and rationale.`);
    }
    if (!isValidScore(value.score)) {
        throw new DifficultyError("INVALID_DIFFICULTY_SCORE", `Difficulty ${label} score must be an integer from 0 to 2.`);
    }
    if (!isConcreteRationale(value.rationale)) {
        throw new DifficultyError("INVALID_DIFFICULTY_RATIONALE", `Difficulty ${label} requires a concrete non-empty rationale.`);
    }
    return {score: value.score, rationale: value.rationale.trim()};
}

function normalizeRisk(value) {
    if (typeof value !== "string") {
        return null;
    }
    const candidate = value.trim().toLowerCase();
    return Object.hasOwn(RISK_FLOORS, candidate) ? candidate : null;
}

function parseDimensionValue(label, value) {
    const match = value.match(/^([0-9]+)\s+[—-]\s*(.+)$/);
    if (!match) {
        return {error: `Difficulty ${label} must use "<score> — <rationale>".`};
    }
    const score = Number(match[1]);
    if (!isValidScore(score)) {
        return {error: `Difficulty ${label} score must be an integer from 0 to 2.`};
    }
    const rationale = match[2].trim();
    if (!isConcreteRationale(rationale)) {
        return {error: `Difficulty ${label} requires a concrete rationale.`};
    }
    return {score, rationale};
}

function validateDifficultyPolicy(policy) {
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
        throw new DifficultyError("INVALID_DIFFICULTY_POLICY", "Difficulty policy must be an object.");
    }
    if (policy.version !== 1) {
        throw new DifficultyError("INVALID_DIFFICULTY_POLICY", "Difficulty policy must use version 1.");
    }
    const thresholds = policy.thresholds;
    if (!thresholds || typeof thresholds !== "object" || Array.isArray(thresholds)) {
        throw new DifficultyError("INVALID_DIFFICULTY_POLICY", "Difficulty policy must contain a thresholds object.");
    }
    const missing = THRESHOLD_KEYS.filter((key) => !Object.hasOwn(thresholds, key));
    const extra = Object.keys(thresholds).filter((key) => !THRESHOLD_KEYS.includes(key));
    if (missing.length > 0 || extra.length > 0) {
        throw new DifficultyError(
            "INVALID_DIFFICULTY_POLICY",
            `Difficulty policy thresholds must contain exactly: ${THRESHOLD_KEYS.join(", ")}.`,
        );
    }
    const values = {};
    let previous = null;
    for (const key of THRESHOLD_KEYS) {
        const value = thresholds[key];
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 70) {
            throw new DifficultyError(
                "INVALID_DIFFICULTY_POLICY",
                `Difficulty policy threshold ${key} must be a finite number from 0 to 70.`,
            );
        }
        if (previous !== null && value < previous) {
            throw new DifficultyError(
                "INVALID_DIFFICULTY_POLICY",
                "Difficulty policy thresholds must not decrease from simple to very-hard.",
            );
        }
        previous = value;
        values[key] = value;
    }
    return {version: 1, thresholds: values};
}

function isValidScore(score) {
    return Number.isInteger(score) && score >= 0 && score <= 2;
}

function isConcreteRationale(value) {
    if (typeof value !== "string" || value.trim() === "") {
        return false;
    }
    return !PLACEHOLDER_RATIONALE.test(value.trim().replace(/[.!;\s]+$/, ""));
}

function levelForScore(score) {
    if (score <= 2) {
        return "simple";
    }
    if (score <= 4) {
        return "moderate";
    }
    if (score <= 6) {
        return "hard";
    }
    return "very-hard";
}

function maxLevel(left, right) {
    if (right === null) {
        return left;
    }
    return LEVEL_ORDERS[left] >= LEVEL_ORDERS[right] ? left : right;
}

/**
 * Lines outside fenced code blocks (backticks or tildes), with the same fence
 * rules as task-plan validation. A single pass also keeps detection bounded.
 */
function nonFencedLines(text) {
    const lines = [];
    let open = null;
    for (const line of text.split("\n")) {
        if (open === null) {
            const opening = line.match(/^\s*(`{3,}|~{3,})/);
            if (opening) {
                open = {character: opening[1][0], length: opening[1].length};
            } else {
                lines.push({text: line});
            }
        } else if (new RegExp(`^\\s*${open.character}{${open.length},}\\s*$`).test(line)) {
            open = null;
        }
    }
    return lines;
}

function causeDetails(error) {
    return {cause: error instanceof Error ? error.message : String(error)};
}

function usage() {
    return [
        "Usage:",
        "  difficulty.mjs assess --body <file|-> [--root <repo>]",
        "",
        "assess reads one work package body with its Difficulty: v1 block and prints",
        "the computed score, level and minimumPoints from the project policy.",
    ].join("\n");
}

function parseArgs(argv) {
    const result = {_: []};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            result._.push(token);
            continue;
        }
        const key = token.slice(2).replaceAll("-", "_");
        const next = argv[index + 1];
        if (typeof next === "undefined" || next.startsWith("--")) {
            result[key] = true;
        } else {
            result[key] = next;
            index += 1;
        }
    }
    return result;
}

function main(argv) {
    const args = parseArgs(argv);
    const command = args._[0];
    if (args.help || !command) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (command !== "assess" || typeof args.body !== "string") {
        throw new DifficultyError("INVALID_ARGUMENT", usage());
    }
    let body;
    try {
        body = fs.readFileSync(args.body === "-" ? 0 : args.body, "utf8");
    } catch (error) {
        throw new DifficultyError("INVALID_ARGUMENT", "Work package body must be a readable file or stdin.", causeDetails(error));
    }
    const policy = loadDifficultyPolicy({repoRoot: typeof args.root === "string" ? args.root : process.cwd()});
    const parsed = parsePackageDifficulty(body, policy);
    if (!parsed.present) {
        throw new DifficultyError("DIFFICULTY_MISSING", "Work package body does not contain a Difficulty: v1 block.");
    }
    if (parsed.errors.length > 0) {
        throw new DifficultyError("INVALID_DIFFICULTY", parsed.errors.join(" "), {errors: parsed.errors});
    }
    process.stdout.write(`${JSON.stringify(parsed.assessment, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "DIFFICULTY_ERROR", message: error.message})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    }
}
