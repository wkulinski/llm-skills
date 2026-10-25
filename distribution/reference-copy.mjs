#!/usr/bin/env node
// Bounded reference copy, not a synchronizer: no fetching, config merge or runtime setup.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {fileURLToPath} from "node:url";

const RECEIPT = ".agents/skills-delivery.json";
const MANIFEST = "distribution/linux-opencode/manifest.json";
const hash = data => crypto.createHash("sha256").update(data).digest("hex");
const fail = message => { throw new Error(message); };
const managedPath = relative => relative.startsWith(".agents/skills/")
    || relative.startsWith(".agents/skills-templates/")
    || /^\.opencode\/agents\/context-(?:refresher|scout|scout-fast)\.md$/u.test(relative)
    || relative === ".opencode/plugins/session-model-env.js";

function safePath(root, relative) {
    if (typeof relative !== "string" || !relative || relative.includes("\\")
        || path.posix.isAbsolute(relative) || relative.split("/").some(p => !p || p === "." || p === "..")) {
        fail(`Unsafe path: ${relative}`);
    }
    let current = root;
    for (const part of relative.split("/")) {
        current = path.join(current, part);
        try { if (fs.lstatSync(current).isSymbolicLink()) { fail(`Symlink forbidden: ${relative}`); } }
        catch (error) { if (error.code === "ENOENT") { break; } throw error; }
    }
    return path.join(root, relative);
}

function fileData(root, relative) {
    const filename = safePath(root, relative);
    let stat;
    try { stat = fs.lstatSync(filename); }
    catch (error) { if (error.code === "ENOENT") { fail(`Missing dependency: ${relative}`); } throw error; }
    if (!stat.isFile()) { fail(`Not a regular file: ${relative}`); }
    const data = fs.readFileSync(filename);
    return {data, sha256: hash(data), executable: Boolean(stat.mode & 0o111)};
}

