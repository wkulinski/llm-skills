import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("implementation worker agent contract", () => {
    it("allows the build agent to delegate only the named worker", () => {
        const config = read("opencode.jsonc");
        expect(config).toMatch(/"task": \{[\s\S]*"\*": "deny"/);
        expect(config).toMatch(/"implementation-worker": "allow"/);
    });

    it("keeps the worker bounded and prevents nested orchestration", () => {
        const worker = read(".opencode/agent/implementation-worker.md");
        expect(worker).toMatch(/mode: subagent/);
        expect(worker).toMatch(/bash: allow/);
        expect(worker).toMatch(/task: deny/);
        expect(worker).toMatch(/external_directory: deny/);
        expect(worker).toMatch(/small, bounded, cohesive/);
        expect(worker).toMatch(/several closely related\s+files/);
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
        expect(skill).toMatch(/spójny i w pełni określony pakiet implementacyjny, także wieloplikowy/);
        expect(skill).toMatch(/cel,\s+zakres,\s+ograniczenia/);
        expect(skill).toMatch(/ESCALATE_TO_PRIMARY/);
        expect(skill).toMatch(/Bramka kosztowa delegacji/);
        expect(skill).toMatch(/scoped diff/);
        expect(skill).toMatch(/bez ponownego szerokiego discovery/);
        for (const field of [
            "Objective:",
            "Scope:",
            "Constraints:",
            "Decisions:",
            "References:",
            "Acceptance criteria:",
            "Verification:",
        ]) {
            expect(skill).toContain(field);
        }
    });
});
