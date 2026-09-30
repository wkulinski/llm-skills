import {chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {discoverLoginForm, runAuthBootstrap, verifyAuthenticatedState} from "../../../.agents/skills/_shared/scripts/playwright-auth-bootstrap.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CORE = path.join(ROOT, ".agents/skills/_shared/scripts/playwright-auth-bootstrap.mjs");
const WRAPPER = path.join(ROOT, ".agents/skills/_shared/scripts/playwright-auth-bootstrap.sh");
const BASH = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"].find((candidate) => existsSync(candidate)) ?? "bash";

const STORAGE_STATE_PATH = ".playwright-cli/auth/storage-state.json";
const LOGIN_URL = "http://localhost:4173/login";
const LOGIN_SECRET = "gui-login-secret-3f8a2b";
const PASSWORD_SECRET = "gui-password-secret-7d4e1c";

function createRepo(prefix) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), prefix));
    const init = spawnSync("git", ["init", "-q"], {cwd: tempRoot, encoding: "utf8"});
    if (init.status !== 0) {
        throw new Error(`git init failed: ${init.stderr}`);
    }
    writeFileSync(path.join(tempRoot, ".gitignore"), ".playwright-cli/\n", "utf8");
    return tempRoot;
}

function baseEnv(extra = {}) {
    return {
        PLAYWRIGHT_GUI_LOGIN_URL: LOGIN_URL,
        PLAYWRIGHT_GUI_USER_LOGIN: LOGIN_SECRET,
        PLAYWRIGHT_GUI_USER_PASSWORD: PASSWORD_SECRET,
        ...extra,
    };
}

function captureLog() {
    const lines = [];
    return {
        lines,
        log: (line) => {
            lines.push(line);
        },
        text: () => lines.join("\n"),
    };
}

function matchesSelector(element, selector) {
    switch (selector) {
        case 'input[type="password"]':
            return element.tag === "input" && element.type === "password";
        case 'input[type="text"]':
            return element.tag === "input" && element.type === "text";
        case 'input[type="email"]':
            return element.tag === "input" && element.type === "email";
        case 'input[type="tel"]':
            return element.tag === "input" && element.type === "tel";
        case "input:not([type])":
            return element.tag === "input" && element.type === null;
        case 'button[type="submit"]':
            return element.tag === "button" && element.type === "submit";
        case "button:not([type])":
            return element.tag === "button" && element.type === null;
        case 'input[type="submit"]':
            return element.tag === "input" && element.type === "submit";
        default:
            throw new Error(`Fake page received an unsupported selector: ${selector}`);
    }
}

