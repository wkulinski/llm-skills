import {lstatSync} from "node:fs";
import {isAbsolute, relative, resolve, sep} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "./file-process.mjs";
import {fileURLToPath} from "node:url";
import {isMainModule} from "./is-main-module.mjs";
import {resolveRepositoryRoot} from "./repo-root.mjs";

export {resolveRepositoryRoot};

const ENV_LOADER = fileURLToPath(new URL("./env-load.sh", import.meta.url));
const projectCachePaths = new Map();
// Paths are positional arguments, never interpolated into shell source. Only
// the child loads project env; neither cwd nor env of the caller is mutated.
// Project env files are sourced as by other env-load.sh callers, without
// errexit/nounset, so an unrelated undefined reference does not block the cache.
const CACHE_PATH_SCRIPT = `set +eu
source "$1" >/dev/null || exit 1
ensure_repo_env_loaded "$2" >/dev/null || true
printf '%s' "\${CACHE_PATH:-var/agent/cache}"
`;
const MAX_DIAGNOSTIC_LENGTH = 200;

function cacheResolverError(detail) {
    const error = new Error(`Cannot resolve project CACHE_PATH through env-load.sh (${detail})`);
    error.code = "INVALID_CACHE_PATH";
    return error;
}

function resolverDiagnostic(result) {
    if (result.error) { return result.error.code ?? result.error.message; }
    const lastLine = (result.stderr ?? "").trim().split(/\r?\n/).at(-1)?.trim() ?? "";
    const detail = result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    return lastLine === "" ? detail : `${detail}: ${lastLine.slice(0, MAX_DIAGNOSTIC_LENGTH)}`;
}

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

function configuredCachePath(repositoryRoot) {
    if (!projectCachePaths.has(repositoryRoot)) {
        const env = {...process.env};
        delete env.CACHE_PATH;
        let result;
        try {
            result = spawnSync("bash", ["--noprofile", "--norc", "-c", CACHE_PATH_SCRIPT,
                "artifact-cache-root", ENV_LOADER, repositoryRoot], {
                cwd: repositoryRoot, env, encoding: "utf8", timeout: 10_000, killSignal: "SIGKILL",
            });
        } catch (error) {
            throw cacheResolverError(`capture dir in ${tmpdir()}: ${error.code ?? error.message}`);
        }
        if (result.error || result.status !== 0) {
            throw cacheResolverError(resolverDiagnostic(result));
        }
        projectCachePaths.set(repositoryRoot, result.stdout || "var/agent/cache");
    }
    return projectCachePaths.get(repositoryRoot);
}

// Validate the entire layout before either deletion or a durable write.
export function assertStorageLayout({cwd = process.cwd(), cachePath} = {}) {
    const repositoryRoot = resolveRepositoryRoot(cwd);
    const cacheRoot = resolve(repositoryRoot, cachePath ?? configuredCachePath(repositoryRoot));
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
    try {
        return assertStorageLayout({cwd}).cacheRoot;
    } catch (error) {
        error.code = "INVALID_CACHE_PATH";
        throw error;
    }
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

if (isMainModule(import.meta.url)) {
    try {
        if (process.argv[2] === "--help" || process.argv[2] === "-h") {
            process.stdout.write("Usage: artifact-path.mjs cache-root\nResolve repository-local cache from the consumer project's active env files.\n");
        } else if (process.argv.length === 3 && process.argv[2] === "cache-root") {
            process.stdout.write(`${resolveArtifactCacheRoot()}\n`);
        } else {
            throw new Error("Usage: artifact-path.mjs cache-root");
        }
    } catch (error) {
        process.stderr.write(`${error.code ?? "INVALID_CACHE_PATH"}: ${error.message}\n`);
        process.exitCode = 1;
    }
}
