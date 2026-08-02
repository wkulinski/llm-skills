import { readFile } from "node:fs/promises";
import { record } from "./util.mjs";

export const REMOVED_CONFIG_FIELDS = Object.freeze(["shell_rules", "diagnostics", "reporting"]);

export const DEFAULT_CONFIG = {
    version: 1,
    opencode: {
        base_url: "http://localhost:4096",
        directory: ".",
    },
    collection: {
        content_mode: "compact",
        compact_text_chars: 1200,
        full_text_chars: 12000,
        max_sessions: 100,
        concurrency: 3,
    },
    privacy: {
        include_user_text: true,
        include_assistant_final_text: true,
        include_task_prompt: true,
        include_paths: true,
        include_search_queries: true,
        include_titles: false,
    },
    tool_mappings: {
        read: "read",
        grep: "search",
        glob: "search",
        find: "search",
        lsp: "search",
        search: "search",
        websearch: "web",
        webfetch: "web",
        edit: "write",
        write: "write",
        apply_patch: "write",
        patch: "write",
        bash: "shell",
        shell: "shell",
        task: "delegation",
        skill: "skill",
    },
    shell_rules: [
        { category: "verification.test", pattern: "(^|\\s)(npm|pnpm|yarn|bun)?\\s*(run\\s+)?test(:|\\s|$)|(^|\\s)(pytest|phpunit|vitest|jest)(\\s|$)" },
        { category: "verification.lint", pattern: "(^|\\s)(eslint|stylelint|ruff|phpstan|biome)(\\s|$)|\\brun\\s+lint" },
        { category: "verification.typecheck", pattern: "(^|\\s)(tsc|mypy)(\\s|$)|\\brun\\s+typecheck" },
        { category: "build.compile", pattern: "(^|\\s)(npm|pnpm|yarn|bun)?\\s*(run\\s+)?build(:|\\s|$)|(^|\\s)(make|cargo build)(\\s|$)" },
        { category: "version_control.status", pattern: "(^|\\s)git\\s+status(\\s|$)" },
        { category: "version_control.diff", pattern: "(^|\\s)git\\s+diff(\\s|$)" },
        { category: "version_control.log", pattern: "(^|\\s)git\\s+log(\\s|$)" },
        { category: "repository.search", pattern: "(^|\\s)(rg|grep|find|fd)(\\s|$)" },
    ],
    hybrid_families: [],
    reporting: {
        brief: {
            max_bytes: 14 * 1024,
            max_patterns: 5,
            max_overlap_diagnostics: 5,
            max_subagents: 10,
            max_warnings: 20,
            max_examples_per_pattern: 2,
            hints_per_example: 1,
        },
    },
    diagnostics: {
        fingerprints: {
            step_count_maxima: [1, 4, 8],
            tool_call_count_maxima: [1, 3, 7, 15],
            output_byte_maxima: [1024, 16384, 131072],
            include_neighbor_activities: true,
        },
        patterns: {
            min_occurrences: 2,
            max_examples: 3,
            max_groups: 200,
        },
        delegation_overlap: {
            max_parent_steps: 8,
            max_parent_spans: 4,
            max_elapsed_ms: 300000,
            structural_jaccard_threshold: 0.6,
            structural_sequence_threshold: 0.5,
        },
    },
};
export function findRemovedConfigFields(input) {
    const source = record(input);
    return REMOVED_CONFIG_FIELDS.filter((field) => Object.hasOwn(source, field));
}

