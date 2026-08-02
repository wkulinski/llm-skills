import { calculatePricingHashes } from "./pricing.mjs";
import { aggregateCost, aggregateCostRecords, isObservedStep } from "./costs.mjs";
import { durationMs } from "./util.mjs";
import { enrichSpansWithFingerprints } from "./fingerprints.mjs";
import { buildPatternGroups } from "./pattern-groups.mjs";
import { diagnoseDelegationOverlap } from "./delegation-overlap.mjs";
import { buildMethodologyManifest, REPORT_SCHEMA_VERSION } from "./methodology.mjs";

const ZERO_USAGE = {
    input_tokens: 0n,
    output_tokens: 0n,
    reasoning_tokens: 0n,
    cache_read_tokens: 0n,
    cache_write_tokens: 0n,
};

const ACTIVITY_ORDER = [
    "retry_recovery",
    "final_response",
    "delegation",
    "verification",
    "build",
    "implementation",
    "external_research",
    "repository_discovery",
    "file_reading",
    "skill_loading",
    "version_control",
    "shell_execution",
    "planning_reasoning",
    "unknown",
];

const SUPPORTIVE_ACTIVITIES = {
    retry_recovery: new Set(ACTIVITY_ORDER.filter((value) => !["retry_recovery", "final_response", "unknown"].includes(value))),
    final_response: new Set(["planning_reasoning"]),
    delegation: new Set(["file_reading", "skill_loading"]),
    verification: new Set(["file_reading", "repository_discovery", "shell_execution"]),
    build: new Set(["file_reading", "repository_discovery", "shell_execution"]),
    implementation: new Set(["file_reading", "repository_discovery", "skill_loading", "shell_execution", "version_control"]),
    external_research: new Set(["file_reading", "repository_discovery", "shell_execution"]),
    repository_discovery: new Set(["file_reading", "shell_execution"]),
    version_control: new Set(["file_reading", "shell_execution"]),
    shell_execution: new Set(["file_reading"]),
};

