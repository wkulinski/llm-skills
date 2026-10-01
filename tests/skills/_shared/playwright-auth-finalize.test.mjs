import {chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {runAuthFinalize} from "../../../.agents/skills/_shared/scripts/playwright-auth-finalize.mjs";

function fixture({password = false, status = 200, finalUrl = "http://localhost:4173/", launchError = false, cliError = false, invalidState = false,
    canonicalPath = ".playwright-cli/auth/storage-state.json", precreateCanonical = true} = {}) {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "pw-finalize-"));
    spawnSync("git", ["init", "-q"], {cwd});
    writeFileSync(path.join(cwd, ".gitignore"), ".playwright-cli/\n");
    const canonical = path.join(cwd, canonicalPath);
    if (precreateCanonical) {
        mkdirSync(path.dirname(canonical), {recursive: true});
        writeFileSync(canonical, "previous-state", {mode: 0o640});
    }
    const candidatePath = ".playwright-cli/auth/candidate-agent.json";
    const candidate = path.join(cwd, candidatePath);
    mkdirSync(path.dirname(candidate), {recursive: true});
    writeFileSync(candidate, "completed-state", {mode: 0o600});
    const record = {contexts: [], launches: 0, closed: 0, cli: []};
    const page = {
        goto: async () => ({status: () => status}), url: () => finalUrl,
        locator: () => ({count: async () => 1, nth: () => ({isVisible: async () => password})}),
    };
    const options = {
        cwd, cliPath: "/resolved/playwright-cli",
        env: {
            PLAYWRIGHT_GUI_BASE_URL: "http://localhost:4173/",
            PLAYWRIGHT_GUI_LOGIN_URL: "http://localhost:4173/login",
            PLAYWRIGHT_GUI_STORAGE_STATE: canonicalPath,
            PLAYWRIGHT_GUI_USER_LOGIN: "fixture-login", PLAYWRIGHT_GUI_USER_PASSWORD: "fixture-password",
            DEBUG: "pw:api", PWDEBUG: "1",
        },
        log: (line) => record.cli.push(line),
        runCli: (command, args, settings) => {
            record.command = command;
            record.args = args;
            record.cliEnv = settings.env;
            record.reservedMode = lstatSync(path.join(cwd, args[2])).mode & 0o777;
            if (cliError) { return {status: 1, stderr: "fixture-password"}; }
            writeFileSync(path.join(cwd, args[2]), "completed-state");
            return {status: 0};
        },
        resolvePlaywright: () => ({chromium: {launch: async () => {
            record.launches += 1;
            if (launchError) { throw Error("unavailable"); }
            return {
                newContext: async (settings) => {
                    record.contexts.push(settings);
                    if (invalidState) { throw Error("invalid JSON"); }
                    return {newPage: async () => page};
                },
                close: async () => { record.closed += 1; },
            };
        }}}),
    };
    const promotion = {...options, promote: true, candidate: candidatePath, evidence: "Fresh isolated session shows the task view"};
    return {cwd, canonical, candidate, candidatePath, record, options, promotion, cleanup: () => rmSync(cwd, {recursive: true, force: true})};
}

