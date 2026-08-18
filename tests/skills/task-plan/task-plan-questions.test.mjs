import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

import {
    parseDraftDocument,
    replaceSessionStrategySection,
    renderQuestionSections,
    renderSessionStrategyProjection,
    serializeFrontMatter,
    validateDraftDocument,
} from "../../../.agents/skills/task-plan/scripts/draft.mjs";
import {
    validateQuestionRecords,
    validateOwnershipRedundancyReview,
} from "../../../.agents/skills/task-plan/scripts/state.mjs";
import {loadState, updateState} from "../../../.agents/skills/task-plan/scripts/state-store.mjs";
import {validatePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/questions.json"), "utf8"));
const OWNERSHIP_FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/ownership-redundancy-scenarios.json"), "utf8"));
const OWNERSHIP_REVIEW_SCENARIOS = new Map([
    ...OWNERSHIP_FIXTURE.scenarios,
    ...OWNERSHIP_FIXTURE.state_scenarios,
].map((scenario) => [scenario.id, scenario]));
const OWNERSHIP_REVIEW_STATES = QUESTIONS.ownership_redundancy_review_states;
const EXPECTED_MARKDOWN = fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/draft-questions.md"), "utf8");
const MAIN_DRAFT = fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/draft-main.md"), "utf8");
const DRAFT_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/draft.mjs");
const temporaryDirectories = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

describe("task-plan question contract", () => {
    it("renders scope and per-package questions as separate readable sections", () => {
        expect(renderQuestionSections(QUESTIONS)).toBe(EXPECTED_MARKDOWN);

        const cliResult = spawnSync(process.execPath, [DRAFT_SCRIPT, "render-questions", "--file", path.join(ROOT, "tests/fixtures/task-plan/questions.json")], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(cliResult.status).toBe(0);
        expect(JSON.parse(cliResult.stdout).markdown).toBe(EXPECTED_MARKDOWN);
        expect(EXPECTED_MARKDOWN).toContain("Konsekwencja/tradeoff: Ogranicza zakres");
        expect(EXPECTED_MARKDOWN).toContain("Kontekst: Decyzja ustala kontrakt");
    });

    it("requires stable IDs and structured question fields", () => {
        expect(validateQuestionRecords(QUESTIONS.scope_questions, {scope: "scope"})).toEqual([]);
        expect(validateQuestionRecords(QUESTIONS.packages[0].questions, {packageId: "WP1"})).toEqual([]);
        expect(validateQuestionRecords([
            {
                id: "Q1",
                prompt: "Two decisions?",
                blocking: true,
                resolved: false,
            },
        ], {packageId: "WP1"})).toEqual(expect.arrayContaining([
            "Question 1 id must match WP1-Q<number>.",
            "Question 1 is missing impact.",
            "Question 1 is missing decision_needed.",
        ]));
        expect(validateQuestionRecords([{
            id: "SQ1",
            prompt: "Czy zakres jest właściwy?",
            blocking: true,
            resolved: true,
            impact: "Zmienia zakres.",
            decision_needed: "Potwierdzić zakres.",
        }], {scope: "scope"})).toEqual(expect.arrayContaining([
            "Question 1 is missing answer for a resolved question.",
            "Question 1 is missing decision_source for a resolved question.",
            "Question 1 is missing decided_at for a resolved question.",
        ]));
        expect(validateQuestionRecords([{
            id: "WP1-Q1",
            prompt: "Który wariant?",
            blocking: true,
            resolved: false,
            impact: "Zakres",
            decision_needed: "Wybrać wariant.",
            options: [{id: "a", label: "A"}],
        }], {packageId: "WP1"})).toContain("Question 1 option 1 must contain a consequence/tradeoff.");
    });

    it("keeps complete and incomplete ownership review states separate from package questions", () => {
        expect(OWNERSHIP_REVIEW_STATES).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: "complete-required-review",
                scenario_id: "field-local-justified",
            }),
            expect.objectContaining({
                id: "incomplete-required-review",
                scenario_id: "required-review-pending",
            }),
        ]));

        const incomplete = OWNERSHIP_REVIEW_STATES.find(({id}) => id === "incomplete-required-review");
        for (const state of OWNERSHIP_REVIEW_STATES) {
            const scenario = OWNERSHIP_REVIEW_SCENARIOS.get(state.scenario_id);
            expect(scenario, state.id).toBeDefined();
            expect(validateOwnershipRedundancyReview(scenario.review, scenario.findings), state.id).toEqual([]);
        }
        const incompleteScenario = OWNERSHIP_REVIEW_SCENARIOS.get(incomplete.scenario_id);
        const markdown = renderQuestionSections({...QUESTIONS, package_decision_gate: "closed"});

        expect(incompleteScenario.review.status).toBe("pending");
        expect(incompleteScenario.review.subjects[0].id).toBe("OR9");
        expect(markdown).toContain("package_decision_gate` jest zamknięta");
        expect(markdown).not.toContain("### WP1 — Kontrakt backendu");

        const openMarkdown = renderQuestionSections({...QUESTIONS, package_decision_gate: "open"});
        expect(openMarkdown).toContain("### WP1 — Kontrakt backendu");
        expect(openMarkdown).toContain("WP1-Q1");
    });

    it("propagates a question decision through known state-store mutations", () => {
        const directory = makeTemporaryDirectory();
        const plan = {
            repo_root: directory,
            state_root: path.join(directory, "var", "agent", "task-plan"),
            plan_id: "question-propagation",
            draft_path: "docs/draft/question-propagation.md",
            source_identity: "user:question-propagation",
            scope_questions: [{
                id: "SQ1",
                prompt: "Czy źródło jest kompletne?",
                impact: "Zmienia kryteria kontekstu.",
                decision_needed: "Potwierdzić kompletność.",
                blocking: true,
                resolved: false,
            }],
        };
        const clock = fixedClock();
        updateState(plan, {type: "create-initial", payload: {}}, {clock});

        const decision = updateState(plan, {
            type: "question-decision",
            payload: {
                question_id: "SQ1",
                decision_ref: "D1",
                answer: "yes",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:01Z",
                affected_refs: ["session_strategy"],
            },
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        expect(decision.state.user_decisions[0]).toMatchObject({
            decision_ref: "D1",
            propagation_status: "pending",
        });

        updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "source/context", reason: "start source intake"},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")});
        updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "review", reason: "source intake complete"},
        }, {clock: fixedClock("2026-01-01T00:00:03Z")});
        const current = loadState(plan).state;
        const propagated = updateState(plan, {
            type: "plan-revision",
            payload: {
                packages: current.packages,
                findings: current.findings,
                session_strategy: {...current.session_strategy, rationale: "Source completeness confirmed."},
                reason: "Apply the source decision.",
                propagated_decision_ref: "D1",
            },
        }, {clock: fixedClock("2026-01-01T00:00:04Z")});
        expect(propagated.state.user_decisions[0]).toMatchObject({
            propagation_status: "propagated",
        });
        expect(propagated.state.user_decisions[0].propagation_status).not.toBe("pending");
    });

    it("rejects aggregate legacy question paragraphs and duplicate IDs", () => {
        expect(() => renderQuestionSections({
            scope_questions: [],
            packages: [{
                id: "WP1",
                title: "Backend",
                questions: ["Czy A? Czy B?"],
            }],
        })).toThrow("structured record");

        expect(validateQuestionRecords([
            {
                id: "SQ1",
                prompt: "Pytanie 1?",
                blocking: true,
                resolved: false,
                impact: "Zakres",
                decision_needed: "Odpowiedź",
            },
            {
                id: "SQ1",
                prompt: "Pytanie 2?",
                blocking: false,
                resolved: false,
                impact: "Zakres",
                decision_needed: "Odpowiedź",
            },
        ], {scope: "scope"})).toContain("Duplicate question id: SQ1.");

        const legacyDraft = MAIN_DRAFT.replace(
            "## Decisions and open questions",
            "## Decisions and open questions\n\n**Pytania:** Czy A? Czy B?",
        );
        expect(validateDraftDocument(legacyDraft, {kind: "main"}).errors).toContain(
            "Questions must be rendered as separate structured records, not an aggregate Pytania paragraph.",
        );

        const unresolvedScope = {...QUESTIONS.scope_questions[0], resolved: false};
        delete unresolvedScope.answer;
        delete unresolvedScope.decision_source;
        delete unresolvedScope.decided_at;
        expect(() => renderQuestionSections({
            ...QUESTIONS,
            scope_questions: [unresolvedScope],
        })).toThrow("Package decision gate cannot open");
    });

    it("validates the full rendered package layout in a draft", () => {
        const openDraft = MAIN_DRAFT
            .replace("plan_status: review-pending", "plan_status: awaiting-package-decisions")
            .replace("package_decision_gate: closed", "package_decision_gate: open")
            .replace(
                /## Decisions and open questions[\s\S]*?(?=\n## Evidence, risks and review)/,
                `${EXPECTED_MARKDOWN}\n`,
            );
        expect(validateDraftDocument(openDraft, {kind: "main"}).valid).toBe(true);

        const malformed = openDraft.replace("#### Pytania nieblokujące", "#### Brakująca sekcja");
        expect(validateDraftDocument(malformed, {kind: "main"}).errors).toContain(
            "WP1 is missing #### Pytania nieblokujące.",
        );
    });

    it("does not expose package decisions while the gate is closed", () => {
        const markdown = renderQuestionSections({...QUESTIONS, package_decision_gate: "closed"});

        expect(markdown).toContain("### Decyzje pakietowe");
        expect(markdown).toContain("package_decision_gate` jest zamknięta");
        expect(markdown).not.toContain("### WP1 — Kontrakt backendu");
        expect(markdown).not.toContain("WP1-Q1");
    });

    it("does not offer ordinary actions for terminal packages", () => {
        const markdown = renderQuestionSections({
            ...QUESTIONS,
            packages: QUESTIONS.packages.map((packageRecord) => packageRecord.id === "WP1"
                ? {...packageRecord, decision_status: "accepted"}
                : packageRecord),
        });

        expect(markdown).toContain("Pakiet terminalny; ponowne otwarcie wymaga jawnej prośby użytkownika.");
        expect(markdown).not.toContain("### WP1 — Kontrakt backendu\n\n**Status:** `accepted`<br>\n**Dostępne decyzje:**");
    });

    it("rejects draft and state lifecycle mismatches", () => {
        const state = {
            plan_status: "review-pending",
            package_decision_gate: "closed",
            plan_version: 1,
            packages: [],
            findings: [],
            review_history: [],
            decisions: [],
            simplification: {result: "pending"},
            simplification_status: "pending",
            blockers: [],
            scope_questions: [],
            session_strategy: {
                mode: "staged",
                rationale: "Initial review is separate from package decisions.",
                stages: [{
                    id: "S1",
                    title: "Review",
                    rationale: "Complete review before package decisions.",
                    work_package_ids: [],
                    dependencies: [],
                    session_boundary: "same-session",
                    entry_criteria: ["Draft exists."],
                    exit_criteria: ["Review complete."],
                }],
                session_boundary_recommendation: "Continue after review.",
                dependencies: [],
                entry_criteria: ["Intent confirmed."],
                exit_criteria: ["Questions are explicit."],
            },
            ownership_redundancy_review: {
                required: false,
                requirement_basis: "not-applicable",
                requirement_decision_ref: "",
                status: "not-required",
                subjects: [],
            },
            review_complete: false,
            critical_review_complete: false,
            simplification_control_review_complete: false,
        };
        const parsed = parseDraftDocument(MAIN_DRAFT);
        const projectedDraft = serializeFrontMatter(parsed.metadata)
            + replaceSessionStrategySection(parsed.body, renderSessionStrategyProjection(state.session_strategy));
        expect(validatePlanDocument(projectedDraft, {kind: "main", state}).valid).toBe(true);
        const mismatch = validatePlanDocument(projectedDraft, {
            kind: "main",
            state: {...state, plan_status: "needs-clarification"},
        });
        expect(mismatch.valid).toBe(false);
        expect(mismatch.errors).toContain("Draft/state plan_status mismatch: draft=review-pending, state=needs-clarification.");

        const gateMismatch = validatePlanDocument(projectedDraft, {
            kind: "main",
            state: {...state, package_decision_gate: "open"},
        });
        expect(gateMismatch.valid).toBe(false);
        expect(gateMismatch.errors).toContain("Plan state package_decision_gate must be closed for review-pending.");
    });
});

function fixedClock(value = "2026-01-01T00:00:00Z") {
    return {now: () => value};
}

function makeTemporaryDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-questions-"));
    temporaryDirectories.push(directory);
    return directory;
}
