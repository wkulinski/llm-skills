import fs from "node:fs";
import {fileURLToPath} from "node:url";

/**
 * Whether the module at `moduleUrl` is the Node entrypoint.
 *
 * Both sides are resolved to real paths, so a script started through a symlink
 * (for example `.claude/skills` pointing at `.agents/skills`) still counts as
 * the entrypoint. Comparing `import.meta.url` with the unresolved
 * `process.argv[1]` fails in that case and silently skips the CLI.
 *
 * @param {string} moduleUrl `import.meta.url` of the calling module.
 * @param {string|undefined} [entryPath] Entrypoint path; defaults to `process.argv[1]`.
 * @returns {boolean}
 */
export function isMainModule(moduleUrl, entryPath = process.argv[1]) {
    if (!entryPath) {
        return false;
    }
    try {
        return fs.realpathSync(entryPath) === fs.realpathSync(fileURLToPath(moduleUrl));
    } catch {
        return false;
    }
}
