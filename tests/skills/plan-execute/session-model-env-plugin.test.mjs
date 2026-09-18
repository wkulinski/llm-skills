import assert from "node:assert/strict";
import {it} from "vitest";

import {SessionModelEnv} from "../../../.opencode/plugins/session-model-env.js";

const DIRECTORY = "/repo";
const SESSION_ID = "ses_test";

function messageFor(input, {variant, agent} = {}) {
    return {
        role: "user",
        sessionID: input.sessionID,
        agent: agent ?? input.agent,
        model: {
            providerID: input.model.providerID,
            modelID: input.model.modelID,
            variant: variant ?? input.variant,
        },
    };
}

async function harness({session = null, sessionError = null} = {}) {
    const calls = [];
    const client = {
        session: {
            async get(options) {
                calls.push(options);
                if (sessionError) {
                    throw sessionError;
                }
                return {data: session};
            },
        },
    };
    const hooks = await SessionModelEnv({client, directory: DIRECTORY});
    return {hooks, calls};
}

it("publishes the resolved model, variant and agent to shell commands", async () => {
    const {hooks, calls} = await harness();
    const input = {
        sessionID: SESSION_ID,
        agent: "build",
        model: {providerID: "commandcode", modelID: "deepseek/deepseek-v4.1-flash"},
        variant: "max",
    };
    await hooks["chat.message"](input, {message: messageFor(input), parts: []});

    const output = {env: {}};
    await hooks["shell.env"]({cwd: "/repo", sessionID: SESSION_ID, callID: "call_1"}, output);

    assert.deepEqual(output.env, {
        OPENCODE_SESSION_ID: SESSION_ID,
        OPENCODE_SESSION_MODEL: "commandcode/deepseek/deepseek-v4.1-flash",
        OPENCODE_SESSION_VARIANT: "max",
        OPENCODE_SESSION_AGENT: "build",
    });
    assert.equal(calls.length, 0, "a cached profile must not hit the session API");
});

it("falls back to the session API for a cold session", async () => {
    const {hooks, calls} = await harness({
        session: {
            agent: "build",
            model: {id: "deepseek/deepseek-v4.1-flash", providerID: "commandcode", variant: "high"},
        },
    });

    const output = {env: {}};
    await hooks["shell.env"]({cwd: "/repo", sessionID: SESSION_ID, callID: "call_1"}, output);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].path.id, SESSION_ID);
    assert.equal(calls[0].query.directory, DIRECTORY);
    assert.equal(output.env.OPENCODE_SESSION_MODEL, "commandcode/deepseek/deepseek-v4.1-flash");
    assert.equal(output.env.OPENCODE_SESSION_VARIANT, "high");
});

it("omits an unresolved neutral variant instead of guessing a rank", async () => {
    const {hooks} = await harness();
    const input = {
        sessionID: SESSION_ID,
        agent: "build",
        model: {providerID: "commandcode", modelID: "deepseek/deepseek-v4.1-flash"},
    };
    await hooks["chat.message"](input, {message: messageFor(input, {variant: "default"}), parts: []});

    const output = {env: {}};
    await hooks["shell.env"]({cwd: "/repo", sessionID: SESSION_ID}, output);

    assert.equal(output.env.OPENCODE_SESSION_MODEL, "commandcode/deepseek/deepseek-v4.1-flash");
    assert.equal("OPENCODE_SESSION_VARIANT" in output.env, false);
    assert.equal(output.env.OPENCODE_SESSION_ID, SESSION_ID);
});

it("never breaks the shell command when the session lookup fails", async () => {
    const {hooks} = await harness({sessionError: new Error("session not found")});

    const output = {env: {}};
    await hooks["shell.env"]({cwd: "/repo", sessionID: SESSION_ID}, output);

    assert.deepEqual(output.env, {OPENCODE_SESSION_ID: SESSION_ID});
});

it("ignores shell events without a session id", async () => {
    const {hooks, calls} = await harness();
    const output = {env: {}};
    await hooks["shell.env"]({cwd: "/repo"}, output);

    assert.deepEqual(output.env, {});
    assert.equal(calls.length, 0);
});

it("does not publish a profile when the session has no model yet", async () => {
    const {hooks} = await harness({session: {agent: "build"}});
    const output = {env: {}};
    await hooks["shell.env"]({cwd: "/repo", sessionID: SESSION_ID}, output);

    assert.deepEqual(output.env, {OPENCODE_SESSION_ID: SESSION_ID});
});

it("keeps the newest profile per session", async () => {
    const {hooks} = await harness();
    const first = {
        sessionID: SESSION_ID,
        agent: "build",
        model: {providerID: "commandcode", modelID: "model-a"},
        variant: "high",
    };
    await hooks["chat.message"](first, {message: messageFor(first), parts: []});

    const second = {
        sessionID: SESSION_ID,
        agent: "build",
        model: {providerID: "commandcode", modelID: "model-b"},
        variant: "max",
    };
    await hooks["chat.message"](second, {message: messageFor(second), parts: []});

    const output = {env: {}};
    await hooks["shell.env"]({cwd: "/repo", sessionID: SESSION_ID}, output);

    assert.equal(output.env.OPENCODE_SESSION_MODEL, "commandcode/model-b");
    assert.equal(output.env.OPENCODE_SESSION_VARIANT, "max");
});
