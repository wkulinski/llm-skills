import path from "node:path";
import {resolveArtifactCacheRoot} from "../../../../_shared/scripts/artifact-path.mjs";

export function resolveRepoPath(repoRoot, maybeAbsPath) {
    return path.isAbsolute(maybeAbsPath)
        ? maybeAbsPath
        : path.join(repoRoot, maybeAbsPath);
}

export function sanitizePathPart(value) {
    return value
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80) || "command";
}

export function toRepoRelativePath(repoRoot, absPath) {
    return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

export function getCacheRoot(repoRoot) {
    return resolveArtifactCacheRoot(repoRoot);
}

export function stripWrappingQuotes(value) {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }

    return trimmed;
}

export function formatDateForPath(date) {
    return date.toISOString()
        .replace(/[-:]/g, "")
        .replace(/\..+$/, "")
        .replace("T", "-");
}
