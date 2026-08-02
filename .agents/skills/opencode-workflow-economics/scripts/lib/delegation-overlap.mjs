import { aggregateResourceKeys, operationName } from "./fingerprints.mjs";
import { aggregateCost } from "./costs.mjs";

export const DELEGATION_OVERLAP_VERSION = "deterministic_evidence_rules_v4_no_structural_classifier";

const DEFAULTS = {
    max_parent_steps: 8,
    max_parent_spans: 4,
    max_elapsed_ms: 300_000,
    structural_jaccard_threshold: 0.6,
    structural_sequence_threshold: 0.5,
};

export function diagnoseDelegationOverlap(root, config = {}, options = {}) {
    const settings = {
        ...DEFAULTS,
        ...(config ?? {}),
        useStructuralSimilarity: options.useStructuralSimilarity ?? false,
    };
    const childrenByParent = groupBy(root.sessions.filter((session) => session.parent_id), (session) => session.parent_id);
    const stepsBySession = groupBy(root.steps, (step) => step.session_id);
    const toolsBySession = groupBy(root.tools, (tool) => tool.session_id);
    const spansBySession = groupBy(root.spans, (span) => span.session_id);
    const diagnostics = root.delegations.map((delegation) => {
        if (delegation.link_status !== "valid" || !delegation.child_session_id) {
            return unavailableDiagnostic(delegation, "invalid_or_unlinked_delegation");
        }
        const subtreeIds = collectSubtreeIds(delegation.child_session_id, childrenByParent);
        const childTools = subtreeIds.flatMap((sessionId) => toolsBySession.get(sessionId) ?? []);
        const childSteps = subtreeIds.flatMap((sessionId) => stepsBySession.get(sessionId) ?? []);
        const childSpans = root.spans.filter((span) => subtreeIds.includes(span.session_id));
        const followup = parentFollowupWindow(delegation, stepsBySession, toolsBySession, spansBySession, childSteps, settings);
        return compareWork(delegation, childTools, childSteps, childSpans, followup, root.totals.cost.currency, settings);
    });

    return {
        diagnostics,
        aggregates: aggregateDiagnostics(diagnostics),
    };
}

function parentFollowupWindow(delegation, stepsBySession, toolsBySession, spansBySession, childSteps, settings) {
    const parentSteps = (stepsBySession.get(delegation.parent_session_id) ?? [])
        .filter((step) => step.ordinal > (delegation.parent_step_ordinal ?? -1))
        .sort((a, b) => a.ordinal - b.ordinal);
    const parentTools = (toolsBySession.get(delegation.parent_session_id) ?? []).slice().sort(compareToolOrder);
    const sessionSpans = (spansBySession.get(delegation.parent_session_id) ?? []).slice().sort((a, b) => a.start_step_ordinal - b.start_step_ordinal);
    const childCompleted = maximum(childSteps.map((step) => step.completed_at_ms));
    const selectedSteps = [];
    const orderedSteps = [];
    const unorderedSteps = [];
    const overlappingSteps = [];
    const selectedSpanIds = new Set();
    const selectedSpans = new Map();
    let stopReason = "end_of_session";
    let skippedBeforeChildCompletion = 0;
    let stepsWithUnknownTiming = 0;

    for (const step of parentSteps) {
        if (selectedSteps.length >= settings.max_parent_steps) {
            stopReason = "step_limit";
            break;
        }
        if (step.primary_activity === "final_response") {
            stopReason = "final_response";
            break;
        }
        const stepTools = parentTools.filter((tool) => tool.step_ordinal === step.ordinal);
        const timing = timingBucket(step, childCompleted);
        if (timing === "before_child_completion") {
            skippedBeforeChildCompletion += 1;
            continue;
        }
        if (timing === "unordered")
        { stepsWithUnknownTiming += 1; }
        if (stepTools.some((tool) => tool.tool_category === "delegation")) {
            stopReason = "next_delegation";
            break;
        }
        if (timing === "ordered_after_child" && step.started_at_ms - childCompleted > BigInt(settings.max_elapsed_ms)) {
            stopReason = "elapsed_limit";
            break;
        }
        const span = sessionSpans.find((candidate) => step.ordinal >= candidate.start_step_ordinal && step.ordinal <= candidate.end_step_ordinal);
        if (span && !selectedSpanIds.has(span.id) && selectedSpanIds.size >= settings.max_parent_spans) {
            stopReason = "span_limit";
            break;
        }
        if (span) {
            selectedSpanIds.add(span.id);
            selectedSpans.set(span.id, span);
        }
        selectedSteps.push(step);
        if (timing === "ordered_after_child") { orderedSteps.push(step); }
        else if (timing === "overlapping") { overlappingSteps.push(step); }
        else { unorderedSteps.push(step); }
    }

    const stepOrdinals = new Set(selectedSteps.map((step) => step.ordinal));
    const selectedTools = parentTools.filter((tool) => tool.step_ordinal !== null && stepOrdinals.has(tool.step_ordinal));
    const toolsFor = (steps) => {
        const ordinals = new Set(steps.map((step) => step.ordinal));
        return selectedTools.filter((tool) => ordinals.has(tool.step_ordinal));
    };
    return {
        steps: selectedSteps,
        tools: selectedTools,
        ordered_steps: orderedSteps,
        unordered_steps: unorderedSteps,
        overlapping_steps: overlappingSteps,
        ordered_tools: toolsFor(orderedSteps),
        unordered_tools: toolsFor(unorderedSteps),
        overlapping_tools: toolsFor(overlappingSteps),
        span_ids: [...selectedSpanIds],
        spans: [...selectedSpans.values()],
        stop_reason: stopReason,
        child_completed_at_ms: childCompleted,
        skipped_steps_before_child_completion: skippedBeforeChildCompletion,
        steps_with_unknown_timing: stepsWithUnknownTiming,
    };
}

