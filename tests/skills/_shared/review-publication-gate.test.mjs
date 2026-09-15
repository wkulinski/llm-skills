import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const CODE_REVIEW = ".agents/skills/code-review/SKILL.md";
const REVIEW_QUICK = ".agents/skills/review-quick/SKILL.md";

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function section(content, startHeading, endHeading) {
    const start = content.indexOf(startHeading);
    const end = content.indexOf(endHeading);
    if (start === -1 || end === -1 || end <= start) {
        throw new Error(`missing section boundary: ${startHeading} .. ${endHeading}`);
    }
    return content.slice(start, end);
}

describe("review publication gate", () => {
    it("defines the ordered publication gate with its five elements in section 6", () => {
        const gate = section(read(CODE_REVIEW), "## 6. Verify candidate findings", "## 7. Review the review");

        expect(gate).toMatch(/ordered publication gate/);
        expect(gate).toMatch(/\*\*observation\*\*/);
        expect(gate).toMatch(/\*\*authoritative source of expected behavior\*\*/);
        expect(gate).toMatch(/\*\*demonstrated consequence or contract violation\*\*/);
        expect(gate).toMatch(/\*\*strongest counterargument considered\*\*/);
        expect(gate).toMatch(/\*\*classification\*\*/);
        expect(gate).toMatch(/`finding`, `QUESTION`, `SUGGESTION`, or rejected candidate/);
    });

    it("forbids auxiliary-channel verdicts and pseudo-verification", () => {
        const content = read(CODE_REVIEW);

        expect(content).toMatch(/not independent verification of interpretation/);
        expect(content).toMatch(/Re-reading\s+the same location, running a test that the candidate itself points to, or passing\s+the report's structural validation do not, by themselves, establish/);
        expect(content).toMatch(/Candidates supplied by auxiliary channels/);
        expect(content).toMatch(/never carry a verdict\s+with them/);
        expect(content).toMatch(/unverified candidates and must pass the same\s+gate/);
    });

    it("scopes plan or work-package expectations to the mapped scope", () => {
        const gate = section(read(CODE_REVIEW), "## 6. Verify candidate findings", "## 8. Coverage");

        expect(gate).toMatch(/A plan or work package is a source of expected\s+behavior only for the scope it actually maps to/);
        expect(gate).toMatch(/does not authorize\s+expectations for behavior outside that mapped scope/);
    });

    it("keeps the gate inside existing sections without a new process section", () => {
        const content = read(CODE_REVIEW);
        const depth = section(content, "## 4. Assess risk and choose review depth", "## 5. Deep review contract");
        const review = section(content, "## 7. Review the review", "## 8. Coverage");

        expect(depth).toMatch(/publication gate in Section 6 applies at every depth/);
        expect(review).toMatch(/strongest counterargument you actually\s+considered/);
        expect(review).toMatch(/explicitly discarded as a rejected candidate/);
    });

    it("declares review-quick as the only in-agent quick review without delegation or verdict", () => {
        const content = read(REVIEW_QUICK);

        expect(content).toMatch(/jedyną procedurą szybkiego review/);
        expect(content).toMatch(/wykonuje ją bieżący agent/);
        expect(content).toMatch(/nie inicjuje delegacji/);
        expect(content).toMatch(/nie jest formalnym werdyktem/);
        expect(content).toMatch(/bramki publikacji `\$code-review`/);
    });
});
