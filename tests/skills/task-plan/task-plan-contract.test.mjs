import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

import {slugifyTitle} from "../../../.agents/skills/_shared/scripts/slugify-title.mjs";
import {buildDraftMetadata} from "../../../.agents/skills/task-plan/scripts/draft.mjs";
import {
    applyPlanTransition,
    canApprovePlan,
    parseDecisionCommand,
} from "../../../.agents/skills/task-plan/scripts/state.mjs";
import {normalizeGitHubIssue} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {validateFinalApproval} from "../../../.agents/skills/task-plan/scripts/validate-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SKILL_PATH = path.join(ROOT, ".agents/skills/task-plan/SKILL.md");
const FIXTURE_ROOT = path.join(ROOT, "tests/fixtures/task-plan");
const SKILL_SOURCE = fs.readFileSync(SKILL_PATH, "utf8");

const WORKFLOW_SCENARIOS = readJson("workflow-scenarios.json").scenarios;
const STATUS_TRANSITIONS = readJson("status-transitions.json");
const DRAFT_OPERATIONS = readJson("draft-operations.json");
const MAIN_DRAFT = fs.readFileSync(path.join(FIXTURE_ROOT, "draft-main.md"), "utf8");
const DERIVED_DRAFT = fs.readFileSync(path.join(FIXTURE_ROOT, "draft-derived.md"), "utf8");
const TASK_PLAN_SCRIPTS = [
    "draft.mjs",
    "state.mjs",
    "source.mjs",
    "validate-plan.mjs",
];

const PLAN_STATUSES = new Set([
    "needs-clarification",
    "awaiting-package-decisions",
    "review-limit-reached",
    "approved",
]);

const DRAFT_SECTIONS = [
    "## Source",
    "## Goal and scope",
    "## Work packages",
    "## Decisions and open questions",
    "## Evidence, risks and review",
    "## Acceptance and verification",
    "## Next action",
    "## Execution handoff (when implementation is requested)",
];

describe("task-plan workflow scenarios", () => {
    it("keeps one fixture for every block E workflow area", () => {
        expect(WORKFLOW_SCENARIOS.map(({id}) => id)).toEqual([
            "trigger-and-profiles",
            "untrusted-source-and-conflict",
            "work-packages-and-separation",
            "review-and-approval",
            "integration-and-handoff",
        ]);
    });

    for (const scenario of WORKFLOW_SCENARIOS) {
        it(`validates the documented invariants for ${scenario.id}`, () => {
            expect(scenario.required_anchors.length).toBeGreaterThan(0);
            expect(PLAN_STATUSES.has(scenario.expected.plan_status)).toBe(true);
            expect(scenario.expected.implementation_started).toBe(false);

            for (const anchor of scenario.required_anchors) {
                expect(SKILL_SOURCE, `${scenario.id}: missing ${anchor}`).toContain(anchor);
            }
        });
    }

    it("executes representative fixture expectations through deterministic APIs", () => {
        const trigger = WORKFLOW_SCENARIOS.find(({id}) => id === "trigger-and-profiles");
        const source = normalizeGitHubIssue({
            owner: "acme",
            repo: "demo",
            number: 123,
            title: trigger.input.title,
            body: trigger.input.body,
            comments: trigger.input.comments,
            branch: "issue/123-add-support",
            base: "origin/main",
        }, {fetchedAt: "2026-01-01T00:00:00Z"});
        const metadata = buildDraftMetadata(source, {now: "2026-01-01T00:00:00Z"});

        expect(source.input_profile).toBe(trigger.expected.profile);
        expect(metadata.plan_status).toBe(trigger.expected.plan_status);
        expect(source.base_ref).toBe("origin/main");

        const packageScenario = WORKFLOW_SCENARIOS.find(({id}) => id === "work-packages-and-separation");
        expect(parseDecisionCommand("accept-all-pending").decision_status).toBe("accepted");
        expect(packageScenario.expected.implementation_started).toBe(false);

        const approvedState = {
            plan_status: "awaiting-package-decisions",
            plan_version: 1,
            packages: [{
                id: "WP1",
                goal: "Core",
                scope: "Core scope",
                dependencies: [],
                acceptance_criteria: ["C1"],
                risks: [],
                questions: [],
                decision_status: "accepted",
            }],
            decisions: [{
                package_id: "WP1",
                decision: "accepted",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:00Z",
            }],
            findings: [],
            review_history: [{iteration: 1, plan_version: 1}],
            review_complete: true,
            simplification_status: "no-change",
            simplification: {result: "no-change"},
            blockers: [],
        };
        expect(canApprovePlan(approvedState).approved).toBe(true);
        expect(validateFinalApproval(approvedState).valid).toBe(true);
        const reviewScenario = WORKFLOW_SCENARIOS.find(({id}) => id === "review-and-approval");
        expect(applyPlanTransition(approvedState, "approved", {
            reason: "fixture approval",
            changed_at: "2026-01-01T00:00:00Z",
        }).plan_status).toBe(reviewScenario.expected.plan_status);
    });
});

describe("task-plan status transitions", () => {
    for (const [statusKind, table] of Object.entries(STATUS_TRANSITIONS)) {
        it(`accepts every declared ${statusKind} transition`, () => {
            for (const transition of table.allowed) {
                expect(canTransition(table, transition.from, transition.to)).toBe(true);
            }
        });

        it(`rejects every forbidden ${statusKind} transition`, () => {
            for (const transition of table.forbidden) {
                expect(canTransition(table, transition.from, transition.to)).toBe(false);
            }
        });

        it(`matches the documented ${statusKind} transition table`, () => {
            for (const anchor of table.contract_anchors) {
                expect(SKILL_SOURCE).toContain(anchor);
            }
        });
    }

    it("keeps only terminal package decisions in the terminal set", () => {
        expect(STATUS_TRANSITIONS.package.terminal).toEqual([
            "accepted",
            "excluded",
            "separated",
        ]);
        expect(STATUS_TRANSITIONS.package.terminal).not.toContain("pending");
        expect(STATUS_TRANSITIONS.package.terminal).not.toContain("revision-requested");
    });
});

