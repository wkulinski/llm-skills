#!/usr/bin/env node

import crypto from "node:crypto";
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from "node:fs";
import path from "node:path";

import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

const INVENTORY_VERSION = 1;
const USAGE_TRIGGER = "Użyj, gdy";
const POLISH_DIACRITICS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const POLISH_WORDS = /(?:^|[^\p{L}])(?:gdy|oraz|albo|jest|który|dla)(?:[^\p{L}]|$)/iu;
const MIN_DUPLICATE_LINES = 4;
const MAX_TEST_PINS = 50;
const MAX_PREVIEW_LENGTH = 120;
const CONFIG_FILE = "opencode.jsonc";
const SKILL_CHECKS = ["description", "frontmatter", "root-sections", "shared-files", "test-pins", "duplicate-blocks"];
const AGENT_CHECKS = ["frontmatter", "body-sections", "config-entry", "delegating-skills", "test-pins"];
const CATALOG_VERSION = 1;
const CATALOG_CHECKS = [
    "skills",
    "agents",
    "agent-config",
    "index",
    "routing-policy",
    "rules",
    "shared-files-graph",
    "mjs-dependencies",
    "test-pins",
    "description-budget",
    "model-names",
    "language",
];
const CATALOG_RUN_MODES = ["collector-only", "full"];
const CATALOG_REPORT_JSON = "catalog-report.json";
const CATALOG_REPORT_MD = "catalog-report.md";
const BUILTIN_AGENT_KEYS = new Set(["build", "plan", "general", "title", "summary"]);
const MODEL_NAME_PATTERN = /(?<![\w-])(?:openai|anthropic|google|deepseek|commandcode|openrouter|mistralai|mistral|xai|groq|cohere|qwen|meta-llama|z-ai)\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*(?![\w-])/gu;
const MODEL_HIERARCHY_FILE = path.join(".agents", "config", "model-hierarchy.json");
const README_INSTRUCTION_START = "## Using These Skills in Another Project";
const README_INSTRUCTION_END = "## Runtime Setup for Consumer Projects";
const RUNTIME_BLOCK_MARKERS = ["STOP_CODES", "Priorytet zasad", "Reguły rozwiązywania ścieżek"];
const STALE_CLAIM_PATTERNS = [
    {id: "no-commit-history", pattern: /no commit history/i},
    {id: "unconditional-start", pattern: /zawsze uruchom|bezwarunkowo|always run/i},
];
const GENERATED_DOCS_MAP_KEYS = new Set(["HANDOFF_DOC", "COMMIT_MESSAGE_DIR", "CACHE_PATH"]);
const TOKENS_PER_CHAR = 4;

function sha256(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function toPosix(filePath) {
    return filePath.split(path.sep).join("/");
}

function splitLines(source) {
    const lines = source.split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

function stripQuotes(value) {
    if (value.length >= 2 && ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'")))) {
        return value.slice(1, -1);
    }
    return value;
}

function isPolishText(text) {
    return POLISH_DIACRITICS.test(text) || POLISH_WORDS.test(text);
}

function isDirectory(filePath) {
    return existsSync(filePath) && statSync(filePath).isDirectory();
}

function isFileUnder(root, relativePath) {
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return false;
    }
    return existsSync(resolved) && statSync(resolved).isFile();
}

function readArtifact({root, file}) {
    const absolutePath = path.resolve(root, file);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        throw new Error(`File not found: ${file}`);
    }
    const source = readFileSync(absolutePath, "utf8");
    return {
        absolutePath,
        relativePath: toPosix(path.relative(root, absolutePath)),
        source,
        lines: splitLines(source),
        bytes: Buffer.byteLength(source, "utf8"),
        sha256: sha256(source),
    };
}

function parseFrontmatter(artifact) {
    const lines = artifact.lines;
    if (lines.length === 0 || lines[0] !== "---") {
        throw new Error(`Missing frontmatter: ${artifact.relativePath}`);
    }
    const endIndex = lines.indexOf("---", 1);
    if (endIndex === -1) {
        throw new Error(`Unterminated frontmatter: ${artifact.relativePath}`);
    }
    const entries = [];
    let current = null;
    for (let index = 1; index < endIndex; index += 1) {
        const line = lines[index];
        const keyMatch = line.match(/^([A-Za-z0-9_.-]+):(.*)$/);
        if (keyMatch) {
            current = {key: keyMatch[1], line: index + 1, inline: keyMatch[2].trim(), lines: []};
            entries.push(current);
            continue;
        }
        if (current !== null && line.trim() !== "") {
            current.lines.push({line: index + 1, text: line.trim()});
        }
    }
    return {entries, bodyStartIndex: endIndex + 1};
}

function findFrontmatterEntry(frontmatter, key) {
    return frontmatter.entries.find((entry) => entry.key === key) ?? null;
}

function frontmatterEntryText(entry) {
    if (entry.inline !== "" && !/^[|>][+-]?$/.test(entry.inline)) {
        return stripQuotes(entry.inline);
    }
    const chunks = entry.lines.map(({text}) => text);
    return entry.inline.startsWith(">") ? chunks.join(" ") : chunks.join("\n");
}

function frontmatterEntryLine(entry) {
    if (entry.inline === "" && entry.lines.length > 0) {
        return entry.lines[0].line;
    }
    return entry.line;
}

function frontmatterEntryList(entry) {
    return entry.lines
        .filter(({text}) => text.startsWith("- "))
        .map(({line, text}) => ({line, value: stripQuotes(text.slice(2).trim())}));
}

function describeText(text, line) {
    return {
        text,
        length: text.length,
        language: isPolishText(text) ? "pl" : "other",
        has_usage_trigger: text.includes(USAGE_TRIGGER),
        line,
    };
}

function describeAgentText(text, line) {
    return {
        text,
        length: text.length,
        language: isPolishText(text) ? "pl" : "other",
        has_trigger: text.includes(USAGE_TRIGGER),
        line,
    };
}

function collectSections(lines, startIndex) {
    const headings = [];
    for (let index = startIndex; index < lines.length; index += 1) {
        if (lines[index].startsWith("## ")) {
            headings.push({title: lines[index].slice(3).trim(), line: index - startIndex + 1, index});
        }
    }
    return headings.map((heading, position) => ({
        title: heading.title,
        line: heading.line,
        lines: (position + 1 < headings.length ? headings[position + 1].index : lines.length) - heading.index,
    }));
}

function normalizeLine(line) {
    return line.trim().replace(/\s+/g, " ");
}

function recordDuplicateWindow(candidates, entries, start, length) {
    const window = entries.slice(start, start + length);
    const key = window.map((entry) => entry.normalized).join("\n");
    if (!candidates.has(key)) {
        candidates.set(key, {length, preview: window[0].normalized, occurrences: []});
    }
    candidates.get(key).occurrences.push(window[0].line);
}

function isCoveredByLonger(block, selected) {
    return selected.some((candidate) => candidate.length > block.length
        && block.occurrences.every((start) => candidate.occurrences.some((base) => base <= start && base + candidate.length >= start + block.length)));
}

function collectDuplicateBlocks(lines) {
    const entries = [];
    for (let index = 0; index < lines.length; index += 1) {
        const normalized = normalizeLine(lines[index]);
        if (normalized !== "") {
            entries.push({line: index + 1, normalized});
        }
    }
    const candidates = new Map();
    let index = 0;
    while (index < entries.length) {
        let runEnd = index;
        while (runEnd + 1 < entries.length && entries[runEnd + 1].line === entries[runEnd].line + 1) {
            runEnd += 1;
        }
        for (let start = index; start <= runEnd; start += 1) {
            for (let length = MIN_DUPLICATE_LINES; start + length <= runEnd + 1; length += 1) {
                recordDuplicateWindow(candidates, entries, start, length);
            }
        }
        index = runEnd + 1;
    }
    const repeated = [...candidates.values()]
        .filter((block) => block.occurrences.length >= 2)
        .sort((left, right) => right.length - left.length || left.occurrences[0] - right.occurrences[0]);
    const selected = [];
    for (const block of repeated) {
        if (!isCoveredByLonger(block, selected)) {
            selected.push(block);
        }
    }
    return selected
        .sort((left, right) => left.occurrences[0] - right.occurrences[0])
        .map((block) => ({
            lines: block.length,
            occurrences: [...block.occurrences].sort((left, right) => left - right),
            preview: block.preview.length <= MAX_PREVIEW_LENGTH ? block.preview : block.preview.slice(0, MAX_PREVIEW_LENGTH),
        }));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Path-like needles match as substrings; bare names additionally require
// non-name boundaries so `context-scout` does not match `context-scout-fast`.
function matchNeedle(line, needle) {
    if (needle.includes(".") || needle.includes("/")) {
        return line.includes(needle);
    }
    return new RegExp(`(?<![\\w-])${escapeRegExp(needle)}(?![\\w-])`, "u").test(line);
}

function matchingLines(source, needles) {
    const lines = splitLines(source);
    const matched = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (needles.some((needle) => matchNeedle(lines[index], needle))) {
            matched.push(index + 1);
        }
    }
    return matched;
}

function walkFiles(directory) {
    const files = [];
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(entryPath));
        } else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}