function timingBucket(step, childCompleted) {
    if (childCompleted === null || step.started_at_ms === null)
    { return "unordered"; }
    if (step.started_at_ms >= childCompleted)
    { return "ordered_after_child"; }
    if (step.completed_at_ms === null)
    { return "unordered"; }
    if (step.completed_at_ms !== null && step.completed_at_ms > childCompleted)
    { return "overlapping"; }
    return "before_child_completion";
}

function compareWork(delegation, childTools, childSteps, childSpans, followup, currency, settings) {
    if (childTools.length === 0 || followup.steps.length === 0) {
        return {
            ...baseDiagnostic(delegation),
            diagnostic: "insufficient_evidence",
            evidence: emptyEvidence(childTools.length, followup),
            child: summarizeSide(childSteps, childTools, childSpans, currency),
            parent_followup: summarizeFollowup(followup, currency),
            parent_exposure: summarizeExposure(followup, currency),
            limitations: [childTools.length === 0 ? "Child subtree has no observed tool calls." : "No parent follow-up steps were available in the configured window."],
        };
    }

    const childResources = aggregateResourceKeys(childTools);
    const parentResources = aggregateResourceKeys(followup.tools);
    const orderedResources = aggregateResourceKeys(followup.ordered_tools);
    const unorderedResources = aggregateResourceKeys(followup.unordered_tools);
    const overlappingResources = aggregateResourceKeys(followup.overlapping_tools);
    const shared = intersectResourceKeys(childResources, parentResources);
    const orderedShared = intersectResourceKeys(childResources, orderedResources);
    const unorderedShared = intersectResourceKeys(childResources, unorderedResources);
    const overlappingShared = intersectResourceKeys(childResources, overlappingResources);
    const childOperations = childTools.map(operationName);
    const parentOperations = followup.tools.map(operationName);
    const operationJaccard = jaccard(new Set(childOperations), new Set(parentOperations));
    const sequenceSimilarity = lcsRatio(childOperations, parentOperations);
    const beforeWrite = toolsBeforeFirstWrite(followup.ordered_tools);
    const afterWrite = toolsAfterFirstWrite(followup.ordered_tools);
    const preWriteResources = aggregateResourceKeys(beforeWrite);
    const postWriteResources = aggregateResourceKeys(afterWrite);
    const sharedBeforeWrite = intersectResourceKeys(childResources, preWriteResources);
    const sharedAfterWrite = intersectResourceKeys(childResources, postWriteResources);
    const exactTotal = countShared(shared);
    const orderedExact = countShared(orderedShared);
    const unorderedExact = countShared(unorderedShared);
    const overlappingExact = countShared(overlappingShared);
    const childFamilies = [...new Set(childSpans.map((span) => span.operation_fingerprint?.structural_family_id).filter(Boolean))];
    const parentFamilies = [...new Set(followup.spans.map((span) => span.operation_fingerprint?.structural_family_id).filter(Boolean))];
    const sharedStructuralFamilies = intersection(childFamilies, parentFamilies);
    const exactBeforeWrite = countShared(sharedBeforeWrite);
    const parentHasWrite = followup.tools.some((tool) => tool.tool_category === "write");
    const parentHasVerification = followup.tools.some((tool) => (tool.operation_category ?? "").startsWith("verification."));
    const semanticBeforeWrite = semanticResourceKeys(sharedBeforeWrite);
    const semanticExactBeforeWrite = countShared(semanticBeforeWrite);
    const commandExactBeforeWrite = sharedBeforeWrite.commands.length;
    const exactAfterWrite = countShared(sharedAfterWrite);
    const strongExact = semanticBeforeWrite.paths.length >= 3
        || semanticBeforeWrite.queries.length >= 2
        || (semanticBeforeWrite.queries.length >= 1 && semanticBeforeWrite.paths.length >= 1)
        || (semanticBeforeWrite.symbols.length >= 1 && semanticBeforeWrite.paths.length >= 1);
    const sharedOperationTypes = intersection([...new Set(childOperations)], [...new Set(parentOperations)]).slice(0, 8);

    let diagnostic;
    if (orderedExact === 0 && exactTotal > 0) {
        diagnostic = "insufficient_evidence";
    }
    else if (strongExact) {
        diagnostic = "strong_repeated_work_signal";
    }
    else if (exactAfterWrite > 0) {
        diagnostic = "mixed_followup";
    }
    else if (orderedExact > 0 && exactBeforeWrite > 0) {
        diagnostic = "possible_repeated_work";
    }
    else if (orderedExact > 0 && (parentHasWrite || parentHasVerification)) {
        diagnostic = "mixed_followup";
    }
    else if (settings.useStructuralSimilarity && (sharedStructuralFamilies.length > 0
        || (operationJaccard >= settings.structural_jaccard_threshold && sequenceSimilarity >= settings.structural_sequence_threshold))) {
        diagnostic = "structural_overlap_only";
    }
    else {
        diagnostic = "no_overlap_observed_in_window";
    }

    const limitations = ["Repeated reads may be deliberate verification rather than redundant discovery.", "Raw file contents and raw tool outputs were not compared."];
    limitations.push("Command matches are a weaker signal and never contribute to strong_repeated_work_signal.");
    if (exactAfterWrite > 0)
    { limitations.push("Exact matches after the parent's first write are reported as mixed_followup and do not strengthen strong_repeated_work_signal."); }
    if (exactTotal === 0)
    { limitations.push("No exact path, query, symbol or command key overlap was observed."); }
    if (sharedOperationTypes.length > 0 || sharedStructuralFamilies.length > 0 || operationJaccard !== null || sequenceSimilarity !== null)
    { limitations.push("Structural similarity and shared operation types are descriptive context only; they do not raise repeated-work labels."); }
    if (followup.child_completed_at_ms === null)
    { limitations.push("Child subtree completion timestamp was unavailable, so parent/child ordering could not be confirmed."); }
    if (followup.steps_with_unknown_timing > 0)
    { limitations.push("Some parent steps lacked start timestamps, so their position relative to child completion could not be confirmed."); }
    if (followup.steps_with_unknown_timing > 0 || unorderedExact > 0 || overlappingExact > 0)
    { limitations.push("Unordered and overlapping evidence is reported separately and does not affect repeated-work labels or follow-up cost."); }

    return {
        ...baseDiagnostic(delegation),
        diagnostic,
        evidence: {
            same_path_count: shared.paths.length,
            same_query_count: shared.queries.length,
            same_symbol_count: shared.symbols.length,
            same_command_count: shared.commands.length,
            exact_resource_matches: exactTotal,
            exact_resource_matches_before_first_write: exactBeforeWrite,
            semantic_exact_matches_before_first_write: semanticExactBeforeWrite,
            pre_write_path_count: sharedBeforeWrite.paths.length,
            pre_write_query_count: sharedBeforeWrite.queries.length,
            pre_write_symbol_count: sharedBeforeWrite.symbols.length,
            command_exact_matches_before_first_write: commandExactBeforeWrite,
            exact_resource_matches_after_first_write: exactAfterWrite,
            ordered_exact_matches: orderedExact,
            unordered_exact_matches: unorderedExact,
            overlapping_exact_matches: overlappingExact,
            shared_operation_types: sharedOperationTypes,
            shared_structural_family_ids: sharedStructuralFamilies.slice(0, 8),
            operation_jaccard: operationJaccard,
            ordered_sequence_similarity: sequenceSimilarity,
            parent_search_or_read_before_first_write: beforeWrite.some((tool) => tool.tool_category === "search" || tool.tool_category === "read"),
            parent_steps_examined: followup.steps.length,
            parent_spans_examined: followup.span_ids.length,
            window_stop_reason: followup.stop_reason,
            child_completed_at_ms: followup.child_completed_at_ms,
            skipped_steps_before_child_completion: followup.skipped_steps_before_child_completion,
            steps_with_unknown_timing: followup.steps_with_unknown_timing,
        },
        child: summarizeSide(childSteps, childTools, childSpans, currency),
        parent_followup: summarizeFollowup(followup, currency),
        parent_exposure: summarizeExposure(followup, currency),
        limitations,
    };
}

