import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

import {
    DraftError,
    buildDraftPath,
    buildSourceIdentity,
    parseDraftDocument,
    prepareResumeMetadata,
    validateDraftDocument,
    writeAtomicFile,
    writeSeparatedDraft,
} from "../../../.agents/skills/task-plan/scripts/draft.mjs";
import {
    applyBulkDecision,
    applyDecisionCommand,
    applyPackageDecision,
    applyPlanTransition,
    canApprovePlan,
    canTransition,
    getImpactedPackageIds,
    parseDecisionCommand,
    reopenPackage,
    validateDependencyGraph,
} from "../../../.agents/skills/task-plan/scripts/state.mjs";
import {
    compareSourceSnapshots,
    fetchGitHubIssue,
    normalizeFileSource,
    normalizeGitHubIssue,
    normalizeUserInput,
    refreshSource,
    resolveSafePath,
    SourceError,
} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {
    validateFinalApproval,
    validateFinding,
    validatePlanDocument,
    validatePlanState,
    validateReviewHistory,
    validateSimplification,
} from "../../../.agents/skills/task-plan/scripts/validate-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const MAIN_FIXTURE = fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/draft-main.md"), "utf8");
const DERIVED_FIXTURE = fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/draft-derived.md"), "utf8");
const DRAFT_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/draft.mjs");
const STATE_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/state.mjs");
const SOURCE_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/source.mjs");
const temporaryDirectories = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

describe("task-plan draft module", () => {
    it("builds stable paths and uses a task fallback for empty slugs", () => {
        expect(buildDraftPath({
            source_kind: "github-issue",
            issue: "123",
            title: "Zażółć gęślą jaźń!",
        })).toBe("docs/draft/issue-123-zazolc-gesla-jazn-plan.md");
        expect(buildDraftPath({
            source_kind: "user-input",
            title: "!!!",
        })).toBe("docs/draft/task-task-plan.md");
        expect(() => buildDraftPath({
            source_kind: "user-input",
            title: "x",
        }, {draftRoot: "../outside"})).toThrow(DraftError);
    });

    it("validates fixture documents and parses scalar front matter", () => {
        const parsed = parseDraftDocument(MAIN_FIXTURE);
        const result = validateDraftDocument(MAIN_FIXTURE, {kind: "main"});

        expect(parsed.metadata.source_kind).toBe("github-issue");
        expect(parsed.metadata.plan_version).toBe("1");
        expect(result.valid).toBe(true);
        expect(result.missingSections).toEqual([]);
    });

    it("enforces profile-specific draft invariants and validates the derived fixture", () => {
        const detailedWithoutHistory = MAIN_FIXTURE.replace("input_profile: brief-request", "input_profile: detailed-plan");
        expect(validateDraftDocument(detailedWithoutHistory, {kind: "main"}).valid).toBe(false);

        const detailed = `${detailedWithoutHistory}\n## Source plan\nOriginal plan\n## Review findings\nNone\n## Revised plan\nUpdated plan\n`;
        expect(validateDraftDocument(detailed, {kind: "main"}).valid).toBe(true);

        const titleOnly = MAIN_FIXTURE
            .replace("input_profile: brief-request", "input_profile: title-only")
            .replace("plan_status: awaiting-package-decisions", "plan_status: approved");
        expect(validateDraftDocument(titleOnly, {kind: "main"}).valid).toBe(false);
        expect(validateDraftDocument(DERIVED_FIXTURE, {kind: "derived"}).valid).toBe(true);
    });

    it("requires matching source identity when resuming and increments version", () => {
        const next = prepareResumeMetadata({
            source_kind: "github-issue",
            source_ref: "https://github.com/acme/demo/issues/123",
            issue: "123",
            title: "Original issue title",
            plan_version: "1",
            fetched_at: "2026-01-01T00:00:00Z",
            source_updated_at: "2026-01-01T00:00:00Z",
        }, {
            source_kind: "github-issue",
            source_ref: "https://github.com/acme/demo/issues/123",
            issue: "123",
            source_updated_at: "2026-01-02T00:00:00Z",
        }, {now: "2026-01-02T00:00:00Z"});

        expect(next.plan_version).toBe("2");
        expect(next.source_updated_at).toBe("2026-01-02T00:00:00Z");
        expectErrorCode(() => prepareResumeMetadata({
            ...next,
            plan_version: "2",
        }, {
            source_kind: "github-issue",
            source_ref: "https://github.com/acme/other/issues/123",
            issue: "123",
        }, {now: "2026-01-03T00:00:00Z"}), "SOURCE_IDENTITY_MISMATCH");
    });

    it("keeps the original target when an atomic write fails", () => {
        const directory = makeTemporaryDirectory();
        const target = path.join(directory, "draft.md");
        fs.writeFileSync(target, "original", "utf8");
        const failingFs = {
            mkdirSync: fs.mkdirSync,
            writeFileSync: () => { throw new Error("disk full"); },
            renameSync: fs.renameSync,
            unlinkSync: fs.unlinkSync,
        };

        expectErrorCode(() => writeAtomicFile(target, "new", {fsOps: failingFs}), "DRAFT_WRITE_FAILED");
        expect(fs.readFileSync(target, "utf8")).toBe("original");
    });

    it("leaves the parent pending when the derived or parent write fails", () => {
        const writes = [];
        const result = writeSeparatedDraft({
            derivedPath: "derived.md",
            derivedContent: "derived",
            parentPath: "parent.md",
            parentContent: "parent with link",
            writeFile: (filePath) => {
                writes.push(filePath);
                if (filePath === "parent.md") {
                    throw new Error("parent write failed");
                }
            },
        });

        expect(result).toEqual({
            ok: false,
            parent_written: false,
            derived_written: true,
            package_status: "pending",
            error: "parent write failed",
        });
        expect(writes).toEqual(["derived.md", "parent.md"]);
    });

    it("builds stable identities for GitHub and derived sources", () => {
        expect(buildSourceIdentity({
            source_kind: "github-issue",
            source_ref: "https://github.com/acme/demo/issues/123",
            issue: "123",
        })).toBe("acme/demo/123");
        expect(buildSourceIdentity({
            source_kind: "derived-work-package",
            parent_identity: "acme/demo/123",
            work_package_id: "WP2",
        })).toBe("acme/demo/123/wp/WP2");
    });
});