export function analyzeRoots(parsedRoots, config, pricing, source) {
    const roots = parsedRoots.map((parsed) => analyzeRoot(parsed, config, pricing.currency));
    const allSteps = roots.flatMap((root) => root.steps);
    const allTools = roots.flatMap((root) => root.tools);
    const allSpans = roots.flatMap((root) => root.spans);
    const mainAgentSpans = allSpans
        .filter((span) => roots.some((root) => root.root_session_id === span.root_session_id && span.session_id === root.root_session_id))
        .sort(compareSpanCost);
    const hashes = calculatePricingHashes(pricing);
    const totalCost = aggregateCost(allSteps, pricing.currency);
    const patternAnalysis = buildPatternGroups(roots, config.diagnostics?.patterns);
    const overlapDiagnostics = roots.flatMap((root) => root.delegation_overlap_diagnostics);
    const overlapAggregates = aggregateOverlapAcrossRoots(overlapDiagnostics);
    const warnings = [...new Set(roots.flatMap((root) => root.warnings))];
    const methodology = buildMethodologyManifest(config);

    return {
        schema_version: REPORT_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        objective: "Identify costly main-agent work suitable for cheaper subagents and evaluate the total economics of existing delegations without lowering result quality.",
        source,
        methodology: {
            exact: [
                "Provider-step token usage and locally priced API-equivalent cost when pricing coverage is complete.",
                "Root/child session tree, tool counts, tool status, output byte counts and validated task-to-child links.",
                "Direct and subtree cost of linked delegations.",
                "Observed activity signals derived deterministically from tools, operations, retry markers and step position.",
                "Versioned operation fingerprints and exact canonical pattern grouping.",
                "Exact hashed path/query/symbol/command overlap between child work and bounded parent follow-up windows.",
            ],
            contextual: [
                "Primary activity is a deterministic navigation label; all co-occurring activity signals remain visible.",
                "Canonical timing separates ordered follow-up from unordered and overlapping parent exposure; it is not causal attribution.",
                "Configured primary-to-fallback sequences are high-confidence workflow classification, not proof of the business reason for escalation.",
                "Delegation overlap is diagnostic evidence; repeated reads may be verification rather than redundant work.",
            ],
            agent_interpretation_required: [
                "The semantic purpose of a step or activity span.",
                "Whether an activity span is self-contained enough to delegate.",
                "Whether a fallback or rework was necessary for quality.",
                "Expected savings and quality risk of a proposed new subagent.",
            ],
            ...methodology,
        },
        pricing: {
            currency: pricing.currency,
            ...hashes,
        },
        summary: {
            root_sessions: roots.length,
            child_sessions: roots.reduce((sum, root) => sum + Math.max(0, root.sessions.length - 1), 0),
            model_steps: allSteps.length,
            tool_calls: allTools.length,
            delegations: roots.reduce((sum, root) => sum + root.delegations.length, 0),
            fallback_attempts: roots.reduce((sum, root) => sum + root.hybrid_attempts.length, 0),
            mixed_activity_steps: allSteps.filter((step) => step.activity_classification?.resolution === "mixed").length,
            unknown_activity_steps: allSteps.filter((step) => step.primary_activity === "unknown").length,
            recurring_pattern_groups: patternAnalysis.summary.recurring_groups,
            strong_repeated_work_signals: overlapAggregates.totals.strong_repeated_work_signal,
            possible_repeated_work_signals: overlapAggregates.totals.possible_repeated_work,
            total_usage: aggregateUsage(allSteps),
            total_cost: totalCost,
        },
        aggregates: {
            by_agent: aggregateRows(roots, allSteps, allTools, pricing.currency, (step) => step.agent_name ?? "unknown"),
            by_model: aggregateRows(roots, allSteps, allTools, pricing.currency, (step) => modelKey(step)),
            by_primary_activity: aggregatePrimaryActivityRows(roots, pricing.currency),
            by_activity_signal: aggregateActivitySignalRows(roots, pricing.currency),
            by_tool_operation: aggregateToolOperations(allTools, allSteps, pricing.currency),
            hybrid_families: aggregateHybridFamilies(roots, config, pricing.currency),
            delegation_overlap: overlapAggregates,
            delegation_economics: aggregateDelegationEconomics(roots, pricing.currency),
        },
        pattern_groups: patternAnalysis.groups,
        pattern_views: patternAnalysis.views,
        pattern_summary: patternAnalysis.summary,
        delegation_overlap_diagnostics: overlapDiagnostics,
        candidate_spans: mainAgentSpans,
        candidate_views: buildCandidateViews(mainAgentSpans),
        roots,
        warnings,
    };
}

