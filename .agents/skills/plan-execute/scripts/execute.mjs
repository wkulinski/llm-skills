#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {writeFileAtomic} from "../../task-plan/scripts/atomic-file.mjs";
import {savePlan} from "../../task-plan/scripts/store.mjs";
import {parseExecutionContract, parsePlanDocument, validatePlanDocument} from "../../task-plan/scripts/validate.mjs";

const PLAN_PREFIX = "docs/plans/";
const SIZE_UNITS = Object.freeze({small: 1, medium: 2, large: 3});
const RESULT_STATUSES = new Set(["done", "in_progress", "blocked"]);

export class PlanExecuteError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "PlanExecuteError";
        this.code = code;
        this.details = details;
    }
}

export function resolvePlanPath({
    repoRoot = process.cwd(),
    explicitPath,
    cachePath = process.env.CACHE_PATH || "var/agent/cache",
    fsOps = fs,
} = {}) {
    const root = path.resolve(repoRoot);
    const pointerPath = resolvePointerPath(root, cachePath);
    const source = explicitPath ? "explicit" : "last-plan";
    const candidate = explicitPath ?? readPointer(pointerPath, fsOps);
    const absolute = path.resolve(root, candidate);
    const relative = path.relative(root, absolute).split(path.sep).join("/");

    if (!isInsideRoot(relative) || !relative.startsWith(PLAN_PREFIX) || !relative.endsWith(".md")) {
        throw new PlanExecuteError(
            "INVALID_PLAN_PATH",
            "Plan path must point to a Markdown file under docs/plans/.",
            {path: candidate},
        );
    }
    if (!fsOps.existsSync(absolute) || !fsOps.statSync(absolute).isFile()) {
        throw new PlanExecuteError("PLAN_NOT_FOUND", `Plan does not exist: ${relative}.`, {path: relative});
    }

    return {absolute, relative, source, pointerPath};
}

export function loadExecutionPlan({planPath, repoRoot = process.cwd(), fsOps = fs} = {}) {
    const root = path.resolve(repoRoot);
    const resolved = resolvePlanPath({repoRoot: root, explicitPath: planPath, fsOps});
    let markdown;
    try {
        markdown = fsOps.readFileSync(resolved.absolute, "utf8");
    } catch (error) {
        throw new PlanExecuteError("PLAN_READ_FAILED", `Could not read ${resolved.relative}.`, {
            cause: error instanceof Error ? error.message : String(error),
        });
    }

    const validation = validatePlanDocument(markdown, {repoRoot: root, fsOps});
    if (!validation.valid || validation.status !== "ready") {
        throw new PlanExecuteError("INVALID_PLAN", "Plan does not satisfy the task-plan contract.", {
            errors: validation.errors,
            status: validation.status,
        });
    }
    const parsed = parsePlanDocument(markdown);
    return {
        ...resolved,
        markdown,
        metadata: parsed.metadata,
        body: parsed.body,
        packages: validation.packages,
        contract: parseExecutionContract(parsed.body),
        validation,
        repoRoot: root,
    };
}

export function writeLastPlanPointer({planPath, repoRoot = process.cwd(), cachePath = process.env.CACHE_PATH || "var/agent/cache", fsOps = fs} = {}) {
    const resolved = resolvePlanPath({repoRoot, explicitPath: planPath, fsOps});
    const pointerPath = resolvePointerPath(path.resolve(repoRoot), cachePath);
    writeFileAtomic(pointerPath, `${resolved.relative}\n`, {fsOps});
    return {path: pointerPath, value: resolved.relative};
}