describe("task-plan state module", () => {
    it("accepts documented transitions and rejects implicit approval", () => {
        expect(canTransition("package", "pending", "accepted")).toBe(true);
        expect(canTransition("package", "accepted", "pending")).toBe(false);
        expect(canTransition("plan", "awaiting-package-decisions", "approved")).toBe(true);
        expect(canTransition("plan", "needs-clarification", "approved")).toBe(false);
        expectErrorCode(() => applyPlanTransition({...baseState()}, "approved", {
            reason: "all decisions complete",
            changed_at: "2026-01-02T00:00:00Z",
        }), "APPROVAL_GUARD_FAILED");
        expectErrorCode(() => applyPlanTransition({...baseState(), plan_status: "needs-clarification"}, "approved", {
            reason: "all decisions complete",
            changed_at: "2026-01-02T00:00:00Z",
        }), "INVALID_TRANSITION");
        expect(applyPlanTransition({...baseState(), plan_status: "approved"}, "awaiting-package-decisions", {
            reason: "user requested corrections",
            changed_at: "2026-01-02T00:00:00Z",
        }).plan_version).toBe(2);
    });

    it("parses only explicit decision commands", () => {
        expect(parseDecisionCommand("accept-all-pending")).toMatchObject({
            decision_status: "accepted",
            package_ids: null,
            scope: "pending",
        });
        expect(parseDecisionCommand("separate: WP2, WP3")).toMatchObject({
            decision_status: "separated",
            package_ids: ["WP2", "WP3"],
        });
        expectErrorCode(() => parseDecisionCommand("accept-all"), "INVALID_DECISION_COMMAND");
    });

    it("records explicit decisions and bulk-accepts pending packages only", () => {
        const state = baseState();
        const decided = applyPackageDecision(state, {
            package_id: "WP1",
            decision_status: "accepted",
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });
        const bulk = applyDecisionCommand(decided, "accept-all-pending", {
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });

        expect(decided.packages[0].decision_status).toBe("accepted");
        expect(bulk.packages.map(({decision_status: status}) => status)).toEqual(["accepted", "accepted"]);
        expect(bulk.decisions).toHaveLength(2);
        expectErrorCode(() => applyBulkDecision(state, "excluded", {
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        }), "INVALID_BULK_DECISION");
    });

    it("reopens terminal packages explicitly and computes dependent impact", () => {
        const state = baseState();
        const accepted = applyPackageDecision(state, {
            package_id: "WP1",
            decision_status: "accepted",
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });
        const reopened = reopenPackage(accepted, "WP1", {
            reason: "scope changed",
            decision_source: "user",
            decided_at: "2026-01-03T00:00:00Z",
        });

        expect(reopened.plan_version).toBe(2);
        expect(reopened.packages[0].decision_status).toBe("revision-requested");
        expect(getImpactedPackageIds(state.packages, "WP1")).toEqual(["WP1", "WP2"]);
        expect(() => validateDependencyGraph([
            {id: "WP1", dependencies: ["WP2"]},
            {id: "WP2", dependencies: ["WP1"]},
        ])).not.toThrow();
        expect(validateDependencyGraph([
            {id: "WP1", dependencies: ["WP2"]},
            {id: "WP2", dependencies: ["WP1"]},
        ]).valid).toBe(false);
    });

    it("approves only a complete, blocker-free plan", () => {
        const state = baseState();
        expect(canApprovePlan(state).approved).toBe(false);
        const accepted = applyDecisionCommand(state, "accept-all-pending", {
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });
        const ready = {
            ...accepted,
            plan_status: "awaiting-package-decisions",
            review_complete: true,
            review_history: [{iteration: 1, plan_version: 1}],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            blockers: [],
        };

        expect(canApprovePlan(ready)).toEqual({approved: true, reasons: []});
        expect(applyPlanTransition(ready, "approved", {
            reason: "user approved complete plan",
            changed_at: "2026-01-02T00:00:00Z",
        }).plan_status).toBe("approved");
    });

    it("blocks approval for unresolved questions, malformed blockers and inconsistent simplification", () => {
        expectErrorCode(() => applyPackageDecision({
            ...baseState(),
            packages: baseState().packages.map((item, index) => index === 0
                ? {...item, questions: [{blocking: true, resolved: false}]}
                : item),
        }, {
            package_id: "WP1",
            decision_status: "accepted",
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        }), "PACKAGE_QUESTIONS_BLOCKING");

        const accepted = applyDecisionCommand(baseState(), "accept-all-pending", {
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });
        const ready = {
            ...accepted,
            plan_status: "awaiting-package-decisions",
            review_complete: true,
            review_history: [{iteration: 1, plan_version: 1}],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            blockers: [],
        };

        expect(validateFinalApproval({
            ...ready,
            packages: ready.packages.map((item, index) => index === 0
                ? {...item, questions: [{blocking: true, resolved: false}]}
                : item),
        }).valid).toBe(false);
        expect(validateFinalApproval({...ready, blockers: "B1"}).valid).toBe(false);
        expect(validateFinalApproval({...ready, decisions: []}).valid).toBe(false);
        expect(validateFinalApproval({
            ...ready,
            simplification: {result: "pending"},
        }).valid).toBe(false);
    });
});