function aggregateDiagnostics(diagnostics) {
    const valid = diagnostics.filter((item) => item.link_status === "valid");
    const bySubagent = groupBy(valid, (item) => item.subagent_name ?? "unknown");
    return {
        totals: countDiagnostics(valid),
        by_subagent: [...bySubagent.entries()].map(([subagent, values]) => ({
            subagent,
            delegations: values.length,
            ...countDiagnostics(values),
        })).sort((a, b) => b.delegations - a.delegations || a.subagent.localeCompare(b.subagent)),
    };
}

function countDiagnostics(values) {
    const counts = {};
    for (const item of values)
    { counts[item.diagnostic] = (counts[item.diagnostic] ?? 0) + 1; }
    return {
        no_overlap_observed_in_window: counts.no_overlap_observed_in_window ?? 0,
        structural_overlap_only: counts.structural_overlap_only ?? 0,
        possible_repeated_work: counts.possible_repeated_work ?? 0,
        strong_repeated_work_signal: counts.strong_repeated_work_signal ?? 0,
        mixed_followup: counts.mixed_followup ?? 0,
        insufficient_evidence: counts.insufficient_evidence ?? 0,
    };
}

function summarizeSide(steps, tools, spans, currency) {
    return {
        sessions: new Set(steps.map((step) => step.session_id)).size,
        steps: steps.length,
        tools: tools.length,
        span_ids: spans.map((span) => span.id),
        structural_family_ids: [...new Set(spans.map((span) => span.operation_fingerprint?.structural_family_id).filter(Boolean))],
        operations: countValues(tools.map(operationName)),
        resource_key_counts: countResourceKeys(aggregateResourceKeys(tools)),
        cost: aggregateCost(steps, currency),
    };
}

