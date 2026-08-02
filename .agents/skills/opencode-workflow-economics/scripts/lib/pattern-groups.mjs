import { sha256 } from "./util.mjs";
import { aggregateCostRecords, costRecordFromStep } from "./costs.mjs";

export const PATTERN_GROUPING_VERSION = "exact_fingerprint_identity_v2";
export const REPRESENTATIVE_SAMPLING_VERSION = "representative_sampling_v2";

const DEFAULTS = {
    min_occurrences: 2,
    max_examples: 3,
    max_groups: 200,
};

export function buildPatternGroups(roots, config = {}) {
    const settings = { ...DEFAULTS, ...(config ?? {}) };
    const spans = roots.flatMap((root) => root.spans);
    const steps = roots.flatMap((root) => root.steps);
    const stepsBySession = groupBy(steps, (step) => step.session_id);
    const grouped = groupBy(spans, (span) => span.operation_fingerprint.signature_hash);
    const groups = [];
    let singletonSpans = 0;

    for (const [signature, values] of grouped) {
        if (values.length < settings.min_occurrences) {
            singletonSpans += values.length;
            continue;
        }
        const sorted = values.slice().sort(compareSpanCost);
        const completeValues = values
            .filter((span) => span.cost.value_nano !== null)
            .map((span) => span.cost.value_nano)
            .sort(compareBigInt);
        const models = aggregateModels(values, stepsBySession);
        const agents = aggregateAgents(values);
        const examples = representativeExamples(values, settings.max_examples);
        const totalCost = aggregateCostRecords(values.map((span) => span.cost));
        const occurrenceSessions = new Set(values.map((span) => span.session_id));
        const rootSessions = new Set(values.map((span) => span.root_session_id));
        const fingerprint = values[0].operation_fingerprint;
        const activities = [...new Set(values.flatMap((span) => span.activities))].sort();
        const mutationModes = countValues(values.map((span) => span.operation_fingerprint?.signature?.mutation_mode ?? "unknown"));
        const groupId = `pattern-${sha256({ version: PATTERN_GROUPING_VERSION, signature }).slice(0, 16)}`;
        groups.push({
            pattern_id: groupId,
            grouping_method: PATTERN_GROUPING_VERSION,
            fingerprint_version: fingerprint.version,
            scope: fingerprint.signature.scope,
            structural_family_id: fingerprint.structural_family_id,
            structural_family_hash: fingerprint.structural_family_hash,
            signature_hash: fingerprint.signature_hash,
            signature: fingerprint.signature,
            activities,
            mutation_mode: fingerprint.signature.mutation_mode,
            occurrences: values.length,
            distinct_sessions: occurrenceSessions.size,
            distinct_root_sessions: rootSessions.size,
            cost: {
                total: totalCost,
                median_value_nano: percentile(completeValues, 0.5),
                p90_value_nano: percentile(completeValues, 0.9),
                complete_occurrences: completeValues.length,
                total_occurrences: values.length,
                currency: totalCost.currency,
            },
            usage: aggregateSpanUsage(values),
            agents,
            models,
            diagnostics: {
                tool_errors: values.reduce((sum, span) => sum + span.tool_errors, 0),
                error_rate: ratio(values.filter((span) => span.tool_errors > 0).length, values.length),
                retry_or_rework_rate: ratio(values.filter((span) => (span.activity_signal_counts.retry_recovery ?? 0) > 0).length, values.length),
                average_tool_calls: average(values.map((span) => span.tool_calls)),
                average_output_bytes: averageBigInt(values.map((span) => span.output_bytes ?? 0n)),
                read_only_occurrences: mutationModes.read_only ?? 0,
                write_involving_occurrences: mutationModes.write ?? 0,
                unknown_mutation_occurrences: mutationModes.unknown ?? 0,
                mixed_occurrences: values.filter((span) => span.mixed_step_count > 0).length,
            },
            representative_examples: examples,
            span_ids: sorted.slice(0, 100).map((span) => span.id),
            span_ids_truncated: Math.max(0, sorted.length - 100),
        });
    }

    groups.sort((a, b) => compareBigIntDesc(
        a.cost.total.value_nano ?? a.cost.total.priced_value_nano,
        b.cost.total.value_nano ?? b.cost.total.priced_value_nano,
    ));
    const limited = groups.slice(0, settings.max_groups);
    return {
        groups: limited,
        views: buildPatternViews(limited),
        summary: {
            grouping_method: PATTERN_GROUPING_VERSION,
            minimum_occurrences: settings.min_occurrences,
            recurring_groups: groups.length,
            returned_groups: limited.length,
            grouped_span_occurrences: groups.reduce((sum, group) => sum + group.occurrences, 0),
            singleton_or_below_threshold_spans: singletonSpans,
            truncated_groups: Math.max(0, groups.length - limited.length),
        },
    };
}

