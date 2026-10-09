#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {compareFreshProfiles} from "../../_shared/scripts/model-leaderboard.mjs";
import {compareModelProfiles, loadModelHierarchy} from "../../_shared/scripts/model-hierarchy.mjs";
import {completeWorkPackage as completeTaskPlanWorkPackage, loadPlanFile} from "../../_shared/scripts/task-plan/store.mjs";
import {writeFileAtomic} from "../../_shared/scripts/task-plan/atomic-file.mjs";
import {
    parseExecutionContract,
    parseExecutionEnvironment,
    parsePlanDocument,
    parseQuestions,
    parseRisks,
} from "../../_shared/scripts/task-plan/validate.mjs";

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
        const reason = loaded.validation?.blocked_reason ?? null;
        const hint = reason === "review_pending"
            ? " Review the plan in $task-plan and record the decision with store.mjs record-review before executing it."
            : "";
        throw new PlanExecuteError("PLAN_NOT_READY", `Plan validation status is ${loaded.status}${reason ? ` (${reason})` : ""}.${hint}`, {
            errors: loaded.validation?.errors ?? [],
            blocked_reason: reason,
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
        decisions: parseQuestions(parsed.body).entries,
        risks: parseRisks(parsed.body),
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
            decisions: plan.decisions ?? [],
            risks: (plan.risks ?? [])
                .filter((risk) => risk.work_packages.length === 0 || risk.work_packages.includes(packageRecord.id))
                .map(({work_packages: scope, ...risk}) => ({...risk, scope: scope.length === 0 ? "plan" : "work-package"})),
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

export const SESSION_MODEL_ENV = "OPENCODE_SESSION_MODEL";
export const SESSION_REASONING_ENV = "OPENCODE_SESSION_VARIANT";

const DECISION_OPTIONS = Object.freeze(["change-profile", "user-attested", "stop"]);

function decisionOptions() {
    return [...DECISION_OPTIONS];
}

export async function checkExecutionEnvironment(plan, {
    currentModel,
    currentReasoning,
    userAttested = false,
    attestedWp,
    attestedModel,
    attestedReasoning,
    requiredLabel,
    currentLabel,
    env = process.env,
    fsOps = fs,
    fetchImpl,
} = {}) {
    const selection = selectNextWorkPackage(plan);
    if (selection.action === "complete") {
        return {action: "complete", sufficient: true, selected: null};
    }

    // The ready plan's required profile must be proven in the validated
    // hierarchy before any attestation or unknown-current handling can admit
    // the work package; neither can bypass a missing or invalid hierarchy.
    let hierarchy;
    let probe;
    try {
        hierarchy = loadModelHierarchy({repoRoot: plan.repoRoot, fsOps});
        probe = compareModelProfiles(hierarchy, {
            required: selection.selected.environment,
            current: selection.selected.environment,
        });
    } catch (error) {
        throw translateExecutionError(error);
    }

    const hasModelFlag = typeof currentModel === "string" && currentModel.trim() !== "";
    const hasReasoningFlag = typeof currentReasoning === "string" && currentReasoning.trim() !== "";
    if (hasModelFlag !== hasReasoningFlag) {
        throw new PlanExecuteError(
            "INVALID_ARGUMENT",
            "Pass both --current-model and --current-reasoning, or neither to use the session environment.",
        );
    }
    const hasAttestedModel = typeof attestedModel === "string" && attestedModel.trim() !== "";
    const hasAttestedReasoning = typeof attestedReasoning === "string" && attestedReasoning.trim() !== "";
    if (hasAttestedModel !== hasAttestedReasoning) {
        throw new PlanExecuteError(
            "INVALID_ARGUMENT",
            "Pass both --attested-model and --attested-reasoning, or neither.",
        );
    }
    const hasRequiredLabel = typeof requiredLabel === "string" && requiredLabel.trim() !== "";
    const hasCurrentLabel = typeof currentLabel === "string" && currentLabel.trim() !== "";
    if (hasRequiredLabel !== hasCurrentLabel) {
        throw new PlanExecuteError(
            "INVALID_ARGUMENT",
            "Pass both --required-label and --current-label, or neither.",
        );
    }
    const labels = hasRequiredLabel ? {required: requiredLabel.trim(), current: currentLabel.trim()} : null;

    const envModel = typeof env?.[SESSION_MODEL_ENV] === "string" ? env[SESSION_MODEL_ENV].trim() : "";
    const envReasoning = typeof env?.[SESSION_REASONING_ENV] === "string" ? env[SESSION_REASONING_ENV].trim() : "";
    const model = hasModelFlag ? currentModel.trim() : envModel;
    const reasoning = hasReasoningFlag ? currentReasoning.trim() : envReasoning;
    const observed = model && reasoning ? {model, reasoning} : null;
    const profileSource = hasModelFlag ? "flags" : "session-env";

    if (userAttested) {
        return attestExecutionEnvironment(selection, probe, {
            attestedWp,
            attestedModel: hasAttestedModel ? attestedModel.trim() : null,
            attestedReasoning: hasAttestedReasoning ? attestedReasoning.trim() : null,
            observed,
        });
    }

    if (!observed) {
        return {
            action: "decision-required",
            sufficient: false,
            reason: "current-profile-unknown",
            code: "SESSION_PROFILE_UNKNOWN",
            required: probe.required,
            current: model || reasoning ? {model: model || null, reasoning: reasoning || null} : null,
            selected: selection.selected,
            options: decisionOptions(),
        };
    }

    let comparison = null;
    try {
        comparison = compareModelProfiles(hierarchy, {required: probe.required, current: observed});
    } catch (error) {
        if (error?.code !== "UNRANKED_CURRENT_PROFILE") {
            throw translateExecutionError(error);
        }
    }
    if (!comparison) {
        return checkExternalEnvironment({required: probe.required, current: observed, labels, profileSource, selection, fetchImpl});
    }
    return {
        action: comparison.sufficient ? "execute" : "change-environment",
        ...comparison,
        source: profileSource,
        selected: selection.selected,
        ...(comparison.sufficient ? {} : {options: decisionOptions()}),
    };
}

/** A ranked local comparison never fetches; only an unranked current profile
 * reaches the shared fresh boundary, which reads both sides in one fetch.
 * Without agent-supplied ranking labels nothing is fetched: the agent first
 * pairs both profiles with rows printed by `model-leaderboard.mjs entries`.
 */
async function checkExternalEnvironment({required, current, labels, profileSource, selection, fetchImpl}) {
    if (!labels) {
        return {
            action: "pairing-required",
            sufficient: false,
            reason: "ranking-labels-missing",
            required: {model: required.model, reasoning: required.reasoning},
            current,
            selected: selection.selected,
            source: "leaderboard",
            profileSource,
        };
    }
    const comparison = await compareFreshProfiles(
        {model: required.model, reasoning: required.reasoning, label: labels.required},
        {...current, label: labels.current},
        {fetchImpl},
    );
    if (comparison.status === "decision-required") {
        return {
            action: "decision-required",
            sufficient: false,
            reason: comparison.reason,
            code: comparison.code,
            required: comparison.required,
            current: comparison.current,
            selected: selection.selected,
            source: "leaderboard",
            profileSource,
            options: decisionOptions(),
        };
    }
    return {
        action: comparison.sufficient ? "execute" : "change-environment",
        sufficient: comparison.sufficient,
        required: comparison.required,
        current: comparison.current,
        tolerance: comparison.tolerance,
        source: "leaderboard",
        leaderboardSource: comparison.source,
        fetchedAt: comparison.fetchedAt,
        profileSource,
        selected: selection.selected,
        ...(comparison.sufficient ? {} : {options: decisionOptions()}),
    };
}

/** One explicit, WP-scoped admission after the user confirms. Nothing is
 * persisted: a changed work package or observed profile invalidates the scope,
 * and an unobservable profile is never bound for reuse.
 */
function attestExecutionEnvironment(selection, probe, {attestedWp, attestedModel, attestedReasoning, observed}) {
    const selectedId = selection.selected.id;
    if (typeof attestedWp !== "string" || attestedWp.trim() === "") {
        throw new PlanExecuteError(
            "INVALID_ARGUMENT",
            "--user-attested requires --attested-wp with the confirmed work package.",
        );
    }
    if (attestedWp.trim() !== selectedId) {
        throw new PlanExecuteError(
            "ATTESTATION_SCOPE_MISMATCH",
            `User attestation was confirmed for ${attestedWp.trim()}, but the selected work package is ${selectedId}; ask the user again.`,
            {attested_wp: attestedWp.trim(), selected: selectedId, options: decisionOptions()},
        );
    }
    if (observed) {
        if (attestedModel !== observed.model || attestedReasoning !== observed.reasoning) {
            throw new PlanExecuteError(
                "ATTESTATION_SCOPE_MISMATCH",
                "The observed current profile changed since the user confirmed the attestation; ask the user again.",
                {
                    observed,
                    attested_model: attestedModel,
                    attested_reasoning: attestedReasoning,
                    options: decisionOptions(),
                },
            );
        }
        return attestationResult(selection, probe, observed);
    }
    if (attestedModel !== null || attestedReasoning !== null) {
        throw new PlanExecuteError(
            "ATTESTATION_SCOPE_MISMATCH",
            "The current profile is not observable, so attested model/reasoning cannot be scoped to it; ask the user again.",
            {options: decisionOptions()},
        );
    }
    return attestationResult(selection, probe, null);
}

function attestationResult(selection, probe, observed) {
    return {
        action: "execute",
        sufficient: true,
        attested: true,
        source: "user-attested",
        required: probe.required,
        current: observed,
        attestation: {wpId: selection.selected.id, profile: observed, reusable: false},
        selected: selection.selected,
    };
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
    writeFileAtomic(pointerPath, `${resolved.relative}\n`, {fsOps});
    return {path: pointerPath, value: resolved.relative};
}

export function completeExecutionWorkPackage({
    planPath,
    wpId,
    evidence,
    repoRoot = process.cwd(),
    cachePath = process.env.CACHE_PATH || "var/agent/cache",
    fsOps = fs,
} = {}, options = {}) {
    try {
        const resolved = resolvePlanPath({repoRoot, explicitPath: planPath, cachePath, fsOps});
        const pointer = writeLastPlanPointer({planPath: resolved.absolute, repoRoot, cachePath, fsOps});
        const completed = completeTaskPlanWorkPackage({repoRoot, planPath: resolved.absolute, wpId, evidence, fsOps}, options);
        return {...completed, pointer};
    } catch (error) {
        throw translateExecutionError(error);
    }
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
        "  execute.mjs check-environment [--current-model <model> --current-reasoning <level>] [--required-label <ranking label> --current-label <ranking label>] [--user-attested --attested-wp <WPn> [--attested-model <model> --attested-reasoning <level>]] [--path <plan>] [--root <repo>] [--cache-path <dir>]",
        "  execute.mjs complete --path <plan> --wp <WPn> --evidence <text> [--root <repo>] [--cache-path <dir>]",
    ].join("\n");
}

function optionalStringArg(args, key) {
    const value = args[key];
    if (typeof value === "undefined") {
        return null;
    }
    if (typeof value !== "string" || !value.trim()) {
        throw new PlanExecuteError("INVALID_ARGUMENT", `--${key.replaceAll("_", "-")} requires a value.`);
    }
    return value;
}

function booleanFlag(args, key) {
    const value = args[key];
    if (typeof value === "undefined") {
        return false;
    }
    if (value !== true) {
        throw new PlanExecuteError("INVALID_ARGUMENT", `--${key.replaceAll("_", "-")} does not take a value.`);
    }
    return true;
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

    let result;
    if (command === "complete") {
        if (!args.path || !args.wp || !args.evidence) {
            throw new PlanExecuteError(
                "INVALID_ARGUMENT",
                "complete requires --path, --wp and --evidence.",
            );
        }
        result = completeExecutionWorkPackage({
            planPath: args.path,
            repoRoot,
            wpId: args.wp,
            evidence: args.evidence,
            cachePath,
        });
    } else {
        const resolved = resolvePlanPath({repoRoot, explicitPath: args.path, cachePath});
        writeLastPlanPointer({planPath: resolved.absolute, repoRoot, cachePath});
        if (command === "resolve") {
            result = {path: resolved.relative, source: resolved.source};
        } else if (command === "next") {
            result = selectNextWorkPackage(loadExecutionPlan({planPath: resolved.absolute, repoRoot}));
        } else if (command === "check-environment") {
            const userAttested = booleanFlag(args, "user_attested");
            const scope = {
                attestedWp: optionalStringArg(args, "attested_wp"),
                attestedModel: optionalStringArg(args, "attested_model"),
                attestedReasoning: optionalStringArg(args, "attested_reasoning"),
            };
            if (!userAttested && (scope.attestedWp !== null || scope.attestedModel !== null || scope.attestedReasoning !== null)) {
                throw new PlanExecuteError("INVALID_ARGUMENT", "--attested-* flags require --user-attested.");
            }
            result = await checkExecutionEnvironment(loadExecutionPlan({planPath: resolved.absolute, repoRoot}), {
                currentModel: optionalStringArg(args, "current_model"),
                currentReasoning: optionalStringArg(args, "current_reasoning"),
                requiredLabel: optionalStringArg(args, "required_label"),
                currentLabel: optionalStringArg(args, "current_label"),
                userAttested,
                ...scope,
            });
        } else {
            throw new PlanExecuteError("INVALID_ARGUMENT", usage());
        }
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({
            error: error.code ?? "PLAN_EXECUTE_ERROR",
            message: error.message,
            details: error.details ?? {},
        })}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}
