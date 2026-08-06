import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

import {
    renderQuestionSections,
    validateDraftDocument,
} from "../../../.agents/skills/task-plan/scripts/draft.mjs";
import {
    validateQuestionRecords,
} from "../../../.agents/skills/task-plan/scripts/state.mjs";
import {validatePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const QUESTIONS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/questions.json"), "utf8"));
const EXPECTED_MARKDOWN = fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/draft-questions.md"), "utf8");
const MAIN_DRAFT = fs.readFileSync(path.join(ROOT, "tests/fixtures/task-plan/draft-main.md"), "utf8");
const DRAFT_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/draft.mjs");

describe("task-plan question contract", () => {
    it("renders scope and per-package questions as separate readable sections", () => {
        expect(renderQuestionSections(QUESTIONS)).toBe(EXPECTED_MARKDOWN);

        const cliResult = spawnSync(process.execPath, [DRAFT_SCRIPT, "render-questions", "--file", path.join(ROOT, "tests/fixtures/task-plan/questions.json")], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(cliResult.status).toBe(0);
        expect(JSON.parse(cliResult.stdout).markdown).toBe(EXPECTED_MARKDOWN);
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
            review_complete: false,
            critical_review_complete: false,
            simplification_control_review_complete: false,
        };
        expect(validatePlanDocument(MAIN_DRAFT, {kind: "main", state}).valid).toBe(true);
        const mismatch = validatePlanDocument(MAIN_DRAFT, {
            kind: "main",
            state: {...state, plan_status: "needs-clarification"},
        });
        expect(mismatch.valid).toBe(false);
        expect(mismatch.errors).toContain("Draft/state plan_status mismatch: draft=review-pending, state=needs-clarification.");

        const gateMismatch = validatePlanDocument(MAIN_DRAFT, {
            kind: "main",
            state: {...state, package_decision_gate: "open"},
        });
        expect(gateMismatch.valid).toBe(false);
        expect(gateMismatch.errors).toContain("Plan state package_decision_gate must be closed for review-pending.");
    });
});
