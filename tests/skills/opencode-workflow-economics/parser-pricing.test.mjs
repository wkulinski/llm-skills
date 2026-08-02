import {mkdtempSync, writeFileSync} from "node:fs";
import {rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {DEFAULT_CONFIG, loadPricing} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/config.mjs";
import {aggregateCost} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/costs.mjs";
import {parseTree} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/parser.mjs";
import {calculateStepCost} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/pricing.mjs";

const temporaryRoots = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {force: true, recursive: true})));
});

describe("OWE parser and cost accounting", () => {
    it("merges usage from message parts and step-finish", () => {
        const step = parseFixture([
            {type: "step-start"},
            {type: "text", tokens: {input: 100, cache: {read: 0, write: 0}}},
            {type: "step-finish", tokens: {output: 50, cache: {read: 0, write: 0}}, reason: "stop"},
        ]);

        expect(step.status).toBe("complete");
        expect(step.usage.input_tokens).toBe(100n);
        expect(step.usage.output_tokens).toBe(50n);
        expect(step.cost_status).toBe("complete");
        expect(step.api_equivalent_cost_nano).toBe(200_000n);
    });

    it("prices an incomplete step when all relevant usage is available", () => {
        const step = parseFixture([
            {type: "step-start"},
            {type: "text", tokens: {input: 100, output: 50, cache: {read: 0, write: 0}}},
        ]);

        expect(step.status).toBe("incomplete");
        expect(step.cost_status).toBe("complete");
        expect(step.api_equivalent_cost_nano).toBe(200_000n);
    });

    it("does not turn an incomplete step without usage into complete zero cost", () => {
        const cost = aggregateCost([{
            status: "incomplete",
            cost_status: "missing_usage",
            api_equivalent_cost_nano: null,
        }], "USD");

        expect(cost).toMatchObject({
            status: "incomplete",
            value_nano: null,
            priced_value_nano: 0n,
            priced_steps: 0,
            eligible_steps: 1,
        });
    });

    it("uses the long-context price tier above the configured token threshold", () => {
        const config = {
            version: 1,
            currency: "USD",
            models: {
                "openai/model": {
                    aliases: [],
                    reasoning_accounting: "included_in_output",
                    cache_read_accounting: "excluded",
                    cache_write_accounting: "excluded",
                    prices_per_million: {input: "1", output: "2", cache_read: "0", cache_write: "0"},
                    context_tiers: [{
                        name: "long_context",
                        min_context_tokens: "272001",
                        prices_per_million: {input: "2", output: "3", cache_read: "0", cache_write: "0"},
                    }],
                },
            },
        };
        const usage = {input_tokens: 300_000n, output_tokens: 1_000_000n, reasoning_tokens: 0n, cache_read_tokens: 0n, cache_write_tokens: 0n};

        const cost = calculateStepCost(config, {provider_id: "openai", model_id: "model", usage});

        expect(cost).toMatchObject({status: "complete", pricing_context_tier: "long_context", context_input_tokens: 300_000n});
        expect(cost.value_nano).toBe(3_600_000_000n);
    });

    it("normalizes custom tool aliases before every category-specific parser path", () => {
        const cases = [
            {native: "read", alias: "file_reader", category: "read", input: {filePath: "src/example.mjs"}},
            {native: "grep", alias: "repository_query", category: "search", input: {path: "src", pattern: "toolCategory", symbol: "parseTree"}},
            {native: "edit", alias: "file_editor", category: "write", input: {filePath: "src/example.mjs"}},
            {native: "bash", alias: "terminal", category: "shell", input: {command: "git status"}},
            {native: "task", alias: "delegate", category: "delegation", input: {prompt: "inspect the parser", subagent_type: "context-scout"}, metadata: {background: true}},
            {native: "skill", alias: "skill_loader", category: "skill", input: {name: "review-quick"}},
        ];

        for (const item of cases) {
            const nativeTool = parseToolFixture(item.native, item.input, DEFAULT_CONFIG, item.metadata);
            const customTool = parseToolFixture(item.alias, item.input, configWithMapping(item.alias, item.category), item.metadata);

            expect(customTool).toMatchObject({
                tool_category: nativeTool.tool_category,
                operation_category: nativeTool.operation_category,
                resource_keys: nativeTool.resource_keys,
                semantic_hint: nativeTool.semantic_hint,
                subagent_name: nativeTool.subagent_name,
                task_link_status: nativeTool.task_link_status,
                background: nativeTool.background,
            });
        }
    });

    it("links a custom delegation alias to its child session", () => {
        const alias = "delegate";
        const [parent] = parseTreeEntriesFixture(configWithMapping(alias, "delegation"), [
            {
                session: {id: "root", parent_id: null, created_at_ms: 1, updated_at_ms: 2},
                messages: [{
                    info: {role: "assistant", providerID: "provider", modelID: "model", time: {created: 1}},
                    parts: [
                        {type: "step-start"},
                        {
                            type: "tool",
                            tool: alias,
                            state: {
                                status: "completed",
                                input: {subagent_type: "context-scout"},
                                output: "",
                                metadata: {sessionId: "child"},
                            },
                        },
                    ],
                }],
            },
            {session: {id: "child", parent_id: "root", created_at_ms: 2, updated_at_ms: 3}, messages: []},
        ]);

        expect(parent.tools[0]).toMatchObject({
            tool_name: alias,
            tool_category: "delegation",
            task_link_status: "valid",
            child_session_id: "child",
        });
    });

    it("suppresses semantic hints for custom aliases in metadata mode", () => {
        const alias = "file_reader";
        const tool = parseToolFixture(
            alias,
            {filePath: "src/example.mjs"},
            configWithMapping(alias, "read"),
            {},
            "metadata",
        );

        expect(tool.semantic_hint).toBeNull();
        expect(tool.resource_keys.paths).toHaveLength(1);
    });
});