function aggregateAgents(spans) {
    const grouped = groupBy(spans, (span) => span.agent_name ?? "unknown");
    return [...grouped.entries()].map(([agent, values]) => ({
        agent,
        occurrences: values.length,
        cost: aggregateCostRecords(values.map((span) => span.cost)),
    })).sort((a, b) => b.occurrences - a.occurrences || compareBigIntDesc(
        a.cost.value_nano ?? a.cost.priced_value_nano,
        b.cost.value_nano ?? b.cost.priced_value_nano,
    ));
}

function aggregateModels(spans, stepsBySession) {
    const counts = new Map();
    for (const span of spans) {
        const steps = (stepsBySession.get(span.session_id) ?? []).filter((step) => step.ordinal >= span.start_step_ordinal && step.ordinal <= span.end_step_ordinal);
        for (const step of steps) {
            const key = [step.provider_id, step.reported_model_id, step.model_variant].filter(Boolean).join("/") || "unknown";
            const row = counts.get(key) ?? { key, steps: 0, occurrences: new Set(), cost_records: [] };
            row.steps += 1;
            row.occurrences.add(span.id);
            row.cost_records.push(costRecordFromStep(step, span.cost.currency));
            counts.set(key, row);
        }
    }
    return [...counts.values()].map((row) => ({
        key: row.key,
        span_occurrences: row.occurrences.size,
        steps: row.steps,
        cost: aggregateCostRecords(row.cost_records),
    })).sort((a, b) => compareBigIntDesc(
        a.cost.value_nano ?? a.cost.priced_value_nano,
        b.cost.value_nano ?? b.cost.priced_value_nano,
    ));
}

function representativeExamples(spans, maxExamples) {
    if (maxExamples <= 0)
    { return []; }
    const complete = spans.filter((span) => span.cost.value_nano !== null).sort(compareSpanCost);
    const costMedian = complete.length > 0 ? percentile(complete.map((span) => span.cost.value_nano).sort(compareBigInt), 0.5) : null;
    const medianCalls = medianNumber(spans.map((span) => span.tool_calls));
    const medianExample = costMedian === null
        ? spans.slice().sort((a, b) => a.tool_calls - b.tool_calls)[Math.floor(spans.length / 2)]
        : complete.reduce((best, span) => distanceBigInt(span.cost.value_nano, costMedian) < distanceBigInt(best.cost.value_nano, costMedian) ? span : best);
    const byHighestCost = spans.slice().sort(compareSpanCost);
    const byAtypicalToolCount = spans.slice().sort((a, b) => Math.abs(b.tool_calls - medianCalls) - Math.abs(a.tool_calls - medianCalls));
    const selected = [];
    const selectedIds = new Set();
    const selectedRoots = new Set();
    const add = (span) => {
        if (!span || selected.length >= maxExamples || selectedIds.has(span.id)) { return false; }
        selected.push(span);
        selectedIds.add(span.id);
        selectedRoots.add(span.root_session_id);
        return true;
    };

    // Keep the median-cost example as the stable anchor for the group.
    add(medianExample);
    // Prefer the highest-cost example from a different root before falling back
    // to another occurrence from the anchor root.
    add(byHighestCost.find((span) => !selectedRoots.has(span.root_session_id)) ?? byHighestCost[0]);
    // Use an atypical tool count/operation shape from another root when one is
    // available, then fill any remaining slots while still preferring new roots.
    add(byAtypicalToolCount.find((span) => !selectedRoots.has(span.root_session_id)) ?? byAtypicalToolCount[0]);
    for (const span of [...byHighestCost, ...byAtypicalToolCount]) {
        if (selected.length >= maxExamples) { break; }
        add(span);
    }
    return selected.map((span) => ({
        root_session_id: span.root_session_id,
        session_id: span.session_id,
        span_id: span.id,
        primary_activity: span.primary_activity,
        activities: span.activities,
        cost: span.cost,
        tool_calls: span.tool_calls,
        output_bytes: span.output_bytes,
        semantic_hints: span.semantic_hints.slice(0, 6),
        operation_sequence: span.operation_fingerprint.operation_sequence,
    }));
}

