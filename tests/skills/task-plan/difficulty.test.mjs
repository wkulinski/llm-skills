import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {it} from "vitest";

import {
    DEFAULT_DIFFICULTY_POLICY,
    DIFFICULTY_POLICY_PATH,
    DifficultyError,
    assessDifficulty,
    loadDifficultyPolicy,
    parsePackageDifficulty,
} from "../../../.agents/skills/_shared/scripts/task-plan/difficulty.mjs";
import {normalizeUserInput, persistSource} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {savePlan, StoreError} from "../../../.agents/skills/task-plan/scripts/store.mjs";

const CLI_SCRIPT = fileURLToPath(new URL("../../../.agents/skills/_shared/scripts/task-plan/difficulty.mjs", import.meta.url));
const NOW = "2026-08-24T12:00:00.000Z";
const SOURCE_IDENTITY = "owner/repository#123";

const CANONICAL_DIFFICULTY = `- Difficulty: v1
  - Dependencies: 0 — Jeden właściciel zmiany.
  - Logic: 1 — Kilka rozstrzygniętych gałęzi.
  - Discovery: 2 — Śledzenie kilku znanych mechanizmów.
  - Verification: 1 — Test integracyjny kontraktu.
  - Risk floor: none
  - Level: moderate
  - Rationale: Suma 4 wynika z integracji znanych mechanizmów i gałęzi.`;

function rubricWithScores([dependencies, logic, discovery, verification], risk = "none") {
    return {
        dependencies: {score: dependencies, rationale: "Konkretne uzasadnienie zależności."},
        logic: {score: logic, rationale: "Konkretne uzasadnienie logiki."},
        discovery: {score: discovery, rationale: "Konkretne uzasadnienie rozpoznania."},
        verification: {score: verification, rationale: "Konkretne uzasadnienie weryfikacji."},
        risk,
    };
}

function isDifficultyError(code) {
    return (error) => error instanceof DifficultyError && error.code === code;
}

function isInvalidPlanWith(message) {
    return (error) => error instanceof StoreError
        && error.code === "INVALID_PLAN"
        && error.details.errors.some((entry) => entry.includes(message));
}

function temporaryRepository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-difficulty-"));
    fs.mkdirSync(path.join(root, "docs", "plans"), {recursive: true});
    const configDir = path.join(root, ".agents", "config");
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), `${JSON.stringify({
        version: 1,
        order: "strongest-to-weakest",
        profiles: [{model: "openai/gpt-5.6-sol", reasoning: "medium"}],
    }, null, 2)}\n`, "utf8");
    return root;
}