export function inventory(sourceInput) {
    const source = fs.realpathSync(sourceInput);
    const manifest = JSON.parse(fileData(source, MANIFEST).data);
    if (manifest.version !== 1) { fail("Unsupported delivery manifest"); }
    const entries = new Map();
    const add = (from, to) => {
        if (entries.has(to)) { fail(`Duplicate delivery target: ${to}`); }
        if (!managedPath(to)) { fail(`Target outside delivery boundary: ${to}`); }
        safePath(source, to);
        entries.set(to, {source: from, ...fileData(source, from)});
    };
    const walk = relative => {
        const directory = safePath(source, relative);
        if (!fs.existsSync(directory)) { fail(`Missing dependency: ${relative}`); }
        for (const name of fs.readdirSync(directory).sort()) {
            const child = `${relative}/${name}`;
            const stat = fs.lstatSync(safePath(source, child));
            if (stat.isDirectory()) { walk(child); }
            else { add(child, child); }
        }
    };
    for (const tree of manifest.trees) {
        walk(tree);
        if (tree !== ".agents/skills/_shared") { fileData(source, `${tree}/SKILL.md`); }
    }
    for (const entry of manifest.files) { add(entry.source, entry.target); }
    // Frontmatter availability is a hard gate, including files omitted from the source tree.
    for (const [target, entry] of entries) {
        const text = entry.data.toString();
        const imports = /\.(?:mjs|js)$/u.test(target)
            ? text.matchAll(/(?:from\s*|import\s*\()(["'])(\.[^"']+)\1/gu)
            : [];
        for (const match of imports) {
            const required = path.posix.normalize(path.posix.join(path.posix.dirname(target), match[2]));
            if (!entries.has(required)) { fail(`Missing dependency: ${required} (imported by ${target})`); }
        }
        if (!target.endsWith("/SKILL.md")) { continue; }
        const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
        const shared = frontmatter.match(/^shared_files:\s*\r?\n((?:[ \t]+.*\r?\n?)*)/mu)?.[1] ?? "";
        for (const match of shared.matchAll(/^\s*-\s*["']?([^\s"']+)["']?\s*$/gmu)) {
            const required = `.agents/skills/${match[1]}`;
            if (!entries.has(required)) { fail(`Missing dependency: ${required} (declared by ${target})`); }
        }
        for (const match of text.matchAll(/<skill_dir>\/([A-Za-z0-9_./-]+\.(?:mjs|js|md|sh|json)(?:\.dist)?)\b/gu)) {
            const required = `${path.posix.dirname(target)}/${match[1]}`;
            if (!entries.has(required)) { fail(`Missing dependency: ${required} (referenced by ${target})`); }
        }
    }
    // Code-point order, independent of the operator's locale.
    return {manifest, entries: new Map([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))};
}

function readReceipt(target) {
    const filename = safePath(target, RECEIPT);
    if (!fs.existsSync(filename)) { return null; }
    const value = JSON.parse(fileData(target, RECEIPT).data);
    if (value.version !== 1 || typeof value.manifest !== "string" || !Array.isArray(value.files)
        || value.contentSha256 !== hash(JSON.stringify(value.files))) { fail("Invalid delivery receipt"); }
    const seen = new Set();
    for (const entry of value.files) {
        safePath(target, entry.path);
        if (!/^[a-f0-9]{64}$/u.test(entry.sha256) || typeof entry.executable !== "boolean"
            || seen.has(entry.path) || !managedPath(entry.path)) { fail("Invalid delivery receipt entry"); }
        seen.add(entry.path);
    }
    return value;
}

export function copy(sourceInput, targetInput, {apply = false} = {}) {
    const source = fs.realpathSync(sourceInput);
    const target = fs.realpathSync(targetInput);
    if (source === target || source.startsWith(`${target}/`) || target.startsWith(`${source}/`)) {
        fail("Source and consumer must be separate, non-nested directories");
    }
    const {manifest, entries} = inventory(source);
    const previous = readReceipt(target);
    const old = new Map((previous?.files ?? []).map(entry => [entry.path, entry]));
    const conflicts = [];
    // Validate ALL paths before writing any file. A locally changed managed file is not ours to replace.
    for (const [relative, expected] of old) {
        try {
            const actual = fileData(target, relative);
            if (actual.sha256 !== expected.sha256 || actual.executable !== expected.executable) {
                conflicts.push(`Locally modified managed file: ${relative}`);
            }
        } catch (error) { conflicts.push(error.message); }
    }
    const operations = [];
    for (const [relative, entry] of entries) {
        const destination = safePath(target, relative);
        if (!old.has(relative) && fs.existsSync(destination)) { conflicts.push(`Unmanaged file conflict: ${relative}`); }
        const prior = old.get(relative);
        if (!prior || prior.sha256 !== entry.sha256 || prior.executable !== entry.executable) {
            operations.push({action: prior ? "update" : "add", path: relative});
        }
    }
    for (const relative of old.keys()) {
        if (!entries.has(relative)) { operations.push({action: "remove", path: relative}); }
    }
    if (conflicts.length) { fail(conflicts.join("\n")); }
    const files = [...entries].map(([relative, entry]) => ({path: relative, sha256: entry.sha256, executable: entry.executable}));
    const receipt = {version: 1, manifest: manifest.id, contentSha256: hash(JSON.stringify(files)), files};
    if (apply) {
        for (const operation of operations) {
            const destination = safePath(target, operation.path);
            if (operation.action === "remove") { fs.unlinkSync(destination); }
            else {
                const entry = entries.get(operation.path);
                fs.mkdirSync(path.dirname(destination), {recursive: true});
                fs.writeFileSync(destination, entry.data, {mode: entry.executable ? 0o755 : 0o644});
                fs.chmodSync(destination, entry.executable ? 0o755 : 0o644);
            }
        }
        const destination = safePath(target, RECEIPT);
        fs.mkdirSync(path.dirname(destination), {recursive: true});
        fs.writeFileSync(destination, `${JSON.stringify(receipt, null, 4)}\n`);
    }
    return {applied: apply, manifest: manifest.id, contentSha256: receipt.contentSha256, operations, files};
}

export function verify(source, targetInput) {
    const {manifest, entries} = inventory(source);
    const target = fs.realpathSync(targetInput);
    const receipt = readReceipt(target);
    if (!receipt) { fail(`Missing dependency: ${RECEIPT}`); }
    const missing = [];
    for (const [relative, expected] of entries) {
        try {
            const actual = fileData(target, relative);
            if (actual.sha256 !== expected.sha256 || actual.executable !== expected.executable) { missing.push(`Mismatch: ${relative}`); }
        } catch (error) { missing.push(error.message); }
    }
    const expectedFiles = [...entries].map(([relative, entry]) => ({path: relative, sha256: entry.sha256, executable: entry.executable}));
    if (receipt.manifest !== manifest.id || JSON.stringify(receipt.files) !== JSON.stringify(expectedFiles)) { missing.push("Receipt differs from source"); }
    for (const relative of manifest.consumerOwned) {
        try { fileData(target, relative); } catch (error) { missing.push(error.message); }
    }
    if (missing.length) { fail(missing.join("\n")); }
    return {status: "PASS", scope: "static files only; validate consumer configuration and live MCP separately", files: entries.size};
}

export function main(args) {
    const [command, source, target, flag] = args;
    if (command === "--help") { return {usage: "node distribution/reference-copy.mjs list SOURCE | copy SOURCE CONSUMER [--apply] | verify SOURCE CONSUMER"}; }
    if (!source || !["list", "copy", "verify"].includes(command)
        || args.length > (command === "list" ? 2 : command === "copy" ? 4 : 3)
        || (command !== "list" && !target) || (flag && flag !== "--apply")
        || (flag && command !== "copy")) { fail("Invalid arguments; use --help"); }
    if (command === "list") {
        return [...inventory(source).entries].map(([relative, entry]) => ({path: relative, sha256: entry.sha256, executable: entry.executable}));
    }
    return command === "copy" ? copy(source, target, {apply: flag === "--apply"}) : verify(source, target);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 4)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
}
