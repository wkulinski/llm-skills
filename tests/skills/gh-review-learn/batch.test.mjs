import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import {readLearningLock} from "../../../.agents/skills/gh-review-learn/scripts/learning-store.mjs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";
import {selectBatch, resumeBatch, abandonBatch, main} from "../../../.agents/skills/gh-review-learn/scripts/batch.mjs";
import {collect} from "../../../.agents/skills/gh-review-learn/scripts/collect.mjs";
import {prepare} from "../../../.agents/skills/gh-review-learn/scripts/prepare.mjs";
import {recordResult} from "../../../.agents/skills/gh-review-learn/scripts/record-result.mjs";
import {withConsumerLock} from "../../../.agents/skills/gh-review-learn/scripts/lock-store.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) { fs.rmSync(root, {recursive: true, force: true}); } });
function fixture(count = 45) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-batch-")); roots.push(root);
    const git = (args) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
    git(["init", "-b", "main"]); git(["config", "user.name", "Test"]); git(["config", "user.email", "test@example.test"]); git(["remote", "add", "origin", "git@github.com:example/project.git"]);
    fs.writeFileSync(path.join(root, "README.md"), "Rules\n"); fs.writeFileSync(path.join(root, ".gitignore"), "var/\n");
    git(["add", "."]); git(["commit", "-m", "base"]); const base = git(["rev-parse", "HEAD"]);
    git(["commit", "--allow-empty", "-m", "merged"]); const sha = git(["rev-parse", "HEAD"]);
    const raw = Array.from({length: count}, (_, index) => ({node_id: `PR${count - index}`, number: count - index, body: "Covered rule", html_url: `https://example.test/pr/${count - index}`, user: null,
        created_at: `2026-09-${String(index % 28 + 1).padStart(2, "0")}T00:00:00Z`, updated_at: "2026-11-18T00:00:00Z", merged_at: new Date(Date.UTC(2026, 10, 1, 0, count - index)).toISOString(), base: {ref: "main", sha: base}, head: {sha}, merge_commit_sha: sha}));
    const transport = async (request) => {
        if (request.type === "graphql") { return {body: {data: {node: {reviewThreads: {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}}}}}, headers: {}}; }
        const endpoint = request.endpoint;
        const body = endpoint === "repos/example/project" ? {node_id: "REPO", full_name: "example/project", default_branch: "main"}
            : endpoint.includes("/branches/") ? {commit: {sha}} : endpoint.includes("/pulls?") ? raw : [];
        return {body, headers: {}};
    };
    const target = path.join(root, "review-learning.lock.json");
    const cacheRoot = path.join(root, "var/agent/cache");
    const lock = () => fs.existsSync(target) ? structuredClone(readLearningLock({cwd: root})) : null;
    const collectOptions = {repo: "example/project", now: () => "2026-11-19T00:00:00Z", transport};
    const inventory = async () => (await collect({...collectOptions, inventoryOnly: true})).sources;
    const record = async (batchId, prs) => {
        const sources = (await collect({...collectOptions, lock: lock(), batchId, prs})).sources;
        const lockBytes = fs.readFileSync(target);
        const prepared = prepare({sources, lock: lock(), lockBytes, cwd: root, cacheRoot});
        const entries = prepared.items.map((item) => ({prId: item.prId, rules: prepared.rules, sourceFingerprint: item.sourceFingerprint, projectSha: prepared.projectSha, contextFingerprint: prepared.context.fingerprint, sourceCompleteness: "complete", analysis: "complete", delivery: "not_required", assessments: [],
            dispositions: item.sourceIds.map((sourceId) => ({sourceId, status: "no_learning", rationale: "Covered", assessmentIds: []})), documents: [], documentationChangeIds: [], materialDispositions: item.materials.map((material) => ({id: material.id, status: "used", rationale: "Inspected"}))}));
        const result = {schemaVersion: 2, kind: "result", repository: sources.repository, rules: prepared.rules, batchId, expectedLockHash: prepared.expectedLockHash, inputContextFingerprint: prepared.context.fingerprint, entries, documentationChanges: prepared.documentationChanges};
        await recordResult({sources, prepared, result, cwd: root, cacheRoot, transport});
        return {sources, prepared, result};
    };
    return {root, raw, target, cacheRoot, inventory, collectOptions, lock, record};
}