function collectTestPins({root, needles}) {
    const testsRoot = path.join(root, "tests");
    if (!isDirectory(testsRoot)) {
        return [];
    }
    const pins = [];
    const files = walkFiles(testsRoot).filter((file) => file.endsWith(".mjs")).sort();
    for (const file of files) {
        const matched = matchingLines(readFileSync(file, "utf8"), needles);
        if (matched.length > 0) {
            pins.push({file: toPosix(path.relative(root, file)), lines: matched});
        }
        if (pins.length >= MAX_TEST_PINS) {
            break;
        }
    }
    return pins;
}

function collectDelegatingArtifacts({root, needles}) {
    const skillsRoot = path.join(root, ".agents", "skills");
    if (!isDirectory(skillsRoot)) {
        return [];
    }
    const files = walkFiles(skillsRoot).filter((file) => file.endsWith(".md")).sort(compareStrings);
    const found = [];
    for (const file of files) {
        const matched = matchingLines(readFileSync(file, "utf8"), needles);
        if (matched.length > 0) {
            found.push({file: toPosix(path.relative(root, file)), lines: matched});
        }
    }
    return found;
}

function collectDelegatingSkills({root, needles}) {
    const skillsRoot = path.join(root, ".agents", "skills");
    if (!isDirectory(skillsRoot)) {
        return [];
    }
    const skills = [];
    const directories = readdirSync(skillsRoot, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    for (const directory of directories) {
        const file = path.join(skillsRoot, directory, "SKILL.md");
        if (!existsSync(file) || !statSync(file).isFile()) {
            continue;
        }
        const matched = matchingLines(readFileSync(file, "utf8"), needles);
        if (matched.length > 0) {
            skills.push({file: toPosix(path.relative(root, file)), lines: matched});
        }
    }
    return skills;
}

function buildSkillSignals({artifact, description, missing, duplicates}) {
    const file = artifact.relativePath;
    const signals = [];
    if (!description.has_usage_trigger) {
        signals.push({
            id: "missing-usage-trigger",
            severity: "minor",
            detail: `Opis nie zawiera frazy "${USAGE_TRIGGER}".`,
            evidence: `${file}:${description.line}`,
        });
    }
    if (description.language !== "pl") {
        signals.push({
            id: "non-polish-description",
            severity: "minor",
            detail: "Opis nie został rozpoznany jako polski.",
            evidence: `${file}:${description.line}`,
        });
    }
    for (const block of duplicates) {
        signals.push({
            id: "duplicate-block",
            severity: "minor",
            detail: `Powtórzony blok ${block.lines} kolejnych linii.`,
            evidence: `${file}:${block.occurrences[0]}`,
        });
    }
    for (const entry of missing) {
        signals.push({
            id: "shared-file-missing",
            severity: "major",
            detail: `Brak pliku współdzielonego: ${entry.value}.`,
            evidence: `${file}:${entry.line}`,
        });
    }
    return signals;
}

function buildSkillInventory({root, artifact}) {
    const frontmatter = parseFrontmatter(artifact);
    const descriptionEntry = findFrontmatterEntry(frontmatter, "description");
    const nameEntry = findFrontmatterEntry(frontmatter, "name");
    const sharedEntry = findFrontmatterEntry(frontmatter, "shared_files");
    const description = descriptionEntry
        ? describeText(frontmatterEntryText(descriptionEntry), frontmatterEntryLine(descriptionEntry))
        : describeText("", 1);
    const declared = sharedEntry ? frontmatterEntryList(sharedEntry) : [];
    const skillsRoot = path.join(root, ".agents", "skills");
    const missing = declared.filter((entry) => !isFileUnder(skillsRoot, entry.value));
    const metrics = {
        description,
        frontmatter: {
            present: true,
            name: nameEntry ? frontmatterEntryText(nameEntry) : null,
            shared_files: declared.map((entry) => entry.value),
        },
        root: {
            lines: artifact.lines.length,
            bytes: artifact.bytes,
            sections: collectSections(artifact.lines, 0),
        },
        shared_files: {
            declared: declared.map((entry) => entry.value),
            missing: missing.map((entry) => entry.value),
        },
        test_pins: collectTestPins({
            root,
            needles: [artifact.relativePath],
        }),
        duplicate_blocks: collectDuplicateBlocks(artifact.lines),
    };
    return assembleInventory({
        mode: "skill",
        artifact,
        checks: SKILL_CHECKS,
        metrics,
        signals: buildSkillSignals({artifact, description, missing, duplicates: metrics.duplicate_blocks}),
    });
}

function collectForbiddenFields(frontmatter) {
    const forbidden = [];
    for (const entry of frontmatter.entries) {
        if (entry.key === "model" || entry.key === "variant" || entry.key === "thinking") {
            forbidden.push({key: entry.key, line: entry.line});
        }
        if (entry.key === "options") {
            const thinking = entry.lines.find(({text}) => /^thinking\s*:/.test(text));
            if (thinking) {
                forbidden.push({key: "thinking", line: thinking.line});
            }
        }
    }
    return forbidden;
}

function findMatchingBrace(source, openIndex) {
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
        const char = source[index];
        if (char === "\"") {
            index = skipString(source, index);
            continue;
        }
        if (char === "/" && source[index + 1] === "/") {
            index = skipLineComment(source, index);
            continue;
        }
        if (char === "/" && source[index + 1] === "*") {
            index = skipBlockComment(source, index);
            continue;
        }
        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }
    }
    return -1;
}

function skipString(source, startIndex) {
    for (let index = startIndex + 1; index < source.length; index += 1) {
        if (source[index] === "\\") {
            index += 1;
            continue;
        }
        if (source[index] === "\"") {
            return index;
        }
    }
    return source.length - 1;
}

function skipLineComment(source, startIndex) {
    const end = source.indexOf("\n", startIndex);
    return end === -1 ? source.length - 1 : end;
}

function skipBlockComment(source, startIndex) {
    const end = source.indexOf("*/", startIndex);
    return end === -1 ? source.length - 1 : end + 1;
}

function lineNumberAt(source, index) {
    return source.slice(0, index).split("\n").length;
}

function findAgentSection(source) {
    const match = /"agent"\s*:/.exec(source);
    if (match === null) {
        return null;
    }
    const openIndex = source.indexOf("{", match.index + match[0].length);
    if (openIndex === -1) {
        return null;
    }
    const closeIndex = findMatchingBrace(source, openIndex);
    if (closeIndex === -1) {
        return null;
    }
    return {open: openIndex, close: closeIndex};
}

