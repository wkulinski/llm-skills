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

    it("rejects refresh without protected mode and stage without an agent session", () => {
        const {cwd, env} = setup();
        try {
            expect(spawnSync(BASH, [PREPARE, "--refresh"], {cwd, env}).status).toBe(2);
            const result = spawnSync(BASH, [PREPARE, "--stage"], {cwd, env, encoding: "utf8"});
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
            expect(result.stdout).toContain("Authentication: ACTION_REQUIRED\nCandidate state: .playwright-cli/auth/candidate-");
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

    it("stages then promotes through the entrypoint with the explicit candidate, task URL and evidence", () => {
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
            const staged = spawnSync(BASH, [PREPARE, "--stage", "--session", "agent-session"], {cwd, env, encoding: "utf8"});
            expect(staged.status).toBe(0);
            expect(staged.stdout).toContain("Access: VERIFY_REQUIRED");
            const candidate = staged.stdout.match(/Candidate state: (.+)/)[1];
            const canonical = path.join(cwd, ".playwright-cli/auth/storage-state.json");
            expect(existsSync(canonical)).toBe(false);
            const refused = spawnSync(BASH, [PREPARE, "--promote", "--candidate", candidate, "--url", "http://localhost:4173/"], {cwd, env, encoding: "utf8"});
            expect(refused.status).toBe(2);
            expect(refused.stdout).toContain("Reason: evidence-missing");
            expect(existsSync(canonical)).toBe(false);
            const result = spawnSync(BASH, [
                PREPARE, "--promote", "--candidate", candidate,
                "--url", "http://localhost:4173/", "--evidence", "Task view confirmed in isolated session",
            ], {cwd, env, encoding: "utf8"});

            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Authentication: OK\nStorage state: .playwright-cli/auth/storage-state.json\nEvidence: Task view confirmed in isolated session\nAccess: READY\n");
            expect(existsSync(path.join(cwd, candidate))).toBe(false);
            expect(readFileSync(path.join(cwd, ".playwright-cli/auth/storage-state.json"), "utf8")).toBe("completed-state\n");
        } finally {
            rmSync(cwd, {force: true, recursive: true});
        }
    });
});
