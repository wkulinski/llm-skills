import {describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";
import {collect, revalidateSources, createGhTransport, main} from "../../../.agents/skills/gh-review-learn/scripts/collect.mjs";
import {RULES, fingerprint, sourceFingerprint, validateSources} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";

const sha = "a".repeat(40);
const time = "2026-11-19T00:00:00Z";
const user = {node_id: "U1", login: "reviewer"};
const gqlAuthor = {id: "U1", login: "reviewer"};
function pr(number = 1, extra = {}) {
    return {number, node_id: `PR${number}`, body: "Description", html_url: `https://example.test/pr/${number}`, user, created_at: time, updated_at: time, merged_at: "2026-11-18T00:00:00Z", base: {ref: "main", sha}, head: {sha}, merge_commit_sha: sha, ...extra};
}
function connection(nodes, next = false, cursor = null) {
    return {nodes, pageInfo: {hasNextPage: next, endCursor: cursor}};
}
function fixture() {
    const state = {calls: [], comment: "Old comment", deleted: false, fail: null, partial: false, repeatedCursor: false, checkpointed: 0};
    const review = {node_id: "R1", body: "Three observations", html_url: "https://example.test/review/1", user, submitted_at: time, state: "DISMISSED", commit_id: sha};
    const location = {path: "src/a.mjs", line: 1, diffSide: "RIGHT", startLine: null, startDiffSide: null, originalLine: 1, originalStartLine: null};
    const comment = (id, reply = null) => ({id, body: state.comment, url: `https://example.test/comment/${id}`, author: gqlAuthor, createdAt: time, updatedAt: time, replyTo: reply ? {id: reply} : null, pullRequestReview: {id: "R1"}, path: "src/a.mjs", line: 1, originalLine: 1, originalStartLine: null, diffHunk: "@@ -1 +1 @@", commit: {oid: sha}, originalCommit: {oid: sha}});
    const transport = async (request) => {
        state.calls.push(structuredClone(request));
        if (state.fail?.(request)) { throw Object.assign(new Error("HTTP 403 rate limit; retry-after: 60"), {code: "HTTP_403"}); }
        if (request.type === "rest") {
            const url = request.endpoint;
            let body;
            let next = false;
            if (url === "repos/example/project") { body = {node_id: "REPO1", full_name: "example/project", default_branch: "main"}; }
            else if (url.includes("/branches/")) { body = {commit: {sha}}; }
            else if (url.includes("/pulls?")) {
                if (url.endsWith("page=1")) { body = [pr(), pr(2, {merged_at: null})]; next = true; }
                else { body = [pr(3, {base: {ref: "other", sha}}), pr(4, {merged_at: "2030-01-01T00:00:00Z"}), pr(5)]; }
            } else if (url.includes("/reviews?")) { body = url.includes("/1/") ? [review] : []; }
            else if (url.includes("/issues/1/comments")) {
                if (url.endsWith("page=1")) {
                    body = state.deleted ? [] : [{node_id: "IC1", body: state.comment, user, html_url: "https://example.test/issue-comment", created_at: time, updated_at: time}];
                    next = !state.deleted;
                } else { body = [{node_id: "IC2", body: "Second page", user, html_url: "https://example.test/issue-comment2", created_at: time, updated_at: time}]; }
            } else if (url.includes("/issues/5/comments")) { body = []; }
            else { throw new Error(`Unexpected REST ${url}`); }
            return {body, headers: next ? {link: '<https://api.github.com/next>; rel="next"'} : {}};
        }
        const {id, cursor} = request.variables;
        if (request.query.includes("PullRequestReview{id")) { return {body: {data: {node: {id, createdAt: time, updatedAt: time}}}, headers: {}}; }
        if (request.query.includes("reviewThreads")) {
            const threads = id === "PR1" ? connection([{id: cursor ? "T2" : "T1", isResolved: false, isOutdated: true, ...location}], !cursor, "threads-next") : connection([]);
            return {body: {data: {node: {reviewThreads: threads}}}, headers: {}};
        }
        if (id === "T1") {
            const comments = cursor ? connection([comment("C2", "C1")]) : connection([comment("C1")], true, "comments-next");
            if (state.repeatedCursor && cursor) { comments.pageInfo = {hasNextPage: true, endCursor: cursor}; }
            return {body: {data: {node: {comments}}, ...(state.partial ? {errors: [{message: "Partial nested data"}]} : {})}, headers: {}};
        }
        if (id === "T2") { return {body: {data: {node: {comments: connection([])}}}, headers: {}}; }
        throw new Error(`Unexpected GraphQL ${JSON.stringify(request.variables)}`);
    };
    const options = {transport, repo: "example/project", now: () => time};
    return {state, transport, options};
}
function lockFor(sources) {
    return {schemaVersion: 1, kind: "lock", repository: sources.repository, rules: RULES, entries: sources.prs.map((p) => ({prId: p.id, rules: RULES, sourceFingerprint: sourceFingerprint(sources.sources.filter((s) => s.prId === p.id)), projectSha: sha, contextFingerprint: fingerprint("context"), sourceCompleteness: "complete", analysis: "complete", delivery: "not_required", assessments: [], dispositions: [], documents: [], sourceIds: []}))};
}

describe("complete GitHub source collection", () => {
    it("lists complete eligible history without fetching any PR discussion", async () => {
        const {state, options} = fixture();
        const {sources: inventory} = await collect({...options, inventoryOnly: true});
        expect(inventory.kind).toBe("inventory");
        expect(inventory.read.completeness).toBe("complete");
        expect(inventory.prs.map((item) => item.number)).toEqual([1, 5]);
        expect(inventory.sources).toEqual([]);
        expect(state.calls.every((request) => request.type === "rest" && !/\/(reviews|comments)/.test(request.endpoint))).toBe(true);
        await expect(collect({...options, inventoryOnly: true, prs: [1]})).rejects.toMatchObject({code: "INVALID_BATCH"});
    });
    it("reads every REST page and each nested GraphQL connection with explicit ends", async () => {
        const {options} = fixture();
        const {sources} = await collect(options);
        expect(sources.read.completeness).toBe("complete");
        expect(() => validateSources(sources)).not.toThrow();
        expect(sources.prs.map((p) => p.number)).toEqual([1, 5]);
        expect(sources.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["PR1", "PR5", "R1", "IC1", "IC2", "T1", "T2", "C1", "C2"]));
        expect(sources.sources.find((s) => s.id === "R1").reviewState).toBe("DISMISSED");
        expect(sources.sources.find((s) => s.id === "C2").replyToId).toBe("C1");
        for (const scope of ["pulls", "PR:1:reviews", "PR:1:comments", "PR:1:threads", "thread:T1:comments", "thread:T2:comments"]) {
            expect(sources.coverage.some((c) => c.scope === scope && c.complete)).toBe(true);
        }
    });
    it("detects edits and deletions of old discussions with unchanged merge date", async () => {
        const {state, options} = fixture();
        const first = (await collect(options)).sources;
        const lock = lockFor(first);
        expect((await collect({...options, lock})).sources.changes[0].status).toBe("unchanged");
        state.comment = "Edited old comment";
        expect((await collect({...options, lock})).sources.changes[0].status).toBe("changed");
        state.comment = "Old comment"; state.deleted = true;
        const deleted = (await collect({...options, lock})).sources;
        expect(deleted.changes[0].status).toBe("changed");
        expect(deleted.sources.some((s) => s.id === "IC1")).toBe(false);
    });
    it("preserves earlier pages on failure and resumes with a fresh confirmation", async () => {
        const {state, options} = fixture();
        state.fail = (request) => request.endpoint?.includes("issues/1/comments") && request.endpoint.endsWith("page=2");
        let checkpoint;
        const failed = await collect({...options, onCheckpoint: async (c) => { checkpoint = structuredClone(c); }});
        expect(failed.sources.read.completeness).toBe("partial");
        expect(failed.sources.sources.some((s) => s.id === "IC1")).toBe(true);
        expect(failed.sources.read.gaps).toContainEqual(expect.objectContaining({code: "HTTP_403", scope: "PR:1:comments:page:2"}));
        const cachedPage = Object.values(checkpoint.responses).find((r) => r.scope === "PR:1:comments:page:1");
        expect(cachedPage.hash).toBe(fingerprint(cachedPage.response));
        state.fail = null; state.comment = "Changed while interrupted"; state.calls = [];
        const resumed = await collect({...options, resume: checkpoint});
        expect(resumed.sources.read.completeness).toBe("complete");
        expect(resumed.sources.sources.find((s) => s.id === "IC1").body).toBe("Changed while interrupted");
        expect(state.calls.some((r) => r.endpoint?.includes("issues/1/comments") && r.endpoint.endsWith("page=1"))).toBe(true);
        expect(resumed.recovery).not.toBeNull();
    });
    it("reports partial GraphQL and repeated cursors without accepting incomplete data", async () => {
        const {state, options} = fixture();
        state.partial = true;
        const partial = (await collect(options)).sources;
        expect(partial.read.completeness).toBe("partial");
        expect(partial.sources.some((s) => s.id === "C1")).toBe(true);
        expect(partial.read.gaps.some((g) => g.code === "GRAPHQL_ERRORS")).toBe(true);
        state.partial = false; state.repeatedCursor = true;
        const repeated = (await collect(options)).sources;
        expect(repeated.read.gaps.some((g) => g.code === "TRUNCATED_PAGE")).toBe(true);
    });
    it("does not infer removals from partial reads or mutate the lock", async () => {
        const {state, options} = fixture();
        const lock = lockFor((await collect(options)).sources);
        const before = JSON.stringify(lock);
        state.fail = (request) => request.endpoint?.includes("/comments");
        const {sources} = await collect({...options, lock});
        expect(sources.changes.every((c) => c.status === "unknown_partial")).toBe(true);
        expect(JSON.stringify(lock)).toBe(before);
    });
    it("rejects changed sources at acceptance and requires a complete reread", async () => {
        const {state, options} = fixture();
        const before = (await collect(options)).sources;
        await expect(revalidateSources(before, options)).resolves.toMatchObject({read: {completeness: "complete"}});
        state.comment = "Changed during analysis";
        await expect(revalidateSources(before, options)).rejects.toMatchObject({code: "SOURCE_CONFLICT"});
        state.fail = (r) => r.type === "graphql";
        await expect(revalidateSources(before, options)).rejects.toMatchObject({code: "INCOMPLETE_READ"});
    });
    it("binds resume to selection and reports missing requested PRs", async () => {
        const {options} = fixture();
        const result = await collect(options);
        await expect(collect({...options, branch: "other", resume: result.checkpoint})).rejects.toMatchObject({code: "RESUME_CONFLICT"});
        const {sources} = await collect({...options, prs: [99]});
        expect(sources.read.completeness).toBe("partial");
        expect(sources.read.gaps[0].code).toBe("PR_NOT_IN_SCOPE");
    });
    it("passes structured subprocess arguments, includes headers and feeds GraphQL through stdin", async () => {
        const calls = [];
        const transport = createGhTransport({cwd: process.cwd(), run: (command, args, options) => {
            calls.push({command, args, options});
            if (args.includes("resolve-gh")) { return "/safe/gh\n"; }
            if (args.includes("graphql")) { return '{"data":{"node":null}}'; }
            return 'HTTP/2.0 200 OK\r\nContent-Type: application/json\r\nLink: <next>; rel="next"\r\n\r\n[]';
        }});
        expect((await transport({type: "rest", endpoint: "repos/example/project/pulls?state=closed"})).headers.link).toContain("next");
        await transport({type: "graphql", query: "query($id:ID!){node(id:$id){id}}", variables: {id: "$(never-run)"}});
        expect(calls[2].options.shell).toBe(false);
        expect(JSON.parse(calls[2].options.input).variables.id).toBe("$(never-run)");
        expect(calls[0].args[1]).toContain("resolve_tool_cmd gh");
        expect(calls[2].args[1]).toBe('source "$1" || exit $?; ensure_repo_env_loaded || exit $?; shift; exec "$@"');
    });
    it("keeps partial GraphQL stdout on gh exit 1 and reports REST error details", async () => {
        const transport = createGhTransport({run: (command, args) => {
            if (args.includes("resolve-gh")) { return "gh\n"; }
            throw Object.assign(new Error("Process failed"), {stdout: '{"data":{"node":null},"errors":[{"message":"limit"}]}', stderr: "HTTP 403; retry-after: 60"});
        }});
        expect((await transport({type: "graphql", query: "query{x}", variables: {}})).body.errors[0].message).toBe("limit");
        await expect(transport({type: "rest", endpoint: "repos/a/b"})).rejects.toThrow("HTTP 403; retry-after: 60");
    });
    it("supports help outside a repository and rejects invalid CLI arguments before transport", async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-help-"));
        try {
            const cli = path.resolve(".agents/skills/gh-review-learn/scripts/collect.mjs");
            expect(execFileSync(process.execPath, [cli, "--help"], {cwd: dir, encoding: "utf8"})).toContain("Usage:");
            expect((await main(["--unknown"])).code).toBe(1);
            expect((await main(["--prs", "1,x", "--output", "ignored"])).code).toBe(1);
        } finally { fs.rmSync(dir, {recursive: true, force: true}); }
    });
});