function matchEntryValue(source, keyIndex, keyEnd, expected) {
    if (source.slice(keyIndex, keyEnd + 1) !== expected) {
        return null;
    }
    const rest = source.slice(keyEnd + 1);
    const match = /^\s*:\s*\{/.exec(rest);
    if (match === null) {
        return null;
    }
    const open = keyEnd + 1 + match[0].length - 1;
    const close = findMatchingBrace(source, open);
    if (close === -1) {
        return null;
    }
    return {open, close, keyIndex};
}

function matchEntryAt(source, index, depth, expected) {
    const end = skipString(source, index);
    const entry = depth === 0 ? matchEntryValue(source, index, end, expected) : null;
    return {end, entry};
}

function findAgentEntry(source, section, agentName) {
    const expected = `"${agentName}"`;
    let depth = 0;
    for (let index = section.open + 1; index < section.close; index += 1) {
        const char = source[index];
        if (char === "\"") {
            const {end, entry} = matchEntryAt(source, index, depth, expected);
            if (entry !== null) {
                return entry;
            }
            index = end;
            continue;
        }
        if (char === "/" && source[index + 1] === "/") {
            index = skipLineComment(source, index);
            continue;
        }
        if (char === "/" && source[index + 1] === "*") {
            index = skipBlockComment(source, index);
            continue;
        }
        if (char === "{") {
            depth += 1;
        }
        if (char === "}") {
            depth -= 1;
        }
    }
    return null;
}

function parseAgentConfig({root, agentName}) {
    const result = {file: CONFIG_FILE, entry_present: false, entry_line: null, has_model: false, has_reasoning: false};
    const configPath = path.join(root, CONFIG_FILE);
    if (!existsSync(configPath) || !statSync(configPath).isFile()) {
        return result;
    }
    const source = readFileSync(configPath, "utf8");
    const section = findAgentSection(source);
    if (section === null) {
        return result;
    }
    const entry = findAgentEntry(source, section, agentName);
    if (entry === null) {
        return result;
    }
    const entryText = source.slice(entry.open, entry.close + 1);
    return {
        file: CONFIG_FILE,
        entry_present: true,
        entry_line: lineNumberAt(source, entry.keyIndex),
        has_model: /"model"\s*:/.test(entryText),
        has_reasoning: /"(?:variant|thinking)"\s*:/.test(entryText),
    };
}

function buildAgentSignals({artifact, forbidden, config, delegatingSkills}) {
    const file = artifact.relativePath;
    const agentName = path.basename(file, ".md");
    const signals = [];
    if (forbidden.length > 0) {
        signals.push({
            id: "frontmatter-model-pin",
            severity: "major",
            detail: `Frontmatter zawiera zablokowane pola: ${forbidden.map((field) => field.key).join(", ")}.`,
            evidence: `${file}:${forbidden[0].line}`,
        });
    }
    if (!config.entry_present) {
        signals.push({
            id: "missing-config-entry",
            severity: "major",
            detail: `Brak wpisu "${agentName}" w sekcji "agent" pliku ${CONFIG_FILE}.`,
            evidence: `${CONFIG_FILE}:1`,
        });
    } else {
        if (!config.has_model) {
            signals.push({
                id: "missing-model-config",
                severity: "minor",
                detail: "Wpis agenta nie zawiera pola \"model\".",
                evidence: `${CONFIG_FILE}:${config.entry_line}`,
            });
        }
        if (!config.has_reasoning) {
            signals.push({
                id: "missing-reasoning-config",
                severity: "minor",
                detail: "Wpis agenta nie zawiera pola \"variant\" ani \"thinking\".",
                evidence: `${CONFIG_FILE}:${config.entry_line}`,
            });
        }
    }
    if (delegatingSkills.length === 0) {
        signals.push({
            id: "no-delegating-skill",
            severity: "info",
            detail: "Żaden SKILL.md nie odwołuje się do tego agenta.",
            evidence: `${file}:1`,
        });
    }
    return signals;
}

function buildAgentInventory({root, artifact}) {
    const frontmatter = parseFrontmatter(artifact);
    const descriptionEntry = findFrontmatterEntry(frontmatter, "description");
    const description = descriptionEntry
        ? describeAgentText(frontmatterEntryText(descriptionEntry), frontmatterEntryLine(descriptionEntry))
        : describeAgentText("", 1);
    const bodyLines = artifact.lines.slice(frontmatter.bodyStartIndex);
    const agentName = path.basename(artifact.relativePath, ".md");
    const needles = [`${agentName}.md`, toPosix(path.join(".opencode", "agents", `${agentName}.md`))];
    const config = parseAgentConfig({root, agentName});
    const delegatingSkills = collectDelegatingSkills({root, needles: [...needles, agentName]});
    const metrics = {
        frontmatter: {
            present: true,
            keys: frontmatter.entries.map((entry) => entry.key),
            description,
            forbidden_fields: collectForbiddenFields(frontmatter),
        },
        body: {
            lines: bodyLines.length,
            bytes: Buffer.byteLength(bodyLines.join("\n"), "utf8"),
            sections: collectSections(artifact.lines, frontmatter.bodyStartIndex),
        },
        config,
        delegating_skills: delegatingSkills,
        test_pins: collectTestPins({root, needles}),
    };
    return assembleInventory({
        mode: "agent",
        artifact,
        checks: AGENT_CHECKS,
        metrics,
        signals: buildAgentSignals({
            artifact,
            forbidden: metrics.frontmatter.forbidden_fields,
            config,
            delegatingSkills,
        }),
    });
}

function assembleInventory({mode, artifact, checks, metrics, signals}) {
    return {
        version: INVENTORY_VERSION,
        mode,
        file: artifact.relativePath,
        source_sha256: artifact.sha256,
        coverage: {
            status: "complete",
            checks: checks.map((id) => ({id, status: "checked"})),
            not_checked: [],
        },
        metrics,
        signals,
    };
}

// --- Catalog mode ---------------------------------------------------------

function compareStrings(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function listSubdirectories(directory) {
    if (!isDirectory(directory)) {
        return [];
    }
    return readdirSync(directory, {withFileTypes: true})
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function listRegularFiles(directory, suffix = null) {
    if (!isDirectory(directory)) {
        return [];
    }
    return readdirSync(directory, {withFileTypes: true})
        .filter((entry) => entry.isFile() && (suffix === null || entry.name.endsWith(suffix)))
        .map((entry) => path.join(directory, entry.name))
        .sort();
}

function recordInput(inputs, {root, absolutePath, source}) {
    const relativePath = toPosix(path.relative(root, absolutePath));
    if (!inputs.has(relativePath)) {
        inputs.set(relativePath, {path: relativePath, sha256: sha256(source)});
    }
}

function finalizeInput(inputs) {
    const files = [...inputs.values()].sort((left, right) => compareStrings(left.path, right.path));
    return {
        sha256: sha256(files.map((file) => `${file.path}:${file.sha256}`).join("\n")),
        count: files.length,
        files,
    };
}

function parseFrontmatterSafe(artifact) {
    try {
        return {frontmatter: parseFrontmatter(artifact), error: null};
    } catch (error) {
        return {frontmatter: null, error: error instanceof Error ? error.message : String(error)};
    }
}

function normalizeIntent(text) {
    return text.toLowerCase().replace(/\s+/g, " ").replace(/[.;:]+$/g, "").trim();
}

function isCoveredByLongerCrossFile(block, selected) {
    return selected.some((candidate) => candidate.length > block.length
        && block.occurrences.every((occurrence) => candidate.occurrences.some((base) => base.file === occurrence.file
            && base.line <= occurrence.line
            && base.line + candidate.length >= occurrence.line + block.length)));
}

function recordCatalogDuplicateWindows(candidates, {entries, start, runEnd, file, offset, lineUsage}) {
    if ((lineUsage.get(entries[start].normalized) ?? 0) < 2) {
        return;
    }
    // Punctuation-only windows (closing brackets and fences of code blocks) are
    // structure, not duplicated prose.
    if (!/\p{L}/u.test(entries[start].normalized)) {
        return;
    }
    for (let length = MIN_DUPLICATE_LINES; start + length <= runEnd + 1; length += 1) {
        const window = entries.slice(start, start + length);
        const key = window.map((entry) => entry.normalized).join("\n");
        if (!candidates.has(key)) {
            candidates.set(key, {length, preview: window[0].normalized, occurrences: []});
        }
        candidates.get(key).occurrences.push({file, line: window[0].line + offset});
    }
}

function collectCrossFileDuplicateBlocks(artifacts) {
    const lineUsage = new Map();
    for (const artifact of artifacts) {
        for (const line of artifact.lines) {
            const normalized = normalizeLine(line);
            if (normalized === "") {
                continue;
            }
            lineUsage.set(normalized, (lineUsage.get(normalized) ?? 0) + 1);
        }
    }
    const candidates = new Map();
    for (const artifact of artifacts) {
        const offset = artifact.offset ?? 0;
        const entries = [];
        for (let index = 0; index < artifact.lines.length; index += 1) {
            const normalized = normalizeLine(artifact.lines[index]);
            if (normalized !== "") {
                entries.push({line: index + 1, normalized});
            }
        }
        let index = 0;
        while (index < entries.length) {
            let runEnd = index;
            while (runEnd + 1 < entries.length && entries[runEnd + 1].line === entries[runEnd].line + 1) {
                runEnd += 1;
            }
            for (let start = index; start <= runEnd; start += 1) {
                recordCatalogDuplicateWindows(candidates, {entries, start, runEnd, file: artifact.file, offset, lineUsage});
            }
            index = runEnd + 1;
        }
    }
    const repeated = [...candidates.values()]
        .filter((block) => new Set(block.occurrences.map((occurrence) => occurrence.file)).size >= 2)
        .sort((left, right) => right.length - left.length
            || compareStrings(left.occurrences[0].file, right.occurrences[0].file)
            || left.occurrences[0].line - right.occurrences[0].line);
    const selected = [];
    for (const block of repeated) {
        if (!isCoveredByLongerCrossFile(block, selected)) {
            selected.push(block);
        }
    }
    return selected
        .sort((left, right) => compareStrings(left.occurrences[0].file, right.occurrences[0].file)
            || left.occurrences[0].line - right.occurrences[0].line)
        .map((block) => ({
            lines: block.length,
            preview: block.preview.length <= MAX_PREVIEW_LENGTH ? block.preview : block.preview.slice(0, MAX_PREVIEW_LENGTH),
            occurrences: [...block.occurrences].sort((left, right) => compareStrings(left.file, right.file) || left.line - right.line),
        }));
}

function parseSkillsIndex(source) {
    const lines = splitLines(source);
    const skills = new Map();
    const rows = [];
    let group = null;
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const heading = /^###\s+(.+?)\s*$/.exec(line);
        if (heading !== null) {
            group = heading[1];
            continue;
        }
        const listItem = /^-\s+`\$([a-z0-9-]+)`\s*$/.exec(line);
        if (listItem !== null) {
            const name = listItem[1];
            if (!skills.has(name)) {
                skills.set(name, []);
            }
            skills.get(name).push(index + 1);
            continue;
        }
        if (!line.startsWith("|")) {
            continue;
        }
        const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
        if (cells.length !== 3 || cells[0] === "Intencja" || /^-+$/.test(cells[0])) {
            continue;
        }
        const skillCell = /^`\$([a-z0-9-]+)`$/.exec(cells[1]);
        if (skillCell === null) {
            continue;
        }
        rows.push({group, intent: cells[0], skill: skillCell[1], line: index + 1});
    }
    return {
        skills: [...skills.entries()]
            .map(([name, linesFound]) => ({name, lines: linesFound}))
            .sort((left, right) => compareStrings(left.name, right.name)),
        rows,
    };
}

function readQuotedString(source, startIndex) {
    let value = "";
    for (let index = startIndex + 1; index < source.length; index += 1) {
        const char = source[index];
        if (char === "\\") {
            value += source[index + 1] ?? "";
            index += 1;
            continue;
        }
        if (char === "\"") {
            return {value, end: index};
        }
        value += char;
    }
    return null;
}

function readAgentEntry(source, index) {
    const key = readQuotedString(source, index);
    if (key === null) {
        return null;
    }
    const rest = source.slice(key.end + 1);
    const match = /^\s*:\s*\{/.exec(rest);
    if (match === null) {
        return {entry: null, end: key.end};
    }
    const open = key.end + 1 + match[0].length - 1;
    const close = findMatchingBrace(source, open);
    return {
        entry: {name: key.value, line: lineNumberAt(source, index), open, close},
        end: close === -1 ? key.end : close,
    };
}

function handleAgentEntry(entries, source, index) {
    const parsed = readAgentEntry(source, index);
    if (parsed === null) {
        return null;
    }
    if (parsed.entry !== null) {
        entries.push(parsed.entry);
    }
    return parsed.end + 1;
}

function listAgentEntries(source) {
    const section = findAgentSection(source);
    if (section === null) {
        return null;
    }
    const entries = [];
    let index = section.open + 1;
    let depth = 0;
    while (index < section.close) {
        const char = source[index];
        if (char === "/" && source[index + 1] === "/") {
            index = skipLineComment(source, index) + 1;
            continue;
        }
        if (char === "/" && source[index + 1] === "*") {
            index = skipBlockComment(source, index) + 1;
            continue;
        }
        if (depth === 0 && char === "\"") {
            const nextIndex = handleAgentEntry(entries, source, index);
            if (nextIndex !== null) {
                index = nextIndex;
                continue;
            }
        }
        if (char === "{") {
            depth += 1;
        }
        if (char === "}") {
            depth -= 1;
        }
        index += 1;
    }
    return entries;
}

function matchTargetLines(lines, needles) {
    const matched = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (needles.some((needle) => matchNeedle(lines[index], needle))) {
            matched.push(index + 1);
        }
    }
    return matched;
}

function collectCatalogTestPins({root, artifacts, inputs}) {
    const testsRoot = path.join(root, "tests");
    if (!isDirectory(testsRoot)) {
        return {files_scanned: 0, artifacts: []};
    }
    const files = walkFiles(testsRoot).filter((file) => file.endsWith(".mjs")).sort();
    const targets = artifacts.map((artifact) => ({file: artifact.file, needles: artifact.needles, pins: []}));
    for (const file of files) {
        const source = readFileSync(file, "utf8");
        recordInput(inputs, {root, absolutePath: file, source});
        const lines = splitLines(source);
        for (const target of targets) {
            const matched = matchTargetLines(lines, target.needles);
            if (matched.length > 0) {
                target.pins.push({file: toPosix(path.relative(root, file)), lines: matched});
            }
        }
    }
    return {
        files_scanned: files.length,
        artifacts: targets
            .filter((target) => target.pins.length > 0)
            .map((target) => ({file: target.file, pins: target.pins})),
    };
}

function summarizeDescriptionBudget(skills) {
    const entries = skills.map((skill) => ({
        name: skill.name,
        chars: skill.description.length,
        tokens: Math.ceil(skill.description.length / TOKENS_PER_CHAR),
    }));
    return {
        tokens_per_char: TOKENS_PER_CHAR,
        total_chars: entries.reduce((sum, entry) => sum + entry.chars, 0),
        total_tokens: entries.reduce((sum, entry) => sum + entry.tokens, 0),
        max_chars: entries.reduce((max, entry) => Math.max(max, entry.chars), 0),
        skills: entries,
    };
}

function resolveDeclaredSharedFile(skillsRoot, value) {
    const absolutePath = path.resolve(skillsRoot, value);
    const relative = path.relative(skillsRoot, absolutePath);
    if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        return {status: "escapes", relativePath: null};
    }
    const relativePath = toPosix(relative);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        return {status: "missing", relativePath};
    }
    return {status: "present", relativePath};
}

