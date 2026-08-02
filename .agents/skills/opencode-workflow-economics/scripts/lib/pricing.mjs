import { sha256 } from "./util.mjs";
const NANO_PER_UNIT = 1000000000n;
const TOKENS_PER_MILLION = 1000000n;
const ROUNDING_OFFSET = TOKENS_PER_MILLION / 2n;
export function canonicalModelId(providerId, modelId) {
    const model = modelId.trim();
    const provider = providerId?.trim() || null;
    if (!provider)
    { return model; }
    return model.startsWith(`${provider}/`) ? model : `${provider}/${model}`;
}
export function parseDecimalNano(value) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value))
    { throw new Error(`Invalid decimal price: ${value}`); }
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * NANO_PER_UNIT + BigInt(fraction.padEnd(9, "0") || "0");
}
function priceTokens(tokens, priceNanoPerMillion) {
    if (tokens < 0n)
    { throw new Error("Token usage cannot be negative"); }
    return (tokens * priceNanoPerMillion + ROUNDING_OFFSET) / TOKENS_PER_MILLION;
}
export function resolvePricing(config, providerId, modelId) {
    const canonical = canonicalModelId(providerId, modelId);
    const direct = config.models[canonical];
    if (direct)
    { return { id: canonical, model: direct }; }
    for (const [id, model] of Object.entries(config.models)) {
        if (model.aliases.includes(canonical) || model.aliases.includes(modelId))
        { return { id, model }; }
    }
    return null;
}
export function calculateStepCost(config, input) {
    if (!input.model_id)
    { return empty("missing_pricing", null); }
    const resolved = resolvePricing(config, input.provider_id, input.model_id);
    if (!resolved)
    { return empty("missing_pricing", null); }
    const usage = input.usage;
    if (usage.input_tokens === null
        || usage.output_tokens === null
        || usage.cache_read_tokens === null
        || usage.cache_write_tokens === null)
    { return empty("missing_usage", resolved.id); }
    const values = [usage.input_tokens, usage.output_tokens, usage.reasoning_tokens ?? 0n, usage.cache_read_tokens, usage.cache_write_tokens];
    if (values.some((value) => value < 0n))
    { return empty("unsupported_accounting", resolved.id); }
    const model = resolved.model;
    if ((usage.cache_read_tokens > 0n && model.cache_read_accounting === "unknown")
        || (usage.cache_write_tokens > 0n && model.cache_write_accounting === "unknown")) {
        return empty("unsupported_accounting", resolved.id);
    }
    let contextInput = usage.input_tokens;
    let uncachedInput = usage.input_tokens;
    if (model.cache_read_accounting === "excluded")
    { contextInput += usage.cache_read_tokens; }
    if (model.cache_write_accounting === "excluded")
    { contextInput += usage.cache_write_tokens; }
    if (model.cache_read_accounting === "included")
    { uncachedInput -= usage.cache_read_tokens; }
    if (model.cache_write_accounting === "included")
    { uncachedInput -= usage.cache_write_tokens; }
    if (uncachedInput < 0n)
    { return empty("unsupported_accounting", resolved.id); }
    const rates = selectRates(model, contextInput);
    const pricingContextTier = rates === model.prices_per_million
        ? "base"
        : model.context_tiers.findLast((tier) => tier.prices_per_million === rates)?.name ?? "context_tier";
    const inputCost = priceTokens(uncachedInput, parseDecimalNano(rates.input));
    const outputCost = priceTokens(usage.output_tokens, parseDecimalNano(rates.output));
    const cacheReadCost = priceTokens(usage.cache_read_tokens, parseDecimalNano(rates.cache_read));
    const cacheWriteCost = priceTokens(usage.cache_write_tokens, parseDecimalNano(rates.cache_write));
    const reasoning = usage.reasoning_tokens ?? 0n;
    const reasoningCost = model.reasoning_accounting === "ignore"
        ? 0n
        : model.reasoning_accounting === "included_in_output"
            ? priceTokens(reasoning, parseDecimalNano(rates.output))
            : priceTokens(reasoning, parseDecimalNano(rates.reasoning ?? rates.output));
    return {
        pricing_model_id: resolved.id,
        pricing_context_tier: pricingContextTier,
        status: "complete",
        value_nano: inputCost + outputCost + reasoningCost + cacheReadCost + cacheWriteCost,
        context_input_tokens: contextInput,
        uncached_input_tokens: uncachedInput,
    };
}

function selectRates(model, contextInput) {
    const tier = (model.context_tiers ?? [])
        .filter((item) => BigInt(item.min_context_tokens) <= contextInput)
        .at(-1);
    return tier?.prices_per_million ?? model.prices_per_million;
}

function empty(status, pricingModelId) {
    return {
        pricing_model_id: pricingModelId,
        pricing_context_tier: null,
        status,
        value_nano: null,
        context_input_tokens: null,
        uncached_input_tokens: null,
    };
}
function normalizedModel(model) {
    return {
        aliases: [...new Set(model.aliases)].sort(),
        reasoning_accounting: model.reasoning_accounting,
        cache_read_accounting: model.cache_read_accounting,
        cache_write_accounting: model.cache_write_accounting,
        prices_per_million: model.prices_per_million,
        context_tiers: model.context_tiers ?? [],
    };
}
export function calculatePricingHashes(config) {
    const models = Object.fromEntries(Object.entries(config.models).sort().map(([id, model]) => [id, normalizedModel(model)]));
    const accounting = Object.fromEntries(Object.entries(config.models).sort().map(([id, model]) => [id, {
        aliases: [...new Set(model.aliases)].sort(),
        reasoning_accounting: model.reasoning_accounting,
        cache_read_accounting: model.cache_read_accounting,
        cache_write_accounting: model.cache_write_accounting,
    }]));
    return {
        pricing_config_hash: sha256({ version: config.version, currency: config.currency, models }),
        usage_accounting_hash: sha256(accounting),
    };
}