function summarizeFollowup(followup, currency) {
    const steps = followup.ordered_steps;
    const tools = followup.ordered_tools;
    return {
        timing: "ordered_after_child",
        steps: steps.length,
        spans: followup.span_ids.length,
        span_ids: followup.span_ids,
        structural_family_ids: [...new Set(followup.spans.map((span) => span.operation_fingerprint?.structural_family_id).filter(Boolean))],
        primary_activities: steps.map((step) => step.primary_activity),
        activity_sets: steps.map((step) => step.activities ?? ["unknown"]),
        classification_resolutions: steps.map((step) => step.activity_classification?.resolution ?? "unknown"),
        tools: tools.length,
        operations: countValues(tools.map(operationName)),
        resource_key_counts: countResourceKeys(aggregateResourceKeys(tools)),
        cost: aggregateCost(steps, currency),
        window_stop_reason: followup.stop_reason,
        child_completed_at_ms: followup.child_completed_at_ms,
        skipped_steps_before_child_completion: followup.skipped_steps_before_child_completion,
        steps_with_unknown_timing: followup.steps_with_unknown_timing,
    };
}

function summarizeExposure(followup, currency) {
    const unordered = summarizeTimingBucket(followup.unordered_steps, followup.unordered_tools, currency, "unordered");
    const overlapping = summarizeTimingBucket(followup.overlapping_steps, followup.overlapping_tools, currency, "overlapping");
    return {
        timing: "unassigned_exposure",
        unordered,
        overlapping,
        total_cost: aggregateCost([...followup.unordered_steps, ...followup.overlapping_steps], currency),
    };
}

function summarizeTimingBucket(steps, tools, currency, timing) {
    return {
        timing,
        steps: steps.length,
        tools: tools.length,
        primary_activities: steps.map((step) => step.primary_activity),
        operations: countValues(tools.map(operationName)),
        resource_key_counts: countResourceKeys(aggregateResourceKeys(tools)),
        cost: aggregateCost(steps, currency),
    };
}

function baseDiagnostic(delegation) {
    return {
        delegation_id: delegation.id,
        root_session_id: delegation.root_session_id,
        parent_session_id: delegation.parent_session_id,
        child_session_id: delegation.child_session_id,
        subagent_name: delegation.subagent_name,
        link_status: delegation.link_status,
        method: DELEGATION_OVERLAP_VERSION,
    };
}