function collectImportSpecifiers(source) {
    const specifiers = [];
    for (const line of splitLines(source)) {
        const fromMatch = /\bfrom\s+["']([^"']+)["']/.exec(line);
        if (fromMatch !== null) {
            specifiers.push(fromMatch[1]);
            continue;
        }
        const sideEffect = /^\s*import\s+["']([^"']+)["']/.exec(line);
        if (sideEffect !== null) {
            specifiers.push(sideEffect[1]);
        }
    }
    return specifiers;
}

function collectModelProfileNames(value, names = new Set()) {
    if (typeof value === "string") {
        if (/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/i.test(value) && !value.startsWith("http")) {
            names.add(value);
        }
        return names;
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectModelProfileNames(item, names);
        }
        return names;
    }
    if (value !== null && typeof value === "object") {
        for (const item of Object.values(value)) {
            collectModelProfileNames(item, names);
        }
    }
    return names;
}

function collectLineModelNames(line, profileNames) {
    const matched = new Set();
    for (const match of line.matchAll(MODEL_NAME_PATTERN)) {
        matched.add(match[0].replace(/[.,;:]+$/, ""));
    }
    for (const profile of profileNames) {
        if (line.includes(profile)) {
            matched.add(profile);
        }
    }
    return matched;
}

function collectModelNameSignals({artifacts, profileNames}) {
    const signals = [];
    for (const artifact of artifacts) {
        const offset = artifact.offset ?? 0;
        for (let index = 0; index < artifact.lines.length; index += 1) {
            const line = artifact.lines[index];
            const matched = collectLineModelNames(line, profileNames);
            for (const name of matched) {
                signals.push({
                    id: "model-name-in-normative-text",
                    severity: "minor",
                    detail: `Nazwa modelu "${name}" w tekście normatywnym; pary runtime należą do konfiguracji projektu.`,
                    evidence: `${artifact.file}:${index + 1 + offset}`,
                });
            }
        }
    }
    return signals;
}

function parseDocsMapBlocks(lines) {
    const blocks = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (!/^\s*docs_map:\s*$/.test(lines[index])) {
            continue;
        }
        const entries = [];
        for (let next = index + 1; next < lines.length; next += 1) {
            const line = lines[next];
            const entry = /^\s+([A-Za-z0-9_]+):\s*(\S+)\s*$/.exec(line);
            if (entry !== null) {
                entries.push({key: entry[1], value: stripQuotes(entry[2]), line: next + 1});
                continue;
            }
            if (line.trim() === "" || /^\S/.test(line)) {
                break;
            }
        }
        blocks.push({line: index + 1, entries});
    }
    return blocks;
}

function collectHeadings(lines) {
    const headings = [];
    for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].startsWith("## ")) {
            headings.push({title: lines[index].slice(3).trim(), line: index + 1});
        }
    }
    return headings;
}

function findInstructionSpan(lines, startHeading, endHeading) {
    const startIndex = lines.findIndex((line) => line.trim() === startHeading);
    if (startIndex === -1) {
        return null;
    }
    const endIndex = lines.findIndex((line, index) => index > startIndex && line.trim() === endHeading);
    const stop = endIndex === -1 ? lines.length : endIndex;
    return {start_line: startIndex + 1, end_line: stop, lines: lines.slice(startIndex, stop)};
}

function collectRulesSignals({file, lines, offset = 0}) {
    const signals = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const evidence = `${file}:${index + 1 + offset}`;
        for (const marker of RUNTIME_BLOCK_MARKERS) {
            if (line.includes(marker)) {
                signals.push({
                    id: "runtime-rule-outside-skills",
                    severity: "major",
                    detail: `Marker reguły runtime "${marker}" w dokumencie reguł; właścicielem jest .agents/skills/_shared.`,
                    evidence,
                });
            }
        }
        for (const stale of STALE_CLAIM_PATTERNS) {
            if (stale.pattern.test(line)) {
                signals.push({
                    id: "stale-or-unconditional-claim",
                    severity: "major",
                    detail: `Wzorzec nieaktualnej lub bezwarunkowej reguły (${stale.id}).`,
                    evidence,
                });
            }
        }
    }
    return signals;
}

function collectDocsMapPathSignals({root, file, blocks}) {
    const signals = [];
    for (const block of blocks) {
        for (const entry of block.entries) {
            if (GENERATED_DOCS_MAP_KEYS.has(entry.key) || entry.value.includes("*") || path.isAbsolute(entry.value)) {
                continue;
            }
            if (!existsSync(path.resolve(root, entry.value))) {
                signals.push({
                    id: "docs-map-path-missing",
                    severity: "info",
                    detail: `Ścieżka ${entry.key}=${entry.value} z docs_map nie istnieje.`,
                    evidence: `${file}:${entry.line}`,
                });
            }
        }
    }
    return signals;
}

function collectDuplicateHeadingSignals({file, headings}) {
    const seen = new Map();
    const signals = [];
    for (const heading of headings) {
        const key = heading.title.toLowerCase();
        if (!seen.has(key)) {
            seen.set(key, heading);
            continue;
        }
        signals.push({
            id: "duplicate-section-heading",
            severity: "minor",
            detail: `Powtórzony nagłówek sekcji "${heading.title}" (pierwsze wystąpienie: linia ${seen.get(key).line}).`,
            evidence: `${file}:${heading.line}`,
        });
    }
    return signals;
}

function countLanguages(items, selector) {
    const counts = {pl: 0, other: 0};
    for (const item of items) {
        counts[selector(item) === "pl" ? "pl" : "other"] += 1;
    }
    return counts;
}

function computeCatalogDelta(previous, input) {
    const previousFiles = new Map(previous.input.files.map((file) => [file.path, file.sha256]));
    const currentFiles = new Map(input.files.map((file) => [file.path, file.sha256]));
    const changed = [];
    const added = [];
    const removed = [];
    let unchanged = 0;
    for (const file of input.files) {
        if (!previousFiles.has(file.path)) {
            added.push(file.path);
            continue;
        }
        if (previousFiles.get(file.path) === file.sha256) {
            unchanged += 1;
        } else {
            changed.push(file.path);
        }
    }
    for (const file of previous.input.files) {
        if (!currentFiles.has(file.path)) {
            removed.push(file.path);
        }
    }
    return {
        previous_sha256: previous.input.sha256,
        changed: changed.sort(compareStrings),
        added: added.sort(compareStrings),
        removed: removed.sort(compareStrings),
        unchanged,
    };
}

