import assert from "node:assert/strict";
import {it} from "vitest";

import ContextPriceGuard from "../../.opencode/plugins/context-price-guard.js";

const DIRECTORY = "/repo";
const SESSION_ID = "ses_context_price_guard";

async function notifyAtFirstThreshold({providerID, modelID}) {
    const prompts = [];
    const hooks = await ContextPriceGuard({
        client: {
            session: {
                async prompt(options) {
                    prompts.push(options);
                },
            },
        },
        directory: DIRECTORY,
    });

    await hooks.event({
        event: {
            type: "message.updated",
            properties: {
                info: {
                    role: "assistant",
                    sessionID: SESSION_ID,
                    providerID,
                    modelID,
                },
            },
        },
    });
    await hooks.event({
        event: {
            type: "message.part.updated",
            properties: {
                part: {
                    type: "step-finish",
                    sessionID: SESSION_ID,
                    tokens: {
                        input: 230_000,
                        cache: {read: 0, write: 0},
                    },
                },
            },
        },
    });
    await hooks.event({
        event: {
            type: "session.status",
            properties: {
                sessionID: SESSION_ID,
                status: {type: "idle"},
            },
        },
    });

    return prompts;
}

it.each(["gpt-4o", "o3", "future-openai-model"])(
    "notifies for OpenAI model %s outside the former model allowlist",
    async (modelID) => {
        const prompts = await notifyAtFirstThreshold({providerID: "openai", modelID});

        assert.equal(prompts.length, 1);
        assert.match(prompts[0].body.parts[0].text, new RegExp(`Model: ${modelID}`));
        assert.match(prompts[0].body.parts[0].text, /CONTEXT HEADS-UP/);
    },
);

it("does not notify for models from other providers", async () => {
    const prompts = await notifyAtFirstThreshold({providerID: "anthropic", modelID: "claude-model"});

    assert.equal(prompts.length, 0);
});
