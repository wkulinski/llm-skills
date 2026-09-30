import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PREPARE = path.join(ROOT, ".agents/skills/_shared/scripts/playwright-access-prepare.sh");
const BASH = "/bin/bash";

function setup() {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "pw-access-"));
    const binDir = path.join(cwd, "bin");
    mkdirSync(binDir);
    const init = spawnSync("git", ["init", "-q"], {cwd, encoding: "utf8"});
    if (init.status !== 0) {
        throw new Error(`git init failed: ${init.stderr}`);
    }
    writeFileSync(path.join(cwd, ".gitignore"), ".playwright-cli/\n", "utf8");
    const cli = path.join(binDir, "playwright-cli");
    writeFileSync(cli, `#!${BASH}\nexit 0\n`, "utf8");
    chmodSync(cli, 0o755);
    const env = {
        ...process.env,
        APP_ENV: "test",
        BIN_PATH: binDir,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PLAYWRIGHT_GUI_LOGIN_URL: "",
        PLAYWRIGHT_GUI_BASE_URL: "",
        PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR: "",
        PLAYWRIGHT_GUI_USER_LOGIN: "",
        PLAYWRIGHT_GUI_USER_PASSWORD: "",
        PLAYWRIGHT_GUI_STORAGE_STATE: "",
        PLAYWRIGHT_MCP_CDP_ENDPOINT: "",
    };
    return {cwd, env};
}

describe("one-step Playwright access preparation", () => {
    it("refreshes at most once instead of blindly reusing the existing canonical file", () => {
        const {cwd, env} = setup();
        try {
            const stateDir = path.join(cwd, ".playwright-cli", "auth");
            mkdirSync(stateDir, {recursive: true});
            writeFileSync(path.join(stateDir, "storage-state.json"), "old-state");
            const result = spawnSync(BASH, [PREPARE, "--protected", "--refresh"], {cwd, env, encoding: "utf8"});
            expect(result.status).toBe(2);
            expect(result.stdout).toContain("Reason: env-missing\nAccess: BLOCKED");
        } finally { rmSync(cwd, {force: true, recursive: true}); }
    });

    it("rejects refresh without protected mode and finalize without an agent session", () => {
        const {cwd, env} = setup();
        try {
            expect(spawnSync(BASH, [PREPARE, "--refresh"], {cwd, env}).status).toBe(2);
            const result = spawnSync(BASH, [PREPARE, "--finalize"], {cwd, env, encoding: "utf8"});
            expect(result.status).toBe(2);
            expect(result.stdout).toContain("Reason: session-invalid\nAccess: BLOCKED");
        } finally { rmSync(cwd, {force: true, recursive: true}); }
    });
    it("checks the browser without requiring authentication for a public page", () => {
        const {cwd, env} = setup();
        try {
            const result = spawnSync(BASH, [PREPARE], {cwd, env, encoding: "utf8"});
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Authentication: NOT_REQUIRED\nAccess: READY\n");
            expect(existsSync(path.join(cwd, ".playwright-cli"))).toBe(false);
        } finally {
            rmSync(cwd, {force: true, recursive: true});
        }
    });

    it("reuses an existing ignored state without login credentials for a protected page", () => {
        const {cwd, env} = setup();
        try {
            const stateDir = path.join(cwd, ".playwright-cli", "auth");
            mkdirSync(stateDir, {recursive: true});
            writeFileSync(path.join(stateDir, "storage-state.json"), "{}\n", "utf8");
            const result = spawnSync(BASH, [PREPARE, "--protected"], {cwd, env, encoding: "utf8"});
            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Authentication: ACTION_REQUIRED\nProvisional state: .playwright-cli/auth/pending-");
            expect(result.stdout).toContain("Access: ACTION_REQUIRED\n");
            expect(result.stdout).not.toContain("Access: READY\n");
        } finally {
            rmSync(cwd, {force: true, recursive: true});
        }
    });

    it("blocks protected access without credentials after a successful preflight", () => {
        const {cwd, env} = setup();
        try {
            const result = spawnSync(BASH, [PREPARE, "--protected"], {cwd, env, encoding: "utf8"});
            expect(result.status).toBe(2);
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Authentication: FAIL\nReason: env-missing\nAccess: BLOCKED\n");
        } finally {
            rmSync(cwd, {force: true, recursive: true});
        }
    });

    it("does not claim access when CDP preflight passes but local bootstrap browser fails", () => {
        const {cwd, env} = setup();
        try {
            const moduleDir = path.join(cwd, "node_modules", "playwright");
            mkdirSync(moduleDir, {recursive: true});
            writeFileSync(path.join(moduleDir, "package.json"), '{"name":"playwright","main":"index.js"}', "utf8");
            writeFileSync(path.join(moduleDir, "index.js"), "module.exports={chromium:{launch:async()=>{throw Error('no local browser')}}};\n", "utf8");
            const result = spawnSync(BASH, [PREPARE, "--protected"], {
                cwd,
                env: {
                    ...env,
                    PLAYWRIGHT_MCP_CDP_ENDPOINT: "http://127.0.0.1:9222",
                    PLAYWRIGHT_GUI_LOGIN_URL: "http://127.0.0.1:4173/login",
                    PLAYWRIGHT_GUI_USER_LOGIN: "user",
                    PLAYWRIGHT_GUI_USER_PASSWORD: "password",
                },
                encoding: "utf8",
            });
            expect(result.status).toBe(2);
            expect(result.stdout).toContain("Browser mode: cdp-attach");
            expect(result.stdout).toContain("Browser launch: OK");
            expect(result.stdout).toContain("Reason: browser-unavailable\nAccess: BLOCKED\n");
        } finally {
            rmSync(cwd, {force: true, recursive: true});
        }
    });

    it("promotes the agent session state through the prepare finalize entrypoint", () => {
        const {cwd, env} = setup();
        try {
            const moduleDir = path.join(cwd, "node_modules", "playwright");
            mkdirSync(moduleDir, {recursive: true});
            writeFileSync(path.join(moduleDir, "package.json"), '{"name":"playwright","main":"index.js"}', "utf8");
            writeFileSync(path.join(moduleDir, "index.js"), `const field = (visible) => ({isVisible: async () => visible});
module.exports = {chromium: {launch: async () => ({
    newContext: async () => ({newPage: async () => ({
        goto: async () => ({status: () => 200}),
        url: () => "http://localhost:4173/",
        locator: (selector) => ({
            count: async () => 1,
            nth: () => selector === 'input[type="password"]' ? field(false) : field(true),
        }),
    })}),
    close: async () => undefined,
})}};
`, "utf8");
            const cli = path.join(cwd, "bin", "playwright-cli");
            writeFileSync(cli, `#!${BASH}\nprintf 'completed-state\\n' > "$3"\n`, "utf8");
            chmodSync(cli, 0o755);
            const result = spawnSync(BASH, [
                PREPARE, "--finalize", "--session", "agent-session",
                "--url", "http://localhost:4173/", "--selector", "#authenticated",
            ], {cwd, env, encoding: "utf8"});

            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Authentication: OK\nStorage state: .playwright-cli/auth/storage-state.json\nAccess: READY\n");
            expect(readFileSync(path.join(cwd, ".playwright-cli/auth/storage-state.json"), "utf8")).toBe("completed-state\n");
        } finally {
            rmSync(cwd, {force: true, recursive: true});
        }
    });
});
