import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {resolveArtifactCacheRoot} from "../../_shared/scripts/artifact-path.mjs";
import {writeFileAtomic} from "../../_shared/scripts/task-plan/atomic-file.mjs";

import {readSnapshot} from "./learning-store.mjs";

const fail = (message) => Object.assign(new Error(message), {code: "STORAGE_CONFLICT"});
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** V1/V2 are readable and V4 resolves references from the durable store. */
export function decodeLock(value, options = {}) {
    if (value?.schemaVersion === 3) {
        throw Object.assign(new Error("V3 is unsupported. Use a plain JSON V1/V2 lock or a migrated V4 store."), {code: "UNSUPPORTED_SCHEMA"});
    }
    return value?.schemaVersion === 4 ? readSnapshot(value, options) : value;
}

function safePath(root, name) {
    if (typeof name !== "string" || !name || path.isAbsolute(name) || /^[a-z]:/i.test(name) || name.includes("\\") || name.split("/").some((p) => !p || p === "." || p === ".." || p === ".git")) { throw fail("Unsafe material path"); }
    const parts = name.split("/");
    for (let i = 1; i <= parts.length; i++) {
        const target = path.join(root, ...parts.slice(0, i));
        try { if (fs.lstatSync(target).isSymbolicLink()) { throw fail("Symlink in material path"); } }
        catch (error) { if (error.code !== "ENOENT") { throw error; } }
    }
    return path.join(root, name);
}
export function createMaterialStore({cwd = process.cwd(), cacheRoot = resolveArtifactCacheRoot(cwd)} = {}) {
    const root = requireRepositoryRoot(cwd);
    const directory = path.resolve(root, cacheRoot, "gh-review-learn/materials");
    const relative = path.relative(root, directory).split(path.sep).join("/");
    safePath(root, `${relative}/check`);
    return (bytes, encoding = "raw") => {
        const digest = hash(bytes);
        const name = `${relative}/${digest}.${encoding === "json" ? "json" : "blob"}`;
        const target = safePath(root, name);
        if (fs.existsSync(target)) {
            if (!fs.lstatSync(target).isFile() || hash(fs.readFileSync(target)) !== digest) { throw fail("Existing material artifact differs"); }
        } else {
            fs.mkdirSync(directory, {recursive: true, mode: 0o700});
            try { writeFileAtomic(target, bytes, {rootDir: root}); fs.chmodSync(target, 0o600); }
            catch (error) { throw fail(`Cannot publish material artifact: ${error.message}`); }
        }
        return {path: name, hash: digest, byteLength: bytes.length, encoding};
    };
}
export function readArtifact(artifact, {cwd = process.cwd(), cacheRoot = resolveArtifactCacheRoot(cwd)} = {}) {
    const root = requireRepositoryRoot(cwd);
    const directory = path.resolve(root, cacheRoot, "gh-review-learn/materials");
    if (!artifact || !["raw", "json"].includes(artifact.encoding) || !/^[a-f0-9]{64}$/.test(artifact.hash) || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) { throw fail("Invalid material artifact reference"); }
    const file = safePath(root, artifact.path);
    if (path.dirname(file) !== directory || path.basename(file) !== `${artifact.hash}.${artifact.encoding === "json" ? "json" : "blob"}`) { throw fail("Material artifact identity or location differs"); }
    let bytes;
    try { if (!fs.lstatSync(file).isFile()) { throw fail("Material is not a regular file"); } bytes = fs.readFileSync(file); }
    catch { throw fail(`Material artifact unavailable: ${artifact.path}`); }
    if (bytes.length !== artifact.byteLength || hash(bytes) !== artifact.hash) { throw fail(`Material artifact corrupted: ${artifact.path}`); }
    return bytes;
}
function validateInventoryBytes(bytes) {
    try { if (!Array.isArray(JSON.parse(bytes.toString("utf8")))) { throw new Error("Expected inventory array"); } }
    catch { throw fail("Invalid inventory artifact JSON"); }
}
export function validateMaterialArtifacts(prepared, options) {
    const seen = new Map();
    for (const item of prepared.items ?? []) {
        for (const m of item.materials ?? []) {
            if (!m.artifact) { continue; }
            const signature = JSON.stringify(m.artifact);
            if (seen.get(m.artifact.path) === signature) { continue; }
            const bytes = readArtifact(m.artifact, options);
            if (m.artifact.encoding === "json") { validateInventoryBytes(bytes); }
            seen.set(m.artifact.path, signature);
        }
    }
}
export function readPreparedMaterial(prepared, id, {pr, start = 0, end, ...options} = {}) {
    const matches = prepared.items.filter((item) => typeof pr === "undefined" || item.number === pr).flatMap((item) => item.materials.filter((m) => m.id === id));
    if (!matches.length) { throw fail("Unknown prepared material"); }
    const m = matches[0];
    if (matches.some((other) => JSON.stringify(other) !== JSON.stringify(m))) { throw fail("Ambiguous material; specify --pr"); }
    if (m.status !== "available") { throw fail("Material is unavailable"); }
    const content = m.artifact ? readArtifact(m.artifact, options) : m.bytes ? Buffer.from(m.bytes, "base64") : null;
    if (m.artifact?.encoding === "json") { return {...m, files: JSON.parse(content.toString("utf8"))}; }
    if (content === null) { return m; }
    const text = content.toString("utf8"); const rangeEnd = end ?? text.length;
    if (!Number.isInteger(start) || !Number.isInteger(rangeEnd) || start < 0 || rangeEnd < start || rangeEnd > text.length) { throw fail("Invalid UTF-16 material range"); }
    // Range reads stay small. The raw artifact holds all exact binary bytes.
    const metadata = {...m}; delete metadata.bytes; delete metadata.text;
    return {...metadata, text: text.slice(start, rangeEnd), start, end: rangeEnd, totalLength: text.length, ...(start === 0 && rangeEnd === text.length ? {bytes: content.toString("base64")} : {})};
}
