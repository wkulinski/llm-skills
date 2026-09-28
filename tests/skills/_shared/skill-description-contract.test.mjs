import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SKILLS_ROOT = path.join(ROOT, ".agents/skills");
const MAX_DESCRIPTION_LENGTH = 300;
const USAGE_TRIGGER = "Użyj, gdy";
const FORBIDDEN_QA_POLICY_PHRASES = ["bez pełnego", "poza jednoznacznym"];
const QA_RUN_ALIAS = "$qa-run";

describe("skill description contract", () => {
    const skills = skillFiles().map((filePath) => ({filePath, ...readSkill(filePath)}));

    it("discovers every SKILL.md with frontmatter", () => {
        expect(skills.length).toBeGreaterThan(0);

        const failures = skills
            .filter((skill) => skill.frontmatter === null)
            .map((skill) => `${relative(skill.filePath)}: missing YAML frontmatter`);

        expect(failures, failureMessage("Skills without frontmatter", failures)).toEqual([]);
    });

    it("provides a non-empty description for every skill", () => {
        const failures = skills
            .filter((skill) => skill.description === null || skill.description === "")
            .map((skill) => `${relative(skill.filePath)}: missing or empty description`);

        expect(failures, failureMessage("Skills without description", failures)).toEqual([]);
    });

    it(`keeps every description at most ${MAX_DESCRIPTION_LENGTH} characters`, () => {
        const failures = skills
            .filter((skill) => skill.description !== null && skill.description.length > MAX_DESCRIPTION_LENGTH)
            .map((skill) => `${relative(skill.filePath)}: ${skill.description.length} > ${MAX_DESCRIPTION_LENGTH}`);

        expect(failures, failureMessage("Descriptions exceeding the limit", failures)).toEqual([]);
    });

    it(`includes the usage trigger "${USAGE_TRIGGER}" in every description`, () => {
        const failures = skills
            .filter((skill) => skill.description !== null && !skill.description.includes(USAGE_TRIGGER))
            .map((skill) => `${relative(skill.filePath)}: missing "${USAGE_TRIGGER}"`);

        expect(failures, failureMessage("Descriptions without usage trigger", failures)).toEqual([]);
    });

    it("does not leak QA policy phrases into descriptions", () => {
        const failures = [];
        for (const skill of skills) {
            if (skill.description === null) { continue; }
            for (const phrase of FORBIDDEN_QA_POLICY_PHRASES) {
                if (skill.description.includes(phrase)) {
                    failures.push(`${relative(skill.filePath)}: contains "${phrase}"`);
                }
            }
        }

        expect(failures, failureMessage("Descriptions with QA policy phrases", failures)).toEqual([]);
    });

    it("keeps the qa-run activation alias", () => {
        const qaRun = skills.find((skill) => skill.name === "qa-run");

        expect(qaRun, "qa-run skill must exist").toBeDefined();
        expect(qaRun.description).toContain(QA_RUN_ALIAS);
    });
});

function skillFiles() {
    return fs.readdirSync(SKILLS_ROOT, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(SKILLS_ROOT, entry.name, "SKILL.md"))
        .filter((filePath) => fs.existsSync(filePath));
}

function readSkill(filePath) {
    const frontmatter = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
    return {
        name: frontmatter === null ? null : parseName(frontmatter),
        frontmatter,
        description: frontmatter === null ? null : parseDescription(frontmatter),
    };
}

function parseFrontmatter(source) {
    const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    return match ? match[1] : null;
}

function parseName(frontmatter) {
    const match = frontmatter.match(/^name:[ \t]*(.*?)[ \t]*$/m);
    return match ? stripQuotes(match[1]) : null;
}

function parseDescription(frontmatter) {
    const lines = frontmatter.split(/\r?\n/);
    const index = lines.findIndex((line) => /^description:[ \t]*/.test(line));
    if (index === -1) { return null; }

    const inline = lines[index].replace(/^description:[ \t]*/, "").trim();
    if (isBlockIndicator(inline)) {
        return readBlockScalar(lines.slice(index + 1));
    }
    return stripQuotes(inline);
}

function isBlockIndicator(value) {
    return value === ">" || value === ">-" || value === "|" || value === "|-";
}

function readBlockScalar(lines) {
    const block = [];
    for (const line of lines) {
        if (/^\s+\S/.test(line)) {
            block.push(line.trim());
            continue;
        }
        if (line.trim() === "") {
            block.push("");
            continue;
        }
        break;
    }
    return block.join(" ").replace(/\s+/g, " ").trim();
}

function stripQuotes(value) {
    return value.replace(/^(['"])(.*)\1$/, "$2");
}

function failureMessage(title, failures) {
    return failures.length === 0 ? title : [title, ...failures].join("\n");
}

function relative(filePath) {
    return path.relative(ROOT, filePath);
}
