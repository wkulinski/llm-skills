import {existsSync, lstatSync} from "node:fs";
import {dirname, isAbsolute, relative, resolve, sep} from "node:path";

const persistentDirectories = {
    "task-plan": "var/agent/task-plan",
    "plan-execute": "var/agent/plan-execute",
    "code-implement": "var/agent/code-implement",
};

function contains(root, candidate) {
    const suffix = relative(root, candidate);
    return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

function storageError(message) {
    const error = new Error(message);
    error.code = "INVALID_STORAGE_PATH";
    return error;
}

// Symlinks above the repository root (e.g. a logical `$PWD`) are outside the
// storage boundary; only directories from the root downwards are checked.
function assertDirectoryAncestors(directory, repositoryRoot) {
    let current = repositoryRoot;
    for (const part of relative(repositoryRoot, directory).split(sep).filter(Boolean)) {
        current = resolve(current, part);
        let stat;
        try {
            stat = lstatSync(current);
        } catch (error) {
            if (error.code === "ENOENT") { break; }
            throw error;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw storageError(`Storage path must use real directories without symlinks: ${current}`);
        }
    }
}

// Nearest ancestor containing `.git`; falls back to `cwd` outside a repository.
export function resolveRepositoryRoot(cwd = process.cwd()) {
    let current = resolve(cwd);
    while (true) {
        if (existsSync(resolve(current, ".git"))) { return current; }
        const parent = dirname(current);
        if (parent === current) { return resolve(cwd); }
        current = parent;
    }
}

// Validate the entire layout before either deletion or a durable write.
export function assertStorageLayout({cwd = process.cwd(), cachePath = process.env.CACHE_PATH || "var/agent/cache"} = {}) {
    const repositoryRoot = resolve(cwd);
    const cacheRoot = resolve(repositoryRoot, cachePath);
    const persistentRoots = Object.fromEntries(Object.entries(persistentDirectories)
        .map(([name, directory]) => [name, resolve(repositoryRoot, directory)]));
    const plansRoot = resolve(repositoryRoot, "docs/plans");
    if (cacheRoot === repositoryRoot || !contains(repositoryRoot, cacheRoot)) {
        throw storageError("CACHE_PATH must be strictly inside the consumer repository");
    }
    for (const protectedRoot of [...Object.values(persistentRoots), plansRoot]) {
        if (contains(cacheRoot, protectedRoot) || contains(protectedRoot, cacheRoot)) {
            throw storageError(`CACHE_PATH overlaps protected storage: ${protectedRoot}`);
        }
    }
    for (const directory of [cacheRoot, ...Object.values(persistentRoots), plansRoot]) {
        assertDirectoryAncestors(directory, repositoryRoot);
    }
    return {repositoryRoot, cacheRoot, persistentRoots, plansRoot};
}

export function resolvePersistentAgentRoot(name, cwd = process.cwd()) {
    if (!Object.hasOwn(persistentDirectories, name)) {
        throw storageError(`Unknown persistent storage: ${name}`);
    }
    return assertStorageLayout({cwd}).persistentRoots[name];
}

export function assertRepositoryFilePath(filePath, cwd = process.cwd()) {
    const repositoryRoot = resolve(cwd);
    const target = resolve(repositoryRoot, filePath);
    if (!contains(repositoryRoot, target)) { throw storageError("File must remain inside the consumer repository"); }
    assertDirectoryAncestors(resolve(target, ".."), repositoryRoot);
    try {
        const stat = lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw storageError(`Storage file must be regular, without symlinks: ${target}`);
        }
    } catch (error) {
        if (error.code !== "ENOENT") { throw error; }
    }
    return target;
}

export function assertPersistentAgentPath(name, filePath, cwd = process.cwd()) {
    const root = resolvePersistentAgentRoot(name, cwd);
    const target = assertRepositoryFilePath(filePath, cwd);
    if (!contains(root, target)) { throw storageError(`File must remain inside ${root}`); }
    return target;
}

export function resolveArtifactCacheRoot(cwd = process.cwd()) {
    const repositoryRoot = resolve(cwd);
    const configured = process.env.CACHE_PATH || "var/agent/cache";
    const cacheRoot = resolve(repositoryRoot, configured);
    const candidate = relative(repositoryRoot, cacheRoot);
    if (candidate.startsWith("..") || isAbsolute(candidate)) {
        const error = new Error("CACHE_PATH must resolve under the repository root");
        error.code = "INVALID_CACHE_PATH";
        throw error;
    }
    return cacheRoot;
}

export function allowedArtifactRoots(cwd = process.cwd()) {
    return [resolveArtifactCacheRoot(cwd)];
}

export function assertArtifactPath(filePath, label, cwd = process.cwd()) {
    if (typeof filePath !== "string" || filePath.trim() === "") {
        const error = new Error(`${label} path is required`);
        error.code = "INVALID_ARTIFACT_PATH";
        throw error;
    }
    const resolved = resolve(cwd, filePath);
    const allowed = allowedArtifactRoots(cwd).some((root) => {
        const candidate = relative(root, resolved);
        return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
    });
    if (!allowed) {
        const error = new Error(`${label} must be under repository-local CACHE_PATH`);
        error.code = "INVALID_ARTIFACT_PATH";
        throw error;
    }
    return resolved;
}
