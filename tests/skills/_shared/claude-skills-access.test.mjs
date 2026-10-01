import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SKILLS_ROOT = path.join(ROOT, ".agents/skills");
const CLAUDE_SKILLS = path.join(ROOT, ".claude/skills");
const EXPECTED_LINK_TARGET = "../.agents/skills";

// `.claude/skills` is a local, git-ignored link; a fresh checkout may not have it yet.
const claudeEntry = lstatOrNull(CLAUDE_SKILLS);

describe("local Claude Code skills access", () => {
    it.skipIf(claudeEntry === null)("is a relative symlink to the single .agents/skills source", () => {
        expect(claudeEntry.isSymbolicLink(), ".claude/skills must be a symlink, not a copy or a foreign entry").toBe(true);
        expect(fs.readlinkSync(CLAUDE_SKILLS)).toBe(EXPECTED_LINK_TARGET);
        expect(fs.realpathSync(CLAUDE_SKILLS)).toBe(fs.realpathSync(SKILLS_ROOT));
    });

    it.skipIf(claudeEntry === null)("resolves every skill and _shared to the same physical files", () => {
        const failures = [];

        for (const name of [...skillNames(), "_shared"]) {
            const viaClaude = path.join(CLAUDE_SKILLS, name);
            const source = path.join(SKILLS_ROOT, name);
            if (!fs.existsSync(viaClaude)) {
                failures.push(`${name}: not reachable through .claude/skills`);
                continue;
            }
            if (fs.realpathSync(viaClaude) !== fs.realpathSync(source)) {
                failures.push(`${name}: resolves outside the .agents/skills source`);
            }
        }

        expect(failures, ["Unresolved Claude skills:", ...failures].join("\n")).toEqual([]);
    });
});

function lstatOrNull(filePath) {
    try {
        return fs.lstatSync(filePath);
    } catch (error) {
        if (error.code === "ENOENT") { return null; }
        throw error;
    }
}

function skillNames() {
    return fs.readdirSync(SKILLS_ROOT, {withFileTypes: true})
        .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(SKILLS_ROOT, entry.name, "SKILL.md")))
        .map((entry) => entry.name);
}
