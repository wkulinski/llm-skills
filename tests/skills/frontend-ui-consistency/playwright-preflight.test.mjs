import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SCRIPT = path.join(ROOT, ".agents/skills/frontend-ui-consistency/scripts/playwright-preflight.sh");
const BASH = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"].find((candidate) => existsSync(candidate)) ?? "bash";

function writeExecutable(filePath, content) {
    writeFileSync(filePath, content, "utf8");
    chmodSync(filePath, 0o755);
}

function stubCli() {
    return `#!${BASH}
printf '%s\\n' "$*" >> "\${PW_CLI_LOG:?}"
if [[ "$*" == "--help" && "\${PW_CLI_FAIL_HELP:-}" == "1" ]]; then
    printf '%s\\n' 'cli-output-secret'
    printf '%s\\n' 'cli-error-secret' >&2
    exit 1
fi
if [[ -n "\${PW_CLI_FAIL_ON:-}" && "$*" == *" \${PW_CLI_FAIL_ON}"* ]]; then
    printf '%s\\n' 'cli-output-secret'
    printf '%s\\n' 'cli-error-secret' >&2
    exit 1
fi
if [[ -n "\${PW_CLI_FAIL_CLEANUP:-}" && "$*" == *" \${PW_CLI_FAIL_CLEANUP}"* ]]; then
    printf '%s\\n' 'cli-output-secret'
    printf '%s\\n' 'cli-error-secret' >&2
    exit 1
fi
exit 0
`;
}

function isolatedEnv(binDir, extra = {}) {
    return {
        ...process.env,
        APP_ENV: "test",
        BIN_PATH: binDir,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PLAYWRIGHT_MCP_CDP_ENDPOINT: "",
        PW_CLI_FAIL_CLEANUP: "",
        PW_CLI_FAIL_HELP: "",
        PW_CLI_FAIL_ON: "",
        ...extra,
    };
}

function run(env, cwd) {
    return spawnSync(BASH, [SCRIPT], {cwd, env, encoding: "utf8"});
}

function setupStub(tempRoot) {
    const binDir = path.join(tempRoot, "bin");
    const log = path.join(tempRoot, "cli.log");
    mkdirSync(binDir);
    writeExecutable(path.join(binDir, "playwright-cli"), stubCli());
    return {binDir, log};
}

function calls(log) {
    if (!existsSync(log)) {
        return [];
    }
    return readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
}

