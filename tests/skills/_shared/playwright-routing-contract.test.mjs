import {readFileSync, readdirSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SKILLS = path.join(ROOT, ".agents/skills");
const REFERENCE = "_shared/references/playwright-cli-verification.md";
const PREPARE = "_shared/scripts/playwright-access-prepare.sh";

function read(relativePath) {
    return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("shared Playwright routing", () => {
    it("keeps the portable shared contract self-contained without a project AGENTS.md", () => {
        const contract = read(`.agents/skills/${REFERENCE}`);
        expect(contract).toContain("## Routing dla skilli");
        expect(contract).toContain(`bash <skills_root>/${PREPARE}`);
        expect(contract).toContain("--protected");
        expect(contract).not.toContain("AGENTS.md");
    });

    it("routes every skill mentioning Playwright to the same shared contract and prepare script", () => {
        const consumers = [];
        for (const entry of readdirSync(SKILLS, {withFileTypes: true})) {
            if (!entry.isDirectory() || entry.name === "_shared") { continue; }
            let source;
            try {
                source = read(`.agents/skills/${entry.name}/SKILL.md`);
            } catch {
                continue;
            }
            if (!/playwright/i.test(source)) { continue; }
            consumers.push(entry.name);
            const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
            expect(frontmatter, entry.name).toContain(`- ${REFERENCE}`);
            expect(frontmatter, entry.name).toContain(`- ${PREPARE}`);
            expect(source, entry.name).not.toMatch(/\bbash\s+[^\n]*playwright-(?:preflight|auth-bootstrap)\.sh/);
        }
        expect(consumers).toEqual(expect.arrayContaining([
            "code-implement", "code-review", "frontend-ui-consistency", "review-quick",
        ]));
    });

    it("keeps a single prepare entrypoint and never suggests navigating before state-load", () => {
        const contract = read(`.agents/skills/${REFERENCE}`);
        const checkpoint = contract.match(/```bash\nAPP_SESSION=[\s\S]*?```/)?.[0] ?? "";
        expect(contract).toContain("playwright-access-prepare.sh --protected");
        expect(contract).toContain("Access: BLOCKED");
        expect(contract).not.toMatch(/\bbash\s+[^\n]*playwright-(?:preflight|auth-bootstrap)\.sh/);
        expect(checkpoint.indexOf('state-load "$STATE_FILE"')).toBeGreaterThan(-1);
        expect(checkpoint.indexOf('goto "$RESOLVED_APPLICATION_URL"')).toBeGreaterThan(checkpoint.indexOf('state-load "$STATE_FILE"'));
        expect(contract).not.toContain('open "$RESOLVED_APPLICATION_URL"');
        expect(contract).toContain('"$PW_CLI" -s="$APP_SESSION" detach');
    });
});
