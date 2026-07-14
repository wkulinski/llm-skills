#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {fileURLToPath, pathToFileURL} from "node:url";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

export function createExecutor({cwd = repoRoot} = {}) {
    return (command, args, options = {}) => spawnSync(command, args, {
        cwd,
        encoding: "utf-8",
        shell: false,
        ...options,
    });
}

function run(command, args, execCommand) {
    const result = execCommand(command, args);
    return {
        code: result.status ?? 1,
        stderr: String(result.stderr ?? ""),
        stdout: String(result.stdout ?? ""),
    };
}

function splitLines(output) {
    return String(output ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

function isHardBlocked(path) {
    return (
        path === ".env.local"
        || /^\.env\.[^/]+\.local$/.test(path)
        || path === ".env.loc"
        || /^\.env\.[^/]+\.loc$/.test(path)
        || /^var\//.test(path)
        || /^\/var\//.test(path)
        || /^node_modules\//.test(path)
        || /\.log$/.test(path)
        || /\.cache$/.test(path)
    );
}

export function runStagingSanity({execCommand = createExecutor()} = {}) {
    const stagedResult = run("git", ["diff", "--cached", "--name-only"], execCommand);
    const staged = splitLines(stagedResult.stdout);

    if (staged.length === 0) {
        return {code: 0, stdout: "STAGING_EMPTY\n"};
    }

    const blocked = [...new Set(staged.filter(isHardBlocked))].sort();
    if (blocked.length > 0) {
        return {
            code: 1,
            stdout: [
                "STAGING_HARD_BLOCKS_PRESENT",
                ...blocked.map((path) => `- ${path}`),
                "",
                "Resolve these paths explicitly before committing. Do not unstage them automatically.",
                "",
            ].join("\n"),
        };
    }

    return {code: 0, stdout: "STAGING_OK\n"};
}

async function main() {
    const result = runStagingSanity();
    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }
    process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
