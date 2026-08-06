import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {normalizeReadObservation, READ_PURPOSES} from "../../../.agents/skills/_shared/scripts/read-purpose.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("read-purpose workflow contract", () => {
    it("publishes one shared vocabulary across the safety and context skills", () => {
        const documents = [
            read(".agents/skills/_shared/references/runtime-collaboration-guidelines.md"),
            read(".agents/skills/code-implement/SKILL.md"),
            read(".agents/skills/context-refresh/SKILL.md"),
            read(".agents/skills/_shared/references/context-subagent-contract.md"),
        ].join("\n");

        for (const purpose of ["discovery", "read-before-write", "verification", "snapshot-refresh", "report-gap"]) {
            expect(documents).toContain(purpose);
        }
        expect(documents).toContain("dirty`/`untracked");
        expect(READ_PURPOSES).toEqual(["discovery", "read-before-write", "verification", "snapshot-refresh", "report-gap"]);
        expect(normalizeReadObservation({purpose: "not-a-purpose", path: "src/example.mjs"}).valid).toBe(false);
    });

    it("keeps the structured event implementation discoverable from code-implement", () => {
        const skill = read(".agents/skills/code-implement/SKILL.md");
        expect(skill).toContain("_shared/scripts/read-purpose.mjs");
        expect(skill).toContain("--purpose");
        expect(skill).toContain("report-reuse");
    });
});