describe("task-plan source module", () => {
    it("normalizes title-only GitHub input without inventing content", () => {
        const source = normalizeGitHubIssue({
            owner: "acme",
            repo: "demo",
            number: 123,
            title: "Add support",
            body: "",
            comments: [],
            branch: "issue/123-add-support",
            base: "origin/main",
        }, {fetchedAt: "2026-01-01T00:00:00Z"});

        expect(source).toMatchObject({
            source_kind: "github-issue",
            source_ref: "https://github.com/acme/demo/issues/123",
            input_profile: "title-only",
            body: "",
            comments: [],
            fetched_at: "2026-01-01T00:00:00Z",
            branch: "issue/123-add-support",
            base_ref: "origin/main",
        });
    });

    it("reads files only inside the supplied repository root", () => {
        const directory = makeTemporaryDirectory();
        fs.writeFileSync(path.join(directory, "task.md"), "# Task\nBody", "utf8");

        const source = normalizeFileSource({
            filePath: "task.md",
            repoRoot: directory,
            options: {fetchedAt: "2026-01-01T00:00:00Z"},
        });
        expect(source).toMatchObject({
            source_kind: "file",
            source_ref: "task.md",
            title: "Task",
            input_profile: "brief-request",
        });
        expect(() => resolveSafePath("../outside.md", directory)).toThrow(SourceError);
    });

    it("normalizes user input and compares snapshots without refreshing implicitly", () => {
        const source = normalizeUserInput({title: "Goal", body: "Details", source_ref: "conversation-1"});
        expect(source).toMatchObject({source_kind: "user-input", source_ref: "conversation-1"});
        expect(normalizeUserInput({title: "Stable title"}).source_ref).toBe("stable-title");
        expect(compareSourceSnapshots(source, {...source, body: "Changed"})).toEqual({
            changed: true,
            changed_fields: ["body"],
        });
        expectErrorCode(() => refreshSource({currentSource: source, fetchSource: () => source}), "EXPLICIT_REFRESH_REQUIRED");
        expect(refreshSource({currentSource: source, fetchSource: () => ({...source, body: "Changed"}), explicit: true}).changed).toBe(true);
    });

    it("fetches GitHub data through an injected, resolver-compatible executor", () => {
        const source = fetchGitHubIssue({
            owner: "acme",
            repo: "demo",
            issueNumber: "123",
            repoRoot: ROOT,
            fetchedAt: "2026-01-01T00:00:00Z",
            resolveCommand: () => "gh",
            branch: "issue/123-add-support",
            base: "origin/main",
            execCommand: (command, args) => ({
                status: command === "gh" && args.includes("issue") ? 0 : 1,
                stdout: JSON.stringify({number: 123, title: "Add support", body: "", comments: []}),
                stderr: "",
            }),
        });

        expect(source).toMatchObject({
            source_kind: "github-issue",
            issue_number: "123",
            input_profile: "title-only",
            fetched_at: "2026-01-01T00:00:00Z",
            branch: "issue/123-add-support",
            base_ref: "origin/main",
        });
    });
});

