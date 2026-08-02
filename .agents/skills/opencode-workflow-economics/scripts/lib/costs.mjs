const STATUS_PRECEDENCE = [
    "incomplete",
    "missing_usage",
    "unsupported_accounting",
    "missing_pricing",
];

export function aggregateCost(steps, currency) {
    return aggregateCostRecords(
        steps.filter(isObservedStep).map((step) => costRecordFromStep(step, currency)),
        currency,
    );
}

export function costRecordFromStep(step, currency) {
    const eligible = isObservedStep(step) ? 1 : 0;
    const priced = eligible === 1 && step.cost_status === "complete" && step.api_equivalent_cost_nano != null ? 1 : 0;
    const status = step.status === "incomplete"
        ? "incomplete"
        : priced === 1
            ? "complete"
            : step.cost_status ?? "missing_pricing";

    return {
        status,
        value_nano: status === "complete" ? step.api_equivalent_cost_nano : null,
        priced_value_nano: priced === 1 ? step.api_equivalent_cost_nano : 0n,
        priced_steps: priced,
        eligible_steps: eligible,
        currency,
    };
}

export function aggregateCostRecords(records, currency) {
    const resolvedCurrency = validateCurrencies(records, currency);
    const eligible = records.reduce((sum, record) => sum + record.eligible_steps, 0);
    const priced = records.reduce((sum, record) => sum + record.priced_steps, 0);
    const pricedValue = records.reduce((sum, record) => sum + (record.priced_value_nano ?? 0n), 0n);
    const status = statusFor(records, eligible, priced);

    return {
        status,
        value_nano: status === "complete" ? pricedValue : null,
        priced_value_nano: pricedValue,
        priced_steps: priced,
        eligible_steps: eligible,
        currency: resolvedCurrency,
    };
}

function statusFor(records, eligible, priced) {
    if (eligible === priced && !records.some((record) => record.status === "incomplete"))
    { return "complete"; }
    return STATUS_PRECEDENCE.find((status) => records.some((record) => record.status === status)) ?? "missing_pricing";
}

export function isObservedStep(step) {
    return step.status === "complete" || step.status === "incomplete";
}

function validateCurrencies(records, currency) {
    const currencies = [...new Set(records.map((record) => record.currency).filter(Boolean))];
    if (currency && currencies.some((value) => value !== currency))
    { throw new Error(`Cost currency mismatch: expected ${currency}, got ${currencies.find((value) => value !== currency)}`); }
    if (currencies.length > 1)
    { throw new Error(`Cost currency mismatch: ${currencies.join(", ")}`); }
    return currency ?? currencies[0] ?? "unknown";
}
