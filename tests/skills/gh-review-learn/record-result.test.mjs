import {afterEach, describe, expect, it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";
import {RULES, SOURCE_FIELDS} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";
import {prepare} from "../../../.agents/skills/gh-review-learn/scripts/prepare.mjs";
import {recordResult, beginDelivery, confirmDelivery, main as recordMain} from "../../../.agents/skills/gh-review-learn/scripts/record-result.mjs";
import {checkResult, hashBytes, main as validateMain} from "../../../.agents/skills/gh-review-learn/scripts/validate-result.mjs";
import {withConsumerLock} from "../../../.agents/skills/gh-review-learn/scripts/lock-store.mjs";
import {collect} from "../../../.agents/skills/gh-review-learn/scripts/collect.mjs";

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
function individualProposal(f) {
    proposal(f);
    const assessment = {id: "A1", sources: [{id: f.entry.prId, quote: "Reviewable"}], historical: "unresolved", currency: "no_evidence", rationale: "Requires further evidence", verificationScope: "Git; runtime unchecked", evidence: [],
        verification: {original: {status: "unavailable", sourceId: f.entry.prId, evidence: [], rationale: "Unavailable"}, response: {sourceIds: [], relation: "none", appliesToSha: null}, correction: {status: "unavailable", evidence: [], rationale: "Unavailable"}, current: {status: "unavailable", evidence: [], rationale: "Unavailable"}}};
    f.entry.analysis = "needs_decision";
    f.entry.assessments = [assessment];
    f.entry.dispositions = [{sourceId: f.entry.prId, status: "unresolved", rationale: "Retain the unresolved evidence", assessmentIds: ["A1"]}];
    f.entry.documentationChangeIds = ["C1"];
    f.options.result.schemaVersion = 2;
    f.options.result.documentationChanges = [{id: "C1", revision: 1, ...f.entry.documents[0], section: "Rules", description: "Require inspection of resulting bytes", rationale: "The proposal needs a durable description", references: [{prId: f.entry.prId, assessmentId: "A1"}], status: "proposed"}];
}
function refreshPrepared(f) {
    const lockBytes = fs.readFileSync(f.target);
    f.options.prepared = prepare({...f.options, lock: JSON.parse(lockBytes), lockBytes});
    return f.options.prepared;
}
function intentFor(f, {operationId = "delivery-1", ids = ["C1"], text = "New rules\n"} = {}) {
    const changes = f.options.result.documentationChanges.filter((change) => ids.includes(change.id));
    const paths = [...new Set(changes.map((change) => change.path))];
    return {operationId, userDecisionRef: "user-message:apply-selection", changes: changes.map(({id, revision}) => ({id, revision})),
        documents: paths.map((name) => ({path: name, beforeHash: fs.existsSync(path.join(f.root, name)) ? hashBytes(fs.readFileSync(path.join(f.root, name))) : null, afterHash: hashBytes(text), afterBytes: Buffer.from(text).toString("base64")}))};
}

describe("review result recording", () => {
    it("abandons a conflicted delivery without losing edits, then reassesses and confirms a new operation", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        fs.writeFileSync(path.join(f.root, "README.md"), "Unconfirmed edit\n"); f.pr.body = "Reviewable revised source";
        await expect(confirmDelivery({...f.options, operationId: intent.operationId, finalDocumentsReviewed: true})).rejects.toMatchObject({code: "CONTEXT_CONFLICT"});
        const before = fs.readFileSync(f.target); const priorChanges = JSON.parse(before).documentationChanges;
        const args = [];
        for (const name of ["sources", "prepared", "result"]) {
            const file = path.join(f.options.cacheRoot, `${name}.json`);
            fs.writeFileSync(file, JSON.stringify(name === "result" ? {delivery: {operationId: intent.operationId, userDecisionRef: "user:abandon-delivery"}} : f.options[name]));
            args.push(`--${name}`, file);
        }
        const call = (extra = []) => recordMain([...args, "--abandon-delivery", ...extra], {cwd: f.root});
        expect((await call(["--dry-run"])).code).toBe(0); expect(fs.readFileSync(f.target)).toEqual(before);
        const abandoned = await call(); expect(abandoned.code).toBe(0);
        const data = JSON.parse(abandoned.stdout).data;
        expect(data).toMatchObject({abandoned: true, event: "progress_unconfirmed", changedFiles: ["README.md"], newlyApplied: []});
        expect(data.report.introduction).toBe("Dokumentacja została zmieniona, ale zapis postępu nie został potwierdzony");
        const lock = JSON.parse(fs.readFileSync(f.target)); expect(lock.activeDelivery).toBeNull();
        expect(lock.documentationChanges).toEqual(priorChanges); expect(lock.lastDelivery).toBeNull();
        expect(lock.lastAbandonedDelivery).toMatchObject({operationId: intent.operationId, userDecisionRef: "user:abandon-delivery", originalDecisionRef: intent.userDecisionRef,
            observed: [{path: "README.md", actualHash: hashBytes("Unconfirmed edit\n"), state: "conflict"}]});
        expect(fs.readFileSync(path.join(f.root, "README.md"), "utf8")).toBe("Unconfirmed edit\n");
        const bytes = fs.readFileSync(f.target); const mtime = fs.statSync(f.target).mtimeMs;
        expect(JSON.parse((await call()).stdout).data.changed).toBe(false);
        expect(fs.readFileSync(f.target)).toEqual(bytes); expect(fs.statSync(f.target).mtimeMs).toBe(mtime);
        await expect(beginDelivery({...f.options, intent})).rejects.toMatchObject({code: "DELIVERY_CONFLICT"});
        const recollected = await collect({repo: "example/project", transport: f.options.transport, lock});
        const resumed = {...f, options: {...f.options, sources: recollected.sources}};
        const prepared = refreshPrepared(resumed);
        Object.assign(f.entry, {contextFingerprint: prepared.context.fingerprint, sourceFingerprint: prepared.items[0].sourceFingerprint,
            materialDispositions: prepared.items[0].materials.map((item) => ({id: item.id, status: "used", rationale: "Reassessed after explicit abandonment"})),
            documents: [{path: "README.md", beforeHash: hashBytes("Unconfirmed edit\n"), afterHash: hashBytes("Revised rules\n")}]});
        Object.assign(f.options.result, {expectedLockHash: prepared.expectedLockHash, inputContextFingerprint: prepared.context.fingerprint});
        Object.assign(f.options.result.documentationChanges[0], {...f.entry.documents[0], revision: 2, description: "Revised proposal after source conflict"});
        await recordResult(resumed.options); refreshPrepared(resumed);
        const nextIntent = intentFor(resumed, {operationId: "delivery-2", text: "Revised rules\n"});
        await beginDelivery({...resumed.options, intent: nextIntent}); refreshPrepared(resumed);
        fs.writeFileSync(path.join(f.root, "README.md"), "Revised rules\n");
        expect((await confirmDelivery({...resumed.options, operationId: nextIntent.operationId, finalDocumentsReviewed: true})).event).toBe("confirmed");
        expect(JSON.parse(fs.readFileSync(f.target)).lastAbandonedDelivery).toEqual(lock.lastAbandonedDelivery);
    });
    it("reports edits and unconfirmed progress when confirmation cannot acquire the writer guard", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        const before = fs.readFileSync(f.target);
        f.options.result = {delivery: {operationId: intent.operationId, finalDocumentsReviewed: true}};
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        const guard = `${f.target}.write-lock`; fs.writeFileSync(guard, "another writer");
        const args = [];
        for (const name of ["sources", "prepared", "result"]) {
            const file = path.join(f.options.cacheRoot, `${name}.json`); fs.writeFileSync(file, JSON.stringify(f.options[name])); args.push(`--${name}`, file);
        }
        const response = await recordMain([...args, "--confirm-delivery"], {cwd: f.root, transport: f.options.transport});
        const value = JSON.parse(response.stdout);
        expect(response.code).not.toBe(0); expect(value.errors[0].code).toBe("LOCK_CONFLICT");
        expect(value.data.delivery).toMatchObject({event: "progress_unconfirmed", changedFiles: ["README.md"], newlyApplied: [], progressConfirmed: false});
        expect(value.data.report.introduction).toBe("Dokumentacja została zmieniona, ale zapis postępu nie został potwierdzony");
        expect(value.data.report.changedFiles).toEqual(["README.md"]);
        expect(fs.readFileSync(f.target)).toEqual(before); expect(fs.readFileSync(guard, "utf8")).toBe("another writer");
        fs.unlinkSync(guard);
        expect((await recordMain([...args, "--confirm-delivery"], {cwd: f.root, transport: f.options.transport})).code).toBe(0);
    });
    it("recovers confirmation after rename failure and cache loss without reapplying document edits", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        const intentBytes = fs.readFileSync(f.target);
        expect(fs.readFileSync(path.join(f.root, "README.md"), "utf8")).toBe("Old rules\n");
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        const options = {...f.options, operationId: intent.operationId, finalDocumentsReviewed: true};
        await expect(confirmDelivery({...options, fsOps: {...fs, renameSync: () => { throw new Error("injected failure after edits"); }}})).rejects.toMatchObject({code: "WRITE_FAILED", delivery: {event: "progress_unconfirmed", changedFiles: ["README.md"], newlyApplied: []}});
        expect(fs.readFileSync(f.target)).toEqual(intentBytes);
        expect(JSON.parse(intentBytes).documentationChanges[0].status).toBe("proposed");
        fs.rmSync(f.options.cacheRoot, {recursive: true, force: true});
        const confirmed = await confirmDelivery(options);
        expect(confirmed.event).toBe("confirmed"); expect(confirmed.diffAvailable).toBe(false);
        expect(fs.readFileSync(path.join(f.root, "README.md"), "utf8")).toBe("New rules\n");
        expect(JSON.parse(fs.readFileSync(f.target)).activeDelivery).toBeNull();
        expect((await confirmDelivery(options)).event).toBe("previously_confirmed");
    });
    it("rejects unknown document bytes, undeclared changes and changed sources relative to the durable intent", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        const bytes = fs.readFileSync(f.target); const options = {...f.options, operationId: intent.operationId, finalDocumentsReviewed: true};
        fs.writeFileSync(path.join(f.root, "README.md"), "Unknown edit\n");
        await expect(confirmDelivery(options)).rejects.toMatchObject({code: "CONTEXT_CONFLICT", delivery: {event: "progress_unconfirmed"}});
        // Even preparing again after the unknown edit cannot replace the durable baseline.
        refreshPrepared(f);
        await expect(confirmDelivery({...options, prepared: f.options.prepared})).rejects.toMatchObject({code: "CONTEXT_CONFLICT"});
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        fs.appendFileSync(path.join(f.root, "code.mjs"), "undeclared edit\n");
        await expect(confirmDelivery(options)).rejects.toMatchObject({code: "CONTEXT_CONFLICT"});
        fs.writeFileSync(path.join(f.root, "code.mjs"), "fixed\n");
        f.pr.body = "Source edited after intent";
        await expect(confirmDelivery(options)).rejects.toMatchObject({code: "SOURCE_CONFLICT"});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
    });
    it("keeps intent unapplied for baseline files, dry runs, and concurrent operation attempts", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); const before = fs.readFileSync(f.target);
        expect((await beginDelivery({...f.options, intent, dryRun: true})).event).toBe("dry_run");
        expect(fs.readFileSync(f.target)).toEqual(before);
        expect(fs.existsSync(path.join(f.options.cacheRoot, "gh-review-learn/deliveries/delivery-1"))).toBe(false);
        await beginDelivery({...f.options, intent}); refreshPrepared(f);
        const bytes = fs.readFileSync(f.target);
        expect((await confirmDelivery({...f.options, operationId: intent.operationId, finalDocumentsReviewed: true})).event).toBe("not_applied");
        await expect(beginDelivery({...f.options, intent: {...intent, operationId: "another-operation"}})).rejects.toMatchObject({code: "DELIVERY_CONFLICT"});
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        await expect(confirmDelivery({...f.options, operationId: intent.operationId})).rejects.toMatchObject({code: "INVALID_STATE"});
        expect((await confirmDelivery({...f.options, operationId: intent.operationId, finalDocumentsReviewed: true, dryRun: true})).newlyApplied).toEqual([]);
        expect(fs.readFileSync(f.target)).toEqual(bytes);
    });
    it("rejects partially edited selected sets instead of silently completing them", async () => {
        const f = fixture(); individualProposal(f);
        const second = {...structuredClone(f.options.result.documentationChanges[0]), id: "C2", path: "second.md", beforeHash: null};
        f.options.result.documentationChanges.push(second); f.entry.documentationChangeIds.push("C2");
        f.entry.documents.push({path: "second.md", beforeHash: null, afterHash: second.afterHash});
        await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f, {ids: ["C1", "C2"]}); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        const bytes = fs.readFileSync(f.target); fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        await expect(confirmDelivery({...f.options, operationId: intent.operationId, finalDocumentsReviewed: true})).rejects.toMatchObject({code: "DOCUMENT_CONFLICT"});
        expect(fs.existsSync(path.join(f.root, "second.md"))).toBe(false); expect(fs.readFileSync(f.target)).toEqual(bytes);
    });
    it("requires confirmation for new applied states instead of accepting analysis as delivery", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options);
        const bytes = fs.readFileSync(f.target);
        f.entry.delivery = "applied"; f.entry.finalDocumentsReviewed = true;
        Object.assign(f.options.result.documentationChanges[0], {status: "applied", finalDocumentsReviewed: true});
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "DELIVERY_REQUIRED"});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
    });
    it("runs begin, refreshed preparation and confirmation through the public CLI", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); const paths = {};
        fs.mkdirSync(f.options.cacheRoot, {recursive: true});
        for (const name of ["sources", "prepared", "result"]) { paths[name] = path.join(f.options.cacheRoot, `${name}.json`); }
        const args = () => Object.entries(paths).flatMap(([name, file]) => [`--${name}`, file]);
        const inputs = (delivery) => { fs.writeFileSync(paths.sources, JSON.stringify(f.options.sources)); fs.writeFileSync(paths.prepared, JSON.stringify(f.options.prepared)); fs.writeFileSync(paths.result, JSON.stringify({delivery})); };
        inputs(intent);
        const begun = await recordMain([...args(), "--begin-delivery"], {cwd: f.root, transport: f.options.transport});
        expect(JSON.parse(begun.stdout).data.event).toBe("intent_recorded");
        refreshPrepared(f); inputs({operationId: intent.operationId, finalDocumentsReviewed: true});
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        const confirmed = await recordMain([...args(), "--confirm-delivery"], {cwd: f.root, transport: f.options.transport});
        expect(JSON.parse(confirmed.stdout).data.event).toBe("confirmed");
        expect(JSON.parse(confirmed.stdout).data.report.progress.refreshedPrIds).toEqual(["PR1"]);
        const replay = await recordMain([...args(), "--confirm-delivery"], {cwd: f.root, transport: f.options.transport});
        expect(JSON.parse(replay.stdout).data.report.progress.refreshedPrIds).toEqual([]);
        expect(JSON.parse(fs.readFileSync(f.target)).documentationChanges[0].status).toBe("applied");
    });
    it("persists one proposal shared by assessments from two PRs and reopens it after cache loss", async () => {
        const f = fixture();
        const pr2 = {...f.pr, number: 2, node_id: "PR2", html_url: "https://example.test/pr/2"};
        f.options.sources.prs.push({...f.options.sources.prs[0], id: "PR2", number: 2});
        f.options.sources.sources.push({...f.options.sources.sources[0], id: "PR2", prId: "PR2", url: pr2.html_url});
        const transport = f.options.transport;
        f.options.transport = (request) => request.endpoint?.includes("/pulls?") ? Promise.resolve({body: [f.pr, pr2], headers: {}}) : transport(request);
        f.options.prepared = prepare(f.options);
        individualProposal(f);
        const second = structuredClone(f.entry);
        second.prId = "PR2"; second.sourceFingerprint = f.options.prepared.items.find((item) => item.prId === "PR2").sourceFingerprint;
        second.dispositions[0].sourceId = "PR2"; second.assessments[0].sources[0].id = "PR2"; second.assessments[0].verification.original.sourceId = "PR2";
        f.options.result.entries.push(second);
        f.options.result.documentationChanges[0].references.push({prId: "PR2", assessmentId: "A1"});
        await recordResult(f.options);
        const bytes = fs.readFileSync(f.target); const lock = JSON.parse(bytes);
        expect(lock.documentationChanges).toHaveLength(1);
        expect(lock.documentationChanges[0].references).toHaveLength(2);
        expect(lock.entries.map((entry) => entry.documentationChangeIds)).toEqual([["C1"], ["C1"]]);
        fs.rmSync(f.options.cacheRoot, {recursive: true, force: true});
        const input = prepare({...f.options, lock, lockBytes: bytes});
        expect(input.documentationChanges).toEqual(lock.documentationChanges);
        expect(input.documentationChanges[0].description).toContain("resulting bytes");
        const invalid = structuredClone(f.options.result); invalid.documentationChanges[0].references[1].assessmentId = "foreign";
        await expect(recordResult({...f.options, result: invalid})).rejects.toMatchObject({code: "UNKNOWN_REFERENCE"});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
    });
    it("stores applied and proposed states separately while PR delivery remains pending", async () => {
        const f = fixture(); individualProposal(f);
        const pending = {...structuredClone(f.options.result.documentationChanges[0]), id: "C2", path: "README.md", afterHash: hashBytes("Both rules\n")};
        f.options.result.documentationChanges.push(pending);
        f.entry.documentationChangeIds.push("C2");
        f.entry.documents[0].afterHash = pending.afterHash;
        await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        await confirmDelivery({...f.options, operationId: intent.operationId, finalDocumentsReviewed: true});
        const lock = JSON.parse(fs.readFileSync(f.target));
        expect(lock.entries[0].delivery).toBe("delivery_pending");
        expect(lock.documentationChanges.map((change) => change.status)).toEqual(["applied", "proposed"]);
        expect(lock.lastDelivery.documents[0].afterHash).toBe(hashBytes("New rules\n"));
        const bytes = fs.readFileSync(f.target); const mtime = fs.statSync(f.target).mtimeMs;
        expect((await confirmDelivery({...f.options, operationId: intent.operationId})).event).toBe("previously_confirmed");
        expect(fs.readFileSync(f.target)).toEqual(bytes); expect(fs.statSync(f.target).mtimeMs).toBe(mtime);
    });
    it("reads V1 without migration, then preserves historical data on the first explicit write", async () => {
        const f = fixture(); proposal(f);
        const legacy = {schemaVersion: 1, kind: "lock", repository: f.options.sources.repository, rules: RULES, entries: [{...f.entry, sourceIds: ["PR1"]}]};
        delete legacy.entries[0].materialDispositions;
        const bytes = Buffer.from(JSON.stringify(legacy)); fs.writeFileSync(f.target, bytes);
        const mtime = fs.statSync(f.target).mtimeMs;
        const input = prepare({...f.options, lock: legacy, lockBytes: bytes});
        expect(fs.readFileSync(f.target)).toEqual(bytes); expect(fs.statSync(f.target).mtimeMs).toBe(mtime);
        expect(input.items[0].reasons).toEqual(["delivery_pending"]);
        f.options.prepared = input; f.options.result.expectedLockHash = input.expectedLockHash;
        f.entry.materialDispositions = input.items[0].materials.map((item) => ({id: item.id, status: "used", rationale: "Checked historical and current documents"}));
        await recordResult({...f.options, dryRun: true});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
        await recordResult(f.options);
        const next = JSON.parse(fs.readFileSync(f.target));
        expect(next.schemaVersion).toBe(2); expect(next.rules).toEqual(legacy.rules);
        expect(next.entries[0]).toMatchObject(legacy.entries[0]);
        expect(next.entries[0].historicalDocumentation).toEqual({schemaVersion: 1, details: "unavailable"});
        expect(next.documentationChanges).toEqual([]);
    });
    it("requires new content to reopen at a new revision and keeps old bytes on failure", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options);
        const bytes = fs.readFileSync(f.target); const lock = JSON.parse(bytes);
        f.options.prepared = prepare({...f.options, lock, lockBytes: bytes});
        f.entry.materialDispositions = f.options.prepared.items[0].materials.map((item) => ({id: item.id, status: "used", rationale: "Rechecked proposal documents"}));
        f.options.result.expectedLockHash = hashBytes(bytes);
        f.options.result.documentationChanges[0].description = "Different target content";
        await expect(recordResult(f.options)).rejects.toMatchObject({code: "REVISION_CONFLICT"});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
        f.options.result.documentationChanges[0].revision = 2;
        await recordResult(f.options);
        expect(JSON.parse(fs.readFileSync(f.target)).documentationChanges[0].revision).toBe(2);
    });
    it("rejects analysis that erases a confirmed decision or its provenance", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        fs.writeFileSync(path.join(f.root, "README.md"), "New rules\n");
        await confirmDelivery({...f.options, operationId: intent.operationId, finalDocumentsReviewed: true});
        fs.writeFileSync(path.join(f.root, "NOTES.md"), "Context changed\n"); f.git(["add", "NOTES.md"]);
        const prepared = refreshPrepared(f); const bytes = fs.readFileSync(f.target); const lock = JSON.parse(bytes);
        const entry = {...lock.entries[0], contextFingerprint: prepared.context.fingerprint,
            documents: [{path: "README.md", beforeHash: hashBytes("New rules\n"), afterHash: hashBytes("New rules\n")}],
            materialDispositions: prepared.items[0].materials.map((item) => ({id: item.id, status: "used", rationale: "Reassessed current context"}))};
        const result = {...f.options.result, expectedLockHash: prepared.expectedLockHash, inputContextFingerprint: prepared.context.fingerprint, entries: [entry], documentationChanges: lock.documentationChanges};
        for (const status of ["proposed", "declined"]) {
            const invalid = structuredClone(result); const change = invalid.documentationChanges[0];
            Object.assign(change, {status}); delete change.appliedOperationId; delete change.appliedAt; delete change.finalDocumentsReviewed;
            if (status === "declined") { change.userDecisionRef = "user:decline"; }
            invalid.entries[0].delivery = status === "proposed" ? "delivery_pending" : "declined";
            await expect(recordResult({...f.options, result: invalid})).rejects.toMatchObject({code: "REVISION_CONFLICT"});
            expect(fs.readFileSync(f.target)).toEqual(bytes);
        }
        const invalid = structuredClone(result); delete invalid.documentationChanges[0].appliedOperationId;
        await expect(recordResult({...f.options, result: invalid})).rejects.toMatchObject({code: "REVISION_CONFLICT"});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
        expect((await recordResult({...f.options, result})).changed).toBe(true);
        expect(JSON.parse(fs.readFileSync(f.target)).documentationChanges[0]).toEqual(lock.documentationChanges[0]);
    });
    it("protects the stored revision baseline even when a writer edits its working snapshot", async () => {
        const f = fixture(); individualProposal(f); await recordResult(f.options);
        const bytes = fs.readFileSync(f.target);
        await expect(withConsumerLock({cwd: f.root, repository: f.options.sources.repository}, ({current, commit}) => {
            current.documentationChanges[0].description = "Changed without incrementing the revision";
            return commit(current, {expectedLockHash: hashBytes(bytes)});
        })).rejects.toMatchObject({code: "REVISION_CONFLICT"});
        expect(fs.readFileSync(f.target)).toEqual(bytes);
        expect(fs.existsSync(`${f.target}.write-lock`)).toBe(false);
    });
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
        const f = fixture(); individualProposal(f); proposal(f, "delivery_pending", "new-doc.md");
        Object.assign(f.options.result.documentationChanges[0], f.entry.documents[0]);
        await recordResult(f.options); refreshPrepared(f);
        const intent = intentFor(f); await beginDelivery({...f.options, intent}); refreshPrepared(f);
        fs.writeFileSync(path.join(f.root, "new-doc.md"), "New rules\n");
        await confirmDelivery({...f.options, operationId: intent.operationId, finalDocumentsReviewed: true});
        const lockBytes = fs.readFileSync(f.target); const lock = JSON.parse(lockBytes);
        expect(lock.entries[0].contextFingerprint).not.toBe(f.options.prepared.context.fingerprint);
        expect((await confirmDelivery({...f.options, operationId: intent.operationId})).event).toBe("previously_confirmed");
        f.git(["add", "new-doc.md", "review-learning.lock.json"]); f.git(["commit", "-m", "apply docs and learning"]);
        expect(prepare({sources: f.options.sources, lock, lockBytes, cwd: f.root, cacheRoot: f.options.cacheRoot}).items[0].reasons).not.toContain("context_changed");
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
        expect(lock.entries[0].assessments[0].sources).toEqual([{id: "PR1", start: 0, end: 10, url: f.pr.html_url}]);
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
        expect(lock.entries[0].assessments[0].sources).toEqual([{...ref, url: comment.url}]);
        expect(lock.entries[0].sourceIds).not.toContain("COMMENT");
        fs.rmSync(f.options.cacheRoot, {recursive: true, force: true});
        refresh();
        expect(f.options.prepared.items[0].previous.assessments[0].sources).toEqual([{...ref, url: comment.url}]);
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