export function analyzeRoot(parsed, config, currency) {
    if (parsed.length === 0)
    { throw new Error("Cannot analyze an empty root"); }
    const rootSession = parsed.find((item) => item.session.parent_id === null) ?? parsed[0];
    if (!rootSession)
    { throw new Error("Root session unavailable"); }

    const rootId = rootSession.session.id;
    const sessions = parsed.map((item) => item.session);
    const rawSteps = parsed.flatMap((item) => item.steps);
    const tools = parsed.flatMap((item) => item.tools);
    const classifiedSteps = classifySteps(sessions, rawSteps, tools, rootId);
    const steps = classifiedSteps.map(({ step, classification }) => ({
        ...step,
        primary_activity: classification.primary_activity,
        activities: classification.activities,
        activity_signals: classification.signals,
        activity_classification: classification.classification,
    }));
    const enrichedById = new Map(steps.map((step) => [step.id, step]));
    const activitiesWithEnrichedSteps = classifiedSteps.map((item) => ({
        ...item,
        step: enrichedById.get(item.step.id),
    }));
    const rawSpans = buildSpans(activitiesWithEnrichedSteps, currency);
    const spans = enrichSpansWithFingerprints(rawSpans, tools, rootId, config.diagnostics?.fingerprints);
    const delegations = buildDelegations(sessions, activitiesWithEnrichedSteps, tools, currency);
    const hybridAttempts = detectHybridAttempts(delegations, config, currency);
    const warnings = [];
    const missingPricing = steps.filter((step) => step.status === "complete" && step.cost_status !== "complete").length;
    const incomplete = steps.filter((step) => step.status === "incomplete").length;
    const unlinked = tools.filter((tool) => tool.tool_name === "task" && tool.task_link_status !== "valid").length;
    const mixed = steps.filter((step) => step.activity_classification.resolution === "mixed").length;
    const unknown = steps.filter((step) => step.primary_activity === "unknown").length;
    if (missingPricing > 0)
    { warnings.push(`missing_or_unsupported_pricing_steps:${missingPricing}`); }
    if (incomplete > 0)
    { warnings.push(`incomplete_steps:${incomplete}`); }
    if (unlinked > 0)
    { warnings.push(`unlinked_or_invalid_delegations:${unlinked}`); }
    if (mixed > 0)
    { warnings.push(`mixed_activity_steps:${mixed}`); }
    if (unknown > 0)
    { warnings.push(`unknown_activity_steps:${unknown}`); }

    const created = minimum(sessions.map((session) => session.created_at_ms));
    const completed = maximum([
        ...sessions.map((session) => session.updated_at_ms),
        ...steps.map((step) => step.completed_at_ms),
    ]);

    const root = {
        root_session_id: rootId,
        created_at_ms: created,
        updated_at_ms: completed,
        title: rootSession.session.title,
        semantic: rootSession.semantic,
        sessions,
        steps,
        tools,
        spans,
        delegations,
        hybrid_attempts: hybridAttempts,
        totals: {
            usage: aggregateUsage(steps),
            cost: aggregateCost(steps, currency),
            duration_ms: durationMs(created, completed),
        },
        warnings,
    };
    const overlap = diagnoseDelegationOverlap(root, config.diagnostics?.delegation_overlap);
    const timingByDelegation = new Map(overlap.diagnostics.map((item) => [item.delegation_id, item]));
    const canonicalDelegations = delegations.map((delegation) => {
        const diagnostic = timingByDelegation.get(delegation.id);
        return diagnostic
            ? {
                ...delegation,
                parent_followup: diagnostic.parent_followup,
                parent_exposure: diagnostic.parent_exposure,
            }
            : delegation;
    });
    return {
        ...root,
        delegations: canonicalDelegations,
        delegation_overlap_diagnostics: overlap.diagnostics,
        delegation_overlap_aggregates: overlap.aggregates,
    };
}

function classifySteps(sessions, steps, tools, rootId) {
    const sessionMap = new Map(sessions.map((session) => [session.id, session]));
    const byStep = new Map();
    for (const tool of tools) {
        if (!tool.step_id)
        { continue; }
        const list = byStep.get(tool.step_id) ?? [];
        list.push(tool);
        byStep.set(tool.step_id, list);
    }
    const lastCompletedRootStep = steps
        .filter((step) => step.session_id === rootId && step.status === "complete")
        .sort((a, b) => b.ordinal - a.ordinal)[0]?.id ?? null;

    return steps.map((step) => {
        const stepTools = byStep.get(step.id) ?? [];
        const classification = classifyStepActivity(
            step,
            stepTools,
            step.id === lastCompletedRootStep,
            sessionMap.get(step.session_id)?.parent_id === null,
        );
        return { step, tools: stepTools, classification };
    }).sort((a, b) => a.step.session_id.localeCompare(b.step.session_id) || a.step.ordinal - b.step.ordinal);
}

