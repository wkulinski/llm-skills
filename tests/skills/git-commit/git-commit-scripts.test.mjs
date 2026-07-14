import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {runSnapshotClean} from "../../../.agents/skills/git-commit/scripts/snapshot-clean.mjs";
import {runStagingSanity} from "../../../.agents/skills/git-commit/scripts/staging-sanity.mjs";

describe("git-commit scripts", () => {
    it("blocks only hard-risk staged paths", () => {
        const execCommand = (command, args) => {
            expect(command).toBe("git");
            expect(args).toEqual(["diff", "--cached", "--name-only"]);
            return {status: 0, stdout: [
                ".env.local",
                ".env.production",
                ".env.dev.local",
                ".env.loc",
                ".env.qa.loc",
                "var/cache/debug.log",
                "src/app.ts",
            ].join("\n"), stderr: ""};
        };

        const result = runStagingSanity({execCommand});

        expect(result.code).toBe(1);
        expect(result.stdout).toContain("STAGING_HARD_BLOCKS_PRESENT");
        expect(result.stdout).toContain("- .env.local");
        expect(result.stdout).toContain("- .env.dev.local");
        expect(result.stdout).toContain("- .env.loc");
        expect(result.stdout).toContain("- .env.qa.loc");
        expect(result.stdout).toContain("- var/cache/debug.log");
        expect(result.stdout).not.toContain(".env.production");
        expect(result.stdout).toContain("Do not unstage them automatically.");
    });

    it("allows ordinary project configuration in the default commit scope", () => {
        const execCommand = () => ({
            status: 0,
            stdout: ".opencode/tui.json\n.idea/codeStyles.xml\nsrc/app.ts\n",
            stderr: "",
        });

        expect(runStagingSanity({execCommand})).toEqual({
            code: 0,
            stdout: "STAGING_OK\n",
        });
    });

    it("reports an empty staging area", () => {
        const execCommand = () => ({status: 0, stdout: "\n", stderr: ""});

        expect(runStagingSanity({execCommand})).toEqual({
            code: 0,
            stdout: "STAGING_EMPTY\n",
        });
    });

    it("deletes the current snapshot and pointer", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-clean-test-"));
        try {
            const pointerFile = path.join(tempRoot, "pointer.txt");
            const snapshotDir = path.join(os.tmpdir(), "agent-git-commit-snapshot-test-123");
            mkdirSync(snapshotDir, {recursive: true});
            writeFileSync(path.join(snapshotDir, "marker.txt"), "ok\n", "utf-8");
            writeFileSync(pointerFile, `repo_root=${tempRoot}\nsnapshot_dir=${snapshotDir}\n`, "utf-8");

            const result = runSnapshotClean(["--current"], {pointerFile});

            expect(result).toEqual({
                code: 0,
                stdout: `${snapshotDir} (deleted)\n${pointerFile} (deleted)\n`,
            });
            expect(() => readFileSync(snapshotDir, "utf-8")).toThrow();
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
            rmSync(path.join(os.tmpdir(), "agent-git-commit-snapshot-test-123"), {force: true, recursive: true});
        }
    });

    it("refuses to delete non-snapshot paths", () => {
        const result = runSnapshotClean(["/tmp/not-a-snapshot"], {});

        expect(result.code).toBe(2);
        expect(result.stderr).toContain("Refusing to delete non-snapshot path: /tmp/not-a-snapshot");
    });
});
