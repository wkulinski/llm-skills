import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {afterAll, beforeAll, describe, expect, it} from "vitest";

import {isMainModule} from "../../../.agents/skills/_shared/scripts/is-main-module.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SKILLS_ROOT = path.join(ROOT, ".agents/skills");

const ENTRYPOINTS = [
    "task-plan/scripts/source.mjs",
    "task-plan/scripts/store.mjs",
    "task-plan/scripts/validate.mjs",
    "task-plan/scripts/edit.mjs",
    "task-plan/scripts/review-cycle.mjs",
    "plan-execute/scripts/execute.mjs",
    "_shared/scripts/task-plan/source.mjs",
    "_shared/scripts/task-plan/store.mjs",
    "_shared/scripts/task-plan/validate.mjs",
];

let sandbox;
let linkedSkills;

beforeAll(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "is-main-module-"));
    linkedSkills = path.join(sandbox, "skills");
    fs.symlinkSync(SKILLS_ROOT, linkedSkills, "dir");
});

afterAll(() => {
    fs.rmSync(sandbox, {recursive: true, force: true});
});

function runScript(scriptPath) {
    const result = spawnSync(process.execPath, [scriptPath], {encoding: "utf8", cwd: sandbox});
    return {status: result.status, stdout: result.stdout, stderr: result.stderr};
}

describe("isMainModule", () => {
    const moduleFile = path.join(SKILLS_ROOT, "_shared/scripts/is-main-module.mjs");
    const moduleUrl = pathToFileURL(moduleFile).href;

    it("is true when the entrypoint is the module itself", () => {
        expect(isMainModule(moduleUrl, moduleFile)).toBe(true);
    });

    it("is true when the entrypoint is reached through a symlinked directory", () => {
        expect(isMainModule(moduleUrl, path.join(linkedSkills, "_shared/scripts/is-main-module.mjs"))).toBe(true);
    });

    it("is true when the entrypoint is a symlink to the module file", () => {
        const fileLink = path.join(sandbox, "module-link.mjs");
        fs.symlinkSync(moduleFile, fileLink, "file");

        expect(isMainModule(moduleUrl, fileLink)).toBe(true);
    });

    it("is true when the module URL itself is reached through a symlink", () => {
        const linkedUrl = pathToFileURL(path.join(linkedSkills, "_shared/scripts/is-main-module.mjs")).href;

        expect(isMainModule(linkedUrl, moduleFile)).toBe(true);
    });

    it("is false for a different entrypoint", () => {
        expect(isMainModule(moduleUrl, path.join(SKILLS_ROOT, "_shared/scripts/issue-branch.mjs"))).toBe(false);
    });

    it("is false for a different entrypoint reached through a symlink", () => {
        expect(isMainModule(moduleUrl, path.join(linkedSkills, "_shared/scripts/issue-branch.mjs"))).toBe(false);
    });

    it("is false without an entrypoint or when it does not exist", () => {
        expect(isMainModule(moduleUrl, undefined)).toBe(false);
        expect(isMainModule(moduleUrl, "")).toBe(false);
        expect(isMainModule(moduleUrl, path.join(sandbox, "missing.mjs"))).toBe(false);
    });
});

describe("task-plan and plan-execute CLI entrypoints", () => {
    it.each(ENTRYPOINTS)("%s runs its CLI when started by its real path", (entrypoint) => {
        const result = runScript(path.join(SKILLS_ROOT, entrypoint));

        expect(`${result.stdout}${result.stderr}`.trim(), "CLI must print usage or an error").not.toBe("");
    });

    it.each(ENTRYPOINTS)("%s runs the same CLI when started through a symlinked skills directory", (entrypoint) => {
        const direct = runScript(path.join(SKILLS_ROOT, entrypoint));
        const linked = runScript(path.join(linkedSkills, entrypoint));

        expect(linked).toEqual(direct);
    });

    it("does not run a CLI when a facade is only imported", async () => {
        const script = [
            `await import(${JSON.stringify(pathToFileURL(path.join(SKILLS_ROOT, "task-plan/scripts/validate.mjs")).href)});`,
            `await import(${JSON.stringify(pathToFileURL(path.join(linkedSkills, "task-plan/scripts/store.mjs")).href)});`,
        ].join("\n");
        const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {encoding: "utf8", cwd: sandbox});

        expect(result.status).toBe(0);
        expect(`${result.stdout}${result.stderr}`).toBe("");
    });
});

describe("entrypoint guard convention", () => {
    const FORBIDDEN_GUARDS = [
        /pathToFileURL\(\s*process\.argv\[1\]\s*\)/,
        /import\.meta\.url\s*===\s*`file:\/\/\$\{process\.argv\[1\]\}`/,
    ];

    function scriptFiles(directory) {
        return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return scriptFiles(entryPath);
            }
            return entry.name.endsWith(".mjs") ? [entryPath] : [];
        });
    }

    it("no skill script compares import.meta.url with the unresolved process.argv[1]", () => {
        const offenders = scriptFiles(SKILLS_ROOT)
            .filter((file) => FORBIDDEN_GUARDS.some((pattern) => pattern.test(fs.readFileSync(file, "utf8"))))
            .map((file) => path.relative(ROOT, file));

        expect(offenders, "Use isMainModule(import.meta.url) from _shared/scripts/is-main-module.mjs").toEqual([]);
    });
});