function mergeConfig(input) {
    const source = record(input);
    const opencode = record(source.opencode);
    const collection = record(source.collection);
    const privacy = record(source.privacy);
    const mappings = record(source.tool_mappings);
    const shellRules = DEFAULT_CONFIG.shell_rules;
    const families = Array.isArray(source.hybrid_families) ? source.hybrid_families : [];
    const reporting = {};
    const brief = record(reporting.brief);
    const diagnostics = {};
    const fingerprints = record(diagnostics.fingerprints);
    const patterns = record(diagnostics.patterns);
    const delegationOverlap = record(diagnostics.delegation_overlap);
    const toolMappings = { ...DEFAULT_CONFIG.tool_mappings };
    for (const [key, value] of Object.entries(mappings)) {
        if (["search", "read", "write", "shell", "delegation", "skill", "web", "version_control", "other"].includes(String(value))) {
            toolMappings[key] = value;
        }
    }
    return {
        version: 1,
        opencode: {
            base_url: typeof opencode.base_url === "string" ? opencode.base_url : DEFAULT_CONFIG.opencode.base_url,
            directory: typeof opencode.directory === "string" ? opencode.directory : DEFAULT_CONFIG.opencode.directory,
        },
        collection: {
            content_mode: ["metadata", "compact", "full"].includes(String(collection.content_mode))
                ? collection.content_mode
                : DEFAULT_CONFIG.collection.content_mode,
            compact_text_chars: positiveInt(collection.compact_text_chars, DEFAULT_CONFIG.collection.compact_text_chars),
            full_text_chars: positiveInt(collection.full_text_chars, DEFAULT_CONFIG.collection.full_text_chars),
            max_sessions: positiveInt(collection.max_sessions, DEFAULT_CONFIG.collection.max_sessions),
            concurrency: positiveInt(collection.concurrency, DEFAULT_CONFIG.collection.concurrency),
        },
        privacy: {
            include_user_text: booleanValue(privacy.include_user_text, DEFAULT_CONFIG.privacy.include_user_text),
            include_assistant_final_text: booleanValue(privacy.include_assistant_final_text, DEFAULT_CONFIG.privacy.include_assistant_final_text),
            include_task_prompt: booleanValue(privacy.include_task_prompt, DEFAULT_CONFIG.privacy.include_task_prompt),
            include_paths: booleanValue(privacy.include_paths, DEFAULT_CONFIG.privacy.include_paths),
            include_search_queries: booleanValue(privacy.include_search_queries, DEFAULT_CONFIG.privacy.include_search_queries),
            include_titles: booleanValue(privacy.include_titles, DEFAULT_CONFIG.privacy.include_titles),
        },
        reporting: {
            brief: {
                max_bytes: positiveInt(brief.max_bytes, DEFAULT_CONFIG.reporting.brief.max_bytes),
                max_patterns: positiveInt(brief.max_patterns, DEFAULT_CONFIG.reporting.brief.max_patterns),
                max_overlap_diagnostics: positiveInt(brief.max_overlap_diagnostics, DEFAULT_CONFIG.reporting.brief.max_overlap_diagnostics),
                max_subagents: positiveInt(brief.max_subagents, DEFAULT_CONFIG.reporting.brief.max_subagents),
                max_warnings: positiveInt(brief.max_warnings, DEFAULT_CONFIG.reporting.brief.max_warnings),
                max_examples_per_pattern: positiveInt(brief.max_examples_per_pattern, DEFAULT_CONFIG.reporting.brief.max_examples_per_pattern),
                hints_per_example: Math.min(positiveInt(brief.hints_per_example, DEFAULT_CONFIG.reporting.brief.hints_per_example), 2),
            },
        },
        tool_mappings: toolMappings,
        shell_rules: shellRules.flatMap((item) => {
            const entry = record(item);
            return typeof entry.category === "string" && typeof entry.pattern === "string"
                ? [{ category: entry.category, pattern: entry.pattern }]
                : [];
        }),
        hybrid_families: families.flatMap((item) => {
            const entry = record(item);
            if (typeof entry.name !== "string")
            { return []; }
            return [{
                name: entry.name,
                primary_agents: stringArray(entry.primary_agents),
                fallback_agents: stringArray(entry.fallback_agents),
            }];
        }),
        diagnostics: {
            fingerprints: {
                step_count_maxima: positiveIntArray(fingerprints.step_count_maxima, DEFAULT_CONFIG.diagnostics.fingerprints.step_count_maxima),
                tool_call_count_maxima: positiveIntArray(fingerprints.tool_call_count_maxima, DEFAULT_CONFIG.diagnostics.fingerprints.tool_call_count_maxima),
                output_byte_maxima: positiveIntArray(fingerprints.output_byte_maxima, DEFAULT_CONFIG.diagnostics.fingerprints.output_byte_maxima),
                include_neighbor_activities: booleanValue(fingerprints.include_neighbor_activities, DEFAULT_CONFIG.diagnostics.fingerprints.include_neighbor_activities),
            },
            patterns: {
                min_occurrences: positiveInt(patterns.min_occurrences, DEFAULT_CONFIG.diagnostics.patterns.min_occurrences),
                max_examples: positiveInt(patterns.max_examples, DEFAULT_CONFIG.diagnostics.patterns.max_examples),
                max_groups: positiveInt(patterns.max_groups, DEFAULT_CONFIG.diagnostics.patterns.max_groups),
            },
            delegation_overlap: {
                max_parent_steps: positiveInt(delegationOverlap.max_parent_steps, DEFAULT_CONFIG.diagnostics.delegation_overlap.max_parent_steps),
                max_parent_spans: positiveInt(delegationOverlap.max_parent_spans, DEFAULT_CONFIG.diagnostics.delegation_overlap.max_parent_spans),
                max_elapsed_ms: positiveInt(delegationOverlap.max_elapsed_ms, DEFAULT_CONFIG.diagnostics.delegation_overlap.max_elapsed_ms),
                structural_jaccard_threshold: boundedNumber(delegationOverlap.structural_jaccard_threshold, DEFAULT_CONFIG.diagnostics.delegation_overlap.structural_jaccard_threshold),
                structural_sequence_threshold: boundedNumber(delegationOverlap.structural_sequence_threshold, DEFAULT_CONFIG.diagnostics.delegation_overlap.structural_sequence_threshold),
            },
        },
    };
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}
function positiveIntArray(value, fallback) {
    if (!Array.isArray(value))
    { return [...fallback]; }
    const result = [...new Set(value.filter((item) => typeof item === "number" && Number.isSafeInteger(item) && item > 0))].sort((a, b) => a - b);
    return result.length > 0 ? result : [...fallback];
}
function boundedNumber(value, fallback) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}
function positiveInt(value, fallback) {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback;
}
function booleanValue(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
}
export async function loadConfig(path, {onWarning} = {}) {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8"));
        const removedFields = findRemovedConfigFields(parsed);
        if (removedFields.length > 0) { onWarning?.(`Ignored removed internal fields: ${removedFields.join(", ")}. Runtime defaults are used.`); }
        return mergeConfig(parsed);
    }
    catch (error) {
        if (error.code === "ENOENT")
        { return DEFAULT_CONFIG; }
        throw error;
    }
}
export async function loadPricing(path) {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    validatePricing(parsed, path);
    return parsed;
}