describe("task-plan validation module", () => {
    it("validates findings and review limits", () => {
        expect(validateFinding({
            id: "F1",
            severity: "HIGH",
            claim: "claim",
            evidence: ["evidence"],
            evidence_ref: "source:1",
            impact: "impact",
            recommendation: "recommendation",
            status: "open",
        })).toEqual([]);
        expect(validateReviewHistory([
            {iteration: 1},
            {iteration: 2},
            {iteration: 3},
            {iteration: 4},
        ])).not.toEqual([]);
    });

    it("protects simplification invariants", () => {
        const before = {
            scope: ["A"],
            acceptance_criteria: ["C1"],
            user_decisions: ["D1"],
            required_evidence: ["E1"],
            risks: ["R1"],
        };
        expect(validateSimplification({
            result: "simplified",
            before,
            after: {...before, acceptance_criteria: ["C1", "C2"]},
        })).toEqual([]);
        expect(validateSimplification({
            result: "simplified",
            before,
            after: {...before, risks: []},
        })).toContain("Simplification removed relevant risks.");
    });

    it("validates the draft fixture and rejects an approved state with blockers", () => {
        expect(validatePlanDocument(MAIN_FIXTURE, {kind: "main"}).valid).toBe(true);
        expect(validatePlanState({
            plan_status: "needs-clarification",
            plan_version: 1,
            packages: [],
            findings: [],
            review_history: [],
            decisions: [],
            simplification: {result: "pending"},
        }).valid).toBe(true);
        const invalid = validatePlanState({...baseState(), plan_status: "approved", blockers: ["B1"]});
        expect(invalid.valid).toBe(false);
        expect(invalid.errors.join(" ")).toContain("approval guard");
        expect(validateFinalApproval(baseState()).valid).toBe(false);

        const approved = applyDecisionCommand(baseState(), "accept-all-pending", {
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });
        expect(validatePlanState({
            ...approved,
            plan_status: "approved",
            review_complete: true,
            review_history: [{iteration: 1, plan_version: 1}],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            blockers: [],
        }).valid).toBe(true);
    });
});

