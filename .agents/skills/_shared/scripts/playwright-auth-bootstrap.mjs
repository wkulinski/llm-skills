#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {chmodSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";

const AUTH_FAIL = "Authentication: FAIL";
const AUTH_ACTION_REQUIRED = "Authentication: ACTION_REQUIRED";

const STATUS_ACTION_REQUIRED = "ACTION_REQUIRED";

const EXIT_OK = 0;
const EXIT_INTERNAL = 1;
const EXIT_PRECONDITION = 2;
const EXIT_EXECUTION = 3;

const REASON_PLAYWRIGHT_MODULE_UNAVAILABLE = "playwright-module-unavailable";
const REASON_SCOPE_NOT_LOOPBACK = "scope-not-loopback";
const REASON_BROWSER_UNAVAILABLE = "browser-unavailable";
const REASON_FORM_NOT_RECOGNIZED = "form-not-recognized";
const REASON_LOGIN_NOT_CONFIRMED = "login-not-confirmed";
const REASON_STATE_INVALID = "state-invalid";
const REASON_INTERNAL_ERROR = "internal-error";

const DEFAULT_STATE_PATH = ".playwright-cli/auth/storage-state.json";
const STATE_DIRECTORY_PREFIX = `.playwright-cli${path.sep}auth${path.sep}`;
const LOGIN_CONFIRM_TIMEOUT_MS = 15000;
const STATE_FILE_MODE = 0o600;

const PASSWORD_SELECTOR = 'input[type="password"]';
const LOGIN_SELECTORS = [
    'input[type="text"]',
    'input[type="email"]',
    'input[type="tel"]',
    "input:not([type])",
];
const SUBMIT_SELECTORS = [
    'button[type="submit"]',
    "button:not([type])",
    'input[type="submit"]',
];
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function defaultLog(line) {
    process.stdout.write(`${line}\n`);
}

function isConfigured(value) {
    return typeof value === "string" && value.length > 0;
}

export function createSafeLog(log, env) {
    const secrets = [env?.PLAYWRIGHT_GUI_USER_LOGIN, env?.PLAYWRIGHT_GUI_USER_PASSWORD]
        .filter((value) => typeof value === "string" && value.length > 0)
        .sort((left, right) => right.length - left.length);

    return (line) => {
        let safeLine = String(line);
        for (const secret of secrets) {
            safeLine = safeLine.split(secret).join("***");
        }
        log(safeLine);
    };
}

export function isHttpUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
        return false;
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return false;
    }

    if (parsed.username.length > 0 || parsed.password.length > 0) {
        return false;
    }

    return ["http:", "https:"].includes(parsed.protocol);
}

export function isLoopbackUrl(rawUrl) {
    if (!isHttpUrl(rawUrl)) { return false; }
    const parsed = new URL(rawUrl);
    const hostname = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
        ? parsed.hostname.slice(1, -1)
        : parsed.hostname;

    return ["http:", "https:"].includes(parsed.protocol) && LOOPBACK_HOSTS.has(hostname);
}

function isSameOrigin(candidateUrl, baseUrl) {
    try {
        return new URL(candidateUrl).origin === new URL(baseUrl).origin;
    } catch {
        return false;
    }
}

function isLoginUrl(candidateUrl, loginUrl) {
    if (!isConfigured(loginUrl)) {
        return false;
    }

    try {
        const candidate = new URL(candidateUrl);
        const login = new URL(loginUrl);
        return candidate.origin === login.origin && candidate.pathname === login.pathname;
    } catch {
        return false;
    }
}

export function resolveStatePath(env, cwd) {
    const configured = env?.PLAYWRIGHT_GUI_STORAGE_STATE;
    const candidate = typeof configured === "string" && configured.length > 0
        ? configured
        : DEFAULT_STATE_PATH;
    const normalized = path.normalize(candidate);

    if (path.isAbsolute(normalized) || !normalized.startsWith(STATE_DIRECTORY_PREFIX)) {
        return null;
    }

    return {
        absolute: path.resolve(cwd, normalized),
        relative: normalized.split(path.sep).join("/"),
    };
}