function loadReviewFile({root, reviewPath}) {
    const absolutePath = path.resolve(reviewPath);
    const parsed = JSON.parse(readFileSync(absolutePath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new TypeError(`Invalid review file: ${reviewPath}`);
    }
    return {
        file: toPosix(path.relative(root, absolutePath)),
        status: "completed",
        findings: Array.isArray(parsed.findings) ? parsed.findings : [],
        standard_gaps: Array.isArray(parsed.standard_gaps) ? parsed.standard_gaps : [],
        verdict: typeof parsed.verdict === "string" ? parsed.verdict : null,
    };
}

function collectCatalogMjsDependencies({root, skillsRoot, name, artifact, declaredPaths, sharedEntry, inputs}) {
    const edges = [];
    const undeclared = [];
    const signals = [];
    for (const declaredPath of [...declaredPaths].sort(compareStrings)) {
        if (!declaredPath.endsWith(".mjs")) {
            continue;
        }
        const importingFile = path.join(skillsRoot, declaredPath);
        const importingSource = readFileSync(importingFile, "utf8");
        recordInput(inputs, {root, absolutePath: importingFile, source: importingSource});
        for (const specifier of collectImportSpecifiers(importingSource)) {
            if (!specifier.startsWith(".")) {
                continue;
            }
            const dependency = path.resolve(path.dirname(importingFile), specifier);
            const relative = path.relative(skillsRoot, dependency);
            if (relative === "" || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
                continue;
            }
            const dependencyPath = toPosix(relative);
            const declaredDependency = declaredPaths.has(dependencyPath);
            edges.push({from: declaredPath, to: dependencyPath, declared: declaredDependency});
            if (!declaredDependency) {
                undeclared.push({skill: name, from: declaredPath, imported: dependencyPath});
                signals.push({
                    id: "undeclared-mjs-dependency",
                    severity: "major",
                    detail: `${declaredPath} importuje ${dependencyPath}, którego nie ma w shared_files.`,
                    evidence: `${artifact.relativePath}:${sharedEntry === null ? 1 : sharedEntry.line}`,
                });
            }
        }
    }
    return {edges, undeclared, signals};
}

function buildCatalogSkill({root, name, skillsRoot, inputs, signals, index, routingSource}) {
    const absolutePath = path.join(skillsRoot, name, "SKILL.md");
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
        return null;
    }
    const artifact = readArtifact({root, file: toPosix(path.relative(root, absolutePath))});
    recordInput(inputs, {root, absolutePath: artifact.absolutePath, source: artifact.source});
    const {frontmatter, error} = parseFrontmatterSafe(artifact);
    if (error !== null) {
        signals.push({id: "skill-parse-error", severity: "major", detail: error, evidence: `${artifact.relativePath}:1`});
    }
    const descriptionEntry = frontmatter ? findFrontmatterEntry(frontmatter, "description") : null;
    const description = descriptionEntry
        ? describeText(frontmatterEntryText(descriptionEntry), frontmatterEntryLine(descriptionEntry))
        : describeText("", 1);
    const sharedEntry = frontmatter ? findFrontmatterEntry(frontmatter, "shared_files") : null;
    const declared = sharedEntry ? frontmatterEntryList(sharedEntry) : [];
    const declaredPaths = new Set();
    const missingEntries = [];
    const shared = {declared: [], missing: [], cross_skill: []};
    const sharedEdges = [];
    for (const entry of declared) {
        const resolved = resolveDeclaredSharedFile(skillsRoot, entry.value);
        shared.declared.push(entry.value);
        sharedEdges.push({skill: name, declared: entry.value, resolved: resolved.relativePath, status: resolved.status});
        if (resolved.status !== "present") {
            shared.missing.push(entry.value);
            missingEntries.push(entry);
            continue;
        }
        declaredPaths.add(resolved.relativePath);
        const segment = resolved.relativePath.split("/")[0];
        if (segment !== "_shared" && segment !== name) {
            shared.cross_skill.push(resolved.relativePath);
            signals.push({
                id: "cross-skill-shared-file",
                severity: "major",
                detail: `Deklaracja pliku innego skilla: ${entry.value}.`,
                evidence: `${artifact.relativePath}:${entry.line}`,
            });
        }
    }
    const mjs = collectCatalogMjsDependencies({root, skillsRoot, name, artifact, declaredPaths, sharedEntry, inputs});
    signals.push(...mjs.signals);
    const inIndex = index !== null && index.skills.some((entry) => entry.name === name);
    const inRouting = routingSource !== null && matchingLines(routingSource, [name]).length > 0;
    const duplicateBlocks = collectDuplicateBlocks(artifact.lines);
    const skill = {
        name,
        file: artifact.relativePath,
        sha256: artifact.sha256,
        lines: artifact.lines.length,
        bytes: artifact.bytes,
        description: {...description, tokens: Math.ceil(description.length / TOKENS_PER_CHAR)},
        language: isPolishText(artifact.source) ? "pl" : "other",
        shared_files: shared,
        sections: collectSections(artifact.lines, 0),
        duplicate_blocks: duplicateBlocks,
        test_pins: [],
        in_index: inIndex,
        in_routing_policy: inRouting,
    };
    signals.push(...buildSkillSignals({
        artifact,
        description,
        missing: missingEntries,
        duplicates: duplicateBlocks,
    }));
    if (index !== null && !inIndex) {
        signals.push({
            id: "missing-index-entry",
            severity: "major",
            detail: `Skill "$${name}" nie ma wpisu w docs/SKILLS.md.`,
            evidence: `${artifact.relativePath}:1`,
        });
    }
    const bodyStart = frontmatter ? frontmatter.bodyStartIndex : 0;
    return {
        skill,
        sharedEdges,
        mjsEdges: mjs.edges,
        mjsUndeclared: mjs.undeclared,
        textArtifact: {file: artifact.relativePath, lines: artifact.lines},
        duplicateArtifact: {file: artifact.relativePath, lines: artifact.lines.slice(bodyStart), offset: bodyStart},
    };
}

function buildCatalogAgent({root, absolutePath, inputs, signals, configEntries, configSource}) {
    const artifact = readArtifact({root, file: toPosix(path.relative(root, absolutePath))});
    recordInput(inputs, {root, absolutePath: artifact.absolutePath, source: artifact.source});
    const {frontmatter, error} = parseFrontmatterSafe(artifact);
    if (error !== null) {
        signals.push({id: "agent-parse-error", severity: "major", detail: error, evidence: `${artifact.relativePath}:1`});
    }
    const descriptionEntry = frontmatter ? findFrontmatterEntry(frontmatter, "description") : null;
    const description = descriptionEntry
        ? describeAgentText(frontmatterEntryText(descriptionEntry), frontmatterEntryLine(descriptionEntry))
        : describeAgentText("", 1);
    const agentName = path.basename(artifact.relativePath, ".md");
    const needles = [`${agentName}.md`, toPosix(path.join(".opencode", "agents", `${agentName}.md`)), agentName];
    const entry = configEntries.find((candidate) => candidate.name === agentName) ?? null;
    const entryText = entry === null || configSource === null ? "" : configSource.slice(entry.open, entry.close + 1);
    const config = {
        file: CONFIG_FILE,
        entry_present: entry !== null,
        entry_line: entry === null ? null : entry.line,
        has_model: /"model"\s*:/.test(entryText),
        has_reasoning: /"(?:variant|thinking)"\s*:/.test(entryText),
    };
    const forbidden = frontmatter ? collectForbiddenFields(frontmatter) : [];
    const delegatingSkills = collectDelegatingArtifacts({root, needles});
    const bodyLines = frontmatter ? artifact.lines.slice(frontmatter.bodyStartIndex) : artifact.lines;
    const agent = {
        name: agentName,
        file: artifact.relativePath,
        sha256: artifact.sha256,
        lines: artifact.lines.length,
        bytes: artifact.bytes,
        description: {...description, tokens: Math.ceil(description.length / TOKENS_PER_CHAR)},
        language: isPolishText(artifact.source) ? "pl" : "other",
        frontmatter: {
            present: frontmatter !== null,
            keys: frontmatter ? frontmatter.entries.map((entryItem) => entryItem.key) : [],
            forbidden_fields: forbidden,
        },
        body: {
            lines: bodyLines.length,
            bytes: Buffer.byteLength(bodyLines.join("\n"), "utf8"),
            sections: collectSections(artifact.lines, frontmatter ? frontmatter.bodyStartIndex : 0),
        },
        config,
        delegating_skills: delegatingSkills,
        test_pins: [],
    };
    signals.push(...buildAgentSignals({artifact, forbidden, config, delegatingSkills}));
    if (description.language !== "pl") {
        signals.push({
            id: "non-polish-agent-description",
            severity: "info",
            detail: "Opis agenta nie został rozpoznany jako polski (metryka bez twardego progu).",
            evidence: `${artifact.relativePath}:${description.line}`,
        });
    }
    const offset = frontmatter ? frontmatter.bodyStartIndex : 0;
    return {
        agent,
        textArtifact: {file: artifact.relativePath, lines: bodyLines, offset},
        duplicateArtifact: {file: artifact.relativePath, lines: bodyLines, offset},
    };
}