describe("task-plan CLI contract", () => {
    it("returns non-zero contract codes for invalid draft, state and source inputs", () => {
        const directory = makeTemporaryDirectory();
        const invalidDraft = path.join(directory, "invalid.md");
        fs.writeFileSync(invalidDraft, MAIN_FIXTURE
            .replace("input_profile: brief-request", "input_profile: title-only")
            .replace("plan_status: awaiting-package-decisions", "plan_status: approved"), "utf8");

        const draftResult = runCli(DRAFT_SCRIPT, ["validate", "--file", invalidDraft]);
        expect(draftResult.status).toBe(1);
        expect(JSON.parse(draftResult.stdout).valid).toBe(false);

        const stateResult = runCli(STATE_SCRIPT, ["parse-command", "--value", "accept-all"]);
        expect(stateResult.status).toBe(1);
        expect(JSON.parse(stateResult.stdout).code).toBe("INVALID_DECISION_COMMAND");

        const sourceResult = runCli(SOURCE_SCRIPT, ["normalize-file", "--root", ROOT, "--path", "../outside.md"]);
        expect(sourceResult.status).toBe(1);
        expect(JSON.parse(sourceResult.stdout).code).toBe("UNSAFE_SOURCE_PATH");

        const validStateResult = runCli(STATE_SCRIPT, [
            "transition",
            "--kind",
            "package",
            "--from",
            "pending",
            "--to",
            "accepted",
        ]);
        expect(validStateResult.status).toBe(0);
        expect(JSON.parse(validStateResult.stdout).valid).toBe(true);
    });
});

function baseState() {
    return {
        plan_status: "awaiting-package-decisions",
        plan_version: 1,
        packages: [
            {
                id: "WP1",
                goal: "Core",
                scope: "Core scope",
                dependencies: [],
                acceptance_criteria: ["C1"],
                risks: [],
                questions: [],
                decision_status: "pending",
            },
            {
                id: "WP2",
                goal: "Dependent",
                scope: "Dependent scope",
                dependencies: ["WP1"],
                acceptance_criteria: ["C2"],
                risks: [],
                questions: [],
                decision_status: "pending",
            },
        ],
        findings: [],
        review_history: [],
        simplification: {result: "no-change"},
        simplification_status: "no-change",
        blockers: [],
        review_complete: true,
        decisions: [],
    };
}

function makeTemporaryDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-"));
    temporaryDirectories.push(directory);
    return directory;
}

function runCli(script, args) {
    return spawnSync(process.execPath, [script, ...args], {
        cwd: ROOT,
        encoding: "utf8",
    });
}

function expectErrorCode(callback, code) {
    try {
        callback();
    } catch (error) {
        expect(error.code).toBe(code);
        return;
    }
    throw new Error(`Expected error code ${code}.`);
}