function isRegularFile(filePath) {
    try {
        return lstatSync(filePath).isFile();
    } catch {
        return false;
    }
}

export function hasSafeStateDirectories(statePath, cwd) {
    if (statePath === null) {
        return false;
    }

    const segments = path.relative(cwd, path.dirname(statePath.absolute)).split(path.sep);
    let current = cwd;
    for (const segment of segments) {
        current = path.join(current, segment);
        try {
            if (!lstatSync(current).isDirectory()) {
                return false;
            }
        } catch (error) {
            if (error.code !== "ENOENT") {
                return false;
            }
        }
    }

    return true;
}

export function isIgnoredByGit(cwd, filePath) {
    const result = spawnSync("git", ["check-ignore", "-q", "--", filePath], {cwd, encoding: "utf8"});
    return !result.error && result.status === 0;
}

export function isUsableExistingState(statePath, cwd) {
    return statePath !== null
        && hasSafeStateDirectories(statePath, cwd)
        && isRegularFile(statePath.absolute)
        && isIgnoredByGit(cwd, statePath.absolute);
}

export function isAcceptableStateTarget(statePath) {
    if (statePath === null) {
        return false;
    }

    try {
        return lstatSync(statePath.absolute).isFile();
    } catch (error) {
        return error.code === "ENOENT";
    }
}

function removeStateFile(absolutePath) {
    if (typeof absolutePath !== "string" || absolutePath.length === 0) {
        return;
    }

    try {
        rmSync(absolutePath, {force: true});
    } catch {
        // Best-effort cleanup; the invalid state outcome is already decided.
    }
}

export function createCandidateStatePath(statePath) {
    const name = `candidate-${randomUUID()}.json`;

    return {
        absolute: path.join(path.dirname(statePath.absolute), name),
        relative: path.posix.join(path.posix.dirname(statePath.relative), name),
    };
}

/**
 * Copies a validated existing storage state to a unique provisional file so an
 * agent can inspect it without another login attempt. Never touches the
 * canonical state file.
 *
 * @returns {string|null} Repo-relative candidate path or null when the state
 *   cannot be staged safely.
 */
function stageExistingStateAsCandidate(statePath, cwd) {
    if (!hasSafeStateDirectories(statePath, cwd)) {
        return null;
    }

    const pending = createCandidateStatePath(statePath);
    if (!isAcceptableStateTarget(pending) || !isIgnoredByGit(cwd, pending.absolute)) {
        return null;
    }

    let contents;
    try {
        contents = readFileSync(statePath.absolute);
    } catch {
        return null;
    }

    try {
        writeFileSync(pending.absolute, contents, {flag: "wx", mode: STATE_FILE_MODE});
        chmodSync(pending.absolute, STATE_FILE_MODE);
    } catch {
        removeStateFile(pending.absolute);
        return null;
    }

    if (!isRegularFile(pending.absolute) || !isIgnoredByGit(cwd, pending.absolute)) {
        removeStateFile(pending.absolute);
        return null;
    }

    return pending.relative;
}

/**
 * Saves the post-login browser state to a unique provisional file. The canonical
 * state file is never overwritten during bootstrap.
 *
 * @returns {Promise<string|null>} Repo-relative candidate path or null when the
 *   state cannot be staged safely.
 */
async function saveProvisionalState(context, statePath, cwd) {
    const pending = createCandidateStatePath(statePath);

    try {
        mkdirSync(path.dirname(statePath.absolute), {recursive: true});
        if (!hasSafeStateDirectories(statePath, cwd) || !isAcceptableStateTarget(pending)
            || !isIgnoredByGit(cwd, pending.absolute)) {
            return null;
        }
        writeFileSync(pending.absolute, "", {flag: "wx", mode: STATE_FILE_MODE});
        await context.storageState({path: pending.absolute});
        chmodSync(pending.absolute, STATE_FILE_MODE);
    } catch {
        removeStateFile(pending.absolute);
        return null;
    }

    if (!isRegularFile(pending.absolute) || !isIgnoredByGit(cwd, pending.absolute)) {
        removeStateFile(pending.absolute);
        return null;
    }

    return pending.relative;
}

