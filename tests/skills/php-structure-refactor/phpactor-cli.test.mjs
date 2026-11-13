import {chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {afterEach, describe, expect, it} from "vitest";

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
                expect(result.stdout).toContain("unchanged");
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
                "class:move", "src/Old.php", "src/New.php",
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

const consumers = [];
afterEach(() => {
    for (const root of consumers.splice(0)) { rmSync(root, {force: true, recursive: true}); }
});

function consumer(backend, directory = "tools") {
    const root = mkdtempSync(path.join(os.tmpdir(), "phpactor isolated consumer "));
    consumers.push(root);
    initializeRepository(root);
    const bin = path.join(root, directory);
    mkdirSync(bin);
    writeFileSync(path.join(root, ".env"), `BIN_PATH=${directory}\n`);
    writeExecutable(path.join(bin, "phpactor"), backend);
    return root;
}

function invoke(root, args = ["class:move", "src/Old.php", "new directory/New.php"], env = {}) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: root,
        env: {...process.env, APP_ENV: "test", PHP_STRUCTURE_DEBUG: "0", ...env},
        encoding: "utf8",
        timeout: 10_000,
    });
}

describe("portable Phpactor result contract", () => {
    it("passes every argument literally without a status probe or path-existence heuristics", () => {
        const root = consumer(`#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync("calls.jsonl", JSON.stringify(process.argv.slice(2)) + "\\n");
console.log(JSON.stringify({args: process.argv.slice(2), cwd: process.cwd()}));
`);
        const args = ["class:move", "./src/Old.php", path.join(root, "new directory", "New.php"), "--file=./absent/subdir/Target.php"];
        const result = invoke(root, args, {PHP_STRUCTURE_TOOL_REPO_ROOT: "/ignored/foreign/root"});
        expect(result.status).toBe(0);
        expect(result.stderr).toBe("");
        const payload = JSON.parse(result.stdout);
        const expected = [...args, "--no-interaction", "--no-ansi"];
        expect(payload.args).toEqual(expected);
        expect(payload.json.args).toEqual(expected);
        expect(readFileSync(path.join(root, "calls.jsonl"), "utf8").trim().split("\n")).toHaveLength(1);
    });

    it("keeps the complete failure cause and backend status without debug", () => {
        const root = consumer(`#!/usr/bin/env node
process.stderr.write("cause-at-start\\n" + "x".repeat(120000) + "\\ncause-at-end\\n");
process.exit(37);
`);
        const result = invoke(root);
        expect(result.status).toBe(37);
        expect(result.stderr).toBe("");
        const payload = JSON.parse(result.stdout);
        expect(payload.ok).toBe(false);
        expect(payload.status).toBe(37);
        expect(payload.stderr).toBe(`cause-at-start\n${"x".repeat(120000)}\ncause-at-end`);
    });

    it("returns launch errors as one JSON instead of an uncaught exception", () => {
        const root = consumer("#!/missing/phpactor-interpreter\n");
        const result = invoke(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({ok: false, status: null, error: {code: "ENOENT"}});
    });

    it("reports a backend signal and exits unsuccessfully", () => {
        const root = consumer('#!/usr/bin/env node\nprocess.kill(process.pid, "SIGTERM");\n');
        const result = invoke(root);
        expect(result.status).toBe(1);
        expect(result.stderr).toBe("");
        expect(JSON.parse(result.stdout)).toMatchObject({ok: false, status: null, signal: "SIGTERM"});
    });

    it("keeps foreign output paths literal even when a matching local file exists", () => {
        const root = consumer(`#!/usr/bin/env node
console.log(JSON.stringify({path: "/backend/src/Existing.php", file: "src/Existing.php", own_path: process.cwd() + "/src/Existing.php"}));
`);
        mkdirSync(path.join(root, "src"));
        writeFileSync(path.join(root, "src/Existing.php"), "<?php\n");
        const payload = JSON.parse(invoke(root, ["class:reflect", "Demo\\Existing"]).stdout);
        expect(payload.json).toEqual({path: "/backend/src/Existing.php", file: "src/Existing.php", own_path: "src/Existing.php"});
    });

    it("runs two consumers concurrently with their own entrypoints, cwd and inherited markers", async () => {
        const backend = marker => `#!/usr/bin/env node
setTimeout(() => console.log(JSON.stringify({entrypoint: "${marker}", marker: process.env.CONSUMER_MARKER, cwd: process.cwd(), args: process.argv.slice(2)})), 50);
`;
        const first = consumer(backend("A"), "first-tools");
        const second = consumer(backend("B"), "second-tools");
        const run = (root, marker) => new Promise((resolve, reject) => {
            const child = spawn(process.execPath, [SCRIPT, "class:move", "src/Old.php", "absent/new folder/New.php"], {
                cwd: root,
                env: {...process.env, APP_ENV: "test", CONSUMER_MARKER: marker, BIN_PATH: "/ignored/installation/bin"},
            });
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", chunk => { stdout += chunk; });
            child.stderr.on("data", chunk => { stderr += chunk; });
            child.on("error", reject);
            child.on("close", status => { resolve({status, stdout, stderr}); });
        });
        const results = await Promise.all([run(first, "A"), run(second, "B")]);
        for (const [index, root] of [first, second].entries()) {
            const result = results[index];
            expect(result.status).toBe(0);
            expect(result.stderr).toBe("");
            const marker = index === 0 ? "A" : "B";
            expect(JSON.parse(result.stdout).json).toEqual({
                entrypoint: marker, marker, cwd: root,
                args: ["class:move", "src/Old.php", "absent/new folder/New.php", "--no-interaction", "--no-ansi"],
            });
        }
    });
});
