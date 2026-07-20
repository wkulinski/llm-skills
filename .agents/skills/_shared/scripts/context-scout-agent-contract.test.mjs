import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../../");
const PLAYBOOK = ".agents/skills/_shared/references/repository-context-scout-playbook.md";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("both repository-context adapters require the shared playbook and retain safety guards", () => {
    assert.equal(fs.existsSync(path.join(ROOT, PLAYBOOK)), true);
    for (const agent of [".opencode/agent/context-scout-fast.md", ".opencode/agent/context-scout.md"]) {
        const content = read(agent);
        assert.match(content, /repository-context-scout-playbook\.md/);
        assert.match(content, /Nie deleguj agentów/);
        assert.match(content, /Nie uruchamiaj `context-scout-hybrid-run\.mjs`/);
        assert.match(content, /Zapisz raport dokładnie/);
        assert.match(content, /skill: deny/);
        assert.match(content, /task: deny/);
        assert.match(content, /"\*": deny/);
        assert.match(content, /context-criteria\.mjs validate \*": allow/);
        assert.match(content, /context-scout-report-builder\.mjs \*": allow/);
        assert.match(content, /"github_\*": deny/);
        assert.match(content, /"context7_\*": deny/);
        assert.match(content, /"mate_\*": deny/);
    }
});

test("primary and fallback keep only their role-specific discovery strategies", () => {
    const primary = read(".opencode/agent/context-scout-fast.md");
    const fallback = read(".opencode/agent/context-scout.md");
    assert.match(primary, /codebase-memory-mcp jako pierwszej warstwy/);
    assert.match(primary, /"codebase-memory\*": allow/);
    assert.match(primary, /`index_repository` w trybie `full`/);
    assert.doesNotMatch(primary, /`index_repository` w trybie `moderate`/);
    assert.match(primary, /DELEGATE_FALLBACK/);
    assert.match(fallback, /niezależnym fallbackiem/);
    assert.match(fallback, /Nie czytaj raportu, błędów, metadanych ani ustaleń primary/);
    assert.match(fallback, /"codebase-memory\*": deny/);
    assert.doesNotMatch(fallback, /codebase-memory-mcp jako pierwszej warstwy/);
});

test("shared playbook owns input validation, evidence and report construction", () => {
    const playbook = read(PLAYBOOK);
    assert.match(playbook, /context-handoff\.mjs validate/);
    assert.match(playbook, /context-manifest\.mjs verify/);
    assert.match(playbook, /context-scout-report-builder\.mjs/);
    assert.match(playbook, /maksymalnie 12 findings/);
    assert.match(playbook, /Nie deleguj agentów/);
});

test("hybrid task prompt explicitly requires the shared playbook", () => {
    const helper = read(".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs");
    assert.match(helper, /repository-context-scout-playbook\.md/);
});

test("routing algorithm has one canonical source", () => {
    const canonical = read(".agents/skills/_shared/references/repository-context-hybrid.md");
    assert.match(canonical, /DELEGATE_FALLBACK/);
    for (const reference of [
        "AGENTS.md",
        ".agents/skills/code-implement/SKILL.md",
        ".agents/skills/_shared/references/context-subagent-contract.md",
    ]) {
        const content = read(reference);
        assert.match(content, /repository-context-hybrid\.md/);
        assert.doesNotMatch(content, /DELEGATE_FALLBACK/);
    }
});

test("code-implement publishes every shared repository-context dependency", () => {
    const skill = read(".agents/skills/code-implement/SKILL.md");
    const scripts = fs.readdirSync(path.join(ROOT, ".agents/skills/_shared/scripts"))
        .filter((name) => /^(context-criteria|context-handoff|context-manifest|context-scout)/.test(name));
    const references = fs.readdirSync(path.join(ROOT, ".agents/skills/_shared/references"))
        .filter((name) => /^(context-|repository-context-)/.test(name));
    for (const dependency of [...scripts, ...references]) {
        assert.match(skill, new RegExp(dependency.replaceAll(".", "\\.")), `missing shared_files entry: ${dependency}`);
    }
});
