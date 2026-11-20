#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {randomUUID} from "node:crypto";
import {execFileSync} from "../../_shared/scripts/file-process.mjs";
import {resolveRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {assertArtifactPath} from "../../_shared/scripts/artifact-path.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {RULES, SOURCE_FIELDS, assertRepository, fingerprint, sourceFingerprint, validateSources, validateLock, validateInventory, assertBatchSources} from "./contracts.mjs";

const PAGE_INFO = "pageInfo{hasNextPage endCursor}";
const AUTHOR = "author{login ... on Node{id}}";
const THREAD_FIELDS = "id isResolved isOutdated path line diffSide startLine startDiffSide originalLine originalStartLine";
const COMMENT_FIELDS = `id body url createdAt updatedAt ${AUTHOR} replyTo{id} pullRequestReview{id} path line diffHunk originalLine originalStartLine commit{oid} originalCommit{oid}`;
const fail = (code, message) => Object.assign(new Error(message), {code});

function normalized(kind, prId, fields) {
    return {...Object.fromEntries(SOURCE_FIELDS.map((key) => [key, null])), kind, prId, ...fields};
}
function restAuthor(user) { return user ? {id: user.node_id, login: user.login} : null; }
function restText(value) {
    return {id: value.node_id, body: value.body ?? "", url: value.html_url, author: restAuthor(value.user), createdAt: value.created_at, updatedAt: value.updated_at ?? null};
}
function assertResponse(condition, message) {
    if (!condition) { throw fail("INVALID_RESPONSE", message); }
}
function writeCheckpoint(file, value) {
    fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700});
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, {mode: 0o600, flag: "wx"});
        fs.renameSync(temporary, file);
    } finally { fs.rmSync(temporary, {force: true}); }
}

function partialGraphql(error) {
    try {
        const partial = JSON.parse(String(error.stdout));
        return partial.errors?.length ? {body: partial, headers: {}} : null;
    } catch { return null; }
}

