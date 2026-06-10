import {matchGlob} from "./glob.mjs";

function detectActiveSections(files, config, mode) {
    const active = {};
    const runKind = mode === "full" ? "full" : "rerun";

    for (const sectionName of config.sectionOrder) {
        const section = config.sections[sectionName];
        active[sectionName] = isSectionActive(section, files, runKind);
    }

    return active;
}

function isSectionActive(section, files, runKind) {
    if (!section.runOn.includes(runKind)) {
        return false;
    }

    if (section.name === "ALWAYS_FULL") {
        return runKind === "full";
    }

    if (section.name === "ALWAYS_ON_RERUN") {
        return runKind === "rerun" && files.length > 0;
    }

    return files.some((file) => matchesResolvedPatterns(section.resolvedPatterns, file));
}

function matchesResolvedPatterns(resolvedPatterns, filePath) {
    if (resolvedPatterns.includeGitVisible) {
        return true;
    }

    return resolvedPatterns.patterns.some((pattern) => matchGlob(pattern, filePath));
}

function getActiveSectionNames(activeSections) {
    return Object.entries(activeSections)
        .filter(([, isActive]) => isActive)
        .map(([sectionName]) => sectionName);
}

export {
    detectActiveSections,
    getActiveSectionNames,
    isSectionActive,
    matchesResolvedPatterns,
};