export function classifyStepActivity(step, tools, isLastRoot = false, isRoot = false) {
    const categories = new Set(tools.map((tool) => tool.tool_category));
    const operations = tools.map((tool) => tool.operation_category ?? "").filter(Boolean);
    const evidence = [];
    const active = new Set();

    if (step.retry_count > 0) {
        active.add("retry_recovery");
        evidence.push(`retry_count:${step.retry_count}`);
    }
    if (/error|retry/i.test(step.finish_reason ?? "")) {
        active.add("retry_recovery");
        evidence.push(`finish_reason:${step.finish_reason}`);
    }
    if (isRoot && isLastRoot && tools.length === 0) {
        active.add("final_response");
        evidence.push("root_last_step_without_tools");
    }
    if (categories.has("delegation")) {
        active.add("delegation");
        evidence.push("tool_category:delegation");
    }
    for (const operation of operations.filter(isVerificationOperation)) {
        active.add("verification");
        evidence.push(`operation:${operation}`);
    }
    for (const operation of operations.filter((value) => value.startsWith("build."))) {
        active.add("build");
        evidence.push(`operation:${operation}`);
    }
    if (categories.has("write")) {
        active.add("implementation");
        evidence.push("tool_category:write");
    }
    if (categories.has("web")) {
        active.add("external_research");
        evidence.push("tool_category:web");
    }
    if (categories.has("search") || operations.includes("repository.search")) {
        active.add("repository_discovery");
        evidence.push(categories.has("search") ? "tool_category:search" : "operation:repository.search");
    }
    if (categories.has("read")) {
        active.add("file_reading");
        evidence.push("tool_category:read");
    }
    if (categories.has("skill")) {
        active.add("skill_loading");
        evidence.push("tool_category:skill");
    }
    if (categories.has("version_control") || operations.some((value) => value.startsWith("version_control."))) {
        active.add("version_control");
        evidence.push(categories.has("version_control") ? "tool_category:version_control" : `operation:${operations.find((value) => value.startsWith("version_control."))}`);
    }
    if (categories.has("shell")) {
        active.add("shell_execution");
        evidence.push("tool_category:shell");
    }
    if (tools.length === 0 && (step.usage.reasoning_tokens ?? 0n) > 0n) {
        active.add("planning_reasoning");
        evidence.push("reasoning_tokens_without_tools");
    }

    if (active.size === 0) {
        active.add("unknown");
        evidence.push(tools.length === 0 ? "no_observable_activity_signal" : "unmapped_tool_categories");
    }

    const activities = ACTIVITY_ORDER.filter((activity) => active.has(activity));
    const primaryActivity = selectPrimaryActivity(active);
    const resolution = classifyResolution(primaryActivity, activities);
    const winningRule = primaryRule(primaryActivity);
    const signals = Object.fromEntries(ACTIVITY_ORDER.map((activity) => [activity, active.has(activity)]));

    return {
        primary_activity: primaryActivity,
        activities,
        signals,
        classification: {
            resolution,
            winning_rule: winningRule,
            evidence: [...new Set(evidence)],
        },
    };
}

function selectPrimaryActivity(active) {
    if (active.has("retry_recovery"))
    { return "retry_recovery"; }
    if (active.has("final_response"))
    { return "final_response"; }
    if (active.has("delegation") && !active.has("implementation") && !active.has("verification") && !active.has("build"))
    { return "delegation"; }
    const operationalPriority = [
        "verification",
        "build",
        "implementation",
        "external_research",
        "repository_discovery",
        "file_reading",
        "skill_loading",
        "version_control",
        "shell_execution",
        "planning_reasoning",
        "delegation",
        "unknown",
    ];
    return operationalPriority.find((activity) => active.has(activity)) ?? "unknown";
}

function primaryRule(activity) {
    return {
        retry_recovery: "retry_or_error_precedes_operational_signals",
        final_response: "last_root_step_without_tools",
        delegation: "delegation_without_write_verification_or_build",
        verification: "verification_precedes_build_and_write",
        build: "build_precedes_write",
        implementation: "write_signal",
        external_research: "web_signal",
        repository_discovery: "search_signal",
        file_reading: "read_signal",
        skill_loading: "skill_signal",
        version_control: "version_control_signal",
        shell_execution: "generic_shell_signal",
        planning_reasoning: "reasoning_without_tools",
        unknown: "no_mapped_signal",
    }[activity] ?? "no_mapped_signal";
}

function classifyResolution(primary, activities) {
    if (primary === "unknown")
    { return "unknown"; }
    if (primary === "planning_reasoning")
    { return "weak"; }
    if (activities.length === 1)
    { return "direct"; }
    const supportive = SUPPORTIVE_ACTIVITIES[primary] ?? new Set();
    return activities.every((activity) => activity === primary || supportive.has(activity)) ? "dominant" : "mixed";
}

function isVerificationOperation(value) {
    return value.startsWith("verification.");
}

