import {spawnSync as nodeSpawnSync} from "node:child_process";

// Vitest timers cannot interrupt spawnSync: enforce the deadline in Node's
// subprocess API, including when a sandbox breaks stdin/stdout transport.
export function spawnSync(file, args, options = {}) {
    const result = nodeSpawnSync(file, args, {
        timeout: 10_000,
        ...options,
        killSignal: "SIGKILL",
    });
    if (result.error) {
        throw new Error(`Test subprocess failed (${result.error.code}): ${file} ${args.join(" ")}. Check subprocess/pipe permissions when running in a sandbox.`, {cause: result.error});
    }
    return result;
}
