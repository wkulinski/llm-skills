import {matchGlob} from "./glob.mjs";
import {gitLines} from "../change-detection/working-tree.mjs";

export function collectPatternFiles(repoRoot, resolvedPatterns) {
    const visibleFiles = listGitVisibleFiles(repoRoot);
    if (resolvedPatterns.includeGitVisible) {
        return visibleFiles;
    }

    return visibleFiles
        .filter((filePath) => resolvedPatterns.patterns.some((pattern) => matchGlob(pattern, filePath)))
        .sort();
}

export function listGitVisibleFiles(repoRoot) {
    const tracked = gitLines(repoRoot, ["ls-files"]);
    const untracked = gitLines(repoRoot, ["ls-files", "--others", "--exclude-standard"]);
    return [...new Set([...tracked, ...untracked])].sort();
}
