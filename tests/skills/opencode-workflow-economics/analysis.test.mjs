import {describe, expect, it} from "vitest";

import {aggregateDelegationEconomics, detectHybridAttempts} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/analysis.mjs";

describe("OWE hybrid fallback diagnostics", () => {
    const config = {
        hybrid_families: [{
            name: "scout",
            primary_agents: ["fast"],
            fallback_agents: ["strong"],
        }],
    };

    it("pairs only the nearest primary with the fallback", () => {
        const attempts = detectHybridAttempts([
            delegation("primary-1", 1, "fast"),
            delegation("primary-2", 2, "fast"),
            delegation("fallback", 3, "strong"),
        ], config, "USD");

        expect(attempts).toHaveLength(1);
        expect(attempts[0]).toMatchObject({
            primary_delegation_id: "primary-2",
            fallback_delegation_id: "fallback",
        });
    });

    it("does not pair a fallback across an unrelated delegation", () => {
        const attempts = detectHybridAttempts([
            delegation("primary", 1, "fast"),
            delegation("other", 2, "different"),
            delegation("fallback", 3, "strong"),
        ], config, "USD");

        expect(attempts).toEqual([]);
    });

    it("ignores unlinked delegations", () => {
        const attempts = detectHybridAttempts([
            {...delegation("primary", 1, "fast"), link_status: "unlinked"},
            delegation("fallback", 2, "strong"),
        ], config, "USD");

        expect(attempts).toEqual([]);
    });

    it("aggregates delegation and fallback economics with pricing coverage", () => {
        const primary = delegation("primary", 1, "fast");
        const fallback = delegation("fallback", 2, "strong");
        const fallbackCost = cost(5n);
        const result = aggregateDelegationEconomics([{
            delegations: [primary, fallback],
            hybrid_attempts: [{
                id: "primary->fallback",
                family: "scout",
                primary_delegation_id: "primary",
                fallback_delegation_id: "fallback",
                primary_cost: primary.child_subtree_cost,
                fallback_cost: fallbackCost,
                combined_subtree_cost: cost(6n),
            }],
        }], "USD");

        expect(result.totals).toMatchObject({total_delegations: 2, linked_delegations: 2, fallback_attempts: 1});
        expect(result.totals.child_subtree_cost).toMatchObject({value_nano: 2n, priced_steps: 2, eligible_steps: 2});
        expect(result.totals.fallback_additional_cost).toMatchObject({value_nano: 1n, priced_steps: 1, eligible_steps: 1});
        expect(result.by_subagent.find((item) => item.subagent === "strong").fallback_additional_cost)
            .toMatchObject({value_nano: 1n, status: "complete"});
    });
});

function delegation(id, ordinal, subagent) {
    return {
        id,
        link_status: "valid",
        parent_session_id: "root",
        parent_step_ordinal: ordinal,
        root_session_id: "root",
        subagent_name: subagent,
        child_session_id: `${id}-child`,
        parent_delegating_step_cost: cost(1n),
        child_direct_cost: cost(1n),
        child_subtree_cost: cost(1n),
        child_output_bytes: 10n,
        parent_followup: {cost: cost(1n)},
    };
}

function cost(value) {
    return {
        status: "complete",
        value_nano: value,
        priced_value_nano: value,
        priced_steps: 1,
        eligible_steps: 1,
        currency: "USD",
    };
}