function buildCatalogRules({root, inputs, signals}) {
    const rulesFiles = [];
    const textArtifacts = [];
    const duplicateArtifacts = [];
    for (const [absolutePath, label] of [[path.join(root, "AGENTS.md"), "AGENTS.md"], [path.join(root, "README.md"), "README.md"]]) {
        if (!existsSync(absolutePath)) {
            rulesFiles.push({file: label, present: false, coverage: {status: "not_covered", reason: "document-not-found"}});
            signals.push({
                id: "missing-rules-document",
                severity: label === "AGENTS.md" ? "major" : "minor",
                detail: `Brak dokumentu reguł ${label}.`,
                evidence: `${label}:1`,
            });
            continue;
        }
        const source = readFileSync(absolutePath, "utf8");
        recordInput(inputs, {root, absolutePath, source});
        const lines = splitLines(source);
        const docsMapBlocks = parseDocsMapBlocks(lines);
        const headings = collectHeadings(lines);
        const fileEntry = {
            file: label,
            present: true,
            coverage: {status: "covered", reason: null},
            lines: lines.length,
            bytes: Buffer.byteLength(source, "utf8"),
            language: isPolishText(source) ? "pl" : "other",
            docs_map_blocks: docsMapBlocks.length,
            docs_map: docsMapBlocks,
            headings,
        };
        if (label === "README.md") {
            const span = findInstructionSpan(lines, README_INSTRUCTION_START, README_INSTRUCTION_END);
            if (span === null) {
                fileEntry.coverage = {status: "not_covered", reason: "instruction-span-not-located"};
            }
            fileEntry.instruction_span = span === null ? null : {start_line: span.start_line, end_line: span.end_line, lines: span.lines.length};
            const spanLines = span === null ? [] : span.lines;
            const offset = span === null ? 0 : span.start_line - 1;
            fileEntry.instruction_language = span === null ? null : (isPolishText(spanLines.join("\n")) ? "pl" : "other");
            signals.push(...collectRulesSignals({file: label, lines: spanLines, offset}));
            textArtifacts.push({file: label, lines: spanLines, offset});
            duplicateArtifacts.push({file: label, lines: spanLines, offset});
        } else {
            signals.push(...collectRulesSignals({file: label, lines}));
            signals.push(...collectDuplicateHeadingSignals({file: label, headings}));
            signals.push(...collectDocsMapPathSignals({root, file: label, blocks: docsMapBlocks}));
            if (docsMapBlocks.length > 1) {
                signals.push({
                    id: "duplicate-docs-map",
                    severity: "major",
                    detail: `Blok docs_map występuje ${docsMapBlocks.length} razy; kanoniczny blok jest tylko jeden.`,
                    evidence: `${label}:${docsMapBlocks[1].line}`,
                });
            }
            textArtifacts.push({file: label, lines});
            duplicateArtifacts.push({file: label, lines});
        }
        rulesFiles.push(fileEntry);
    }
    return {rulesFiles, textArtifacts, duplicateArtifacts};
}

function collectIndexSignals({index, skillDirs}) {
    if (index === null) {
        return [];
    }
    const signals = [];
    const diskNames = new Set(skillDirs);
    const indexOccurrences = new Map();
    for (const entry of index.skills) {
        if (!indexOccurrences.has(entry.name)) {
            indexOccurrences.set(entry.name, entry.lines[0]);
        }
    }
    for (const row of index.rows) {
        if (!indexOccurrences.has(row.skill)) {
            indexOccurrences.set(row.skill, row.line);
        }
    }
    for (const [name, line] of indexOccurrences) {
        if (!diskNames.has(name)) {
            signals.push({
                id: "index-orphan-skill",
                severity: "major",
                detail: `Indeks wskazuje nieistniejący skill "$${name}".`,
                evidence: `docs/SKILLS.md:${line}`,
            });
        }
    }
    const intentGroups = new Map();
    for (const row of index.rows) {
        const key = normalizeIntent(row.intent);
        if (!intentGroups.has(key)) {
            intentGroups.set(key, []);
        }
        intentGroups.get(key).push(row);
    }
    for (const rows of intentGroups.values()) {
        if (rows.length > 1) {
            signals.push({
                id: "trigger-overlap",
                severity: "major",
                detail: `Zduplikowana intencja triggera "${rows[0].intent}" (${rows.length} wiersze).`,
                evidence: `docs/SKILLS.md:${rows[0].line}`,
            });
        }
    }
    const skillRows = new Map();
    for (const row of index.rows) {
        if (!skillRows.has(row.skill)) {
            skillRows.set(row.skill, []);
        }
        skillRows.get(row.skill).push(row);
    }
    for (const [name, rows] of skillRows) {
        if (rows.length > 1) {
            signals.push({
                id: "index-duplicate-skill",
                severity: "minor",
                detail: `Skill "$${name}" występuje w tabeli triggerów ${rows.length} razy.`,
                evidence: `docs/SKILLS.md:${rows[0].line}`,
            });
        }
    }
    const rowSkills = new Set(index.rows.map((row) => row.skill));
    for (const entry of index.skills) {
        if (!rowSkills.has(entry.name)) {
            signals.push({
                id: "index-skill-without-trigger",
                severity: "info",
                detail: `Skill "$${entry.name}" nie ma wiersza w tabeli triggerów.`,
                evidence: `docs/SKILLS.md:${entry.lines[0]}`,
            });
        }
    }
    return signals;
}

function collectRoutingSignals({routing, routingSource, skillDirs, agentNames}) {
    if (routing === null) {
        return [];
    }
    const signals = [];
    for (const name of routing.referenced_skills) {
        if (!skillDirs.includes(name) && !agentNames.includes(name)) {
            signals.push({
                id: "routing-orphan-skill",
                severity: "major",
                detail: `Routing policy wskazuje nieistniejący skill "$${name}".`,
                evidence: `${routing.file}:${matchingLines(routingSource, [`$${name}`])[0] ?? 1}`,
            });
        }
    }
    return signals;
}

