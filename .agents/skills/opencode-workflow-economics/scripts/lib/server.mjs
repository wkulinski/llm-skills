import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {setTimeout as delay} from "node:timers/promises";

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_PROBE_TIMEOUT_MS = 2_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 2_000;

export async function withManagedServer(options, callback) {
    const mode = normalizeServerMode(options.mode ?? "auto");
    const baseUrl = normalizeBaseUrl(options.base_url);
    if (mode === "existing" || await probeServer(baseUrl, options.directory, options.fetch_impl, options.probe_timeout_ms))
    { return callback({base_url: baseUrl, managed: false}); }

    const attempts = 3;
    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const port = await findFreePort();
        let child = null;
        try {
            child = spawn(
                options.command ?? process.env.OWE_OPENCODE_BIN ?? "opencode",
                [
                    ...(options.command_args ?? []),
                    "serve",
                    "--hostname",
                    "127.0.0.1",
                    "--port",
                    String(port),
                ],
                {cwd: options.cwd, stdio: ["ignore", "pipe", "pipe"]},
            );
            const managedUrl = `http://127.0.0.1:${port}`;
            await waitForReady(child, managedUrl, options.directory, options.fetch_impl, options.startup_timeout_ms, options.probe_timeout_ms);
            try {
                return await callback({base_url: managedUrl, managed: true});
            } finally {
                await stopProcess(child, options.shutdown_timeout_ms);
            }
        } catch (error) {
            lastError = error;
            if (child) { await stopProcess(child, options.shutdown_timeout_ms); }
            if (!isPortCollision(error) || attempt === attempts - 1) { throw decorateStartError(error, child); }
        }
    }
    throw lastError ?? new Error("OpenCode server could not be started");
}

export async function probeServer(baseUrl, directory, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
    if (typeof fetchImpl !== "function") { return false; }
    const url = new URL(`${normalizeBaseUrl(baseUrl)}/session`);
    if (directory) { url.searchParams.set("directory", directory); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), positiveInteger(timeoutMs) ?? DEFAULT_PROBE_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, {headers: authHeaders(), signal: controller.signal});
        return response.ok;
    } catch {
        return false;
    } finally {
        clearTimeout(timer);
    }
}

export function normalizeServerMode(value) {
    if (value === "auto" || value === "existing") { return value; }
    throw new Error(`Invalid --server value: ${value}. Expected auto or existing.`);
}

async function waitForReady(child, baseUrl, directory, fetchImpl, timeoutMs = DEFAULT_STARTUP_TIMEOUT_MS, probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS) {
    const deadline = Date.now() + (positiveInteger(timeoutMs) ?? DEFAULT_STARTUP_TIMEOUT_MS);
    const output = [];
    let exited = null;
    let spawnError = null;
    child.stdout?.on("data", (chunk) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk) => output.push(String(chunk)));
    child.once("error", (error) => { spawnError = error; });
    child.once("exit", (code, signal) => { exited = {code, signal}; });

    while (Date.now() < deadline) {
        if (spawnError) { throw spawnError; }
        if (exited) { throw new Error(`OpenCode server exited before readiness (${formatExit(exited)}): ${output.join("").trim()}`); }
        if (await probeServer(baseUrl, directory, fetchImpl, probeTimeoutMs)) { return; }
        await delay(100);
    }
    throw new Error(`OpenCode server readiness timed out after ${timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS} ms: ${output.join("").trim()}`);
}

async function findFreePort() {
    const server = createServer();
    await new Promise((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolvePromise);
    });
    const port = server.address().port;
    await new Promise((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    return port;
}

async function stopProcess(child, timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS) {
    if (!child || child.exitCode !== null || child.signalCode !== null) { return; }
    const closed = new Promise((resolvePromise) => child.once("close", resolvePromise));
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), positiveInteger(timeoutMs) ?? DEFAULT_SHUTDOWN_TIMEOUT_MS);
    await closed;
    clearTimeout(timer);
}

function normalizeBaseUrl(value) {
    const baseUrl = String(value ?? "http://localhost:4096").replace(/\/+$/, "");
    try {
        new URL(baseUrl);
    } catch {
        throw new Error(`Invalid OpenCode base URL: ${value}`);
    }
    return baseUrl;
}

function authHeaders() {
    const password = process.env.OPENCODE_SERVER_PASSWORD;
    if (!password) { return {accept: "application/json"}; }
    const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
    return {
        accept: "application/json",
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    };
}

function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function isPortCollision(error) {
    return /EADDRINUSE|address already in use/i.test(String(error?.message ?? error));
}

function decorateStartError(error, child) {
    if (error?.code === "ENOENT") { return new Error("OpenCode executable not found. Set OWE_OPENCODE_BIN or install opencode."); }
    if (child && error instanceof Error && !error.message.includes("OpenCode")) { return new Error(`OpenCode server failed: ${error.message}`); }
    return error;
}

function formatExit(exit) {
    return exit.signal ? `signal ${exit.signal}` : `code ${exit.code}`;
}
