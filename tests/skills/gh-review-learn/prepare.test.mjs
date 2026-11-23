import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";
import {RULES, SOURCE_FIELDS, fingerprint, sourceFingerprint, validatePrepared} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";
import {prepare, buildContext, createGitReader, readSource, readGitFile, main} from "../../../.agents/skills/gh-review-learn/scripts/prepare.mjs";
import {readPreparedMaterial, validateMaterialArtifacts} from "../../../.agents/skills/gh-review-learn/scripts/storage.mjs";
import {compactLock} from "../../../.agents/skills/gh-review-learn/scripts/compact-lock.mjs";
import {readLearningLock, snapshotOf} from "../../../.agents/skills/gh-review-learn/scripts/learning-store.mjs";

const temporary = [];
afterEach(() => { for (const directory of temporary.splice(0)) { fs.rmSync(directory, {recursive: true, force: true}); } });
function fixture() {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "review-prepare-")); temporary.push(parent);
    const root = path.join(parent, "consumer"); fs.mkdirSync(root);
    const git = (args) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
    git(["init", "-b", "main"]); git(["config", "user.email", "test@example.test"]); git(["config", "user.name", "Test"]);
    git(["remote", "add", "origin", "git@github.com:example/project.git"]);
    fs.writeFileSync(path.join(root, "code.mjs"), "before\n");
    fs.writeFileSync(path.join(root, "AGENTS.md"), "docs_map:\n  MAIN_DOC: README.md\n");
    fs.writeFileSync(path.join(root, "README.md"), "Rules\n");
    fs.writeFileSync(path.join(root, ".gitignore"), "var/\n.env.local\n");
    git(["add", "."]); git(["commit", "-m", "base"]); const base = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(root, "code.mjs"), "reviewed\n"); git(["add", "."]); git(["commit", "-m", "reviewed"]); const reviewed = git(["rev-parse", "HEAD"]);
    fs.writeFileSync(path.join(root, "code.mjs"), "fixed\n"); git(["add", "."]); git(["commit", "-m", "fixed"]); const head = git(["rev-parse", "HEAD"]);
    git(["reset", "--soft", base]); git(["commit", "-m", "squashed merge"]); const merged = git(["rev-parse", "HEAD"]);
    const source = {...Object.fromEntries(SOURCE_FIELDS.map((key) => [key, null])), id: "S1", kind: "review", prId: "PR1", body: "First. Second.", url: "https://example.test/review", createdAt: "2026-11-18T00:00:00Z", commitSha: reviewed, path: "code.mjs"};
    const sources = {schemaVersion: 1, kind: "sources", repository: {id: "R1", name: "example/project", branch: "main"}, rules: RULES, read: {startedAt: "2026-11-19T00:00:00Z", finishedAt: "2026-11-19T00:01:00Z", targetSha: merged, completeness: "complete", gaps: []}, prs: [{id: "PR1", number: 1, mergedAt: "2026-11-18T00:00:00Z", baseSha: base, headSha: head, mergeSha: merged}], sources: [source]};
    const cacheRoot = path.join(root, "var/agent/cache");
    const options = {cwd: root, cacheRoot, sources};
    return {parent, root, git, base, reviewed, head, merged, sources, options, cacheRoot};
}
function lockFor(output, sources, delivery = "not_required") {
    const entry = {prId: "PR1", rules: {...RULES}, sourceFingerprint: sourceFingerprint(sources.sources), projectSha: output.projectSha, contextFingerprint: output.context.fingerprint, sourceCompleteness: "complete", analysis: "complete", delivery, assessments: [], dispositions: [{sourceId: "S1", status: "no_learning", rationale: "Already covered", assessmentIds: []}], documents: delivery === "delivery_pending" ? [{path: "README.md", beforeHash: fingerprint("before"), afterHash: fingerprint("after")}] : [], sourceIds: ["S1"]};
    const lock = {schemaVersion: 1, kind: "lock", repository: sources.repository, rules: {...RULES}, entries: [entry]};
    return {lock, lockBytes: Buffer.from(`${JSON.stringify(lock)}\n`)};
}
describe("review material preparation", () => {
    it("prepares a new PR from the index without opening unrelated full analyses", async () => {
        const f = fixture();
        const prior = lockFor(prepare(f.options), f.sources);
        const target = path.join(f.root, "review-learning.lock.json");
        fs.writeFileSync(target, prior.lockBytes);
        await compactLock({cwd: f.root});
        const lock = readLearningLock({cwd: f.root});
        const record = snapshotOf(lock).index.entries[0];
        fs.unlinkSync(path.join(f.root, record.analysis.path));
        f.sources.prs.push({...f.sources.prs[0], id: "PR2", number: 2});
        const output = prepare({...f.options, lock, lockBytes: fs.readFileSync(target), prs: [2], externalizeMaterials: true});
        expect(output.items.map((item) => item.prId)).toEqual(["PR2"]);
        expect(output.previousEntries.map((entry) => entry.prId)).toEqual(["PR1"]);
    });
    it("keeps a 20-PR, repeated-review large-diff batch small without losing source-specific materials", () => {
        const f=fixture(); const originalPr=f.sources.prs[0], originalSource=f.sources.sources[0];
        f.sources.prs=Array.from({length:20},(_,i)=>({...originalPr,id:`PR${i}`,number:i+1}));
        f.sources.sources=f.sources.prs.flatMap(pr=>Array.from({length:10},(_,i)=>({...originalSource,prId:pr.id,id:`S_${pr.id}_${i}`})));
        const real=createGitReader(f.root), payload=Buffer.from("+same large diff\n".repeat(300000));let calls=0;
        const output=prepare({...f.options,externalizeMaterials:true,git(args){ if(args[0]==="diff"){ calls++;return payload; }return real(args); }});
        expect(output.items).toHaveLength(20);
        expect(output.items.flatMap(x=>x.materials.filter(m=>m.role==="reviewed_to_pr_head"))).toHaveLength(200);
        expect(new Set(output.items.flatMap(x=>x.materials.filter(m=>m.role==="reviewed_to_pr_head").map(m=>m.sourceId))).size).toBe(200);
        expect(calls).toBe(4);
        expect(JSON.stringify(output).length).toBeLessThan(2*1024*1024);
        validatePrepared(output,f.sources);validateMaterialArtifacts(output,{cwd:f.root});
        const material=output.items[0].materials.find(m=>m.role==="reviewed_to_pr_head");
        expect(Buffer.from(readPreparedMaterial(output,material.id,{cwd:f.root,pr:1}).bytes,"base64")).toEqual(payload);
        expect(material.bytes).toBeUndefined();expect(material.text).toBeUndefined();
    },60000);
    it("publishes artifact manifests through CLI and reads exact payloads with the new pointed reader",async()=>{
        const f=fixture();fs.mkdirSync(f.cacheRoot,{recursive:true});
        const sourcesPath=path.join(f.cacheRoot,"sources.json"),preparedPath=path.join(f.cacheRoot,"prepared.json");fs.writeFileSync(sourcesPath,JSON.stringify(f.sources));
        expect((await main(["--sources",sourcesPath,"--output",preparedPath],{cwd:f.root})).code).toBe(0);
        const output=JSON.parse(fs.readFileSync(preparedPath));expect(output.materialStorageVersion).toBe(1);
        const response=await main(["--prepared",preparedPath,"--read-material",`file:${f.reviewed}:code.mjs`],{cwd:f.root});
        expect(response.code).toBe(0);expect(JSON.parse(response.stdout).data.text).toBe("reviewed\n");
    });
    it("uses exact review/head/merge objects and exposes actual fixes for a squash", () => {
        const f = fixture(); const output = prepare(f.options);
        validatePrepared(output, f.sources);
        expect(output.totalPending).toBe(1);
        const materials = output.items[0].materials;
        expect(materials.find((m) => m.id === `file:${f.reviewed}:code.mjs`).text).toBe("reviewed\n");
        expect(materials.find((m) => m.id === `file:${f.merged}:code.mjs`).text).toBe("fixed\n");
        expect(materials.find((m) => m.role === "reviewed_to_pr_head").text).toContain("+fixed");
        expect(materials.find((m) => m.role === "merge_first_parent_to_merged").from).toBe(f.base);
        expect(materials.find((m) => m.sha === f.reviewed).versions).toContainEqual({role: "reviewed", sha: f.reviewed, sourceId: "S1"});
        expect(materials.every((m) => m.status === "available")).toBe(true);
    });
    it("skips complete work even after lock-only commits and commits of identical bytes", () => {
        const f = fixture(); const first = prepare(f.options); const prior = lockFor(first, f.sources);
        expect(prepare({...f.options, ...prior}).items).toEqual([]);
        fs.writeFileSync(path.join(f.root, "review-learning.lock.json"), prior.lockBytes);
        f.git(["add", "review-learning.lock.json"]); f.git(["commit", "-m", "record analysis"]);
        const next = prepare({...f.options, ...prior});
        expect(next.items).toEqual([]); expect(next.context.fingerprint).toBe(first.context.fingerprint);
        f.git(["commit", "--allow-empty", "-m", "same bytes"]);
        expect(prepare({...f.options, ...prior}).items).toEqual([]);
    });
    it("invalidates on dirty bytes, tracked set, effective mode, symlink target and deletion", () => {
        const f = fixture(); const first = prepare(f.options); const prior = lockFor(first, f.sources);
        for (const filename of ["code.mjs", "README.md"]) {
            const name = path.join(f.root, filename); const previous = fs.readFileSync(name);
            fs.appendFileSync(name, "Changed\n");
            const changed = prepare({...f.options, ...prior});
            expect(changed.items[0].reasons).toContain("context_changed");
            expect(changed.items[0].contextChanges.paths.map((p) => p.path)).toContain(filename);
            fs.writeFileSync(name, previous);
        }
        fs.chmodSync(path.join(f.root, "code.mjs"), 0o755);
        expect(prepare({...f.options, ...prior}).items[0].reasons).toContain("context_changed");
        fs.chmodSync(path.join(f.root, "code.mjs"), 0o644);
        fs.writeFileSync(path.join(f.root, "package.json"), "{}"); f.git(["add", "package.json"]);
        expect(prepare({...f.options, ...prior}).items[0].contextChanges.paths.some((p) => p.path === "package.json" && p.before === null)).toBe(true);
        fs.unlinkSync(path.join(f.root, "README.md"));
        expect(buildContext(f.options).files.find((p) => p.path === "README.md").missing).toBe(true);
        fs.symlinkSync("code.mjs", path.join(f.root, "linked")); f.git(["add", "linked"]);
        const a = buildContext(f.options); fs.unlinkSync(path.join(f.root, "linked")); fs.symlinkSync("package.json", path.join(f.root, "linked"));
        expect(buildContext(f.options).fingerprint).not.toBe(a.fingerprint);
    }, 30_000);
    it("tracks submodule SHA and preserves added-document context across commit", () => {
        const f = fixture();
        fs.mkdirSync(path.join(f.root, "module"));
        f.git(["update-index", "--add", "--cacheinfo", `160000,${f.base},module`]);
        const initial = buildContext(f.options);
        f.git(["update-index", "--cacheinfo", `160000,${f.merged},module`]);
        expect(buildContext(f.options).fingerprint).not.toBe(initial.fingerprint);
        fs.writeFileSync(path.join(f.root, "new-doc.md"), "new rule\n");
        const withOutput = buildContext({...f.options, extraPaths: ["new-doc.md"]});
        f.git(["add", "new-doc.md"]); f.git(["commit", "-m", "new document"]);
        expect(buildContext(f.options).fingerprint).toBe(withOutput.fingerprint);
    });
    it("rebuilds pending work after cache loss while preserving historical conclusions", () => {
        const f = fixture(); const first = prepare(f.options); const prior = lockFor(first, f.sources, "delivery_pending");
        const before = JSON.stringify(prior.lock);
        fs.rmSync(f.cacheRoot, {recursive: true, force: true});
        const output = prepare({...f.options, ...prior});
        expect(output.items[0].reasons).toEqual(["delivery_pending"]);
        expect(output.items[0].previous).toEqual(prior.lock.entries[0]);
        expect(output.items[0].contextChanges.available).toBe(false);
        expect(output.items[0].materials.some((m) => m.kind === "current_document" && m.status === "available")).toBe(true);
        expect(JSON.stringify(prior.lock)).toBe(before);
        prior.lock.entries[0].delivery = "not_required";
        prior.lockBytes = Buffer.from(JSON.stringify(prior.lock));
        expect(prepare({...f.options, ...prior}).items).toEqual([]);
    });
    it("names missing review objects and truncated Git output without substituting another version", () => {
        const f = fixture(); f.sources.sources[0].commitSha = "f".repeat(40);
        let output = prepare(f.options);
        expect(output.items[0].materials.find((m) => m.id === `commit:${"f".repeat(40)}`).status).toBe("missing");
        f.sources.sources[0].commitSha = f.reviewed;
        const git = createGitReader(f.root);
        output = prepare({...f.options, git: (args) => {
            if (args[0] === "diff") { throw Object.assign(new Error("output limit"), {code: "ENOBUFS"}); }
            return git(args);
        }});
        expect(output.items[0].materials.filter((m) => m.kind === "diff").every((m) => m.reason === "truncated_output")).toBe(true);
        expect(output.items[0].materials.find((m) => m.sha === f.merged).status).toBe("available");
    });
    it("keeps all inventory and remaining PRs in merge/number/source order", () => {
        const f = fixture();
        f.sources.prs.unshift({...f.sources.prs[0], id: "PR2", number: 2});
        f.sources.sources.unshift({...f.sources.sources[0], id: "Z2", prId: "PR2"});
        const output = prepare({...f.options, prs: [2]});
        expect(output.totalPending).toBe(2); expect(output.items.map((i) => i.prId)).toEqual(["PR2"]);
        expect(output.inventory.map((i) => i.prId)).toEqual(["PR1", "PR2"]);
        expect(output.remaining.map((i) => i.prId)).toEqual(["PR1"]);
        expect(() => prepare({...f.options, prs: [99]})).toThrow();
    });
    it("separates overlapping historical queues and marks unrefreshed sources unchecked", () => {
        const f = fixture();
        const first = prepare(f.options); const prior = lockFor(first, f.sources, "delivery_pending");
        prior.lock.entries[0].analysis = "needs_decision";
        prior.lock.entries[0].contextFingerprint = fingerprint("earlier context");
        prior.lockBytes = Buffer.from(JSON.stringify(prior.lock));
        f.sources.prs[0] = {...f.sources.prs[0], id: "PR2", number: 2};
        f.sources.sources[0] = {...f.sources.sources[0], id: "S2", prId: "PR2"};
        const output = prepare({...f.options, ...prior});
        expect(output.queues.new.map((item) => item.prId)).toEqual(["PR2"]);
        for (const name of ["unresolved", "reassessment", "delivery"]) {
            expect(output.queues[name]).toEqual([{prId: "PR1", sourceFreshness: "unchecked"}]);
        }
    });
    it("reads explicit sources/files/ranges without changing provenance or following symlinks", () => {
        const f = fixture();
        expect(readSource(f.sources, "S1", 0, 5).text).toBe("First");
        const git = createGitReader(f.root);
        const file = readGitFile(git, f.reviewed, "code.mjs", 0, 6);
        expect(file.text).toBe("review"); expect(file.sha).toBe(f.reviewed);
        expect(Buffer.from(file.bytes, "base64").toString()).toBe("reviewed\n");
        expect(() => readSource(f.sources, "missing")).toThrow();
        expect(() => readGitFile(git, "HEAD", "code.mjs")).toThrow();
        expect(() => readGitFile(git, f.reviewed, "../secret")).toThrow();
        expect(() => readGitFile(git, f.reviewed, "code.mjs", 0, 5000)).toThrow();
        fs.writeFileSync(path.join(f.root, ".env.local"), "GH_TOKEN=DO_NOT_READ");
        expect(buildContext(f.options).files.some((p) => p.path === ".env.local")).toBe(false);
    });
    it("isolates context from installation A and independent worktrees B/C", () => {
        const f = fixture(); const worktree = path.join(f.parent, "other");
        f.git(["worktree", "add", "--detach", worktree, f.merged]);
        const first = prepare(f.options);
        fs.appendFileSync(path.join(worktree, "README.md"), "worktree-only\n");
        const other = prepare({...f.options, cwd: worktree, cacheRoot: path.join(worktree, "var/agent/cache")});
        expect(other.context.fingerprint).not.toBe(first.context.fingerprint);
        expect(prepare(f.options).context.fingerprint).toBe(first.context.fingerprint);
        const cli = path.resolve(".agents/skills/gh-review-learn/scripts/prepare.mjs");
        const result = JSON.parse(execFileSync(process.execPath, [cli, "--read-file", "README.md", "--sha", f.merged], {cwd: worktree, encoding: "utf8"}));
        expect(result.data.text).toBe("Rules\n");
        expect(fs.existsSync(path.join(worktree, "var/agent/cache/gh-review-learn/contexts", `${other.context.fingerprint}.json`))).toBe(true);
    });
    it("validates origin and exact lock bytes and keeps rule changes pending", () => {
        const f = fixture(); const prior = lockFor(prepare(f.options), f.sources);
        expect(() => prepare({...f.options, lock: prior.lock})).toThrow();
        prior.lock.entries[0].rules.analysis = RULES.analysis + 1; prior.lockBytes = Buffer.from(JSON.stringify(prior.lock));
        expect(prepare({...f.options, ...prior}).items[0].reasons).toContain("rules_changed");
        f.git(["remote", "set-url", "origin", "git@github.com:foreign/project.git"]);
        expect(() => prepare(f.options)).toThrow(expect.objectContaining({code: "REPOSITORY_CONFLICT"}));
    });
    it("runs CLI preparation using B cache and real lock byte tokens", async () => {
        const f = fixture(); fs.mkdirSync(f.cacheRoot, {recursive: true});
        const sourcePath = path.join(f.cacheRoot, "sources.json"); fs.writeFileSync(sourcePath, JSON.stringify(f.sources));
        const args = ["--sources", sourcePath, "--output", path.join(f.cacheRoot, "prepared.json")];
        expect((await main(args, {cwd: f.root})).code).toBe(0);
        const prepared = JSON.parse(fs.readFileSync(path.join(f.cacheRoot, "prepared.json")));
        const prior = lockFor(prepared, f.sources); fs.writeFileSync(path.join(f.root, "review-learning.lock.json"), prior.lockBytes);
        expect((await main(args, {cwd: f.root})).code).toBe(0);
        const after = JSON.parse(fs.readFileSync(path.join(f.cacheRoot, "prepared.json")));
        expect(after.items).toEqual([]);
        expect(after.expectedLockHash).toBe(createHash("sha256").update(prior.lockBytes).digest("hex"));
        expect((await main(["--help"], {cwd: f.parent})).code).toBe(0);
    });
});
