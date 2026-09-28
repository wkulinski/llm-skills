import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SCRIPT = path.join(ROOT, ".agents/skills/skill-review/scripts/inventory.mjs");
const REPORT_JSON = "catalog-report.json";
const REPORT_MD = "catalog-report.md";
const ALPHA = ".agents/skills/alpha/SKILL.md";
const BETA = ".agents/skills/beta/SKILL.md";
const AGENT_ONE = ".opencode/agents/agent-one.md";
const AGENT_TWO = ".opencode/agents/agent-two.md";
const SKILL_DESCRIPTION = "Narzędzie testowe. Użyj, gdy potrzebny jest test katalogu.";
const DUPLICATE_BLOCKS = Array.from({length: 24}, (_, block) =>
    Array.from({length: 4 + block % 3}, (_element, line) => `Wspólna instrukcja ${block}, linia ${line}.`));
const PUNCTUATION_BLOCK = ["]", "}", "}", "}"];
const OVERLAP_INTENT = "Zrób wspólną rzecz";

const ALPHA_SOURCE = [
    "---",
    "name: alpha",
    `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
    "---",
    "",
    "# Alpha",
    "",
    ...DUPLICATE_BLOCKS.flatMap((block) => [...block, ""]),
    "",
    ...PUNCTUATION_BLOCK,
    "",
    "Model example: openai/gpt-x jest tu tylko w tekscie normatywnym.",
    "",
].join("\n");

const BETA_SOURCE = [
    "---",
    "name: beta",
    `description: ${JSON.stringify(SKILL_DESCRIPTION)}`,
    "---",
    "",
    "# Beta",
    "",
    ...DUPLICATE_BLOCKS.flatMap((block) => [...block, ""]),
    "",
    ...PUNCTUATION_BLOCK,
    "",
].join("\n");

const INDEX_SOURCE = [
    "# Skills Index",
    "",
    "## Tabela triggerów",
    "",
    "### Planowanie",
    "",
    "| Intencja | Skill | Następny krok |",
    "| --- | --- | --- |",
    `| ${OVERLAP_INTENT} | \`$alpha\` | krok pierwszy |`,
    `| ${OVERLAP_INTENT} | \`$alpha\` | krok drugi |`,
    "",
    "## Lista skilli",
    "",
    "- `$alpha`",
    "- `$ghost-skill`",
    "",
].join("\n");

const ROUTING_SOURCE = [
    "# Routing",
    "",
    "Użyj `$alpha` do pracy testowej.",
    "",
].join("\n");

const AGENTS_SOURCE = [
    "# Example rules",
    "",
    "## Documentation map",
    "",
    "docs_map:",
    "    MAIN_DOC: docs/README.md",
    "",
    "## Start",
    "",
    "Uruchom `$alpha`, gdy potrzebny jest test.",
    "",
].join("\n");

const README_SOURCE = [
    "# Example repository",
    "",
    "## Using These Skills in Another Project",
    "",
    "Paste instructions here.",
    "",
    "## Runtime Setup for Consumer Projects",
    "",
    "Runtime details.",
    "",
].join("\n");

const CONFIG_SOURCE = [
    "{",
    "    \"agent\": {",
    "        \"title\": {",
    "            \"model\": \"openai/gpt-x\",",
    "            \"variant\": \"high\"",
    "        },",
    "        \"build\": {",
    "            \"prompt\": \"test\"",
    "        },",
    "        \"agent-two\": {",
    "            \"model\": \"openai/gpt-x\",",
    "            \"variant\": \"high\"",
    "        },",
    "        \"ghost-agent\": {",
    "            \"model\": \"openai/gpt-x\",",
    "            \"variant\": \"high\"",
    "        }",
    "    }",
    "}",
    "",
].join("\n");

const AGENT_ONE_SOURCE = [
    "---",
    "description: Agent testowy pierwszy, używany gdy trzeba.",
    "mode: subagent",
    "---",
    "",
    "Body.",
    "",
].join("\n");

