import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const PLAYBOOK = ".agents/skills/_shared/references/repository-context-scout-playbook.md";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("context scout agent contracts", () => {
    it("requires the shared playbook and retains safety guards", () => {
        expect(fs.existsSync(path.join(ROOT, PLAYBOOK))).toBe(true);
        for (const agent of [".opencode/agent/context-scout-fast.md", ".opencode/agent/context-scout.md"]) {
            const content = read(agent);
            expect(content).toMatch(/repository-context-scout-playbook\.md/);
            expect(content).toMatch(/Nie deleguj agentów/);
            expect(content).toMatch(/Nie uruchamiaj `context-scout-hybrid-run\.mjs`/);
            expect(content).toMatch(/Zapisz raport dokładnie/);
            expect(content).toMatch(/skill: deny/);
            expect(content).toMatch(/task: deny/);
            expect(content).toMatch(/"\*": deny/);
            expect(content).toMatch(/external_directory:\s+"\*": deny/);
            expect(content).toMatch(/context-criteria\.mjs validate \*": allow/);
            expect(content).toMatch(/context-scout-report-builder\.mjs \*": allow/);
            expect(content).toMatch(/"github_\*": deny/);
            expect(content).toMatch(/"context7_\*": deny/);
            expect(content).toMatch(/"mate_\*": deny/);
            expect(content).toMatch(/"\*\*\/\*primary\*\.report\.json": deny/);
            expect(content).toMatch(/"\*\*\/\*primary\*\.ledger\.json": deny/);
        }
    });

    it("keeps only role-specific discovery strategies", () => {
        const primary = read(".opencode/agent/context-scout-fast.md");
        const fallback = read(".opencode/agent/context-scout.md");
        expect(primary).toMatch(/codebase-memory-mcp jako pierwszej warstwy/);
        expect(primary).toMatch(/"codebase-memory\*": allow/);
        expect(primary).toMatch(/`index_repository` w trybie `full`/);
        expect(primary).not.toMatch(/`index_repository` w trybie `moderate`/);
        expect(primary).toMatch(/batch-render/);
        expect(primary).toMatch(/JSON acknowledgement/);
        expect(fallback).toMatch(/niezależnym fallbackiem/);
        expect(fallback).toMatch(/CLAIM_FALLBACK/);
        expect(fallback).toMatch(/Nie czytaj raportu, błędów, metadanych ani ustaleń primary/);
        expect(fallback).toMatch(/"codebase-memory\*": deny/);
        expect(fallback).not.toMatch(/codebase-memory-mcp jako pierwszej warstwy/);
    });

    it("keeps the fast scout compact, grounded and fail-closed", () => {
        const primary = read(".opencode/agent/context-scout-fast.md");
        expect(primary).toMatch(/steps: 48/);
        expect(primary).toMatch(/W trybie `targeted` zmapuj maksymalnie 6 istotnych plików/);
        expect(primary).toMatch(/dokładnie jeden zwarty finding na criterion/);
        expect(primary).toMatch(/najwyżej trzy najmniejsze zakresy evidence/);
        expect(primary).toMatch(/nie duplikuj tych zakresów w `coverage\[\]\.evidence`/);
        expect(primary).toMatch(/około 1000 tokenach/);
        expect(primary).toMatch(/obowiązkowo wyszukaj jego nazwę literalnie/);
        expect(primary).toMatch(/Nie zastępuj go referencją w teście/);
        expect(primary).toMatch(/`criteria\[\]\.required_evidence` jako twardą/);
        expect(primary).toMatch(/dokładną `path` albo `path_prefix`/);
        expect(primary).toMatch(/Nie formułuj w raporcie `COMPLETE` twierdzeń negatywnych/);
        expect(primary).toMatch(/criterion nie jest pokryte: zwróć `INCOMPLETE`/);
        expect(primary).toMatch(/zalecaj utworzenia rzekomo brakującego pliku/);
        expect(primary).toMatch(/Nie kieruj rodzica do ponownego czytania ścieżki/);
        expect(primary).toMatch(/Nie używaj modelowych[\s\S]*`add-evidence`/);
        expect(primary).toMatch(/drugiej i ostatniej[\s\S]*operacji buildera/);
        expect(primary).toMatch(/kroku 24 bez wykonania finalizacji/);
        expect(primary).not.toMatch(/około 1500 tokenach/);
    });

    it("keeps input validation, evidence and report construction in the shared playbook", () => {
        const playbook = read(PLAYBOOK);
        expect(playbook).toMatch(/context-handoff\.mjs validate/);
        expect(playbook).toMatch(/context-manifest\.mjs verify/);
        expect(playbook).toMatch(/context-scout-report-builder\.mjs/);
        expect(playbook).toMatch(/maksymalnie 12 findings/);
        expect(playbook).toMatch(/najwyżej 10 istotnych plików/);
        expect(playbook).toMatch(/read_coverage\.covered/);
        expect(playbook).toMatch(/`required_evidence`/);
        expect(playbook).toMatch(/`forbid_negative_claims`/);
        expect(playbook).toMatch(/Nie deleguj agentów/);
    });

    it("requires the shared playbook in the hybrid task prompt", () => {
        const helper = read(".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs");
        expect(helper).toMatch(/repository-context-scout-playbook\.md/);
        expect(helper).toMatch(/10 relevant files, 5 symbols, and 3 tests\/commands/);
        expect(helper).toMatch(/read_coverage\.covered/);
        expect(helper).toMatch(/claim_type \(observed, structural, inferred\)/);
        expect(helper).toMatch(/anchors containing literal terms/);
    });

    it("keeps the routing algorithm in one canonical source", () => {
        const canonical = read(".agents/skills/_shared/references/repository-context-hybrid.md");
        expect(canonical).toMatch(/CLAIM_FALLBACK/);
        for (const reference of [
            ".agents/skills/code-implement/SKILL.md",
            ".agents/skills/_shared/references/context-subagent-contract.md",
        ]) {
            const content = read(reference);
            expect(content).toMatch(/repository-context-hybrid\.md/);
            expect(content).not.toMatch(/DELEGATE_FALLBACK/);
        }
    });

    it("documents Luna High as the bounded stronger fallback", () => {
        const canonical = read(".agents/skills/_shared/references/repository-context-hybrid.md");
        const fallback = read(".opencode/agent/context-scout.md");

        expect(canonical).toMatch(/`context-scout` \(Luna High\)/);
        expect(canonical).toMatch(/higher-reasoning second pass/);
        expect(canonical).toMatch(/at most one fallback/);
        expect(canonical).not.toMatch(/Luna Low/);
        expect(fallback).toMatch(/model: openai\/gpt-5\.6-luna/);
        expect(fallback).toMatch(/variant: high/);
    });

    it("publishes every shared repository-context runtime dependency", () => {
        const skill = read(".agents/skills/code-implement/SKILL.md");
        const scripts = fs.readdirSync(path.join(ROOT, ".agents/skills/_shared/scripts"))
            .filter((name) => /^(context-criteria|context-handoff|context-manifest|context-scout)/.test(name));
        const references = fs.readdirSync(path.join(ROOT, ".agents/skills/_shared/references"))
            .filter((name) => /^(context-|repository-context-)/.test(name));
        for (const dependency of [...scripts, ...references]) {
            expect(skill).toMatch(new RegExp(dependency.replaceAll(".", "\\.")));
        }
    });
});
