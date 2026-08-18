import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("implementation worker agent contract", () => {
    it("matches the resolved build dispatch policy", () => {
        const result = spawnSync(process.env.OPENCODE_BIN ?? "opencode", ["debug", "agent", "build"], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(result.status, result.stderr).toBe(0);
        const resolved = JSON.parse(result.stdout);
        const taskRules = resolved.permission.filter((rule) => rule.permission === "task");

        expect(taskRules).toContainEqual(expect.objectContaining({pattern: "*", action: "allow"}));
    }, 30_000);

    it("keeps the worker bounded and prevents nested orchestration", () => {
        const worker = read(".opencode/agent/implementation-worker.md");
        expect(worker).toMatch(/mode: subagent/);
        expect(worker).toMatch(/bash: allow/);
        expect(worker).toMatch(/task: deny/);
        expect(worker).toMatch(/external_directory: deny/);
        expect(worker).toMatch(/exactly one pre-designed behavioral change/);
        expect(worker).toMatch(/Mandatory atomicity preflight/);
        expect(worker).toMatch(/exactly one active requirement identifier/);
        expect(worker).toMatch(/exactly one externally observable behavioral result/);
        expect(worker).toMatch(/Primary responsibility/);
        expect(worker).toMatch(/Non-goals/);
        expect(worker).toMatch(/before editing when it combines independent bugs or\s+features/);
        expect(worker).toMatch(/do not make partial edits/);
        expect(worker).toMatch(/propose two to four atomic work units/);
        expect(worker).toMatch(/Reserve at least 30% of the available steps/);
        expect(worker).toMatch(/replacement exists in the same coherent edit/);
        expect(worker).toMatch(/several\s+closely related files/);
        expect(worker).toMatch(/git status --short -- <allowed paths>/);
        expect(worker).toMatch(/git diff --name-only -- <allowed paths>/);
        expect(worker).toMatch(/Do not perform broad repository discovery/);
        expect(worker).toMatch(/unspecified input types, edge cases, fallbacks/);
        expect(worker).toMatch(/Once all acceptance criteria pass, stop/);
        expect(worker).toMatch(/STATUS: ESCALATE_TO_PRIMARY/);
    });

    it("documents direct delegation as a bounded implementation route", () => {
        const skill = read(".agents/skills/code-implement/SKILL.md");
        expect(skill).toMatch(/`implementation-worker`/);
        expect(skill).toMatch(/implementation-worker/);
        expect(skill).toMatch(/dokładnie jedno aktywne wymaganie `R#`/);
        expect(skill).toMatch(/Twarda bramka delegacji/);
        expect(skill).toMatch(/agent główny \*\*MUSI\*\*/);
        expect(skill).toMatch(/\*\*NIE wywołuj\*\*/);
        expect(skill).toMatch(/Delegation gate: PASS/);
        expect(skill).toMatch(/ESCALATE_TO_PRIMARY/);
        expect(skill).toMatch(/Bramka kosztowa delegacji/);
        expect(skill).toMatch(/scoped diff/);
        expect(skill).toMatch(/bez ponownego szerokiego discovery/);
        for (const field of [
            "Requirement:",
            "Single outcome:",
            "Primary responsibility:",
            "Allowed production scope:",
            "Allowed supporting tests:",
            "Constraints:",
            "Decisions:",
            "References:",
            "Non-goals:",
            "Acceptance criterion:",
            "Verification:",
        ]) {
            expect(skill).toContain(field);
        }
    });
});
