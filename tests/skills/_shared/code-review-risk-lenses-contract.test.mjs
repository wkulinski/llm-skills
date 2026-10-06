import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const CODE_REVIEW = ".agents/skills/code-review/SKILL.md";
const CHECKLISTS = ".agents/skills/code-review/references/review-checklists.md";

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

describe("code-review risk lenses", () => {
    it("routes runtime lifecycle risk to the reactivity and feedback-loop checklist", () => {
        const root = read(CODE_REVIEW);
        const lens = section(read(CHECKLISTS), "### Reactivity, lifecycle and feedback loops", "### Performance");
        const routing = root.split("\n").find((line) => line.includes("`<skill_dir>/references/review-checklists.md`")) ?? "";
        const depth = section(root, "## 4. Assess risk and choose review depth", "### Complexity/value gate");

        expect(lens).toMatch(/react to changes\s+made by the mechanism itself or by its own dependencies/);
        expect(lens).toMatch(/`NOT_VERIFIED` coverage entry, not a\s+silent assumption/);
        expect(routing).toContain("reactivity, lifecycle and feedback loops");
        expect(depth).toMatch(/framework\/runtime lifecycle behavior \(see "Reactivity, lifecycle and feedback\s+loops"/);
    });

    it("does not count a test double replacing the source of risk as coverage", () => {
        const tests = section(read(CHECKLISTS), "### Tests and verification", "#### Durable tests versus one-off change verification");

        expect(tests).toMatch(/a test that fully replaces that dependency with a double is\s+not evidence for that risk/);
        expect(tests).toMatch(/record a `verification_gap` naming the missing\s+scenario/);
        expect(tests).toMatch(/A double remains\s+legitimate for behavior that is not the source of risk/);
    });

    it("compares twin components and checks dependent values", () => {
        const checklists = read(CHECKLISTS);
        const correctness = section(checklists, "### Correctness and propagation", "### Contracts and integrations");
        const state = section(checklists, "### State, persistence, and data flow", "### Security and privacy");

        expect(correctness).toMatch(/compare their handling\s+of domain errors and exceptions/);
        expect(correctness).toMatch(/An unjustified asymmetry is a candidate finding/);
        expect(correctness).toMatch(/when the parent value of a field, form, or state changes/);
        expect(state).toMatch(/dependent values in the interface and in forms/);
    });

    it("enumerates consumers of a shared unit or records them as not covered", () => {
        const correctness = section(read(CHECKLISTS), "### Correctness and propagation", "### Contracts and integrations");
        const scope = section(read(CODE_REVIEW), "Record internally:", "Do not begin forming findings");

        expect(correctness).toMatch(/enumerate its consumers\s+by searching for the registration mechanism the project uses/);
        expect(correctness).toMatch(/Consumers of a\s+shared unit that were not enumerated are a `NOT_COVERED` entry/);
        expect(scope).toContain("- shared units with multiple consumers");
    });

    it("limits the verdict when any high-risk area was not verified", () => {
        const root = read(CODE_REVIEW);
        const verdict = section(root, "## 10. Verdict", "## 11. Output format");
        const mechanical = section(root, "### Mechanical verification", "## 7. Review the review");

        expect(verdict).toMatch(/`verification_gap` or `NOT_COVERED` entry in any area that Section 4 marked as\s+high risk excludes an unconditional `PASS`/);
        expect(verdict).toMatch(/cannot be established\s+whether a material invariant holds and that affects acceptance of the reviewed\s+change, use `DISCUSS`/);
        expect(mechanical).toMatch(/a change to the interactions of code\s+running in the browser when Section 4 selected the reactivity lens/);
        expect(mechanical).toMatch(/A runtime gap described in Section 10 still\s+limits the verdict/);
    });

    it("runs a pre-mortem before the verdict without changing the publication gate", () => {
        const review = section(read(CODE_REVIEW), "## 7. Review the review", "## 8. Coverage");

        expect(review).toMatch(/name the single\s+most likely way the change could break user-visible or operational behavior/);
        expect(review).toMatch(/When no such control exists, record a\s+`verification_gap` or `NOT_COVERED`/);
        expect(review).toMatch(/passes the publication gate from Section 6 with its\s+five elements unchanged/);
        expect(review).toMatch(/For a high-risk change, also name the most\s+severe plausible failure when it differs from the most likely one/);
        expect(review).toMatch(/Did removed code remove a guard, validation, or authorization check\?/);
        expect(review).toMatch(/Was a test skipped or removed, or an assertion weakened\?/);
        expect(review).toMatch(/Every candidate from these questions passes the Section 6 publication gate\s+unchanged/);
    });
});
