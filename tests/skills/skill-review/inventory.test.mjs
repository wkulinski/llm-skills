import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SCRIPT = path.join(ROOT, ".agents/skills/skill-review/scripts/inventory.mjs");
const SKILL_FILE = ".agents/skills/example/SKILL.md";
const AGENT_FILE = ".opencode/agents/example-agent.md";
const SHARED_PRESENT = "example/present-shared.md";
const SHARED_MISSING = "example/missing-shared.md";
const SKILL_DESCRIPTION = "Użyj, gdy potrzebujesz przykładu do testu.";
const AGENT_DESCRIPTION = "Agent przykładowy do zadań testowych.";
const SKILL_CHECKS = ["description", "frontmatter", "root-sections", "shared-files", "test-pins", "duplicate-blocks"];
const AGENT_CHECKS = ["frontmatter", "body-sections", "config-entry", "delegating-skills", "test-pins"];
const DUPLICATE_BLOCKS = Array.from({length: 24}, (_, block) =>
    Array.from({length: 4 + block % 3}, (_element, line) => `Shared instruction ${block}, line ${line}.`));

const SKILL_SOURCE = [
    "---",
    "name: example",
    `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
    "shared_files:",
    `  - ${SHARED_PRESENT}`,
    `  - ${SHARED_MISSING}`,
    "---",
    "",
    "# Example skill",
    "",
    "Deleguje do `.opencode/agents/example-agent.md` podczas testu.",
    "",
    "Wywołuje agenta example-agent bez ścieżki.",
    "",
    "Wpis example-agent-extra nie jest delegacją.",
    "",
    "## Sekcja pierwsza",
    "",
    ...DUPLICATE_BLOCKS.flatMap((block) => [...block, ""]),
    "",
    "filler",
    "",
    "## Sekcja druga",
    "",
    ...DUPLICATE_BLOCKS.flatMap((block) => [...block, ""]),
    "",
    "## Sekcja trzecia",
    "",
    "Zamknięcie.",
    "",
].join("\n");

const AGENT_SOURCE = [
    "---",
    `description: ${JSON.stringify(AGENT_DESCRIPTION)}`,
    "model: x",
    "---",
    "",
    "# Example agent",
    "",
    "Body line.",
    "",
    "## Agent section",
    "",
    "Koniec.",
    "",
].join("\n");

const CONFIG_SOURCE = [
    "{",
    "    // przykładowa konfiguracja",
    "    \"agent\": {",
    "        \"example-agent\": {",
    "            \"model\": \"openai/gpt-x\",",
    "            \"variant\": \"high\"",
    "        }",
    "    }",
    "}",
    "",
].join("\n");

const TEST_SOURCE = [
    "import path from \"node:path\";",
    "",
    `export const SKILL_PATH = "${SKILL_FILE}";`,
    `export const AGENT_PATH = "${AGENT_FILE}";`,
    "export const OTHER_SKILL_PATH = \".agents/skills/other/SKILL.md\";",
    "export const GENERIC_SKILL_NAME = \"SKILL.md\";",
    "",
].join("\n");

let fixtureRoot;

beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-review-inventory-"));
    writeFixture(fixtureRoot);
});

afterEach(() => {
    fs.rmSync(fixtureRoot, {recursive: true, force: true});
});

describe("skill-review inventory collector", () => {
    it("collects deterministic skill metrics from a fixture repository", () => {
        const result = runInventory("skill", SKILL_FILE);
        expect(result.status, result.stderr).toBe(0);

        const inventory = JSON.parse(result.stdout);
        expect(inventory.version).toBe(1);
        expect(inventory.mode).toBe("skill");
        expect(inventory.file).toBe(SKILL_FILE);
        expect(inventory.source_sha256).toBe(sha256(fixtureFile(SKILL_FILE)));

        expect(inventory.metrics.description).toEqual({
            text: SKILL_DESCRIPTION,
            length: SKILL_DESCRIPTION.length,
            language: "pl",
            has_usage_trigger: true,
            line: lineOf(SKILL_SOURCE, "description:"),
        });
        expect(inventory.metrics.frontmatter).toEqual({
            present: true,
            name: "example",
            shared_files: [SHARED_PRESENT, SHARED_MISSING],
        });
        expect(inventory.metrics.root.lines).toBe(SKILL_SOURCE.split("\n").length - 1);
        expect(inventory.metrics.root.bytes).toBe(Buffer.byteLength(SKILL_SOURCE, "utf8"));
        expect(inventory.metrics.root.sections).toEqual([
            {title: "Sekcja pierwsza", line: lineOf(SKILL_SOURCE, "## Sekcja pierwsza"), lines: lineOf(SKILL_SOURCE, "## Sekcja druga") - lineOf(SKILL_SOURCE, "## Sekcja pierwsza")},
            {title: "Sekcja druga", line: lineOf(SKILL_SOURCE, "## Sekcja druga"), lines: lineOf(SKILL_SOURCE, "## Sekcja trzecia") - lineOf(SKILL_SOURCE, "## Sekcja druga")},
            {title: "Sekcja trzecia", line: lineOf(SKILL_SOURCE, "## Sekcja trzecia"), lines: 3},
        ]);

        expect(inventory.metrics.shared_files.declared).toEqual([SHARED_PRESENT, SHARED_MISSING]);
        expect(inventory.metrics.shared_files.missing).toEqual([SHARED_MISSING]);
        expect(inventory.metrics.test_pins).toEqual([
            {file: "tests/example.test.mjs", lines: [lineOf(TEST_SOURCE, SKILL_FILE)]},
        ]);

        expect(inventory.metrics.duplicate_blocks).toEqual(DUPLICATE_BLOCKS.map((block) => ({
            lines: block.length,
            occurrences: linesOf(SKILL_SOURCE, block[0]),
            preview: block[0],
        })));

        const signalIds = inventory.signals.map((signal) => signal.id);
        expect(signalIds).toContain("shared-file-missing");
        expect(signalIds).toContain("duplicate-block");
        expect(signalIds).not.toContain("missing-usage-trigger");
        expect(signalIds).not.toContain("non-polish-description");
        expect(inventory.signals.find((signal) => signal.id === "shared-file-missing")).toMatchObject({
            severity: "major",
            evidence: `${SKILL_FILE}:${lineOf(SKILL_SOURCE, SHARED_MISSING)}`,
        });

        expect(inventory.coverage.status).toBe("complete");
        expect(inventory.coverage.checks).toEqual(SKILL_CHECKS.map((id) => ({id, status: "checked"})));
        expect(inventory.coverage.not_checked).toEqual([]);
    });

    it("returns byte-identical JSON for repeated skill runs", () => {
        const first = runInventory("skill", SKILL_FILE);
        const second = runInventory("skill", SKILL_FILE);

        expect(first.status, first.stderr).toBe(0);
        expect(second.status, second.stderr).toBe(0);
        expect(first.stdout).toBe(second.stdout);
    });

    it("collects agent metrics, config entry and delegation references", () => {
        const result = runInventory("agent", AGENT_FILE);
        expect(result.status, result.stderr).toBe(0);

        const inventory = JSON.parse(result.stdout);
        expect(inventory.version).toBe(1);
        expect(inventory.mode).toBe("agent");
        expect(inventory.file).toBe(AGENT_FILE);
        expect(inventory.source_sha256).toBe(sha256(fixtureFile(AGENT_FILE)));

        expect(inventory.metrics.frontmatter.keys).toEqual(["description", "model"]);
        expect(inventory.metrics.frontmatter.description).toMatchObject({
            text: AGENT_DESCRIPTION,
            length: AGENT_DESCRIPTION.length,
            has_trigger: false,
            line: lineOf(AGENT_SOURCE, "description:"),
        });
        expect(inventory.metrics.frontmatter.forbidden_fields).toEqual([
            {key: "model", line: lineOf(AGENT_SOURCE, "model: x")},
        ]);
        expect(inventory.metrics.body.lines).toBe(8);
        expect(inventory.metrics.body.sections).toEqual([
            {title: "Agent section", line: 6, lines: 3},
        ]);
        expect(inventory.metrics.config).toEqual({
            file: "opencode.jsonc",
            entry_present: true,
            entry_line: lineOf(CONFIG_SOURCE, "\"example-agent\""),
            has_model: true,
            has_reasoning: true,
        });
        expect(inventory.metrics.delegating_skills).toEqual([
            {file: SKILL_FILE, lines: [lineOf(SKILL_SOURCE, AGENT_FILE), lineOf(SKILL_SOURCE, "Wywołuje agenta")]},
        ]);
        expect(inventory.metrics.test_pins).toEqual([
            {file: "tests/example.test.mjs", lines: [lineOf(TEST_SOURCE, AGENT_FILE)]},
        ]);

        const signalIds = inventory.signals.map((signal) => signal.id);
        expect(signalIds).toContain("frontmatter-model-pin");
        expect(signalIds).not.toContain("missing-config-entry");
        expect(signalIds).not.toContain("missing-model-config");
        expect(signalIds).not.toContain("missing-reasoning-config");
        expect(signalIds).not.toContain("no-delegating-skill");
        expect(signalIds.filter((id) => /description|length/i.test(id))).toEqual([]);

        expect(inventory.coverage.status).toBe("complete");
        expect(inventory.coverage.checks).toEqual(AGENT_CHECKS.map((id) => ({id, status: "checked"})));
        expect(inventory.coverage.not_checked).toEqual([]);
    });

    it("exits with code 2 and writes no JSON for invalid input", () => {
        const missingFile = runInventory("skill", ".agents/skills/example/missing.md");
        expect(missingFile.status).toBe(2);
        expect(missingFile.stderr).not.toBe("");
        expect(missingFile.stdout).toBe("");

        const invalidFile = path.join(fixtureRoot, "invalid.md");
        fs.writeFileSync(invalidFile, "# Bez frontmattera\n");
        const missingFrontmatter = runInventory("skill", invalidFile);
        expect(missingFrontmatter.status).toBe(2);
        expect(missingFrontmatter.stderr).not.toBe("");
        expect(missingFrontmatter.stdout).toBe("");

        const unknownMode = spawnSync(process.execPath, [SCRIPT, "--mode", "unknown", "--file", SKILL_FILE, "--root", fixtureRoot], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(unknownMode.status).toBe(2);
        expect(unknownMode.stderr).not.toBe("");
        expect(unknownMode.stdout).toBe("");
    });
});

function writeFixture(root) {
    const skillDir = path.join(root, ".agents/skills/example");
    fs.mkdirSync(skillDir, {recursive: true});
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), SKILL_SOURCE);
    fs.writeFileSync(path.join(skillDir, "present-shared.md"), "# Shared\n");
    fs.mkdirSync(path.join(root, ".opencode/agents"), {recursive: true});
    fs.writeFileSync(path.join(root, ".opencode/agents/example-agent.md"), AGENT_SOURCE);
    fs.writeFileSync(path.join(root, "opencode.jsonc"), CONFIG_SOURCE);
    fs.mkdirSync(path.join(root, "tests"), {recursive: true});
    fs.writeFileSync(path.join(root, "tests/example.test.mjs"), TEST_SOURCE);
    fs.writeFileSync(path.join(root, "tests/other.test.mjs"), 'const file = ".agents/skills/other/SKILL.md";\n');
}

function runInventory(mode, file) {
    return spawnSync(process.execPath, [SCRIPT, "--mode", mode, "--file", file, "--root", fixtureRoot], {
        cwd: ROOT,
        encoding: "utf8",
    });
}

function fixtureFile(file) {
    return fs.readFileSync(path.join(fixtureRoot, file));
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function lineOf(source, needle) {
    return source.split("\n").findIndex((line) => line.includes(needle)) + 1;
}

function linesOf(source, needle) {
    return source.split("\n")
        .map((line, index) => ({line, number: index + 1}))
        .filter(({line}) => line.includes(needle))
        .map(({number}) => number);
}
