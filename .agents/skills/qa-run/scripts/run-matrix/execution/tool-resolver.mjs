import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";

const SKILLS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ENV_LOAD_PATH = path.join(SKILLS_ROOT, "_shared/scripts/env-load.sh");
// Fixed script; the env helper path and tool name are passed as positional arguments, never as shell code.
const RESOLVE_SCRIPT = 'source "$1" && resolve_tool_cmd "$2"';

export function resolveToolExecutable(repoRoot, tool, envLoadPath = ENV_LOAD_PATH) {
    const resolved = spawnSync("bash", ["-c", RESOLVE_SCRIPT, "qa-run-resolve-tool", envLoadPath, tool], {
        cwd: repoRoot,
        encoding: "utf-8",
    });
    const executable = resolved.status === 0 ? resolved.stdout.split("\n")[0].trim() : "";
    if (executable.length === 0) {
        throw new Error(`Unable to resolve targeted test tool: ${tool}`);
    }

    return executable;
}