export function selectBatch(plan, {
    remainingContext,
    availableModels,
    visibleReasoning,
    workType = "general",
    rankingAvailable = true,
} = {}) {
    const capacity = Number(remainingContext);
    if (!Number.isFinite(capacity) || capacity <= 0) {
        return {action: "needs-environment", code: "REMAINING_CONTEXT_REQUIRED", selected: []};
    }
    if (plan.contract.execution.status === "complete") {
        return {action: "complete", selected: [], reason: "all-work-packages-verified"};
    }
    if (plan.contract.execution.status === "blocked") {
        return {action: "blocked", code: "WP_BLOCKED", selected: []};
    }

    const rowsById = new Map(plan.contract.execution.progressRows.map((row) => [row.id, row]));
    const activeRows = plan.contract.execution.progressRows.filter((row) => row.status === "in_progress");
    const candidates = plan.packages.filter((packageRecord) => {
        const row = rowsById.get(packageRecord.id);
        return row && (row.status === "pending" || row.status === "in_progress")
            && dependenciesDone(packageRecord, rowsById);
    });
    const activeIds = new Set(activeRows.map((row) => row.id));
    const orderedCandidates = [
        ...candidates.filter((packageRecord) => activeIds.has(packageRecord.id)),
        ...candidates.filter((packageRecord) => !activeIds.has(packageRecord.id)),
    ];
    const skipped = [];
    const selected = [];
    let used = 0;

    for (const packageRecord of orderedCandidates) {
        const environment = environmentForPackage(plan.contract.environment, packageRecord.id);
        const environmentCheck = resolveExecutionEnvironment(plan, {
            availableModels,
            visibleReasoning,
            workType,
            model: environment.model,
            reasoning: environment.reasoning,
            rankingAvailable,
        });
        if (environmentCheck.action !== "execute") {
            skipped.push({id: packageRecord.id, ...environmentCheck});
            continue;
        }
        const units = sizeUnits(packageRecord);
        if (used + units > capacity) {
            if (selected.length === 0) {
                return {
                    action: "new-session",
                    code: "REMAINING_CONTEXT",
                    selected: [],
                    skipped,
                    next: packageRecord.id,
                };
            }
            break;
        }
        selected.push({
            id: packageRecord.id,
            title: packageRecord.title,
            size: packageSize(packageRecord),
            environment: environmentCheck.environment,
        });
        used += units;
    }

    if (selected.length === 0) {
        if (skipped.length > 0) {
            return {action: "needs-environment", code: skipped[0].code, selected: [], skipped};
        }
        const remainingRows = [...rowsById.values()].filter((row) => row.status === "pending" || row.status === "in_progress");
        const allDone = [...rowsById.values()].every((row) => row.status === "done");
        return remainingRows.length > 0 || !allDone
            ? {action: "blocked", code: "DEPENDENCIES_INCOMPLETE", selected: [], skipped}
            : {action: "complete", code: "ALL_WORK_PACKAGES_DONE", selected: [], skipped};
    }
    return {
        action: "execute",
        selected,
        skipped,
        usedContext: used,
        remainingContext: capacity - used,
    };
}

export function resolveExecutionEnvironment(plan, {
    availableModels,
    visibleReasoning,
    workType = "general",
    model,
    reasoning,
    rankingAvailable = true,
} = {}) {
    const environment = plan.contract.environment;
    const requestedModel = model ?? environment.defaultModel;
    const requestedReasoning = reasoning ?? environment.defaultReasoning;
    if (!Array.isArray(availableModels) || availableModels.length === 0) {
        return {action: "needs-environment", code: "AVAILABLE_MODELS_REQUIRED"};
    }
    if (!availableModels.includes(requestedModel)) {
        return {
            action: "needs-environment",
            code: "MODEL_UNAVAILABLE",
            requestedModel,
        };
    }
    if (!reasoningIsVisible(visibleReasoning, requestedModel, requestedReasoning)) {
        return {
            action: "needs-environment",
            code: "REASONING_VISIBILITY_UNKNOWN",
            requestedModel,
            requestedReasoning,
        };
    }
    const family = modelFamily(requestedModel);
    if (!familyAllowed(environment, family, workType)) {
        return {
            action: "needs-environment",
            code: "MODEL_FAMILY_NOT_ALLOWED",
            requestedModel,
            family,
        };
    }
    return {
        action: "execute",
        environment: {
            model: requestedModel,
            reasoning: requestedReasoning,
            source: rankingAvailable ? "plan-recommendation" : "recorded-plan-recommendation",
            ...(rankingAvailable ? {} : {warning: "leaderboard-unavailable"}),
        },
    };
}

