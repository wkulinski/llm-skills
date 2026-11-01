import assert from "node:assert/strict";
import fs from "node:fs";
import {it} from "vitest";

it("refreshes one task-plan publication after docs and before acceptance, message and ordinary staging", () => {
    const skill = fs.readFileSync(new URL("../../../.agents/skills/git-commit/SKILL.md", import.meta.url), "utf8");
    const docs = skill.indexOf("7. Jeśli");
    const publish = skill.indexOf("publication.mjs refresh-for-commit");
    const acceptance = skill.indexOf("8. Krok akceptacji");
    const message = skill.indexOf("9. Wykonaj skill");
    const staging = skill.indexOf("10. W domyślnym zakresie uruchom `git add .`");
    assert.ok(docs < publish && publish < acceptance && acceptance < message && message < staging);
    for (const contract of ["bez skanowania innych planów", "commit nie streszcza raportów", "przed stagingiem", "nie uruchamia nowego review planu", "osobnej sesji QA", "Nie usuwa innych publikacji", "jawnie pozostaw ją poza zaakceptowanym zakresem"]) {
        assert.ok(skill.includes(contract), contract);
    }
});
