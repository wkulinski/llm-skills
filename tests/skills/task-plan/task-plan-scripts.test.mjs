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
    createInitialDraft,
    parseDraftDocument,
    prepareResumeMetadata,
    renderSessionStrategySection,
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
    canOpenPackageDecisions,
    canTransition,
    getImpactedPackageIds,
    parseDecisionCommand,
    reopenPackage,
    validateDependencyGraph,
    validateOwnershipRedundancyReview,
    validateSessionStrategy,
    validateUserDecisionRecords,
    validateQuestionDecisionPropagation,
    applyQuestionDecision,
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
const OWNERSHIP_FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/ownership-redundancy-scenarios.json"), "utf8"));
const OWNERSHIP_SCENARIOS = OWNERSHIP_FIXTURE.scenarios;
const OWNERSHIP_STATE_SCENARIOS = OWNERSHIP_FIXTURE.state_scenarios;
const OWNERSHIP_NEGATIVE_SCENARIOS = OWNERSHIP_FIXTURE.negative_scenarios;
const OWNERSHIP_SCENARIO_INDEX = new Map([
    ...OWNERSHIP_SCENARIOS,
    ...OWNERSHIP_STATE_SCENARIOS,
].map((scenario) => [scenario.id, scenario]));
const DRAFT_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/draft.mjs");
const STATE_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/state.mjs");
const SOURCE_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/source.mjs");
const VALIDATE_PLAN_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/validate-plan.mjs");
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
        })).toBe("docs/draft/issue-123-plan.md");
        expect(buildDraftPath({
            source_kind: "user-input",
            title: "!!!",
        })).toBe("docs/draft/task-task-plan.md");
        expect(buildDraftPath({
            source_kind: "file",
            source_ref: "docs/task.md",
        })).toBe("docs/draft/task-file-docstaskmd-plan.md");
        expect(buildDraftPath({
            source_kind: "github-issue",
            issue: "123",
            title: "A different fetched title",
        })).toBe(buildDraftPath({
            source_kind: "github-issue",
            issue: "123",
            title: "Original title",
        }));
        expect(() => buildDraftPath({
            source_kind: "user-input",
            title: "x",
        }, {draftRoot: "../outside"})).toThrow(DraftError);
    });

    it("creates a valid initial draft before source details are fetched", () => {
        const directory = makeTemporaryDirectory();
        let sourceRead = false;
        const result = createInitialDraft({
            source: {
                source_kind: "github-issue",
                owner: "acme",
                repo: "demo",
                issue_number: "123",
            },
            now: "2026-01-01T00:00:00Z",
            rootDir: directory,
            writeFile: (target, content, options) => {
                expect(sourceRead).toBe(false);
                fs.mkdirSync(path.dirname(target), {recursive: true});
                fs.writeFileSync(target, content, "utf8");
                return {path: target, written: true, options};
            },
        });
        sourceRead = true;

        expect(result.path).toBe("docs/draft/issue-123-plan.md");
        expect(fs.existsSync(path.join(directory, result.path))).toBe(true);
        expect(validateDraftDocument(result.content, {kind: "main"}).valid).toBe(true);
        expect(parseDraftDocument(result.content).metadata.title).toBe("Pending title");
    });

    it("keeps the initial draft after source failure and resumes the same path", () => {
        const directory = makeTemporaryDirectory();
        const initial = createInitialDraft({
            source: {source_kind: "github-issue", owner: "acme", repo: "demo", issue_number: "123"},
            now: "2026-01-01T00:00:00Z",
            rootDir: directory,
        });

        expect(() => fetchGitHubIssue({
            owner: "acme",
            repo: "demo",
            issueNumber: "123",
            resolveCommand: () => "gh",
            execCommand: () => ({status: 1, stderr: "network unavailable"}),
        })).toThrow(SourceError);

        const draftPath = path.join(directory, initial.path);
        const savedDraft = fs.readFileSync(draftPath, "utf8");
        expect(validateDraftDocument(savedDraft, {kind: "main"}).valid).toBe(true);
        const resumed = prepareResumeMetadata(
            parseDraftDocument(savedDraft).metadata,
            {
                source_kind: "github-issue",
                source_ref: "https://github.com/acme/demo/issues/123",
                issue_number: "123",
                title: "Fetched title",
                source_updated_at: "2026-01-02T00:00:00Z",
            },
            {now: "2026-01-02T00:00:00Z"},
        );
        expect(resumed.plan_version).toBe("2");
        expect(buildDraftPath(resumed)).toBe(initial.path);
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
            .replace("plan_status: review-pending", "plan_status: approved");
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

    it("validates staged session strategy with explicit package grouping", () => {
        const strategy = {
            mode: "staged",
            rationale: "Separate review from implementation.",
            stages: [{
                id: "S1",
                title: "Core contract",
                rationale: "Stabilize the shared contract first.",
                work_package_ids: ["WP1"],
                dependencies: [],
                session_boundary: "separate-session",
                entry_criteria: ["Source assessed."],
                exit_criteria: ["WP1 contract accepted."],
            }],
            session_boundary_recommendation: "Start WP2 in a new session.",
            dependencies: ["WP1 before WP2"],
            entry_criteria: ["Intent confirmed."],
            exit_criteria: ["All stages have terminal decisions."],
        };
        expect(validateSessionStrategy(strategy)).toEqual([]);
        expect(renderSessionStrategySection(strategy)).toContain("Stabilize the shared contract first.");
        expect(renderSessionStrategySection(strategy)).toContain("zależności: none");
        expect(validateSessionStrategy({...strategy, mode: "unsupported"})).toContain("session_strategy.mode is invalid.");
        expect(validateSessionStrategy({...strategy, stages: [{...strategy.stages[0], entry_criteria: []}]})).toContain(
            "session_strategy.stages[0].entry_criteria must be a non-empty array.",
        );
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
        expect(applyPlanTransition({...baseState(), plan_status: "approved"}, "review-pending", {
            reason: "user requested corrections",
            changed_at: "2026-01-02T00:00:00Z",
        }).plan_version).toBe(2);
    });

    it("requires the review and simplification gate before package decisions", () => {
        const incomplete = {
            ...baseState(),
            plan_status: "review-pending",
            review_complete: false,
            critical_review_complete: false,
            review_history: [],
            simplification_status: "pending",
            simplification: {result: "pending"},
            simplification_control_review_complete: false,
        };

        expect(canOpenPackageDecisions(incomplete).ready).toBe(false);
        expect(canTransition("plan", "review-pending", "awaiting-package-decisions", incomplete)).toBe(false);
        expectErrorCode(() => applyPlanTransition(incomplete, "awaiting-package-decisions", {
            reason: "premature package decision request",
            changed_at: "2026-01-02T00:00:00Z",
        }), "PACKAGE_DECISION_GATE_FAILED");
        expect(validatePlanState({...incomplete, plan_status: "awaiting-package-decisions"}).valid).toBe(false);

        const ready = {
            ...baseState(),
            plan_status: "review-pending",
        };
        expect(canOpenPackageDecisions(ready)).toEqual({ready: true, reasons: []});
        const withoutStrategy = {...ready};
        delete withoutStrategy.session_strategy;
        expect(canOpenPackageDecisions(withoutStrategy).reasons).toContain("invalid_session_strategy");
        expect(canTransition("plan", "review-pending", "awaiting-package-decisions", ready)).toBe(true);
        expect(applyPlanTransition(ready, "awaiting-package-decisions", {
            reason: "critical review and simplification complete",
            changed_at: "2026-01-02T00:00:00Z",
        }).plan_status).toBe("awaiting-package-decisions");

        const scopeBlocked = {
            ...ready,
            scope_questions: [{
                id: "SQ1",
                prompt: "Czy zakres obejmuje migrację?",
                blocking: false,
                resolved: false,
                impact: "Zmienia zakres pakietów.",
                decision_needed: "Potwierdzić zakres.",
            }],
        };
        expect(canOpenPackageDecisions(scopeBlocked).reasons).toContain("unresolved_scope_questions");
    });

    it("blocks and opens package decisions around the ownership review", () => {
        const source = OWNERSHIP_SCENARIOS.find(({id}) => id === "field-local-justified");
        const pending = {
            ...baseState(),
            plan_version: 3,
            ownership_redundancy_review: {
                ...source.review,
                status: "pending",
            },
        };
        const complete = {
            ...baseState(),
            plan_version: 3,
            ownership_redundancy_review: source.review,
        };

        expect(canOpenPackageDecisions(pending).reasons).toContain("ownership_redundancy_review_incomplete");
        expect(canOpenPackageDecisions(complete)).toEqual({ready: true, reasons: []});
    });

    it("blocks package decisions when a complete review has an open finding", () => {
        const source = OWNERSHIP_SCENARIOS.find(({id}) => id === "object-local-redundant");
        const findings = structuredClone(source.findings);
        findings[0].status = "open";

        const blocked = {
            ...baseState(),
            plan_version: 3,
            findings,
            ownership_redundancy_review: source.review,
        };

        expect(canOpenPackageDecisions(blocked).reasons).toContain("ownership_redundancy_review_invalid");
    });

    it("covers explicit pending and not-required state fixtures", () => {
        for (const scenario of OWNERSHIP_STATE_SCENARIOS) {
            const reviewErrors = validateOwnershipRedundancyReview(scenario.review, scenario.findings);
            const state = {
                ...baseState(),
                plan_version: 3,
                findings: scenario.findings,
                ownership_redundancy_review: scenario.review,
            };
            const gate = canOpenPackageDecisions(state);

            expect(reviewErrors.length === 0, scenario.id).toBe(scenario.expected.review_valid);
            expect(gate.ready, scenario.id).toBe(scenario.expected.gate_ready);
            if (scenario.expected.gate_reason) {
                expect(gate.reasons, scenario.id).toContain(scenario.expected.gate_reason);
            }
        }
    });

    it("blocks the gate when the ownership review record is missing", () => {
        const state = {...baseState(), plan_version: 3};
        delete state.ownership_redundancy_review;

        expect(canOpenPackageDecisions(state).reasons).toContain("ownership_redundancy_review_invalid");
    });

    it("keeps ownership validation side-effect free of workflow transitions", () => {
        const source = OWNERSHIP_SCENARIOS.find(({id}) => id === "field-local-justified");
        const state = {
            ...baseState(),
            plan_version: 3,
            ownership_redundancy_review: source.review,
        };
        const before = structuredClone(state);

        expect(validatePlanState(state).valid).toBe(true);
        expect(state).toEqual(before);
        expect(state.plan_status).toBe("awaiting-package-decisions");
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

    it("records and validates propagation of a user answer", () => {
        const state = {
            ...baseState(),
            packages: [{
                ...baseState().packages[0],
                questions: [{
                    id: "WP1-Q1",
                    prompt: "Który kontrakt obowiązuje?",
                    context: "Decyzja zmienia kryteria WP1.",
                    blocking: true,
                    resolved: false,
                    impact: "Wpływa na API.",
                    decision_needed: "Wybrać kontrakt.",
                    options: [
                        {id: "existing", label: "Istniejący", consequence: "Mniejszy zakres i ryzyko migracji."},
                        {id: "new", label: "Nowy", consequence: "Większy zakres, ale spójniejszy kontrakt."},
                    ],
                }],
            }],
        };
        const pending = applyQuestionDecision(state, {
            question_id: "WP1-Q1",
            decision_ref: "D1",
            selected_option: "existing",
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
            affected_refs: ["WP1.scope", "WP1.acceptance_criteria"],
            propagation_status: "propagated",
        });

        expect(pending.user_decisions[0].propagation_status).toBe("pending");
        expect(validateQuestionDecisionPropagation(pending)).toContain("user_decisions propagation incomplete for D1.");
        expect(canOpenPackageDecisions(pending).reasons).toContain("question_decision_propagation_incomplete");
        const propagated = structuredClone(pending);
        propagated.user_decisions[0].propagation_status = "propagated";
        expect(validateUserDecisionRecords(propagated.user_decisions)).toEqual([]);
        expect(validateQuestionDecisionPropagation(propagated)).toEqual([]);
        expect(canApprovePlan(pending).reasons).toContain("question_decision_propagation_incomplete");

        const missingRecord = structuredClone(propagated);
        missingRecord.user_decisions = [];
        expect(validateQuestionDecisionPropagation(missingRecord)).toContain(
            "Resolved question WP1-Q1 is missing a user_decisions record.",
        );
        const mismatched = structuredClone(propagated);
        mismatched.user_decisions[0].selected_option = "new";
        expect(validateQuestionDecisionPropagation(mismatched)).toContain(
            "User decision for WP1-Q1 answer must match the selected option.",
        );
        const unknown = structuredClone(propagated);
        unknown.user_decisions.push({
            decision_ref: "D9",
            question_id: "WP9-Q1",
            answer: "unused",
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
            affected_refs: ["question:WP9-Q1"],
            propagation_status: "propagated",
        });
        expect(validateQuestionDecisionPropagation(unknown)).toContain(
            "user_decisions references unknown question WP9-Q1.",
        );
        expectErrorCode(() => applyQuestionDecision(state, {
            question_id: "WP1-Q1",
            decision_ref: "D2",
            answer: "free text",
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
            affected_refs: ["WP1.scope"],
        }), "INVALID_QUESTION_DECISION");
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
            critical_review_complete: true,
            review_history: [criticalReview()],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            simplification_control_review_complete: true,
            blockers: [],
            findings: [],
            scope_questions: [],
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
                ? {...item, questions: [{
                    id: `${item.id}-Q1`,
                    prompt: "Czy pytanie blokujące zostało rozstrzygnięte?",
                    blocking: true,
                    resolved: false,
                    impact: "Blokuje decyzję pakietu.",
                    decision_needed: "Potwierdzić odpowiedź.",
                }]}
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
            critical_review_complete: true,
            review_history: [criticalReview()],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            simplification_control_review_complete: true,
            blockers: [],
            findings: [],
            scope_questions: [],
        };

        expect(validateFinalApproval({
            ...ready,
            packages: ready.packages.map((item, index) => index === 0
                ? {...item, questions: [{
                    id: `${item.id}-Q1`,
                    prompt: "Czy pytanie blokujące zostało rozstrzygnięte?",
                    blocking: true,
                    resolved: false,
                    impact: "Blokuje decyzję pakietu.",
                    decision_needed: "Potwierdzić odpowiedź.",
                }]}
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

    it("validates every ownership kind, cross-context outcome and redundancy finding", () => {
        for (const scenario of OWNERSHIP_SCENARIOS) {
            const reviewErrors = validateOwnershipRedundancyReview(scenario.review, scenario.findings);
            const findingErrors = scenario.findings.flatMap((finding, index) => validateFinding(finding, index));

            expect(reviewErrors.length === 0, scenario.id).toBe(scenario.expected.review_valid);
            expect(findingErrors.length === 0, scenario.id).toBe(scenario.expected.finding_valid);
            if (scenario.expected.finding_code) {
                expect(scenario.findings[0]).toMatchObject({
                    code: scenario.expected.finding_code,
                    subject_id: scenario.expected.finding_subject_id,
                });
                expect(scenario.findings[0].evidence.length).toBeGreaterThan(0);
                expect(scenario.review.subjects[0].alternative_without_subject).not.toBe("");
            }
        }

        const accepted = OWNERSHIP_SCENARIOS.find(({id}) => id === "accepted-exception-with-decision");
        expect(accepted.findings[0]).toMatchObject({
            status: "accepted",
            decision_ref: "D2",
            decision_source: "user",
        });
        expect(accepted.review.subjects[0].decision_ref).toBe("D2");

        const missingDecision = OWNERSHIP_SCENARIOS.find(({id}) => id === "accepted-exception-without-decision");
        expect(validateFinding(missingDecision.findings[0])).toEqual(expect.arrayContaining([
            "Finding 1 is missing decision_ref for an accepted redundancy finding.",
            "Finding 1 is missing decision_source for an accepted redundancy finding.",
            "Finding 1 is missing decided_at for an accepted redundancy finding.",
        ]));
    });

    it("keeps source-example provenance while allowing explicit promotion metadata", () => {
        const notPromoted = OWNERSHIP_SCENARIOS.find(({id}) => id === "algorithm-source-example-not-promoted");
        const promoted = OWNERSHIP_SCENARIOS.find(({id}) => id === "workflow-source-example-promoted");

        expect(validateOwnershipRedundancyReview(notPromoted.review, notPromoted.findings)).toEqual([]);
        expect(validateOwnershipRedundancyReview(promoted.review, promoted.findings)).toEqual([]);
        expect(notPromoted.review.subjects[0].claim_classification).toBe("source_example");
        expect(promoted.review.subjects[0]).toMatchObject({
            claim_classification: "source_example",
            promotion_decision_ref: "D1",
        });
    });

    it("rejects cross-context ownership without an explicit boundary", () => {
        const source = OWNERSHIP_SCENARIOS.find(({id}) => id === "module-cross-context-justified");
        const review = structuredClone(source.review);
        delete review.subjects[0].context_boundary;

        expect(validateOwnershipRedundancyReview(review, source.findings)).toContain(
            "ownership_redundancy_review subject 1 cross-context scope requires context_boundary.",
        );
    });

    it("rejects negative ownership fixture scenarios", () => {
        for (const scenario of OWNERSHIP_NEGATIVE_SCENARIOS) {
            const {review, findings} = materializeOwnershipNegativeScenario(scenario);
            const errors = validateOwnershipRedundancyReview(review, findings);

            expect(errors, scenario.id).toEqual(expect.arrayContaining(scenario.expected_errors));
        }
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

    it("preserves ownership subjects, evidence, findings and decisions during simplification", () => {
        const source = OWNERSHIP_SCENARIOS.find(({id}) => id === "accepted-exception-with-decision");
        const before = {
            scope: ["ownership"],
            acceptance_criteria: ["C1"],
            user_decisions: ["D2"],
            required_evidence: ["review:OR7"],
            risks: ["divergence"],
            ownership_redundancy_review: source.review,
            findings: source.findings,
            decisions: [{
                decision_ref: "D2",
                decision: "accepted",
                decision_source: "user",
                decided_at: "2026-01-02T00:00:00Z",
            }],
        };
        const after = structuredClone(before);
        after.acceptance_criteria.push("C2");

        expect(validateSimplification({result: "simplified", before, after}, {requireOwnershipReview: true})).toEqual([]);

        const removedEvidence = structuredClone(after);
        removedEvidence.ownership_redundancy_review.subjects[0].evidence_refs = [];
        expect(validateSimplification({result: "simplified", before, after: removedEvidence}, {requireOwnershipReview: true})).toContain(
            "Simplification removed ownership_redundancy_review subjects or their evidence/findings/decisions.",
        );

        const removedDecision = structuredClone(after);
        removedDecision.decisions = [];
        expect(validateSimplification({result: "simplified", before, after: removedDecision}, {requireOwnershipReview: true})).toContain(
            "Simplification removed decisions.",
        );
    });

    it("requires an explicit ownership review in every plan state version", () => {
        const accepted = applyDecisionCommand(baseState(), "accept-all-pending", {
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });
        const complete = {
            ...accepted,
            plan_status: "approved",
            review_complete: true,
            critical_review_complete: true,
            review_history: [criticalReview()],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            simplification_control_review_complete: true,
            blockers: [],
            findings: [],
            scope_questions: [],
        };

        for (const planVersion of [1, 2, 3]) {
            const stateWithoutReview = {...complete, plan_version: planVersion};
            delete stateWithoutReview.ownership_redundancy_review;
            const result = validatePlanState(stateWithoutReview);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Plan state must contain ownership_redundancy_review.");
        }

        expect(validatePlanState({
            ...complete,
            plan_version: 1,
            ownership_redundancy_review: {
                required: false,
                requirement_basis: "not-applicable",
                requirement_decision_ref: "",
                status: "not-required",
                subjects: [],
            },
        }).valid).toBe(true);
    });

    it("rejects an accepted exception without decision data in the full state validator", () => {
        const source = OWNERSHIP_SCENARIOS.find(({id}) => id === "accepted-exception-without-decision");
        const accepted = applyDecisionCommand(baseState(), "accept-all-pending", {
            decision_source: "user",
            decided_at: "2026-01-02T00:00:00Z",
        });
        const result = validatePlanState({
            ...accepted,
            plan_status: "approved",
            plan_version: 3,
            review_complete: true,
            critical_review_complete: true,
            review_history: [criticalReview()],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            simplification_control_review_complete: true,
            blockers: [],
            findings: source.findings,
            scope_questions: [],
            ownership_redundancy_review: source.review,
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("Finding 1 is missing decision_ref for an accepted redundancy finding.");
        expect(result.errors).toContain("ownership_redundancy_review subject 1 accepted-exception status requires decision_ref.");
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
            session_strategy: sessionStrategy(),
            ownership_redundancy_review: notRequiredOwnershipReview(),
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
            critical_review_complete: true,
            review_history: [criticalReview()],
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            simplification_control_review_complete: true,
            blockers: [],
            findings: [],
            scope_questions: [],
        }).valid).toBe(true);
    });
});

describe("task-plan CLI contract", () => {
    it("returns non-zero contract codes for invalid draft, state and source inputs", () => {
        const directory = makeTemporaryDirectory();
        const invalidDraft = path.join(directory, "invalid.md");
        fs.writeFileSync(invalidDraft, MAIN_FIXTURE
            .replace("input_profile: brief-request", "input_profile: title-only")
            .replace("plan_status: review-pending", "plan_status: approved"), "utf8");

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

        const validStatePath = path.join(directory, "valid-state.json");
        fs.writeFileSync(validStatePath, JSON.stringify(baseState()), "utf8");
        const validateStateResult = runCli(VALIDATE_PLAN_SCRIPT, ["validate-state", "--file", validStatePath]);
        expect(validateStateResult.status).toBe(0);
        expect(JSON.parse(validateStateResult.stdout).valid).toBe(true);

        const invalidState = baseState();
        delete invalidState.ownership_redundancy_review;
        const invalidStatePath = path.join(directory, "invalid-state.json");
        fs.writeFileSync(invalidStatePath, JSON.stringify(invalidState), "utf8");
        const invalidStateResult = runCli(VALIDATE_PLAN_SCRIPT, ["validate-state", "--file", invalidStatePath]);
        expect(invalidStateResult.status).toBe(1);
        expect(JSON.parse(invalidStateResult.stdout).errors).toContain("Plan state must contain ownership_redundancy_review.");
    });

    it("resolves a title-independent GitHub draft path without fetching the source", () => {
        const result = runCli(DRAFT_SCRIPT, [
            "path",
            "--source-kind",
            "github-issue",
            "--issue",
            "123",
        ]);

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout).path).toBe("docs/draft/issue-123-plan.md");
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
        review_history: [criticalReview()],
        simplification: {result: "no-change"},
        simplification_status: "no-change",
        critical_review_complete: true,
        simplification_control_review_complete: true,
        blockers: [],
        review_complete: true,
        scope_questions: [],
        decisions: [],
        session_strategy: sessionStrategy(),
        ownership_redundancy_review: notRequiredOwnershipReview(),
    };
}

function materializeOwnershipNegativeScenario(scenario) {
    const source = OWNERSHIP_SCENARIO_INDEX.get(scenario.source_scenario);
    const result = {
        review: structuredClone(source.review),
        findings: structuredClone(source.findings),
    };

    for (const mutation of scenario.mutations) {
        if (mutation.op === "set") {
            setPath(result, mutation.path, structuredClone(mutation.value));
            continue;
        }
        const mutationSource = OWNERSHIP_SCENARIO_INDEX.get(mutation.source_scenario);
        const sourceValue = structuredClone(getPath(mutationSource, mutation.source_path));
        if (mutation.op === "copy") {
            setPath(result, mutation.path, sourceValue);
        } else if (mutation.op === "append") {
            getPath(result, mutation.path).push(sourceValue);
        }
    }

    return result;
}

function getPath(value, pathValue) {
    return pathValue.split(".").reduce((current, key) => current[key], value);
}

function setPath(value, pathValue, replacement) {
    const parts = pathValue.split(".");
    const field = parts.pop();
    const parent = parts.reduce((current, key) => current[key], value);
    parent[field] = replacement;
}

function notRequiredOwnershipReview() {
    return {
        required: false,
        requirement_basis: "not-applicable",
        requirement_decision_ref: "",
        status: "not-required",
        subjects: [],
    };
}

function sessionStrategy() {
    return {
        mode: "staged",
        rationale: "WP1 precedes dependent work.",
        stages: [{
            id: "S1",
            title: "Core",
            rationale: "Stabilize the core contract first.",
            work_package_ids: ["WP1"],
            dependencies: [],
            session_boundary: "same-session",
            entry_criteria: ["Scope confirmed."],
            exit_criteria: ["Core contract documented."],
        }],
        session_boundary_recommendation: "Review dependent work in a new session.",
        dependencies: ["WP2 depends_on WP1"],
        entry_criteria: ["Intent confirmed."],
        exit_criteria: ["Every stage has a terminal result."],
    };
}

function criticalReview() {
    return {
        iteration: 1,
        plan_version: 1,
        stage: "critical-review",
        complete: true,
        checks: [
            "intent-and-acceptance",
            "technical-scope",
            "edge-cases-and-verification",
            "risks-and-dependencies",
        ],
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