function buildSpans(steps, currency) {
    const result = [];
    const bySession = groupBy(steps, (item) => item.step.session_id);
    for (const [sessionId, values] of bySession) {
        values.sort((a, b) => a.step.ordinal - b.step.ordinal);
        let group = [];
        const flush = () => {
            if (group.length === 0)
            { return; }
            const first = group[0];
            const last = group.at(-1);
            const groupSteps = group.map((item) => item.step);
            const groupTools = group.flatMap((item) => item.tools);
            const start = minimum(groupSteps.map((step) => step.started_at_ms));
            const end = maximum(groupSteps.map((step) => step.completed_at_ms));
            const activities = ACTIVITY_ORDER.filter((activity) => group.some((item) => item.classification.signals[activity]));
            const signalCounts = Object.fromEntries(ACTIVITY_ORDER.map((activity) => [
                activity,
                group.filter((item) => item.classification.signals[activity]).length,
            ]));
            const resolutionCounts = countValues(group.map((item) => item.classification.classification.resolution));
            result.push({
                id: `${sessionId}:span:${result.filter((span) => span.session_id === sessionId).length}`,
                root_session_id: first.step.root_session_id,
                session_id: sessionId,
                agent_name: first.step.agent_name,
                start_step_ordinal: first.step.ordinal,
                end_step_ordinal: last.step.ordinal,
                primary_activity: first.classification.primary_activity,
                activities,
                activity_signal_counts: signalCounts,
                classification_resolution_counts: resolutionCounts,
                mixed_step_count: resolutionCounts.mixed ?? 0,
                classification_evidence: [...new Set(group.flatMap((item) => item.classification.classification.evidence))].slice(0, 24),
                step_count: groupSteps.length,
                tool_calls: groupTools.length,
                tool_errors: groupTools.filter((tool) => tool.status === "error").length,
                output_bytes: groupTools.reduce((sum, tool) => sum + (tool.output_bytes ?? 0n), 0n),
                duration_ms: durationMs(start, end),
                usage: aggregateUsage(groupSteps),
                cost: aggregateCost(groupSteps, currency),
                tool_signature: [...new Set(groupTools.map((tool) => tool.operation_category ?? tool.tool_name))].sort(),
                semantic_hints: [...new Set(groupTools.flatMap((tool) => tool.semantic_hint ? [tool.semantic_hint] : []))].slice(0, 12),
            });
            group = [];
        };
        for (const value of values) {
            if (group.length === 0 || group[0]?.classification.primary_activity === value.classification.primary_activity)
            { group.push(value); }
            else {
                flush();
                group.push(value);
            }
        }
        flush();
    }
    return result.sort((a, b) => a.root_session_id.localeCompare(b.root_session_id)
        || a.session_id.localeCompare(b.session_id)
        || a.start_step_ordinal - b.start_step_ordinal);
}

function buildDelegations(sessions, stepsWithActivity, tools, currency) {
    const steps = stepsWithActivity.map((item) => item.step);
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const childrenByParent = groupBy(sessions.filter((session) => session.parent_id), (session) => session.parent_id);
    const toolsBySession = groupBy(tools, (tool) => tool.session_id);
    const stepsBySession = groupBy(steps, (step) => step.session_id);
    function subtreeSessionIds(sessionId) {
        const result = [];
        const queue = [sessionId];
        while (queue.length > 0) {
            const current = queue.shift();
            result.push(current);
            for (const child of childrenByParent.get(current) ?? [])
            { queue.push(child.id); }
        }
        return result;
    }
    return tools.filter((tool) => tool.tool_name === "task").map((tool) => {
        const parentStep = tool.step_id ? stepById.get(tool.step_id) ?? null : null;
        const childId = tool.task_link_status === "valid" ? tool.child_session_id : null;
        const directSteps = childId ? stepsBySession.get(childId) ?? [] : [];
        const directTools = childId ? toolsBySession.get(childId) ?? [] : [];
        const subtreeIds = childId ? subtreeSessionIds(childId) : [];
        const subtreeSteps = steps.filter((step) => subtreeIds.includes(step.session_id));
        const subtreeTools = tools.filter((item) => subtreeIds.includes(item.session_id));
        return {
            id: tool.id,
            root_session_id: tool.root_session_id,
            parent_session_id: tool.session_id,
            parent_step_ordinal: tool.step_ordinal,
            subagent_name: tool.subagent_name,
            child_session_id: childId,
            link_status: tool.task_link_status,
            background: tool.background,
            prompt_hint: tool.semantic_hint,
            parent_delegating_step_cost: aggregateCost(parentStep ? [parentStep] : [], currency),
            child_direct_cost: aggregateCost(directSteps, currency),
            child_subtree_cost: aggregateCost(subtreeSteps, currency),
            child_direct_steps: directSteps.length,
            child_subtree_steps: subtreeSteps.length,
            child_direct_tools: directTools.length,
            child_subtree_tools: subtreeTools.length,
            child_output_bytes: tool.output_bytes,
            parent_followup: null,
            parent_exposure: null,
        };
    }).sort((a, b) => a.parent_session_id.localeCompare(b.parent_session_id)
        || (a.parent_step_ordinal ?? -1) - (b.parent_step_ordinal ?? -1));
}

