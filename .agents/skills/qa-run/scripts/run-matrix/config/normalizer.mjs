import {
    BUILT_IN_PATTERN_SETS,
    GIT_VISIBLE_PATTERN_SET,
    normalizePatternSetName,
    resolvePatternEntries,
} from "../patterns/pattern-sets.mjs";

const DEFAULT_OUTPUT_CONFIG = {
    failTailLines: 120,
    maxOutputBytes: 20000,
    outputMode: "quiet-on-pass",
    parser: "generic-tail",
    parserInputBytes: 5 * 1024 * 1024,
    stripAnsi: true,
};
const OUTPUT_MODES = new Set(["quiet-on-pass", "silent"]);
const PARSERS = new Set(["generic-tail", "phpstan-json", "eslint-json"]);

function parseConfig(raw, configAbsPath) {
    const parsed = parseJsonConfig(raw, configAbsPath);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return normalizeConfig(parsed);
    }

    throw new Error("Config root must be a JSON object.");
}

function parseJsonConfig(raw, configAbsPath) {
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Invalid JSON config: ${configAbsPath}`);
    }
}

function normalizeConfig(config) {
    const outputDefaults = normalizeOutputConfig("root outputDefaults", config.outputDefaults ?? {});
    const patternSets = normalizePatternSets(config.patternSets ?? {});
    const sections = normalizeSections(config, outputDefaults, patternSets);
    const sectionOrder = normalizeSectionOrder(config, sections);

    return {
        outputDefaults,
        patternSets,
        raw: config,
        sectionOrder,
        sections,
    };
}

function normalizeSections(config, outputDefaults, patternSets) {
    if (!config.sections || typeof config.sections !== "object" || Array.isArray(config.sections)) {
        throw new Error('Config field "sections" must be an object.');
    }

    const sections = {};
    for (const [sectionName, sectionConfig] of Object.entries(config.sections)) {
        sections[sectionName] = normalizeSectionConfig(sectionName, sectionConfig, outputDefaults, patternSets);
    }

    return sections;
}

function normalizeSectionOrder(config, sections) {
    if (!Array.isArray(config.sectionOrder)) {
        throw new Error('Config field "sectionOrder" must be an array of section names.');
    }

    const sectionOrder = normalizeRootStringList("sectionOrder", config.sectionOrder);
    const uniqueSectionOrder = [...new Set(sectionOrder)];
    for (const sectionName of uniqueSectionOrder) {
        if (!Object.hasOwn(sections, sectionName)) {
            throw new Error(`Config sectionOrder references missing section "${sectionName}".`);
        }
    }

    const unorderedSections = Object.keys(sections)
        .filter((sectionName) => !uniqueSectionOrder.includes(sectionName));
    if (unorderedSections.length > 0) {
        throw new Error(`Config sections missing from sectionOrder: ${unorderedSections.join(", ")}.`);
    }

    return uniqueSectionOrder;
}

function normalizeSectionConfig(sectionName, value, outputDefaults, patternSets) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" must be an object.`);
    }

    assertRequiredSectionField(sectionName, value, "commands");
    assertRequiredSectionField(sectionName, value, "patterns");
    assertRequiredSectionField(sectionName, value, "runOn");
    assertRequiredSectionField(sectionName, value, "requiresFinalFullPass");

    const sectionOutput = {
        ...DEFAULT_OUTPUT_CONFIG,
        ...outputDefaults,
        ...normalizeOutputConfig(`section "${sectionName}" output`, value.output ?? {}),
    };
    const patterns = normalizeStringList(sectionName, "patterns", value.patterns);
    const resolvedPatterns = resolvePatternEntries(patterns, patternSets);

    return {
        cache: normalizeSectionCacheConfig(sectionName, value.cache, resolvedPatterns),
        name: sectionName,
        commands: normalizeSectionCommandList(sectionName, value.commands, sectionOutput),
        output: sectionOutput,
        patterns,
        requiresFinalFullPass: normalizeBoolean(sectionName, "requiresFinalFullPass", value.requiresFinalFullPass),
        resolvedPatterns,
        runOn: normalizeRunOn(sectionName, value.runOn),
    };
}