function infrastructureError(reason) {
    const error = new Error(reason);
    error.reason = reason;
    return error;
}

async function firstVisible(root, selectors) {
    for (const selector of selectors) {
        const matches = root.locator(selector);
        const count = await matches.count();

        for (let index = 0; index < count; index += 1) {
            const candidate = matches.nth(index);
            if (await candidate.isVisible()) {
                return candidate;
            }
        }
    }

    return null;
}

/**
 * Discovers the loopback login form fields on an already loaded page.
 *
 * @param {object} page Playwright page-like object.
 * @returns {Promise<{form: object|null, password: object, login: object, submit: object}|null>}
 */
export async function discoverLoginForm(page) {
    const password = await firstVisible(page, [PASSWORD_SELECTOR]);
    if (password === null) {
        return null;
    }

    const formMatches = password.locator("xpath=ancestor::form[1]");
    const form = await formMatches.count() > 0 ? formMatches.first() : null;
    const login = await firstVisible(form ?? page, LOGIN_SELECTORS);
    if (login === null) {
        return null;
    }

    const submit = form === null ? null : await firstVisible(form, SUBMIT_SELECTORS);
    if (submit === null) {
        return null;
    }

    return {form, password, login, submit};
}

/**
 * Verifies an existing storage state against the protected application page in
 * a fresh browser context. Returns false for an authentication denial or an
 * unusable state file; throws an explicit infrastructure error when the browser
 * cannot be used (never reported as expired authentication).
 *
 * @param {{
 *   playwright: object,
 *   statePath: {absolute: string, relative: string},
 *   url: string,
 *   loginUrl?: string,
 * }} options
 * @returns {Promise<boolean>}
 */
export async function verifyStateAccess({playwright, statePath, url, loginUrl} = {}) {
    if (statePath === null || typeof statePath !== "object" || typeof statePath.absolute !== "string") {
        return false;
    }
    if (!isHttpUrl(url)) {
        return false;
    }

    let browser = null;
    try {
        try {
            browser = await playwright.chromium.launch();
        } catch {
            throw infrastructureError(REASON_BROWSER_UNAVAILABLE);
        }

        let context;
        try {
            context = await browser.newContext({storageState: statePath.absolute});
        } catch {
            return false;
        }

        let page;
        let response;
        try {
            page = await context.newPage();
            response = await page.goto(url);
        } catch {
            throw infrastructureError(REASON_BROWSER_UNAVAILABLE);
        }

        if (response === null || response === undefined
            || typeof response.status !== "function" || response.status() >= 400) {
            return false;
        }

        const finalUrl = page.url();
        if (!isSameOrigin(finalUrl, url) || isLoginUrl(finalUrl, loginUrl)) {
            return false;
        }

        const password = await firstVisible(page, [PASSWORD_SELECTOR]);
        if (password !== null) {
            return false;
        }

        // This only excludes technical denials. The agent evaluates actual access.
        return true;
    } finally {
        if (browser !== null) {
            try {
                await browser.close();
            } catch {
                // Browser teardown is best effort; the verification result is authoritative.
            }
        }
    }
}

/**
 * Resolves the browser's effective submission URL for the discovered submitter.
 *
 * @param {{submit: object}} form Discovered form controls.
 * @returns {Promise<string|null>} Absolute URL or null when it cannot be resolved.
 */