function validatePricing(value, path) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || value.version !== 1 || typeof value.currency !== "string" || value.currency.trim() === ""
        || !value.models || typeof value.models !== "object" || Array.isArray(value.models))
    { throw new Error(`Invalid pricing config: ${path}`); }

    const aliasOwners = new Map();
    for (const [modelId, model] of Object.entries(value.models)) {
        if (!model || typeof model !== "object" || Array.isArray(model))
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId})`); }
        if (!Array.isArray(model.aliases) || model.aliases.some((alias) => typeof alias !== "string" || alias.trim() === ""))
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.aliases)`); }
        for (const alias of model.aliases) {
            if (aliasOwners.has(alias) || (Object.hasOwn(value.models, alias) && alias !== modelId))
            { throw new Error(`Invalid pricing config: ${path} (duplicate model alias ${alias})`); }
            aliasOwners.set(alias, modelId);
        }
        if (![
            "ignore",
            "included_in_output",
            "separate",
        ].includes(model.reasoning_accounting)
        || ![
            "unknown",
            "excluded",
            "included",
        ].includes(model.cache_read_accounting)
        || ![
            "unknown",
            "excluded",
            "included",
        ].includes(model.cache_write_accounting))
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.accounting)`); }
        const rates = model.prices_per_million;
        if (!rates || typeof rates !== "object" || Array.isArray(rates))
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.prices_per_million)`); }
        for (const key of ["input", "output", "cache_read", "cache_write"]) {
            if (!isDecimalPrice(rates[key]))
            { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.prices_per_million.${key})`); }
        }
        if (rates.reasoning !== undefined && !isDecimalPrice(rates.reasoning))
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.prices_per_million.reasoning)`); }
        validateContextTiers(model.context_tiers, path, modelId);
    }
}

function validateContextTiers(value, path, modelId) {
    if (value === undefined)
    { return; }
    if (!Array.isArray(value))
    { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.context_tiers)`); }
    let previousMinimum = 0n;
    for (const [index, tier] of value.entries()) {
        if (!tier || typeof tier !== "object" || Array.isArray(tier)
            || typeof tier.name !== "string" || tier.name.trim() === ""
            || !/^\d+$/.test(tier.min_context_tokens)
            || BigInt(tier.min_context_tokens) <= previousMinimum)
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.context_tiers.${index})`); }
        previousMinimum = BigInt(tier.min_context_tokens);
        const rates = tier.prices_per_million;
        if (!rates || typeof rates !== "object" || Array.isArray(rates))
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.context_tiers.${index}.prices_per_million)`); }
        for (const key of ["input", "output", "cache_read", "cache_write"]) {
            if (!isDecimalPrice(rates[key]))
            { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.context_tiers.${index}.prices_per_million.${key})`); }
        }
        if (rates.reasoning !== undefined && !isDecimalPrice(rates.reasoning))
        { throw new Error(`Invalid pricing config: ${path} (model ${modelId}.context_tiers.${index}.prices_per_million.reasoning)`); }
    }
}

function isDecimalPrice(value) {
    return typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value);
}