function createFakeStack({passwordPresent = true, loginPresent = true, hideOnSubmit = true, fillError = null, finalUrl = LOGIN_URL, postSubmitUrl = null, formAction = null, submitFormAction = null, submitPresent = true, submitType = "submit", baseHref = null} = {}) {
    const record = {
        launchCalls: 0,
        closeCalls: 0,
        contextCalls: 0,
        pageCalls: 0,
        gotoUrls: [],
        fills: [],
        clicks: 0,
        presses: [],
        waits: [],
        storageStateCalls: 0,
    };
    const state = {passwordVisible: passwordPresent, url: finalUrl};

    const form = {tag: "form", type: null, children: [], form: null, attributes: {action: formAction}};
    form.children.push({tag: "input", type: "text", children: [], form, isVisible: () => false});
    if (loginPresent) {
        form.children.push({tag: "input", type: "email", children: [], form, isVisible: () => true});
    }
    if (passwordPresent) {
        form.children.push({tag: "input", type: "password", children: [], form, isVisible: () => state.passwordVisible});
    }
    if (submitPresent) {
        form.children.push({tag: "button", type: submitType, children: [], form, attributes: {formaction: submitFormAction}, isVisible: () => true});
    }
    const pageRoot = {tag: "#page", type: null, children: [form], form: null};

    function descendants(element) {
        const found = [];
        for (const child of element.children) {
            found.push(child);
            found.push(...descendants(child));
        }
        return found;
    }

    function completeSubmit() {
        if (hideOnSubmit) {
            state.passwordVisible = false;
        }
        if (postSubmitUrl !== null) { state.url = postSubmitUrl; }
    }

    class FakeLocator {
        constructor(elements) {
            this.elements = elements;
        }

        count() {
            return this.elements.length;
        }

        first() {
            return new FakeLocator(this.elements.slice(0, 1));
        }

        nth(index) {
            return new FakeLocator(this.elements.slice(index, index + 1));
        }

        locator(selector) {
            if (selector === "xpath=ancestor::form[1]") {
                const forms = [];
                for (const element of this.elements) {
                    if (element.form && !forms.includes(element.form)) {
                        forms.push(element.form);
                    }
                }
                return new FakeLocator(forms);
            }

            const found = [];
            for (const element of this.elements) {
                for (const candidate of descendants(element)) {
                    if (matchesSelector(candidate, selector) && !found.includes(candidate)) {
                        found.push(candidate);
                    }
                }
            }
            return new FakeLocator(found);
        }

        async isVisible() {
            return this.elements.some((element) => element.isVisible());
        }

        async getAttribute(name) {
            return this.elements[0]?.attributes?.[name] ?? null;
        }

        async evaluate(callback) {
            const element = this.elements[0];
            if (element === undefined) {
                return null;
            }

            const formElement = element.form ?? null;
            const formProxy = formElement === null ? null : {
                getAttribute: (name) => formElement.attributes?.[name] ?? null,
            };

            return callback({
                getAttribute: (name) => element.attributes?.[name] ?? null,
                form: formProxy,
                ownerDocument: {URL: finalUrl, baseURI: baseHref ?? finalUrl},
            });
        }

        async fill(value) {
            if (fillError !== null) {
                throw fillError;
            }
            for (const element of this.elements) {
                record.fills.push({type: element.type, value});
            }
        }

        async click() {
            record.clicks += 1;
            completeSubmit();
        }

        async press(key) {
            record.presses.push(key);
            if (key === "Enter") {
                completeSubmit();
            }
        }

        async waitFor(options) {
            record.waits.push(options);
            if (state.passwordVisible) {
                throw new Error("Fake Locator.waitFor timed out");
            }
        }
    }

    const page = {
        url() {
            return state.url;
        },
        locator(selector) {
            return new FakeLocator(descendants(pageRoot).filter((element) => matchesSelector(element, selector)));
        },
        async goto(url) {
            record.gotoUrls.push(url);
        },
    };
    const context = {
        async newPage() {
            record.pageCalls += 1;
            return page;
        },
        async storageState(options) {
            record.storageStateCalls += 1;
            writeFileSync(options.path, JSON.stringify({cookies: [], origins: []}, null, 2), "utf8");
        },
    };
    const browser = {
        async newContext() {
            record.contextCalls += 1;
            return context;
        },
        async close() {
            record.closeCalls += 1;
        },
    };
    const playwright = {
        chromium: {
            async launch() {
                record.launchCalls += 1;
                return browser;
            },
        },
    };

    return {playwright, page, record, state};
}

function setupStub(tempRoot) {
    const binDir = path.join(tempRoot, "bin");
    const log = path.join(tempRoot, "cli.log");
    mkdirSync(binDir);
    const stubPath = path.join(binDir, "playwright-cli");
    writeFileSync(stubPath, `#!${BASH}\nprintf '%s\\n' "$*" >> "\${PW_CLI_LOG:-/dev/null}"\nexit 0\n`, "utf8");
    chmodSync(stubPath, 0o755);
    return {binDir, log};
}

function createVerificationStack({marker = true, password = false, status = 200, finalUrl = "http://localhost:4173/", launchError = false, invalidState = false, duplicate = false} = {}) {
    const record = {launches: 0, closes: 0, contexts: []};
    const locator = (visible) => ({
        count: async () => visible && duplicate ? 2 : 1,
        nth: (index) => ({isVisible: async () => visible && (!duplicate || index === 1)}),
        first: () => ({waitFor: async () => { if (!visible || duplicate) { throw Error("not visible"); } }}),
    });
    const page = {
        goto: async () => ({status: () => status}), url: () => finalUrl,
        locator: (selector) => locator(selector === 'input[type="password"]' ? password : marker),
    };
    const browser = {
        newContext: async (options) => {
            record.contexts.push(options);
            if (invalidState) { throw Error("invalid JSON"); }
            return {newPage: async () => page};
        },
        close: async () => { record.closes += 1; },
    };
    return {record, browser, playwright: {chromium: {launch: async () => {
        record.launches += 1;
        if (launchError) { throw Error("browser missing"); }
        return browser;
    }}}};
}