async function resolveFormTarget(form) {
    const target = await form.submit.evaluate((element) => {
        const owner = element.form;
        const rawAction = element.getAttribute("formaction")
            ?? (owner === null ? null : owner.getAttribute("action"));

        if (rawAction === null || rawAction === "") {
            return element.ownerDocument.URL;
        }

        try {
            return new URL(rawAction, element.ownerDocument.baseURI).href;
        } catch {
            return null;
        }
    });

    return typeof target === "string" && target.length > 0 ? target : null;
}

async function isLoopbackFormTarget(page, form) {
    if (!isLoopbackUrl(page.url())) {
        return false;
    }

    const target = await resolveFormTarget(form);
    return target !== null && isLoopbackUrl(target);
}

/**
 * Runs the authentication bootstrap against a resolved Playwright module.
 *
 * An existing state is copied privately for agent inspection, never verified
 * here. A successful login stages a unique candidate state and
 * returns ACTION_REQUIRED; the canonical state is never overwritten here and
 * the login is attempted at most once.
 *
 * @param {{
 *   env?: object,
 *   cwd?: string,
 *   resolvePlaywright?: () => object,
 *   log?: (line: string) => void,
 *   refresh?: boolean,
 * }} options
 * @returns {Promise<{code: number, reason: string|null, status?: string}>}
 */
export async function runAuthBootstrap({env = {}, cwd = process.cwd(), resolvePlaywright, log = defaultLog, refresh = false} = {}) {
    const safeLog = createSafeLog(log, env);
    const fail = (code, reason) => {
        safeLog(AUTH_FAIL);
        safeLog(`Reason: ${reason}`);
        return {code, reason};
    };
    const actionRequired = (relativePath, continuationUrl = null) => {
        safeLog(AUTH_ACTION_REQUIRED);
        safeLog(`Candidate state: ${relativePath}`);
        if (continuationUrl !== null) {
            const parsed = new URL(continuationUrl);
            // Query and fragment can contain tokens; never publish them in helper output.
            safeLog(`Continuation URL: ${parsed.origin}${parsed.pathname}`);
        }
        return {code: EXIT_OK, reason: null, status: STATUS_ACTION_REQUIRED};
    };

    try {
        const statePath = resolveStatePath(env, cwd);
        if (!hasSafeStateDirectories(statePath, cwd)) {
            return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
        }

        let playwright = null;
        const resolvePlaywrightOnce = async () => {
            if (playwright === null) {
                playwright = await resolvePlaywright();
            }
            if (playwright === null || playwright === undefined) {
                throw new Error("playwright module unavailable");
            }
            return playwright;
        };

        const existingState = isUsableExistingState(statePath, cwd);
        if (!refresh && existingState) {
            const staged = stageExistingStateAsCandidate(statePath, cwd);
            if (staged === null) {
                return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
            }
            return actionRequired(staged);
        }

        if (!isAcceptableStateTarget(statePath)) {
            return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
        }

        if (!env.PLAYWRIGHT_GUI_LOGIN_URL || !env.PLAYWRIGHT_GUI_USER_LOGIN || !env.PLAYWRIGHT_GUI_USER_PASSWORD) {
            return fail(EXIT_PRECONDITION, "env-missing");
        }

        try {
            playwright = await resolvePlaywrightOnce();
        } catch {
            return fail(EXIT_PRECONDITION, REASON_PLAYWRIGHT_MODULE_UNAVAILABLE);
        }

        if (!isLoopbackUrl(env.PLAYWRIGHT_GUI_LOGIN_URL)) {
            return fail(EXIT_PRECONDITION, REASON_SCOPE_NOT_LOOPBACK);
        }

        let browser = null;
        try {
            let context;
            let page;
            try {
                browser = await playwright.chromium.launch();
                context = await browser.newContext();
                page = await context.newPage();
                await page.goto(env.PLAYWRIGHT_GUI_LOGIN_URL);
            } catch {
                return fail(EXIT_PRECONDITION, REASON_BROWSER_UNAVAILABLE);
            }

            const form = await discoverLoginForm(page);
            if (form === null) {
                return fail(EXIT_EXECUTION, REASON_FORM_NOT_RECOGNIZED);
            }

            if (!await isLoopbackFormTarget(page, form)) {
                return fail(EXIT_PRECONDITION, REASON_SCOPE_NOT_LOOPBACK);
            }

            await form.login.fill(env.PLAYWRIGHT_GUI_USER_LOGIN);
            await form.password.fill(env.PLAYWRIGHT_GUI_USER_PASSWORD);

            if (!await isLoopbackFormTarget(page, form)) {
                return fail(EXIT_PRECONDITION, REASON_SCOPE_NOT_LOOPBACK);
            }

            await form.submit.click();

            try {
                await form.password.waitFor({state: "hidden", timeout: LOGIN_CONFIRM_TIMEOUT_MS});
            } catch {
                return fail(EXIT_EXECUTION, REASON_LOGIN_NOT_CONFIRMED);
            }

            if (!isLoopbackUrl(page.url())) {
                return fail(EXIT_PRECONDITION, REASON_SCOPE_NOT_LOOPBACK);
            }

            const staged = await saveProvisionalState(context, statePath, cwd);
            if (staged === null) {
                return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
            }

            return actionRequired(staged, page.url());
        } finally {
            if (browser !== null) {
                try {
                    await browser.close();
                } catch {
                    // Browser teardown is best effort; the authentication result is authoritative.
                }
            }
        }
    } catch {
        return fail(EXIT_INTERNAL, REASON_INTERNAL_ERROR);
    }
}