export function detectHybridAttempts(delegations, config, currency) {
    const result = [];
    const byParent = groupBy(delegations.filter((item) => item.link_status === "valid"), (item) => item.parent_session_id);
    for (const [parentId, values] of byParent) {
        values.sort((a, b) => (a.parent_step_ordinal ?? -1) - (b.parent_step_ordinal ?? -1));
        for (const family of config.hybrid_families) {
            for (let index = 1; index < values.length; index += 1) {
                const primary = values[index - 1];
                const delegation = values[index];
                if (!family.primary_agents.includes(primary.subagent_name ?? "")
                    || !family.fallback_agents.includes(delegation.subagent_name ?? ""))
                { continue; }
                result.push({
                    id: `${primary.id}->${delegation.id}`,
                    root_session_id: delegation.root_session_id,
                    parent_session_id: parentId,
                    family: family.name,
                    primary_delegation_id: primary.id,
                    fallback_delegation_id: delegation.id,
                    method: "configured_sequence",
                    confidence: "high",
                    primary_cost: primary.child_subtree_cost,
                    fallback_cost: delegation.child_subtree_cost,
                    combined_subtree_cost: aggregateCostRecords([primary.child_subtree_cost, delegation.child_subtree_cost], currency),
                });
            }
        }
    }
    return result;
}

function aggregateRows(roots, steps, tools, currency, key) {
    const groups = groupBy(steps, key);
    return [...groups.entries()].map(([groupKey, groupSteps]) => {
        const sessions = new Set(groupSteps.map((step) => step.session_id));
        const stepIds = new Set(groupSteps.map((step) => step.id));
        const groupTools = tools.filter((tool) => tool.step_id && stepIds.has(tool.step_id));
        return {
            key: groupKey,
            sessions: sessions.size,
            steps: groupSteps.length,
            tools: groupTools.length,
            errors: groupTools.filter((tool) => tool.status === "error").length,
            usage: aggregateUsage(groupSteps),
            cost: aggregateCost(groupSteps, currency),
        };
    }).sort((a, b) => compareBigIntDesc(a.cost.value_nano ?? a.cost.priced_value_nano, b.cost.value_nano ?? b.cost.priced_value_nano));
}

function aggregatePrimaryActivityRows(roots, currency) {
    const steps = roots.flatMap((root) => root.steps);
    const tools = roots.flatMap((root) => root.tools);
    return aggregateRows(roots, steps, tools, currency, (step) => step.primary_activity ?? "unknown");
}

function aggregateActivitySignalRows(roots, currency) {
    const steps = roots.flatMap((root) => root.steps);
    const tools = roots.flatMap((root) => root.tools);
    const rows = [];
    for (const activity of ACTIVITY_ORDER) {
        const groupSteps = steps.filter((step) => step.activity_signals?.[activity]);
        if (groupSteps.length === 0)
        { continue; }
        const ids = new Set(groupSteps.map((step) => step.id));
        const groupTools = tools.filter((tool) => tool.step_id && ids.has(tool.step_id));
        rows.push({
            key: activity,
            aggregation: "non_additive",
            sessions: new Set(groupSteps.map((step) => step.session_id)).size,
            steps: groupSteps.length,
            tools: groupTools.length,
            errors: groupTools.filter((tool) => tool.status === "error").length,
            usage: aggregateUsage(groupSteps),
            involved_step_cost: aggregateCost(groupSteps, currency),
        });
    }
    return rows.sort((a, b) => compareBigIntDesc(
        a.involved_step_cost.value_nano ?? a.involved_step_cost.priced_value_nano,
        b.involved_step_cost.value_nano ?? b.involved_step_cost.priced_value_nano,
    ));
}

