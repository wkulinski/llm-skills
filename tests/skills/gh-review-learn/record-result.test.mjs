import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";
import {RULES, SOURCE_FIELDS} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";
import {prepare} from "../../../.agents/skills/gh-review-learn/scripts/prepare.mjs";
import {recordResult, main as recordMain} from "../../../.agents/skills/gh-review-learn/scripts/record-result.mjs";
import {checkResult, hashBytes, main as validateMain} from "../../../.agents/skills/gh-review-learn/scripts/validate-result.mjs";

const directories = [];
afterEach(() => { for (const d of directories.splice(0)) { fs.rmSync(d, {recursive: true, force: true}); } });
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "record-review-")); directories.push(root);
    const git = (args) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
    git(["init", "-b", "main"]); git(["config", "user.name", "Test"]); git(["config", "user.email", "test@example.test"]);
    git(["remote", "add", "origin", "git@github.com:example/project.git"]);
    fs.writeFileSync(path.join(root, "README.md"), "Old rules\n"); fs.writeFileSync(path.join(root, ".gitignore"), "var/\n");
    git(["add", "."]); git(["commit", "-m", "base"]); const base = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(root, "code.mjs"), "fixed\n"); git(["add", "."]); git(["commit", "-m", "merged"]); const sha = git(["rev-parse", "HEAD"]);
    const time = "2026-11-18T00:00:00Z";
    const pr = {number: 1, node_id: "PR1", body: "Reviewable description", html_url: "https://example.test/pr/1", user: null, created_at: time, updated_at: time, merged_at: time, base: {ref: "main", sha: base}, head: {sha}, merge_commit_sha: sha};
    const source = {...Object.fromEntries(SOURCE_FIELDS.map((k) => [k, null])), id: "PR1", kind: "issue_comment", prId: "PR1", body: pr.body, url: pr.html_url, createdAt: time, updatedAt: time};
    const sources = {schemaVersion: 1, kind: "sources", repository: {id: "REPO", name: "example/project", branch: "main"}, rules: RULES, read: {startedAt: time, finishedAt: time, targetSha: sha, completeness: "complete", gaps: []}, prs: [{id: "PR1", number: 1, mergedAt: time, baseSha: base, headSha: sha, mergeSha: sha}], sources: [source]};
    const cacheRoot = path.join(root, "var/agent/cache");
    const prepared = prepare({sources, cwd: root, cacheRoot});
    const entry = {prId: "PR1", rules: RULES, sourceFingerprint: prepared.items[0].sourceFingerprint, projectSha: sha, contextFingerprint: prepared.context.fingerprint, sourceCompleteness: "complete", analysis: "complete", delivery: "not_required", assessments: [], dispositions: [{sourceId: "PR1", status: "no_learning", rationale: "Covered", assessmentIds: []}], documents: [], materialDispositions: prepared.items[0].materials.map((m) => ({id: m.id, status: "used", rationale: "Checked exact object"}))};
    const result = {schemaVersion: 1, kind: "result", repository: sources.repository, rules: RULES, expectedLockHash: null, inputContextFingerprint: prepared.context.fingerprint, entries: [entry]};
    const transport = async (request) => {
        if (request.type === "graphql") { return {body: {data: {node: {reviewThreads: {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}}}, headers: {}}; }
        const endpoint = request.endpoint;
        let body;
        if (endpoint === "repos/example/project") { body = {node_id: "REPO", full_name: "example/project", default_branch: "main"}; }
        else if (endpoint.includes("/branches/")) { body = {commit: {sha}}; }
        else if (endpoint.includes("/pulls?")) { body = [pr]; }
        else { body = []; }
        return {body, headers: {}};
    };
    const options = {sources, prepared, result, cwd: root, cacheRoot, transport};
    return {root, git, sha, options, pr, entry, target: path.join(root, "review-learning.lock.json")};
}
function proposal(f, delivery = "delivery_pending", name = "README.md") {
    f.entry.delivery = delivery;
    const before = f.options.prepared.context.files.find((p) => p.path === name)?.hash ?? null;
    f.entry.documents = [{path: name, beforeHash: before, afterHash: hashBytes("New rules\n")}];
    if (delivery === "applied") { f.entry.finalDocumentsReviewed = true; fs.writeFileSync(path.join(f.root, name), "New rules\n"); }
}

