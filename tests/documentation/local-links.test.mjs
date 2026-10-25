import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {afterEach, describe, expect, it} from "vitest";
import {checkDocumentationLinks, publicDocumentationPaths} from "../helpers/documentation-links.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const temporary = [];
const fixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-links-"));
    temporary.push(root);
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs/guide(v2).md"), "# Hello `world`\n# Hello world\n# Zażółć\n<a id=\"explicit\"></a>\n");
    return root;
};
afterEach(() => { for (const root of temporary.splice(0)) { fs.rmSync(root, {recursive: true, force: true}); } });

describe("public documentation local links", () => {
    it("checks every Git-visible public Markdown page, including new guides", () => {
        const documents = publicDocumentationPaths(ROOT);
        expect(documents).toEqual(expect.arrayContaining(["README.md", "SECURITY.md", "docs/INSTALLATION.md"]));
        expect(checkDocumentationLinks(ROOT, documents)).toEqual([]);
    });

    it("resolves relative/root links, images, encoded paths, fragments and reference definitions", () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "README.md"), [
            "[inline](docs/guide(v2).md#hello-world)",
            "[angle](<docs/guide(v2).md#hello-world-1> \"title\")",
            "![image](/docs/guide%28v2%29.md#zażółć)",
            "[full][guide] [guide][] [guide]",
            "[guide]: docs/guide(v2).md#explicit \"Title\"",
            '<a href="docs/guide(v2).md">HTML</a>',
            "[root](/README.md#top)",
            "# Top",
        ].join("\n"));
        expect(checkDocumentationLinks(root, ["README.md"])).toEqual([]);
    });

    it.each([
        ["[broken](missing.md)", "missing local target: missing.md"],
        ["![](missing.png)", "missing local target: missing.png"],
        ["[bad anchor](docs/guide(v2).md#unknown)", "missing heading/anchor:"],
        ["[reference][undefined]", "undefined link reference [undefined]"],
        ["[encoded](bad%QQ.md)", "invalid URL encoding:"],
        ["[outside](../private.md)", "local link escapes repository:"],
        ["[placeholder](<docs/<module>/README.md>)", "placeholder link must be a code example:"],
    ])("reports a source location for %s", (link, expected) => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "README.md"), `# Test\n\n${link}\n`);
        expect(checkDocumentationLinks(root, ["README.md"])).toEqual([expect.stringContaining(`README.md:3: ${expected}`)]);
    });

    it("does not treat consumer paths, placeholders, code and external URLs as repo source links", () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "README.md"), [
            "Consumer path: `docs/modules/<module>/README.md` or `<CACHE_PATH>/state.md`.",
            "`[example](consumer/missing.md)`",
            "```md", "[consumer](docs/plans/<id>.md)", "```",
            "~~~~bash", "[example](missing.md)", "~~~~",
            "<!-- [comment](missing.md) -->",
            "[external](https://invalid.example.test/unreachable)",
            "[mail](mailto:nobody@example.invalid) [protocol](//invalid.example.test)",
        ].join("\n"));
        expect(checkDocumentationLinks(root, ["README.md"])).toEqual([]);
    });

    it("includes new public pages but excludes ignored private docs and instruction trees", () => {
        const root = fixture();
        execFileSync("git", ["init", "--quiet", root]);
        fs.mkdirSync(path.join(root, "docs/plans"));
        fs.mkdirSync(path.join(root, ".agents"));
        fs.writeFileSync(path.join(root, ".gitignore"), "docs/plans/\n");
        fs.writeFileSync(path.join(root, "docs/plans/private.md"), "[private](missing.md)");
        fs.writeFileSync(path.join(root, ".agents/SKILL.md"), "[instruction](missing.md)");
        fs.writeFileSync(path.join(root, "README.md"), "# Fixture\n");
        expect(publicDocumentationPaths(root)).toEqual(["README.md", "docs/guide(v2).md"]);
        fs.writeFileSync(path.join(root, "README.md"), "[private plan](docs/plans/private.md)\n");
        expect(checkDocumentationLinks(root, ["README.md"])).toEqual([
            "README.md:1: local target is not Git-visible (ignored/private): docs/plans/private.md",
        ]);
    });

    it("decodes escaped filename delimiters separately and does not invent anchors from fenced examples", () => {
        const root = fixture();
        fs.writeFileSync(path.join(root, "docs/hash#file.md"), "# Real\n```md\n# Fake\n```\n");
        fs.writeFileSync(path.join(root, "README.md"), "[valid](docs/hash%23file.md#real)\n[invalid](docs/hash%23file.md#fake)\n");
        expect(checkDocumentationLinks(root, ["README.md"])).toEqual([
            "README.md:2: missing heading/anchor: docs/hash%23file.md#fake",
        ]);
    });
});