/** Transport receives structured REST/GraphQL requests, never shell text. */
export function createGhTransport({cwd = process.cwd(), run = execFileSync} = {}) {
    const root = resolveRepositoryRoot(cwd);
    const helper = fileURLToPath(new URL("../../_shared/scripts/env-load.sh", import.meta.url));
    const gh = run("bash", ["-c", 'source "$1"; resolve_tool_cmd gh', "resolve-gh", helper], {cwd: root, encoding: "utf8"}).trim();
    if (!gh || gh.includes("\n")) { throw fail("TOOL_RESOLUTION_FAILED", "Unable to resolve gh"); }
    return async (request) => {
        const args = request.type === "rest"
            ? ["api", "--method", "GET", "--include", request.endpoint]
            : ["api", "graphql", "--input", "-"];
        let output;
        try {
            // Load B's exported environment in the child too, including GH_TOKEN.
            // Every dynamic value is a positional argument to this fixed wrapper.
            output = run("bash", ["-c", 'source "$1" || exit $?; ensure_repo_env_loaded || exit $?; shift; exec "$@"', "gh-env", helper, gh, ...args],
                {cwd: root, encoding: "utf8", shell: false, maxBuffer: 32 * 1024 * 1024,
                    ...(request.type === "graphql" ? {input: JSON.stringify({query: request.query, variables: request.variables})} : {})});
        } catch (error) {
            // gh exits nonzero for GraphQL errors, even when partial data exists.
            const partial = request.type === "graphql" ? partialGraphql(error) : null;
            if (partial) { return partial; }
            throw fail("GH_API_ERROR", String(error.stderr || error.message).trim());
        }
        if (request.type === "graphql") { return {body: JSON.parse(output), headers: {}}; }
        const match = output.match(/^HTTP\/[^\n]+\r?\n([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
        assertResponse(match, "Missing HTTP headers");
        const headers = Object.fromEntries(match[1].split(/\r?\n/).map((line) => {
            const colon = line.indexOf(":");
            return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
        }));
        return {body: JSON.parse(match[2]), headers};
    };
}

/** A fresh traversal. Successful responses are checkpointed after each request. */
async function traverse({transport, repo, branch, prs, boundary, now, checkpoint, onCheckpoint, reuse = false, inventoryOnly = false}) {
    const startedAt = now();
    const gaps = [];
    const coverage = [];
    const responses = checkpoint.responses;
    async function request(spec, scope, required = false) {
        const key = fingerprint(spec);
        try {
            let response;
            if (reuse && responses[key]) {
                const cached = responses[key];
                assertResponse(fingerprint(cached.response) === cached.hash, "Corrupt response checkpoint");
                response = cached.response;
            } else {
                response = await transport(spec);
                assertResponse(response && Object.hasOwn(response, "body"), "Missing response body");
                // Preserve partial GraphQL data, but never reuse it as a successful response.
                if (!response.body?.errors?.length) {
                    Object.assign(responses, {[key]: {request: spec, response, hash: fingerprint(response), scope}});
                    await onCheckpoint(checkpoint);
                }
            }
            if (response.body?.errors?.length) {
                gaps.push({code: "GRAPHQL_ERRORS", scope, message: JSON.stringify(response.body.errors)});
            }
            return response;
        } catch (error) {
            if (required) { throw error; }
            gaps.push({code: error.code ?? "API_ERROR", scope, message: error.message});
            return null;
        }
    }
    async function restList(endpoint, scope) {
        const items = [];
        let page = 1;
        while (true) {
            const response = await request({type: "rest", endpoint: `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`}, `${scope}:page:${page}`);
            if (!response) { break; }
            if (!Array.isArray(response.body)) {
                gaps.push({code: "INVALID_RESPONSE", scope, message: "Expected REST array"}); break;
            }
            items.push(...response.body);
            const next = /<[^>]+>;\s*rel="next"/.test(response.headers?.link ?? "");
            coverage.push({scope, page, count: response.body.length, complete: !next});
            if (!next) { break; }
            if (response.body.length === 0) {
                gaps.push({code: "TRUNCATED_PAGE", scope, message: "Empty page with next link"}); break;
            }
            page += 1;
        }
        return items;
    }
    async function connection(query, variables, select, scope) {
        const items = [];
        let cursor = null;
        const seen = new Set();
        while (true) {
            const response = await request({type: "graphql", query, variables: {...variables, cursor}}, `${scope}:cursor:${cursor ?? "first"}`);
            if (!response) { break; }
            const value = select(response.body.data);
            if (!value || !Array.isArray(value.nodes) || typeof value.pageInfo?.hasNextPage !== "boolean") {
                gaps.push({code: "TRUNCATED_PAGE", scope, message: "Missing GraphQL connection or pageInfo"}); break;
            }
            items.push(...value.nodes.filter(Boolean));
            if (value.nodes.some((node) => node === null)) {
                gaps.push({code: "NULL_NODE", scope, message: "Null GraphQL node"});
            }
            coverage.push({scope, cursor, count: value.nodes.length, complete: !value.pageInfo.hasNextPage && !response.body.errors?.length});
            if (!value.pageInfo.hasNextPage) { break; }
            const next = value.pageInfo.endCursor;
            if (typeof next !== "string" || !next || seen.has(next)) {
                gaps.push({code: "TRUNCATED_PAGE", scope, message: "Missing or repeated cursor"}); break;
            }
            seen.add(next); cursor = next;
        }
        return items;
    }
    const metadata = (await request({type: "rest", endpoint: `repos/${repo}`}, "repository", true)).body;
    assertResponse(typeof metadata.node_id === "string" && typeof metadata.full_name === "string", "Missing repository identity");
    const selectedBranch = branch ?? metadata.default_branch;
    assertResponse(typeof selectedBranch === "string" && selectedBranch.length > 0, "Missing default branch");
    const repository = {id: metadata.node_id, name: metadata.full_name, branch: selectedBranch};
    if (checkpoint.repository) { assertRepository(repository, checkpoint.repository); }
    checkpoint.repository = repository;
    const branchResponse = await request({type: "rest", endpoint: `repos/${repo}/branches/${encodeURIComponent(selectedBranch)}`}, "branch", true);
    const targetSha = branchResponse.body.commit?.sha;
    assertResponse(typeof targetSha === "string", "Missing branch SHA");
    const closed = await restList(`repos/${repo}/pulls?state=closed&sort=created&direction=asc`, "pulls");
    const selected = closed.filter((pr) => pr.merged_at && Date.parse(pr.merged_at) <= Date.parse(boundary) && pr.base?.ref === selectedBranch && (!prs || prs.includes(pr.number)));
    if (prs) {
        for (const number of prs) {
            if (!selected.some((pr) => pr.number === number)) {
                gaps.push({code: "PR_NOT_IN_SCOPE", scope: `PR:${number}`, message: "Requested PR absent, unmerged, outside branch or after boundary"});
            }
        }
    }
    const output = {schemaVersion: 1, kind: inventoryOnly ? "inventory" : "sources", repository, rules: {...RULES}, read: {startedAt, finishedAt: null, boundary, targetSha, completeness: "partial", gaps}, prs: [], sources: []};
    for (const pr of selected) {
        output.prs.push({id: pr.node_id, number: pr.number, mergedAt: pr.merged_at, baseSha: pr.base.sha, headSha: pr.head.sha, mergeSha: pr.merge_commit_sha});
        if (inventoryOnly) { continue; }
        output.sources.push(normalized("issue_comment", pr.node_id, restText(pr)));
        const reviews = await restList(`repos/${repo}/pulls/${pr.number}/reviews`, `PR:${pr.number}:reviews`);
        for (const review of reviews) {
            const response = await request({type: "graphql", query: "query($id:ID!){node(id:$id){... on PullRequestReview{id createdAt updatedAt}}}", variables: {id: review.node_id}}, `review:${review.node_id}:metadata`);
            const meta = response?.body.data?.node;
            if (!meta?.createdAt || !meta?.updatedAt) {
                gaps.push({code: "MISSING_REVIEW_METADATA", scope: review.node_id, message: "Review edit metadata unavailable"});
            }
            output.sources.push(normalized("review", pr.node_id, {...restText(review), createdAt: meta?.createdAt ?? review.submitted_at ?? pr.created_at, updatedAt: meta?.updatedAt ?? null, reviewState: review.state, commitSha: review.commit_id}));
        }
        const comments = await restList(`repos/${repo}/issues/${pr.number}/comments`, `PR:${pr.number}:comments`);
        output.sources.push(...comments.map((comment) => normalized("issue_comment", pr.node_id, restText(comment))));
        const threads = await connection(`query($id:ID!,$cursor:String){node(id:$id){... on PullRequest{reviewThreads(first:100,after:$cursor){nodes{${THREAD_FIELDS}} ${PAGE_INFO}}}}}`, {id: pr.node_id}, (data) => data?.node?.reviewThreads, `PR:${pr.number}:threads`);
        for (const thread of threads) {
            const location = {path: thread.path, line: thread.line, side: thread.diffSide, startLine: thread.startLine, startSide: thread.startDiffSide, originalLine: thread.originalLine, originalStartLine: thread.originalStartLine, threadResolved: thread.isResolved, threadOutdated: thread.isOutdated};
            output.sources.push(normalized("thread", pr.node_id, {id: thread.id, body: "", url: pr.html_url, createdAt: pr.created_at, ...location}));
            const replies = await connection(`query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{${COMMENT_FIELDS}} ${PAGE_INFO}}}}}`, {id: thread.id}, (data) => data?.node?.comments, `thread:${thread.id}:comments`);
            for (const comment of replies) {
                const review = reviews.find((item) => item.node_id === comment.pullRequestReview?.id);
                output.sources.push(normalized("review_comment", pr.node_id, {...location, id: comment.id, body: comment.body, url: comment.url, author: comment.author, createdAt: comment.createdAt, updatedAt: comment.updatedAt, replyToId: comment.replyTo?.id ?? null, reviewId: comment.pullRequestReview?.id ?? null, threadId: thread.id, reviewState: review?.state ?? null, path: comment.path, line: comment.line, originalLine: comment.originalLine, originalStartLine: comment.originalStartLine, diffHunk: comment.diffHunk, commitSha: comment.commit?.oid ?? null, originalCommitSha: comment.originalCommit?.oid ?? null}));
            }
        }
    }
    // Validation names dangling references and duplicates even on partial reads.
    output.read.finishedAt = now();
    output.read.completeness = gaps.length ? "partial" : "complete";
    try { (inventoryOnly ? validateInventory : validateSources)(output); } catch (error) {
        gaps.push({code: error.code ?? "INVALID_SOURCES", scope: "normalized-sources", message: error.message});
        output.read.completeness = "partial";
    }
    return {...output, coverage};
}

export function compareSources(sources, lock) {
    if (!lock) { return sources.prs.map((pr) => ({prId: pr.id, status: sources.read.completeness === "complete" ? "new" : "unknown_partial"})); }
    validateLock(lock, sources.repository);
    return sources.prs.map((pr) => {
        const previous = lock.entries.find((entry) => entry.prId === pr.id);
        // Never infer removals from an incomplete read.
        if (sources.read.completeness !== "complete") { return {prId: pr.id, status: "unknown_partial"}; }
        return {prId: pr.id, status: !previous ? "new" : previous.sourceFingerprint === sourceFingerprint(sources.sources.filter((item) => item.prId === pr.id)) ? "unchanged" : "changed"};
    });
}

export async function collect({transport, repo, branch, prs, lock, resume, inventoryOnly = false, batchId, boundary, onCheckpoint = async () => null, now = () => new Date().toISOString()}) {
    assertResponse(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo), "Expected owner/repo");
    if (lock) { validateLock(lock); }
    const batch = lock?.activeBatch;
    let selectedPrs = prs; let selectedBranch = branch; let readBoundary = boundary;
    if (!inventoryOnly && batch && !batchId) {
        if (!prs?.length || repo !== batch.repository.name || (branch && branch !== batch.repository.branch)) { throw fail("BATCH_CONFLICT", "Resume the active batch, or explicitly select stored PRs for reassessment or delivery"); }
        selectedBranch = batch.repository.branch;
    } else if (!inventoryOnly && batch) {
        if (batchId !== batch.id || repo !== batch.repository.name || (branch && branch !== batch.repository.branch)) { throw fail("BATCH_CONFLICT", "Resume the active batch before reading another scope"); }
        const pending = batch.members.filter((pr) => !batch.recordedPrIds.includes(pr.id));
        if (prs && prs.some((number) => !pending.some((pr) => pr.number === number))) { throw fail("BATCH_CONFLICT", "PR selection is outside the unfinished batch"); }
        selectedPrs = prs ?? pending.map((pr) => pr.number); selectedBranch = batch.repository.branch; readBoundary = batch.boundary;
    } else if (batchId) { throw fail("BATCH_CONFLICT", "No matching active batch"); }
    if (inventoryOnly && prs) { throw fail("INVALID_BATCH", "An inventory must list the full eligible history"); }
    const selection = {repo, branch: selectedBranch ?? null, prs: selectedPrs ? [...new Set(selectedPrs)].sort((a, b) => a - b) : null,
        ...(inventoryOnly ? {inventoryOnly: true} : {}), ...(batchId ? {batchId} : {})};
    if (resume && (resume.version !== 1 || fingerprint(resume.selection) !== fingerprint(selection))) {
        throw fail("RESUME_CONFLICT", "Resume selection differs or checkpoint schema unsupported");
    }
    const checkpoint = resume ? structuredClone(resume) : {version: 1, selection, boundary: readBoundary ?? now(), responses: {}};
    if (batchId && checkpoint.boundary !== batch.boundary) { throw fail("BATCH_CONFLICT", "Checkpoint boundary differs from active batch"); }
    const options = {transport, repo, branch: selectedBranch, prs: selection.prs, boundary: checkpoint.boundary, now, checkpoint, onCheckpoint, inventoryOnly};
    let recovery = null;
    if (resume) {
        recovery = await traverse({...options, reuse: true});
        // A resumed mixed-age traversal is never accepted as fresh evidence.
    }
    const sources = await traverse(options);
    if (batchId) {
        sources.batchId = batchId;
    }
    if (!inventoryOnly) { assertBatchSources(batch, sources, lock?.entries); }
    sources.changes = inventoryOnly ? [] : compareSources(sources, lock);
    checkpoint.lastRead = sources.read;
    await onCheckpoint(checkpoint);
    return {sources, checkpoint, recovery};
}

/** Used by WP4: always fetch the batch again; neither cache nor PR updated_at substitutes for this. */
export async function revalidateSources(previous, options) {
    if (previous.read.completeness !== "complete") { throw fail("INCOMPLETE_READ", "Cannot accept a partial source batch"); }
    const {sources} = await collect({...options, repo: previous.repository.name, branch: previous.repository.branch, prs: previous.prs.map((pr) => pr.number), boundary: previous.read.boundary, resume: null});
    if (previous.batchId) { sources.batchId = previous.batchId; }
    assertRepository(sources.repository, previous.repository);
    if (sources.read.completeness !== "complete") { throw fail("INCOMPLETE_READ", "Fresh source read is incomplete"); }
    if (fingerprint(sources.prs.map((pr) => pr.id).sort()) !== fingerprint(previous.prs.map((pr) => pr.id).sort()) || sourceFingerprint(sources.sources) !== sourceFingerprint(previous.sources)) {
        throw fail("SOURCE_CONFLICT", "Sources changed during analysis");
    }
    return sources;
}

export async function main(argv = process.argv.slice(2), {cwd = process.cwd(), transport} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
        return {code: 0, stdout: "Usage: collect.mjs [--repo owner/name] [--branch name] [--inventory-only | --batch ID | --prs 1,2] [--resume checkpoint.json] --output cache/sources.json\nInventory lists all eligible merged PRs without discussions; --batch resumes stored membership. Default reads full discussions. Writes only consumer cache.\n"};
    }
    try {
        const args = {};
        for (let index = 0; index < argv.length; index += 1) {
            const name = argv[index];
            if (name === "--inventory-only" && !args[name]) { args[name] = true; continue; }
            if (!["--repo", "--branch", "--prs", "--resume", "--output", "--batch"].includes(name) || !argv[index + 1] || argv[index + 1].startsWith("--") || Object.hasOwn(args, name)) {
                throw fail("INVALID_ARGUMENT", `Invalid or duplicate argument: ${name}`);
            }
            args[name] = argv[++index];
        }
        if (!args["--output"]) { throw fail("INVALID_ARGUMENT", "--output is required"); }
        if (args["--prs"] && !/^[1-9][0-9]*(,[1-9][0-9]*)*$/.test(args["--prs"])) { throw fail("INVALID_ARGUMENT", "--prs requires comma-separated positive PR numbers"); }
        const root = resolveRepositoryRoot(cwd);
        const output = assertArtifactPath(path.resolve(root, args["--output"]), "Output", root);
        const checkpointPath = assertArtifactPath(`${output}.checkpoint.json`, "Checkpoint", root);
        const gh = transport ?? createGhTransport({cwd: root});
        const repo = args["--repo"] ?? (await gh({type: "rest", endpoint: "repos/{owner}/{repo}"})).body.full_name;
        const resume = args["--resume"] ? JSON.parse(fs.readFileSync(assertArtifactPath(path.resolve(root, args["--resume"]), "Resume", root), "utf8")) : null;
        const lockPath = path.join(root, "review-learning.lock.json");
        const lock = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, "utf8")) : null;
        const {sources} = await collect({transport: gh, repo, branch: args["--branch"], prs: args["--prs"]?.split(",").map(Number), inventoryOnly: Boolean(args["--inventory-only"]), batchId: args["--batch"], lock, resume, onCheckpoint: async (value) => writeCheckpoint(checkpointPath, value)});
        writeCheckpoint(output, sources);
        const complete = sources.read.completeness === "complete";
        return {code: complete ? 0 : 2, stdout: `${JSON.stringify({status: complete ? "complete" : "partial", data: {output, checkpoint: checkpointPath, prs: sources.prs.length, sources: sources.sources.length, read: sources.read}, errors: sources.read.gaps})}\n`};
    } catch (error) {
        return {code: 1, stdout: `${JSON.stringify({status: "error", data: null, errors: [{code: error.code ?? "COLLECT_ERROR", message: error.message, scope: "collect"}]})}\n`, stderr: `${error.message}\n`};
    }
}
if (isMainModule(import.meta.url)) {
    const result = await main();
    process.stdout.write(result.stdout);
    if (result.stderr) { process.stderr.write(result.stderr); }
    process.exitCode = result.code;
}
