#!/usr/bin/env node

export const READ_PURPOSES = Object.freeze([
    "discovery",
    "read-before-write",
    "verification",
    "snapshot-refresh",
    "report-gap",
]);

export const READ_EVENTS = Object.freeze(["read", "report-reuse"]);
export const READ_SOURCES = Object.freeze(["main", "parent", "scout", "system", "unknown"]);
export const READ_MODES = Object.freeze(["full", "range", "report"]);

const PURPOSES = new Set(READ_PURPOSES);
const EVENTS = new Set(READ_EVENTS);
const SOURCES = new Set(READ_SOURCES);
const MODES = new Set(READ_MODES);
const INTERPRETERS = new Set(["node", "nodejs", "bun", "deno"]);
const STRUCTURED_OPTIONS = new Set([
    "event",
    "purpose",
    "source",
    "read-mode",
    "path",
    "scope",
    "delegation-id",
]);

export function normalizeReadPath(value) {
    return String(value ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

export function normalizeReadObservation(input = {}) {
    const event = input.event ?? "read";
    const purpose = input.purpose ?? null;
    const source = input.source ?? "main";
    const readMode = input.read_mode ?? "full";
    const resourceKind = input.resource_kind ?? (input.path ? "path" : input.scope ? "scope" : null);
    const resource = resourceKind === "path"
        ? normalizeReadPath(input.path ?? input.resource)
        : String(input.scope ?? input.resource ?? "").trim();
    const errors = [];

    if (!EVENTS.has(event)) { errors.push(`event must be one of: ${READ_EVENTS.join(", ")}`); }
    if (purpose !== null && !PURPOSES.has(purpose)) { errors.push(`purpose must be one of: ${READ_PURPOSES.join(", ")}`); }
    if (!SOURCES.has(source)) { errors.push(`source must be one of: ${READ_SOURCES.join(", ")}`); }
    if (!MODES.has(readMode)) { errors.push(`read_mode must be one of: ${READ_MODES.join(", ")}`); }
    if (event === "read" && purpose === null) { errors.push("purpose is required for read events"); }
    if (event === "read" && !resourceKind) { errors.push("path or scope is required for read events"); }
    if (event === "report-reuse" && readMode !== "report") { errors.push("report-reuse events must use read_mode=report"); }
    if (resourceKind !== null && !["path", "scope"].includes(resourceKind)) { errors.push("resource_kind must be path or scope"); }
    if (resourceKind === "path" && (resource === "" || resource.startsWith("/") || resource.split("/").includes("..") || resource.includes("..."))) {
        errors.push("path must be a non-empty repo-relative path without traversal or shorthand");
    }
    if (resourceKind === "scope" && (resource === "" || resource.length > 200 || /[\r\n]/.test(resource))) {
        errors.push("scope must be a non-empty single-line identifier up to 200 characters");
    }
    if (input.delegation_id !== undefined && (typeof input.delegation_id !== "string" || input.delegation_id.trim() === "")) {
        errors.push("delegation_id must be a non-empty string when provided");
    }

    return {
        valid: errors.length === 0,
        errors,
        observation: {
            event,
            purpose,
            source,
            read_mode: readMode,
            ...(resourceKind ? {resource_kind: resourceKind, resource} : {}),
            ...(input.delegation_id ? {delegation_id: input.delegation_id.trim()} : {}),
        },
    };
}

export function parseReadEventArgs(argv = []) {
    const values = {event: "read", source: "main", read_mode: null, purpose: null, path: null, scope: null, delegation_id: undefined};
    const message = [];
    const firstArgument = String(argv[0] ?? "");
    const firstOptionName = firstArgument.startsWith("--") ? firstArgument.slice(2).split(/=(.*)/s, 1)[0] : null;
    const structured = firstOptionName !== null && STRUCTURED_OPTIONS.has(firstOptionName);
    const errors = [];

    if (!structured) { return {structured: false, message: argv.map(String), errors: []}; }

    for (let index = 0; index < argv.length; index += 1) {
        const argument = String(argv[index]);
        if (!argument.startsWith("--") || argument === "--") {
            message.push(argument);
            continue;
        }
        const [rawName, inlineValue] = argument.slice(2).split(/=(.*)/s, 2);
        if (!STRUCTURED_OPTIONS.has(rawName)) {
            message.push(argument);
            continue;
        }
        const value = inlineValue ?? argv[index + 1];
        if (value === undefined || (inlineValue === undefined && String(value).startsWith("--"))) {
            errors.push(`missing value for --${rawName}`);
            continue;
        }
        if (inlineValue === undefined) { index += 1; }
        if (rawName === "event") { values.event = String(value); }
        else if (rawName === "purpose") { values.purpose = String(value); }
        else if (rawName === "source") { values.source = String(value); }
        else if (rawName === "read-mode") { values.read_mode = String(value); }
        else if (rawName === "path") {
            if (values.scope !== null) { errors.push("--path and --scope cannot be combined"); }
            values.path = String(value);
        }
        else if (rawName === "scope") {
            if (values.path !== null) { errors.push("--path and --scope cannot be combined"); }
            values.scope = String(value);
        }
        else if (rawName === "delegation-id") { values.delegation_id = String(value); }
    }

    const normalized = normalizeReadObservation({
        ...values,
        read_mode: values.read_mode ?? (values.event === "report-reuse" ? "report" : values.path !== null ? "full" : "range"),
        resource_kind: values.path !== null ? "path" : values.scope !== null ? "scope" : null,
    });
    return {structured: true, message, errors: [...errors, ...normalized.errors], observation: normalized.observation};
}

function tokenizeShellArgs(value) {
    const tokens = [];
    let current = "";
    let quote = null;
    let escaped = false;
    for (const character of String(value ?? "")) {
        if (escaped) { current += character; escaped = false; continue; }
        if (character === "\\" && quote !== "'") { escaped = true; continue; }
        if (quote !== null) {
            if (character === quote) { quote = null; }
            else { current += character; }
            continue;
        }
        if (character === "'" || character === '"') { quote = character; continue; }
        if (/\s/.test(character)) {
            if (current !== "") { tokens.push(current); current = ""; }
            continue;
        }
        current += character;
    }
    if (escaped) { current += "\\"; }
    if (current !== "") { tokens.push(current); }
    return tokens;
}

function isReadLogToken(value) {
    return /(?:^|[\\/])state-readlog\.mjs$/.test(value);
}

function isInterpreterToken(value) {
    return INTERPRETERS.has(String(value).split(/[\\/]/).at(-1));
}

function commandSeparator(value) {
    return value === ";" || value === "&&" || value === "||" || value === "|";
}

export function extractReadEventFromCommand(command) {
    if (typeof command !== "string") { return null; }
    const tokens = tokenizeShellArgs(command);
    let commandStart = true;
    let previous = null;
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (commandSeparator(token)) {
            commandStart = true;
            previous = null;
            continue;
        }
        const isExecutable = (commandStart || isInterpreterToken(previous)) && isReadLogToken(token);
        if (isExecutable) {
            const args = [];
            for (const argument of tokens.slice(index + 1)) {
                if (commandSeparator(argument)) { break; }
                args.push(argument);
            }
            const parsed = parseReadEventArgs(args);
            return parsed.structured && parsed.errors.length === 0 ? parsed.observation : null;
        }
        commandStart = false;
        previous = token;
    }
    return null;
}

export function formatReadObservation(observation) {
    const values = [
        `[read-event] event=${observation.event}`,
        `purpose=${observation.purpose ?? "none"}`,
        `source=${observation.source}`,
        `mode=${observation.read_mode}`,
    ];
    if (observation.resource_kind) { values.push(`${observation.resource_kind}=${observation.resource}`); }
    if (observation.delegation_id) { values.push(`delegation=${observation.delegation_id}`); }
    return values.join(" ");
}