describe("task-plan draft operations", () => {
    it("builds the stable main draft path from the issue number and title", () => {
        const pathName = `docs/draft/issue-${DRAFT_OPERATIONS.main.issue}-${slugifyTitle(DRAFT_OPERATIONS.main.title)}-plan.md`;

        expect(pathName).toBe(DRAFT_OPERATIONS.main.expected_path);
    });

    it("preserves required metadata and sections in the main draft fixture", () => {
        const metadata = parseFrontMatter(MAIN_DRAFT);

        expect(metadata).toMatchObject({
            source_kind: "github-issue",
            source_ref: "https://github.com/acme/demo/issues/123",
            issue: "123",
            title: "Original issue title",
            input_profile: "brief-request",
            plan_status: "awaiting-package-decisions",
            plan_version: "1",
            simplification_status: "pending",
        });
        expect(DRAFT_OPERATIONS.main.source_identity).toBe("acme/demo/123");
        expectDraftSections(MAIN_DRAFT);
        expect(MAIN_DRAFT).toContain(DRAFT_OPERATIONS.derived.parent_link);
    });

    it("builds the stable derived draft path and keeps the separate-work-package contract", () => {
        const pathName = `docs/draft/issue-${DRAFT_OPERATIONS.derived.issue}-wp-${DRAFT_OPERATIONS.derived.work_package_id.toLowerCase()}-${slugifyTitle(DRAFT_OPERATIONS.derived.package_title)}-plan.md`;
        const metadata = parseFrontMatter(DERIVED_DRAFT);

        expect(pathName).toBe(DRAFT_OPERATIONS.derived.expected_path);
        expect(metadata).toMatchObject({
            source_kind: "derived-work-package",
            source_ref: "https://github.com/acme/demo/issues/123",
            input_profile: "brief-request",
            parent_issue: "123",
            parent_draft: "issue-123-main-title-plan.md",
            work_package_id: "WP2",
            plan_status: DRAFT_OPERATIONS.derived.plan_status,
        });
        expectDraftSections(DERIVED_DRAFT);
    });

    it("keeps resume and write-failure behavior explicit", () => {
        expect(DRAFT_OPERATIONS.resume).toMatchObject({
            same_source_identity: true,
            expected_action: "update-existing-draft",
            preserve_review_history: true,
            preserve_independent_decisions: true,
        });
        expect(DRAFT_OPERATIONS.main.plan_version_after_resume).toBe(2);
        expect(DRAFT_OPERATIONS.derived.on_write_failure).toEqual({
            parent_preserved: true,
            package_status: "pending",
        });
        expect(SKILL_SOURCE).toContain("ostatni poprawny draft i jego status");
    });
});

describe("task-plan integration boundary", () => {
    it("keeps the documented deterministic script surface present", () => {
        for (const script of TASK_PLAN_SCRIPTS) {
            const relativePath = `.agents/skills/task-plan/scripts/${script}`;
            expect(SKILL_SOURCE).toContain(`scripts/${script}`);
            expect(fs.existsSync(path.join(ROOT, relativePath))).toBe(true);
        }
    });

    it("keeps start.mjs free of source body/comment fetching and keeps the index entry", () => {
        const startSource = fs.readFileSync(path.join(ROOT, ".agents/skills/gh-issue-start/scripts/start.mjs"), "utf8");
        const skillsIndex = fs.readFileSync(path.join(ROOT, "docs/SKILLS.md"), "utf8");

        expect(startSource).not.toContain("comments");
        expect(startSource).not.toContain("number,title,body,comments");
        expect(skillsIndex).toContain("$task-plan");
    });

    it("documents that contract validation does not create a second workflow runtime", () => {
        const normalizedSkill = SKILL_SOURCE.replace(/\s+/g, " ");

        expect(normalizedSkill).toContain("nie implementują drugiego silnika workflow");
        expect(normalizedSkill).toContain("kontraktem Markdown, a nie runtime'em");
    });

    it("uses explicit path placeholders in the skill body", () => {
        const body = SKILL_SOURCE.replace(/^---[\s\S]*?---\s*/, "");

        expect(body).toContain("<skill_dir>/scripts/draft.mjs");
        expect(body).toContain("<skills_root>/_shared/scripts/slugify-title.mjs");
        expect(body).not.toContain("node .agents/skills/task-plan/scripts");
        expect(body).not.toContain("| `scripts/draft.mjs`");
    });
});

function readJson(fileName) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, fileName), "utf8"));
}

function canTransition(table, from, to) {
    return table.allowed.some((transition) => transition.from === from && transition.to === to);
}

function parseFrontMatter(source) {
    const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
    if (!match) {
        throw new Error("Fixture is missing front matter.");
    }

    return Object.fromEntries(match[1].split("\n").map((line) => {
        const separator = line.indexOf(":");
        if (separator < 1) {
            throw new Error(`Invalid front matter line: ${line}`);
        }

        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }

        return [key, value];
    }));
}

function expectDraftSections(source) {
    for (const section of DRAFT_SECTIONS) {
        expect(source).toContain(section);
    }
}
