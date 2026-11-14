import {existsSync} from "node:fs";
import {dirname, resolve} from "node:path";

/**
 * Nearest ancestor containing `.git` — a directory in a normal checkout or a
 * file in a linked worktree. Returns null outside a repository.
 */
export function findRepositoryRoot(cwd = process.cwd()) {
    let current = resolve(cwd);
    while (true) {
        if (existsSync(resolve(current, ".git"))) { return current; }
        const parent = dirname(current);
        if (parent === current) { return null; }
        current = parent;
    }
}

/**
 * Repository root for storage and artifact paths, and for CLIs whose help,
 * argument errors or explicit-repository `gh` calls must work outside a
 * repository. Outside a repository the supplied directory is returned
 * unchanged, so Git commands report their own error.
 */
export function resolveRepositoryRoot(cwd = process.cwd()) {
    return findRepositoryRoot(cwd) ?? resolve(cwd);
}

/** Repository root for helpers that have nothing to do without a Git worktree. */
export function requireRepositoryRoot(cwd = process.cwd()) {
    const root = findRepositoryRoot(cwd);
    if (!root) {
        throw new Error(`Not inside a git repository: ${resolve(cwd)}`);
    }
    return root;
}
