import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {resolve} from "node:path";

import {afterEach, describe, expect, it} from "vitest";

import {probeServer, withManagedServer} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/server.mjs";

const temporaryRoots = [];
const processes = [];

afterEach(async () => {
    await Promise.all(processes.splice(0).map((child) => stop(child)));
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {force: true, recursive: true})));
});

describe("OWE managed OpenCode server", () => {
    it("starts on a dynamic port and cleans up after the callback", async () => {
        const fake = await fakeServer();
        let managedUrl;

        await withManagedServer({
            base_url: "http://127.0.0.1:9",
            directory: "/tmp/project",
            command: process.execPath,
            command_args: [fake],
        }, async (server) => {
            managedUrl = server.base_url;
            expect(server.managed).toBe(true);
            expect(await probeServer(server.base_url, "/tmp/project")).toBe(true);
        });

        expect(managedUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        expect(await probeServer(managedUrl, "/tmp/project")).toBe(false);
    });

    it("reuses an already running server without stopping it", async () => {
        const fake = await fakeServer();
        const external = await startFake(fake);
        processes.push(external.child);

        await withManagedServer({base_url: external.url, directory: "/tmp/project"}, async (server) => {
            expect(server).toEqual({base_url: external.url, managed: false});
        });

        expect(await probeServer(external.url, "/tmp/project")).toBe(true);
    });

    it("does not start a process in existing mode", async () => {
        await withManagedServer({base_url: "http://127.0.0.1:9", mode: "existing"}, async (server) => {
            expect(server).toEqual({base_url: "http://127.0.0.1:9", managed: false});
        });
    });

    it("cleans up when the callback fails", async () => {
        const fake = await fakeServer();
        let managedUrl;

        await expect(withManagedServer({
            base_url: "http://127.0.0.1:9",
            directory: "/tmp/project",
            command: process.execPath,
            command_args: [fake],
        }, async (server) => {
            managedUrl = server.base_url;
            throw new Error("analysis failed");
        })).rejects.toThrow("analysis failed");

        expect(await probeServer(managedUrl, "/tmp/project")).toBe(false);
    });

    it("reports a missing OpenCode executable clearly", async () => {
        await expect(withManagedServer({
            base_url: "http://127.0.0.1:9",
            command: resolve(tmpdir(), "missing-opencode"),
            startup_timeout_ms: 250,
        }, async () => null)).rejects.toThrow("OpenCode executable not found");
    });

    it("times out and cleans up when readiness never arrives", async () => {
        const idle = await idleServer();

        await expect(withManagedServer({
            base_url: "http://127.0.0.1:9",
            command: process.execPath,
            command_args: [idle],
            startup_timeout_ms: 150,
            shutdown_timeout_ms: 250,
        }, async () => null)).rejects.toThrow("readiness timed out");
    });

    it("uses different ports for concurrent managed servers", async () => {
        const fake = await fakeServer();
        const urls = await Promise.all([1, 2].map(async () => withManagedServer({
            base_url: "http://127.0.0.1:9",
            directory: "/tmp/project",
            command: process.execPath,
            command_args: [fake],
        }, async (server) => {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
            return server.base_url;
        })));

        expect(new Set(urls).size).toBe(2);
    });
});

async function fakeServer() {
    const root = await mkdtemp(resolve(tmpdir(), "owe-server-test-"));
    temporaryRoots.push(root);
    const script = resolve(root, "fake-server.mjs");
    await writeFile(script, `
import {createServer} from "node:http";
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const server = createServer((request, response) => {
  if (request.url.startsWith("/session")) {
    response.writeHead(200, {"content-type": "application/json"});
    response.end(JSON.stringify({sessions: []}));
    return;
  }
  response.writeHead(404);
  response.end();
});
server.listen(port, "127.0.0.1", () => console.log("opencode server listening"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`, "utf8");
    return script;
}

async function idleServer() {
    const root = await mkdtemp(resolve(tmpdir(), "owe-server-idle-test-"));
    temporaryRoots.push(root);
    const script = resolve(root, "idle-server.mjs");
    await writeFile(script, "setInterval(() => {}, 1000);\n", "utf8");
    return script;
}

async function startFake(script) {
    const probe = await getFreePort();
    const child = spawn(process.execPath, [script, "--port", String(probe)], {stdio: ["ignore", "ignore", "ignore"]});
    const url = `http://127.0.0.1:${probe}`;
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (await probeServer(url, "/tmp/project")) { return {child, url}; }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    }
    await stop(child);
    throw new Error("Fake server did not start");
}

async function getFreePort() {
    const {createServer} = await import("node:net");
    const server = createServer();
    await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolvePromise);
    });
    const port = server.address().port;
    await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    return port;
}

async function stop(child) {
    if (!child || child.exitCode !== null) { return; }
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => child.once("close", resolvePromise));
}
