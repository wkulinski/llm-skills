import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const SMOKE = "tests/skills/claude-review/claude-review.integration.test.mjs";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("claude-review smoke gate", () => {
    it("runs the live review only after an explicit opt-in", () => {
        const source = read(SMOKE);

        expect(source).toMatch(/const SMOKE_ENABLED = process\.env\.CLAUDE_REVIEW_SMOKE === "1";/);
        expect(source).toMatch(/describe\.skipIf\(!SMOKE_ENABLED\)/);
    });

    it("requires explicit launch parameters instead of defaults", () => {
        const source = read(SMOKE);

        for (const name of ["CLAUDE_REVIEW_MODEL", "CLAUDE_REVIEW_THINKING", "CLAUDE_REVIEW_TIMEOUT_SECONDS"]) {
            expect(source).toContain(`requiredEnv("${name}")`);
        }
    });

    it("never enables the smoke from npm scripts", () => {
        expect(read("package.json")).not.toContain("CLAUDE_REVIEW_SMOKE");
    });
});