describe("fresh-context authentication proof", () => {
    it.each([
        "https://staging.example.test/login",
        "http://localhost:4173/",
    ])("can verify explicit remote application state with login URL %s without extending credential bootstrap beyond loopback", async (loginUrl) => {
        const stack = createVerificationStack({finalUrl: "https://staging.example.test/"});
        expect(await verifyAuthenticatedState({
            playwright: stack.playwright, statePath: {absolute: "/unused-state.json"},
            url: "https://staging.example.test/", selector: "#authenticated", loginUrl,
        })).toBe(true);
    });

    it("returns a safe tenant-selection continuation URL without promoting unfinished authentication", async () => {
        const cwd = createRepo("pw-auth-tenant-");
        try {
            const login = createFakeStack({postSubmitUrl: "http://localhost:4173/login/tenant?token=private-token#private-fragment"});
            const captured = captureLog();
            const result = await runAuthBootstrap({cwd, env: baseEnv(), resolvePlaywright: () => login.playwright, log: captured.log});
            expect(result.status).toBe("ACTION_REQUIRED");
            expect(captured.lines).toContain("Continuation URL: http://localhost:4173/login/tenant");
            expect(captured.text()).not.toContain("private-token");
            expect(captured.text()).not.toContain("private-fragment");
            expect(existsSync(path.join(cwd, STORAGE_STATE_PATH))).toBe(false);
        } finally { rmSync(cwd, {recursive: true, force: true}); }
    });

    it.each([
        [{}, true], [{duplicate: true}, true], [{marker: false}, false], [{password: true}, false],
        [{status: 403}, false], [{finalUrl: LOGIN_URL}, false],
        [{finalUrl: "https://example.com/"}, false], [{invalidState: true}, false],
    ])("requires a positive protected-page marker and rejects denial: %j", async (options, expected) => {
        const stack = createVerificationStack(options);
        expect(await verifyAuthenticatedState({
            playwright: stack.playwright, statePath: {absolute: "/unused-state.json"},
            url: "http://localhost:4173/", selector: "#authenticated", loginUrl: LOGIN_URL,
        })).toBe(expected);
        expect(stack.record.closes).toBe(1);
        expect(stack.record.contexts).toEqual([{storageState: "/unused-state.json"}]);
    });

    it("reports infrastructure failure rather than treating it as stale authentication", async () => {
        const stack = createVerificationStack({launchError: true});
        await expect(verifyAuthenticatedState({
            playwright: stack.playwright, statePath: {absolute: "/unused-state.json"},
            url: "http://localhost:4173/", selector: "#authenticated",
        })).rejects.toMatchObject({reason: "browser-unavailable"});
    });

    it.each([false, true])("checks existing authentication, then renews at most once if invalid=%s", async (invalid) => {
        const cwd = createRepo("pw-auth-verify-");
        try {
            const canonical = path.join(cwd, STORAGE_STATE_PATH);
            mkdirSync(path.dirname(canonical), {recursive: true});
            writeFileSync(canonical, "old-state");
            const verification = createVerificationStack({marker: !invalid});
            const login = createFakeStack();
            let launches = 0;
            const playwright = {chromium: {launch: async () => {
                launches += 1;
                return launches === 1 ? verification.browser : login.playwright.chromium.launch();
            }}};
            const captured = captureLog();
            const result = await runAuthBootstrap({
                cwd, env: baseEnv({PLAYWRIGHT_GUI_BASE_URL: "http://localhost:4173/", PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR: "#authenticated"}),
                resolvePlaywright: () => playwright, log: captured.log,
            });
            expect(result.status).toBe(invalid ? "ACTION_REQUIRED" : "READY");
            expect(launches).toBe(invalid ? 2 : 1);
            expect(login.record.clicks).toBe(invalid ? 1 : 0);
            expect(readFileSync(canonical, "utf8")).toBe("old-state");
        } finally { rmSync(cwd, {recursive: true, force: true}); }
    });

    it("forced renewal stages fresh login without overwriting canonical state", async () => {
        const cwd = createRepo("pw-auth-refresh-");
        try {
            const canonical = path.join(cwd, STORAGE_STATE_PATH);
            mkdirSync(path.dirname(canonical), {recursive: true});
            writeFileSync(canonical, "old-state");
            const login = createFakeStack();
            const result = await runAuthBootstrap({cwd, env: baseEnv(), refresh: true, resolvePlaywright: () => login.playwright, log: () => undefined});
            expect(result.status).toBe("ACTION_REQUIRED");
            expect(login.record.clicks).toBe(1);
            expect(readFileSync(canonical, "utf8")).toBe("old-state");
        } finally { rmSync(cwd, {recursive: true, force: true}); }
    });
});

function isolatedEnv(binDir, extra = {}) {
    return {
        ...process.env,
        APP_ENV: "test",
        BIN_PATH: binDir,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        PLAYWRIGHT_GUI_LOGIN_URL: "",
        PLAYWRIGHT_GUI_BASE_URL: "",
        PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR: "",
        PLAYWRIGHT_GUI_STORAGE_STATE: "",
        PLAYWRIGHT_GUI_USER_LOGIN: "",
        PLAYWRIGHT_GUI_USER_PASSWORD: "",
        ...extra,
    };
}

