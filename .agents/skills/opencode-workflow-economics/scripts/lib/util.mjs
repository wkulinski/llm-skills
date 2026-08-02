import { createHash } from "node:crypto";
export function record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
export function nested(value, ...keys) {
    let current = value;
    for (const key of keys)
    { current = record(current)[key]; }
    return current;
}
export function text(value) {
    return typeof value === "string" && value.trim() !== "" ? value : null;
}
export function firstText(...values) {
    for (const value of values) {
        const result = text(value);
        if (result !== null)
        { return result; }
    }
    return null;
}
export function integer(value) {
    if (typeof value === "bigint")
    { return value; }
    if (typeof value === "number" && Number.isSafeInteger(value))
    { return BigInt(value); }
    if (typeof value === "string" && /^-?\d+$/.test(value))
    { return BigInt(value); }
    return null;
}
export function bool(value) {
    return typeof value === "boolean" ? value : null;
}
export function clampText(value, limit) {
    if (value.length <= limit)
    { return value; }
    return `${value.slice(0, Math.max(0, limit - 14))}\n…[truncated]`;
}
export function utf8Metrics(value) {
    return {
        bytes: BigInt(new TextEncoder().encode(value).byteLength),
        lines: BigInt(value === "" ? 0 : value.split(/\r?\n/).length),
    };
}
export function stableValue(value) {
    if (typeof value === "bigint")
    { return value.toString(); }
    if (Array.isArray(value))
    { return value.map(stableValue); }
    if (!value || typeof value !== "object")
    { return value; }
    return Object.fromEntries(Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]));
}
export function stableJson(value, pretty = false) {
    return JSON.stringify(stableValue(value), null, pretty ? 2 : undefined);
}
export function sha256(value) {
    return createHash("sha256").update(stableJson(value)).digest("hex");
}
export function durationMs(start, end) {
    if (start === null || end === null || end < start)
    { return null; }
    return end - start;
}
export function parseSince(value, now = Date.now()) {
    if (!value)
    { return null; }
    const duration = /^(\d+)([hdw])$/.exec(value);
    if (duration) {
        const count = Number(duration[1]);
        const unit = duration[2];
        const multiplier = unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 604_800_000;
        return now - count * multiplier;
    }
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed))
    { throw new Error(`Invalid --since value: ${value}`); }
    return parsed;
}
export function snakeCaseKey(key) {
    return key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
}
export function toSnakeCase(value) {
    if (typeof value === "bigint")
    { return value.toString(); }
    if (Array.isArray(value))
    { return value.map(toSnakeCase); }
    if (!value || typeof value !== "object")
    { return value; }
    return Object.fromEntries(Object.entries(value)
        .map(([key, item]) => [snakeCaseKey(key), toSnakeCase(item)]));
}
