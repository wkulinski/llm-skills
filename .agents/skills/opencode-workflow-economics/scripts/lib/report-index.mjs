import { aggregateCost } from "./costs.mjs";
import { methodologyVersions } from "./methodology.mjs";

export const REPORT_INDEX_VERSION = 1;

export function buildReportIndex(bundle, catalog = {}, reportSizes = {}) {
    const patternById = new Map(bundle.pattern_groups.map((pattern) => [pattern.pattern_id, pattern]));
    const patternEntries = bundle.pattern_groups.map((pattern) => summarizePattern(pattern));
    const overlapEntries = bundle.delegation_overlap_diagnostics.map((item) => summarizeOverlap(item, bundle));
    const rootEntries = bundle.roots.map((root) => summarizeRoot(root, bundle.pricing.currency));
    const agentCosts = new Map(bundle.aggregates.by_agent.map((row) => [row.key, row.cost]));
    const overlapBySubagent = new Map((bundle.aggregates.delegation_overlap?.by_subagent ?? [])
        .map((row) => [row.subagent, row]));
    const subagentEntries = (bundle.aggregates.delegation_economics?.by_subagent ?? []).map((row) => ({
        ...overlapBySubagent.get(row.subagent),
        ...row,
        observed_agent_cost: agentCosts.get(row.subagent) ?? null,
    }));

    return {
        schema_version: REPORT_INDEX_VERSION,
        generated_at: bundle.generated_at,
        objective: bundle.objective,
        source: bundle.source,
        methodology_versions: methodologyVersions(bundle.methodology),
        methodology: {
            schema_version: bundle.schema_version,
            versions: methodologyVersions(bundle.methodology),
            methodology_hash: bundle.methodology.methodology_hash,
        },
        data_quality: {
            warnings: bundle.warnings,
            warning_count: bundle.warnings.length,
            pricing_coverage: ratio(bundle.summary.total_cost.priced_steps, bundle.summary.total_cost.eligible_steps),
            priced_steps: bundle.summary.total_cost.priced_steps,
            eligible_steps: bundle.summary.total_cost.eligible_steps,
            mixed_activity_steps: bundle.summary.mixed_activity_steps,
            unknown_activity_steps: bundle.summary.unknown_activity_steps,
            unlinked_delegations: countWarning(bundle.warnings, "unlinked_or_invalid_delegations"),
            assessment: assessDataQuality(bundle),
        },
        summary: bundle.summary,
        cost_baseline: {
            total_usage: bundle.summary.total_usage,
            total_cost: bundle.summary.total_cost,
            by_agent: bundle.aggregates.by_agent.slice(0, 20),
            by_model: bundle.aggregates.by_model.slice(0, 20),
            by_primary_activity: bundle.aggregates.by_primary_activity.slice(0, 20),
            hybrid_families: bundle.aggregates.hybrid_families,
        },
        projection_counts: {
            agents: bundle.aggregates.by_agent.length,
            models: bundle.aggregates.by_model.length,
            activities: bundle.aggregates.by_primary_activity.length,
            subagents: bundle.aggregates.delegation_economics?.by_subagent?.length ?? 0,
            patterns: bundle.pattern_groups.length,
            overlaps: bundle.delegation_overlap_diagnostics.length,
            roots: bundle.roots.length,
        },
        patterns: patternEntries,
        pattern_views: Object.fromEntries(Object.entries(bundle.pattern_views).map(([view, ids]) => [view, ids.filter((id) => patternById.has(id))])),
        overlaps: overlapEntries,
        overlap_views: buildOverlapViews(overlapEntries),
        delegation_economics: bundle.aggregates.delegation_economics ?? emptyDelegationEconomics(bundle.pricing.currency),
        subagents: subagentEntries,
        roots: rootEntries,
        files: { report: catalog.report_file ?? "report.json" },
        report_sizes: {
            report_bytes: reportSizes.report_bytes ?? 0,
            brief_bytes: reportSizes.brief_bytes ?? 0,
            estimated_report_tokens: estimateTokens(reportSizes.report_bytes ?? 0),
            estimated_brief_tokens: estimateTokens(reportSizes.brief_bytes ?? 0),
            token_estimation_method: "ceil(utf8_bytes/4)",
        },
        reading_contract: {
            start_with: "owe brief",
            standard_analysis: "Read the brief, then select a small number of patterns and overlaps using list/show commands.",
            audit_only: catalog.report_file ?? "report.json",
            do_not_read_canonical_report_by_default: true,
        },
    };
}

function emptyDelegationEconomics(currency) {
    const emptyCost = {
        status: "complete",
        value_nano: 0n,
        priced_value_nano: 0n,
        priced_steps: 0,
        eligible_steps: 0,
        currency,
    };
    return {
        totals: {
            total_delegations: 0,
            linked_delegations: 0,
            unlinked_delegations: 0,
            fallback_attempts: 0,
            delegations: 0,
            fallback_additional_cost: emptyCost,
            delegating_step_cost: emptyCost,
            child_direct_cost: emptyCost,
            child_subtree_cost: emptyCost,
            child_output_bytes: 0n,
            parent_followup_cost: emptyCost,
            parent_exposure_cost: emptyCost,
        },
        by_subagent: [],
        fallback_attempts: [],
    };
}