describe("playwright auth bootstrap core", () => {
    it("stages a private provisional state, never canonical authentication, after the password hides", async () => {
        const tempRoot = createRepo("pw-auth-success-");
        try {
            const {playwright, record} = createFakeStack();
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 0, reason: null, status: "ACTION_REQUIRED"});
            expect(captured.lines[0]).toBe("Authentication: ACTION_REQUIRED");
            expect(captured.lines[1]).toMatch(/^Provisional state: \.playwright-cli\/auth\/pending-[\w-]+\.json$/);
            const stateFile = path.join(tempRoot, captured.lines[1].slice("Provisional state: ".length));
            expect(existsSync(path.join(tempRoot, STORAGE_STATE_PATH))).toBe(false);
            expect(lstatSync(stateFile).mode & 0o777).toBe(0o600);
            expect(existsSync(stateFile)).toBe(true);
            expect(lstatSync(stateFile).isFile()).toBe(true);
            expect(JSON.parse(readFileSync(stateFile, "utf8"))).toEqual({cookies: [], origins: []});
            expect(spawnSync("git", ["check-ignore", "-q", "--", stateFile], {cwd: tempRoot}).status).toBe(0);

            expect(record.fills).toEqual([
                {type: "email", value: LOGIN_SECRET},
                {type: "password", value: PASSWORD_SECRET},
            ]);
            expect(record.storageStateCalls).toBe(1);
            expect(record.closeCalls).toBe(1);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("stages an existing state for agent inspection rather than claiming blind authentication", async () => {
        const tempRoot = createRepo("pw-auth-reuse-");
        try {
            const stateFile = path.join(tempRoot, STORAGE_STATE_PATH);
            mkdirSync(path.dirname(stateFile), {recursive: true});
            writeFileSync(stateFile, "{}\n", "utf8");

            const {playwright, record} = createFakeStack();
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 0, reason: null, status: "ACTION_REQUIRED"});
            expect(captured.lines[0]).toBe("Authentication: ACTION_REQUIRED");
            const staged = path.join(tempRoot, captured.lines[1].slice("Provisional state: ".length));
            expect(readFileSync(staged, "utf8")).toBe("{}\n");
            expect(lstatSync(staged).mode & 0o777).toBe(0o600);
            expect(readFileSync(stateFile, "utf8")).toBe("{}\n");
            expect(record.launchCalls).toBe(0);
            expect(record.storageStateCalls).toBe(0);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("fails with form-not-recognized when no password field is visible", async () => {
        const tempRoot = createRepo("pw-auth-no-password-");
        try {
            const {playwright, record} = createFakeStack({passwordPresent: false});
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 3, reason: "form-not-recognized"});
            expect(captured.lines).toEqual(["Authentication: FAIL", "Reason: form-not-recognized"]);
            expect(record.storageStateCalls).toBe(0);
            expect(record.closeCalls).toBe(1);
            expect(existsSync(path.join(tempRoot, ".playwright-cli"))).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("fails with form-not-recognized when the form has no login field", async () => {
        const tempRoot = createRepo("pw-auth-no-login-");
        try {
            const {playwright, record} = createFakeStack({loginPresent: false});
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 3, reason: "form-not-recognized"});
            expect(record.storageStateCalls).toBe(0);
            expect(existsSync(path.join(tempRoot, ".playwright-cli"))).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("fails with login-not-confirmed when the password field never hides and saves no state", async () => {
        const tempRoot = createRepo("pw-auth-unconfirmed-");
        try {
            const {playwright, record} = createFakeStack({hideOnSubmit: false});
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 3, reason: "login-not-confirmed"});
            expect(captured.lines).toEqual(["Authentication: FAIL", "Reason: login-not-confirmed"]);
            expect(record.waits).toEqual([{state: "hidden", timeout: 15000}]);
            expect(record.storageStateCalls).toBe(0);
            expect(existsSync(path.join(tempRoot, ".playwright-cli"))).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("rejects storage state paths outside .playwright-cli/auth/", async () => {
        const tempRoot = createRepo("pw-auth-bad-path-");
        try {
            const configuredPaths = ["var/state.json", path.join(tempRoot, "outside.json")];

            for (const configuredPath of configuredPaths) {
                const {playwright, record} = createFakeStack();
                const captured = captureLog();

                const result = await runAuthBootstrap({
                    env: baseEnv({PLAYWRIGHT_GUI_STORAGE_STATE: configuredPath}),
                    cwd: tempRoot,
                    resolvePlaywright: () => playwright,
                    log: captured.log,
                });

                expect(result).toEqual({code: 3, reason: "state-invalid"});
                expect(captured.lines).toEqual(["Authentication: FAIL", "Reason: state-invalid"]);
                expect(record.storageStateCalls).toBe(0);
                expect(record.closeCalls).toBe(0);
            }

            expect(existsSync(path.join(tempRoot, "var"))).toBe(false);
            expect(existsSync(path.join(tempRoot, "outside.json"))).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("rejects an existing symlink as the storage state target", async () => {
        const tempRoot = createRepo("pw-auth-symlink-");
        try {
            const target = path.join(tempRoot, "outside.json");
            const link = path.join(tempRoot, STORAGE_STATE_PATH);
            writeFileSync(target, "{}\n", "utf8");
            mkdirSync(path.dirname(link), {recursive: true});
            symlinkSync(target, link);

            const {playwright, record} = createFakeStack();
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 3, reason: "state-invalid"});
            expect(record.storageStateCalls).toBe(0);
            expect(lstatSync(link).isSymbolicLink()).toBe(true);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("rejects symlinked state directories before reusing or writing state", async () => {
        const tempRoot = createRepo("pw-auth-dir-symlink-");
        try {
            const outside = path.join(tempRoot, "outside");
            mkdirSync(path.join(tempRoot, ".playwright-cli"));
            mkdirSync(outside);
            symlinkSync(outside, path.join(tempRoot, ".playwright-cli", "auth"));
            const stateFile = path.join(outside, "storage-state.json");
            writeFileSync(stateFile, "{}\n", "utf8");

            const {playwright, record} = createFakeStack();
            const captured = captureLog();
            const result = await runAuthBootstrap({
                env: baseEnv(), cwd: tempRoot, resolvePlaywright: () => playwright, log: captured.log,
            });

            expect(result).toEqual({code: 3, reason: "state-invalid"});
            expect(record.launchCalls).toBe(0);
            expect(readFileSync(stateFile, "utf8")).toBe("{}\n");
            rmSync(stateFile);
            const missingResult = await runAuthBootstrap({
                env: baseEnv(), cwd: tempRoot, resolvePlaywright: () => playwright, log: captured.log,
            });
            expect(missingResult).toEqual({code: 3, reason: "state-invalid"});
            expect(existsSync(stateFile)).toBe(false);
            expect(record.launchCalls).toBe(0);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("does not fill credentials on a redirected page or a form posting off loopback", async () => {
        for (const options of [
            {finalUrl: "https://example.com/login"},
            {formAction: "https://example.com/login"},
            {submitFormAction: "https://example.com/login"},
        ]) {
            const tempRoot = createRepo("pw-auth-off-loopback-");
            try {
                const {playwright, record} = createFakeStack(options);
                const captured = captureLog();
                const result = await runAuthBootstrap({
                    env: baseEnv(), cwd: tempRoot, resolvePlaywright: () => playwright, log: captured.log,
                });
                expect(result).toEqual({code: 2, reason: "scope-not-loopback"});
                expect(record.fills).toEqual([]);
                expect(record.storageStateCalls).toBe(0);
                expect(record.closeCalls).toBe(1);
                expect(captured.text()).not.toContain(LOGIN_SECRET);
                expect(captured.text()).not.toContain(PASSWORD_SECRET);
            } finally {
                rmSync(tempRoot, {force: true, recursive: true});
            }
        }
    });

    it("rejects non-loopback and malformed login URLs before launching a browser", async () => {
        const loginUrls = ["http://example.com/login", "http://127.0.0.2:4173/login", "file://localhost/login", "not-a-url"];

        for (const loginUrl of loginUrls) {
            const {playwright, record} = createFakeStack();
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv({PLAYWRIGHT_GUI_LOGIN_URL: loginUrl}),
                cwd: os.tmpdir(),
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 2, reason: "scope-not-loopback"});
            expect(captured.lines).toEqual(["Authentication: FAIL", "Reason: scope-not-loopback"]);
            expect(record.launchCalls).toBe(0);
        }
    });

    it("reports playwright-module-unavailable when the resolver fails", async () => {
        const captured = captureLog();

        const result = await runAuthBootstrap({
            env: baseEnv(),
            cwd: os.tmpdir(),
            resolvePlaywright: () => {
                throw new Error("cannot find module playwright");
            },
            log: captured.log,
        });

        expect(result).toEqual({code: 2, reason: "playwright-module-unavailable"});
        expect(captured.lines).toEqual(["Authentication: FAIL", "Reason: playwright-module-unavailable"]);
    });

    it("never writes credential values to the log and maps unexpected errors to internal-error", async () => {
        const scenarios = [
            {stack: createFakeStack(), expectedCode: 0},
            {stack: createFakeStack({hideOnSubmit: false}), expectedCode: 3},
            {
                stack: createFakeStack({fillError: new Error(`fill rejected ${PASSWORD_SECRET} and ${LOGIN_SECRET}`)}),
                expectedCode: 1,
            },
        ];
        const tempRoots = [];
        try {
            for (const scenario of scenarios) {
                const tempRoot = createRepo("pw-auth-secrets-");
                tempRoots.push(tempRoot);
                const captured = captureLog();
                const result = await runAuthBootstrap({
                    env: baseEnv(),
                    cwd: tempRoot,
                    resolvePlaywright: () => scenario.stack.playwright,
                    log: captured.log,
                });

                expect(result.code).toBe(scenario.expectedCode);
                expect(captured.text()).not.toContain(LOGIN_SECRET);
                expect(captured.text()).not.toContain(PASSWORD_SECRET);
            }
        } finally {
            for (const tempRoot of tempRoots) {
                rmSync(tempRoot, {force: true, recursive: true});
            }
        }
    });

    it("clicks a submit button without a type attribute", async () => {
        const tempRoot = createRepo("pw-auth-untyped-submit-");
        try {
            const {playwright, record} = createFakeStack({submitType: null});
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 0, reason: null, status: "ACTION_REQUIRED"});
            expect(record.fills).toEqual([
                {type: "email", value: LOGIN_SECRET},
                {type: "password", value: PASSWORD_SECRET},
            ]);
            expect(record.clicks).toBe(1);
            expect(record.presses).toEqual([]);
            expect(record.storageStateCalls).toBe(1);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("rejects an off-loopback target resolved through the document base URL", async () => {
        const tempRoot = createRepo("pw-auth-base-href-");
        try {
            const {playwright, record} = createFakeStack({baseHref: "https://example.com/", formAction: "done"});
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 2, reason: "scope-not-loopback"});
            expect(record.fills).toEqual([]);
            expect(record.storageStateCalls).toBe(0);
            expect(record.closeCalls).toBe(1);
            expect(captured.text()).not.toContain(LOGIN_SECRET);
            expect(captured.text()).not.toContain(PASSWORD_SECRET);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("rejects an untyped submitter with an off-loopback formaction before filling", async () => {
        const tempRoot = createRepo("pw-auth-untyped-off-loopback-");
        try {
            const {playwright, record} = createFakeStack({submitType: null, submitFormAction: "https://example.com/login"});
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 2, reason: "scope-not-loopback"});
            expect(record.fills).toEqual([]);
            expect(record.storageStateCalls).toBe(0);
            expect(captured.text()).not.toContain(LOGIN_SECRET);
            expect(captured.text()).not.toContain(PASSWORD_SECRET);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("fails with form-not-recognized when no visible submitter exists", async () => {
        const tempRoot = createRepo("pw-auth-no-submit-");
        try {
            const {playwright, record} = createFakeStack({submitPresent: false});
            const captured = captureLog();

            const result = await runAuthBootstrap({
                env: baseEnv(),
                cwd: tempRoot,
                resolvePlaywright: () => playwright,
                log: captured.log,
            });

            expect(result).toEqual({code: 3, reason: "form-not-recognized"});
            expect(captured.lines).toEqual(["Authentication: FAIL", "Reason: form-not-recognized"]);
            expect(record.fills).toEqual([]);
            expect(record.presses).toEqual([]);
            expect(record.storageStateCalls).toBe(0);
            expect(existsSync(path.join(tempRoot, ".playwright-cli"))).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("discovers the visible login controls and returns null without a login field", async () => {
        const {page} = createFakeStack();
        const form = await discoverLoginForm(page);

        expect(form).not.toBeNull();
        expect(form.password).not.toBeNull();
        expect(form.login).not.toBeNull();
        expect(form.submit).not.toBeNull();

        const {page: passwordOnlyPage} = createFakeStack({loginPresent: false});
        expect(await discoverLoginForm(passwordOnlyPage)).toBeNull();
    });
});

describe("playwright auth bootstrap wrapper", () => {
    it("applies explicit URL/selector after repository env and forwards refresh", () => {
        const cwd = createRepo("pw-auth-overrides-");
        try {
            const {binDir} = setupStub(cwd);
            const marker = path.join(cwd, "overrides.txt");
            writeFileSync(path.join(cwd, ".env.local"), "PLAYWRIGHT_GUI_BASE_URL=http://localhost:4173/default\nPLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR=default\n");
            const node = path.join(binDir, "node");
            writeFileSync(node, `#!${BASH}\nprintf '%s\\n' "$PLAYWRIGHT_GUI_BASE_URL" "$PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR" "$*" > "${marker}"\n`, "utf8");
            chmodSync(node, 0o755);
            const result = spawnSync(BASH, [WRAPPER, "--refresh", "--url", "http://localhost:4173/task", "--selector", "#authenticated"], {
                cwd, env: isolatedEnv(binDir, {APP_ENV: "dev"}), encoding: "utf8",
            });
            expect(result.status).toBe(0);
            const output = readFileSync(marker, "utf8");
            expect(output).toContain("http://localhost:4173/task\n#authenticated\n");
            expect(output).toContain("--refresh");
        } finally { rmSync(cwd, {recursive: true, force: true}); }
    });

    it("prints usage for --help", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-help-"));
        try {
            const result = spawnSync(BASH, [WRAPPER, "--help"], {
                cwd: tempRoot,
                env: {...process.env, APP_ENV: "test"},
                encoding: "utf8",
            });

            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Usage: playwright-auth-bootstrap.sh");
            expect(result.stdout).toContain("ACTION_REQUIRED");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports env-missing when the CLI resolves but required variables are empty", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-env-missing-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot,
                env: isolatedEnv(binDir, {PW_CLI_LOG: log}),
                encoding: "utf8",
            });

            expect(result.status).toBe(2);
            expect(result.stdout).toBe("Authentication: FAIL\nReason: env-missing\n");
            expect(existsSync(log)).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reuses an ignored state through the wrapper without login credentials", () => {
        const tempRoot = createRepo("pw-auth-wrapper-reuse-");
        try {
            const {binDir, log} = setupStub(tempRoot);
            const stateFile = path.join(tempRoot, STORAGE_STATE_PATH);
            mkdirSync(path.dirname(stateFile), {recursive: true});
            writeFileSync(stateFile, "{}\n", "utf8");

            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot, env: isolatedEnv(binDir, {PW_CLI_LOG: log}), encoding: "utf8",
            });

            expect(result.status).toBe(0);
            expect(result.stdout).toMatch(/^Authentication: ACTION_REQUIRED\nProvisional state: \.playwright-cli\/auth\/pending-[\w-]+\.json\n$/);
            expect(existsSync(log)).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("loads repository env files before resolving tooling and auth config", () => {
        const tempRoot = createRepo("pw-auth-env-file-");
        try {
            setupStub(tempRoot);
            const stateFile = path.join(tempRoot, ".playwright-cli", "auth", "custom.json");
            mkdirSync(path.dirname(stateFile), {recursive: true});
            writeFileSync(stateFile, "{}\n", "utf8");
            writeFileSync(path.join(tempRoot, ".env.local"), [
                "BIN_PATH=./bin",
                "PLAYWRIGHT_GUI_STORAGE_STATE=.playwright-cli/auth/custom.json",
            ].join("\n"), "utf8");

            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot,
                env: {
                    ...process.env,
                    APP_ENV: "dev",
                    BIN_PATH: "",
                    PLAYWRIGHT_GUI_LOGIN_URL: "",
                    PLAYWRIGHT_GUI_BASE_URL: "",
                    PLAYWRIGHT_GUI_AUTHENTICATED_SELECTOR: "",
                    PLAYWRIGHT_GUI_USER_LOGIN: "",
                    PLAYWRIGHT_GUI_USER_PASSWORD: "",
                    PLAYWRIGHT_GUI_STORAGE_STATE: "",
                },
                encoding: "utf8",
            });

            expect(result.status).toBe(0);
            expect(result.stdout).toMatch(/^Authentication: ACTION_REQUIRED\nProvisional state: \.playwright-cli\/auth\/pending-[\w-]+\.json\n$/);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("strips Playwright debug variables before starting node", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-debug-"));
        try {
            const binDir = path.join(tempRoot, "bin");
            mkdirSync(binDir);
            const cliStub = path.join(binDir, "playwright-cli");
            writeFileSync(cliStub, `#!${BASH}\nexit 0\n`, "utf8");
            chmodSync(cliStub, 0o755);
            const marker = path.join(tempRoot, "env.txt");
            const nodeStub = path.join(binDir, "node");
            writeFileSync(nodeStub, `#!${BASH}\nprintf '%s\\n' "\${DEBUG:-unset}" "\${PWDEBUG:-unset}" > "${marker}"\nexit 9\n`, "utf8");
            chmodSync(nodeStub, 0o755);

            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot,
                env: {
                    ...process.env,
                    APP_ENV: "test",
                    BIN_PATH: binDir,
                    PATH: `${binDir}:${process.env.PATH ?? ""}`,
                    DEBUG: "pw:api",
                    PWDEBUG: "1",
                    ...baseEnv(),
                },
                encoding: "utf8",
            });

            expect(result.status).toBe(9);
            expect(readFileSync(marker, "utf8")).toBe("unset\nunset\n");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports cli-missing when no CLI can be resolved", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-cli-missing-"));
        try {
            const binDir = path.join(tempRoot, "bin");
            mkdirSync(binDir);
            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot,
                env: {
                    ...process.env,
                    APP_ENV: "test",
                    BIN_PATH: binDir,
                    PATH: binDir,
                    ...baseEnv(),
                },
                encoding: "utf8",
            });

            expect(result.status).toBe(2);
            expect(result.stdout).toBe("Authentication: FAIL\nReason: cli-missing\n");
            expect(`${result.stdout}\n${result.stderr}`).not.toContain(LOGIN_SECRET);
            expect(`${result.stdout}\n${result.stderr}`).not.toContain(PASSWORD_SECRET);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("propagates the Node exit code and keeps credentials out of stdout and stderr", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-propagate-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const cliPath = path.join(binDir, "playwright-cli");
            const env = isolatedEnv(binDir, {PW_CLI_LOG: log, ...baseEnv()});

            const wrapperResult = spawnSync(BASH, [WRAPPER], {cwd: tempRoot, env, encoding: "utf8"});
            const coreResult = spawnSync(process.execPath, [CORE, "--cli", cliPath], {cwd: tempRoot, env, encoding: "utf8"});

            expect(wrapperResult.status).toBe(2);
            expect(wrapperResult.stdout).toContain("Authentication: FAIL");
            expect(wrapperResult.stdout).toContain("Reason: playwright-module-unavailable");
            expect(wrapperResult.status).toBe(coreResult.status);
            expect(wrapperResult.stdout).toBe(coreResult.stdout);

            const wrapperOutput = `${wrapperResult.stdout}\n${wrapperResult.stderr}`;
            const coreOutput = `${coreResult.stdout}\n${coreResult.stderr}`;
            expect(wrapperOutput).not.toContain(LOGIN_SECRET);
            expect(wrapperOutput).not.toContain(PASSWORD_SECRET);
            expect(coreOutput).not.toContain(LOGIN_SECRET);
            expect(coreOutput).not.toContain(PASSWORD_SECRET);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("resolves a bare CLI name through PATH and loads playwright from the CLI package directory", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-bare-cli-"));
        try {
            const binDir = path.join(tempRoot, "bin");
            const moduleDir = path.join(tempRoot, "node_modules", "playwright");
            mkdirSync(binDir, {recursive: true});
            mkdirSync(moduleDir, {recursive: true});
            writeFileSync(path.join(moduleDir, "package.json"), JSON.stringify({
                name: "playwright",
                version: "0.0.0",
                main: "index.js",
            }), "utf8");
            writeFileSync(path.join(moduleDir, "index.js"), "module.exports = {chromium: {launch: async () => { throw new Error('launch failed'); }}};\n", "utf8");

            const stubPath = path.join(binDir, "playwright-cli");
            writeFileSync(stubPath, `#!${BASH}\nexit 0\n`, "utf8");
            chmodSync(stubPath, 0o755);

            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot,
                env: isolatedEnv(binDir, {
                    BIN_PATH: "",
                    PATH: `${binDir}:${process.env.PATH ?? ""}`,
                    ...baseEnv(),
                }),
                encoding: "utf8",
            });

            expect(result.status).toBe(2);
            expect(result.stdout).toContain("Authentication: FAIL");
            expect(result.stdout).toContain("Reason: browser-unavailable");
            expect(`${result.stdout}\n${result.stderr}`).not.toContain("playwright-module-unavailable");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("uses the node resolved through BIN_PATH before PATH", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-node-binpath-"));
        try {
            const {binDir, log} = setupStub(tempRoot);
            const marker = path.join(tempRoot, "node-used.txt");
            const nodeStub = path.join(binDir, "node");
            writeFileSync(nodeStub, `#!${BASH}\nprintf '%s\\n' "$*" > "${marker}"\nexit 9\n`, "utf8");
            chmodSync(nodeStub, 0o755);

            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot,
                env: isolatedEnv(binDir, {PW_CLI_LOG: log, ...baseEnv()}),
                encoding: "utf8",
            });

            expect(result.status).toBe(9);
            expect(existsSync(marker)).toBe(true);
            expect(readFileSync(marker, "utf8")).toContain("playwright-auth-bootstrap.mjs");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports node-missing when node is unavailable in BIN_PATH and PATH", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "pw-auth-node-missing-"));
        try {
            const {binDir} = setupStub(tempRoot);

            const result = spawnSync(BASH, [WRAPPER], {
                cwd: tempRoot,
                env: isolatedEnv(binDir, {
                    PATH: binDir,
                    ...baseEnv(),
                }),
                encoding: "utf8",
            });

            expect(result.status).toBe(2);
            expect(result.stdout).toBe("Authentication: FAIL\nReason: node-missing\n");
            expect(`${result.stdout}\n${result.stderr}`).not.toContain(LOGIN_SECRET);
            expect(`${result.stdout}\n${result.stderr}`).not.toContain(PASSWORD_SECRET);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