describe("durable review batches", () => {
    it("processes 45 new PRs in merge order as 20/20/5 without repeats", async () => {
        const f = fixture(); const inventory = await f.inventory(); const selections = [];
        for (const size of [20, 20, 5]) {
            const selected = await selectBatch({inventory, batchSize: 20, cwd: f.root});
            expect(selected.remaining).toHaveLength(size); selections.push(...selected.prNumbers);
            await f.record(selected.batchId);
            expect(f.lock().activeBatch).toBeNull();
        }
        expect(selections).toEqual(Array.from({length: 45}, (_, i) => i + 1));
        expect((await selectBatch({inventory, batchSize: 20, cwd: f.root})).newRemaining).toBe(0);
        expect(f.lock().entries).toHaveLength(45);
    }, 60_000);
    it("resumes only unwritten members after cache loss and keeps older pending outcomes outside the next batch", async () => {
        const f = fixture(5); const inventory = await f.inventory();
        const selected = await selectBatch({inventory, batchSize: 3, cwd: f.root});
        await f.record(selected.batchId, [1]);
        fs.rmSync(f.cacheRoot, {recursive: true, force: true});
        expect(resumeBatch({cwd: f.root}).remaining.map((pr) => pr.number)).toEqual([2, 3]);
        expect((await selectBatch({inventory, batchSize: 3, cwd: f.root})).batchId).toBe(selected.batchId);
        await f.record(selected.batchId);
        const old = f.lock(); old.entries[0].analysis = "needs_decision"; old.entries[0].historicalDocumentation = {schemaVersion: 1, details: "unavailable"}; old.entries[0].delivery = "delivery_pending";
        old.entries[0].documents = [{path: "README.md", beforeHash: "a".repeat(64), afterHash: "b".repeat(64)}]; fs.writeFileSync(f.target, JSON.stringify(old));
        expect((await selectBatch({inventory, batchSize: 3, cwd: f.root})).prNumbers).toEqual([4, 5]);
    }, 30_000);
    it("rejects partial inventory, different scope/size and changed or missing members without replacing the selection", async () => {
        const f = fixture(3); const inventory = await f.inventory();
        await expect(selectBatch({inventory: {...inventory, read: {...inventory.read, completeness: "partial", gaps: ["missing page"]}}, batchSize: 2, cwd: f.root})).rejects.toMatchObject({code: "INCOMPLETE_READ"});
        expect(fs.existsSync(f.target)).toBe(false);
        const selected = await selectBatch({inventory, batchSize: 2, cwd: f.root}); const bytes = fs.readFileSync(f.target);
        await expect(selectBatch({inventory, batchSize: 1, cwd: f.root})).rejects.toMatchObject({code: "BATCH_CONFLICT"});
        await expect(selectBatch({inventory: {...inventory, repository: {...inventory.repository, branch: "other"}}, batchSize: 2, cwd: f.root})).rejects.toMatchObject({code: "REPOSITORY_CONFLICT"});
        const missing = {...inventory, prs: inventory.prs.filter((pr) => pr.number !== 1)};
        await expect(selectBatch({inventory: missing, batchSize: 2, cwd: f.root})).rejects.toMatchObject({code: "BATCH_CONFLICT"});
        f.raw.splice(f.raw.findIndex((pr) => pr.number === 1), 1);
        const {sources} = await collect({...f.collectOptions, lock: f.lock(), batchId: selected.batchId});
        expect(sources.read.completeness).toBe("partial"); expect(sources.read.gaps[0].code).toBe("PR_NOT_IN_SCOPE");
        expect(fs.readFileSync(f.target)).toEqual(bytes);
        await expect(collect({...f.collectOptions, lock: f.lock(), prs: [3]})).rejects.toMatchObject({code: "BATCH_CONFLICT"});
    });
    it("allows one selection owner and validates help without GitHub", async () => {
        const f = fixture(1); const inventory = await f.inventory(); let release;
        const blocked = new Promise((resolve) => { release = resolve; });
        const owner = withConsumerLock({cwd: f.root, repository: inventory.repository}, async () => blocked);
        await expect(selectBatch({inventory, batchSize: 20, cwd: f.root})).rejects.toMatchObject({code: "LOCK_CONFLICT"});
        release(); await owner;
        expect((await main(["--help"], {cwd: os.tmpdir()})).stdout).toContain("Usage:");
        for (const batchSize of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
            await expect(selectBatch({inventory, batchSize, cwd: f.root})).rejects.toMatchObject({code: "INVALID_BATCH"});
        }
    });
    it("abandons an unavailable member explicitly, preserving recorded results and rejecting stale writes", async () => {
        const f = fixture(3); const inventory = await f.inventory();
        const batch = await selectBatch({inventory, batchSize: 2, cwd: f.root});
        const saved = await f.record(batch.batchId, [1]); const before = f.lock();
        f.raw.splice(f.raw.findIndex((pr) => pr.number === 2), 1);
        expect((await collect({...f.collectOptions, lock: f.lock(), batchId: batch.batchId})).sources.read.completeness).toBe("partial");
        for (const args of [["abandon", "--batch", batch.batchId], ["abandon", "--batch", "other", "--user-decision-ref", "user:abandon"]]) {
            expect((await main(args, {cwd: f.root})).code).not.toBe(0); expect(f.lock()).toEqual(before);
        }
        const args = ["abandon", "--batch", batch.batchId, "--user-decision-ref", "user:abandon"];
        const response = await main(args, {cwd: f.root}); expect(response.code).toBe(0);
        expect(f.lock().activeBatch).toBeNull(); expect(f.lock().entries).toEqual(before.entries);
        expect(f.lock().documentationChanges).toEqual(before.documentationChanges);
        expect(f.lock().lastBatch).toMatchObject({id: batch.batchId, status: "abandoned", recordedPrIds: ["PR1"], userDecisionRef: "user:abandon"});
        const bytes = fs.readFileSync(f.target); const mtime = fs.statSync(f.target).mtimeMs;
        expect(JSON.parse((await main(args, {cwd: f.root})).stdout).data.changed).toBe(false);
        expect(fs.readFileSync(f.target)).toEqual(bytes); expect(fs.statSync(f.target).mtimeMs).toBe(mtime);
        await expect(recordResult({...saved, cwd: f.root, cacheRoot: f.cacheRoot, transport: f.collectOptions.transport})).rejects.toMatchObject({code: "BATCH_CONFLICT"});
        expect((await selectBatch({inventory: await f.inventory(), batchSize: 2, cwd: f.root})).prNumbers).toEqual([3]);
        // If the missing PR returns, abandoning its reservation did not invent an analysis.
        expect(f.lock().entries.map((entry) => entry.prId)).toEqual(["PR1"]);
    });
    it("reassesses stored PRs without advancing an active batch", async () => {
        const f = fixture(3); const batch = await selectBatch({inventory: await f.inventory(), batchSize: 2, cwd: f.root});
        await f.record(batch.batchId, [1]); const before = f.lock().activeBatch;
        f.raw.find((pr) => pr.number === 1).body = "Updated stored source";
        await f.record(null, [1]);
        expect(f.lock().activeBatch).toEqual(before); expect(resumeBatch({cwd: f.root}).remaining.map((pr) => pr.number)).toEqual([2]);
        await expect(collect({...f.collectOptions, lock: f.lock()})).rejects.toMatchObject({code: "BATCH_CONFLICT"});
        await expect(collect({...f.collectOptions, lock: f.lock(), prs: [2]})).rejects.toMatchObject({code: "BATCH_CONFLICT"});
        const bytes = fs.readFileSync(f.target);
        fs.writeFileSync(`${f.target}.write-lock`, "other writer");
        await expect(abandonBatch({batchId: batch.batchId, userDecisionRef: "user:abandon", cwd: f.root})).rejects.toMatchObject({code: "LOCK_CONFLICT"});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
    });
});