const AGENT_TWO_SOURCE = [
    "---",
    "description: Agent testowy drugi, używany gdy trzeba.",
    "mode: subagent",
    "---",
    "",
    "Body.",
    "",
].join("\n");

const TEST_SOURCE = [
    "export const ALPHA_PATH = \".agents/skills/alpha/SKILL.md\";",
    "export const AGENT_PATH = \".opencode/agents/agent-two.md\";",
    "",
].join("\n");

let fixtureRoot;

beforeEach(() => {
    fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skill-review-catalog-"));
    writeFixture(fixtureRoot);
});

afterEach(() => {
    fs.rmSync(fixtureRoot, {recursive: true, force: true});
});

describe("skill-review catalog collector", () => {
    it("detects the planned anomalies on a fixture mini-catalog and declares coverage", () => {
        const reportDir = path.join(fixtureRoot, "reports");
        const result = runCatalog(["--report-dir", reportDir]);
        expect(result.status, result.stderr).toBe(0);

        const report = readReport(reportDir);
        expect(report.version).toBe(1);
        expect(report.mode).toBe("catalog");
        expect(report.run_mode).toBe("collector-only");
        expect(report.review).toBeNull();
        expect(report.input.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(report.input.count).toBeGreaterThan(0);
        expect(report.input.files.map((file) => file.path)).toContain(ALPHA);

        const signalIds = report.signals.map((signal) => signal.id);
        expect(signalIds).toContain("duplicate-block");
        expect(signalIds).toContain("trigger-overlap");
        expect(signalIds).toContain("missing-index-entry");
        expect(signalIds).toContain("model-name-in-normative-text");
        expect(signalIds).toContain("missing-config-entry");
        expect(signalIds).toContain("orphan-config-entry");
        expect(signalIds).toContain("index-orphan-skill");

        const duplicates = report.signals.filter((signal) => signal.id === "duplicate-block");
        const expectedDuplicates = DUPLICATE_BLOCKS.map((block) => ({
            preview: block[0],
            occurrences: [
                `${ALPHA}:${lineOf(ALPHA_SOURCE, block[0])}`,
                `${BETA}:${lineOf(BETA_SOURCE, block[0])}`,
            ],
        }));
        expect(duplicates).toHaveLength(expectedDuplicates.length);
        expect(duplicates.map(({preview, occurrences}) => ({preview, occurrences}))).toEqual(expect.arrayContaining(expectedDuplicates));
        expect(report.metrics.skills.find((skill) => skill.name === "alpha").test_pins).toEqual([
            {file: "tests/example.test.mjs", lines: [lineOf(TEST_SOURCE, ALPHA)]},
        ]);
        expect(report.metrics.skills.find((skill) => skill.name === "beta").test_pins).toEqual([]);

        const overlap = report.signals.find((signal) => signal.id === "trigger-overlap");
        expect(overlap.detail).toContain(OVERLAP_INTENT);

        const missingIndex = report.signals.find((signal) => signal.id === "missing-index-entry");
        expect(missingIndex.detail).toContain("$beta");

        const modelName = report.signals.find((signal) => signal.id === "model-name-in-normative-text");
        expect(modelName.evidence).toBe(`${ALPHA}:${lineOf(ALPHA_SOURCE, "openai/gpt-x")}`);

        const missingConfig = report.signals.find((signal) => signal.id === "missing-config-entry");
        expect(missingConfig.detail).toContain("agent-one");

        const orphanConfig = report.signals.find((signal) => signal.id === "orphan-config-entry");
        expect(orphanConfig.detail).toContain("ghost-agent");
        expect(report.metrics.agent_config.orphan_entries.map((entry) => entry.name)).toEqual(["ghost-agent"]);

        expect(report.coverage.status).toBe("complete");
        expect(report.coverage.areas.map((area) => area.id)).toEqual([
            "index",
            "routing-policy",
            "agent-config",
            "skills",
            "agents",
            "rules",
            "shared-files-graph",
            "mjs-dependencies",
            "test-pins",
            "description-budget",
            "model-names",
            "language",
        ]);
        expect(report.coverage.excluded.map((area) => area.id)).toEqual([
            "docs-domain",
            "consumer-projects",
            "runtime-behavior",
            "opencode-config-values",
        ]);

        const md = fs.readFileSync(path.join(reportDir, REPORT_MD), "utf8");
        expect(md).toContain("# Skill-review catalog report");
        expect(md).toContain("## Coverage");
        expect(md).toContain("collector-only");
    });

    it.each([
        {readme: "recognized", agentsPresent: true, rulesStatus: "covered", reason: null},
        {readme: "unrecognized", agentsPresent: true, rulesStatus: "partial", reason: "instruction-span-not-located"},
        {readme: "missing", agentsPresent: true, rulesStatus: "partial", reason: "document-not-found"},
        {readme: "recognized", agentsPresent: false, rulesStatus: "partial", reason: null},
        {readme: "unrecognized", agentsPresent: false, rulesStatus: "not_covered", reason: "instruction-span-not-located"},
        {readme: "missing", agentsPresent: false, rulesStatus: "not_covered", reason: "document-not-found"},
    ])("reports rules coverage for README=$readme, AGENTS present=$agentsPresent", ({readme, agentsPresent, rulesStatus, reason}) => {
        if (readme === "unrecognized") {
            write(fixtureRoot, "README.md", "# Repo\n\n## Instrukcje dla konsumentów\n\nSTOP_CODES\n");
        } else if (readme === "missing") {
            fs.rmSync(path.join(fixtureRoot, "README.md"));
        }
        if (!agentsPresent) {
            fs.rmSync(path.join(fixtureRoot, "AGENTS.md"));
        }
        const reportDir = path.join(fixtureRoot, "reports");
        const result = runCatalog(["--report-dir", reportDir]);
        expect(result.status, result.stderr).toBe(0);
        const report = readReport(reportDir);
        const rules = report.coverage.areas.find((area) => area.id === "rules");
        const readmeMetrics = report.metrics.rules.files.find((file) => file.file === "README.md");
        expect(readmeMetrics.coverage).toEqual({status: reason === null ? "covered" : "not_covered", reason});
        expect(rules.status).toBe(rulesStatus);
        expect(report.coverage.status).toBe(rulesStatus === "covered" ? "complete" : "partial");
        if (reason !== null) {
            expect(rules.detail).toContain(reason);
            expect(fs.readFileSync(path.join(reportDir, REPORT_MD), "utf8")).toContain(reason);
        }
        if (readme === "unrecognized") {
            expect(readmeMetrics.instruction_span).toBeNull();
            expect(report.signals.filter((signal) => signal.evidence.startsWith("README.md:"))).toEqual([]);
        }
    });

    it("inventories shared files independently of declarations and includes them in hash deltas", () => {
        const shared = ".agents/skills/_shared/";
        const declaredScript = `${shared}scripts/declared.sh`;
        const unreferencedScript = `${shared}scripts/standalone.sh`;
        const sharedReference = `${shared}references/shared.md`;
        const routing = `${shared}references/skill-routing-policy.md`;
        write(fixtureRoot, declaredScript, "#!/usr/bin/env bash\ntrue\n");
        write(fixtureRoot, unreferencedScript, "#!/usr/bin/env bash\ntrue\n");
        write(fixtureRoot, sharedReference, "# Reference\n");
        write(fixtureRoot, ALPHA, ALPHA_SOURCE.replace("name: alpha\n", "name: alpha\nshared_files:\n  - _shared/scripts/declared.sh\n  - _shared/references/shared.md\n"));
        write(fixtureRoot, BETA, BETA_SOURCE.replace("name: beta\n", "name: beta\nshared_files:\n  - _shared/references/shared.md\n"));
        const firstDir = path.join(fixtureRoot, "shared-first");
        const firstRun = runCatalog(["--report-dir", firstDir]);
        expect(firstRun.status, firstRun.stderr).toBe(0);
        const first = readReport(firstDir);
        const graph = first.metrics.shared_files_graph;
        expect(graph.files).toEqual([
            "_shared/references/shared.md", "_shared/references/skill-routing-policy.md",
            "_shared/scripts/declared.sh", "_shared/scripts/standalone.sh",
        ]);
        expect(graph.unreferenced_by_shared_files).toEqual(["_shared/references/skill-routing-policy.md", "_shared/scripts/standalone.sh"]);
        expect(graph.referenced_by).toEqual([
            {file: "_shared/references/shared.md", skills: ["alpha", "beta"]},
            {file: "_shared/scripts/declared.sh", skills: ["alpha"]},
        ]);
        expect(first.input.files.map((file) => file.path)).toEqual(expect.arrayContaining([sharedReference, routing, declaredScript, unreferencedScript]));
        expect(first.signals.filter((signal) => signal.evidence.startsWith(`${unreferencedScript}:`))).toEqual([]);
        expect(first.coverage.areas.find((area) => area.id === "shared-files-graph").status).toBe("covered");

        fs.appendFileSync(path.join(fixtureRoot, unreferencedScript), "# Updated standalone command\n");
        fs.rmSync(path.join(fixtureRoot, declaredScript));
        const addedFile = `${shared}templates/new.json`;
        write(fixtureRoot, addedFile, "{}\n");
        const secondDir = path.join(fixtureRoot, "shared-second");
        const secondRun = runCatalog(["--report-dir", secondDir, "--previous", path.join(firstDir, REPORT_JSON)]);
        expect(secondRun.status, secondRun.stderr).toBe(0);
        const second = readReport(secondDir);
        expect(second.delta.changed).toEqual([unreferencedScript]);
        expect(second.delta.added).toEqual([addedFile]);
        expect(second.delta.removed).toEqual([declaredScript]);
        expect(second.metrics.shared_files_graph.files).toEqual([
            "_shared/references/shared.md", "_shared/references/skill-routing-policy.md",
            "_shared/scripts/standalone.sh", "_shared/templates/new.json",
        ]);
        expect(second.metrics.shared_files_graph.unreferenced_by_shared_files).toEqual([
            "_shared/references/skill-routing-policy.md", "_shared/scripts/standalone.sh", "_shared/templates/new.json",
        ]);
    });

    it("reports a missing shared directory as not covered", () => {
        fs.rmSync(path.join(fixtureRoot, ".agents/skills/_shared"), {recursive: true});
        const reportDir = path.join(fixtureRoot, "reports");
        const result = runCatalog(["--report-dir", reportDir]);
        expect(result.status, result.stderr).toBe(0);
        const report = readReport(reportDir);
        expect(report.metrics.shared_files_graph.files).toEqual([]);
        expect(report.metrics.shared_files_graph.unreferenced_by_shared_files).toEqual([]);
        expect(report.coverage.areas.find((area) => area.id === "shared-files-graph")).toMatchObject({
            status: "not_covered",
            detail: expect.stringContaining("_shared"),
        });
        expect(report.coverage.status).toBe("partial");
    });

    it("returns byte-identical JSON for repeated catalog runs", () => {
        const firstDir = path.join(fixtureRoot, "first");
        const secondDir = path.join(fixtureRoot, "second");
        expect(runCatalog(["--report-dir", firstDir]).status).toBe(0);
        expect(runCatalog(["--report-dir", secondDir]).status).toBe(0);

        expect(fs.readFileSync(path.join(firstDir, REPORT_JSON), "utf8"))
            .toBe(fs.readFileSync(path.join(secondDir, REPORT_JSON), "utf8"));
    });

    it("computes a hash delta from a previous report", () => {
        const firstDir = path.join(fixtureRoot, "delta-first");
        expect(runCatalog(["--report-dir", firstDir]).status).toBe(0);

        fs.appendFileSync(path.join(fixtureRoot, ALPHA), "\nNowa linia po pierwszym przebiegu.\n");

        const secondDir = path.join(fixtureRoot, "delta-second");
        const result = runCatalog(["--report-dir", secondDir, "--previous", path.join(firstDir, REPORT_JSON)]);
        expect(result.status, result.stderr).toBe(0);

        const delta = readReport(secondDir).delta;
        expect(delta.changed).toEqual([ALPHA]);
        expect(delta.added).toEqual([]);
        expect(delta.removed).toEqual([]);
        expect(delta.unchanged).toBeGreaterThan(0);
    });

    it("records the full run mode and completes the review section from a review file", () => {
        const pendingDir = path.join(fixtureRoot, "full-pending");
        expect(runCatalog(["--run-mode", "full", "--report-dir", pendingDir]).status).toBe(0);
        const pending = readReport(pendingDir);
        expect(pending.run_mode).toBe("full");
        expect(pending.review).toEqual({status: "pending", findings: [], standard_gaps: [], verdict: null});

        const reviewPath = path.join(fixtureRoot, "review.json");
        fs.writeFileSync(reviewPath, JSON.stringify({
            verdict: "PASS",
            findings: ["F1 [MINOR] Example finding — docs/SKILLS.md:1"],
            standard_gaps: [],
        }));
        const completedDir = path.join(fixtureRoot, "full-completed");
        const result = runCatalog(["--run-mode", "full", "--review-file", reviewPath, "--report-dir", completedDir]);
        expect(result.status, result.stderr).toBe(0);

        const completed = readReport(completedDir);
        expect(completed.run_mode).toBe("full");
        expect(completed.review.status).toBe("completed");
        expect(completed.review.verdict).toBe("PASS");
        expect(completed.review.findings).toHaveLength(1);
        expect(fs.readFileSync(path.join(completedDir, REPORT_MD), "utf8")).toContain("Verdict: PASS");
    });

    it("rejects invalid catalog invocations", () => {
        const withFile = runCatalog(["--file", ALPHA]);
        expect(withFile.status).toBe(2);
        expect(withFile.stdout).toBe("");
        expect(withFile.stderr).toContain("--file is not supported with catalog mode");

        const unknownRunMode = runCatalog(["--run-mode", "partial"]);
        expect(unknownRunMode.status).toBe(2);
        expect(unknownRunMode.stderr).toContain("Unknown run mode");

        const reviewWithoutFull = runCatalog(["--review-file", "review.json"]);
        expect(reviewWithoutFull.status).toBe(2);
        expect(reviewWithoutFull.stderr).toContain("--review-file requires --run-mode full");
    });
});

function runCatalog(extraArgs) {
    return spawnSync(process.execPath, [
        SCRIPT,
        "--mode",
        "catalog",
        "--root",
        fixtureRoot,
        ...extraArgs,
    ], {
        cwd: ROOT,
        encoding: "utf8",
    });
}

function readReport(reportDir) {
    return JSON.parse(fs.readFileSync(path.join(reportDir, REPORT_JSON), "utf8"));
}

function writeFixture(root) {
    write(root, ALPHA, ALPHA_SOURCE);
    write(root, BETA, BETA_SOURCE);
    write(root, ".agents/skills/_shared/references/skill-routing-policy.md", ROUTING_SOURCE);
    write(root, AGENT_ONE, AGENT_ONE_SOURCE);
    write(root, AGENT_TWO, AGENT_TWO_SOURCE);
    write(root, "opencode.jsonc", CONFIG_SOURCE);
    write(root, "docs/SKILLS.md", INDEX_SOURCE);
    write(root, "docs/README.md", "# Docs\n");
    write(root, "AGENTS.md", AGENTS_SOURCE);
    write(root, "README.md", README_SOURCE);
    write(root, "tests/example.test.mjs", TEST_SOURCE);
}

function write(root, relativePath, content) {
    const absolutePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), {recursive: true});
    fs.writeFileSync(absolutePath, content);
}

function lineOf(source, needle) {
    return source.split("\n").findIndex((line) => line.includes(needle)) + 1;
}