function unavailableDiagnostic(delegation, reason) {
    return {
        ...baseDiagnostic(delegation),
        diagnostic: "insufficient_evidence",
        evidence: emptyEvidence(0, { steps: [], span_ids: [], spans: [], stop_reason: reason }),
        child: null,
        parent_followup: null,
        parent_exposure: null,
        limitations: [reason],
    };
}

function emptyEvidence(childTools, followup) {
    return {
        same_path_count: 0,
        same_query_count: 0,
        same_symbol_count: 0,
        same_command_count: 0,
        exact_resource_matches: 0,
        exact_resource_matches_before_first_write: 0,
        semantic_exact_matches_before_first_write: 0,
        pre_write_path_count: 0,
        pre_write_query_count: 0,
        pre_write_symbol_count: 0,
        command_exact_matches_before_first_write: 0,
        exact_resource_matches_after_first_write: 0,
        ordered_exact_matches: 0,
        unordered_exact_matches: 0,
        overlapping_exact_matches: 0,
        shared_operation_types: [],
        shared_structural_family_ids: [],
        operation_jaccard: null,
        ordered_sequence_similarity: null,
        parent_search_or_read_before_first_write: false,
        parent_steps_examined: followup.steps.length,
        parent_spans_examined: followup.span_ids.length,
        window_stop_reason: followup.stop_reason,
        child_completed_at_ms: followup.child_completed_at_ms ?? null,
        skipped_steps_before_child_completion: followup.skipped_steps_before_child_completion ?? 0,
        steps_with_unknown_timing: followup.steps_with_unknown_timing ?? 0,
        child_tool_calls: childTools,
    };
}

function collectSubtreeIds(rootId, childrenByParent) {
    const result = [];
    const queue = [rootId];
    while (queue.length > 0) {
        const current = queue.shift();
        result.push(current);
        for (const child of childrenByParent.get(current) ?? [])
        { queue.push(child.id); }
    }
    return result;
}

function intersectResourceKeys(left, right) {
    return {
        paths: intersection(left.paths, right.paths),
        queries: intersection(left.queries, right.queries),
        symbols: intersection(left.symbols, right.symbols),
        commands: intersection(left.commands, right.commands),
    };
}

function countShared(shared) {
    return Object.values(shared).reduce((sum, values) => sum + values.length, 0);
}

function countResourceKeys(keys) {
    return Object.fromEntries(Object.entries(keys).map(([key, values]) => [key, values.length]));
}

function toolsBeforeFirstWrite(tools) {
    const sorted = tools.slice().sort(compareToolOrder);
    const index = sorted.findIndex((tool) => tool.tool_category === "write");
    return index === -1 ? sorted : sorted.slice(0, index);
}

function toolsAfterFirstWrite(tools) {
    const sorted = tools.slice().sort(compareToolOrder);
    const index = sorted.findIndex((tool) => tool.tool_category === "write");
    return index === -1 ? [] : sorted.slice(index + 1);
}

function semanticResourceKeys(keys) {
    return {
        paths: keys.paths,
        queries: keys.queries,
        symbols: keys.symbols,
        commands: [],
    };
}

function jaccard(left, right) {
    if (left.size === 0 && right.size === 0)
    { return null; }
    const shared = [...left].filter((value) => right.has(value)).length;
    const union = new Set([...left, ...right]).size;
    return union === 0 ? null : shared / union;
}

function lcsRatio(left, right) {
    if (left.length === 0 || right.length === 0)
    { return null; }
    const rows = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
    for (let i = 1; i <= left.length; i += 1) {
        for (let j = 1; j <= right.length; j += 1) {
            rows[i][j] = left[i - 1] === right[j - 1]
                ? rows[i - 1][j - 1] + 1
                : Math.max(rows[i - 1][j], rows[i][j - 1]);
        }
    }
    return rows[left.length][right.length] / Math.min(left.length, right.length);
}

function intersection(left, right) {
    const rightSet = new Set(right);
    return [...new Set(left)].filter((value) => rightSet.has(value)).sort();
}

function countValues(values) {
    const result = {};
    for (const value of values)
    { result[value] = (result[value] ?? 0) + 1; }
    return result;
}

function maximum(values) {
    const filtered = values.filter((value) => value !== null);
    return filtered.length === 0 ? null : filtered.reduce((max, value) => value > max ? value : max);
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

function compareToolOrder(a, b) {
    return (a.step_ordinal ?? -1) - (b.step_ordinal ?? -1) || a.ordinal - b.ordinal;
}