function normalizePatternSets(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error('Config field "patternSets" must be an object.');
    }

    const result = {};
    for (const [name, entries] of Object.entries(value)) {
        const normalizedName = normalizePatternSetName(name);
        if (normalizedName === GIT_VISIBLE_PATTERN_SET || Object.hasOwn(BUILT_IN_PATTERN_SETS, normalizedName)) {
            throw new Error(`Config patternSets cannot override built-in pattern set "@${normalizedName}".`);
        }
        result[normalizedName] = normalizeRootStringList(`patternSets.${name}`, entries);
        if (result[normalizedName].length === 0) {
            throw new Error(`Config patternSets.${name} must contain at least one entry.`);
        }
    }

    for (const [name, entries] of Object.entries(result)) {
        validatePatternReferences(`patternSets.${name}`, entries, result);
    }
    for (const name of Object.keys(result)) {
        resolvePatternEntries([`@${name}`], result);
    }

    return result;
}

function normalizeSectionCacheConfig(sectionName, value, resolvedPatterns) {
    if (value === void 0) {
        return {enabled: false, envKeys: []};
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" cache must be an object.`);
    }

    const allowedKeys = new Set(["enabled", "envKeys"]);
    const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
        throw new Error(
            `Config section "${sectionName}" cache supports only "enabled" and "envKeys"; unknown keys: ${unknownKeys.join(", ")}.`
        );
    }

    if (value.enabled !== void 0 && typeof value.enabled !== "boolean") {
        throw new Error(`Config section "${sectionName}" cache enabled must be a boolean.`);
    }

    const envKeys = value.envKeys === void 0
        ? []
        : normalizeCacheStringList(`section "${sectionName}" cache`, "envKeys", value.envKeys);

    if (value.enabled !== true) {
        return {enabled: false, envKeys: [...new Set(envKeys)].sort()};
    }

    if (!resolvedPatterns.includeGitVisible && resolvedPatterns.patterns.length === 0) {
        return {enabled: false, envKeys: [...new Set(envKeys)].sort()};
    }

    return {
        enabled: true,
        envKeys: [...new Set(envKeys)].sort(),
    };
}

function assertRequiredSectionField(sectionName, value, fieldName) {
    if (!Object.hasOwn(value, fieldName)) {
        throw new Error(`Config section "${sectionName}" field "${fieldName}" is required.`);
    }
}

function normalizeRootStringList(fieldName, value) {
    if (!Array.isArray(value)) {
        throw new Error(`Config field "${fieldName}" must be an array of strings.`);
    }

    const strings = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            throw new Error(`Config field "${fieldName}" must contain only strings.`);
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
            strings.push(trimmed);
        }
    }

    return strings;
}

function normalizeBoolean(sectionName, fieldName, value) {
    if (typeof value !== "boolean") {
        throw new Error(`Config section "${sectionName}" field "${fieldName}" must be a boolean.`);
    }

    return value;
}

function normalizeStringList(sectionName, fieldName, value) {
    if (!Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" field "${fieldName}" must be an array of strings.`);
    }

    const strings = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            throw new Error(`Config section "${sectionName}" field "${fieldName}" must contain only strings.`);
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
            strings.push(trimmed);
        }
    }

    return strings;
}

function normalizeRunOn(sectionName, value) {
    const runOn = normalizeStringList(sectionName, "runOn", value);
    for (const mode of runOn) {
        if (mode !== "full" && mode !== "rerun") {
            throw new Error(`Config section "${sectionName}" field "runOn" supports only "full" and "rerun".`);
        }
    }

    return [...new Set(runOn)];
}

function normalizeCommands(config, sectionName) {
    const section = config.sections[sectionName] ?? null;
    if (!section) {
        return [];
    }

    return section.commands;
}

function normalizeSectionCommandList(sectionName, value, sectionOutput) {
    if (!Array.isArray(value)) {
        throw new Error(`Config section "${sectionName}" must be an array of command strings/objects.`);
    }

    const commands = [];
    for (const entry of value) {
        if (typeof entry === "string") {
            const trimmed = entry.trim();
            pushNonEmptyCommand(commands, sectionName, trimmed, sectionOutput);
            continue;
        }

        commands.push(normalizeCommandObject(sectionName, entry, sectionOutput));
    }
    return commands;
}

