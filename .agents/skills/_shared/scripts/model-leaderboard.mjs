#!/usr/bin/env node

import {isMainModule} from "./is-main-module.mjs";

export const LEADERBOARD_URL = "https://aicodingdaily.com/leaderboard";

export class LeaderboardError extends Error {
    constructor(code, message) {
        super(message);
        this.name = "LeaderboardError";
        this.code = code;
    }
}

function fail(code = "INVALID_LEADERBOARD") {
    // Never include response bodies or remote error messages in diagnostics.
    throw new LeaderboardError(code, "Leaderboard comparison input is invalid or ambiguous.");
}

function requiredString(value, code) {
    if (typeof value !== "string" || !value.trim()) fail(code);
    return value.trim();
}

function points(value, code = "INVALID_LEADERBOARD") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 70) fail(code);
    return value;
}

function decodeEntities(text) {
    const named = {amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " "};
    return text.replace(/&([^;\s]+);/g, (_match, entity) => {
        if (Object.hasOwn(named, entity)) return named[entity];
        if (!/^#(?:[0-9]+|x[0-9a-f]+)$/i.test(entity)) fail();
        const value = entity[1].toLowerCase() === "x"
            ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (value <= 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) fail();
        return String.fromCodePoint(value);
    });
}

function plainText(html) {
    if (/<\/?[^>]+>/.test(html)) fail();
    return decodeEntities(html).replace(/\s+/g, " ").trim();
}

function elements(html, tag) {
    const matches = [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi"))];
    const opens = html.match(new RegExp(`<${tag}\\b`, "gi")) ?? [];
    const closes = html.match(new RegExp(`<\\/${tag}\\s*>`, "gi")) ?? [];
    if (matches.length !== opens.length || matches.length !== closes.length) fail();
    return matches.map((match) => ({html: match[0], body: match[1]}));
}

/** A deliberately narrow, fail-closed adapter for the server-rendered table.
 * It is not a general HTML parser. A layout/scale change requires a new adapter.
 * Labels stay exactly as displayed; pairing them with local profiles is the
 * agent's job, so the parser never derives model identity or reasoning.
 */
export function parseLeaderboardHtml(html) {
    if (typeof html !== "string" || !html.trim()) fail();
    const cleaned = html.replace(/<!--[\s\S]*?-->/g, "")
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    const tables = elements(cleaned, "table");
    if (tables.length !== 1 || /<table\b/i.test(tables[0].body)) fail();
    const heads = elements(tables[0].body, "thead");
    const bodies = elements(tables[0].body, "tbody");
    if (heads.length !== 1 || bodies.length !== 1) fail();
    if (tables[0].body.replace(heads[0].html, "").replace(bodies[0].html, "").trim()) fail();
    const headings = elements(heads[0].body, "tr");
    if (headings.length !== 2) fail();
    if (heads[0].body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()) fail();
    const headers = elements(headings[0].body, "th").map(({body}) => plainText(body.replace(/<[^>]+>/g, " ")));
    if (headers[0] !== "#" || headers[1] !== "Model" || headers[2] !== "Total points (max 70)") fail();
    const rows = elements(bodies[0].body, "tr");
    if (!rows.length || bodies[0].body.replace(/<tr\b[^>]*>[\s\S]*?<\/tr\s*>/gi, "").trim()) fail();
    const entries = rows.map(({body}) => {
        const cells = elements(body, "td");
        if (cells.length !== 11 || body.replace(/<td\b[^>]*>[\s\S]*?<\/td\s*>/gi, "").trim()) fail();
        if (!/^[1-9][0-9]*$/.test(plainText(cells[0].body))) fail();
        const link = cells[1].body.trim().match(/^<a\b([^>]*)>([^<]*)<\/a\s*>$/i);
        if (!link) fail();
        const hrefs = [...link[1].matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)];
        if (hrefs.length !== 1 || !/^https:\/\/aicodingdaily\.com\/model\/[a-z0-9-]+$/.test(hrefs[0][2])) fail();
        const score = plainText(cells[2].body);
        if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(score)) fail();
        return {label: plainText(link[2]), totalPoints: points(Number(score))};
    });
    return normalizeEntries(entries);
}

function normalizeEntries(entries) {
    if (!Array.isArray(entries)) fail();
    const seen = new Set();
    return entries.map((entry) => {
        const label = requiredString(entry?.label, "INVALID_LEADERBOARD");
        if (seen.has(label)) fail();
        seen.add(label);
        return {label, totalPoints: points(entry.totalPoints)};
    });
}

