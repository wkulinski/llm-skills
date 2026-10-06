import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const CODE_REVIEW = ".agents/skills/code-review/SKILL.md";
const PLAN_REVIEW = ".agents/skills/code-review/references/plan-review.md";
const REVIEW_QUICK = ".agents/skills/review-quick/SKILL.md";
const TASK_PLAN = ".agents/skills/task-plan/SKILL.md";
const RE_REVIEW = ".agents/skills/code-review/references/re-review.md";

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

    it("checks evolving contracts for the exact resource and execution path", () => {
        const gate = section(read(CODE_REVIEW), "## 6. Verify candidate findings", "## 7. Review the review");

        expect(gate).toMatch(/evolving contract, establish which contract applies to the exact resource and the execution stage or supported path at issue/);
        expect(gate).toMatch(/historical implementation is not sufficient evidence that its assumptions still apply/);
        expect(gate).toMatch(/valid final state does not disprove a failure during a supported transition/);
        expect(gate).toMatch(/Bound this verification to the candidate and apply the existing evidence and classification requirements/);
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

    it("contracts the plan review as a read-only phase of the current agent", () => {
        const content = read(TASK_PLAN);
        const reviewSection = section(content, "### 5. Faza read-only code review planu", "### 6. Pytania blokujące");

        expect(reviewSection).toMatch(/odrębną fazą read-only bieżącego agenta, nie osobnym\s+wykonawcą/);
        expect(reviewSection).toMatch(/nie zmienia Markdowna, nie tworzy pytań, nie ustawia\s+statusu/);
        expect(reviewSection).toMatch(/review-cycle\.mjs/);
        expect(reviewSection).toMatch(/Nie\s+ocenia prawdziwości ocen semantycznych/);
        expect(content).toMatch(/deleguje fazy review do osobnego wykonawcy/);
    });

    it("bounds the owner decision with explicit assessments, one revision and a delta budget", () => {
        const reviewSection = section(read(TASK_PLAN), "### 5. Faza read-only code review planu", "### 6. Pytania blokujące");

        expect(reviewSection).toMatch(/Actionable `MINOR`/);
        expect(reviewSection).toMatch(/tabela werdyktów|Tabela werdyktów/i);
        expect(reviewSection).toMatch(/jedną spójną rewizję całego Markdowna/);
        expect(reviewSection).toMatch(/najwyżej trzy delta-review/);
        expect(reviewSection).toMatch(/progress gate/);
        expect(reviewSection).toMatch(/Hashe dokumentów identyfikują wersje dokumentu/);
        expect(reviewSection).toMatch(/jedną paczką operacji/);
    });

    it("contracts plan review as the current agent's phase, not a separate executor", () => {
        const content = read(CODE_REVIEW);
        const target = section(content, "## 1. Resolve review target and scope", "## 2. Establish expected behavior");

        expect(target).toMatch(/separate read-only phase performed by the current coordinating\s+agent, not a separate executor/);
        expect(target).toMatch(/phase separation is not a claim\s+of executor independence/);
        expect(read(PLAN_REVIEW)).toMatch(/A plan verdict is decided by this review, not inherited/);
    });

    it("routes plan-only review content to the conditional plan reference", () => {
        expect(read(CODE_REVIEW)).toContain(
            "| the target is `plan`: plan expected behavior, plan context, plan integrity, plan coverage and plan verdicts | `<skill_dir>/references/plan-review.md` |",
        );
    });

    it("requires explicit prior-finding resolutions and delta provenance in re-review", () => {
        const content = read(CODE_REVIEW);
        const resolutions = section(content, "### Finding resolutions", "### Verification");
        const reReview = read(RE_REVIEW);

        expect(resolutions).toMatch(/\*\*resolved\*\*/);
        expect(resolutions).toMatch(/\*\*current\*\*/);
        expect(resolutions).toMatch(/\*\*accepted\*\*/);
        expect(resolutions).toMatch(/A missing resolution is an incomplete review, not an implicit acceptance/);
        expect(reReview).toMatch(/starting from the changed sections\/work packages and\s+their direct dependencies supplied in the delta input/);
        expect(reReview).toMatch(/same failure mode and whether\s+new evidence exists/);
        expect(reReview).toMatch(/concrete provenance evidence from the fix or a direct dependency/);
        expect(reReview).toMatch(/identify document versions, not finding identity/);
        expect(content).toMatch(/a kept or\s+recurring finding keeps its prior ID/);
        expect(content).toMatch(/new finding gets the next number after\s+the highest prior ID/);
        expect(content).toMatch(/Never reuse an ID for a different failure mode/);
        expect(reReview).toMatch(/keep the prior ID/);
    });

    it("lets the root decide active-plan loading without opening the reference", () => {
        const context = section(read(CODE_REVIEW), "### Active-plan context for code", "## 2. Establish expected behavior");

        expect(context).toContain("`$" + "{CACHE_PATH:-var/agent/cache}/plan-execute/last-plan.txt`");
        expect(context).toMatch(/unless the caller's constraints forbid it, check whether/);
        expect(context).toMatch(/When the pointer exists, load the reference/);
        expect(context).toMatch(/pointer is missing or lookup is forbidden,\s+skip the reference/);
        expect(context).toMatch(/caller supplied a plan, load the reference; a caller's ban on\s+automatic lookup does not exclude a supplied plan/);
    });

    it("does not let a caveat verdict hide an actionable MINOR", () => {
        const planReview = read(PLAN_REVIEW);
        const verdicts = planReview.slice(planReview.indexOf("For a `plan` target, use plan-specific wording:"));

        expect(verdicts).toMatch(/PLAN READY WITH CAVEAT[^;]*non-actionable or explicitly accepted/);
        expect(verdicts).toMatch(/an actionable MINOR forces `PLAN CHANGES REQUESTED` instead/);
        expect(verdicts).toMatch(/`SUGGESTION` never changes the verdict or opens another round/);
        expect(verdicts).toMatch(/when its severity is `BLOCKER`, the verdict is `PLAN BLOCKED`/);
    });
});
