import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

import {fingerprintDirtyFile} from "../change-detection/working-tree.mjs";
import {collectPatternFiles} from "../patterns/pattern-files.mjs";
import {hashJson} from "../shared/hashing.mjs";
import {getCacheRoot} from "../shared/paths.mjs";

export const CACHE_VERSION = 1;

export function prepareCommandCache(repoRoot, section, command, config, cli) {
    if (cli.noCache || cli.rerunReason !== "post-fix-delta" && cli.rerunReason !== "review-fix-delta") {
        return {enabled: false};
    }

    if (!section.cache.enabled) {
        return {enabled: false};
    }

    return createCommandCache(repoRoot, buildCommandCacheFingerprint(repoRoot, section, command, config));
}

export function prepareCompletedCommandCache(repoRoot, section, command, config, startedCache) {
    const completedCache = createCommandCache(
        repoRoot,
        buildCommandCacheFingerprint(repoRoot, section, command, config)
    );

    return {
        ...completedCache,
        beforeFingerprint: startedCache.fingerprint,
        mutatedInputs: startedCache.fingerprint.cacheKey !== completedCache.fingerprint.cacheKey,
    };
}

export function createCommandCache(repoRoot, fingerprint) {
    const cacheRoot = path.join(getCacheRoot(repoRoot), "qa-run", "cache", `v${CACHE_VERSION}`);
    return {
        enabled: true,
        fingerprint,
        path: path.join(cacheRoot, `${fingerprint.cacheKey}.json`),
    };
}

export function buildCommandCacheFingerprint(repoRoot, section, command, config) {
    const inputFiles = collectPatternFiles(repoRoot, section.resolvedPatterns);
    const inputFingerprints = {};
    for (const filePath of inputFiles) {
        inputFingerprints[filePath] = fingerprintDirtyFile(repoRoot, filePath);
    }
    const env = {};
    for (const key of section.cache.envKeys) {
        env[key] = process.env[key] ?? null;
    }

    const material = {
        cacheVersion: CACHE_VERSION,
        command: command.cmd,
        env,
        inputFingerprints,
        patternSets: section.resolvedPatterns.patternSets,
        patterns: section.resolvedPatterns.patterns,
        matrixHash: hashJson(config.raw),
        section: section.name,
    };

    return {
        cacheKey: hashJson(material),
        envHash: hashJson(env),
        inputFilesHash: hashJson(inputFingerprints),
        patternSets: section.resolvedPatterns.patternSets,
        patterns: section.resolvedPatterns.patterns,
        materialHash: hashJson(material),
    };
}

export function readCommandCache(commandCache) {
    if (!existsSync(commandCache.path)) {
        return null;
    }

    let parsed;
    try {
        parsed = JSON.parse(readFileSync(commandCache.path, "utf-8"));
    } catch {
        return null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
    }

    if (
        parsed.version !== CACHE_VERSION
        || parsed.status !== "PASS"
        || parsed.fingerprint?.cacheKey !== commandCache.fingerprint.cacheKey
    ) {
        return null;
    }

    return parsed;
}

export function buildCachedCommandResult(section, command, cacheHit, logs) {
    return {
        cache: {
            beforeCacheKey: cacheHit.beforeFingerprint?.cacheKey ?? cacheHit.fingerprint.cacheKey,
            cacheKey: cacheHit.fingerprint.cacheKey,
            hit: true,
            mutatedInputs: cacheHit.mutatedInputs === true,
            previousArtifactsDir: cacheHit.artifactsDir,
            previousPassedAt: cacheHit.completedAt,
            previousStderrLog: cacheHit.stderrLog,
            previousStdoutLog: cacheHit.stdoutLog,
        },
        cached: true,
        command: command.cmd,
        commandHash: hashJson(command.cmd),
        durationMs: 0,
        exitCode: 0,
        parser: command.output.parser,
        section,
        status: "SKIP-CACHED",
        stderrLog: logs.stderrLog,
        stdoutLog: logs.stdoutLog,
        summary: [],
    };
}

export function writeCachedCommandLogs(logs, cacheHit) {
    const lines = [
        "SKIP-CACHED",
        `previous_pass=${cacheHit.completedAt}`,
        `previous_artifacts=${cacheHit.artifactsDir}`,
        `previous_stdout=${cacheHit.stdoutLog}`,
        `previous_stderr=${cacheHit.stderrLog}`,
        `cache_key=${cacheHit.fingerprint.cacheKey}`,
        `mutated_inputs=${cacheHit.mutatedInputs === true ? "1" : "0"}`,
    ];
    writeFileSync(logs.stdoutAbsPath, `${lines.join("\n")}\n`, "utf-8");
    writeFileSync(logs.stderrAbsPath, "", "utf-8");
}

export function writeCommandCache(commandCache, commandResult, artifacts) {
    mkdirSync(path.dirname(commandCache.path), {recursive: true});
    const entry = {
        artifactsDir: artifacts.relativeDir,
        command: commandResult.command,
        commandHash: commandResult.commandHash,
        completedAt: new Date().toISOString(),
        durationMs: commandResult.durationMs,
        exitCode: commandResult.exitCode,
        beforeFingerprint: commandCache.beforeFingerprint ?? commandCache.fingerprint,
        fingerprint: commandCache.fingerprint,
        mutatedInputs: commandCache.mutatedInputs === true,
        parser: commandResult.parser,
        section: commandResult.section,
        status: "PASS",
        stderrLog: commandResult.stderrLog,
        stdoutLog: commandResult.stdoutLog,
        version: CACHE_VERSION,
    };
    writeFileSync(commandCache.path, `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
}
