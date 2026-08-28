import {isAbsolute, relative, resolve} from "node:path";

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
