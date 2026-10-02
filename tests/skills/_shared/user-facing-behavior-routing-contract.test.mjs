import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const REFERENCE = "_shared/references/user-facing-behavior-assessment.md";
const CONSUMERS = ["task-plan", "code-review"];

function read(relativePath) {
    return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("shared user-facing behavior assessment routing", () => {
    it("keeps the method in one shared reference with its decision rules", () => {
        const reference = read(`.agents/skills/${REFERENCE}`);
        for (const heading of [
            "## 1. Inwentarz interakcji",
            "## 2. Wynik",
            "## 3. Uwagi produktowe",
        ]) {
            expect(reference).toContain(heading);
        }
        expect(reference).toContain("Liczba uwag nie jest ograniczona");
        expect(reference).toContain("brak uwag jest poprawnym wynikiem");
        expect(reference).toContain("nie uprawnia do samodzielnej");
    });

    it("declares and routes the reference from every consumer skill", () => {
        for (const skill of CONSUMERS) {
            const source = read(`.agents/skills/${skill}/SKILL.md`);
            const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
            expect(frontmatter, skill).toContain(`- ${REFERENCE}`);
            expect(source, skill).toContain(`\`<skills_root>/${REFERENCE}\``);
        }
    });

    it("turns a source-prescribed interaction conflict into a decision, not a defect", () => {
        const taskPlan = read(".agents/skills/task-plan/SKILL.md");
        const codeReview = read(".agents/skills/code-review/SKILL.md");
        expect(taskPlan).toContain("**Rezultat dla użytkownika:**");
        expect(taskPlan).toContain("nie zmieniaj punktu samodzielnie");
        expect(taskPlan).toContain("`N<number> [note]`");
        expect(codeReview).toContain("An authoritative source settles what behavior is expected, not whether that");
        expect(codeReview).toContain("report a\n`QUESTION` with the concrete trade-off instead of a defect");
    });
});