export function recordBatch({
    planPath,
    results,
    repoRoot = process.cwd(),
    cachePath = process.env.CACHE_PATH || "var/agent/cache",
    fsOps = fs,
    now = new Date(),
} = {}) {
    if (!Array.isArray(results) || results.length === 0) {
        throw new PlanExecuteError("INVALID_BATCH", "At least one WP result is required.");
    }
    const plan = loadExecutionPlan({planPath, repoRoot, fsOps});
    const currentRows = new Map(plan.contract.execution.progressRows.map((row) => [row.id, {...row}]));
    const resultIds = new Set();
    for (const result of results) {
        validateBatchResult(result, currentRows, resultIds, plan.packages);
        const row = currentRows.get(result.id);
        row.status = result.status;
        row.completedAt = result.status === "done" ? formatDate(result.completedAt ?? now) : "none";
        row.verification = result.status === "done" ? result.verification.trim() : result.verification?.trim() || "none";
    }

    const next = nextExecutionState(plan.packages, currentRows);
    const logEntry = renderBatchLog(results, now);
    const body = replaceExecutionSection(
        plan.body,
        renderExecutionSection(plan.contract, next, currentRows, appendExecutionLog(plan.contract.execution.log, logEntry)),
    );
    const saved = savePlan({
        repo_root: plan.repoRoot,
        source_identity: plan.metadata.source_identity,
        markdown_body: body,
    }, {fsOps, now: now.toISOString()});
    writeLastPlanPointer({planPath: saved.paths.draft_path, repoRoot: plan.repoRoot, cachePath, fsOps});
    return loadExecutionPlan({planPath: saved.paths.draft_path, repoRoot: plan.repoRoot, fsOps});
}

function validateBatchResult(result, currentRows, resultIds, packages) {
    if (!result || typeof result !== "object" || !RESULT_STATUSES.has(result.status)) {
        throw new PlanExecuteError("INVALID_BATCH_RESULT", "Each batch result needs a valid status.");
    }
    if (typeof result.id !== "string" || !currentRows.has(result.id)) {
        throw new PlanExecuteError("INVALID_BATCH_RESULT", `Unknown WP result: ${result?.id ?? ""}.`);
    }
    if (resultIds.has(result.id)) {
        throw new PlanExecuteError("INVALID_BATCH_RESULT", `Duplicate WP result: ${result.id}.`);
    }
    resultIds.add(result.id);
    const row = currentRows.get(result.id);
    if (row.status !== "pending" && row.status !== "in_progress") {
        throw new PlanExecuteError("INELIGIBLE_WORK_PACKAGE", `${result.id} is not eligible for execution.`);
    }
    const packageRecord = packages.find((item) => item.id === result.id);
    if (!packageRecord || !dependenciesDone(packageRecord, currentRows)) {
        throw new PlanExecuteError("INELIGIBLE_WORK_PACKAGE", `${result.id} dependencies are not complete.`);
    }
    if ((result.status === "done" || result.status === "blocked")
        && (typeof result.verification !== "string" || result.verification.trim() === "")) {
        const requirement = result.status === "done" ? "verification evidence" : "a blocking reason";
        throw new PlanExecuteError("VERIFICATION_REQUIRED", `${result.id} requires ${requirement}.`);
    }
}

function nextExecutionState(packages, rowsById) {
    const rows = packages.map((packageRecord) => rowsById.get(packageRecord.id));
    const nextRow = rows.find((row) => row.status === "pending" || row.status === "in_progress");
    if (!nextRow) {
        return rows.every((row) => row.status === "done")
            ? {status: "complete", nextWp: "none"}
            : {status: "blocked", nextWp: "none"};
    }
    if (rows.some((row) => row.status === "blocked")) {
        return {status: "blocked", nextWp: nextRow.id};
    }
    return {status: "in_progress", nextWp: nextRow.id};
}

