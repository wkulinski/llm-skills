const TOKEN_WARNING_THRESHOLD = 272_000;

const LEVELS = [
    {
        level: 1,
        min: 230_000,
        label: "CONTEXT HEADS-UP",
        recommendation:
      "Context is getting large. No action is required yet, but consider finishing the current subtask before starting another large one.",
    },
    {
        level: 2,
        min: 240_000,
        label: "HANDOFF RECOMMENDED",
        recommendation:
      "Recommended: prepare a handoff soon and continue in a fresh session. This leaves a comfortable margin for generating the handoff itself.",
    },
    {
        level: 3,
        min: 250_000,
        label: "HANDOFF NOW",
        recommendation:
      "Prepare the handoff now and continue in a fresh session. The remaining margin to long-context pricing is becoming small.",
    },
    {
        level: 4,
        min: 265_000,
        label: "CRITICAL CONTEXT",
        recommendation:
      "Avoid starting another large task or tool-heavy turn. Generate only the handoff needed to continue in a fresh session.",
    },
    {
        level: 5,
        min: TOKEN_WARNING_THRESHOLD + 1,
        label: "HIGH TOKEN USE",
        recommendation:
      "The configured token warning threshold was crossed. Check this model's context and pricing limits before continuing.",
    },
];

function isOpenAIProvider(providerID) {
    return providerID === "openai";
}

function getLevel(tokens) {
    let result = 0;

    for (const item of LEVELS) {
        if (tokens >= item.min) {
            result = item.level;
        }
    }

    return result;
}

function formatNumber(value) {
    return Math.round(value).toLocaleString("en-US");
}

function buildMessage(tokens, level, modelID) {
    const percent = (tokens / TOKEN_WARNING_THRESHOLD) * 100;
    const remaining = TOKEN_WARNING_THRESHOLD - tokens;
    const levelConfig = LEVELS.find((item) => item.level === level);
    const label = levelConfig?.label ?? "CONTEXT";

    const lines = [
        `[Context Price Guard] ${label}`,
        `Model: ${modelID}`,
        `Last request input: ${formatNumber(tokens)} / ${formatNumber(TOKEN_WARNING_THRESHOLD)} tokens (${percent.toFixed(1)}%)`,
    ];

    if (remaining >= 0) {
        lines.push(
            `${formatNumber(remaining)} tokens remaining before the configured high-token threshold.`,
        );
    } else {
        lines.push(
            `Configured high-token threshold exceeded by ${formatNumber(Math.abs(remaining))} tokens; this model's context and pricing limits may differ.`,
        );
    }

    if (levelConfig?.recommendation) {
        lines.push(`Recommendation: ${levelConfig.recommendation}`);
    }

    return lines.join("\n");
}

export default async function ContextPriceGuard({ client, directory }) {
    const sessions = new Map();
    const publishing = new Set();

    function state(sessionID) {
        let current = sessions.get(sessionID);

        if (!current) {
            current = {
                inputTokens: 0,
                providerID: null,
                modelID: null,
                notifiedLevel: 0,
            };

            sessions.set(sessionID, current);
        }

        return current;
    }

    async function publishIfNeeded(sessionID) {
        if (publishing.has(sessionID)) { return; }

        const current = state(sessionID);

        if (!current.providerID || !current.modelID) { return; }
        if (!isOpenAIProvider(current.providerID)) { return; }
        if (current.inputTokens <= 0) { return; }

        const level = getLevel(current.inputTokens);

        if (level < current.notifiedLevel) {
            current.notifiedLevel = level;
            return;
        }

        if (level === 0 || level <= current.notifiedLevel) { return; }

        const text = buildMessage(
            current.inputTokens,
            level,
            current.modelID,
        );

        publishing.add(sessionID);

        try {
            await client.session.prompt({
                path: { id: sessionID },
                query: { directory },
                body: {
                    noReply: true,
                    parts: [
                        {
                            type: "text",
                            text,
                            ignored: true,
                        },
                    ],
                },
            });

            current.notifiedLevel = level;
        } catch (error) {
            console.warn(
                "[context-price-guard] Could not publish notification:",
                error,
            );
        } finally {
            publishing.delete(sessionID);
        }
    }

    return {
        event: async ({ event }) => {
            if (event.type === "message.updated") {
                const info = event.properties.info;

                if (info.role === "assistant") {
                    const current = state(info.sessionID);
                    current.providerID = info.providerID;
                    current.modelID = info.modelID;
                }

                return;
            }

            if (event.type === "message.part.updated") {
                const part = event.properties.part;

                if (part.type !== "step-finish") { return; }

                const current = state(part.sessionID);

                current.inputTokens =
                    part.tokens.input +
                    part.tokens.cache.read +
                    part.tokens.cache.write;

                return;
            }

            if (
                event.type === "session.status" &&
                event.properties.status.type === "idle"
            ) {
                await publishIfNeeded(event.properties.sessionID);
                return;
            }

            if (event.type === "session.deleted") {
                sessions.delete(event.properties.info.id);
                publishing.delete(event.properties.info.id);
            }
        },
    };
}
