import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const CODE_REVIEW = ".agents/skills/code-review/SKILL.md";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function section(content, startHeading, endHeading) {
    const start = content.indexOf(startHeading);
    const end = content.indexOf(endHeading, start + 1);
    if (start === -1 || end === -1) {
        throw new Error(`missing section boundary: ${startHeading} .. ${endHeading}`);
    }
    return content.slice(start, end);
}

function inventorySection() {
    return section(read(CODE_REVIEW), "### Read change inventory", "### Active-plan context for code");
}

describe("code-review supplied snapshot", () => {
    it("reviews a supplied snapshot without rebuilding the inventory", () => {
        const inventory = inventorySection();

        expect(inventory).toMatch(/When the caller supplies a prepared snapshot \(an inventory with its fingerprint,\s+separate staged and unstaged diffs, and untracked paths\), review that snapshot\s+without rebuilding the inventory/);
        expect(inventory).toMatch(/judge staged changes from the supplied\s+staged diff/);
    });

    it("lets the caller's constraints override conflicting methodology steps", () => {
        const inventory = inventorySection();

        expect(inventory).toMatch(/The caller's constraints override conflicting steps of this\s+methodology/);
        expect(inventory).toMatch(/a check the caller forbids running becomes a `verification_gap`\s+that limits the verdict/);
        expect(read(CODE_REVIEW)).toMatch(/unless the caller's\s+constraints forbid it, check whether/);
    });

    it("ends as INCOMPLETE when essential input is missing", () => {
        expect(inventorySection()).toMatch(/When essential input is missing, end the review as\s+`INCOMPLETE` with a concrete request for that input/);
    });

    it("states the supplied-snapshot rule in exactly one place", () => {
        expect(read(CODE_REVIEW).match(/When the caller supplies a prepared snapshot/g)).toHaveLength(1);
    });
});
