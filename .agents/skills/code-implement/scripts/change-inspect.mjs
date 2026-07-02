#!/usr/bin/env node
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";

export function splitGitLines(output) {
    return String(output ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

export function isCriticalFile(path) {
    switch (path) {
        case "composer.json":
        case "composer.lock":
        case "package.json":
        case "yarn.lock":
        case "Makefile":
            return true;
        default:
            return (
                path.startsWith("config/") ||
                path.startsWith(".github/") ||
                path.startsWith(".docker/") ||
                path.startsWith("bin/") ||
                path.startsWith("migrations/") ||
                path.startsWith("src/Migration/") ||
                path.startsWith("src/") && (
                    path.includes("/Domain/") ||
                    path.includes("/Infrastructure/") ||
                    path.includes("/UI/Controller/") ||
                    path.includes("/UI/Command/") ||
                    path.includes("/Api/")
                ) ||
                path.startsWith("config/routes") ||
                path.startsWith("config/packages/security.yaml") ||
                path.startsWith("config/packages/security/")
            );
    }
}

export function classifyChangeFiles(files, threshold = 15) {
    const uniqueFiles = [...new Set(files.filter(Boolean))].sort();
    const detectedTypes = {
        hasJsTs: false,
        hasPhp: false,
        hasStyle: false,
        hasTranslations: false,
        hasTwig: false,
        hasYaml: false,
    };
    const criticalFiles = [];

    for (const file of uniqueFiles) {
        if (file.endsWith(".php")) {
            detectedTypes.hasPhp = true;
        }
        if (file.endsWith(".twig")) {
            detectedTypes.hasTwig = true;
        }
        if (file.endsWith(".js") || file.endsWith(".jsx") || file.endsWith(".ts") || file.endsWith(".tsx")) {
            detectedTypes.hasJsTs = true;
        }
        if (file.endsWith(".css") || file.endsWith(".scss")) {
            detectedTypes.hasStyle = true;
        }
        if (file.endsWith(".yml") || file.endsWith(".yaml")) {
            detectedTypes.hasYaml = true;
        }
        if (file.startsWith("translations/") || file.startsWith("src/") && file.includes("/UI/Translation/")) {
            detectedTypes.hasTranslations = true;
        }
        if (isCriticalFile(file)) {
            criticalFiles.push(file);
        }
    }

    const reviewRequired = detectedTypes.hasPhp || detectedTypes.hasTwig || detectedTypes.hasJsTs || detectedTypes.hasStyle || detectedTypes.hasYaml || detectedTypes.hasTranslations;
    const isLargeChange = uniqueFiles.length >= threshold;

    return {
        criticalFiles,
        detectedTypes,
        fileCount: uniqueFiles.length,
        isLargeChange,
        reviewRequired,
        threshold,
        uniqueFiles,
    };
}

export function formatChangeInspectReport({
    classification,
    changedFilesCount,
    untrackedFilesCount,
}) {
    const {criticalFiles, detectedTypes, fileCount, isLargeChange, reviewRequired, threshold, uniqueFiles} = classification;

    return [
        `Changed files (tracked): ${changedFilesCount}`,
        `Untracked files: ${untrackedFilesCount}`,
        `Total unique (tracked+untracked): ${fileCount}`,
        "",
        "Detected types:",
        `  php=${Number(detectedTypes.hasPhp)} twig=${Number(detectedTypes.hasTwig)} js_ts=${Number(detectedTypes.hasJsTs)} style=${Number(detectedTypes.hasStyle)} yaml=${Number(detectedTypes.hasYaml)} translations=${Number(detectedTypes.hasTranslations)}`,
        "",
        "Gates:",
        `  review_required=${Number(reviewRequired)}`,
        `  large_change_threshold=${threshold}`,
        `  is_large_change=${Number(isLargeChange)}`,
        "",
        criticalFiles.length > 0
            ? [`Critical files touched (${criticalFiles.length}):`, ...criticalFiles.map((file) => `  - ${file}`)]
            : ["Critical files touched: none"],
        "",
        "All files:",
        ...uniqueFiles.map((file) => `  - ${file}`),
    ].flat().join("\n") + "\n";
}

export function buildChangeInspectReport({trackedFiles, untrackedFiles, threshold = 15}) {
    const tracked = [...new Set(trackedFiles.filter(Boolean))].sort();
    const untracked = [...new Set(untrackedFiles.filter(Boolean))].sort();
    const classification = classifyChangeFiles([...tracked, ...untracked], threshold);

    return formatChangeInspectReport({
        changedFilesCount: tracked.length,
        classification,
        untrackedFilesCount: untracked.length,
    });
}

export function collectChangeInspectFiles({cwd = process.cwd(), execFile = execFileSync} = {}) {
    const trackedFiles = splitGitLines(execFile("git", ["-C", cwd, "diff", "--name-only"], {encoding: "utf-8"}));
    const untrackedFiles = splitGitLines(execFile("git", ["-C", cwd, "ls-files", "--others", "--exclude-standard"], {encoding: "utf-8"}));
    return {trackedFiles, untrackedFiles};
}

export function parseThreshold(value = "15") {
    const threshold = Number.parseInt(String(value), 10);
    return Number.isNaN(threshold) ? 15 : threshold;
}

export function runChangeInspect({cwd = process.cwd(), thresholdArg = "15", execFile = execFileSync} = {}) {
    const threshold = parseThreshold(thresholdArg);
    const {trackedFiles, untrackedFiles} = collectChangeInspectFiles({cwd, execFile});
    return buildChangeInspectReport({trackedFiles, untrackedFiles, threshold});
}

async function main(argv) {
    const args = [...argv];
    const thresholdArg = args.shift() ?? "15";
    if (args.length > 0) {
        process.stderr.write(`Usage: change-inspect.mjs [threshold]\n`);
        return 2;
    }

    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {encoding: "utf-8"}).trim();
    process.stdout.write(runChangeInspect({cwd: repoRoot, thresholdArg}));
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    }).catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    });
}
