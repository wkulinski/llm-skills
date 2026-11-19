#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {createHash, randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {execFileSync} from "../../_shared/scripts/file-process.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {assertArtifactPath, resolveArtifactCacheRoot} from "../../_shared/scripts/artifact-path.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {RULES, canonicalJson, fingerprint, sourceFingerprint, pendingReasons, validateSources, validateLock, validatePrepared} from "./contracts.mjs";

const fail = (code, message) => Object.assign(new Error(message), {code});
const bytesHash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function validSha(sha) {
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) { throw fail("INVALID_SHA", "An exact Git SHA is required"); }
}
function relativePath(value) {
    if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\\") || /^[a-z]:/i.test(value) || value.split("/").some((part) => ["", ".", "..", ".git"].includes(part))) {
        throw fail("INVALID_PATH", "Expected a repository-relative path");
    }
    return value;
}
function safeFile(root, name) {
    relativePath(name);
    const parts = name.split("/");
    // Never traverse a parent symlink while examining the worktree.
    for (let index = 1; index < parts.length; index += 1) {
        const parent = path.join(root, ...parts.slice(0, index));
        if (fs.existsSync(parent) && fs.lstatSync(parent).isSymbolicLink()) { throw fail("SYMLINK_PARENT", `Symlink parent: ${name}`); }
    }
    return path.join(root, name);
}
export function createGitReader(cwd = process.cwd()) {
    const root = requireRepositoryRoot(cwd);
    const helper = fileURLToPath(new URL("../../_shared/scripts/env-load.sh", import.meta.url));
    const tool = execFileSync("bash", ["-c", 'source "$1"; resolve_tool_cmd git', "resolve-git", helper], {cwd: root, encoding: "utf8"}).trim();
    if (!tool || tool.includes("\n")) { throw fail("TOOL_RESOLUTION_FAILED", "Cannot resolve git"); }
    return (args) => execFileSync("bash", ["-c", 'source "$1" || exit $?; ensure_repo_env_loaded || exit $?; shift; exec "$@"', "git-env", helper, tool, ...args], {cwd: root, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, shell: false});
}
function gitText(git, args) { return git(args).toString("utf8"); }
function atomicJson(file, value) {
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {flag: "wx", mode: 0o600});
        fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, {force: true}); }
}
function splitIndex(git) {
    return gitText(git, ["ls-files", "--stage", "-z"]).split("\0").filter(Boolean).map((record) => {
        const tab = record.indexOf("\t");
        const [mode, oid, stage] = record.slice(0, tab).split(" ");
        if (tab < 0 || stage !== "0") { throw fail("INDEX_CONFLICT", "Unmerged or malformed index entry"); }
        return {path: record.slice(tab + 1), mode, oid};
    });
}
/** No HEAD in the digest: only the tracked path set, effective modes and bytes. */
export function buildContext({cwd = process.cwd(), git = createGitReader(cwd), cacheRoot = resolveArtifactCacheRoot(cwd), extraPaths = []} = {}) {
    const root = requireRepositoryRoot(cwd);
    const cache = path.resolve(root, cacheRoot);
    const index = splitIndex(git);
    for (const name of extraPaths) {
        relativePath(name);
        if (!index.some((file) => file.path === name)) { index.push({path: name, mode: "100644", oid: null}); }
    }
    const files = [];
    for (const record of index.sort((a, b) => order(a.path, b.path))) {
        if (record.path === "review-learning.lock.json" || record.path === ".git" || record.path.startsWith(".git/")) { continue; }
        const target = safeFile(root, record.path);
        if (target === cache || target.startsWith(`${cache}${path.sep}`)) { continue; }
        let stat;
        try { stat = fs.lstatSync(target); } catch (error) {
            if (error.code !== "ENOENT") { throw error; }
            files.push({path: record.path, mode: record.mode, hash: fingerprint({missing: true}), missing: true});
            continue;
        }
        if (stat.isSymbolicLink()) {
            files.push({path: record.path, mode: "120000", hash: bytesHash(fs.readlinkSync(target, {encoding: "buffer"}))});
        } else if (record.mode === "160000") {
            // A populated submodule has its own .git; an unpopulated one retains the index SHA.
            const oid = fs.existsSync(path.join(target, ".git")) ? gitText(git, ["-C", target, "rev-parse", "HEAD"]).trim() : record.oid;
            files.push({path: record.path, mode: "160000", hash: bytesHash(oid)});
        } else if (stat.isFile()) {
            files.push({path: record.path, mode: stat.mode & 0o111 ? "100755" : "100644", hash: bytesHash(fs.readFileSync(target))});
        } else { throw fail("UNSUPPORTED_FILE", `Unsupported tracked filesystem object: ${record.path}`); }
    }
    return {fingerprint: fingerprint(files), files, environmentScope: "All tracked configuration bytes; local untracked secrets excluded; runtime not inspected"};
}
function changes(previous, current) {
    if (!previous) { return {available: false, reason: "previous_context_manifest_unavailable", currentFiles: current.files}; }
    if (fingerprint(previous.files) !== previous.fingerprint) { throw fail("CONTEXT_CACHE_CORRUPT", "Cached context fingerprint differs"); }
    const before = new Map(previous.files.map((file) => [file.path, file]));
    const after = new Map(current.files.map((file) => [file.path, file]));
    return {available: true, paths: [...new Set([...before.keys(), ...after.keys()])].sort(order).filter((name) => canonicalJson(before.get(name) ?? null) !== canonicalJson(after.get(name) ?? null)).map((name) => ({path: name, before: before.get(name) ?? null, after: after.get(name) ?? null}))};
}
function range(text, start = 0, end = text.length) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > text.length) { throw fail("INVALID_RANGE", "Expected a valid UTF-16 text range, end exclusive"); }
    return {text: text.slice(start, end), start, end, totalLength: text.length};
}
export function readSource(sources, id, start, end) {
    validateSources(sources);
    const source = sources.sources.find((item) => item.id === id);
    if (!source) { throw fail("UNKNOWN_REFERENCE", `Unknown source: ${id}`); }
    return {id, ...range(source.body, start, end)};
}
export function readGitFile(git, sha, name, start, end) {
    validSha(sha); relativePath(name);
    // git show reads object bytes, including a symlink's stored target, without following it.
    const content = git(["show", `${sha}:${name}`]);
    return {sha, path: name, hash: bytesHash(content), encoding: "base64", bytes: content.toString("base64"), ...range(content.toString("utf8"), start, end)};
}
function material(id, kind, provenance, work) {
    try { return {id, kind, provenance, status: "available", ...work()}; } catch (error) {
        return {id, kind, provenance, status: "missing", reason: error.code === "ENOBUFS" ? "truncated_output" : "unavailable_git_object_or_path", diagnostic: String(error.stderr || error.message).trim()};
    }
}
function history(git, pr, sources) {
    const materials = [];
    const versions = [{role: "base", sha: pr.baseSha}, {role: "pr_head", sha: pr.headSha}, {role: "merged", sha: pr.mergeSha}];
    for (const source of sources) {
        for (const field of ["commitSha", "originalCommitSha"]) {
            if (source[field]) { versions.push({role: field === "commitSha" ? "reviewed" : "original_reviewed", sha: source[field], sourceId: source.id}); }
        }
    }
    const paths = [...new Set(sources.map((s) => s.path).filter((name) => name !== null))].sort(order);
    for (const sha of [...new Set(versions.map((v) => v.sha).filter(Boolean))].sort(order)) {
        validSha(sha);
        materials.push(material(`commit:${sha}`, "commit_inventory", `git tree ${sha}; exact object`, () => {
            git(["cat-file", "-e", `${sha}^{commit}`]);
            const tree = gitText(git, ["ls-tree", "-r", "-z", sha]).split("\0").filter(Boolean).map((line) => {
                const tab = line.indexOf("\t");
                const [mode, type, oid] = line.slice(0, tab).split(" ");
                return {path: line.slice(tab + 1), mode, type, oid};
            });
            return {sha, versions: versions.filter((v) => v.sha === sha), files: tree};
        }));
        for (const name of paths) {
            materials.push(material(`file:${sha}:${name}`, "file", `git show ${sha}:${name}`, () => readGitFile(git, sha, name)));
        }
    }
    const pairs = sources.flatMap((source) => source.commitSha ? [{from: source.commitSha, to: pr.headSha, role: "reviewed_to_pr_head", sourceId: source.id}] : []);
    pairs.push({from: pr.baseSha, to: pr.headSha, role: "base_to_pr_head"});
    if (pr.mergeSha) {
        pairs.push({from: pr.headSha, to: pr.mergeSha, role: "pr_head_to_merged"});
        const parent = material(`merge-parent:${pr.mergeSha}`, "merge_parent", `git rev-list --parents ${pr.mergeSha}`, () => {
            const ids = gitText(git, ["rev-list", "--parents", "-n", "1", pr.mergeSha]).trim().split(" ");
            if (ids.length < 2) { throw fail("MISSING_PARENT", "Merge object has no parent"); }
            return {sha: pr.mergeSha, firstParent: ids[1]};
        });
        materials.push(parent);
        if (parent.status === "available") { pairs.push({from: parent.firstParent, to: pr.mergeSha, role: "merge_first_parent_to_merged"}); }
    } else { materials.push({id: "merge:unavailable", kind: "commit_inventory", provenance: "GitHub merge SHA", status: "missing", reason: "merge_sha_unavailable"}); }
    for (const pair of pairs) {
        materials.push(material(`diff:${pair.role}:${pair.sourceId ?? "pr"}:${pair.from}:${pair.to}`, "diff", `git diff exact ${pair.from} ${pair.to}; ${pair.role}`, () => {
            validSha(pair.from); validSha(pair.to);
            git(["cat-file", "-e", `${pair.from}^{commit}`]); git(["cat-file", "-e", `${pair.to}^{commit}`]);
            const diff = git(["diff", "--no-ext-diff", "--no-textconv", "--binary", pair.from, pair.to, "--"]);
            return {...pair, hash: bytesHash(diff), bytes: diff.toString("base64"), text: diff.toString("utf8"), complete: true};
        }));
    }
    return materials;
}
function previousDocuments(root, previous) {
    return (previous?.documents ?? []).map((doc) => material(`current-document:${doc.path}`, "current_document", `worktree ${doc.path}`, () => {
        const name = safeFile(root, doc.path);
        if (fs.lstatSync(name).isSymbolicLink()) { throw fail("SYMLINK_DOCUMENT", "Document is a symlink"); }
        const bytes = fs.readFileSync(name);
        return {path: doc.path, hash: bytesHash(bytes), text: bytes.toString("utf8"), bytes: bytes.toString("base64")};
    }));
}
export function prepare({sources, lock = null, lockBytes = null, cwd = process.cwd(), cacheRoot = resolveArtifactCacheRoot(cwd), git = createGitReader(cwd), prs} = {}) {
    validateSources(sources);
    if (canonicalJson(sources.rules) !== canonicalJson(RULES)) { throw fail("RULES_CONFLICT", "Sources require recollection under current rules"); }
    const root = requireRepositoryRoot(cwd);
    const origin = gitText(git, ["remote", "get-url", "origin"]).trim();
    const match = origin.match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    if (!match || match[1].toLowerCase() !== sources.repository.name.toLowerCase()) { throw fail("REPOSITORY_CONFLICT", "Source repository does not match consumer origin"); }
    if (lock) {
        validateLock(lock, sources.repository);
        if (lockBytes === null || canonicalJson(JSON.parse(lockBytes.toString("utf8"))) !== canonicalJson(lock)) { throw fail("LOCK_CONFLICT", "Expected exact bytes of the loaded lock"); }
    } else if (lockBytes !== null) { throw fail("LOCK_CONFLICT", "Lock bytes supplied without lock"); }
    if (prs && (!Array.isArray(prs) || prs.some((n) => !Number.isSafeInteger(n) || n < 1 || !sources.prs.some((pr) => pr.number === n)))) { throw fail("INVALID_BATCH", "Unknown or invalid PR selection"); }
    const context = buildContext({cwd: root, git, cacheRoot});
    const projectSha = gitText(git, ["rev-parse", "HEAD"]).trim();
    const sorted = [...sources.prs].sort((a, b) => order(a.mergedAt, b.mergedAt) || a.number - b.number || order(a.id, b.id));
    const inventory = [];
    const queue = [];
    for (const pr of sorted) {
        const sourceItems = sources.sources.filter((s) => s.prId === pr.id).sort((a, b) => order(a.id, b.id));
        const sourceHash = sourceFingerprint(sourceItems);
        const previous = lock?.entries.find((entry) => entry.prId === pr.id) ?? null;
        const reasons = previous ? pendingReasons(previous, {sourceFingerprint: sourceHash, contextFingerprint: context.fingerprint, rules: RULES}) : ["new"];
        if (sources.read.completeness !== "complete" && !reasons.includes("incomplete_sources")) { reasons.push("incomplete_sources"); }
        const item = {prId: pr.id, number: pr.number, mergedAt: pr.mergedAt, sourceFingerprint: sourceHash, sourceIds: sourceItems.map((s) => s.id), reasons};
        inventory.push({...item, status: reasons.length ? "pending" : "complete"});
        if (reasons.length && (!prs || prs.includes(pr.number))) {
            let oldContext = null;
            const oldPath = previous ? path.join(cacheRoot, "gh-review-learn", "contexts", `${previous.contextFingerprint}.json`) : null;
            if (oldPath && fs.existsSync(oldPath)) { oldContext = JSON.parse(fs.readFileSync(oldPath, "utf8")); }
            queue.push({...item, previous: previous ? structuredClone(previous) : null, contextChanges: changes(oldContext, context), materials: [...history(git, pr, sourceItems), ...previousDocuments(root, previous)]});
        }
    }
    const output = {schemaVersion: 1, kind: "prepared", repository: sources.repository, rules: {...RULES}, projectSha, expectedLockHash: lockBytes === null ? null : bytesHash(lockBytes), context, items: queue, totalPending: inventory.filter((i) => i.status === "pending").length, inventory, remaining: inventory.filter((i) => i.status === "pending" && !queue.some((q) => q.prId === i.prId)), sourceRead: sources.read, documentationDiscovery: {path: "AGENTS.md", instruction: "Read consumer docs_map and source-of-truth documents before proposing destinations; runtime is not inspected"}};
    validatePrepared(output, sources);
    atomicJson(path.join(cacheRoot, "gh-review-learn", "contexts", `${context.fingerprint}.json`), context);
    return output;
}
export async function main(argv = process.argv.slice(2), {cwd = process.cwd()} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
        return {code: 0, stdout: "Usage: prepare.mjs --sources cache/sources.json [--lock review-learning.lock.json] [--prs 1,2] --output cache/prepared.json\nExplicit reads: --sources path --read-source ID [--start N --end N], or --read-file path --sha SHA [--start N --end N]. Ranges are UTF-16, end exclusive.\n"};
    }
    try {
        const args = {};
        for (let index = 0; index < argv.length; index += 2) {
            const key = argv[index];
            if (!["--sources", "--lock", "--prs", "--output", "--read-source", "--read-file", "--sha", "--start", "--end"].includes(key) || !argv[index + 1] || argv[index + 1].startsWith("--") || Object.hasOwn(args, key)) { throw fail("INVALID_ARGUMENT", `Invalid argument: ${key}`); }
            args[key] = argv[index + 1];
        }
        const root = requireRepositoryRoot(cwd);
        let start;
        if (Object.hasOwn(args, "--start")) { start = Number(args["--start"]); }
        let end;
        if (Object.hasOwn(args, "--end")) { end = Number(args["--end"]); }
        if (args["--read-file"]) {
            if (!args["--sha"]) { throw fail("INVALID_ARGUMENT", "--read-file requires --sha"); }
            return {code: 0, stdout: `${JSON.stringify({status: "complete", data: readGitFile(createGitReader(root), args["--sha"], args["--read-file"], start, end), errors: []})}\n`};
        }
        if (!args["--sources"]) { throw fail("INVALID_ARGUMENT", "--sources is required"); }
        const sources = JSON.parse(fs.readFileSync(assertArtifactPath(path.resolve(root, args["--sources"]), "Sources", root), "utf8"));
        if (args["--read-source"]) { return {code: 0, stdout: `${JSON.stringify({status: "complete", data: readSource(sources, args["--read-source"], start, end), errors: []})}\n`}; }
        if (!args["--output"] || (args["--prs"] && !/^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(args["--prs"]))) { throw fail("INVALID_ARGUMENT", "--output required; --prs must contain positive PR numbers"); }
        const outputPath = assertArtifactPath(path.resolve(root, args["--output"]), "Output", root);
        const lockPath = path.resolve(root, args["--lock"] ?? "review-learning.lock.json");
        if (lockPath !== path.join(root, "review-learning.lock.json")) { throw fail("INVALID_PATH", "Lock must be consumer review-learning.lock.json"); }
        const lockBytes = fs.existsSync(lockPath) ? fs.readFileSync(lockPath) : null;
        const output = prepare({sources, lock: lockBytes ? JSON.parse(lockBytes) : null, lockBytes, cwd: root, cacheRoot: resolveArtifactCacheRoot(root), prs: args["--prs"]?.split(",").map(Number)});
        atomicJson(outputPath, output);
        const gaps = output.items.flatMap((item) => item.materials.filter((m) => m.status === "missing").map((m) => ({code: "MISSING_MATERIAL", scope: `${item.prId}:${m.id}`, message: m.reason}))).concat(sources.read.gaps);
        return {code: gaps.length ? 2 : 0, stdout: `${JSON.stringify({status: gaps.length ? "partial" : "complete", data: {output: outputPath, selected: output.items.length, totalPending: output.totalPending, remaining: output.remaining.length}, errors: gaps})}\n`};
    } catch (error) { return {code: 1, stdout: `${JSON.stringify({status: "error", data: null, errors: [{code: error.code ?? "PREPARE_ERROR", scope: "prepare", message: error.message}]})}\n`, stderr: `${error.message}\n`}; }
}
if (isMainModule(import.meta.url)) {
    const result = await main(); process.stdout.write(result.stdout);
    if (result.stderr) { process.stderr.write(result.stderr); }
    process.exitCode = result.code;
}