describe("review result recording", () => {
    it("records pending proposals with no document edits and repeats without writes", async () => {
        const f = fixture(); proposal(f);
        expect((await recordResult(f.options)).changed).toBe(true);
        const before = fs.readFileSync(f.target); const time = fs.statSync(f.target).mtimeMs;
        expect(JSON.parse(before).entries[0].delivery).toBe("delivery_pending");
        expect(fs.readFileSync(path.join(f.root, "README.md"), "utf8")).toBe("Old rules\n");
        expect((await recordResult(f.options)).changed).toBe(false);
        expect(fs.readFileSync(f.target)).toEqual(before); expect(fs.statSync(f.target).mtimeMs).toBe(time);
    });
    it("rejects invalid references, missing source/material coverage, repository and stale lock without changing it", async () => {
        const f = fixture(); await recordResult(f.options); const before = fs.readFileSync(f.target);
        const cases = [
            (r) => { r.entries[0].dispositions[0].sourceId = "foreign"; },
            (r) => { r.entries[0].dispositions = []; },
            (r) => { r.entries[0].materialDispositions = []; },
            (r) => { r.repository = {...r.repository, id: "foreign"}; },
            (r) => { r.entries[0].analysis = "pending"; },
        ];
        for (const mutate of cases) {
            const result = structuredClone(f.options.result); mutate(result);
            await expect(recordResult({...f.options, result})).rejects.toThrow();
            expect(fs.readFileSync(f.target)).toEqual(before);
        }
    });
    it("allows one overlapping writer and rejects the other before reading the lock", async () => {
        const f = fixture(); let release; let entered;
        const blocked = new Promise((resolve) => { release = resolve; });
        const entry = new Promise((resolve) => { entered = resolve; });
        let first = true;
        const transport = async (request) => { if (first) { first = false; entered(); await blocked; } return f.options.transport(request); };
        const writer = recordResult({...f.options, transport}); await entry;
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "LOCK_CONFLICT"});
        release(); await writer;
        expect(fs.existsSync(`${f.target}.write-lock`)).toBe(false);
    });
    it("preserves unrelated entries and supports an identical stale-token retry", async () => {
        const f = fixture(); await recordResult(f.options);
        const lock = JSON.parse(fs.readFileSync(f.target)); lock.entries.push({...lock.entries[0], prId: "OTHER"});
        fs.writeFileSync(f.target, JSON.stringify(lock));
        expect((await recordResult(f.options)).changed).toBe(false);
        expect(JSON.parse(fs.readFileSync(f.target)).entries).toHaveLength(2);
        const changed = structuredClone(f.options.result); changed.entries[0].analysis = "pending";
        await expect(recordResult({...f.options, result: changed})).rejects.toMatchObject({code: "LOCK_CONFLICT"});
    });
    it("recovers after document edits, fingerprints final bytes and remains current after commit", async () => {
        const f = fixture(); proposal(f, "applied", "new-doc.md");
        await recordResult(f.options);
        const lockBytes = fs.readFileSync(f.target); const lock = JSON.parse(lockBytes);
        expect(lock.entries[0].contextFingerprint).not.toBe(f.options.prepared.context.fingerprint);
        expect((await recordResult(f.options)).changed).toBe(false);
        f.git(["add", "new-doc.md", "review-learning.lock.json"]); f.git(["commit", "-m", "apply docs and learning"]);
        expect(prepare({sources: f.options.sources, lock, lockBytes, cwd: f.root, cacheRoot: f.options.cacheRoot}).items).toEqual([]);
        const diff = f.git(["show", "--stat", "HEAD"]); expect(diff).toContain("new-doc.md"); expect(diff).toContain("review-learning.lock.json");
    });
    it("rejects undeclared changes, false output hashes and missing final-document review", async () => {
        const f = fixture(); proposal(f, "applied");
        delete f.entry.finalDocumentsReviewed;
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "INVALID_STATE"});
        f.entry.finalDocumentsReviewed = true;
        fs.appendFileSync(path.join(f.root, "code.mjs"), "outside manifest\n");
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "CONTEXT_CONFLICT"});
        fs.writeFileSync(path.join(f.root, "code.mjs"), "fixed\n");
        fs.appendFileSync(path.join(f.root, "README.md"), "wrong bytes\n");
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "DOCUMENT_CONFLICT"});
    });
    it("does not follow symlinks or allow documents outside B", async () => {
        const f = fixture(); proposal(f);
        for (const name of ["../outside", "/tmp/out", ".git/config", "review-learning.lock.json", "var/agent/cache/proposed.md"]) {
            f.entry.documents[0].path = name; await expect(recordResult(f.options)).rejects.toThrow();
        }
        fs.mkdirSync(path.join(f.root, "real")); fs.symlinkSync(path.join(f.root, "real"), path.join(f.root, "link"));
        f.entry.documents[0] = {path: "link/new.md", beforeHash: null, afterHash: hashBytes("new")};
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "INVALID_PATH"});
    });
    it("keeps old bytes after atomic rename failure and releases the exclusive claim", async () => {
        const f = fixture(); await recordResult(f.options); const bytes = fs.readFileSync(f.target);
        const prior = JSON.parse(bytes);
        f.options.prepared.expectedLockHash = hashBytes(bytes); f.options.result.expectedLockHash = hashBytes(bytes);
        f.entry.analysis = "pending";
        await expect(recordResult({...f.options, fsOps: {...fs, renameSync: () => { throw new Error("injected rename failure"); }}})).rejects.toMatchObject({code: "WRITE_FAILED"});
        expect(JSON.parse(fs.readFileSync(f.target))).toEqual(prior);
        expect(fs.existsSync(`${f.target}.write-lock`)).toBe(false);
    });
    it("dry-run runs source refresh and all checks but preserves lock bytes and mtime", async () => {
        const f = fixture(); await recordResult(f.options);
        const before = fs.readFileSync(f.target); const mtime = fs.statSync(f.target).mtimeMs;
        f.options.prepared.expectedLockHash = hashBytes(before); f.options.result.expectedLockHash = hashBytes(before); f.entry.analysis = "pending";
        let requests = 0;
        const data = await recordResult({...f.options, dryRun: true, transport: async (r) => { requests += 1; return f.options.transport(r); }});
        expect(data.changed).toBe(false); expect(requests).toBeGreaterThan(0);
        expect(fs.readFileSync(f.target)).toEqual(before); expect(fs.statSync(f.target).mtimeMs).toBe(mtime);
        f.pr.body = "Changed during analysis";
        await expect(recordResult({...f.options, dryRun: true})).rejects.toMatchObject({code: "SOURCE_CONFLICT"});
    });
    it("rechecks context after the network and detects mutations during the read", async () => {
        const f = fixture(); let changed = false;
        await expect(recordResult({...f.options, transport: async (request) => {
            if (!changed) { changed = true; fs.appendFileSync(path.join(f.root, "code.mjs"), "race\n"); }
            return f.options.transport(request);
        }})).rejects.toMatchObject({code: "CONTEXT_CONFLICT"});
        expect(fs.existsSync(f.target)).toBe(false);
    });
    it("validates real Git proof before persisting a resolved finding", async () => {
        const f = fixture();
        const before = f.pr.base.sha;
        const gitBytes = (args) => execFileSync("git", args, {cwd: f.root});
        const proof = (sha) => ({kind: "git_file", sha, path: "README.md", hash: hashBytes(gitBytes(["show", `${sha}:README.md`]))});
        const correction = {kind: "git_diff", fromSha: before, toSha: f.sha, paths: ["code.mjs"], hash: hashBytes(gitBytes(["diff", "--no-ext-diff", "--no-textconv", "--binary", before, f.sha, "--", "code.mjs"]))};
        const verification = {original: {status: "verified", sourceId: "PR1", sha: before, evidence: [proof(before)], rationale: "Read baseline"}, response: {sourceIds: [], relation: "none", appliesToSha: null}, correction: {status: "verified", fromSha: before, toSha: f.sha, evidence: [correction, proof(f.sha)], rationale: "Inspected resulting snapshot and diff"}, current: {status: "verified", sha: f.sha, evidence: [proof(f.sha)], rationale: "Current code"}};
        f.entry.assessments = [{id: "A1", sources: [{id: "PR1", quote: "Reviewable"}], historical: "fixed", currency: "existing_safeguard", verificationScope: "Git only", rationale: "Correction inspected", evidence: [], verification}];
        f.entry.dispositions = [{sourceId: "PR1", status: "assessed", rationale: "Inspected", assessmentIds: ["A1"]}];
        verification.original.evidence[0].hash = "0".repeat(64);
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "EVIDENCE_CONFLICT"});
        expect(fs.existsSync(f.target)).toBe(false);
        verification.original.evidence[0] = proof(before);
        await recordResult(f.options);
        expect(JSON.parse(fs.readFileSync(f.target)).entries[0].assessments[0].verification).toEqual(verification);
    });
    it("persists unresolved evidence and source ranges without copying comment bodies", async () => {
        const f = fixture();
        f.entry.analysis = "needs_decision";
        f.entry.assessments = [{id: "A1", sources: [{id: "PR1", quote: "Reviewable"}], historical: "unresolved", currency: "no_evidence", verificationScope: "Git only; runtime unavailable", rationale: "Need runtime evidence", evidence: [], verification: {original: {status: "unavailable", sourceId: "PR1", evidence: [], rationale: "Original evidence unavailable"}, response: {sourceIds: [], relation: "none", appliesToSha: null}, correction: {status: "unavailable", evidence: [], rationale: "Cannot reconstruct correction"}, current: {status: "unavailable", evidence: [], rationale: "Runtime unavailable"}}}];
        f.entry.dispositions = [{sourceId: "PR1", status: "unresolved", rationale: "Awaiting evidence", assessmentIds: ["A1"]}];
        const report = await recordResult(f.options);
        expect(report.missingEvidence).toBe(1);
        const lock = JSON.parse(fs.readFileSync(f.target));
        expect(lock.entries[0].assessments[0].sources).toEqual([{id: "PR1", start: 0, end: 10}]);
        expect(lock.entries[0].assessments[0].verification).toEqual(f.entry.assessments[0].verification);
        expect(fs.readFileSync(f.target, "utf8")).not.toContain("Reviewable");
        expect((await recordResult(f.options)).changed).toBe(false);
    });
    it("preserves deleted finding provenance through recording, retry and cache loss", async () => {
        const f = fixture();
        const comment = {...f.options.sources.sources[0], id: "COMMENT", body: "Finding"};
        f.options.sources.sources.push(comment);
        let deleted = false;
        const transport = f.options.transport;
        f.options.transport = async (request) => request.endpoint?.includes("/issues/1/comments")
            ? {body: deleted ? [] : [{node_id: "COMMENT", body: "Finding", html_url: comment.url, user: null, created_at: comment.createdAt, updated_at: comment.updatedAt}], headers: {}}
            : transport(request);
        const refresh = () => {
            const lockBytes = fs.existsSync(f.target) ? fs.readFileSync(f.target) : null;
            f.options.prepared = prepare({...f.options, lockBytes, lock: lockBytes ? JSON.parse(lockBytes) : null});
            const input = f.options.prepared;
            Object.assign(f.entry, {sourceFingerprint: input.items[0].sourceFingerprint, contextFingerprint: input.context.fingerprint,
                materialDispositions: input.items[0].materials.map((m) => ({id: m.id, status: m.status === "available" ? "used" : "unavailable", rationale: "Inspected"}))});
            Object.assign(f.options.result, {expectedLockHash: input.expectedLockHash, inputContextFingerprint: input.context.fingerprint});
        };
        refresh();
        const unavailable = {status: "unavailable", evidence: [], rationale: "Evidence unavailable"};
        f.entry.analysis = "needs_decision";
        f.entry.assessments = [{id: "A1", sources: [{id: "COMMENT", start: 0, end: 7}], historical: "unresolved", currency: "no_evidence", rationale: "Needs evidence", verificationScope: "Git", evidence: [], verification: {
            original: {...unavailable, sourceId: "COMMENT"}, correction: {...unavailable}, current: {...unavailable}, response: {relation: "none", sourceIds: [], appliesToSha: null},
        }}];
        f.entry.dispositions.push({sourceId: "COMMENT", status: "unresolved", rationale: "Missing proof", assessmentIds: ["A1"]});
        await recordResult(f.options);
        deleted = true;
        f.options.sources.sources.pop();
        refresh();
        f.entry.dispositions.pop();
        const ref = f.entry.assessments[0].sources[0];
        ref.unavailable = true;
        ref.id = "invented";
        await expect(recordResult(f.options)).rejects.toThrow();
        ref.id = "COMMENT";
        ref.end = 6;
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "UNKNOWN_REFERENCE"});
        ref.end = 7;
        const saved = f.entry.assessments;
        f.entry.assessments = [];
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "INCOMPLETE_FINDING_COVERAGE"});
        f.entry.assessments.push(...saved);
        expect((await recordResult(f.options)).changed).toBe(true);
        expect((await recordResult(f.options)).changed).toBe(false);
        const lock = JSON.parse(fs.readFileSync(f.target));
        expect(lock.entries[0].assessments[0].sources).toEqual([ref]);
        expect(lock.entries[0].sourceIds).not.toContain("COMMENT");
        fs.rmSync(f.options.cacheRoot, {recursive: true, force: true});
        refresh();
        expect(f.options.prepared.items[0].previous.assessments[0].sources).toEqual([ref]);
        expect((await recordResult(f.options)).changed).toBe(false);
    });
    it("runs both CLI helpers and validates a dry run using consumer artifacts", async () => {
        const f = fixture(); fs.mkdirSync(f.options.cacheRoot, {recursive: true});
        const args = [];
        for (const name of ["sources", "prepared", "result"]) {
            const file = path.join(f.options.cacheRoot, `${name}.json`); fs.writeFileSync(file, JSON.stringify(f.options[name])); args.push(`--${name}`, file);
        }
        expect(validateMain(args, {cwd: f.root}).code).toBe(0);
        expect((await recordMain([...args, "--dry-run"], {cwd: f.root, transport: f.options.transport})).code).toBe(0);
        expect(fs.existsSync(f.target)).toBe(false);
        for (const name of ["validate-result", "record-result"]) {
            const file = path.resolve(`.agents/skills/gh-review-learn/scripts/${name}.mjs`);
            expect(execFileSync(process.execPath, [file, "--help"], {cwd: os.tmpdir(), encoding: "utf8"})).toContain("Usage:");
        }
        expect(checkResult(f.options).context.fingerprint).toBe(f.options.prepared.context.fingerprint);
    });
});