function renderExecutionSection(contract, state, rowsById, log) {
    const rows = contract.execution.progressRows.map((row) => {
        const updated = rowsById.get(row.id) ?? row;
        return `| ${updated.id} | ${updated.status} | ${updated.completedAt} | ${safeTableCell(updated.verification)} |`;
    });
    return [
        "## Execution",
        "",
        `- Status: ${state.status}`,
        `- Next WP: ${state.nextWp}`,
        "",
        "### Progress",
        "",
        "| WP | Status | Completed at | Verification |",
        "|---|---|---|---|",
        ...rows,
        "",
        "### Execution log",
        "",
        log,
        "",
    ].join("\n");
}

function replaceExecutionSection(body, replacement) {
    const pattern = /^## Execution\n[\s\S]*?(?=\n## Next action\n)/m;
    if (!pattern.test(body)) {
        throw new PlanExecuteError("INVALID_PLAN", "Plan does not contain a replaceable Execution section.");
    }
    return body.replace(pattern, replacement.trimEnd());
}

function renderBatchLog(results, now) {
    const ids = results.map((result) => result.id).join(", ");
    const summary = results.map((result) => `${result.id}=${result.status}`).join(", ");
    return `- ${formatDate(now)}: batch [${ids}] recorded (${summary}).`;
}

function appendExecutionLog(existing, entry) {
    const current = String(existing ?? "").trim();
    if (current === "" || current === "No execution entries have been recorded.") {
        return entry;
    }
    return `${current}\n${entry}`;
}

function dependenciesDone(packageRecord, rowsById) {
    const dependencies = packageDependencies(packageRecord);
    return dependencies.every((dependency) => rowsById.get(dependency)?.status === "done");
}

function packageDependencies(packageRecord) {
    const field = packageRecord.body.match(/^\s*-\s+Dependencies:\s*(.*)$/m)?.[1] ?? "";
    return [...new Set(field.match(/WP[1-9][0-9]*/g) ?? [])];
}

function sizeUnits(packageRecord) {
    return SIZE_UNITS[packageSize(packageRecord)] ?? SIZE_UNITS.large;
}

function packageSize(packageRecord) {
    const value = packageRecord.body.match(/^\s*-\s+Estimated size:\s*(.+?)\s*$/im)?.[1];
    return ["small", "medium", "large"].includes(cleanValue(value).toLowerCase())
        ? cleanValue(value).toLowerCase()
        : "large";
}

function environmentForPackage(environment, id) {
    const override = environment.wpOverrideEntries
        .map(parseOverride)
        .find((entry) => entry?.id === id);
    return {
        model: override?.model ?? cleanValue(environment.defaultModel),
        reasoning: override?.reasoning ?? cleanValue(environment.defaultReasoning),
    };
}

function parseOverride(line) {
    const match = String(line).match(/^[-*]\s+(WP[1-9][0-9]*):\s*model=([^;]+);\s*reasoning=([^;]+);\s*justification=(.+)$/i);
    if (!match) {
        return null;
    }
    return {id: match[1], model: cleanValue(match[2]), reasoning: cleanValue(match[3])};
}

function familyAllowed(environment, family, workType) {
    const override = cleanValue(environment.projectFamilyOverride).toLowerCase();
    if (override && override !== "none") {
        const allowedByOverride = override.match(/[a-z][a-z0-9_-]*/g) ?? [];
        return allowedByOverride.includes(family)
            && (family !== "qwen" || workType === "frontend-design");
    }
    if (family === "qwen") {
        return workType === "frontend-design";
    }
    const allowedFamilies = cleanValue(environment.allowedModelFamilies).toLowerCase().match(/[a-z][a-z0-9_-]*/g) ?? [];
    return allowedFamilies.includes(family);
}

function modelFamily(model) {
    return String(model).split("/", 1)[0].toLowerCase();
}

function reasoningIsVisible(visibleReasoning, model, reasoning) {
    if (visibleReasoning === true) {
        return true;
    }
    if (!visibleReasoning || typeof visibleReasoning !== "object") {
        return false;
    }
    const values = Array.isArray(visibleReasoning)
        ? visibleReasoning
        : visibleReasoning[model] ?? [];
    return Array.isArray(values) && values.includes(reasoning);
}

