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

function initializeRepository(cwd) {
    const result = spawnSync("git", ["init", "-q"], {cwd, encoding: "utf8", timeout: 10_000});
    expect(result.status).toBe(0, result.stderr);
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
            initializeRepository(tempRoot);
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

    it("uses the consumer Git root and env to move only the consumer file", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "phpactor consumer-"));
        const installationScript = readFileSync(SCRIPT, "utf8");
        try {
            initializeRepository(tempRoot);
            const binDir = path.join(tempRoot, "tools");
            const sourceDir = path.join(tempRoot, "src");
            const cwd = path.join(tempRoot, "workspace");
            const marker = path.join(tempRoot, "backend.json");
            for (const directory of [binDir, sourceDir, cwd]) { mkdirSync(directory); }
            writeFileSync(path.join(tempRoot, ".env"), "BIN_PATH=tools\n");
            writeFileSync(path.join(sourceDir, "Old.php"), "<?php class Original {}\n");
            writeExecutable(path.join(binDir, "phpactor"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "status") {
    console.log("Working directory: " + process.cwd());
    process.exit(0);
}
fs.writeFileSync(process.env.PHP_ACTOR_RECORD, JSON.stringify({cwd: process.cwd(), args}));
fs.renameSync(args[1], args[2]);
console.log(JSON.stringify({moved: true}));
`);

            const result = spawnSync(process.execPath, [SCRIPT, "class:move", "src/Old.php", "src/New.php"], {
                cwd,
                env: {
                    ...process.env,
                    APP_ENV: "test",
                    BIN_PATH: path.join(ROOT, "missing-installation-tools"),
                    PHP_STRUCTURE_TOOL_REPO_ROOT: "",
                    PHP_ACTOR_RECORD: marker,
                },
                encoding: "utf8",
                timeout: 10_000,
            });

            expect(result.status).toBe(0, result.stderr);
            expect(JSON.parse(result.stdout).ok).toBe(true);
            const backend = JSON.parse(readFileSync(marker, "utf8"));
            expect(backend.cwd).toBe(tempRoot);
            expect(backend.args).toEqual([
                "class:move", path.join(sourceDir, "Old.php"), path.join(sourceDir, "New.php"),
                "--no-interaction", "--no-ansi",
            ]);
            expect(existsSync(path.join(sourceDir, "Old.php"))).toBe(false);
            expect(readFileSync(path.join(sourceDir, "New.php"), "utf8")).toBe("<?php class Original {}\n");
            expect(existsSync(path.join(tempRoot, ".agents"))).toBe(false);
            expect(readFileSync(SCRIPT, "utf8")).toBe(installationScript);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