function summarizePattern(pattern) {
    return {
        pattern_id: pattern.pattern_id,
        scope: pattern.scope,
        primary_activity: pattern.signature.primary_activity,
        activities: pattern.activities ?? pattern.signature.activities ?? [],
        collapsed_operation_sequence: pattern.signature.collapsed_operation_sequence,
        mutation_mode: pattern.mutation_mode ?? pattern.signature.mutation_mode ?? "unknown",
        occurrences: pattern.occurrences,
        distinct_sessions: pattern.distinct_sessions,
        distinct_root_sessions: pattern.distinct_root_sessions,
        total_cost: pattern.cost.total,
        median_value_nano: pattern.cost.median_value_nano,
        p90_value_nano: pattern.cost.p90_value_nano,
        diagnostics: pattern.diagnostics,
        representative_example_ids: pattern.representative_examples.map((example) => ({
            root_session_id: example.root_session_id,
            span_id: example.span_id,
        })),
    };
}

function summarizeOverlap(item, bundle) {
    const delegation = bundle.roots
        .flatMap((root) => root.delegations)
        .find((candidate) => candidate.id === item.delegation_id) ?? null;
    const fallback = bundle.aggregates.delegation_economics?.fallback_attempts
        ?.find((attempt) => attempt.fallback_delegation_id === item.delegation_id) ?? null;
    return {
        delegation_id: item.delegation_id,
        root_session_id: item.root_session_id,
        parent_session_id: item.parent_session_id,
        child_session_id: item.child_session_id,
        subagent_name: item.subagent_name,
        diagnostic: item.diagnostic,
        exact_resource_matches: item.evidence?.exact_resource_matches ?? 0,
        exact_resource_matches_before_first_write: item.evidence?.exact_resource_matches_before_first_write ?? 0,
        semantic_exact_matches_before_first_write: item.evidence?.semantic_exact_matches_before_first_write ?? 0,
        pre_write_path_count: item.evidence?.pre_write_path_count ?? 0,
        pre_write_query_count: item.evidence?.pre_write_query_count ?? 0,
        pre_write_symbol_count: item.evidence?.pre_write_symbol_count ?? 0,
        command_exact_matches_before_first_write: item.evidence?.command_exact_matches_before_first_write ?? 0,
        exact_resource_matches_after_first_write: item.evidence?.exact_resource_matches_after_first_write ?? 0,
        declared_read_contexts: declaredReadContexts(item),
        ordered_exact_matches: item.evidence?.ordered_exact_matches ?? 0,
        unordered_exact_matches: item.evidence?.unordered_exact_matches ?? 0,
        overlapping_exact_matches: item.evidence?.overlapping_exact_matches ?? 0,
        shared_structural_family_count: item.evidence?.shared_structural_family_ids?.length ?? 0,
        operation_jaccard: item.evidence?.operation_jaccard ?? null,
        ordered_sequence_similarity: item.evidence?.ordered_sequence_similarity ?? null,
        delegating_step_cost: delegation?.parent_delegating_step_cost ?? null,
        child_direct_cost: delegation?.child_direct_cost ?? null,
        child_cost: delegation?.child_subtree_cost ?? item.child?.cost ?? null,
        child_output_bytes: delegation?.child_output_bytes ?? null,
        parent_followup_cost: item.parent_followup?.cost ?? null,
        parent_exposure_cost: item.parent_exposure?.total_cost ?? null,
        fallback_additional_cost: fallback?.additional_cost ?? null,
    };
}

function declaredReadContexts(item) {
    return Array.isArray(item.evidence?.declared_read_contexts) ? item.evidence.declared_read_contexts : [];
}

function summarizeRoot(root, currency) {
    return {
        root_session_id: root.root_session_id,
        title: root.title,
        created_at_ms: root.created_at_ms,
        updated_at_ms: root.updated_at_ms,
        sessions: root.sessions.length,
        steps: root.steps.length,
        tools: root.tools.length,
        spans: root.spans.length,
        delegations: root.delegations.length,
        recurring_patterns: new Set(root.spans.map((span) => span.operation_fingerprint?.structural_family_id).filter(Boolean)).size,
        semantic_hint: root.semantic?.user_requests?.[0] ?? null,
        cost: root.totals?.cost ?? aggregateCost(root.steps, currency),
    };
}

function buildOverlapViews(overlaps) {
    const result = {
        strong_repeated_work_signal: [],
        declared_read_context: [],
        possible_repeated_work: [],
        mixed_followup: [],
        structural_overlap_only: [],
        no_overlap_observed_in_window: [],
        insufficient_evidence: [],
    };
    for (const item of overlaps) {
        if (result[item.diagnostic]) { result[item.diagnostic].push(item.delegation_id); }
    }
    for (const ids of Object.values(result)) { ids.sort(); }
    return result;
}

function assessDataQuality(bundle) {
    const coverage = ratio(bundle.summary.total_cost.priced_steps, bundle.summary.total_cost.eligible_steps);
    const serious = bundle.warnings.some((warning) => warning.startsWith("unlinked_or_invalid_delegations") || warning.startsWith("incomplete_steps"));
    if (coverage !== null && coverage >= 0.95 && !serious) { return bundle.warnings.length === 0 ? "good" : "usable_with_limits"; }
    if (coverage !== null && coverage >= 0.75) { return "limited"; }
    return "poor";
}

function countWarning(warnings, prefix) {
    const warning = warnings.find((item) => item.startsWith(`${prefix}:`));
    if (!warning) { return 0; }
    const value = Number(warning.slice(prefix.length + 1));
    return Number.isFinite(value) ? value : 0;
}

function ratio(numerator, denominator) {
    return denominator === 0 ? null : numerator / denominator;
}

function estimateTokens(bytes) {
    return Math.ceil(bytes / 4);
}
