import {describe, expect, it} from "vitest";
import {SOURCE_SCHEMA_VERSION, RULES, SOURCE_FIELDS, canonicalJson, canonicalSources, fingerprint, sourceFingerprint, validateSources, validatePrepared, validateResult, validateLock, pendingReasons, upgradeLock, deliveryState, validateChangeRevisions} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";

const sha = "a".repeat(40);
const digest = fingerprint("context");
const repository = {id: "R_1", name: "example/project", branch: "main"};
function source(id, overrides = {}) {
    return {...Object.fromEntries(SOURCE_FIELDS.map((key) => [key, null])), id, kind: "review", prId: "PR_1", body: "First. Second. Third.", url: "https://example.test/review/1", createdAt: "2026-11-19T00:00:00Z", author: {id: "U_1", login: "reviewer"}, reviewState: "DISMISSED", commitSha: sha, ...overrides};
}
function verification() {
    const before = "b".repeat(40);
    return {original: {status: "verified", sourceId: "S_1", sha, evidence: [{kind: "git_file", sha, path: "rule.mjs", hash: digest}], rationale: "Reviewed exact version"}, response: {sourceIds: [], relation: "none", appliesToSha: null}, correction: {status: "verified", fromSha: sha, toSha: before, evidence: [{kind: "git_diff", fromSha: sha, toSha: before, paths: ["rule.mjs"], hash: digest}, {kind: "git_file", sha: before, path: "rule.mjs", hash: digest}], rationale: "Compared correction"}, current: {status: "verified", sha, evidence: [{kind: "worktree_file", path: "docs/README.md", hash: digest}], rationale: "Read current documentation"}};
}
function fixture() {
    const sources = {schemaVersion: SOURCE_SCHEMA_VERSION, kind: "sources", repository, rules: {...RULES}, read: {startedAt: "2026-11-19T00:00:00Z", finishedAt: "2026-11-19T00:01:00Z", targetSha: sha, completeness: "complete", gaps: []}, prs: [{id: "PR_1", number: 1, mergedAt: "2026-11-18T00:00:00Z", baseSha: sha, headSha: sha, mergeSha: sha}], sources: [source("S_1")]};
    const prepared = {schemaVersion: 1, kind: "prepared", repository, rules: {...RULES}, projectSha: sha, expectedLockHash: null, context: {fingerprint: digest, files: [{path: "docs/README.md", mode: "100644", hash: digest}], environmentScope: "Tracked configuration only; runtime unchecked"}, items: [{prId: "PR_1", sourceFingerprint: sourceFingerprint(sources.sources), sourceIds: ["S_1"], reasons: ["new"], materials: [{id: "M1", status: "missing", provenance: "Git object unavailable"}]}], totalPending: 1};
    const assessments = ["First.", "Second.", "Third."].map((quote, index) => ({id: `A${index}`, sources: [{id: "S_1", quote}], verification: verification(), historical: "fixed", currency: "existing_coverage", rationale: "Covered by current guide", verificationScope: "tracked docs; runtime unchecked", evidence: [{path: "docs/README.md", hash: digest}]}));
    const entry = {rules: {...RULES}, prId: "PR_1", sourceFingerprint: prepared.items[0].sourceFingerprint, projectSha: sha, contextFingerprint: digest, sourceCompleteness: "complete", analysis: "complete", delivery: "delivery_pending", assessments, dispositions: [{sourceId: "S_1", status: "assessed", rationale: "Three observations", assessmentIds: assessments.map((a) => a.id)}], documents: [{path: "docs/README.md", beforeHash: digest, afterHash: fingerprint("new content")}], sourceIds: ["S_1"]};
    const result = {schemaVersion: 1, kind: "result", repository, rules: {...RULES}, expectedLockHash: null, inputContextFingerprint: digest, entries: [entry]};
    const lock = {schemaVersion: 1, kind: "lock", repository, rules: {...RULES}, entries: [structuredClone(entry)]};
    return {sources, prepared, result, lock};
}
function throwsCode(fn, code) { expect(fn).toThrow(expect.objectContaining({code})); }
function proposalLock() {
    const lock = upgradeLock(fixture().lock);
    const first = lock.entries[0];
    delete first.historicalDocumentation;
    first.documentationChangeIds = ["C1"];
    const second = structuredClone(first); second.prId = "PR_2";
    lock.entries.push(second);
    lock.documentationChanges = [{id: "C1", revision: 1, path: "docs/README.md", section: "Verification", description: "Read the resulting bytes", rationale: "Two reviews exposed the same omission", beforeHash: digest, afterHash: fingerprint("new content"), status: "proposed", references: [{prId: first.prId, assessmentId: "A0"}, {prId: second.prId, assessmentId: "A1"}]}];
    return lock;
}