function aggregateToolOperations(tools, steps, currency) {
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const groups = groupBy(tools, (tool) => tool.operation_category ?? tool.tool_name);
    return [...groups.entries()].map(([key, group]) => {
        const involved = [...new Set(group.flatMap((tool) => tool.step_id ? [tool.step_id] : []))]
            .flatMap((id) => stepById.get(id) ? [stepById.get(id)] : []);
        return {
            key,
            calls: group.length,
            errors: group.filter((tool) => tool.status === "error").length,
            output_bytes: group.reduce((sum, tool) => sum + (tool.output_bytes ?? 0n), 0n),
            involved_step_cost: aggregateCost(involved, currency),
        };
    }).sort((a, b) => compareBigIntDesc(a.involved_step_cost.value_nano ?? a.involved_step_cost.priced_value_nano, b.involved_step_cost.value_nano ?? b.involved_step_cost.priced_value_nano));
}

function aggregateHybridFamilies(roots, config, currency) {
    const delegations = roots.flatMap((root) => root.delegations).filter((item) => item.link_status === "valid");
    const attempts = roots.flatMap((root) => root.hybrid_attempts);
    return config.hybrid_families.map((family) => {
        const primaries = delegations.filter((item) => family.primary_agents.includes(item.subagent_name ?? ""));
        const familyAttempts = attempts.filter((item) => item.family === family.name);
        const fallbacks = familyAttempts.map((attempt) => delegations.find((item) => item.id === attempt.fallback_delegation_id)).filter(Boolean);
        return {
            family: family.name,
            primary_attempts: primaries.length,
            fallback_attempts: familyAttempts.length,
            fallback_rate: primaries.length === 0 ? null : familyAttempts.length / primaries.length,
            primary_cost: aggregateCostRecords(primaries.map((item) => item.child_subtree_cost), currency),
            fallback_cost: aggregateCostRecords(fallbacks.map((item) => item.child_subtree_cost), currency),
            fallback_additional_cost: aggregateCostRecords(fallbacks.map((item) => item.child_subtree_cost), currency),
        };
    });
}

export function aggregateDelegationEconomics(roots, currency) {
    const delegations = roots.flatMap((root) => root.delegations);
    const valid = delegations.filter((item) => item.link_status === "valid" && item.child_session_id);
    const attempts = roots.flatMap((root) => root.hybrid_attempts);
    const fallbackIds = new Set(attempts.map((attempt) => attempt.fallback_delegation_id));
    const bySubagent = groupBy(valid, (item) => item.subagent_name ?? "unknown");
    const summarize = (items) => ({
        delegations: items.length,
        fallback_attempts: items.filter((item) => fallbackIds.has(item.id)).length,
        delegating_step_cost: aggregateCostRecords(items.map((item) => item.parent_delegating_step_cost), currency),
        child_direct_cost: aggregateCostRecords(items.map((item) => item.child_direct_cost), currency),
        child_subtree_cost: aggregateCostRecords(items.map((item) => item.child_subtree_cost), currency),
        child_output_bytes: items.reduce((sum, item) => sum + (item.child_output_bytes ?? 0n), 0n),
        parent_followup_cost: aggregateCostRecords(items.map((item) => item.parent_followup.cost), currency),
        parent_exposure_cost: aggregateCostRecords(items.map((item) => item.parent_exposure?.total_cost).filter(Boolean), currency),
        fallback_additional_cost: aggregateCostRecords(items.filter((item) => fallbackIds.has(item.id)).map((item) => item.child_subtree_cost), currency),
    });
    const totals = summarize(valid);
    return {
        totals: {
            ...totals,
            total_delegations: delegations.length,
            linked_delegations: valid.length,
            unlinked_delegations: delegations.length - valid.length,
            fallback_attempts: attempts.length,
        },
        by_subagent: [...bySubagent.entries()].map(([subagent, items]) => ({subagent, ...summarize(items)}))
            .sort((a, b) => b.delegations - a.delegations || a.subagent.localeCompare(b.subagent)),
        fallback_attempts: attempts.map((attempt) => ({
            id: attempt.id,
            family: attempt.family,
            primary_delegation_id: attempt.primary_delegation_id,
            fallback_delegation_id: attempt.fallback_delegation_id,
            primary_cost: attempt.primary_cost,
            fallback_cost: attempt.fallback_cost,
            additional_cost: attempt.fallback_cost,
            combined_subtree_cost: attempt.combined_subtree_cost,
        })),
    };
}