function pushNonEmptyCommand(commands, sectionName, command, sectionOutput) {
    if (command.length === 0) {
        return;
    }

    commands.push(normalizeCommandObject(sectionName, {cmd: command}, sectionOutput));
}

function normalizeCommandObject(sectionName, entry, sectionOutput) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`Config section "${sectionName}" command must be a string or object.`);
    }

    const command = typeof entry.cmd === "string" ? entry.cmd.trim() : "";

    if (command.length === 0) {
        throw new Error(`Config section "${sectionName}" command object requires non-empty "cmd".`);
    }

    const commandOutput = normalizeOutputConfig(`section "${sectionName}" command output`, entry.output ?? {});
    const inlineOutput = normalizeOutputConfig(`section "${sectionName}" command inline output`, {
        failTailLines: entry.failTailLines,
        maxOutputBytes: entry.maxOutputBytes,
        outputMode: entry.outputMode,
        parser: entry.parser,
        parserInputBytes: entry.parserInputBytes,
        stripAnsi: entry.stripAnsi,
    });

    if (entry.cache !== void 0) {
        throw new Error(`Config section "${sectionName}" command cache is not supported. Configure cache at section level.`);
    }

    return {
        cmd: command,
        output: {
            ...sectionOutput,
            ...commandOutput,
            ...inlineOutput,
        },
    };
}

function normalizeCacheStringList(context, fieldName, value) {
    if (!Array.isArray(value)) {
        throw new Error(`Config ${context} ${fieldName} must be an array of strings.`);
    }

    const strings = [];
    for (const entry of value) {
        if (typeof entry !== "string") {
            throw new Error(`Config ${context} ${fieldName} must contain only strings.`);
        }
        const trimmed = entry.trim();
        if (trimmed.length > 0) {
            strings.push(trimmed);
        }
    }

    return strings;
}

function validatePatternReferences(context, patterns, patternSets) {
    for (const entry of patterns) {
        if (!entry.startsWith("@")) {
            continue;
        }

        const name = normalizePatternSetName(entry);
        if (name === GIT_VISIBLE_PATTERN_SET) {
            continue;
        }

        if (!Object.hasOwn(BUILT_IN_PATTERN_SETS, name) && !Object.hasOwn(patternSets, name)) {
            throw new Error(`Config ${context} references unknown pattern set "@${name}".`);
        }
    }
}

function normalizeOutputConfig(context, value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Config ${context} must be an object.`);
    }

    const normalized = {};
    if (value.outputMode !== void 0) {
        if (typeof value.outputMode !== "string" || !OUTPUT_MODES.has(value.outputMode)) {
            throw new Error(
                `Config ${context} outputMode must be one of: ${[...OUTPUT_MODES].join(", ")}.`
            );
        }
        normalized.outputMode = value.outputMode;
    }

    if (value.failTailLines !== void 0) {
        normalized.failTailLines = normalizePositiveInteger(context, "failTailLines", value.failTailLines);
    }

    if (value.maxOutputBytes !== void 0) {
        normalized.maxOutputBytes = normalizePositiveInteger(context, "maxOutputBytes", value.maxOutputBytes);
    }

    if (value.stripAnsi !== void 0) {
        if (typeof value.stripAnsi !== "boolean") {
            throw new Error(`Config ${context} stripAnsi must be a boolean.`);
        }
        normalized.stripAnsi = value.stripAnsi;
    }

    if (value.parser !== void 0) {
        normalized.parser = normalizeParser(context, value.parser);
    }

    if (value.parserInputBytes !== void 0) {
        normalized.parserInputBytes = normalizePositiveInteger(context, "parserInputBytes", value.parserInputBytes);
    }

    return normalized;
}

function normalizePositiveInteger(context, fieldName, value) {
    if (!Number.isInteger(value) || value < 1) {
        throw new Error(`Config ${context} ${fieldName} must be a positive integer.`);
    }

    return value;
}

function normalizeParser(context, value) {
    if (typeof value === "string") {
        if (!PARSERS.has(value)) {
            throw new Error(`Config ${context} parser must be one of: ${[...PARSERS].join(", ")}.`);
        }
        return value;
    }

    throw new Error(`Config ${context} parser must be a string.`);
}

export {
    DEFAULT_OUTPUT_CONFIG,
    normalizeCommands,
    normalizeConfig,
    normalizeOutputConfig,
    parseConfig,
};
