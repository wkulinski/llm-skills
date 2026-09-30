import {existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {runAuthFinalize} from "../../../.agents/skills/_shared/scripts/playwright-auth-finalize.mjs";

function fixture({marker = true, password = false, status = 200, finalUrl = "http://localhost:4173/", launchError = false, cliError = false} = {}) {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "pw-finalize-"));
    spawnSync("git", ["init", "-q"], {cwd});
    writeFileSync(path.join(cwd, ".gitignore"), ".playwright-cli/\n");
    const canonical = path.join(cwd, ".playwright-cli/auth/storage-state.json");
    mkdirSync(path.dirname(canonical), {recursive: true});
    writeFileSync(canonical, "previous-state");
    const record = {contexts: [], closed: 0, cli: []};
    const locator = (visible) => ({
        count: async () => 1,
        nth: () => ({isVisible: async () => visible}),
        first: () => ({waitFor: async () => { if (!visible) { throw Error("not visible"); } }}),
    });
    const page = {
        goto: async () => ({status: () => status}), url: () => finalUrl,
        locator: (selector) => locator(selector === 'input[type="password"]' ? password : marker),
    };
    const options = {
        cwd, cliPath: "/resolved/playwright-cli", session: "tenant-selection",
        env: {
            PLAYWRIGHT_GUI_BASE_URL: "http://localhost:4173/",
            PLAYWRIGHT_GUI_LOGIN_URL: "http://localhost:4173/login",
            PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR: "#authenticated",
            PLAYWRIGHT_GUI_USER_LOGIN: "fixture-login", PLAYWRIGHT_GUI_USER_PASSWORD: "fixture-password",
            DEBUG: "pw:api", PWDEBUG: "1",
        },
        log: (line) => record.cli.push(line),
        runCli: (command, args, settings) => {
            record.command = command;
            record.args = args;
            record.cliEnv = settings.env;
            if (cliError) { return {status: 1, stderr: "fixture-password"}; }
            writeFileSync(path.join(cwd, args[2]), "completed-state");
            return {status: 0};
        },
        resolvePlaywright: () => ({chromium: {launch: async () => {
            if (launchError) { throw Error("unavailable"); }
            return {
                newContext: async (settings) => { record.contexts.push(settings); return {newPage: async () => page}; },
                close: async () => { record.closed += 1; },
            };
        }}}),
    };
    return {cwd, canonical, record, options, cleanup: () => rmSync(cwd, {recursive: true, force: true})};
}

describe("Playwright access finalization", () => {
    it("allows validation of explicit remote state; credential bootstrap remains loopback-only", async () => {
        const f = fixture({finalUrl: "https://staging.example.test/"});
        try {
            f.options.env.PLAYWRIGHT_GUI_LOGIN_URL = "http://localhost:4173/";
            expect(await runAuthFinalize({...f.options, url: "https://staging.example.test/"}))
                .toEqual({code: 0, reason: null});
        } finally { f.cleanup(); }
    });

    it("gives an explicit task URL and marker precedence over repository defaults", async () => {
        const f = fixture();
        try {
            f.options.env.PLAYWRIGHT_GUI_BASE_URL = "https://example.com/unused-default";
            f.options.env.PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR = "";
            expect(await runAuthFinalize({...f.options, url: "http://localhost:4173/", selector: "#authenticated"}))
                .toEqual({code: 0, reason: null});
        } finally { f.cleanup(); }
    });

    it("saves the agent session, proves access in a fresh context, and atomically promotes private state", async () => {
        const f = fixture();
        try {
            expect(await runAuthFinalize(f.options)).toEqual({code: 0, reason: null});
            expect(f.record.command).toBe("/resolved/playwright-cli");
            expect(f.record.args.slice(0, 2)).toEqual(["-s=tenant-selection", "state-save"]);
            expect(f.record.contexts).toEqual([{storageState: path.join(f.cwd, f.record.args[2])}]);
            expect(f.record.closed).toBe(1);
            expect(readFileSync(f.canonical, "utf8")).toBe("completed-state");
            expect(lstatSync(f.canonical).mode & 0o777).toBe(0o600);
            expect(readdirSync(path.dirname(f.canonical))).toEqual(["storage-state.json"]);
            expect(f.record.cli).toContain("Authentication: OK");
            for (const key of ["DEBUG", "PWDEBUG", "PLAYWRIGHT_GUI_USER_LOGIN", "PLAYWRIGHT_GUI_USER_PASSWORD"]) {
                expect(f.record.cliEnv).not.toHaveProperty(key);
            }
        } finally { f.cleanup(); }
    });

    it.each([
        [{marker: false}, "access-not-confirmed"], [{password: true}, "access-not-confirmed"],
        [{finalUrl: "http://localhost:4173/login"}, "access-not-confirmed"],
        [{status: 500}, "access-not-confirmed"], [{finalUrl: "https://example.com/"}, "access-not-confirmed"],
        [{launchError: true}, "browser-unavailable"], [{cliError: true}, "state-save-failed"],
    ])("rejects incomplete/failed authentication and preserves canonical state: %j", async (settings, reason) => {
        const f = fixture(settings);
        try {
            const result = await runAuthFinalize(f.options);
            expect(result.reason).toBe(reason);
            expect(result.code).not.toBe(0);
            expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
            expect(readdirSync(path.dirname(f.canonical))).toEqual(["storage-state.json"]);
            expect(f.record.cli.join("\n")).not.toContain("fixture-password");
            expect(f.record.cli).not.toContain("Access: READY");
        } finally { f.cleanup(); }
    });

    it("requires an explicit positive marker and safe session identifier before touching state", async () => {
        const f = fixture();
        try {
            expect(await runAuthFinalize({...f.options, selector: ""})).toEqual({code: 2, reason: "verification-config-missing"});
            expect(await runAuthFinalize({...f.options, session: "--other-session"})).toEqual({code: 2, reason: "session-invalid"});
            expect(f.record.args).toBeUndefined();
            expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
        } finally { f.cleanup(); }
    });

    it("rejects symlink targets and non-ignored state before CLI writes credentials", async () => {
        const f = fixture();
        try {
            rmSync(f.canonical);
            const outside = path.join(f.cwd, "outside.json");
            writeFileSync(outside, "outside-state");
            symlinkSync(outside, f.canonical);
            expect((await runAuthFinalize(f.options)).reason).toBe("state-invalid");
            expect(f.record.args).toBeUndefined();
            expect(readFileSync(outside, "utf8")).toBe("outside-state");
            rmSync(f.canonical);
            writeFileSync(path.join(f.cwd, ".gitignore"), "");
            expect((await runAuthFinalize(f.options)).reason).toBe("state-invalid");
            expect(existsSync(f.canonical)).toBe(false);
        } finally { f.cleanup(); }
    });
});
