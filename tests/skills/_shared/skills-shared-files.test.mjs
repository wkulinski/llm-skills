import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SKILLS_ROOT = path.join(ROOT, ".agents/skills");

describe("skill shared_files contract", () => {
    it("resolves every declared shared file to an existing regular file", () => {
        const failures = [];

        for (const skillFile of skillFiles()) {
            const sharedFiles = parseSharedFiles(fs.readFileSync(skillFile, "utf8"), skillFile);
            for (const declaredPath of sharedFiles) {
                const resolvedPath = resolveSharedFile(declaredPath, skillFile);
                if (!resolvedPath.ok) {
                    failures.push(`${skillFile}: ${resolvedPath.error}`);
                    continue;
                }
                if (!fs.existsSync(resolvedPath.path)) {
                    failures.push(`${skillFile}: missing ${declaredPath} -> ${resolvedPath.path}`);
                    continue;
                }
                if (!fs.statSync(resolvedPath.path).isFile()) {
                    failures.push(`${skillFile}: not a regular file ${declaredPath} -> ${resolvedPath.path}`);
                }
            }
        }

        expect(failures, ["Invalid shared_files references:", ...failures].join("\n")).toEqual([]);
    });

    it("rejects shared file paths that escape the skills root", () => {
        const skillFile = path.join(SKILLS_ROOT, "example", "SKILL.md");

        expect(resolveSharedFile("../outside.md", skillFile)).toMatchObject({
            ok: false,
            error: expect.stringContaining("escapes skills root"),
        });
        expect(resolveSharedFile("/tmp/outside.md", skillFile)).toMatchObject({
            ok: false,
            error: expect.stringContaining("must be repository-relative"),
        });
    });

    it("parses the shared_files list from skill frontmatter", () => {
        expect(parseSharedFiles("---\nname: example\nshared_files:\n  - _shared/foo.mjs\n  - _shared/bar.md\n---\n", "example/SKILL.md")).toEqual([
            "_shared/foo.mjs",
            "_shared/bar.md",
        ]);
    });
});

function skillFiles() {
    return fs.readdirSync(SKILLS_ROOT, {withFileTypes: true})
        .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
        .map((entry) => path.join(SKILLS_ROOT, entry.name, "SKILL.md"))
        .filter((filePath) => fs.existsSync(filePath));
}

function parseSharedFiles(source, skillFile) {
    const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
    if (!frontmatter) { throw new Error(`${skillFile}: missing YAML frontmatter`); }

    const lines = frontmatter[1].split("\n");
    const start = lines.findIndex((line) => /^\s*shared_files:\s*$/.test(line));
    if (start === -1) { return []; }

    const values = [];
    for (const line of lines.slice(start + 1)) {
        const item = line.match(/^\s+-\s+(.+?)\s*$/);
        if (item) {
            values.push(item[1].replace(/^['"]|['"]$/g, ""));
            continue;
        }
        if (/^\s+/.test(line) || line.trim() === "") { continue; }
        break;
    }
    return values;
}

function resolveSharedFile(declaredPath, skillFile) {
    if (path.isAbsolute(declaredPath)) {
        return {ok: false, error: `${declaredPath} must be repository-relative`};
    }
    const resolvedPath = path.resolve(SKILLS_ROOT, declaredPath);
    const relativePath = path.relative(SKILLS_ROOT, resolvedPath);
    if (relativePath === "" || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        return {ok: false, error: `${declaredPath} escapes skills root`};
    }
    return {ok: true, path: resolvedPath, skillFile};
}