describe("Playwright state staging and promotion", () => {
    it("stages a private ignored candidate without verification or canonical promotion", async () => {
        const f = fixture();
        try {
            expect(await runAuthFinalize({...f.options, stage: true, session: "tenant-selection", url: undefined}))
                .toEqual({code: 0, reason: null});
            expect(f.record.command).toBe("/resolved/playwright-cli");
            expect(f.record.args.slice(0, 2)).toEqual(["-s=tenant-selection", "state-save"]);
            expect(f.record.args[2]).toMatch(/^\.playwright-cli\/auth\/candidate-[\w-]+\.json$/);
            const saved = path.join(f.cwd, f.record.args[2]);
            expect(f.record.reservedMode).toBe(0o600);
            expect(lstatSync(saved).mode & 0o777).toBe(0o600);
            expect(spawnSync("git", ["check-ignore", "-q", "--", saved], {cwd: f.cwd}).status).toBe(0);
            expect(f.record.contexts).toEqual([]);
            expect(f.record.cli).toEqual(["Authentication: ACTION_REQUIRED", `Candidate state: ${f.record.args[2]}`, "Access: VERIFY_REQUIRED"]);
            expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
            for (const key of ["DEBUG", "PWDEBUG", "PLAYWRIGHT_GUI_USER_LOGIN", "PLAYWRIGHT_GUI_USER_PASSWORD"]) {
                expect(f.record.cliEnv).not.toHaveProperty(key);
            }
        } finally { f.cleanup(); }
    });

    it("promotes only after evidence and a fresh-context check, atomically consuming the candidate", async () => {
        const f = fixture();
        try {
            expect(await runAuthFinalize(f.promotion)).toEqual({code: 0, reason: null});
            expect(f.record.args).toBeUndefined();
            expect(f.record.contexts).toEqual([{storageState: f.candidate}]);
            expect(f.record.closed).toBe(1);
            expect(readFileSync(f.canonical, "utf8")).toBe("completed-state");
            expect(lstatSync(f.canonical).mode & 0o777).toBe(0o600);
            expect(readdirSync(path.dirname(f.canonical))).toEqual(["storage-state.json"]);
            expect(f.record.cli).toEqual(["Authentication: OK", "Storage state: .playwright-cli/auth/storage-state.json",
                `Evidence: ${f.promotion.evidence}`, "Access: READY"]);
        } finally { f.cleanup(); }
    });

    it("stages and promotes a nested canonical target whose directory does not exist yet", async () => {
        const f = fixture({canonicalPath: ".playwright-cli/auth/app/storage-state.json", precreateCanonical: false});
        try {
            expect(await runAuthFinalize({...f.options, stage: true, session: "tenant-selection"})).toEqual({code: 0, reason: null});
            expect(f.record.cli).toContain("Access: VERIFY_REQUIRED");
            const candidate = f.record.cli.find((line) => line.startsWith("Candidate state: ")).slice("Candidate state: ".length);
            expect(candidate).toMatch(/^\.playwright-cli\/auth\/app\/candidate-[\w-]+\.json$/);
            const staged = path.join(f.cwd, candidate);
            expect(lstatSync(staged).mode & 0o777).toBe(0o600);
            expect(spawnSync("git", ["check-ignore", "-q", "--", staged], {cwd: f.cwd}).status).toBe(0);
            expect(existsSync(f.canonical)).toBe(false);
            f.record.cli.length = 0;
            expect(await runAuthFinalize({...f.promotion, candidate})).toEqual({code: 0, reason: null});
            expect(f.record.cli).toEqual(["Authentication: OK", "Storage state: .playwright-cli/auth/app/storage-state.json",
                `Evidence: ${f.promotion.evidence}`, "Access: READY"]);
            expect(readFileSync(f.canonical, "utf8")).toBe("completed-state");
            expect(existsSync(staged)).toBe(false);
        } finally { f.cleanup(); }
    });

    it("allows explicit remote URLs and gives the task URL precedence over defaults", async () => {
        const f = fixture({finalUrl: "https://staging.example.test/"});
        try {
            expect(await runAuthFinalize({...f.promotion, url: "https://staging.example.test/"}))
                .toEqual({code: 0, reason: null});
        } finally { f.cleanup(); }
    });

    it.each([
        [{password: true}, "access-not-confirmed"],
        [{finalUrl: "http://localhost:4173/login?next=home#step"}, "access-not-confirmed"],
        [{status: 403}, "access-not-confirmed"], [{status: 500}, "access-not-confirmed"],
        [{finalUrl: "https://example.com/"}, "access-not-confirmed"],
        [{invalidState: true}, "access-not-confirmed"], [{launchError: true}, "browser-unavailable"],
    ])("blocks unusable candidate and preserves canonical bytes and permissions: %j", async (settings, reason) => {
        const f = fixture(settings);
        try {
            const result = await runAuthFinalize(f.promotion);
            expect(result.reason).toBe(reason);
            expect(result.code).not.toBe(0);
            expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
            expect(lstatSync(f.canonical).mode & 0o777).toBe(0o640);
            expect(existsSync(f.candidate)).toBe(false);
            expect(f.record.cli).toContain("Access: BLOCKED");
            expect(f.record.cli).not.toContain("Access: READY");
        } finally { f.cleanup(); }
    });

    it.each([undefined, "", " \n\t"])("requires nonempty evidence before touching files: %j", async (evidence) => {
        const f = fixture();
        try {
            expect(await runAuthFinalize({...f.promotion, evidence})).toEqual({code: 2, reason: "evidence-missing"});
            expect(f.record.launches).toBe(0);
            expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
            expect(existsSync(f.candidate)).toBe(true);
        } finally { f.cleanup(); }
    });

    it.each([".playwright-cli/auth/storage-state.json", ".playwright-cli/auth/custom.json", ".playwright-cli/auth/candidate-canonical.json"])(
        "rejects the canonical file as input, including equivalent paths and hardlinks: %s", async (canonicalPath) => {
            for (const alias of ["direct", "equivalent", "hardlink"]) {
                const f = fixture({canonicalPath});
                try {
                    let candidate = canonicalPath;
                    if (alias === "equivalent") { candidate = canonicalPath.replace("/auth/", "/auth/../auth/"); }
                    if (alias === "hardlink") { rmSync(f.candidate); linkSync(f.canonical, f.candidate); candidate = f.candidatePath; }
                    chmodSync(f.canonical, 0o640);
                    expect(await runAuthFinalize({...f.promotion, candidate})).toEqual({code: 3, reason: "state-invalid"});
                    expect(f.record.launches).toBe(0);
                    expect(f.record.contexts).toEqual([]);
                    expect(f.record.cli).toContain("Access: BLOCKED");
                    expect(existsSync(f.canonical)).toBe(true);
                    expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
                    expect(lstatSync(f.canonical).mode & 0o777).toBe(0o640);
                } finally { f.cleanup(); }
            }
        });

    it("redacts credential values from evidence and does not print CLI stderr", async () => {
        const f = fixture();
        try {
            await runAuthFinalize({...f.promotion, evidence: "view fixture-password fixture-login\nconfirmed"});
            expect(f.record.cli).toContain("Evidence: view *** *** confirmed");
            expect(f.record.cli.join("\n")).not.toContain("fixture-password");
        } finally { f.cleanup(); }
        const broken = fixture({cliError: true});
        try {
            expect((await runAuthFinalize({...broken.options, stage: true, session: "task"})).reason).toBe("state-save-failed");
            expect(readdirSync(path.dirname(broken.canonical))).toEqual(["candidate-agent.json", "storage-state.json"]);
            expect(broken.record.cli.join("\n")).not.toContain("fixture-password");
        } finally { broken.cleanup(); }
    });

    it("requires a safe session identifier and one explicit operation", async () => {
        const f = fixture();
        try {
            expect((await runAuthFinalize({...f.options, stage: true, session: "--other-session"})).reason).toBe("session-invalid");
            expect((await runAuthFinalize(f.options)).reason).toBe("arguments-invalid");
            expect((await runAuthFinalize({...f.promotion, stage: true})).reason).toBe("arguments-invalid");
            expect(f.record.args).toBeUndefined();
            expect(f.record.launches).toBe(0);
        } finally { f.cleanup(); }
    });

    it("requires an HTTP URL for promotion", async () => {
        const f = fixture();
        try {
            expect((await runAuthFinalize({...f.promotion, url: "file:///tmp/app"})).reason).toBe("url-invalid");
            expect(f.record.launches).toBe(0);
            expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
        } finally { f.cleanup(); }
    });

    it("rejects symlink targets and non-ignored state before CLI writes", async () => {
        const f = fixture();
        try {
            rmSync(f.canonical);
            const outside = path.join(f.cwd, "outside.json");
            writeFileSync(outside, "outside-state");
            symlinkSync(outside, f.canonical);
            expect((await runAuthFinalize({...f.options, stage: true, session: "task"})).reason).toBe("state-invalid");
            expect(f.record.args).toBeUndefined();
            expect(readFileSync(outside, "utf8")).toBe("outside-state");
            rmSync(f.canonical);
            writeFileSync(path.join(f.cwd, ".gitignore"), "");
            expect((await runAuthFinalize({...f.options, stage: true, session: "task"})).reason).toBe("state-invalid");
            expect(existsSync(f.canonical)).toBe(false);
        } finally { f.cleanup(); }
    });

    it.each(["symlink", "directory", "outside", "not-ignored"])("rejects unsafe supplied candidate without verification: %s", async (kind) => {
        const f = fixture();
        try {
            rmSync(f.candidate);
            let candidate = f.candidatePath;
            if (kind === "symlink") { symlinkSync(f.canonical, f.candidate); }
            if (kind === "directory") { mkdirSync(f.candidate); }
            if (kind === "outside") { candidate = "outside.json"; writeFileSync(path.join(f.cwd, candidate), "outside"); }
            if (kind === "not-ignored") { writeFileSync(f.candidate, "state"); writeFileSync(path.join(f.cwd, ".gitignore"), ".playwright-cli/auth/storage-state.json\n"); }
            expect((await runAuthFinalize({...f.promotion, candidate})).reason).toBe("state-invalid");
            expect(f.record.launches).toBe(0);
            expect(readFileSync(f.canonical, "utf8")).toBe("previous-state");
        } finally { f.cleanup(); }
    });
});
