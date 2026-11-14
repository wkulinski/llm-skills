import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {parseDocument} from "yaml";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

// Match the frontmatter envelope and parser settings used by LSM.
function validateFrontmatter(content, filename) {
    const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(content);
    if (!match) { return [`${filename}: missing or unterminated YAML frontmatter`]; }
    const document = parseDocument(match[1]);
    if (document.errors.length > 0) {
        return document.errors.map(error => {
            const position = error.linePos?.[0];
            const location = position ? `${position.line + 1}:${position.col}` : "2";
            return `${filename}:${location}: ${error.message.split(" at line ")[0]}`;
        });
    }
    try {
        const data = document.toJS({maxAliasCount: 0});
        return data && typeof data === "object" && !Array.isArray(data)
            ? [] : [`${filename}: frontmatter must be a mapping`];
    } catch (error) {
        return [`${filename}: ${error.message}`];
    }
}

function frontmatterFiles() {
    const skills = path.join(ROOT, ".agents/skills");
    const agents = path.join(ROOT, ".opencode/agents");
    const skillFiles = fs.readdirSync(skills, {withFileTypes: true})
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(skills, entry.name, "SKILL.md"))
        .filter(filename => fs.existsSync(filename));
    const agentFiles = fs.readdirSync(agents)
        .filter(filename => filename.endsWith(".md"))
        .map(filename => path.join(agents, filename));
    return [...skillFiles, ...agentFiles].sort();
}

describe("YAML frontmatter syntax", () => {
    it("parses every delivered skill and OpenCode agent with the LSM YAML parser", () => {
        const files = frontmatterFiles();
        expect(files.some(filename => filename.endsWith("SKILL.md"))).toBe(true);
        expect(files.some(filename => filename.endsWith("context-scout.md"))).toBe(true);
        const errors = files.flatMap(filename => validateFrontmatter(fs.readFileSync(filename, "utf8"), path.relative(ROOT, filename)));
        expect(errors, errors.join("\n")).toEqual([]);
    });

    it("rejects the unquoted colon-space regression with the source file and line", () => {
        const errors = validateFrontmatter("---\ndescription: Read-only scout: mapuje źródła\n---\n# Markdown\n", "scout.md");
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatch(/^scout\.md:2:\d+: Nested mappings/);
    });

    it.each([
        'description: "Read-only scout: mapuje źródła"',
        "description: >-\n  Read-only scout: mapuje źródła",
    ])("accepts valid description syntax: %s", description => {
        expect(validateFrontmatter(`---\n${description}\n---\n# Markdown: [not YAML\n`, "scout.md")).toEqual([]);
    });

    it.each(["# no frontmatter", "---\ndescription: unterminated"])("rejects a missing or unclosed header", content => {
        expect(validateFrontmatter(content, "scout.md")[0]).toContain("missing or unterminated");
    });
});
