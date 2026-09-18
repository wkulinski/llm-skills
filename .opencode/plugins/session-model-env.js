// Exposes the model + reasoning profile of the current OpenCode session to every
// agent shell command, so deterministic skill helpers can read it instead of
// asking the user or scraping logs.
//
// Contract (documented in README.md):
//   OPENCODE_SESSION_MODEL   - "provider/model" exactly as used by model-hierarchy.json
//   OPENCODE_SESSION_VARIANT - resolved reasoning variant, e.g. "high" / "max"
//   OPENCODE_SESSION_AGENT   - agent name, e.g. "build"
//   OPENCODE_SESSION_ID      - session id, useful for diagnostics
//
// OPENCODE_SESSION_VARIANT is intentionally omitted when the runtime reports the
// neutral "default" variant, so consumers fail closed instead of guessing a rank.

const CACHE_LIMIT = 500;

export const SessionModelEnv = async ({client, directory}) => {
    const sessions = new Map();
    return {
        "chat.message": async (input, output) => {
            try {
                const profile = profileFromMessage(input, output);
                remember(sessions, input?.sessionID, profile);
            } catch {
                // Session metadata must never break a prompt.
            }
        },
        "shell.env": async (input, output) => {
            try {
                if (!input?.sessionID) {
                    return;
                }
                output.env.OPENCODE_SESSION_ID = input.sessionID;
                const profile = sessions.get(input.sessionID)
                    ?? profileFromApi(await lookup(client, directory, input.sessionID));
                remember(sessions, input.sessionID, profile);
                if (profile) {
                    writeProfile(output.env, profile);
                }
            } catch {
                // A failed lookup must not break the shell command.
            }
        },
    };
};

function profileFromMessage(input, output) {
    const message = output?.message ?? {};
    const model = message.model ?? input?.model ?? {};
    return buildProfile({
        providerID: model.providerID,
        modelID: model.modelID ?? model.id,
        variant: model.variant ?? input?.variant,
        agent: input?.agent ?? message.agent,
    });
}

function profileFromApi(session) {
    const model = session?.model ?? {};
    return buildProfile({
        providerID: model.providerID,
        modelID: model.id ?? model.modelID,
        variant: model.variant,
        agent: session?.agent,
    });
}

async function lookup(client, directory, sessionID) {
    const response = await client.session.get({
        path: {id: sessionID},
        query: {directory},
    });
    return response?.data;
}

function buildProfile({providerID, modelID, variant, agent}) {
    const provider = nonEmpty(providerID);
    const model = nonEmpty(modelID);
    if (!provider || !model) {
        return null;
    }
    return {
        model: `${provider}/${model}`,
        variant: resolvedVariant(variant),
        agent: nonEmpty(agent),
    };
}

function resolvedVariant(value) {
    const variant = nonEmpty(value);
    return variant === "default" ? null : variant;
}

function writeProfile(env, profile) {
    env.OPENCODE_SESSION_MODEL = profile.model;
    if (profile.variant) {
        env.OPENCODE_SESSION_VARIANT = profile.variant;
    }
    if (profile.agent) {
        env.OPENCODE_SESSION_AGENT = profile.agent;
    }
}

function remember(sessions, sessionID, profile) {
    if (!sessionID || !profile) {
        return;
    }
    if (sessions.has(sessionID)) {
        sessions.delete(sessionID);
    }
    sessions.set(sessionID, profile);
    if (sessions.size > CACHE_LIMIT) {
        sessions.delete(sessions.keys().next().value);
    }
}

function nonEmpty(value) {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
}
