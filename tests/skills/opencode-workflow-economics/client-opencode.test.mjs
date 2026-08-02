import {describe, expect, it, afterEach} from "vitest";

import {createClient} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/client.mjs";
import {mapConcurrent, sourceMessages, sourceSession} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/opencode.mjs";

const originalFetch = globalThis.fetch;
const originalUsername = process.env.OPENCODE_SERVER_USERNAME;
const originalPassword = process.env.OPENCODE_SERVER_PASSWORD;

afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnvironment("OPENCODE_SERVER_USERNAME", originalUsername);
    restoreEnvironment("OPENCODE_SERVER_PASSWORD", originalPassword);
});

describe("OWE OpenCode client", () => {
    it("passes directory query and Basic Auth to the session endpoint", async () => {
        const calls = [];
        process.env.OPENCODE_SERVER_USERNAME = "tester";
        process.env.OPENCODE_SERVER_PASSWORD = "secret";
        globalThis.fetch = async (url, options) => {
            calls.push({url: String(url), options});
            return new Response(JSON.stringify({sessions: []}), {status: 200});
        };

        const result = await createClient("http://localhost:4096/").session.list({query: {directory: "/tmp/demo"}});

        expect(result).toEqual({sessions: []});
        expect(calls[0].url).toBe("http://localhost:4096/session?directory=%2Ftmp%2Fdemo");
        expect(calls[0].options.headers.authorization).toBe(`Basic ${Buffer.from("tester:secret").toString("base64")}`);
    });

    it("reports non-successful OpenCode responses", async () => {
        globalThis.fetch = async () => new Response(JSON.stringify({message: "bad request"}), {status: 400});

        await expect(createClient("http://localhost:4096").session.list()).rejects.toThrow("OpenCode HTTP 400");
    });
});

describe("OWE OpenCode payload normalization", () => {
    it("normalizes session aliases and timestamps", () => {
        expect(sourceSession({sessionID: "s1", parentID: "root", time: {created: "10", updated: 20}})).toMatchObject({
            id: "s1",
            parent_id: "root",
            created_at_ms: 10n,
            updated_at_ms: 20n,
        });
    });

    it("sorts messages by creation time", () => {
        const messages = sourceMessages([
            {info: {id: "b", role: "assistant", time: {created: 2}}, parts: []},
            {info: {id: "a", role: "user", time: {created: 1}}, parts: []},
        ]);

        expect(messages.map((message) => message.info.id)).toEqual(["a", "b"]);
    });

    it("preserves input order while limiting concurrent workers", async () => {
        let active = 0;
        let maximum = 0;
        const result = await mapConcurrent([1, 2, 3, 4], 2, async (value) => {
            active += 1;
            maximum = Math.max(maximum, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return value * 2;
        });

        expect(result).toEqual([2, 4, 6, 8]);
        expect(maximum).toBeLessThanOrEqual(2);
    });
});

function restoreEnvironment(key, value) {
    if (typeof value === "undefined") { delete process.env[key]; }
    else { process.env[key] = value; }
}