describe("gh-review-learn data contracts", () => {
    it("stores a shared proposal once and requires reciprocal, known assessment links", () => {
        const lock = proposalLock();
        expect(validateLock(lock)).toBe(lock);
        expect(lock.documentationChanges).toHaveLength(1);
        for (const mutate of [
            (value) => { value.documentationChanges[0].references[1].assessmentId = "missing"; },
            (value) => { value.documentationChanges[0].references[1].prId = "missing"; },
            (value) => { value.entries[1].documentationChangeIds = []; },
            (value) => { value.documentationChanges[0].references.pop(); },
        ]) {
            const invalid = structuredClone(lock); mutate(invalid);
            throwsCode(() => validateLock(invalid), "UNKNOWN_REFERENCE");
        }
        lock.documentationChanges.push(structuredClone(lock.documentationChanges[0]));
        throwsCode(() => validateLock(lock), "DUPLICATE_ID");
    });
    it("derives PR delivery from every proposal and retains individual decisions", () => {
        const lock = proposalLock();
        const applied = lock.documentationChanges[0];
        applied.status = "applied"; applied.finalDocumentsReviewed = true;
        const pending = {...structuredClone(applied), id: "C2", status: "proposed"}; delete pending.finalDocumentsReviewed;
        lock.documentationChanges.push(pending);
        for (const entry of lock.entries) { entry.documentationChangeIds.push("C2"); }
        validateLock(lock);
        expect(deliveryState(lock.documentationChanges)).toBe("delivery_pending");
        lock.entries[0].delivery = "applied"; lock.entries[0].finalDocumentsReviewed = true;
        throwsCode(() => validateLock(lock), "INVALID_STATE");
        expect(deliveryState([])).toBe("not_required");
        expect(deliveryState([applied])).toBe("applied");
        for (const change of lock.documentationChanges) { change.status = "declined"; delete change.finalDocumentsReviewed; }
        for (const entry of lock.entries) { entry.delivery = "declined"; }
        expect(() => validateLock(lock)).toThrow();
        for (const change of lock.documentationChanges) { change.userDecisionRef = "user-message:decline-selection"; }
        validateLock(lock);
        expect(deliveryState(lock.documentationChanges)).toBe("declined");
    });
    it("preserves completed decisions and their provenance at the same revision", () => {
        for (const decision of [{status: "applied", finalDocumentsReviewed: true, appliedOperationId: "op1", appliedAt: "2026-11-20T00:00:00Z"}, {status: "declined", userDecisionRef: "user:decline"}]) {
            const original = [{...proposalLock().documentationChanges[0], ...decision}];
            expect(() => validateChangeRevisions(original, structuredClone(original))).not.toThrow();
            for (const status of ["proposed", "applied", "declined"].filter((candidate) => candidate !== decision.status)) {
                throwsCode(() => validateChangeRevisions(original, [{...original[0], status}]), "REVISION_CONFLICT");
            }
            for (const key of Object.keys(decision).filter((field) => field !== "status")) {
                const next = structuredClone(original); delete next[0][key];
                throwsCode(() => validateChangeRevisions(original, next), "REVISION_CONFLICT");
            }
            const revised = {...original[0], description: "Updated content", revision: 2, status: "proposed"};
            for (const key of ["finalDocumentsReviewed", "appliedOperationId", "appliedAt", "userDecisionRef"]) { delete revised[key]; }
            expect(() => validateChangeRevisions(original, [revised])).not.toThrow();
        }
    });
    it("requires a new proposed revision after target content changes", () => {
        const original = proposalLock().documentationChanges;
        original[0].status = "applied"; original[0].finalDocumentsReviewed = true;
        const next = structuredClone(original); next[0].afterHash = fingerprint("different content");
        throwsCode(() => validateChangeRevisions(original, next), "REVISION_CONFLICT");
        next[0].revision += 1;
        throwsCode(() => validateChangeRevisions(original, next), "REVISION_CONFLICT");
        next[0].status = "proposed"; delete next[0].finalDocumentsReviewed;
        expect(() => validateChangeRevisions(original, next)).not.toThrow();
        throwsCode(() => validateChangeRevisions(original, []), "CHANGE_CONFLICT");
        const onlyRevision = structuredClone(original); onlyRevision[0].revision += 1;
        throwsCode(() => validateChangeRevisions(original, onlyRevision), "REVISION_CONFLICT");
    });
    it("upgrades V1 on an explicit write without resetting assessments or analysis rules", () => {
        const {lock} = fixture();
        const bytes = JSON.stringify(lock);
        validateLock(lock);
        const upgraded = upgradeLock(lock);
        expect(JSON.stringify(lock)).toBe(bytes);
        expect(upgraded.entries[0]).toMatchObject(lock.entries[0]);
        expect(upgraded.entries[0].historicalDocumentation).toEqual({schemaVersion: 1, details: "unavailable"});
        expect(upgraded.documentationChanges).toEqual([]);
        expect(upgraded.rules).toEqual(lock.rules);
        expect(pendingReasons(upgraded.entries[0], {sourceFingerprint: lock.entries[0].sourceFingerprint, contextFingerprint: digest, rules: RULES})).toEqual(["delivery_pending"]);
        validateLock(upgraded);
    });
    it.each(["applied", "declined", "not_required"])("retains historical %s delivery without manufacturing individual proposals", (delivery) => {
        const {lock} = fixture();
        lock.entries[0].delivery = delivery;
        if (delivery === "applied") { lock.entries[0].finalDocumentsReviewed = true; }
        if (delivery === "declined") { lock.entries[0].userDecisionRef = "user-message:old-decision"; }
        if (delivery === "not_required") { lock.entries[0].documents = []; }
        const copy = structuredClone(lock);
        const next = upgradeLock(lock);
        expect(next.entries[0]).toMatchObject(copy.entries[0]);
        expect(next.documentationChanges).toEqual([]);
        expect(lock).toEqual(copy);
        validateLock(next);
    });
    it("keeps the source schema at V1 while V2 result validates all canonical references", () => {
        const {sources, prepared, result} = fixture();
        result.schemaVersion = 2;
        result.entries[0].documentationChangeIds = ["C1"];
        const change = proposalLock().documentationChanges[0];
        result.documentationChanges = [{...change, references: [change.references[0]]}];
        validateResult(result, prepared, sources);
        result.documentationChanges[0].references[0].assessmentId = "unknown";
        throwsCode(() => validateResult(result, prepared, sources), "UNKNOWN_REFERENCE");
        sources.schemaVersion = 2;
        throwsCode(() => validateSources(sources), "UNSUPPORTED_SCHEMA");
    });
    it("validates active batch, delivery intent and a compact receipt independently", () => {
        const lock = proposalLock();
        lock.activeBatch = {id: "batch-1", limit: 20, prIds: ["PR_1", "PR_2"], scopeFingerprint: digest, boundary: "2026-11-19T00:00:00Z", selectedAt: "2026-11-19T00:01:00Z"};
        lock.activeDelivery = {operationId: "operation-1", userDecisionRef: "user-message:42", changes: [{id: "C1", revision: 1}], documents: lock.entries[0].documents, startedAt: "2026-11-19T01:00:00Z", inputContext: fixture().prepared.context, sourceFingerprints: lock.entries.map((entry) => ({prId: entry.prId, sourceFingerprint: entry.sourceFingerprint}))};
        validateLock(lock);
        lock.activeDelivery.changes[0].revision = 2;
        throwsCode(() => validateLock(lock), "UNKNOWN_REFERENCE");
        lock.activeDelivery = null;
        lock.lastDelivery = {operationId: "past-operation", userDecisionRef: "user-message:40", changes: [{id: "C1", revision: 1}], documents: lock.entries[0].documents, confirmedAt: "2026-11-19T00:01:00Z", contextFingerprint: digest};
        lock.documentationChanges[0].revision = 2;
        validateLock(lock); // Past receipt does not apply the new revision.
        lock.activeBatch.prIds.push("PR_1");
        throwsCode(() => validateLock(lock), "DUPLICATE_ID");
    });
    it("uses canonical fields and ID ordering independent of pages and transport metadata", () => {
        const a = source("S_2", {replyToId: "S_1", kind: "review_comment"});
        const b = source("S_1");
        expect(canonicalJson(canonicalSources([a, b]))).toBe(canonicalJson(canonicalSources([b, a])));
        expect(sourceFingerprint([a, b])).toBe(sourceFingerprint([{...b, fetchedAt: "later", etag: "changed", author: {...b.author, avatar: "ignored"}}, a]));
        expect(fingerprint({b: 1, a: 2})).toBe(fingerprint({a: 2, b: 1}));
        expect(() => canonicalJson({a: new Map().get("absent")})).toThrow();
    });
    it.each([["body", "Edited"], ["replyToId", "S_other"], ["reviewState", "APPROVED"], ["threadResolved", true], ["updatedAt", "2026-11-20"], ["path", "other.mjs"], ["commitSha", "b".repeat(40)], ["author", {id: "U2", login: "other"}]])("fingerprints semantic source changes: %s", (key, value) => {
        expect(sourceFingerprint([source("S1")])).not.toBe(sourceFingerprint([source("S1", {[key]: value})]));
    });
    it("accepts three observations of one dismissed summary and detects omissions", () => {
        const {sources, prepared, result} = fixture();
        expect(validateSources(sources)).toBe(sources);
        expect(validatePrepared(prepared, sources)).toBe(prepared);
        expect(validateResult(result, prepared, sources)).toBe(result);
        result.entries[0].dispositions = [];
        throwsCode(() => validateResult(result, prepared, sources), "INCOMPLETE_COVERAGE");
    });
    it("rejects foreign and unrelated source references", () => {
        const {sources, prepared, result} = fixture();
        result.entries[0].assessments[0].sources[0].id = "missing";
        throwsCode(() => validateResult(result, prepared, sources), "UNKNOWN_REFERENCE");
        sources.sources.push(source("S2", {replyToId: "missing"}));
        throwsCode(() => validateSources(sources), "UNKNOWN_REFERENCE");
    });
    it("preserves delivery work after analysis, without cached proposal text", () => {
        const {lock} = fixture();
        validateLock(lock, repository);
        const serialized = JSON.parse(JSON.stringify(lock));
        const current = {sourceFingerprint: serialized.entries[0].sourceFingerprint, contextFingerprint: digest, rules: RULES};
        expect(pendingReasons(serialized.entries[0], current, RULES)).toEqual(["delivery_pending"]);
        serialized.entries[0].delivery = "not_required";
        expect(pendingReasons(serialized.entries[0], current, RULES)).toEqual([]);
        const before = JSON.stringify(serialized);
        expect(pendingReasons(serialized.entries[0], {...current, contextFingerprint: fingerprint("changed")}, RULES)).toEqual(["context_changed"]);
        expect(JSON.stringify(serialized)).toBe(before);
        expect(pendingReasons(serialized.entries[0], {...current, rules: {...RULES, analysis: RULES.analysis + 1}}, RULES)).toEqual(["rules_changed"]);
    });
    it("retains missing evidence and unresolved work", () => {
        const {lock} = fixture();
        const entry = lock.entries[0];
        entry.analysis = "needs_decision";
        entry.assessments[0].historical = "unresolved";
        entry.assessments[0].currency = "no_evidence";
        entry.dispositions[0].status = "unresolved";
        expect(validateLock(lock)).toBe(lock);
        expect(entry.sourceIds).toEqual(["S_1"]);
        entry.analysis = "complete";
        throwsCode(() => validateLock(lock), "INVALID_STATE");
    });
    it("reports schema and repository conflicts without mutation", () => {
        const {lock} = fixture();
        const before = JSON.stringify(lock);
        for (const field of ["id", "name", "branch"]) {
            throwsCode(() => validateLock(lock, {...repository, [field]: "other"}), "REPOSITORY_CONFLICT");
        }
        expect(JSON.stringify(lock)).toBe(before);
        lock.schemaVersion = 99;
        throwsCode(() => validateLock(lock), "UNSUPPORTED_SCHEMA");
    });
    it("requires decision references, final document review and safe relative paths", () => {
        const {lock} = fixture();
        lock.entries[0].delivery = "declined";
        expect(() => validateLock(lock)).toThrow();
        lock.entries[0].userDecisionRef = "user-message:42";
        validateLock(lock);
        lock.entries[0].delivery = "applied";
        throwsCode(() => validateLock(lock), "INVALID_STATE");
        lock.entries[0].finalDocumentsReviewed = true;
        validateLock(lock);
        for (const path of ["../AGENTS.md", "/tmp/doc", "docs/../doc", "C:/doc", "docs\\doc", ".git/config"]) {
            lock.entries[0].documents[0].path = path;
            throwsCode(() => validateLock(lock), "INVALID_PATH");
        }
    });
    it("keeps rule versions per PR and rejects mixed rule inputs", () => {
        const {sources, prepared, result, lock} = fixture();
        lock.rules.analysis = RULES.analysis + 1;
        expect(validateLock(lock)).toBe(lock);
        expect(pendingReasons(lock.entries[0], {sourceFingerprint: lock.entries[0].sourceFingerprint, contextFingerprint: digest, rules: lock.rules})).toContain("rules_changed");
        prepared.rules.analysis = RULES.analysis + 1;
        throwsCode(() => validatePrepared(prepared, sources), "RULES_CONFLICT");
        prepared.rules.analysis = RULES.analysis;
        result.entries[0].rules.analysis = RULES.analysis + 1;
        throwsCode(() => validateResult(result, prepared, sources), "RULES_CONFLICT");
    });
    it.each([1, 2])("reads analysis %i assessments and queues them under new rules without altering evidence", (version) => {
        const {lock} = fixture();
        lock.rules.analysis = version;
        lock.entries[0].rules.analysis = version;
        if (version === 1) { for (const a of lock.entries[0].assessments) { delete a.verification; } }
        const before = canonicalJson(lock);
        validateLock(lock);
        expect(pendingReasons(lock.entries[0], {sourceFingerprint: lock.entries[0].sourceFingerprint, contextFingerprint: digest, rules: RULES})).toContain("rules_changed");
        expect(canonicalJson(lock)).toBe(before);
    });
    it("rejects mixed snapshots and false completeness", () => {
        const {sources, prepared, result} = fixture();
        result.expectedLockHash = digest;
        throwsCode(() => validateResult(result, prepared, sources), "LOCK_CONFLICT");
        result.expectedLockHash = null;
        result.inputContextFingerprint = fingerprint("stale");
        throwsCode(() => validateResult(result, prepared, sources), "CONTEXT_CONFLICT");
        sources.read.gaps = ["thread pagination failed"];
        throwsCode(() => validateSources(sources), "INCOMPLETE_READ");
    });
});
