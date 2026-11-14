import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");
describe("single scout adapter contract", () => {
    it("delivers one role with file-read fallback and native report writes", () => {
        expect(fs.existsSync(path.join(ROOT, ".opencode/agents/context-scout-fast.md"))).toBe(false);
        const source = read(".opencode/agents/context-scout.md");
        const front = source.split("---")[1];
        expect(front).not.toMatch(/steps:|model:|variant:/);
        expect(front).toContain('"*.scout.json": allow');
        expect(front).toContain('"*": deny');
        expect(front).toContain('"codebase-memory*": allow');
        for (const command of ["rg", "sed", "head", "tail", "cat", "ls"]) {
            expect(front).toContain(`"${command} *": allow`);
        }
        for (const operation of ["task", "skill", "todowrite", "question", "webfetch"]) {
            expect(front).toContain(`${operation}: deny`);
        }
        for (const tool of ["index_repository", "delete_project", "manage_adr", "ingest_traces"]) {
            expect(front.indexOf(`"codebase-memory_${tool}": deny`)).toBeGreaterThan(front.indexOf('"codebase-memory*": allow'));
        }
        expect(source).toContain("tej samej rozmowie");
        expect(source).toContain("write"); expect(source).toContain("apply_patch");
        expect(source).not.toMatch(/CLAIM_FALLBACK|hybrid prepare|steps: 48/);
    });
    it("keeps all configured role files and distribution declarations consistent", () => {
        const config = read("opencode.jsonc");
        expect(config).not.toContain('"context-scout-fast"');
        for (const role of fs.readdirSync(path.join(ROOT, ".opencode/agents")).filter(x => x.endsWith(".md"))) {
            expect(config).toContain(`"${role.slice(0, -3)}": {`);
        }
        const distribution = JSON.parse(read("distribution/linux-opencode/manifest.json"));
        expect(distribution.requiredRoles).toEqual(["context-refresher", "context-scout"]);
    });
    it("makes the policy portable and separates numeric quotas from source validity", () => {
        const policy = read(".agents/skills/_shared/references/repository-context.md");
        expect(policy).toContain("same scout agent/session");
        expect(policy).toContain("no automatic");
        for (const mechanism of ["task", "Agent", "spawn_agent"]) { expect(policy).toContain(mechanism); }
        expect(policy).toContain("do not fork");
        expect(policy).toContain("NO_REPAIR_PROGRESS");
        expect(policy).toContain("snapshot change aborts");
    });
});