function buildCatalogReport({root, runMode, previousPath = null, reviewPath = null}) {
    const inputs = new Map();
    const signals = [];
    const areas = [];
    const skillsRoot = path.join(root, ".agents", "skills");
    const agentsRoot = path.join(root, ".opencode", "agents");
    const configPath = path.join(root, CONFIG_FILE);
    const indexFile = path.join(root, "docs", "SKILLS.md");
    const routingFile = path.join(skillsRoot, "_shared", "references", "skill-routing-policy.md");
    const agentsFile = path.join(root, "AGENTS.md");
    const readmeFile = path.join(root, "README.md");
    const readText = (absolutePath) => {
        const source = readFileSync(absolutePath, "utf8");
        recordInput(inputs, {root, absolutePath, source});
        return source;
    };

    let index = null;
    if (existsSync(indexFile)) {
        const parsed = parseSkillsIndex(readText(indexFile));
        index = {file: "docs/SKILLS.md", skills: parsed.skills, rows: parsed.rows};
        areas.push({id: "index", status: "covered", detail: `${parsed.skills.length} wpisów, ${parsed.rows.length} wierszy triggerów`});
    } else {
        areas.push({id: "index", status: "not_covered", detail: "brak docs/SKILLS.md"});
        signals.push({id: "missing-skills-index", severity: "major", detail: "Brak pliku docs/SKILLS.md.", evidence: "docs/SKILLS.md:1"});
    }

    let routing = null;
    let routingSource = null;
    if (existsSync(routingFile)) {
        routingSource = readText(routingFile);
        const referenced = new Set();
        for (const match of routingSource.matchAll(/\$([a-z0-9-]{2,})/gu)) {
            referenced.add(match[1]);
        }
        routing = {
            file: toPosix(path.relative(root, routingFile)),
            referenced_skills: [...referenced].sort(compareStrings),
        };
        areas.push({id: "routing-policy", status: "covered", detail: `${referenced.size} odwołań do skilli`});
    } else {
        areas.push({id: "routing-policy", status: "not_covered", detail: "brak skill-routing-policy.md"});
        signals.push({id: "missing-routing-policy", severity: "major", detail: "Brak pliku skill-routing-policy.md.", evidence: ".agents/skills/_shared/references/skill-routing-policy.md:1"});
    }

    let configEntries = [];
    let configSource = null;
    if (existsSync(configPath)) {
        configSource = readText(configPath);
        configEntries = listAgentEntries(configSource) ?? [];
        areas.push({id: "agent-config", status: "covered", detail: `${configEntries.length} wpisów`});
    } else {
        areas.push({id: "agent-config", status: "not_covered", detail: `brak ${CONFIG_FILE}`});
        signals.push({id: "missing-agent-config", severity: "major", detail: `Brak pliku ${CONFIG_FILE}.`, evidence: `${CONFIG_FILE}:1`});
    }

    const skills = [];
    const textArtifacts = [];
    const duplicateArtifacts = [];
    const sharedGraphEdges = [];
    const mjsEdges = [];
    const mjsUndeclared = [];
    const skillDirs = listSubdirectories(skillsRoot).filter((name) => name !== "_shared");
    for (const name of skillDirs) {
        const built = buildCatalogSkill({root, name, skillsRoot, inputs, signals, index, routingSource});
        if (built === null) {
            continue;
        }
        skills.push(built.skill);
        textArtifacts.push(built.textArtifact);
        duplicateArtifacts.push(built.duplicateArtifact);
        sharedGraphEdges.push(...built.sharedEdges);
        mjsEdges.push(...built.mjsEdges);
        mjsUndeclared.push(...built.mjsUndeclared);
    }
    areas.push({id: "skills", status: skills.length > 0 ? "covered" : "not_covered", detail: `${skills.length} korzeni SKILL.md`});

    const skillFiles = walkFiles(skillsRoot);
    const referenceFiles = skillFiles
        .filter((file) => file.endsWith(".md") && path.basename(file) !== "SKILL.md")
        .sort(compareStrings);
    for (const absolutePath of referenceFiles) {
        const source = readText(absolutePath);
        const file = toPosix(path.relative(root, absolutePath));
        const lines = splitLines(source);
        textArtifacts.push({file, lines});
        duplicateArtifacts.push({file, lines});
    }

    const sharedRoot = path.join(skillsRoot, "_shared");
    const sharedFiles = skillFiles
        .filter((file) => file.startsWith(`${sharedRoot}${path.sep}`))
        .map((absolutePath) => {
            const file = toPosix(path.relative(root, absolutePath));
            if (!inputs.has(file)) {
                recordInput(inputs, {root, absolutePath, source: readFileSync(absolutePath)});
            }
            return toPosix(path.relative(skillsRoot, absolutePath));
        })
        .sort(compareStrings);

    const agents = [];
    const agentFiles = listRegularFiles(agentsRoot, ".md");
    const agentNames = agentFiles.map((file) => path.basename(file, ".md"));
    for (const absolutePath of agentFiles) {
        const built = buildCatalogAgent({root, absolutePath, inputs, signals, configEntries, configSource});
        agents.push(built.agent);
        textArtifacts.push(built.textArtifact);
        duplicateArtifacts.push(built.duplicateArtifact);
    }
    areas.push({id: "agents", status: agents.length > 0 ? "covered" : "not_covered", detail: `${agents.length} plików agentów`});

    const orphanEntries = configEntries.filter((entry) => !BUILTIN_AGENT_KEYS.has(entry.name) && !agentNames.includes(entry.name));
    for (const entry of orphanEntries) {
        signals.push({
            id: "orphan-config-entry",
            severity: "major",
            detail: `Wpis "${entry.name}" w ${CONFIG_FILE} nie ma pliku .opencode/agents/${entry.name}.md.`,
            evidence: `${CONFIG_FILE}:${entry.line}`,
        });
    }

    const rules = buildCatalogRules({root, inputs, signals});
    const rulesFiles = rules.rulesFiles;
    textArtifacts.push(...rules.textArtifacts);
    duplicateArtifacts.push(...rules.duplicateArtifacts);
    const rulesCovered = rulesFiles.filter((file) => file.coverage.status === "covered").length;
    areas.push({
        id: "rules",
        status: rulesCovered === 2 ? "covered" : rulesCovered === 1 ? "partial" : "not_covered",
        detail: rulesFiles.map((file) => (file.coverage.status === "covered" ? file.file : `${file.file} (${file.coverage.reason})`)).join(", "),
    });

    const crossDuplicates = collectCrossFileDuplicateBlocks(duplicateArtifacts);
    for (const block of crossDuplicates) {
        const occurrenceList = block.occurrences.map((occurrence) => `${occurrence.file}:${occurrence.line}`).join(", ");
        signals.push({
            id: "duplicate-block",
            severity: "minor",
            detail: `Powtórzony blok ${block.lines} linii w plikach: ${occurrenceList}.`,
            evidence: `${block.occurrences[0].file}:${block.occurrences[0].line}`,
            preview: block.preview,
            occurrences: block.occurrences.map((occurrence) => `${occurrence.file}:${occurrence.line}`),
        });
    }

    signals.push(...collectIndexSignals({index, skillDirs}));
    signals.push(...collectRoutingSignals({routing, routingSource, skillDirs, agentNames}));

    const pinTargets = [
        ...skills.map((skill) => ({file: skill.file, needles: [skill.file]})),
        ...agents.map((agent) => ({file: agent.file, needles: [`${agent.name}.md`, toPosix(path.join(".opencode", "agents", `${agent.name}.md`)), agent.name]})),
    ];
    const testPins = collectCatalogTestPins({root, artifacts: pinTargets, inputs});
    const pinsByFile = new Map(testPins.artifacts.map((entry) => [entry.file, entry.pins]));
    for (const skill of skills) {
        skill.test_pins = pinsByFile.get(skill.file) ?? [];
    }
    for (const agent of agents) {
        agent.test_pins = pinsByFile.get(agent.file) ?? [];
    }

    const modelProfiles = new Set();
    const modelHierarchyPath = path.join(root, MODEL_HIERARCHY_FILE);
    if (existsSync(modelHierarchyPath)) {
        const source = readText(modelHierarchyPath);
        try {
            collectModelProfileNames(JSON.parse(source), modelProfiles);
        } catch {
            modelProfiles.clear();
        }
    }
    const profileNames = [...modelProfiles].sort(compareStrings);
    const modelSignals = collectModelNameSignals({artifacts: textArtifacts, profileNames});
    signals.push(...modelSignals);

    const descriptionBudget = summarizeDescriptionBudget(skills);
    areas.push({
        id: "shared-files-graph",
        status: isDirectory(sharedRoot) ? "covered" : "not_covered",
        detail: isDirectory(sharedRoot)
            ? `${sharedFiles.length} plików _shared, ${sharedGraphEdges.length} deklaracji shared_files`
            : "brak katalogu .agents/skills/_shared",
    });
    areas.push({id: "mjs-dependencies", status: "covered", detail: `${mjsEdges.length} krawędzi importów`});
    areas.push({id: "test-pins", status: "covered", detail: `${testPins.files_scanned} plików testów`});
    areas.push({id: "description-budget", status: "covered", detail: `${descriptionBudget.total_chars} znaków, ~${descriptionBudget.total_tokens} tokenów`});
    areas.push({id: "model-names", status: "covered", detail: `${textArtifacts.length} artefaktów, ${modelSignals.length} trafień`});
    areas.push({id: "language", status: "covered", detail: `${skills.length} opisów skilli, ${agents.length} opisów agentów`});

    const referencedBy = new Map();
    for (const edge of sharedGraphEdges) {
        if (edge.status !== "present" || edge.resolved === null) {
            continue;
        }
        if (!referencedBy.has(edge.resolved)) {
            referencedBy.set(edge.resolved, []);
        }
        referencedBy.get(edge.resolved).push(edge.skill);
    }

    let delta = null;
    if (previousPath !== null) {
        const previous = JSON.parse(readFileSync(path.resolve(previousPath), "utf8"));
        if (previous === null || previous.mode !== "catalog" || previous.input === null || !Array.isArray(previous.input.files)) {
            throw new TypeError(`Invalid previous catalog report: ${previousPath}`);
        }
        delta = computeCatalogDelta(previous, finalizeInput(inputs));
    }

    let review = null;
    if (runMode === "full") {
        review = {status: "pending", findings: [], standard_gaps: [], verdict: null};
        if (reviewPath !== null) {
            review = loadReviewFile({root, reviewPath});
        }
    }

    return {
        version: CATALOG_VERSION,
        mode: "catalog",
        run_mode: runMode,
        scope: {
            skills: ".agents/skills/*/SKILL.md",
            skill_references: ".agents/skills/**/*.md",
            shared_files: ".agents/skills/_shared/** (regular files)",
            agents: ".opencode/agents/*.md",
            agent_config: CONFIG_FILE,
            index: "docs/SKILLS.md",
            routing_policy: ".agents/skills/_shared/references/skill-routing-policy.md",
            rules: ["AGENTS.md", "README.md (bloki instrukcji)"],
            checks: CATALOG_CHECKS,
        },
        input: finalizeInput(inputs),
        coverage: {
            status: areas.every((area) => area.status === "covered") ? "complete" : "partial",
            areas,
            excluded: [
                {id: "docs-domain", reason: "Dokumentacja domenowa docs/** poza indeksem i blokami instrukcji należy do $docs-sync."},
                {id: "consumer-projects", reason: "Projekty konsumenckie i manifest LSM są poza zakresem (scope consumer odłożony)."},
                {id: "runtime-behavior", reason: "Runtime behavior, uprawnienia i efekty pracy agentów są poza zakresem."},
                {id: "opencode-config-values", reason: "Wartości model/reasoning w opencode.jsonc nie są oceniane."},
            ],
        },
        metrics: {
            skills,
            agents,
            agent_config: {
                file: CONFIG_FILE,
                entries: configEntries.map((entry) => ({name: entry.name, line: entry.line})),
                orphan_entries: orphanEntries.map((entry) => ({name: entry.name, line: entry.line})),
            },
            index,
            routing_policy: routing,
            rules: {files: rulesFiles},
            shared_files_graph: {
                files: sharedFiles,
                unreferenced_by_shared_files: sharedFiles.filter((file) => !referencedBy.has(file)),
                edges: sharedGraphEdges.sort((left, right) => compareStrings(left.skill, right.skill) || compareStrings(left.declared, right.declared)),
                referenced_by: [...referencedBy.entries()]
                    .map(([file, names]) => ({file, skills: [...new Set(names)].sort(compareStrings)}))
                    .sort((left, right) => compareStrings(left.file, right.file)),
            },
            mjs_dependencies: {
                edges: mjsEdges.sort((left, right) => compareStrings(left.from, right.from) || compareStrings(left.to, right.to)),
                undeclared: mjsUndeclared.sort((left, right) => compareStrings(left.skill, right.skill) || compareStrings(left.imported, right.imported)),
            },
            test_pins: testPins,
            description_budget: descriptionBudget,
            language: {
                skill_descriptions: countLanguages(skills, (skill) => skill.description.language),
                skill_roots: countLanguages(skills, (skill) => skill.language),
                agent_descriptions: countLanguages(agents, (agent) => agent.description.language),
                rules: rulesFiles.map((file) => ({file: file.file, language: file.language ?? null})),
            },
            model_names: {profiles: profileNames, matches: modelSignals.length},
        },
        signals: signals.sort((left, right) => compareStrings(left.id, right.id) || compareStrings(left.evidence, right.evidence)),
        delta,
        review,
    };
}

