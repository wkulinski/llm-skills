import {setTimeout as delay} from "node:timers/promises";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_COUNT = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

export function createClient(baseUrl, options = {}) {
    const normalizedBaseUrl = String(baseUrl || "http://localhost:4096").replace(/\/+$/, "");
    const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
    const retryCount = nonNegativeInteger(options.retryCount, DEFAULT_RETRY_COUNT);
    const retryDelayMs = positiveInteger(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);

    async function request(path, requestOptions = {}) {
        const url = new URL(`${normalizedBaseUrl}${path}`);
        for (const [key, value] of Object.entries(requestOptions.query ?? {})) {
            if (value !== undefined && value !== null && value !== "") { url.searchParams.set(key, String(value)); }
        }

        for (let attempt = 0; attempt <= retryCount; attempt += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, {
                    method: requestOptions.method ?? "GET",
                    headers: buildHeaders(),
                    signal: controller.signal,
                });
                const text = await response.text();
                const payload = text === "" ? null : parseJson(text, response.status);
                if (!response.ok) {
                    const detail = typeof payload === "object" && payload !== null
                        ? JSON.stringify(payload)
                        : String(payload ?? response.statusText);
                    if (attempt < retryCount && retryableStatus(response.status)) {
                        await delay(retryDelayMs * (attempt + 1));
                        continue;
                    }
                    throw new Error(`OpenCode HTTP ${response.status}: ${detail}`);
                }
                return payload;
            } catch (error) {
                const retryable = attempt < retryCount && (error?.name === "AbortError" || isTransientNetworkError(error));
                if (retryable) {
                    await delay(retryDelayMs * (attempt + 1));
                    continue;
                }
                if (error?.name === "AbortError") { throw new Error(`OpenCode request timed out after ${timeoutMs} ms: ${url}`); }
                throw error;
            } finally {
                clearTimeout(timer);
            }
        }
        throw new Error(`OpenCode request failed after ${retryCount + 1} attempts: ${url}`);
    }

    function pathAndQuery(options = {}) {
        const id = options?.path?.id;
        const directory = options?.query?.directory;
        return { id, query: directory ? { directory } : {} };
    }

    return {
        session: {
            list(options = {}) {
                return request("/session", { query: options?.query ?? {} });
            },
            get(options = {}) {
                const { id, query } = pathAndQuery(options);
                requireId(id);
                return request(`/session/${encodeURIComponent(id)}`, { query });
            },
            children(options = {}) {
                const { id, query } = pathAndQuery(options);
                requireId(id);
                return request(`/session/${encodeURIComponent(id)}/children`, { query });
            },
            messages(options = {}) {
                const { id, query } = pathAndQuery(options);
                requireId(id);
                return request(`/session/${encodeURIComponent(id)}/message`, { query });
            },
        },
    };
}

function buildHeaders() {
    const headers = { accept: "application/json" };
    const password = process.env.OPENCODE_SERVER_PASSWORD;
    if (password) {
        const username = process.env.OPENCODE_SERVER_USERNAME || "opencode";
        headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    }
    return headers;
}

function parseJson(text, status) {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`OpenCode returned invalid JSON (HTTP ${status})`);
    }
}

function requireId(id) {
    if (typeof id !== "string" || id === "") { throw new Error("Missing OpenCode session id"); }
}

function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function retryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}

function isTransientNetworkError(error) {
    return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(error?.code);
}