function buildCandidateViews(spans) {
    return {
        all_main_agent_spans: spans.map((span) => span.id),
        low_risk_read_only: spans.filter((span) => span.operation_fingerprint?.mutation_mode === "read_only" && [
            "repository_discovery",
            "file_reading",
            "external_research",
            "verification",
            "build",
            "skill_loading",
        ].includes(span.primary_activity)).map((span) => span.id),
        write_involving: spans.filter((span) => (span.activity_signal_counts.implementation ?? 0) > 0).map((span) => span.id),
        mixed_or_ambiguous: spans.filter((span) => span.mixed_step_count > 0
            || (span.classification_resolution_counts.weak ?? 0) > 0
            || (span.classification_resolution_counts.unknown ?? 0) > 0).map((span) => span.id),
        retry_and_rework: spans.filter((span) => (span.activity_signal_counts.retry_recovery ?? 0) > 0).map((span) => span.id),
    };
}

function aggregateOverlapAcrossRoots(diagnostics) {
    const valid = diagnostics.filter((item) => item.link_status === "valid");
    const bySubagent = groupBy(valid, (item) => item.subagent_name ?? "unknown");
    const count = (values) => {
        const result = {
            no_overlap_observed_in_window: 0,
            structural_overlap_only: 0,
            possible_repeated_work: 0,
            strong_repeated_work_signal: 0,
            mixed_followup: 0,
            insufficient_evidence: 0,
        };
        for (const item of values)
        { result[item.diagnostic] = (result[item.diagnostic] ?? 0) + 1; }
        return result;
    };
    return {
        totals: { delegations: valid.length, ...count(valid) },
        by_subagent: [...bySubagent.entries()].map(([subagent, values]) => ({
            subagent,
            delegations: values.length,
            ...count(values),
        })).sort((a, b) => b.delegations - a.delegations || a.subagent.localeCompare(b.subagent)),
    };
}

export function aggregateUsage(steps) {
    if (steps.length === 0)
    { return { ...ZERO_USAGE }; }
    return {
        input_tokens: sumUsageField(steps, "input_tokens"),
        output_tokens: sumUsageField(steps, "output_tokens"),
        reasoning_tokens: sumUsageField(steps, "reasoning_tokens", true),
        cache_read_tokens: sumUsageField(steps, "cache_read_tokens"),
        cache_write_tokens: sumUsageField(steps, "cache_write_tokens"),
    };
}

function sumUsageField(steps, key, optional = false) {
    const eligible = steps.filter(isObservedStep);
    if (eligible.length === 0)
    { return 0n; }
    if (!optional && eligible.some((step) => step.usage[key] === null))
    { return null; }
    return eligible.reduce((sum, step) => sum + (step.usage[key] ?? 0n), 0n);
}

function modelKey(step) {
    return [step.provider_id, step.reported_model_id, step.model_variant].filter(Boolean).join("/") || "unknown";
}

function minimum(values) {
    const filtered = values.filter((value) => value !== null);
    return filtered.length > 0 ? filtered.reduce((min, value) => value < min ? value : min) : null;
}

function maximum(values) {
    const filtered = values.filter((value) => value !== null);
    return filtered.length > 0 ? filtered.reduce((max, value) => value > max ? value : max) : null;
}

function groupBy(values, key) {
    const result = new Map();
    for (const value of values) {
        const groupKey = key(value);
        const group = result.get(groupKey) ?? [];
        group.push(value);
        result.set(groupKey, group);
    }
    return result;
}

function countValues(values) {
    const result = {};
    for (const value of values)
    { result[value] = (result[value] ?? 0) + 1; }
    return result;
}

function compareSpanCost(a, b) {
    return compareBigIntDesc(a.cost.value_nano ?? a.cost.priced_value_nano, b.cost.value_nano ?? b.cost.priced_value_nano);
}

function compareBigIntDesc(left, right) {
    return left === right ? 0 : left > right ? -1 : 1;
}