/** Shared live evidence boundary for planning and external environment comparisons.
 * Entries remain in memory; WP executor selection belongs to the planning agent.
 */
export async function fetchFreshLeaderboard({fetchImpl = globalThis.fetch} = {}) {
    if (typeof fetchImpl !== "function") fail("INVALID_FETCH_IMPLEMENTATION");
    try {
        const response = await fetchImpl(LEADERBOARD_URL, {cache: "no-store", signal: AbortSignal.timeout(15000)});
        if (!response?.ok || response.status !== 200) fail("LEADERBOARD_HTTP_ERROR");
        if (!/^text\/html(?:\s*;|$)/i.test(response.headers?.get("content-type") ?? "")) fail("LEADERBOARD_CONTENT_TYPE");
        const entries = parseLeaderboardHtml(await response.text());
        return {entries, source: LEADERBOARD_URL, fetchedAt: new Date().toISOString()};
    } catch (error) {
        if (error instanceof LeaderboardError) throw error;
        fail("LEADERBOARD_FETCH_FAILED");
    }
}

function normalizeProfile(value, code = "INVALID_PROFILE") {
    if (!value || typeof value !== "object") fail(code);
    return {
        model: requiredString(value.model, code),
        reasoning: requiredString(value.reasoning, code),
        label: requiredString(value.label, code),
    };
}

function comparisonDecision(reason, code, required, current) {
    return {status: "decision-required", sufficient: false, reason, code: code ?? null, required, current};
}

/** Compare a required and a current profile against ONE fresh leaderboard read.
 * Each side carries the exact displayed label chosen by the agent; a missing
 * label, a shared label or an unavailable read asks for a decision instead of
 * inventing a score. The two-point tolerance applies only to this external
 * comparison, never to the local hierarchy.
 */
export async function compareFreshProfiles(required, current, {fetchImpl = globalThis.fetch} = {}) {
    // Caller/configuration errors are not network failures.
    const requiredProfile = normalizeProfile(required);
    const currentProfile = normalizeProfile(current);
    if (typeof fetchImpl !== "function") fail("INVALID_FETCH_IMPLEMENTATION");
    if (requiredProfile.label === currentProfile.label) {
        return comparisonDecision("ambiguous-pairing", null, requiredProfile, currentProfile);
    }
    let fetched;
    try {
        fetched = await fetchFreshLeaderboard({fetchImpl});
    } catch (error) {
        if (!(error instanceof LeaderboardError)) throw error;
        return comparisonDecision("ranking-unavailable", error.code, requiredProfile, currentProfile);
    }
    const pointsByLabel = new Map(fetched.entries.map((entry) => [entry.label, entry.totalPoints]));
    if (!pointsByLabel.has(requiredProfile.label) || !pointsByLabel.has(currentProfile.label)) {
        return comparisonDecision("label-not-found", null, requiredProfile, currentProfile);
    }
    const tolerance = 2;
    const requiredPoints = pointsByLabel.get(requiredProfile.label);
    const currentPoints = pointsByLabel.get(currentProfile.label);
    return {
        status: "compared",
        sufficient: currentPoints >= requiredPoints - tolerance,
        required: {...requiredProfile, totalPoints: requiredPoints},
        current: {...currentProfile, totalPoints: currentPoints},
        tolerance,
        source: fetched.source,
        fetchedAt: fetched.fetchedAt,
    };
}

function usage() {
    return [
        "Usage:",
        "  model-leaderboard.mjs entries",
        "",
        "entries prints fresh evidence (label, totalPoints, source, fetchedAt); never save the rows.",
        "The planning agent chooses the lowest sufficient project hierarchy profile; this helper does not recommend one.",
    ].join("\n");
}

function parseArgs(argv) {
    const result = {_: []};
    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];
        if (!token.startsWith("--")) {
            result._.push(token);
            continue;
        }
        const key = token.slice(2).replaceAll("-", "_");
        const next = argv[index + 1];
        if (typeof next === "undefined" || next.startsWith("--")) {
            result[key] = true;
        } else {
            result[key] = next;
            index += 1;
        }
    }
    return result;
}

async function main(argv) {
    const args = parseArgs(argv);
    const command = args._[0];
    if (args.help || !command) {
        process.stdout.write(`${usage()}\n`);
        return;
    }
    if (command !== "entries") {
        throw new LeaderboardError("INVALID_ARGUMENT", usage());
    }
    const result = await fetchFreshLeaderboard();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${JSON.stringify({error: error.code ?? "LEADERBOARD_ERROR", message: error.message})}\n`);
        process.exitCode = error.code === "INVALID_ARGUMENT" ? 2 : 1;
    });
}
