import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";
import {decodeLock, createMaterialStore, readArtifact, readPreparedMaterial, validateMaterialArtifacts} from "../../../.agents/skills/gh-review-learn/scripts/storage.mjs";
import {compactLock} from "../../../.agents/skills/gh-review-learn/scripts/compact-lock.mjs";
import {RULES, validateLock, upgradeLock} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";
import {gzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {withConsumerLock} from "../../../.agents/skills/gh-review-learn/scripts/lock-store.mjs";
import {readLearningLock, readPrHistory, verifyLearningStore, createLearningStore, snapshotOf, sameLearningState} from "../../../.agents/skills/gh-review-learn/scripts/learning-store.mjs";
import {learningStatus} from "../../../.agents/skills/gh-review-learn/scripts/status.mjs";
import {resumeBatch} from "../../../.agents/skills/gh-review-learn/scripts/batch.mjs";
import {runAgentCacheClear} from "../../../.agents/skills/agent-cache-clear/scripts/clear.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) { fs.rmSync(root, {recursive: true, force: true}); } });
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "review-storage-")); roots.push(root);
    execFileSync("git", ["init", "-b", "main"], {cwd: root});
    const sha = "a".repeat(40); const hash = "b".repeat(64);
    const repository = {id: "R", name: "example/project", branch: "main"};
    const entries = Array.from({length: 3}, (_, n) => ({prId: `PR${n}`, rules: RULES, sourceFingerprint: hash, projectSha: sha, contextFingerprint: hash, sourceCompleteness: "complete", analysis: "complete", delivery: "not_required", sourceIds: [], assessments: [], dispositions: [], documents: [], documentationChangeIds: [], historicalNote: "Zażółć — preserve all fields. ".repeat(1000)}));
    const member = {id: "PR4", number: 4, mergedAt: "2026-01-01T00:00:00Z", baseSha: sha, headSha: sha, mergeSha: sha};
    const lock = {schemaVersion: 2, kind: "lock", repository, rules: RULES, entries, documentationChanges: [], activeDelivery: null, lastDelivery: null, activeBatch: {id: "batch-1", limit: 20, repository, scopeFingerprint: hash, boundary: "2026-01-02T00:00:00Z", selectedAt: "2026-01-02T00:00:00Z", inventoryReadAt: "2026-01-02T00:00:00Z", prIds: [member.id], prNumbers: [4], members: [member], recordedPrIds: []}};
    return {root, lock, target: path.join(root, "review-learning.lock.json")};
}
const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
function v3(lock) {
    return {...lock, schemaVersion:3, entryEncoding:"gzip-base64", entries:lock.entries.map(entry=>{
        const bytes=Buffer.from(JSON.stringify(entry));return {prId:entry.prId,hash:hashBytes(bytes),byteLength:bytes.length,data:gzipSync(bytes).toString("base64")};
    })};
}
describe("plain JSON learning history", () => {
    it.each(["", "contexts", "materials"])("rejects symlinked migration input directory %s", async (component) => {
        const {root, lock, target} = fixture();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "outside-learning-")); roots.push(outside);
        fs.writeFileSync(path.join(outside, "unrelated.diff"), "External bytes\n");
        const directory = path.join(root, "var/agent/cache/gh-review-learn");
        const input = path.join(directory, component);
        fs.mkdirSync(path.dirname(input), {recursive: true});
        fs.symlinkSync(outside, input, "dir");
        fs.writeFileSync(target, JSON.stringify(lock));
        const before = fs.readFileSync(target);
        await expect(compactLock({cwd: root})).rejects.toThrow(/symlink/i);
        expect(fs.readFileSync(target)).toEqual(before);
        expect(fs.existsSync(path.join(root, "review-learning/patches"))).toBe(false);
    });
    it("rejects overlapping cache before migration, durable writes or cache deletion", async () => {
        const {root, lock, target} = fixture();
        fs.writeFileSync(target, JSON.stringify(lock));
        fs.writeFileSync(path.join(root, ".env.local"), "CACHE_PATH=review-learning\n");
        const before = fs.readFileSync(target);
        await expect(compactLock({cwd: root})).rejects.toThrow(/overlaps/);
        expect(fs.existsSync(path.join(root, "review-learning"))).toBe(false);
        expect(() => createLearningStore({cwd: root}).put("evidence", {value: "saved"})).toThrow(/overlaps/);
        fs.mkdirSync(path.join(root, "review-learning"));
        const sentinel = path.join(root, "review-learning", "saved.json");
        fs.writeFileSync(sentinel, "preserved");
        for (const cachePath of ["review-learning", "review-learning/nested"]) {
            expect(() => runAgentCacheClear({cwd: root, cachePath})).toThrow(/overlaps/);
            expect(fs.readFileSync(sentinel, "utf8")).toBe("preserved");
        }
        expect(fs.readFileSync(target)).toEqual(before);
    });
    it.each([1,2,3])("migrates V%s without loss, leaves an exact durable backup, resumes and survives cache loss", async version => {
        const {root,lock,target}=fixture();
        const legacy=version===1?{schemaVersion:1,kind:"lock",repository:lock.repository,rules:lock.rules,entries:lock.entries}:version===3?v3(lock):lock;
        const before=Buffer.from(JSON.stringify(legacy,null,2)+"\n");fs.writeFileSync(target,before);
        expect((await compactLock({cwd:root,dryRun:true})).changed).toBe(false);expect(fs.readFileSync(target)).toEqual(before);
        const result=await compactLock({cwd:root});expect(result.changed).toBe(true);expect(result.toVersion).toBe(4);
        expect(fs.readFileSync(path.join(root,result.backup))).toEqual(before);
        const bytes=fs.readFileSync(target);const manifest=JSON.parse(bytes);expect(manifest.schemaVersion).toBe(4);expect(manifest.entryEncoding).toBeUndefined();
        expect(readLearningLock({cwd:root})).toEqual(version===1?upgradeLock(legacy):lock);
        if(version!==1){ expect(resumeBatch({cwd:root}).prNumbers).toEqual([4]); }
        expect((await compactLock({cwd:root})).changed).toBe(false);expect(fs.readFileSync(target)).toEqual(bytes);
        fs.rmSync(path.join(root,"var/agent/cache"),{recursive:true,force:true});
        const recovered=readLearningLock({cwd:root});expect(sameLearningState(recovered,version===1?upgradeLock(legacy):lock)).toBe(true);
        expect(verifyLearningStore(recovered).uniquePrs).toBe(3);
        expect(learningStatus({cwd:root}).uniquePrs).toBe(3);expect(learningStatus({cwd:root}).lastAnalysis).toBeNull();
    });
    it("keeps Unicode and unknown historical fields readable, shares rule sets and records explicit recovery gaps",async()=>{
        const {root,lock,target}=fixture();fs.writeFileSync(target,JSON.stringify(lock));await compactLock({cwd:root});
        const saved=readLearningLock({cwd:root});const store=createLearningStore({cwd:root});const index=snapshotOf(saved).index;
        const raw=store.read(index.entries[0].analysis);expect(raw.entry.historicalNote).toBe(lock.entries[0].historicalNote);
        expect(raw.entry.rules.$learningRef).toEqual(store.read(index.entries[1].analysis).entry.rules.$learningRef);
        const history=readPrHistory(saved,"PR0")[0].history;expect(history.gaps.some(g=>g.kind==="sources")).toBe(true);
        expect(fs.readdirSync(path.join(root,"review-learning/rule-sets"))).toHaveLength(1);
    });
    it("does not open analysis records for status, list, batch resume or a metadata-only write",async()=>{
        const {root,lock,target}=fixture();fs.writeFileSync(target,JSON.stringify(lock));await compactLock({cwd:root});
        const saved=readLearningLock({cwd:root});const record=snapshotOf(saved).index.entries[0];fs.unlinkSync(path.join(root,record.analysis.path));
        expect(learningStatus({cwd:root}).uniquePrs).toBe(3);expect(learningStatus({cwd:root,list:true}).prs).toHaveLength(3);
        expect(resumeBatch({cwd:root}).prNumbers).toEqual([4]);
        await withConsumerLock({cwd:root},({current,bytes,commit})=>{ const next=upgradeLock(current);next.lastMarker="metadata-only";commit(next,{expectedLockHash:hashBytes(bytes)}); });
        expect(()=>learningStatus({cwd:root,verify:true})).toThrow(/unavailable/);
        expect(()=>learningStatus({cwd:root,pr:"PR0"})).toThrow(/unavailable/);
    });
    it("retains previous analyses and operation states, with latest analysis separate from merge order",async()=>{
        const {root,lock,target}=fixture();fs.writeFileSync(target,JSON.stringify(lock));await compactLock({cwd:root});
        const write=async(number,date)=>withConsumerLock({cwd:root},({current,bytes,commit})=>{
            const next=upgradeLock(current);next.entries=next.entries.map(e=>e.prId===`PR${number}`?{...e,historicalNote:`revision ${date}`} : e);
            return commit(next,{expectedLockHash:hashBytes(bytes),histories:{[`PR${number}`]:{pr:{id:`PR${number}`,number,mergedAt:`2026-01-0${number+1}T00:00:00Z`},analyzedAt:date,gaps:[],sources:[]}}});
        });
        await write(2,"2026-03-01T00:00:00Z");await write(0,"2026-03-02T00:00:00Z");
        const status=learningStatus({cwd:root});expect(status.uniquePrs).toBe(3);expect(status.lastAnalysis.prs[0].number).toBe(0);expect(status.latestAnalyzedByMerge.number).toBe(2);
        expect(readPrHistory(readLearningLock({cwd:root}),"PR0",{allRevisions:true})).toHaveLength(2);
        const bytes=fs.readFileSync(target);const mtime=fs.statSync(target).mtimeMs;
        await withConsumerLock({cwd:root},({current,commit})=>expect(commit(upgradeLock(current),{expectedLockHash:"stale"}).changed).toBe(false));
        expect(fs.readFileSync(target)).toEqual(bytes);expect(fs.statSync(target).mtimeMs).toBe(mtime);
    });
    it("rejects corrupted refs, traversals and symlinks, and preserves the previous manifest when publication fails",async()=>{
        const {root,lock,target}=fixture();const before=JSON.stringify(lock);fs.writeFileSync(target,before);
        await expect(compactLock({cwd:root,fsOps:{...fs,renameSync(){ throw new Error("Injected failure"); }}})).rejects.toThrow();expect(fs.readFileSync(target,"utf8")).toBe(before);
        fs.writeFileSync(target+".write-lock","owned");await expect(compactLock({cwd:root})).rejects.toMatchObject({code:"LOCK_CONFLICT"});fs.unlinkSync(target+".write-lock");
        await compactLock({cwd:root});const manifest=JSON.parse(fs.readFileSync(target));const store=createLearningStore({cwd:root});
        expect(()=>store.read({...manifest.index,path:"review-learning/../escape.json"})).toThrow();
        const file=path.join(root,manifest.index.path);const good=fs.readFileSync(file);fs.writeFileSync(file,"bad");expect(()=>readLearningLock({cwd:root})).toThrow(/corrupted/);
        fs.writeFileSync(file,good);fs.unlinkSync(file);fs.symlinkSync(target,file);expect(()=>readLearningLock({cwd:root})).toThrow(/Symlink/);
    });
    it("rejects compressed locks outside migration and corrupt compressed migration input",()=>{
        const {lock}=fixture();const value=v3(lock);expect(()=>decodeLock(value)).toThrow(/migration/);
        value.entries[0].data="eA==";
        const {root,target}=fixture();fs.writeFileSync(target,JSON.stringify(value));
        return expect(compactLock({cwd:root})).rejects.toThrow(/decompress/);
    });
    it("recovers exact legacy proof bytes from prepared data and enriches V4 without rewriting learning outcomes",async()=>{
        const {root,lock,target}=fixture();const bytes=Buffer.from("Historical documentation\n");const proof={kind:"worktree_file",path:"gone.md",hash:hashBytes(bytes)};
        const entry=lock.entries[0];entry.sourceIds=["S"];entry.analysis="needs_decision";
        entry.assessments=[{id:"A",sources:[{id:"S",start:0,end:1}],historical:"unresolved",currency:"no_evidence",rationale:"Legacy finding",verificationScope:"Historical bytes",evidence:[proof],verification:{
            original:{status:"unavailable",sourceId:"S",evidence:[],rationale:"Unavailable"},response:{sourceIds:[],relation:"none",appliesToSha:null},correction:{status:"unavailable",evidence:[],rationale:"Unavailable"},current:{status:"unavailable",evidence:[],rationale:"Unavailable"}}}];
        entry.dispositions=[{sourceId:"S",status:"unresolved",rationale:"Missing old proof",assessmentIds:["A"]}];
        fs.writeFileSync(target,JSON.stringify(lock));await compactLock({cwd:root});
        const cache=path.join(root,"var/agent/cache/gh-review-learn");fs.mkdirSync(cache,{recursive:true});
        fs.writeFileSync(path.join(cache,"old-prepared.json"),JSON.stringify({kind:"prepared",repository:lock.repository,context:{fingerprint:"b".repeat(64),files:[]},items:[{materials:[{hash:proof.hash,bytes:bytes.toString("base64")}]}]}));
        const recovery=await compactLock({cwd:root,recoverHistory:true});expect(recovery.changed).toBe(true);expect(recovery.enrichedPrs).toBe(1);
        expect(sameLearningState(readLearningLock({cwd:root}),lock)).toBe(true);
        const history=readPrHistory(readLearningLock({cwd:root}),"PR0")[0].history;
        expect(history.gaps.filter(g=>g.kind==="evidence")).toEqual([]);expect(createLearningStore({cwd:root}).readBytes(history.proofs[0].artifact)).toEqual(bytes);
        const after=fs.readFileSync(target);expect((await compactLock({cwd:root,recoverHistory:true})).changed).toBe(false);expect(fs.readFileSync(target)).toEqual(after);
        fs.rmSync(path.join(root,"var/agent/cache"),{recursive:true,force:true});expect(verifyLearningStore(readLearningLock({cwd:root})).uniquePrs).toBe(3);
    });
    it("reads large histories without a string containing every analysis",async()=>{
        const {root,lock,target}=fixture();lock.entries=Array.from({length:80},(_,i)=>({...lock.entries[0],prId:`L${i}`,historicalNote:"a fairly large preserved rationale. ".repeat(12000)}));
        fs.writeFileSync(target,JSON.stringify(lock));await compactLock({cwd:root});
        const manifest=fs.readFileSync(target,"utf8");expect(manifest.length).toBeLessThan(6000);
        expect(learningStatus({cwd:root}).uniquePrs).toBe(80);expect(learningStatus({cwd:root,list:true}).prs).toHaveLength(80);
        expect(learningStatus({cwd:root,pr:"L1"}).revisions[0].entry.historicalNote).toBe(lock.entries[0].historicalNote);
    });
});
describe("content-addressed prepared materials", () => {
    it("stores binary bytes once and supports bounded UTF-16 reads without eager payload inflation", () => {
        const {root} = fixture(); const store = createMaterialStore({cwd: root});
        const bytes = Buffer.from("Zażółć\n".repeat(10000)); const artifact = store(bytes);
        expect(store(bytes)).toEqual(artifact);
        expect(fs.readdirSync(path.dirname(path.join(root, artifact.path)))).toHaveLength(1);
        expect(readArtifact(artifact, {cwd: root})).toEqual(bytes);
        const m = {id:"D1",kind:"diff",status:"available",provenance:"exact",artifact}; const prepared={items:[{number:1,materials:[m]}]};
        validateMaterialArtifacts(prepared,{cwd:root});
        const range=readPreparedMaterial(prepared,"D1",{cwd:root,start:0,end:6});
        expect(range.text).toBe("Zażółć"); expect(range.bytes).toBeUndefined();
        expect(Buffer.from(readPreparedMaterial(prepared,"D1",{cwd:root}).bytes,"base64")).toEqual(bytes);
        const inline={...m,bytes:bytes.toString("base64")}; delete inline.artifact;
        expect(readPreparedMaterial({items:[{materials:[inline]}]},"D1",{cwd:root,start:0,end:6})).toMatchObject({text:"Zażółć",start:0,end:6});
        expect(readPreparedMaterial({items:[{materials:[inline]}]},"D1",{cwd:root,start:0,end:6}).bytes).toBeUndefined();
        expect(readPreparedMaterial({items:[{materials:[inline]}]},"D1",{cwd:root}).text).toBe(bytes.toString());
        expect(Buffer.from(readPreparedMaterial({items:[{materials:[inline]}]},"D1",{cwd:root}).bytes,"base64")).toEqual(bytes);
    });
    it("fails closed for missing, changed, traversing and symlinked artifacts", () => {
        const {root} = fixture(); const store=createMaterialStore({cwd:root});const artifact=store(Buffer.from("original"));const file=path.join(root,artifact.path);
        expect(()=>readArtifact({...artifact,path:"../escape"},{cwd:root})).toThrow();
        fs.writeFileSync(file,"changed");expect(()=>readArtifact(artifact,{cwd:root})).toThrow();expect(()=>store(Buffer.from("original"))).toThrow();
        fs.unlinkSync(file);expect(()=>readArtifact(artifact,{cwd:root})).toThrow();
        fs.symlinkSync(path.join(root,"missing"),file);expect(()=>readArtifact(artifact,{cwd:root})).toThrow();expect(()=>store(Buffer.from("original"))).toThrow();
    });
});
