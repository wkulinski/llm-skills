import {describe, expect, it} from "vitest";
import {SCHEMA_VERSION, RULES, SOURCE_FIELDS, canonicalJson, canonicalSources, fingerprint, sourceFingerprint, validateSources, validatePrepared, validateResult, validateLock, pendingReasons} from "../../../.agents/skills/gh-review-learn/scripts/contracts.mjs";

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
    const sources = {schemaVersion: SCHEMA_VERSION, kind: "sources", repository, rules: {...RULES}, read: {startedAt: "2026-11-19T00:00:00Z", finishedAt: "2026-11-19T00:01:00Z", targetSha: sha, completeness: "complete", gaps: []}, prs: [{id: "PR_1", number: 1, mergedAt: "2026-11-18T00:00:00Z", baseSha: sha, headSha: sha, mergeSha: sha}], sources: [source("S_1")]};
    const prepared = {schemaVersion: 1, kind: "prepared", repository, rules: {...RULES}, projectSha: sha, expectedLockHash: null, context: {fingerprint: digest, files: [{path: "docs/README.md", mode: "100644", hash: digest}], environmentScope: "Tracked configuration only; runtime unchecked"}, items: [{prId: "PR_1", sourceFingerprint: sourceFingerprint(sources.sources), sourceIds: ["S_1"], reasons: ["new"], materials: [{id: "M1", status: "missing", provenance: "Git object unavailable"}]}], totalPending: 1};
    const assessments = ["First.", "Second.", "Third."].map((quote, index) => ({id: `A${index}`, sources: [{id: "S_1", quote}], verification: verification(), historical: "fixed", currency: "existing_coverage", rationale: "Covered by current guide", verificationScope: "tracked docs; runtime unchecked", evidence: [{path: "docs/README.md", hash: digest}]}));
    const entry = {rules: {...RULES}, prId: "PR_1", sourceFingerprint: prepared.items[0].sourceFingerprint, projectSha: sha, contextFingerprint: digest, sourceCompleteness: "complete", analysis: "complete", delivery: "delivery_pending", assessments, dispositions: [{sourceId: "S_1", status: "assessed", rationale: "Three observations", assessmentIds: assessments.map((a) => a.id)}], documents: [{path: "docs/README.md", beforeHash: digest, afterHash: fingerprint("new content")}], sourceIds: ["S_1"]};
    const result = {schemaVersion: 1, kind: "result", repository, rules: {...RULES}, expectedLockHash: null, inputContextFingerprint: digest, entries: [entry]};
    const lock = {schemaVersion: 1, kind: "lock", repository, rules: {...RULES}, entries: [structuredClone(entry)]};
    return {sources, prepared, result, lock};
}
function throwsCode(fn, code) { expect(fn).toThrow(expect.objectContaining({code})); }

describe("gh-review-learn data contracts", () => {
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
        lock.schemaVersion = 2;
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