function buildPatternViews(groups) {
    return {
        highest_total_cost: groups.slice().sort((a, b) => compareBigIntDesc(
            a.cost.total.value_nano ?? a.cost.total.priced_value_nano,
            b.cost.total.value_nano ?? b.cost.total.priced_value_nano,
        )).map((group) => group.pattern_id),
        most_frequent: groups.slice().sort((a, b) => b.occurrences - a.occurrences || b.distinct_sessions - a.distinct_sessions).map((group) => group.pattern_id),
        highest_median_cost: groups.slice().filter((group) => group.cost.median_value_nano !== null)
            .sort((a, b) => compareBigIntDesc(a.cost.median_value_nano, b.cost.median_value_nano)).map((group) => group.pattern_id),
        high_cost_read_only: groups.filter((group) => group.diagnostics.read_only_occurrences === group.occurrences)
            .sort((a, b) => compareBigIntDesc(
                a.cost.total.value_nano ?? a.cost.total.priced_value_nano,
                b.cost.total.value_nano ?? b.cost.total.priced_value_nano,
            )).map((group) => group.pattern_id),
        write_involving: groups.filter((group) => group.diagnostics.write_involving_occurrences > 0).map((group) => group.pattern_id),
        retry_and_rework: groups.filter((group) => group.diagnostics.retry_or_rework_rate > 0).map((group) => group.pattern_id),
    };
}

function aggregateSpanUsage(spans) {
    const fields = ["input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens"];
    return Object.fromEntries(fields.map((field) => {
        const values = spans.map((span) => span.usage[field]);
        return [field, values.some((value) => value === null) ? null : values.reduce((sum, value) => sum + (value ?? 0n), 0n)];
    }));
}

function percentile(sorted, quantile) {
    if (sorted.length === 0)
    { return null; }
    const index = Math.ceil(quantile * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function average(values) {
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageBigInt(values) {
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0n) / BigInt(values.length);
}

function ratio(numerator, denominator) {
    return denominator === 0 ? null : numerator / denominator;
}

function countValues(values) {
    const result = {};
    for (const value of values)
    { result[value] = (result[value] ?? 0) + 1; }
    return result;
}

function medianNumber(values) {
    if (values.length === 0)
    { return 0; }
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
}

function distanceBigInt(left, right) {
    return left >= right ? left - right : right - left;
}

function compareSpanCost(a, b) {
    return compareBigIntDesc(a.cost.value_nano ?? a.cost.priced_value_nano, b.cost.value_nano ?? b.cost.priced_value_nano);
}

function compareBigInt(left, right) {
    return left === right ? 0 : left < right ? -1 : 1;
}

function compareBigIntDesc(left, right) {
    return left === right ? 0 : left > right ? -1 : 1;
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
