import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("skill execution contract", () => {
    it("keeps implementation bounded and routes specialist procedures without requiring a dedicated subagent", () => {
        const skill = read(".agents/skills/code-implement/SKILL.md");
        const execution = skill.split("## Wykonanie i skille specjalistyczne")[1]?.split("## Definicje")[0] ?? "";
        expect(execution).toContain("Implementację wykonuje bieżący agent.");
        expect(execution).toContain("jednym aktywnym wymaganiem");
        expect(execution).toContain("obszary wyłączone");
        expect(execution).toContain("punktową weryfikację");
        expect(execution).toMatch(/Implementacja, UI i diagnostyka nie wymagają dedykowanego\s+subagenta/);
        expect(execution).toContain("diagnozuj przez `$dev-mate`");
        expect(execution).toMatch(/tworzeniu, zmianie lub opiniowaniu renderowanego UI zastosuj\s+`\$frontend-ui-consistency`/);
        expect(execution).toContain("<skills_root>/_shared/references/playwright-cli-verification.md");
        expect(execution).toContain("Nie zastępuj walidowanego lifecycle rekonesansu wykonaniem bezpośrednim");
    });

    it("supports direct frontend consultation and delegated decision handoff with the same safety gates", () => {
        const skill = read(".agents/skills/frontend-ui-consistency/SKILL.md");
        expect(skill).toContain("Przy wykonaniu bezpośrednim zapytaj użytkownika");
        expect(skill).toContain("Przy wykonaniu delegowanym zwróć `DECISION_REQUIRED`");
        expect(skill).toContain("Delegowany wykonawca nie prowadzi równoległego dialogu");
        expect(skill).toContain("Brak jawnego zlecenia implementacji zawsze oznacza `advisory`");
        expect(skill).toContain("screenshot został odczytany jako obraz");
        expect(skill).toContain("nie zmodyfikowano plików repozytorium ani danych aplikacji");
        expect(skill).toContain("kontrakty Twig/Live/Stimulus pozostały poprawne");
        const transfer = read(".agents/skills/frontend-ui-consistency/references/pattern-transfer.md");
        expect(transfer).toContain("Niepewność i decyzja użytkownika");
    });

    it("keeps runtime diagnosis evidence-based and redacted in its owning skill", () => {
        const skill = read(".agents/skills/dev-mate/SKILL.md");
        expect(skill).toMatch(/potwierdź go w repo przed\s+sformułowaniem wniosku o przyczynie/);
        expect(skill).toContain("Oddziel potwierdzone obserwacje od hipotez");
        expect(skill).toContain("nazwij brakujący sygnał");
        expect(skill).toContain("Nie ujawniaj sekretów, tokenów, wartości env ani pełnych logów");
        expect(skill).toContain("niesekretne parametry i zakres czasu logów/profilera");
    });
});
