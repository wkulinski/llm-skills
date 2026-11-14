import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {afterEach, describe, expect, it} from "vitest";

import {
    findRepositoryRoot,
    requireRepositoryRoot,
    resolveRepositoryRoot,
} from "../../../.agents/skills/_shared/scripts/repo-root.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SKILLS_ROOT = path.join(ROOT, ".agents/skills");
const temporaryRoots = [];

function temporaryDirectory(prefix = "repo-root-") {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    temporaryRoots.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryRoots.splice(0)) {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

describe("repository root resolver", () => {
    it("finds the nearest root from a nested directory", () => {
        const root = temporaryDirectory();
        fs.mkdirSync(path.join(root, ".git"));
        const nested = path.join(root, "src", "nested");
        fs.mkdirSync(nested, {recursive: true});

        expect(findRepositoryRoot(nested)).toBe(root);
        expect(requireRepositoryRoot(nested)).toBe(root);
        expect(resolveRepositoryRoot(nested)).toBe(root);
    });

    it("accepts a linked worktree whose .git entry is a file", () => {
        const root = temporaryDirectory();
        fs.writeFileSync(path.join(root, ".git"), "gitdir: /tmp/example\n", "utf8");

        expect(findRepositoryRoot(root)).toBe(root);
        expect(requireRepositoryRoot(root)).toBe(root);
    });

    it("falls back to the supplied directory only for non-strict resolution", () => {
        const outside = temporaryDirectory();

        expect(findRepositoryRoot(outside)).toBeNull();
        expect(resolveRepositoryRoot(outside)).toBe(outside);
        expect(() => requireRepositoryRoot(outside)).toThrow(/Not inside a git repository/);
    });

    it("does not derive the consumer root from the skill installation path", () => {
        const scripts = [
            "gh-issue-review/scripts/finish.mjs",
            "gh-issue-start/scripts/start.mjs",
            "gh-issue-status-set/scripts/set-status.mjs",
            "git-commit/scripts/staging-sanity.mjs",
        ];

        for (const relativePath of scripts) {
            const source = fs.readFileSync(path.join(SKILLS_ROOT, relativePath), "utf8");
            expect(source, relativePath).toMatch(/\b(?:require|resolve)RepositoryRoot\(/);
            expect(source, relativePath).not.toMatch(/new URL\(\s*["']\.\.\/\.\.\/\.\.\/\.\.\//);
        }
    });

    it("prints help and rejects bad arguments outside a repository", () => {
        const outside = temporaryDirectory("repo-root-cli-");
        const scripts = [
            "gh-issue-review/scripts/finish.mjs",
            "gh-issue-start/scripts/start.mjs",
            "gh-issue-status-set/scripts/set-status.mjs",
        ];

        for (const relativePath of scripts) {
            const script = path.join(SKILLS_ROOT, relativePath);
            const help = spawnSync(process.execPath, [script, "--help"], {cwd: outside, encoding: "utf8"});
            expect(help.status, `${relativePath}: ${help.stderr}`).toBe(0);
            expect(help.stdout, relativePath).toMatch(/^(?:Usage|Użycie):/);

            const invalid = spawnSync(process.execPath, [script, "--unknown-option"], {cwd: outside, encoding: "utf8"});
            expect(invalid.status, `${relativePath}: ${invalid.stderr}`).toBe(2);
            expect(invalid.stderr, relativePath).not.toContain("Not inside a git repository");
        }
    });
});