function readPointer(pointerPath, fsOps) {
    if (!fsOps.existsSync(pointerPath)) {
        throw new PlanExecuteError("PLAN_PATH_REQUIRED", "No last plan pointer exists; provide an explicit plan path.");
    }
    const values = fsOps.readFileSync(pointerPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (values.length !== 1) {
        throw new PlanExecuteError("INVALID_LAST_PLAN_POINTER", "Last plan pointer must contain exactly one path.");
    }
    return values[0];
}

function resolvePointerPath(repoRoot, cachePath) {
    const root = path.resolve(repoRoot);
    const cacheRoot = path.isAbsolute(cachePath) ? cachePath : path.resolve(root, cachePath);
    return path.resolve(cacheRoot, "plan-execute", "last-plan.txt");
}

function isInsideRoot(relative) {
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function cleanValue(value) {
    return String(value ?? "").trim().replace(/^`(.*)`$/, "$1").trim();
}

function safeTableCell(value) {
    return String(value ?? "none").replaceAll("|", "/").trim() || "none";
}

function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new PlanExecuteError("INVALID_TIMESTAMP", "Batch timestamp must be valid.");
    }
    return date.toISOString().slice(0, 10);
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
        const next = index + 1 < argv.length ? argv[index + 1] : null;
        if (next === null || next.startsWith("--")) {
            result[key] = true;
        } else {
            result[key] = next;
            index += 1;
        }
    }
    return result;
}

function listOption(value) {
    return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parseVisibleReasoning(value, defaultModel) {
    const mapped = {};
    const levels = [];
    for (const item of listOption(value)) {
        const separator = item.indexOf("=");
        if (separator < 1) {
            levels.push(item);
            continue;
        }
        const model = item.slice(0, separator).trim();
        const reasoning = item.slice(separator + 1).trim();
        if (!mapped[model]) {
            mapped[model] = [];
        }
        mapped[model].push(reasoning);
    }
    if (levels.length > 0) {
        mapped[defaultModel] = levels;
    }
    return mapped;
}

function readJson(filePath) {
    const content = fs.readFileSync(path.resolve(filePath), "utf8");
    return JSON.parse(content);
}

function usage() {
    return [
        "Usage:",
        "  execute.mjs resolve [--path <docs/plans/plan.md>]",
        "  execute.mjs begin --path <docs/plans/plan.md>",
        "  execute.mjs select --path <plan> --context-budget <units> --available-models <provider/model> --reasoning <level>",
        "  execute.mjs record --path <plan> --results-file <results.json>",
    ].join("\n");
}

async function main(argv) {
    const args = parseArgs(argv);
    const command = args._[0];
    if (args.help || command === "help") {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (command === "resolve") {
        process.stdout.write(`${JSON.stringify(resolvePlanPath({explicitPath: args.path, repoRoot: args.root, cachePath: args.cache_path}))}\n`);
        return;
    }
    if (command === "begin") {
        process.stdout.write(`${JSON.stringify(writeLastPlanPointer({planPath: args.path, repoRoot: args.root, cachePath: args.cache_path}))}\n`);
        return;
    }
    if (command === "select") {
        const plan = loadExecutionPlan({planPath: args.path, repoRoot: args.root});
        const selected = selectBatch(plan, {
            remainingContext: Number(args.context_budget),
            availableModels: listOption(args.available_models),
            visibleReasoning: parseVisibleReasoning(args.reasoning, args.model ?? plan.contract.environment.defaultModel),
            workType: args.work_type ?? "general",
            rankingAvailable: !args.leaderboard_unavailable,
        });
        process.stdout.write(`${JSON.stringify(selected, null, 2)}\n`);
        return;
    }
    if (command === "record") {
        const results = readJson(args.results_file);
        const recorded = recordBatch({
            planPath: args.path,
            results,
            repoRoot: args.root,
            cachePath: args.cache_path,
        });
        process.stdout.write(`${JSON.stringify({status: recorded.contract.execution.status, path: recorded.relative})}\n`);
        return;
    }
    throw new PlanExecuteError("INVALID_ARGUMENT", usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "PLAN_EXECUTE_ERROR", message: error.message, details: error.details ?? {}})}\n`);
        process.exitCode = 1;
    });
}
