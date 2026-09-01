import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const SCRIPT = path.join(ROOT, ".agents/skills/php-structure-refactor/scripts/phpactor-cli.mjs");

function writeExecutable(filePath, content) {
    writeFileSync(filePath, content, "utf8");
    chmodSync(filePath, 0o755);
}

describe("phpactor CLI wrapper", () => {
    it("prints local help before repository or Phpactor resolution", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "phpactor-cli-help-test-"));
        try {
            const binDir = path.join(tempRoot, "bin");
            const gitMarker = path.join(tempRoot, "git-called.txt");
            const phpactorMarker = path.join(tempRoot, "phpactor-called.txt");
            mkdirSync(binDir);
            writeExecutable(path.join(binDir, "git"), "#!/usr/bin/env bash\nprintf 'called\\n' > \"$PHP_ACTOR_GIT_MARKER\"\nexit 1\n");
            writeExecutable(path.join(binDir, "phpactor"), "#!/usr/bin/env bash\nprintf 'called\\n' > \"$PHP_ACTOR_MARKER\"\nexit 1\n");

            const env = {
                ...process.env,
                APP_ENV: "test",
                BIN_PATH: binDir,
                PATH: `${binDir}:${process.env.PATH ?? ""}`,
                PHP_ACTOR_GIT_MARKER: gitMarker,
                PHP_ACTOR_MARKER: phpactorMarker,
            };
            for (const flag of ["--help", "-h"]) {
                const result = spawnSync(process.execPath, [SCRIPT, flag], {cwd: tempRoot, env, encoding: "utf8"});
                expect(result.status).toBe(0);
                expect(result.stderr).toBe("");
                expect(result.stdout).toContain("Usage:");
                expect(result.stdout).toContain("pass through");
                expect(result.stdout).toContain("normalized");
                expect(result.stdout).toContain("help <command>");
                expect(result.stdout).not.toMatch(/^\{/);
            }

            expect(existsSync(gitMarker)).toBe(false);
            expect(existsSync(phpactorMarker)).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("passes help command through to backend Phpactor", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "phpactor-cli-pass-through-test-"));
        try {
            const binDir = path.join(tempRoot, "bin");
            const marker = path.join(tempRoot, "phpactor-args.json");
            mkdirSync(binDir);
            writeExecutable(path.join(binDir, "phpactor"), `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(process.env.PHP_ACTOR_ARGS, JSON.stringify(process.argv.slice(2)));
process.stdout.write("BACKEND_HELP\\n");
`);

            const result = spawnSync(process.execPath, [SCRIPT, "help", "class:move"], {
                cwd: tempRoot,
                env: {
                    ...process.env,
                    APP_ENV: "test",
                    BIN_PATH: binDir,
                    PHP_ACTOR_ARGS: marker,
                },
                encoding: "utf8",
            });

            expect(result.status).toBe(0, result.stderr);
            expect(result.stderr).toBe("");
            expect(result.stdout).toContain("BACKEND_HELP");
            expect(result.stdout).not.toContain("Adapter behavior:");
            expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual([
                "help",
                "class:move",
                "--no-interaction",
                "--no-ansi",
            ]);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
