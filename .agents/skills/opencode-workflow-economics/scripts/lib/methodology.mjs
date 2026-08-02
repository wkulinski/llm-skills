import {sha256} from "./util.mjs";
import {DEFAULT_CONFIG} from "./config.mjs";
import {FINGERPRINT_VERSION} from "./fingerprints.mjs";
import {PATTERN_GROUPING_VERSION, REPRESENTATIVE_SAMPLING_VERSION} from "./pattern-groups.mjs";
import {DELEGATION_OVERLAP_VERSION} from "./delegation-overlap.mjs";

export const REPORT_SCHEMA_VERSION = 5;

export const METHODOLOGY_VERSIONS = Object.freeze({
    activity_classification_version: "deterministic_activity_signals_v2",
    fingerprint_version: FINGERPRINT_VERSION,
    pattern_grouping_version: PATTERN_GROUPING_VERSION,
    representative_sampling_version: REPRESENTATIVE_SAMPLING_VERSION,
    overlap_version: DELEGATION_OVERLAP_VERSION,
});

const DEFAULT_THRESHOLDS = DEFAULT_CONFIG.diagnostics;

/**
 * Build the complete methodology identity from the already-resolved runtime
 * configuration. The hash excludes report data and pricing, so it describes
 * how observations were classified rather than how they were priced.
 */
export function buildMethodologyManifest(config = {}, versions = METHODOLOGY_VERSIONS) {
    const effectiveThresholds = resolveThresholds(config);
    const effectiveParameters = resolveParameters(config);
    const activeVersions = {...METHODOLOGY_VERSIONS, ...versions};
    const identity = {
        schema_version: REPORT_SCHEMA_VERSION,
        ...activeVersions,
        effective_thresholds: effectiveThresholds,
        effective_parameters: effectiveParameters,
    };

    return {
        ...activeVersions,
        effective_thresholds: effectiveThresholds,
        effective_parameters: effectiveParameters,
        methodology_hash: sha256(identity),
    };
}

export function methodologyVersions(methodology) {
    return Object.fromEntries(Object.keys(METHODOLOGY_VERSIONS).map((key) => [
        key.replace(/_version$/, ""),
        methodology?.[key] ?? null,
    ]));
}

/**
 * Compare either two manifests or two complete reports. Missing manifests are
 * intentionally incompatible: old reports must not be treated as comparable.
 */
export function compareMethodologies(left, right) {
    const first = extractMethodology(left);
    const second = extractMethodology(right);
    const differences = [];

    if (!first || !second) {
        differences.push("methodology_manifest_missing");
    } else {
        if (first.schema_version !== second.schema_version) { differences.push("schema_version"); }
        if (first.methodology_hash !== second.methodology_hash) { differences.push("methodology_hash"); }
        for (const key of Object.keys(METHODOLOGY_VERSIONS)) {
            if (first[key] !== second[key]) { differences.push(key); }
        }
    }

    const compatible = differences.length === 0;
    return {
        compatible,
        differences,
        warning: compatible ? null : "Reports use incompatible methodologies; compare results with caution.",
    };
}

export function methodologyWarning(left, right) {
    return compareMethodologies(left, right).warning;
}

function extractMethodology(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) { return null; }
    const methodology = value.methodology && typeof value.methodology === "object" ? value.methodology : value;
    if (typeof methodology.methodology_hash !== "string") { return null; }
    return {
        schema_version: value.schema_version ?? REPORT_SCHEMA_VERSION,
        ...methodology,
    };
}

function resolveThresholds(config) {
    const diagnostics = record(config.diagnostics);
    return {
        fingerprints: {
            step_count_maxima: positiveIntArray(diagnostics.fingerprints?.step_count_maxima, DEFAULT_THRESHOLDS.fingerprints.step_count_maxima),
            tool_call_count_maxima: positiveIntArray(diagnostics.fingerprints?.tool_call_count_maxima, DEFAULT_THRESHOLDS.fingerprints.tool_call_count_maxima),
            output_byte_maxima: positiveIntArray(diagnostics.fingerprints?.output_byte_maxima, DEFAULT_THRESHOLDS.fingerprints.output_byte_maxima),
            include_neighbor_activities: booleanValue(diagnostics.fingerprints?.include_neighbor_activities, DEFAULT_THRESHOLDS.fingerprints.include_neighbor_activities),
        },
        patterns: {
            min_occurrences: positiveInt(diagnostics.patterns?.min_occurrences, DEFAULT_THRESHOLDS.patterns.min_occurrences),
            max_examples: positiveInt(diagnostics.patterns?.max_examples, DEFAULT_THRESHOLDS.patterns.max_examples),
            max_groups: positiveInt(diagnostics.patterns?.max_groups, DEFAULT_THRESHOLDS.patterns.max_groups),
        },
        delegation_overlap: {
            max_parent_steps: positiveInt(diagnostics.delegation_overlap?.max_parent_steps, DEFAULT_THRESHOLDS.delegation_overlap.max_parent_steps),
            max_parent_spans: positiveInt(diagnostics.delegation_overlap?.max_parent_spans, DEFAULT_THRESHOLDS.delegation_overlap.max_parent_spans),
            max_elapsed_ms: positiveInt(diagnostics.delegation_overlap?.max_elapsed_ms, DEFAULT_THRESHOLDS.delegation_overlap.max_elapsed_ms),
            structural_jaccard_threshold: boundedNumber(diagnostics.delegation_overlap?.structural_jaccard_threshold, DEFAULT_THRESHOLDS.delegation_overlap.structural_jaccard_threshold),
            structural_sequence_threshold: boundedNumber(diagnostics.delegation_overlap?.structural_sequence_threshold, DEFAULT_THRESHOLDS.delegation_overlap.structural_sequence_threshold),
        },
    };
}

function resolveParameters(config) {
    const collection = record(config.collection);
    const privacy = record(config.privacy);
    return {
        tool_mappings: sortedRecord(config.tool_mappings),
        shell_rules: Array.isArray(config.shell_rules)
            ? config.shell_rules.map((rule) => ({category: rule?.category ?? null, pattern: rule?.pattern ?? null}))
            : [],
        hybrid_families: Array.isArray(config.hybrid_families)
            ? config.hybrid_families.map((family) => ({
                name: family?.name ?? null,
                primary_agents: [...(family?.primary_agents ?? [])],
                fallback_agents: [...(family?.fallback_agents ?? [])],
            }))
            : [],
        collection: {
            content_mode: collection.content_mode ?? null,
            compact_text_chars: collection.compact_text_chars ?? null,
            full_text_chars: collection.full_text_chars ?? null,
        },
        privacy: {
            include_user_text: privacy.include_user_text ?? null,
            include_assistant_final_text: privacy.include_assistant_final_text ?? null,
            include_task_prompt: privacy.include_task_prompt ?? null,
            include_paths: privacy.include_paths ?? null,
            include_search_queries: privacy.include_search_queries ?? null,
            include_titles: privacy.include_titles ?? null,
        },
    };
}

function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function sortedRecord(value) {
    return Object.fromEntries(Object.entries(record(value)).sort(([left], [right]) => left.localeCompare(right)));
}

function positiveIntArray(value, fallback) {
    if (!Array.isArray(value)) { return [...fallback]; }
    const result = [...new Set(value.filter((item) => Number.isSafeInteger(item) && item > 0))].sort((a, b) => a - b);
    return result.length > 0 ? result : [...fallback];
}

function positiveInt(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function boundedNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

function booleanValue(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
