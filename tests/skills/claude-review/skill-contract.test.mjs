import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SKILL = ".agents/skills/claude-review/SKILL.md";
const CONTRACT = ".agents/skills/claude-review/references/execution-contract.md";
const CODE_REVIEW = ".agents/skills/code-review/SKILL.md";
const JOB_SCRIPT = ".agents/skills/claude-review/scripts/review-job.mjs";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("claude-review skill contract", () => {
    it("delegates only the code target to the code-review executor role", () => {
        const skill = read(SKILL);

        expect(skill).toMatch(/execution_role: executor/);
        expect(skill).toMatch(/Obsługiwany jest tylko target `code`/);
        expect(skill).toMatch(/Uruchamiaj wyłącznie na jawne polecenie `\$claude-review`/);
    });

    it("requires explicit launch parameters on the built-in Claude provider", () => {
        const skill = read(SKILL);

        expect(skill).toMatch(/dokładny model Opus, poziom thinking i dodatnie\s+`timeout_seconds`\. Nie ma wartości domyślnych/);
        expect(skill).toMatch(/--provider claude --model <model>/);
        expect(skill).not.toMatch(/--provider claude-review/);
        expect(skill).toMatch(/Bez fallbacku API, zmiany modelu, retry ani naprawy kodu/);
    });

    it("resolves Paseo through the shared tool resolver", () => {
        expect(read(SKILL)).toMatch(/resolve_tool_cmd paseo/);
    });

    it("keeps the verdict with the coordinator after acceptance", () => {
        const skill = read(SKILL);

        expect(skill).toMatch(/`ACCEPTED` oznacza tylko, że raport należy do tego joba, sesji i snapshotu/);
        expect(skill).toMatch(/bez nowego pełnego discovery,\s+i sam wydaj werdykt/);
    });

    it("documents every helper decision", () => {
        const contract = read(CONTRACT);

        for (const reason of ["SESSION_NOT_BOUND", "INPUT_CHANGED", "SESSION_MISMATCH", "PERMISSION_PENDING", "REPORT_INVALID", "JOB_MISMATCH", "SNAPSHOT_MISMATCH", "SNAPSHOT_CHANGED", "EXECUTOR_REPORTED_STALE"]) {
            expect(contract, reason).toContain(reason);
        }
        expect(contract).toMatch(/Żaden\s+wynik nie dopuszcza automatycznej drugiej próby/);
    });

    it("refers to code-review sections by name, not by number", () => {
        const skill = read(SKILL);
        const contract = read(CONTRACT);
        const codeReview = read(CODE_REVIEW);

        expect(skill).toMatch(/bramką\s+publikacji z sekcji „Verify candidate findings”/);
        expect(contract).toMatch(/strukturę sekcji\s+„Output format” `\$code-review`/);
        expect(codeReview).toMatch(/^## (?:\d+\. )?Verify candidate findings$/m);
        expect(codeReview).toMatch(/^## (?:\d+\. )?Output format$/m);
        expect(read(JOB_SCRIPT)).toContain("<code-review Output format report>");
        expect(read(JOB_SCRIPT)).not.toMatch(/code-review Section \d+/);
        for (const content of [skill, contract]) {
            expect(content).not.toMatch(/sekcj\w*\s+\d+\s+\S*code-review/);
        }
    });
});