function writeDifficultyPolicy(root, contents) {
    const configPath = path.join(root, DIFFICULTY_POLICY_PATH);
    fs.mkdirSync(path.dirname(configPath), {recursive: true});
    fs.writeFileSync(configPath, typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`, "utf8");
}

function prepareSource(root) {
    const source = normalizeUserInput({
        identity: SOURCE_IDENTITY,
        title: "Example issue",
        body: "Implement point one.",
    }, {fetched_at: NOW});
    return persistSource(source, {repoRoot: root});
}

function saveBody(root, markdownBody) {
    return savePlan({
        repo_root: root,
        source_identity: SOURCE_IDENTITY,
        markdown_body: markdownBody,
        context: null,
    }, {now: NOW, verbose: true});
}

function planBody({difficulty = "", second = false, secondDifficulty = ""} = {}) {
    const wp2 = second
        ? `
### WP2 — Implement point two

- Source: Point 2
- Goal: Implement the second requested behavior.
- Scope: Update the second behavior.
- Out of scope: Unrelated cleanup.
- Confirmed paths: src/Example2.php
- Candidate paths: none
- Discovery required: none
- Estimated size: small
- Acceptance criteria: The second behavior is exposed.
- Verification: Run the second focused unit test.
${secondDifficulty}`
        : "";
    return `# Example implementation plan

## Execution

- [ ] WP1
${second ? "- [ ] WP2\n" : ""}
## Work package summaries

- WP1 — Implement point one: Adds the requested behavior without a parallel mechanism.
${second ? "- WP2 — Implement point two: Adds the second behavior without a parallel mechanism.\n" : ""}
## Source and objective

Implement point one.

## Source assessment

- Requested outcome: Point one works.
- Observed symptoms: The requested behavior is absent.
- Explicit constraints: Do not add a parallel mechanism.
- Suggested diagnosis or solution: The source suggests only the outcome.
- Claims verified in evidence: The current Example flow remains the owner.
- Claims corrected or still unverified: The implementation detail remains for discovery.

## Scope

The requested behavior is in scope. Unrelated refactors are out of scope.

## Direction, simplicity and consistency

- Existing mechanism reused: The current Example flow remains the owner.
- Simpler alternative considered: A local update was selected over a parallel service.
- Why the selected approach is minimal: Only the existing behavior changes.
- Duplicate or parallel responsibilities: None; WP1 keeps the current owner.
- Cross-WP consistency and ownership: WP1 is the only package.

## Source coverage

- Point 1: WP1
${second ? "- Point 2: WP2\n" : ""}
## Work packages

### WP1 — Implement point one

- Source: Point 1
- Goal: Implement the requested behavior.
- Scope: Update the existing behavior.
- Out of scope: Unrelated cleanup.
- Confirmed paths: src/Example.php
- Candidate paths: none
- Discovery required: none
- Estimated size: medium
- Acceptance criteria: The existing flow exposes the requested behavior.
- Verification: Run the focused unit test.
${difficulty}${wp2}
## Order

WP1 runs first.

## Decisions and open questions

No open questions.

## Risks and discovery debt

No known discovery debt.

## Acceptance and verification

Run the focused unit test.

## Execution environment

- Default model: openai/gpt-5.6-sol
- Default reasoning: medium
- WP overrides: none
`;
}

it("returns 4/moderate/40 for the canonical rubric and level minima at the sum edges", () => {
    const canonical = assessDifficulty({
        dependencies: {score: 0, rationale: "Jeden właściciel zmiany."},
        logic: {score: 1, rationale: "Kilka rozstrzygniętych gałęzi."},
        discovery: {score: 2, rationale: "Śledzenie kilku znanych mechanizmów."},
        verification: {score: 1, rationale: "Test integracyjny kontraktu."},
        risk: "none",
    });
    assert.deepEqual(canonical, {score: 4, level: "moderate", minimumPoints: 40});
    assert.deepEqual(assessDifficulty(rubricWithScores([0, 0, 0, 0])), {score: 0, level: "simple", minimumPoints: 30});
    assert.deepEqual(assessDifficulty(rubricWithScores([2, 0, 0, 0])), {score: 2, level: "simple", minimumPoints: 30});
    assert.deepEqual(assessDifficulty(rubricWithScores([2, 1, 0, 0])), {score: 3, level: "moderate", minimumPoints: 40});
    assert.deepEqual(assessDifficulty(rubricWithScores([2, 2, 2, 0])), {score: 6, level: "hard", minimumPoints: 50});
    assert.deepEqual(assessDifficulty(rubricWithScores([2, 2, 1, 0])), {score: 5, level: "hard", minimumPoints: 50});
    assert.deepEqual(assessDifficulty(rubricWithScores([2, 2, 2, 1])), {score: 7, level: "very-hard", minimumPoints: 60});
    assert.deepEqual(assessDifficulty(rubricWithScores([2, 2, 2, 2])), {score: 8, level: "very-hard", minimumPoints: 60});
});

it("raises the computed level by the risk floor and never lowers it", () => {
    assert.deepEqual(
        assessDifficulty(rubricWithScores([1, 0, 0, 0], "authorization")),
        {score: 1, level: "hard", minimumPoints: 50},
    );
    assert.deepEqual(
        assessDifficulty(rubricWithScores([1, 0, 0, 0], "irreversible-migration")),
        {score: 1, level: "hard", minimumPoints: 50},
    );
    assert.deepEqual(
        assessDifficulty(rubricWithScores([1, 0, 0, 0], "concurrent-financial")),
        {score: 1, level: "very-hard", minimumPoints: 60},
    );
    assert.deepEqual(
        assessDifficulty(rubricWithScores([2, 2, 2, 2], "authorization")),
        {score: 8, level: "very-hard", minimumPoints: 60},
    );
    assert.deepEqual(
        assessDifficulty(rubricWithScores([0, 0, 0, 2], "concurrent-financial")),
        {score: 2, level: "very-hard", minimumPoints: 60},
    );
});

it("rejects invalid rubric values and placeholder rationales", () => {
    const invalidRubrics = [
        [rubricWithScores([3, 0, 0, 0]), "INVALID_DIFFICULTY_SCORE"],
        [rubricWithScores([-1, 0, 0, 0]), "INVALID_DIFFICULTY_SCORE"],
        [rubricWithScores([0.5, 0, 0, 0]), "INVALID_DIFFICULTY_SCORE"],
        [rubricWithScores([0, 0, 0, 0], "critical"), "INVALID_DIFFICULTY_RISK"],
        [rubricWithScores([0, 0, 0, 0], ""), "INVALID_DIFFICULTY_RISK"],
    ];
    const missingDimension = rubricWithScores([0, 0, 0, 0]);
    delete missingDimension.logic;
    invalidRubrics.push([missingDimension, "INVALID_DIFFICULTY_RUBRIC"]);
    for (const [rubric, code] of invalidRubrics) {
        assert.throws(() => assessDifficulty(rubric), isDifficultyError(code));
    }
    for (const rationale of ["", "none", "n/a", "unknown", "Unknown."]) {
        const rubric = rubricWithScores([1, 0, 0, 0]);
        rubric.dependencies.rationale = rationale;
        assert.throws(() => assessDifficulty(rubric), isDifficultyError("INVALID_DIFFICULTY_RATIONALE"), rationale);
    }
});

it("validates a custom or invalid policy passed to assessDifficulty", () => {
    const custom = {version: 1, thresholds: {simple: 10.5, moderate: 10.5, hard: 25, "very-hard": 70}};
    assert.equal(assessDifficulty(rubricWithScores([0, 1, 2, 1]), custom).minimumPoints, 10.5);
    assert.equal(assessDifficulty(rubricWithScores([2, 2, 2, 2]), custom).minimumPoints, 70);

    const invalidPolicies = [
        null,
        {version: 2, thresholds: {simple: 30, moderate: 40, hard: 50, "very-hard": 60}},
        {version: 1, thresholds: {simple: 30, moderate: 40, hard: 50}},
        {version: 1, thresholds: {simple: 30, moderate: 40, hard: 50, "very-hard": 60, extra: 70}},
        {version: 1, thresholds: {simple: 40, moderate: 30, hard: 50, "very-hard": 60}},
        {version: 1, thresholds: {simple: "30", moderate: 40, hard: 50, "very-hard": 60}},
        {version: 1, thresholds: {simple: Number.NaN, moderate: 40, hard: 50, "very-hard": 60}},
        {version: 1, thresholds: {simple: 30, moderate: 40, hard: 50, "very-hard": Number.POSITIVE_INFINITY}},
        {version: 1, thresholds: {simple: -1, moderate: 40, hard: 50, "very-hard": 60}},
        {version: 1, thresholds: {simple: 30, moderate: 40, hard: 50, "very-hard": 71}},
    ];
    for (const policy of invalidPolicies) {
        assert.throws(() => assessDifficulty(rubricWithScores([0, 0, 0, 0]), policy), isDifficultyError("INVALID_DIFFICULTY_POLICY"));
    }
});

it("loads the project policy and fails closed on malformed files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-difficulty-policy-"));
    assert.deepEqual(loadDifficultyPolicy({repoRoot: root, fsOps: fs}), {
        version: 1,
        thresholds: {simple: 30, moderate: 40, hard: 50, "very-hard": 60},
    });
    assert.deepEqual(DEFAULT_DIFFICULTY_POLICY.thresholds, {simple: 30, moderate: 40, hard: 50, "very-hard": 60});

    const custom = {version: 1, thresholds: {simple: 12, moderate: 24, hard: 36, "very-hard": 48}};
    writeDifficultyPolicy(root, custom);
    assert.deepEqual(loadDifficultyPolicy({repoRoot: root, fsOps: fs}), custom);

    writeDifficultyPolicy(root, "{not json");
    assert.throws(() => loadDifficultyPolicy({repoRoot: root, fsOps: fs}), isDifficultyError("INVALID_DIFFICULTY_POLICY"));

    writeDifficultyPolicy(root, {version: 1, thresholds: {simple: 30, moderate: 40, hard: 50}});
    assert.throws(() => loadDifficultyPolicy({repoRoot: root, fsOps: fs}), isDifficultyError("INVALID_DIFFICULTY_POLICY"));
});

it("prints the policy threshold for a work package body through the assess CLI", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-difficulty-cli-"));
    try {
        writeDifficultyPolicy(root, {version: 1, thresholds: {simple: 12, moderate: 24, hard: 36, "very-hard": 48}});
        const assess = (input) => spawnSync(process.execPath, [CLI_SCRIPT, "assess", "--body", "-", "--root", root], {
            input,
            encoding: "utf8",
            timeout: 10000,
        });

        const assessed = assess(`### WP1 — Example\n\n- Verification: Run the focused unit test.\n${CANONICAL_DIFFICULTY}\n`);
        assert.equal(assessed.status, 0, assessed.stderr);
        assert.deepEqual(JSON.parse(assessed.stdout), {score: 4, level: "moderate", minimumPoints: 24});

        const missing = assess("### WP1 — Example\n\n- Verification: Run the focused unit test.\n");
        assert.equal(missing.status, 1);
        assert.equal(missing.stdout, "");
        assert.equal(JSON.parse(missing.stderr).error, "DIFFICULTY_MISSING");

        const mismatched = assess(`### WP1 — Example\n\n${CANONICAL_DIFFICULTY.replace("Level: moderate", "Level: simple")}\n`);
        assert.equal(mismatched.status, 1);
        assert.equal(JSON.parse(mismatched.stderr).error, "INVALID_DIFFICULTY");
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

it("parses the canonical block and ignores absent or fenced markers", () => {
    const parsed = parsePackageDifficulty(`### WP1 — Example\n\n- Source: Point 1\n- Verification: Run the focused unit test.\n${CANONICAL_DIFFICULTY}\n`);
    assert.deepEqual(parsed, {
        present: true,
        errors: [],
        assessment: {score: 4, level: "moderate", minimumPoints: 40},
    });

    const legacy = parsePackageDifficulty("### WP1 — Example\n\n- Source: Point 1\n- Verification: Run the focused unit test.\n");
    assert.deepEqual(legacy, {present: false, errors: [], assessment: null});

    const fenced = parsePackageDifficulty(`### WP1 — Example\n\n\`\`\`md\n${CANONICAL_DIFFICULTY}\n\`\`\`\n`);
    assert.deepEqual(fenced, {present: false, errors: [], assessment: null});

    const indented = parsePackageDifficulty(`### WP1 — Example\n\n  - Difficulty: v1\n  - Dependencies: 0 — Nie jest to top-level marker.\n`);
    assert.deepEqual(indented, {present: false, errors: [], assessment: null});
});

it("reports malformed difficulty markers, fields and levels", () => {
    const cases = [
        [CANONICAL_DIFFICULTY.replace("Difficulty: v1", "Difficulty: v2"), /version must be v1/],
        [CANONICAL_DIFFICULTY.replace("Difficulty: v1", "Difficulty:"), /version must be v1/],
        [`${CANONICAL_DIFFICULTY}\n${CANONICAL_DIFFICULTY}`, /duplicate markers/],
        [`${CANONICAL_DIFFICULTY}\n  - Logic: 0 — Duplicate.`, /duplicate Logic/],
        [CANONICAL_DIFFICULTY.replace("Dependencies: 0", "Dependencies: 3"), /score must be an integer from 0 to 2/],
        [CANONICAL_DIFFICULTY.replace("  - Logic: 1 —", "  - Logic: 1"), /must use "<score> — <rationale>"/],
        [CANONICAL_DIFFICULTY.replace("  - Discovery: 2 — Śledzenie kilku znanych mechanizmów.\n", ""), /missing required field: Discovery/],
        [CANONICAL_DIFFICULTY.replace("  - Risk floor: none\n", ""), /missing required field: Risk floor/],
        [CANONICAL_DIFFICULTY.replace("Risk floor: none", "Risk floor: critical"), /Risk floor must be one of/],
        [CANONICAL_DIFFICULTY.replace(/Rationale: .*/, "Rationale: none"), /concrete Rationale/],
        [CANONICAL_DIFFICULTY.replace("Level: moderate", "Level: hard"), /Level must match the computed level: moderate/],
    ];
    for (const [body, expected] of cases) {
        const parsed = parsePackageDifficulty(body);
        assert.equal(parsed.present, true);
        assert.equal(parsed.assessment, null);
        assert.equal(
            parsed.errors.some((message) => expected.test(message)),
            true,
            `${expected} not found in: ${parsed.errors.join("; ")}`,
        );
    }
});

it("accepts a new-format plan with a consistent difficulty assessment", () => {
    const body = planBody({difficulty: CANONICAL_DIFFICULTY});
    const folded = body.split(/(?=^## )/m).map((section) => {
        const heading = section.match(/^## (.+)\n/);
        if (!heading || heading[1] === "Work package summaries") {
            return section;
        }
        return `${heading[0]}\n<details>\n<summary>${heading[1]}</summary>\n\n${section.slice(heading[0].length).trim()}\n\n</details>\n\n`;
    }).join("");
    for (const markdown of [body, folded]) {
        const root = temporaryRepository();
        prepareSource(root);
        const saved = saveBody(root, markdown);
        assert.equal(saved.validation.valid, true, saved.validation.errors.join("\n"));
        assert.match(saved.markdown, /- Difficulty: v1/);
    }
});

it("rejects inconsistent or incomplete new-format difficulty blocks", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const cases = [
        CANONICAL_DIFFICULTY.replace("Dependencies: 0", "Dependencies: 3"),
        CANONICAL_DIFFICULTY.replace("  - Verification: 1 — Test integracyjny kontraktu.\n", ""),
        CANONICAL_DIFFICULTY.replace(/  - Rationale: .*/, ""),
        CANONICAL_DIFFICULTY.replace("Level: moderate", "Level: hard"),
        CANONICAL_DIFFICULTY.replace("Risk floor: none", "Risk floor: critical"),
        CANONICAL_DIFFICULTY.replace("  - Logic: 1 —", "  - Logic: 1 — none\n  - Logic: 1 —"),
        CANONICAL_DIFFICULTY.replace("Difficulty: v1", "Difficulty: v2"),
    ];
    for (const difficulty of cases) {
        assert.throws(() => saveBody(root, planBody({difficulty})), isInvalidPlanWith("Difficulty"), difficulty);
    }
});

it("requires a complete block in every WP once any WP declares difficulty", () => {
    const root = temporaryRepository();
    prepareSource(root);
    assert.throws(
        () => saveBody(root, planBody({difficulty: CANONICAL_DIFFICULTY, second: true})),
        isInvalidPlanWith("WP2 must contain a complete Difficulty: v1 block."),
    );

    const saved = saveBody(root, planBody({
        difficulty: CANONICAL_DIFFICULTY,
        second: true,
        secondDifficulty: CANONICAL_DIFFICULTY,
    }));
    assert.equal(saved.validation.valid, true, saved.validation.errors.join("\n"));
});

it("keeps the difficulty Verification score separate from the WP verification requirement", () => {
    const root = temporaryRepository();
    prepareSource(root);
    const body = planBody({difficulty: CANONICAL_DIFFICULTY});
    assert.throws(
        () => saveBody(root, body.replace("- Verification: Run the focused unit test.\n", "")),
        isInvalidPlanWith("missing non-empty field: Verification"),
    );
    assert.throws(
        () => saveBody(root, body.replace("- Verification: Run the focused unit test.", "- Verification: none")),
        isInvalidPlanWith("essential field Verification cannot be none"),
    );
    const reordered = body.replace(CANONICAL_DIFFICULTY, "").replace(
        "- Verification: Run the focused unit test.",
        `${CANONICAL_DIFFICULTY}\n- Verification: none`,
    );
    assert.throws(() => saveBody(root, reordered), isInvalidPlanWith("essential field Verification cannot be none"));
});

it("keeps legacy plans valid and fails closed for new-format plans with a malformed policy", () => {
    const legacyRoot = temporaryRepository();
    prepareSource(legacyRoot);
    writeDifficultyPolicy(legacyRoot, "{not json");
    const legacy = saveBody(legacyRoot, planBody());
    assert.equal(legacy.validation.valid, true, legacy.validation.errors.join("\n"));
    assert.equal(legacy.validation.errors.some((message) => message.includes("Difficulty")), false);

    const newRoot = temporaryRepository();
    prepareSource(newRoot);
    writeDifficultyPolicy(newRoot, "{not json");
    assert.throws(
        () => saveBody(newRoot, planBody({difficulty: CANONICAL_DIFFICULTY})),
        isInvalidPlanWith("Difficulty policy"),
    );
});
