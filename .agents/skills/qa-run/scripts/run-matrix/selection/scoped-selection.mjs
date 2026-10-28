import {readFileSync} from "node:fs";
import path from "node:path";

import {hashJson} from "../shared/hashing.mjs";

export const RUN_SCOPES = new Set(["full", "point", "partial"]);

const SELECTION_KEYS = new Set(["matrixHash", "checks"]);
const MATRIX_CHECK_KEYS = new Set(["section", "commandIndex"]);
const TEST_CHECK_KEYS = new Set(["runner", "selectors"]);

export function assertSelectionInsideCache(selectionAbsPath, cacheRoot) {
    const relative = path.relative(path.resolve(cacheRoot), path.resolve(selectionAbsPath));
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Selection file must be stored under CACHE_PATH (${cacheRoot}): ${selectionAbsPath}`);
    }
}

export function loadSelection(selectionAbsPath) {
    let raw;
    try {
        raw = readFileSync(selectionAbsPath, "utf-8");
    } catch {
        throw new Error(`Cannot read selection file: ${selectionAbsPath}`);
    }

    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Invalid JSON selection: ${selectionAbsPath}`);
    }
}

/**
 * Validates the whole selection and resolves every tool before anything runs.
 * Matrix commands keep matrix order; targeted tests follow in selection order.
 */
export function buildScopedPlan({config, resolveTool, scope, selection}) {
    const checks = readChecks(selection, scope, config);
    const matrixEntries = [];
    const testChecks = [];
    const seen = new Set();

    for (const [position, check] of checks.entries()) {
        const context = `Selection checks[${position}]`;
        if (!check || typeof check !== "object" || Array.isArray(check)) {
            throw new Error(`${context} must be an object.`);
        }

        const key = Object.hasOwn(check, "runner")
            ? readTestCheck(context, check, config, testChecks)
            : readMatrixCheck(context, check, config, matrixEntries);
        if (seen.has(key)) {
            throw new Error(`${context} duplicates an earlier check.`);
        }
        seen.add(key);
    }

    const resolvedTools = new Map();
    for (const {runner} of testChecks) {
        const {tool} = config.targetedTests[runner];
        if (!resolvedTools.has(tool)) {
            resolvedTools.set(tool, resolveTool(tool));
        }
    }

    matrixEntries.sort((left, right) => left.order - right.order || left.command.sourceIndex - right.command.sourceIndex);

    return [
        ...matrixEntries.map(({check, command, section}) => ({check, command, section})),
        ...testChecks.map(({runner, selectors}) => buildTestEntry(config.targetedTests[runner], resolvedTools.get(config.targetedTests[runner].tool), selectors)),
    ];
}

function readChecks(selection, scope, config) {
    if (scope !== "point" && scope !== "partial") {
        throw new Error(`Scoped plan requires scope point or partial, got: ${scope}.`);
    }

    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
        throw new Error("Selection root must be a JSON object.");
    }

    assertKnownKeys("Selection", selection, SELECTION_KEYS);
    const expectedHash = hashJson(config.raw);
    if (selection.matrixHash !== expectedHash) {
        throw new Error(`Selection matrixHash does not match the current matrix (expected ${expectedHash}).`);
    }

    if (!Array.isArray(selection.checks) || selection.checks.length === 0) {
        throw new Error('Selection "checks" must be a non-empty array.');
    }

    if (scope === "point" && selection.checks.length !== 1) {
        throw new Error(`Scope point requires exactly one check, got ${selection.checks.length}.`);
    }

    return selection.checks;
}

function readMatrixCheck(context, check, config, matrixEntries) {
    assertKnownKeys(context, check, MATRIX_CHECK_KEYS);
    const {commandIndex, section: sectionName} = check;
    if (typeof sectionName !== "string" || !Object.hasOwn(config.sections, sectionName)) {
        throw new Error(`${context} references unknown section: ${String(sectionName)}.`);
    }

    if (!Number.isInteger(commandIndex) || commandIndex < 0) {
        throw new Error(`${context} commandIndex must be a non-negative integer.`);
    }

    const section = config.sections[sectionName];
    const command = section.commands.find((entry) => entry.sourceIndex === commandIndex);
    if (!command) {
        throw new Error(`${context} does not reference a non-empty command: ${sectionName}[${commandIndex}].`);
    }

    matrixEntries.push({
        check: {commandIndex, kind: "matrix", section: sectionName},
        command,
        order: config.sectionOrder.indexOf(sectionName),
        section,
    });
    return `matrix:${sectionName}:${commandIndex}`;
}

function readTestCheck(context, check, config, testChecks) {
    assertKnownKeys(context, check, TEST_CHECK_KEYS);
    const {runner, selectors} = check;
    if (typeof runner !== "string" || !Object.hasOwn(config.targetedTests, runner)) {
        throw new Error(`${context} references a runner not configured in targetedTests: ${String(runner)}.`);
    }

    if (!Array.isArray(selectors) || selectors.length === 0) {
        throw new Error(`${context} selectors must be a non-empty array.`);
    }

    if (selectors.some((selector) => typeof selector !== "string" || selector.trim().length === 0)) {
        throw new Error(`${context} selectors must contain only non-empty strings.`);
    }

    testChecks.push({runner, selectors: [...selectors]});
    return `test:${runner}:${JSON.stringify(selectors)}`;
}

function buildTestEntry(targetedTest, executable, selectors) {
    const args = [...targetedTest.args, ...selectors];
    return {
        check: {kind: "test", runner: targetedTest.name, selectors: [...selectors]},
        command: {
            argv: {args, file: executable},
            cmd: [targetedTest.tool, ...args].map(quoteForDisplay).join(" "),
            label: selectors.map(quoteForDisplay).join(" "),
            output: targetedTest.output,
        },
        section: {
            cache: {enabled: false, envKeys: []},
            name: `targeted:${targetedTest.name}`,
        },
    };
}

function assertKnownKeys(context, value, allowedKeys) {
    const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
        throw new Error(`${context} has unknown keys: ${unknownKeys.join(", ")}.`);
    }
}

// Display only: the command itself is executed as an argv array without a shell.
function quoteForDisplay(value) {
    return /^[\w@%+=:,./-]+$/.test(value)
        ? value
        : `'${value.replace(/'/g, "'\\''")}'`;
}
