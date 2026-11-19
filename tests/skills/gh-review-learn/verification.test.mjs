import {describe, expect, it} from "vitest";
import {createHash} from "node:crypto";
import {validateVerification, validateHistoryCoverage, verifyEvidenceBytes} from "../../../.agents/skills/gh-review-learn/scripts/verification.mjs";

const before = "a".repeat(40), after = "b".repeat(40), current = "c".repeat(40);
const hash = (v) => createHash("sha256").update(v).digest("hex");
const file = (sha) => ({kind: "git_file", sha, path: "src/rule.php", hash: hash(sha)});
function fixture() {
    const v = {original: {status: "verified", sourceId: "finding", sha: before, evidence: [file(before)], rationale: "Original code loses the operator date"}, response: {sourceIds: ["reply"], relation: "post_fix", appliesToSha: after}, correction: {status: "verified", fromSha: before, toSha: after, evidence: [{kind: "git_diff", fromSha: before, toSha: after, paths: ["src/rule.php"], hash: hash("patch")}, file(after)], rationale: "The correction retains the historical value"}, current: {status: "verified", sha: current, evidence: [{kind: "worktree_file", path: "docs/README.md", hash: hash("current docs")}], rationale: "Current documentation covers the rule"}};
    const a = {id: "A1", sources: [{id: "finding", start: 0, end: 6}], historical: "fixed", currency: "existing_coverage", verification: v};
    const sources = {sources: [{id: "finding", prId: "PR", kind: "review_comment", body: "Finding", originalCommitSha: before, commitSha: after}, {id: "reply", prId: "PR", kind: "issue_comment", body: "Fixed later"}]};
    return {a, v, sources, ids: new Set(["finding", "reply"])};
}
describe("review history verification", () => {
    it("keeps a finding valid in its original state despite a later corrective reply", () => {
        const {a, sources, ids} = fixture();
        validateVerification(a, ids, current);
        validateHistoryCoverage({prId: "PR", assessments: [a], dispositions: []}, {}, sources);
        expect(a.historical).toBe("fixed");
    });
    it("rejects using the updated inline comment SHA instead of its original SHA", () => {
        const {a, v, sources} = fixture(); v.original.sha = after; v.original.evidence = [file(after)];
        expect(() => validateHistoryCoverage({prId: "PR", assessments: [a], dispositions: []}, {}, sources)).toThrow(/later version/);
    });
    it("a reply cannot replace original evidence or a correction diff", () => {
        const {a, v, ids} = fixture();
        v.original.evidence = [{kind: "source", sourceId: "reply", hash: hash("Fixed later")}];
        expect(() => validateVerification(a, ids, current)).toThrow(/file from/);
        v.original.evidence = [file(before)]; v.correction.evidence = [file(after)];
        expect(() => validateVerification(a, ids, current)).toThrow(/before\/after diff/);
    });
    it("missing original evidence stays unresolved even if a newer version is correct", () => {
        const {a, v, ids} = fixture();
        v.original = {status: "unavailable", sourceId: "finding", sha: null, evidence: [], rationale: "Git object unavailable"};
        v.correction = {status: "unavailable", evidence: [], rationale: "Cannot compare with original"};
        expect(() => validateVerification(a, ids, current)).toThrow();
        a.historical = "unresolved"; validateVerification(a, ids, current);
    });
    it("rejecting a finding requires the reviewed state; accepted risk needs a scoped decision", () => {
        const {a, v, ids} = fixture(); a.historical = "accepted";
        v.correction = {status: "not_required", evidence: [], rationale: "Risk deliberately retained"};
        expect(() => validateVerification(a, ids, current)).toThrow(/decision/);
        v.decision = {sourceIds: ["reply"], scope: "Only this migration on known disposable test data"};
        validateVerification(a, ids, current);
        a.historical = "rejected"; v.original.status = "unavailable";
        expect(() => validateVerification(a, ids, current)).toThrow(/unverified/);
    });
    it("a later business decision does not silently redefine the historical contract", () => {
        const {a, v, ids} = fixture(); v.response.relation = "later_decision";
        validateVerification(a, ids, current);
        expect(v.original.sha).toBe(before); expect(v.correction.fromSha).toBe(before);
    });
    it("an unresolved or missing current proof remains visible", () => {
        const {a, v, ids} = fixture(); v.current = {status: "unavailable", evidence: [], rationale: "Ingress not inspected"};
        expect(() => validateVerification(a, ids, current)).toThrow(/Missing current proof/);
        a.currency = "no_evidence"; validateVerification(a, ids, current);
    });
    it("cannot replace an identified finding with no-learning on reanalysis", () => {
        const {sources} = fixture();
        expect(() => validateHistoryCoverage({prId: "PR", assessments: [], dispositions: []}, {previous: {assessments: [{id: "A1"}]}}, sources)).toThrow(/omitted/);
    });
    it("no-learning on a nonempty discussion requires inspection, unlike empty approvals", () => {
        const {sources} = fixture();
        const entry = {prId: "PR", analysis: "complete", assessments: [], dispositions: [{sourceId: "finding", status: "no_learning"}]};
        expect(() => validateHistoryCoverage(entry, {}, sources)).toThrow();
        entry.dispositions = [{sourceId: "empty", status: "no_learning"}];
        sources.sources.push({id: "empty", prId: "PR", kind: "review", body: ""});
        validateHistoryCoverage(entry, {}, sources);
    });
    it("rejects an empty correction diff and changing the source of a prior finding", () => {
        const {a, sources} = fixture();
        const entry = {prId: "PR", assessments: [a], dispositions: []};
        expect(() => validateHistoryCoverage(entry, {previous: {assessments: [{id: "A1", sources: [{id: "reply"}]}]}}, sources)).toThrow(/lost its source/);
        expect(() => verifyEvidenceBytes(entry, sources, {git: (args) => Buffer.from(args[0] === "show" ? args[1].split(":")[0] : ""), readWorktree: () => hash("current docs")})).toThrow(/diff is empty/);
    });
    it("checks actual original, diff, resulting file and current bytes", () => {
        const {a, sources} = fixture();
        const ops = {git: (args) => args[0] === "show" ? Buffer.from(args[1].split(":")[0]) : Buffer.from("patch"), readWorktree: () => hash("current docs")};
        verifyEvidenceBytes({assessments: [a], dispositions: []}, sources, ops);
        expect(() => verifyEvidenceBytes({assessments: [a], dispositions: []}, sources, {...ops, git: () => Buffer.from("wrong")})).toThrow(/bytes differ/);
        expect(() => verifyEvidenceBytes({assessments: [a], dispositions: []}, sources, {...ops, git: () => { throw new Error("missing object"); }})).toThrow(/Cannot read/);
    });
});
