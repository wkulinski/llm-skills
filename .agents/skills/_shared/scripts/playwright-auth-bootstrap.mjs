#!/usr/bin/env node

import {spawnSync} from "node:child_process";
import {lstatSync, mkdirSync, realpathSync, rmSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {fileURLToPath} from "node:url";

const AUTH_OK = "Authentication: OK";
const AUTH_FAIL = "Authentication: FAIL";

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

function createSafeLog(log, env) {
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

function isLoopbackUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) {
        return false;
    }

    let parsed;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return false;
    }

    const hostname = parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")
        ? parsed.hostname.slice(1, -1)
        : parsed.hostname;

    return ["http:", "https:"].includes(parsed.protocol) && LOOPBACK_HOSTS.has(hostname);
}

function resolveStatePath(env, cwd) {
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

function hasSafeStateDirectories(statePath, cwd) {
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

function isIgnoredByGit(cwd, filePath) {
    const result = spawnSync("git", ["check-ignore", "-q", "--", filePath], {cwd, encoding: "utf8"});
    return !result.error && result.status === 0;
}

function isUsableExistingState(statePath, cwd) {
    return statePath !== null
        && hasSafeStateDirectories(statePath, cwd)
        && isRegularFile(statePath.absolute)
        && isIgnoredByGit(cwd, statePath.absolute);
}

function isAcceptableStateTarget(statePath) {
    if (statePath === null) {
        return false;
    }

    try {
        return lstatSync(statePath.absolute).isFile();
    } catch (error) {
        return error.code === "ENOENT";
    }
}

function removeStateFile(statePath) {
    if (statePath === null) {
        return;
    }

    try {
        rmSync(statePath.absolute, {force: true});
    } catch {
        // Best-effort cleanup; the invalid state outcome is already decided.
    }
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
 * @param {{
 *   env?: object,
 *   cwd?: string,
 *   resolvePlaywright?: () => object,
 *   log?: (line: string) => void,
 * }} options
 * @returns {Promise<{code: number, reason: string|null}>}
 */
export async function runAuthBootstrap({env = {}, cwd = process.cwd(), resolvePlaywright, log = defaultLog} = {}) {
    const safeLog = createSafeLog(log, env);
    const fail = (code, reason) => {
        safeLog(AUTH_FAIL);
        safeLog(`Reason: ${reason}`);
        return {code, reason};
    };
    const succeed = (relativePath) => {
        safeLog(AUTH_OK);
        safeLog(`Storage state: ${relativePath}`);
        return {code: EXIT_OK, reason: null};
    };

    try {
        const statePath = resolveStatePath(env, cwd);
        if (!hasSafeStateDirectories(statePath, cwd)) {
            return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
        }
        if (isUsableExistingState(statePath, cwd)) {
            return succeed(statePath.relative);
        }
        if (!isAcceptableStateTarget(statePath) || isRegularFile(statePath.absolute)) {
            return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
        }

        if (!env.PLAYWRIGHT_GUI_LOGIN_URL || !env.PLAYWRIGHT_GUI_USER_LOGIN || !env.PLAYWRIGHT_GUI_USER_PASSWORD) {
            return fail(EXIT_PRECONDITION, "env-missing");
        }

        let playwright;
        try {
            playwright = await resolvePlaywright();
        } catch {
            return fail(EXIT_PRECONDITION, REASON_PLAYWRIGHT_MODULE_UNAVAILABLE);
        }
        if (playwright === null || playwright === undefined) {
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

            if (!hasSafeStateDirectories(statePath, cwd) || !isAcceptableStateTarget(statePath)) {
                return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
            }

            try {
                mkdirSync(path.dirname(statePath.absolute), {recursive: true});
                if (!hasSafeStateDirectories(statePath, cwd)) {
                    return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
                }
                await context.storageState({path: statePath.absolute});
            } catch {
                removeStateFile(statePath);
                return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
            }

            if (!isRegularFile(statePath.absolute) || !isIgnoredByGit(cwd, statePath.absolute)) {
                removeStateFile(statePath);
                return fail(EXIT_EXECUTION, REASON_STATE_INVALID);
            }

            return succeed(statePath.relative);
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

function defaultResolvePlaywright(cliPath, cwd) {
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

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
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

    return {cliPath};
}

async function main() {
    const cwd = process.cwd();

    try {
        const {cliPath} = parseCliArgs(process.argv.slice(2));
        const result = await runAuthBootstrap({
            env: process.env,
            cwd,
            resolvePlaywright: () => defaultResolvePlaywright(cliPath, cwd),
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