function resolveCliRealpath(cliPath) {
    if (typeof cliPath !== "string" || cliPath.length === 0) {
        return null;
    }

    const candidates = cliPath.includes(path.sep)
        ? [cliPath]
        : (process.env.PATH ?? "")
            .split(path.delimiter)
            .filter((directory) => directory.length > 0)
            .map((directory) => path.join(directory, cliPath));

    for (const candidate of candidates) {
        try {
            return realpathSync(candidate);
        } catch {
            // Try the next candidate.
        }
    }

    return null;
}

export function defaultResolvePlaywright(cliPath, cwd) {
    const resolutionBases = [];
    const cliRealpath = resolveCliRealpath(cliPath);
    if (cliRealpath !== null) {
        resolutionBases.push(cliRealpath);
    }
    resolutionBases.push(path.join(cwd, "package.json"));

    for (const base of resolutionBases) {
        try {
            const requireFromBase = createRequire(base);
            return requireFromBase("playwright");
        } catch {
            // Try the next resolution base.
        }
    }

    throw new Error("playwright module unavailable");
}

function parseCliArgs(args) {
    let cliPath = "";
    let refresh = false;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === "--refresh") {
            refresh = true;
            continue;
        }
        if (argument !== "--cli") {
            throw new Error(`Unknown argument: ${argument}`);
        }

        const value = args[index + 1];
        if (value === undefined) {
            throw new Error("Missing value for --cli");
        }

        cliPath = value;
        index += 1;
    }

    return {cliPath, refresh};
}

async function main() {
    const cwd = process.cwd();
    if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
        process.stdout.write("Usage: playwright-auth-bootstrap.mjs [--cli <cli>] [--refresh]\nPrepares a private candidate for agent assessment; never promotes canonical state.\n");
        return;
    }

    try {
        const {cliPath, refresh} = parseCliArgs(process.argv.slice(2));
        const result = await runAuthBootstrap({
            env: process.env,
            cwd,
            resolvePlaywright: () => defaultResolvePlaywright(cliPath, cwd),
            refresh,
        });
        process.exitCode = result.code;
    } catch {
        process.stdout.write(`${AUTH_FAIL}\nReason: ${REASON_INTERNAL_ERROR}\n`);
        process.exitCode = EXIT_INTERNAL;
    }
}

function isDirectRun() {
    if (!process.argv[1]) {
        return false;
    }

    try {
        return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isDirectRun()) {
    await main();
}