describe("playwright preflight helper", () => {
    it("resolves from BIN_PATH without PATH and closes the local session", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-local-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const result = run(isolatedEnv(binDir, {
                PATH: path.join(tempRoot, "path-without-playwright-cli"),
                PW_CLI_LOG: log,
            }), tempRoot);

            expect(result.status).toBe(0);
            expect(result.stdout).toContain("CLI: OK");
            expect(result.stdout).toContain("Browser mode: local-chromium");
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Browser cleanup: OK");

            const invoked = calls(log);
            expect(invoked.filter((call) => call === "--help")).toHaveLength(1);
            expect(invoked.some((call) => /open about:blank --browser=chromium$/.test(call))).toBe(true);
            expect(invoked.some((call) => / close$/.test(call))).toBe(true);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("attaches and detaches through CDP when the endpoint is configured", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-cdp-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const endpoint = "http://127.0.0.1:9222/devtools/browser/cdp-secret-value";
            const result = run(isolatedEnv(binDir, {
                PW_CLI_LOG: log,
                PLAYWRIGHT_MCP_CDP_ENDPOINT: endpoint,
            }), tempRoot);

            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Browser mode: cdp-attach");
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Browser cleanup: OK");

            const invoked = calls(log);
            expect(invoked.filter((call) => call === "--help")).toHaveLength(1);
            expect(invoked.some((call) => call.includes(`attach --cdp=${endpoint}`))).toBe(true);
            expect(invoked.some((call) => / detach$/.test(call))).toBe(true);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports a missing CLI with a distinct exit code and invokes nothing", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-missing-"));
        try {
            const binDir = path.join(tempRoot, "bin");
            const log = path.join(tempRoot, "cli.log");
            mkdirSync(binDir);
            const result = run({
                ...process.env,
                APP_ENV: "test",
                BIN_PATH: binDir,
                PATH: binDir,
            }, tempRoot);

            expect(result.status).toBe(2);
            expect(result.stdout).toContain("CLI: MISSING");
            expect(result.stdout).toContain("Browser cleanup: NOT_REQUIRED");
            expect(result.stdout).not.toContain("Browser launch:");
            expect(existsSync(log)).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports an invalid resolved CLI without launching or attaching", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-help-fail-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const result = run(isolatedEnv(binDir, {
                PATH: path.join(tempRoot, "path-without-playwright-cli"),
                PW_CLI_FAIL_HELP: "1",
                PW_CLI_LOG: log,
            }), tempRoot);

            expect(result.status).toBe(2);
            expect(result.stdout).toContain("CLI: INVALID");
            expect(result.stdout).toContain("Browser cleanup: NOT_REQUIRED");
            expect(result.stdout).not.toContain("Browser mode:");
            expect(result.stdout).not.toContain("Browser launch:");
            expect(`${result.stdout}\n${result.stderr}`).not.toContain("cli-output-secret");
            expect(`${result.stdout}\n${result.stderr}`).not.toContain("cli-error-secret");
            expect(calls(log)).toEqual(["--help"]);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("cleans up the session when the browser launch fails", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-launch-fail-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const result = run(isolatedEnv(binDir, {
                PW_CLI_LOG: log,
                PW_CLI_FAIL_ON: "open",
            }), tempRoot);

            expect(result.status).toBe(3);
            expect(result.stdout).toContain("Browser launch: FAIL");
            expect(result.stdout).toContain("Browser cleanup: OK");

            const invoked = calls(log);
            expect(invoked.filter((call) => call === "--help")).toHaveLength(1);
            expect(invoked.some((call) => /open about:blank --browser=chromium$/.test(call))).toBe(true);
            expect(invoked.some((call) => / close$/.test(call))).toBe(true);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("returns cleanup failure after a successful local launch", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-cleanup-fail-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const result = run(isolatedEnv(binDir, {
                PW_CLI_FAIL_CLEANUP: "close",
                PW_CLI_LOG: log,
            }), tempRoot);

            expect(result.status).toBe(4);
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Browser cleanup: FAIL");

            const invoked = calls(log);
            expect(invoked.filter((call) => call === "--help")).toHaveLength(1);
            expect(invoked.some((call) => /open about:blank --browser=chromium$/.test(call))).toBe(true);
            expect(invoked.some((call) => / close$/.test(call))).toBe(true);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("returns cleanup failure after a successful CDP attach", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-detach-fail-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const endpoint = "http://127.0.0.1:9555/devtools/browser/detach-secret";
            const result = run(isolatedEnv(binDir, {
                PLAYWRIGHT_MCP_CDP_ENDPOINT: endpoint,
                PW_CLI_FAIL_CLEANUP: "detach",
                PW_CLI_LOG: log,
            }), tempRoot);

            expect(result.status).toBe(4);
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Browser cleanup: FAIL");
            expect(`${result.stdout}\n${result.stderr}`).not.toContain("detach-secret");

            const invoked = calls(log);
            expect(invoked.filter((call) => call === "--help")).toHaveLength(1);
            expect(invoked.some((call) => call.includes(`attach --cdp=${endpoint}`))).toBe(true);
            expect(invoked.some((call) => / detach$/.test(call))).toBe(true);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("keeps launch failure precedence when attach and detach both fail", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-attach-fail-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const endpoint = "http://127.0.0.1:9444/devtools/browser/precedence-secret";
            const result = run(isolatedEnv(binDir, {
                PLAYWRIGHT_MCP_CDP_ENDPOINT: endpoint,
                PW_CLI_FAIL_CLEANUP: "detach",
                PW_CLI_FAIL_ON: "attach",
                PW_CLI_LOG: log,
            }), tempRoot);

            expect(result.status).toBe(3);
            expect(result.stdout).toContain("Browser launch: FAIL");
            expect(result.stdout).toContain("Browser cleanup: FAIL");
            expect(`${result.stdout}\n${result.stderr}`).not.toContain("precedence-secret");

            const invoked = calls(log);
            expect(invoked.filter((call) => call === "--help")).toHaveLength(1);
            expect(invoked.some((call) => call.includes(`attach --cdp=${endpoint}`))).toBe(true);
            expect(invoked.some((call) => / detach$/.test(call))).toBe(true);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("does not leak the CDP endpoint or write artifacts into the working directory", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-preflight-secrets-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const endpoint = "http://127.0.0.1:9333/secret-cdp-value";
            const result = run(isolatedEnv(binDir, {
                PW_CLI_LOG: log,
                PLAYWRIGHT_MCP_CDP_ENDPOINT: endpoint,
            }), tempRoot);

            expect(result.status).toBe(0);
            const combined = `${result.stdout}\n${result.stderr}`;
            expect(combined).not.toContain("secret-cdp-value");
            expect(combined).not.toContain("cli-output-secret");
            expect(combined).not.toContain("cli-error-secret");
            expect(result.stdout).toContain("Browser cleanup: OK");

            const unexpected = readdirSync(tempRoot).filter((name) => name !== "bin" && name !== "cli.log");
            expect(unexpected).toEqual([]);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
