import {describe, expect, it} from "vitest";

import {aggregateCost, aggregateCostRecords} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/costs.mjs";

describe("OWE cost aggregation contract", () => {
    it.each([
        ["complete", completeStep(), {status: "complete", value_nano: 12n, priced_value_nano: 12n, priced_steps: 1, eligible_steps: 1}],
        ["incomplete with full usage", incompleteStep("complete", 7n), {status: "incomplete", value_nano: null, priced_value_nano: 7n, priced_steps: 1, eligible_steps: 1}],
        ["incomplete without usage", incompleteStep("missing_usage", null), {status: "incomplete", value_nano: null, priced_value_nano: 0n, priced_steps: 0, eligible_steps: 1}],
        ["missing pricing", completeStep("missing_pricing", null), {status: "missing_pricing", value_nano: null, priced_value_nano: 0n, priced_steps: 0, eligible_steps: 1}],
        ["unsupported accounting", completeStep("unsupported_accounting", null), {status: "unsupported_accounting", value_nano: null, priced_value_nano: 0n, priced_steps: 0, eligible_steps: 1}],
    ])("aggregates %s steps", (_name, step, expected) => {
        expect(aggregateCost([step], "USD")).toMatchObject({...expected, currency: "USD"});
    });

    it("uses one precedence order for mixed cost records", () => {
        expect(aggregateCostRecords([
            record("complete", 1n),
            record("missing_pricing"),
            record("unsupported_accounting"),
            record("missing_usage"),
        ], "USD")).toMatchObject({
            status: "missing_usage",
            value_nano: null,
            priced_value_nano: 1n,
            priced_steps: 1,
            eligible_steps: 4,
            currency: "USD",
        });
    });

    it("rejects cost records with different currencies", () => {
        expect(() => aggregateCostRecords([record("complete", 1n, "USD"), record("complete", 2n, "EUR")])).toThrow("Cost currency mismatch");
    });
});

function completeStep(costStatus = "complete", cost = 12n) {
    return {status: "complete", cost_status: costStatus, api_equivalent_cost_nano: cost};
}

function incompleteStep(costStatus, cost) {
    return {status: "incomplete", cost_status: costStatus, api_equivalent_cost_nano: cost};
}

function record(status, value = 0n, currency = "USD") {
    return {
        status,
        value_nano: status === "complete" ? value : null,
        priced_value_nano: status === "complete" ? value : 0n,
        priced_steps: status === "complete" ? 1 : 0,
        eligible_steps: 1,
        currency,
    };
}
