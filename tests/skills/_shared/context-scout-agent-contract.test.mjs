import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const AGENTS_DIR = path.join(ROOT, ".opencode/agents");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function frontmatter(relativePath) {
    const match = read(relativePath).match(/^---\n([\s\S]*?)\n---/);
    return match ? match[1] : "";
}

function configBlock(source, key) {
    return source.match(new RegExp(`^([ \\t]*)${key}:[ \\t]*\\r?\\n((?:\\1[ \\t]+[^\\n]*(?:\\n|$))*)`, "m"))?.[2] ?? "";
}

function agentNames() {
    return fs.readdirSync(AGENTS_DIR)
        .filter((name) => name.endsWith(".md"))
        .map((name) => name.slice(0, -3))
        .sort();
}

// Reads the top-level keys of the `agent` section without loading JSONC.
function configuredAgentNames() {
    const config = read("opencode.jsonc");
    const start = config.indexOf('"agent": {');
    expect(start).toBeGreaterThan(-1);
    const names = [];
    let depth = 0;
    for (let index = config.indexOf("{", start); index < config.length; index += 1) {
        const character = config[index];
        if (character === "{") {
            depth += 1;
            continue;
        }
        if (character === "}") {
            depth -= 1;
            if (depth === 0) { break; }
            continue;
        }
        if (character !== '"') { continue; }

        let end = index + 1;
        while (end < config.length && config[end] !== '"') {
            end += config[end] === "\\" ? 2 : 1;
        }
        if (depth === 1 && /^:\s*\{/.test(config.slice(end + 1))) {
            names.push(config.slice(index + 1, end));
        }
        index = end;
    }
    return names;
}

// Returns the raw text of one `agent.<name>` entry using balanced braces, so
// nested option objects stay inside the extracted block.
function configuredAgentBlock(name) {
    const config = read("opencode.jsonc");
    const section = config.indexOf('"agent": {');
    expect(section).toBeGreaterThan(-1);
    const start = config.indexOf(`"${name}": {`, section);
    expect(start).toBeGreaterThan(-1);
    let depth = 0;
    for (let index = config.indexOf("{", start); index < config.length; index += 1) {
        if (config[index] === "{") { depth += 1; }
        if (config[index] === "}") {
            depth -= 1;
            if (depth === 0) { return config.slice(start, index + 1); }
        }
    }
    return "";
}

describe("OpenCode agent configuration", () => {
    it.each([
        ["context-scout-fast", "allow"],
        ["context-scout", "deny"],
    ])("keeps %s isolated with CMM=%s", (name, cmmAction) => {
        const permissions = configBlock(frontmatter(`.opencode/agents/${name}.md`), "permission");
        const rules = permissions.split(/\r?\n/).map(line => line.trim());

        for (const permission of ["bash", "task", "skill", "todowrite", "question", "webfetch"]) {
            expect(rules, name).toContain(`${permission}: deny`);
        }
        for (const permission of ["github_*", "context7_*", "mate_*", "serena*"]) {
            expect(rules, name).toContain(`"${permission}": deny`);
        }
        expect(rules, name).toContain(`"codebase-memory*": ${cmmAction}`);

        expect(rules, name).toContain("external_directory: allow");
        const edits = configBlock(permissions, "edit").split(/\r?\n/).map(line => line.trim());
        expect(edits, name).toContain('"*": deny');
        expect(edits, name).toContain(`"*-${name === "context-scout-fast" ? "primary" : "fallback"}.scout.json": allow`);
        const reads = configBlock(permissions, "read").split(/\r?\n/).map(line => line.trim());
        for (const artifact of ["report", "ledger"]) {
            expect(reads, name).toContain(`"**/*primary*.${artifact}.json": deny`);
        }
        expect(configBlock(permissions, "bash"), name).toBe("");
        if (name === "context-scout") {
            expect(reads).toContain('"**/*-primary.scout.json": deny');
        }
    });

    it("places read-only CMM mutation denials after the primary server allowance", () => {
        const permissions = frontmatter(".opencode/agents/context-scout-fast.md");
        const allowAt = permissions.indexOf('"codebase-memory*": allow');
        for (const tool of ["index_repository", "delete_project", "manage_adr", "ingest_traces"]) {
            expect(permissions.indexOf(`"codebase-memory_${tool}": deny`), tool).toBeGreaterThan(allowAt);
        }
    });

    it("keeps scout finalization shell-free and uses installation paths from dispatch", () => {
        for (const name of ["context-scout-fast", "context-scout"]) {
            const source = read(`.opencode/agents/${name}.md`);
            expect(source).toContain("absolutnej ścieżki");
            expect(source).toContain("scoutPath");
            expect(source).toContain("przez `write`");
            expect(source).toContain("`apply_patch`");
            expect(source).toContain('"scout_path"');
            expect(source).not.toMatch(/batch-render|add-evidence|zainicjalizuj ledger|node \.\/?\.agents/);
            expect(source).not.toContain('"report_path"');
        }
        const playbook = read(".agents/skills/_shared/references/repository-context-scout-playbook.md");
        const protocol = read(".agents/skills/_shared/references/context-scout-report-protocol.md").split("## Controller:")[0];
        for (const source of [playbook, protocol]) {
            expect(source).toContain("write");
            expect(source).not.toMatch(/^\s*node |outside the repository|<<'REPORT_JSON'/m);
        }
    });

    it("requires private CMM data/runtime and separately confirmed index readiness", () => {
        const source = read(".opencode/agents/context-scout-fast.md");
        for (const term of ["constraints", "odrębnego", "runtime", "gotowość", "nie odpytuj", "list_projects", "root_path", "alfabetycznie", "0.12.1"]) {
            expect(source, term).toContain(term);
        }
        expect(source).not.toMatch(/wykonaj dokładnie jedno.*index_repository/);
    });

    it("keeps refresher helpers installation-relative and permits external project access", () => {
        const source = read(".opencode/agents/context-refresher.md");
        expect(frontmatter(".opencode/agents/context-refresher.md")).toContain("external_directory: allow");
        expect(source).toContain("node <skills_root>/_shared/scripts/artifact-path.mjs cache-root");
        expect(source).toContain("node <skills_root>/_shared/scripts/context-manifest.mjs write --output <CACHE_PATH>/context-refresh/context-manifest.json");
        expect(source).not.toMatch(/node \.agents|\$CACHE_PATH/);
    });

    it("configures scout roles with a model and reasoning outside adapter frontmatter", () => {
        const config = read("opencode.jsonc");
        for (const name of ["context-scout-fast", "context-scout"]) {
            const block = configuredAgentBlock(name);
            expect(block).toMatch(/"model":/);
            expect(block).toMatch(/"variant"|"thinking"/);
        }
        expect(config).not.toMatch(/OPENCODE_AGENT_/);

        for (const agent of agentNames()) {
            const agentFrontmatter = frontmatter(`.opencode/agents/${agent}.md`);
            expect(config).toContain(`"${agent}": {`);
            expect(agentFrontmatter).not.toMatch(/^model:/m);
            expect(agentFrontmatter).not.toMatch(/^variant:/m);
            expect(agentFrontmatter).not.toMatch(/^\s*thinking:/m);
        }
    });

    it("keeps every configured agent backed by a file or a documented built-in", () => {
        const fileBacked = new Set(agentNames());
        const builtIns = new Set(["build", "title"]);

        for (const name of configuredAgentNames()) {
            if (fileBacked.has(name) || builtIns.has(name)) {
                continue;
            }
            throw new Error(`opencode.jsonc configures agent "${name}" without .opencode/agents/${name}.md and without a documented built-in exception.`);
        }
        expect(configuredAgentNames()).toEqual(expect.arrayContaining(["build", "context-scout-fast"]));
    });
});
