import path from "node:path";

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
    const rawCachePath = stripWrappingQuotes(process.env.CACHE_PATH ?? "var/agent/cache");
    return path.isAbsolute(rawCachePath)
        ? rawCachePath
        : path.join(repoRoot, rawCachePath);
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
