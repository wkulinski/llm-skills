#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";

import {compareModelProfiles, loadModelHierarchy} from "../../_shared/scripts/model-hierarchy.mjs";
import {completeWorkPackage, loadPlanFile} from "../../task-plan/scripts/store.mjs";
import {
    parseExecutionContract,
    parseExecutionEnvironment,
    parsePlanDocument,
} from "../../task-plan/scripts/validate.mjs";

const PLAN_PREFIX = "docs/plans/";

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
    let loaded;
    try {
        loaded = loadPlanFile({repoRoot, planPath, fsOps});
    } catch (error) {
        throw translateExecutionError(error);
    }
    if (loaded.status !== "ready") {
        throw new PlanExecuteError("PLAN_NOT_READY", `Plan validation status is ${loaded.status}.`, {
            errors: loaded.validation?.errors ?? [],
        });
    }
    const parsed = parsePlanDocument(loaded.markdown);
    return {
        ...loaded,
        repoRoot: path.resolve(repoRoot),
        body: parsed.body,
        packages: loaded.validation.packages,
        environment: parseExecutionEnvironment(parsed.body),
        execution: parseExecutionContract(parsed.body),
    };
}

export function selectNextWorkPackage(plan) {
    const next = plan.execution.items.find((item) => !item.completed);
    if (!next) {
        return {action: "complete", selected: null};
    }
    const packageRecord = plan.packages.find((item) => item.id === next.id);
    if (!packageRecord) {
        throw new PlanExecuteError("INVALID_PLAN", `Execution references unknown work package: ${next.id}.`);
    }
    const override = plan.environment.overrides.find((item) => item.id === next.id);
    return {
        action: "execute",
        selected: {
            id: packageRecord.id,
            title: packageRecord.title,
            body: packageRecord.body,
            estimatedSize: packageField(packageRecord.body, "Estimated size"),
            environment: override
                ? {
                    model: override.model,
                    reasoning: override.reasoning,
                    source: "wp-override",
                    justification: override.justification,
                }
                : {
                    model: plan.environment.defaultModel,
                    reasoning: plan.environment.defaultReasoning,
                    source: "plan-default",
                },
        },
    };
}

export function checkExecutionEnvironment(plan, {currentModel, currentReasoning, fsOps = fs} = {}) {
    const selection = selectNextWorkPackage(plan);
    if (selection.action === "complete") {
        return {action: "complete", sufficient: true, selected: null};
    }
    try {
        const hierarchy = loadModelHierarchy({repoRoot: plan.repoRoot, fsOps});
        const comparison = compareModelProfiles(hierarchy, {
            required: selection.selected.environment,
            current: {model: currentModel, reasoning: currentReasoning},
        });
        return {
            action: comparison.sufficient ? "execute" : "change-environment",
            ...comparison,
            selected: selection.selected,
        };
    } catch (error) {
        throw translateExecutionError(error);
    }
}

function packageField(packageBody, label) {
    return packageBody.match(new RegExp(`^\\s*-\\s+${label}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
}

export function writeLastPlanPointer({
    planPath,
    repoRoot = process.cwd(),
    cachePath = process.env.CACHE_PATH || "var/agent/cache",
    fsOps = fs,
} = {}) {
    const resolved = resolvePlanPath({repoRoot, explicitPath: planPath, cachePath, fsOps});
    const pointerPath = resolvePointerPath(path.resolve(repoRoot), cachePath);
    fsOps.mkdirSync(path.dirname(pointerPath), {recursive: true});
    fsOps.writeFileSync(pointerPath, `${resolved.relative}\n`, "utf8");
    return {path: pointerPath, value: resolved.relative};
}

function resolvePointerPath(repoRoot, cachePath) {
    const root = path.resolve(repoRoot);
    const cacheRoot = path.isAbsolute(cachePath) ? cachePath : path.resolve(root, cachePath);
    return path.resolve(cacheRoot, "plan-execute", "last-plan.txt");
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

function isInsideRoot(relative) {
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function translateExecutionError(error) {
    if (error instanceof Error && typeof error.code === "string") {
        return new PlanExecuteError(error.code, error.message, error.details ?? {});
    }
    return error;
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

function usage() {
    return [
        "Usage:",
        "  execute.mjs resolve [--path <plan>] [--root <repo>] [--cache-path <dir>]",
        "  execute.mjs next [--path <plan>] [--root <repo>] [--cache-path <dir>]",
        "  execute.mjs check-environment [--path <plan>] --current-model <model> --current-reasoning <level> [--root <repo>] [--cache-path <dir>]",
        "  execute.mjs complete --path <plan> --wp <WPn> --evidence <text> [--root <repo>] [--cache-path <dir>]",
    ].join("\n");
}

async function main(argv) {
    const args = parseArgs(argv);
    const command = args._[0];
    if (args.help || !command) {
        process.stdout.write(`${usage()}\n`);
        return;
    }

    const repoRoot = path.resolve(args.root ?? process.cwd());
    const cachePath = args.cache_path ?? process.env.CACHE_PATH ?? "var/agent/cache";
    const resolved = resolvePlanPath({repoRoot, explicitPath: args.path, cachePath});
    writeLastPlanPointer({planPath: resolved.absolute, repoRoot, cachePath});

    let result;
    if (command === "resolve") {
        result = {path: resolved.relative, source: resolved.source};
    } else if (command === "next") {
        result = selectNextWorkPackage(loadExecutionPlan({planPath: resolved.absolute, repoRoot}));
    } else if (command === "check-environment" && args.current_model && args.current_reasoning) {
        result = checkExecutionEnvironment(loadExecutionPlan({planPath: resolved.absolute, repoRoot}), {
            currentModel: args.current_model,
            currentReasoning: args.current_reasoning,
        });
    } else if (command === "complete" && args.wp && args.evidence) {
        try {
            const completed = completeWorkPackage({
                repoRoot,
                planPath: resolved.absolute,
                wpId: args.wp,
                evidence: args.evidence,
            });
            result = {
                action: "completed",
                changed: completed.changed,
                workPackage: completed.completed,
                revision: completed.metadata.revision,
                path: completed.paths.draft_path,
            };
        } catch (error) {
            throw translateExecutionError(error);
        }
    } else {
        throw new PlanExecuteError("INVALID_ARGUMENT", usage());
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({
            error: error.code ?? "PLAN_EXECUTE_ERROR",
            message: error.message,
            details: error.details ?? {},
        })}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}