function renderCatalogMarkdown(report) {
    const lines = [];
    lines.push("# Skill-review catalog report", "");
    lines.push(`- Run mode: ${report.run_mode}`);
    lines.push(`- Input SHA-256: ${report.input.sha256}`);
    lines.push(`- Files scanned: ${report.input.count}`);
    lines.push("");
    lines.push("## Scope", "");
    for (const [key, value] of Object.entries(report.scope)) {
        lines.push(`- ${key}: ${Array.isArray(value) ? value.join(", ") : value}`);
    }
    lines.push("", "## Coverage", "");
    lines.push("| Area | Status | Detail |", "| --- | --- | --- |");
    for (const area of report.coverage.areas) {
        lines.push(`| ${area.id} | ${area.status} | ${area.detail ?? ""} |`);
    }
    lines.push("", "### Excluded", "");
    for (const item of report.coverage.excluded) {
        lines.push(`- ${item.id}: ${item.reason}`);
    }
    lines.push("", "## Summary", "");
    lines.push(`- Skills: ${report.metrics.skills.length}`);
    lines.push(`- Agents: ${report.metrics.agents.length}`);
    lines.push(`- Description budget: ${report.metrics.description_budget.total_chars} chars, ~${report.metrics.description_budget.total_tokens} tokens`);
    lines.push(`- Shared file edges: ${report.metrics.shared_files_graph.edges.length}`);
    lines.push(`- MJS import edges: ${report.metrics.mjs_dependencies.edges.length}`);
    lines.push(`- Signals: ${report.signals.length}`);
    lines.push("", "## Signals", "");
    if (report.signals.length === 0) {
        lines.push("No signals.", "");
    }
    for (const signal of report.signals) {
        const preview = signal.preview ? ` | ${signal.preview}` : "";
        lines.push(`- [${signal.severity}] ${signal.id} — ${signal.evidence}${preview}`);
        lines.push(`  - ${signal.detail}`);
    }
    lines.push("", "## Delta", "");
    if (report.delta === null) {
        lines.push("Not requested.", "");
    } else {
        lines.push(`- Previous SHA-256: ${report.delta.previous_sha256}`);
        lines.push(`- Changed: ${report.delta.changed.length === 0 ? "none" : report.delta.changed.join(", ")}`);
        lines.push(`- Added: ${report.delta.added.length === 0 ? "none" : report.delta.added.join(", ")}`);
        lines.push(`- Removed: ${report.delta.removed.length === 0 ? "none" : report.delta.removed.join(", ")}`);
        lines.push(`- Unchanged: ${report.delta.unchanged}`);
        lines.push("");
    }
    lines.push("## Review", "");
    if (report.review === null) {
        lines.push("Not requested (collector-only).", "");
    } else if (report.review.status === "pending") {
        lines.push("Pending: run the full review and provide --review-file.", "");
    } else {
        lines.push(`- Verdict: ${report.review.verdict ?? "none"}`);
        for (const finding of report.review.findings) {
            lines.push(`- Finding: ${typeof finding === "string" ? finding : JSON.stringify(finding)}`);
        }
        for (const gap of report.review.standard_gaps) {
            lines.push(`- Standard gap: ${typeof gap === "string" ? gap : JSON.stringify(gap)}`);
        }
        lines.push("");
    }
    return `${lines.join("\n")}\n`;
}

function usage() {
    return [
        "Usage: node inventory.mjs --mode <skill|agent|catalog> [options]",
        "",
        "Builds a deterministic JSON inventory of a skill or agent artifact, or of the whole instruction catalog.",
        "",
        "Options:",
        "  --mode <skill|agent|catalog>  Artifact kind to inspect",
        "  --file <path>                 Artifact path (required for skill and agent mode)",
        "  --root <path>                 Repository root (defaults to the current directory)",
        "  --output <path>               Write JSON to a file instead of stdout",
        "  --report-dir <path>           catalog: write catalog-report.json and catalog-report.md",
        "  --run-mode <collector-only|full>  catalog: run mode recorded in the report (default collector-only)",
        "  --previous <path>             catalog: previous catalog-report.json for hash delta",
        "  --review-file <path>          catalog full mode: JSON with findings, standard_gaps and verdict",
        "  --help                        Show this help message",
    ].join("\n");
}

function parseCliArgs(args) {
    const parsed = {
        help: false,
        mode: null,
        file: null,
        root: null,
        outputPath: null,
        reportDir: null,
        runMode: "collector-only",
        previousPath: null,
        reviewPath: null,
    };
    const valueOptions = ["--mode", "--file", "--root", "--output", "--report-dir", "--run-mode", "--previous", "--review-file"];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === "--help") {
            parsed.help = true;
            return parsed;
        }
        if (valueOptions.includes(arg)) {
            const value = args[index + 1];
            if (typeof value !== "string") {
                throw new TypeError(`Missing value for ${arg}`);
            }
            if (arg === "--mode") {
                parsed.mode = value;
            } else if (arg === "--file") {
                parsed.file = value;
            } else if (arg === "--root") {
                parsed.root = value;
            } else if (arg === "--output") {
                parsed.outputPath = value;
            } else if (arg === "--report-dir") {
                parsed.reportDir = value;
            } else if (arg === "--run-mode") {
                parsed.runMode = value;
            } else if (arg === "--previous") {
                parsed.previousPath = value;
            } else {
                parsed.reviewPath = value;
            }
            index += 1;
            continue;
        }
        throw new TypeError(`Unknown argument: ${arg}`);
    }
    return parsed;
}

function writeJsonArtifact(outputPath, json) {
    const resolvedPath = path.resolve(outputPath);
    mkdirSync(path.dirname(resolvedPath), {recursive: true});
    writeFileSync(resolvedPath, json, "utf8");
    return resolvedPath;
}

function runCatalogMode(parsed) {
    if (parsed.file !== null) {
        throw new TypeError("--file is not supported with catalog mode");
    }
    if (!CATALOG_RUN_MODES.includes(parsed.runMode)) {
        throw new TypeError(`Unknown run mode: ${parsed.runMode}`);
    }
    if ((parsed.reviewPath !== null) && parsed.runMode !== "full") {
        throw new TypeError("--review-file requires --run-mode full");
    }
    const root = path.resolve(parsed.root ?? process.cwd());
    const report = buildCatalogReport({
        root,
        runMode: parsed.runMode,
        previousPath: parsed.previousPath,
        reviewPath: parsed.reviewPath,
    });
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (parsed.reportDir !== null) {
        const reportDir = path.resolve(parsed.reportDir);
        mkdirSync(reportDir, {recursive: true});
        const jsonPath = path.join(reportDir, CATALOG_REPORT_JSON);
        writeFileSync(jsonPath, json, "utf8");
        writeFileSync(path.join(reportDir, CATALOG_REPORT_MD), renderCatalogMarkdown(report), "utf8");
        process.stdout.write(`${jsonPath}\n`);
        return 0;
    }
    if (parsed.outputPath !== null) {
        process.stdout.write(`${writeJsonArtifact(parsed.outputPath, json)}\n`);
        return 0;
    }
    process.stdout.write(json);
    return 0;
}

function main(argv) {
    try {
        const parsed = parseCliArgs(argv);
        if (parsed.help) {
            process.stdout.write(`${usage()}\n`);
            return 0;
        }
        if (parsed.mode !== "skill" && parsed.mode !== "agent" && parsed.mode !== "catalog") {
            process.stderr.write(`Unknown or missing mode: ${parsed.mode ?? "<none>"}\n`);
            process.stderr.write(`${usage()}\n`);
            return 2;
        }
        if (parsed.mode === "catalog") {
            return runCatalogMode(parsed);
        }
        if (parsed.reportDir !== null || parsed.previousPath !== null || parsed.reviewPath !== null || parsed.runMode !== "collector-only") {
            throw new TypeError("Catalog options require --mode catalog");
        }
        if (!parsed.file) {
            process.stderr.write("Missing required option: --file\n");
            process.stderr.write(`${usage()}\n`);
            return 2;
        }
        const root = path.resolve(parsed.root ?? process.cwd());
        const artifact = readArtifact({root, file: parsed.file});
        const inventory = parsed.mode === "skill"
            ? buildSkillInventory({root, artifact})
            : buildAgentInventory({root, artifact});
        const json = `${JSON.stringify(inventory, null, 2)}\n`;
        if (parsed.outputPath) {
            process.stdout.write(`${writeJsonArtifact(parsed.outputPath, json)}\n`);
        } else {
            process.stdout.write(json);
        }
        return 0;
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
        return 2;
    }
}

if (isMainModule(import.meta.url)) {
    process.exitCode = main(process.argv.slice(2));
}