describe("OWE pricing validation", () => {
    it("rejects incomplete model definitions", async () => {
        const pricingPath = temporaryFile({version: 1, currency: "USD", models: {model: {}}});

        await expect(loadPricing(pricingPath)).rejects.toThrow("model model.aliases");
    });

    it("rejects aliases shared by multiple models", async () => {
        const pricingPath = temporaryFile({
            version: 1,
            currency: "USD",
            models: {
                first: validModel(["shared"]),
                second: validModel(["shared"]),
            },
        });

        await expect(loadPricing(pricingPath)).rejects.toThrow("duplicate model alias shared");
    });
});

function parseFixture(parts) {
    const config = structuredClone(DEFAULT_CONFIG);
    const step = parseTreeFixture(config, parts);
    return step.steps[0];
}

function parseToolFixture(toolName, input, config = DEFAULT_CONFIG, metadata = {}, mode = "compact") {
    const parsed = parseTreeFixture(config, [{
        type: "step-start",
    }, {
        type: "tool",
        tool: toolName,
        state: {status: "completed", input, output: "", metadata},
    }], mode);
    return parsed.tools[0];
}

function parseTreeFixture(config, parts, mode = "compact") {
    return parseTreeEntriesFixture(config, [{
        session: {id: "root", parent_id: null, created_at_ms: 1, updated_at_ms: 2},
        messages: [{
            info: {role: "assistant", providerID: "provider", modelID: "model", time: {created: 1}},
            parts,
        }],
    }], mode)[0];
}

function parseTreeEntriesFixture(config, tree, mode = "compact") {
    const pricing = {
        version: 1,
        currency: "USD",
        models: {"provider/model": validModel()},
    };
    return parseTree(tree, "root", config, pricing, mode);
}

function configWithMapping(name, category) {
    const config = structuredClone(DEFAULT_CONFIG);
    config.tool_mappings[name] = category;
    return config;
}

function validModel(aliases = []) {
    return {
        aliases,
        reasoning_accounting: "included_in_output",
        cache_read_accounting: "excluded",
        cache_write_accounting: "excluded",
        prices_per_million: {input: "1", output: "2", cache_read: "0", cache_write: "0"},
    };
}

function temporaryFile(value) {
    const root = mkdtempSync(path.join(os.tmpdir(), "owe-pricing-test-"));
    temporaryRoots.push(root);
    const file = path.join(root, "pricing.json");
    writeFileSync(file, JSON.stringify(value), "utf8");
    return file;
}
