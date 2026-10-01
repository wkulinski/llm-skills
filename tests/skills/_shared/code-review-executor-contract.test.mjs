import fs from "node:fs";
import path from "node:path";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const CODE_REVIEW = ".agents/skills/code-review/SKILL.md";
const ROUTING = ".agents/skills/_shared/references/skill-routing-policy.md";

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

function executorRole() {
    return section(read(CODE_REVIEW), "### Execution role", "### Read change inventory");
}

describe("code-review execution roles", () => {
    it("keeps coordinator as the default and limits executor to the code target", () => {
        const role = executorRole();

        expect(role).toMatch(/`coordinator` \(default\)/);
        expect(role).toMatch(/valid only\s+for the `code` target/);
        expect(role).toMatch(/For `plan`, or when the target is unclear, do not\s+review: return `INCOMPLETE`/);
    });

    it("forbids executor orchestration, delegation, and commands", () => {
        const role = executorRole();

        expect(role).toMatch(/does not regenerate the inventory, follow the active-plan pointer/);
        expect(role).toMatch(/run `\$context-refresh` or the repository-context hybrid, invoke other skills or\s+agents, start Paseo sessions, or run commands/);
    });

    it("works from supplied context and judges staged changes from their own diff", () => {
        const role = executorRole();

        expect(role).toMatch(/separate staged diff, a separate unstaged diff, untracked paths/);
        expect(role).toMatch(/judges staged changes from the supplied staged diff/);
    });

    it("reports missing input and unrun checks instead of collecting or faking them", () => {
        const role = executorRole();

        expect(role).toMatch(/records a `verification_gap`, and limits the verdict/);
        expect(role).toMatch(/returns\s+`INCOMPLETE` with a concrete request for the missing input/);
    });

    it("shares the methodology and report structure with the coordinator", () => {
        const role = executorRole();

        expect(role).toMatch(/Sections 2–11 stay shared/);
        expect(role).toMatch(/transport envelope added by the delegating\s+workflow does not replace that structure/);
    });

    it("makes the coordinator verify executor candidates without full rediscovery", () => {
        const gate = section(read(CODE_REVIEW), "## 6. Verify candidate findings", "## 7. Review the review");

        expect(gate).toMatch(/report from a reviewer in the\s+`executor` role/);
        expect(gate).toMatch(/without a new full discovery pass, and decides the verdict itself/);
    });

    it("never routes user intent to the executor role", () => {
        expect(read(ROUTING)).toMatch(/`execution_role: executor` nie jest wybierana z intencji użytkownika/);
    });
});
