import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

import {buildDraftMetadata} from "../../../.agents/skills/task-plan/scripts/draft.mjs";
import {
    applyPlanTransition,
    canApprovePlan,
    canOpenPackageDecisions,
    createInitialState,
    parseDecisionCommand,
    validateTaskPlanState,
    REQUIRED_REVIEW_CHECKS,
    WORKFLOW_OUTCOMES,
} from "../../../.agents/skills/task-plan/scripts/state.mjs";
import {normalizeGitHubIssue} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {validateFinalApproval} from "../../../.agents/skills/task-plan/scripts/validate-plan.mjs";
import {createCompletedCriticalReview} from "./task-plan-test-helpers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const SKILL_PATH = path.join(ROOT, ".agents/skills/task-plan/SKILL.md");
const GH_ISSUE_START_SKILL_PATH = path.join(ROOT, ".agents/skills/gh-issue-start/SKILL.md");
const STATE_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/state.mjs");
const VALIDATE_PLAN_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/validate-plan.mjs");
const FIXTURE_ROOT = path.join(ROOT, "tests/fixtures/task-plan");
const SKILL_SOURCE = fs.readFileSync(SKILL_PATH, "utf8");
const GH_ISSUE_START_SKILL_SOURCE = fs.readFileSync(GH_ISSUE_START_SKILL_PATH, "utf8");

const WORKFLOW_SCENARIOS = readJson("workflow-scenarios.json").scenarios;
const OWNERSHIP_SCENARIOS = readJson("ownership-redundancy-scenarios.json").scenarios;
const STATUS_TRANSITIONS = readJson("status-transitions.json");
const DRAFT_OPERATIONS = readJson("draft-operations.json");
const MAIN_DRAFT = fs.readFileSync(path.join(FIXTURE_ROOT, "draft-main.md"), "utf8");
const DERIVED_DRAFT = fs.readFileSync(path.join(FIXTURE_ROOT, "draft-derived.md"), "utf8");
const TASK_PLAN_SCRIPTS = [
    "atomic-file.mjs",
    "draft.mjs",
    "state.mjs",
    "state-store.mjs",
    "source.mjs",
    "validate-plan.mjs",
];

const PLAN_STATUSES = new Set([
    "review-pending",
    "needs-clarification",
    "awaiting-package-decisions",
    "review-limit-reached",
    "approved",
]);

const DRAFT_SECTIONS = [
    "## Source",
    "## Session strategy",
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
            "ownership-review-not-required",
            "ownership-review-required",
            "response-to-approval",
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

    it("keeps the conditional ownership review explicit in workflow scenarios", () => {
        const notRequired = WORKFLOW_SCENARIOS.find(({id}) => id === "ownership-review-not-required");
        const required = WORKFLOW_SCENARIOS.find(({id}) => id === "ownership-review-required");

        expect(notRequired.expected.ownership_redundancy_review_required).toBe(false);
        expect(required.expected.ownership_redundancy_review_required).toBe(true);
        expect(notRequired.required_anchors).toEqual(expect.arrayContaining(["required: false", "status: not-required"]));
        expect(required.required_anchors).toEqual(expect.arrayContaining(["required: true", "ownership_redundancy_review_incomplete"]));
    });

    it("keeps the response-to-approval scenario deterministic and outside the issue boundary", () => {
        const scenario = WORKFLOW_SCENARIOS.find(({id}) => id === "response-to-approval");

        expect(scenario.input.source_kind).toBe("user-input");
        expect(scenario.input.answers).toHaveLength(2);
        expect(scenario.expected).toMatchObject({
            plan_status: "approved",
            workflow_phase: "decisions",
            plan_version: 2,
            implementation_started: false,
        });
        expect(scenario.input).not.toHaveProperty("issue_number");
        expect(SKILL_SOURCE).toContain("issue #421");
    });

    it("covers all bounded ownership kinds and preserves source-claim provenance", () => {
        const kinds = new Set();
        for (const scenario of OWNERSHIP_SCENARIOS) {
            const subject = scenario.review.subjects[0];
            kinds.add(subject.subject_kind);

            expect(typeof scenario.expected.review_valid).toBe("boolean");
            expect(subject.subject_kind).toBe(scenario.expected.subject_kind);
            if (scenario.expected.scope) {
                expect(subject.scope).toBe(scenario.expected.scope);
            }
            if (scenario.expected.redundancy_status) {
                expect(subject.redundancy_status).toBe(scenario.expected.redundancy_status);
            }
        }

        expect(kinds).toEqual(new Set(["field", "object", "algorithm", "workflow", "module", "endpoint"]));

        const notPromoted = OWNERSHIP_SCENARIOS.find(({id}) => id === "algorithm-source-example-not-promoted");
        const promoted = OWNERSHIP_SCENARIOS.find(({id}) => id === "workflow-source-example-promoted");
        expect(notPromoted.review.subjects[0]).toMatchObject({
            claim_classification: "source_example",
            promotion_decision_ref: "",
        });
        expect(notPromoted.expected.promoted_to_requirement).toBe(false);
        expect(promoted.review.subjects[0]).toMatchObject({
            claim_classification: "source_example",
            promotion_decision_ref: "D1",
        });
        expect(promoted.expected.promoted_to_requirement).toBe(true);
    });

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
        }, {profileHint: "title-only", sourceFetchStatus: "pending"});
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
            review_history: [createCompletedCriticalReview()],
            simplification: {result: "no-change"},
            blockers: [],
            findings: [],
            scope_questions: [],
            session_strategy: {
                mode: "staged",
                rationale: "WP1 is the core stage.",
                stages: [{
                    id: "S1",
                    title: "Core",
                    rationale: "Stabilize the core contract.",
                    work_package_ids: ["WP1"],
                    dependencies: [],
                    session_boundary: "same-session",
                    entry_criteria: ["Scope confirmed."],
                    exit_criteria: ["Contract documented."],
                }],
                session_boundary_recommendation: "Review later work separately.",
                dependencies: [],
                entry_criteria: ["Intent confirmed."],
                exit_criteria: ["Stage complete."],
            },
            ownership_redundancy_review: {
                required: false,
                requirement_basis: "not-applicable",
                requirement_decision_ref: "",
                status: "not-required",
                subjects: [],
            },
        };
        expect(canOpenPackageDecisions(approvedState)).toEqual({ready: true, reasons: []});
        expect(canApprovePlan(approvedState).approved).toBe(true);
        expect(validateFinalApproval(approvedState).valid).toBe(true);
        const reviewScenario = WORKFLOW_SCENARIOS.find(({id}) => id === "review-and-approval");
        expect(applyPlanTransition(approvedState, "approved", {
            reason: "fixture approval",
            changed_at: "2026-01-01T00:00:00Z",
        }).plan_status).toBe(reviewScenario.expected.plan_status);
    });

    it("keeps package decisions closed for an initial non-title draft", () => {
        const source = normalizeGitHubIssue({
            owner: "acme",
            repo: "demo",
            number: 458,
            title: "Handle async grid actions",
            body: "Prepare the implementation plan.",
            comments: [],
            branch: "issue/458-async-grid-actions",
            base: "origin/main",
        }, {profileHint: "specification", sourceFetchStatus: "pending"});

        expect(buildDraftMetadata(source, {now: "2026-01-01T00:00:00Z"}).plan_status).toBe("review-pending");
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
        const pathName = `docs/plan/issue-${DRAFT_OPERATIONS.main.issue}-plan.md`;

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
            plan_status: "review-pending",
            plan_version: "1",
        });
        expect(DRAFT_OPERATIONS.main.source_identity).toBe("acme/demo/123");
        expectDraftSections(MAIN_DRAFT);
        expect(MAIN_DRAFT).toContain(DRAFT_OPERATIONS.derived.parent_link);
    });

    it("builds the stable derived draft path and keeps the separate-work-package contract", () => {
        const pathName = `docs/plan/issue-${DRAFT_OPERATIONS.derived.issue}-wp-${DRAFT_OPERATIONS.derived.work_package_id.toLowerCase()}-plan.md`;
        const metadata = parseFrontMatter(DERIVED_DRAFT);

        expect(pathName).toBe(DRAFT_OPERATIONS.derived.expected_path);
        expect(metadata).toMatchObject({
            source_kind: "derived-work-package",
            source_ref: "https://github.com/acme/demo/issues/123",
            input_profile: "brief-request",
            parent_issue: "123",
            parent_draft: "issue-123-plan.md",
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
            const documentedAnchor = script === "atomic-file.mjs" ? "atomic-file" : `scripts/${script}`;
            expect(SKILL_SOURCE).toContain(documentedAnchor);
            expect(fs.existsSync(path.join(ROOT, relativePath))).toBe(true);
        }
    });

    it("keeps start.mjs free of source body/comment fetching and keeps the index entry", () => {
        const startSource = fs.readFileSync(path.join(ROOT, ".agents/skills/gh-issue-start/scripts/start.mjs"), "utf8");
        const startSkill = fs.readFileSync(path.join(ROOT, ".agents/skills/gh-issue-start/SKILL.md"), "utf8");
        const skillsIndex = fs.readFileSync(path.join(ROOT, "docs/SKILLS.md"), "utf8");

        expect(startSource).not.toContain("comments");
        expect(startSource).not.toContain("number,title,body,comments");
        expect(startSkill).toContain("Następne działanie po sukcesie");
        expect(startSkill).toContain("nie oznacza automatycznego uruchomienia `$task-plan`");
        expect(startSkill).toContain("sam tytuł lub opis issue nie jest wystarczającym dowodem intencji planowania");
        expect(skillsIndex).toContain("$task-plan");
    });

    it("documents that contract validation does not create a second workflow runtime", () => {
        const normalizedSkill = SKILL_SOURCE.replace(/\s+/g, " ");

        expect(normalizedSkill).toContain("nie implementują drugiego silnika workflow");
        expect(normalizedSkill).toContain("kontraktem Markdown, a nie runtime'em");
    });

    it("keeps ownership validation separate from workflow transitions", () => {
        const stateSource = fs.readFileSync(STATE_SCRIPT, "utf8");
        const validatePlanSource = fs.readFileSync(VALIDATE_PLAN_SCRIPT, "utf8");
        const ownershipValidatorStart = stateSource.indexOf("export function validateOwnershipRedundancyReview");
        const ownershipValidatorEnd = stateSource.indexOf("function validateOwnershipSubject", ownershipValidatorStart);
        const ownershipValidatorSource = stateSource.slice(ownershipValidatorStart, ownershipValidatorEnd);

        expect(validatePlanSource).toContain("validateOwnershipRedundancyReview");
        expect(validatePlanSource).not.toContain("applyPlanTransition");
        expect(validatePlanSource).not.toContain("applyPackageDecision");
        expect(ownershipValidatorSource).not.toContain("applyPlanTransition");
        expect(ownershipValidatorSource).not.toContain("applyPackageDecision");
    });

    it("uses explicit path placeholders in the skill body", () => {
        const body = SKILL_SOURCE.replace(/^---[\s\S]*?---\s*/, "");

        expect(body).toContain("<skill_dir>/scripts/draft.mjs");
        expect(body).toContain("<skills_root>/_shared/scripts/slugify-title.mjs");
        expect(body).not.toContain("node .agents/skills/task-plan/scripts");
        expect(body).not.toContain("| `scripts/draft.mjs`");
    });
});

describe("task-plan WP1 phase contract", () => {
    const normalizedSkill = SKILL_SOURCE.replace(/\s+/g, " ");
    const phaseDiagram = "intake → initial-draft → source/context → review → decisions → handoff";

    it("keeps one normative phase diagram and only explicit backward transitions", () => {
        expect(normalizedSkill.split(phaseDiagram).length - 1).toBe(1);
        expect(normalizedSkill).toContain("`review` może wrócić do `source/context`");
        expect(normalizedSkill).toContain("`decisions` może wrócić do `review`");
        expect(normalizedSkill).toContain("jawnego restartu planu z nową tożsamością");
    });

    it("documents the checkpoint shape and phase stop outcomes", () => {
        for (const field of [
            "phase",
            "completed_at",
            "next_phase",
            "next_allowed_action",
            "forbidden_actions[]",
            "reason",
            "state_revision",
        ]) {
            expect(SKILL_SOURCE).toContain(field);
        }

        expect(normalizedSkill).toContain("Etap: <bieżąca faza>");
        expect(normalizedSkill).toContain("Wykonano: <obserwowalne operacje i wynik>");
        expect(normalizedSkill).toContain("Następny dozwolony krok: <jedna dozwolona akcja albo restart>");
        expect(normalizedSkill).toContain("Niedozwolone jeszcze: <akcje zablokowane przez kontrakt>");
        expect(normalizedSkill).toContain("running | blocked | complete");
        expect(normalizedSkill).toContain("workflow_outcome: blocked");
    });

    it("enforces structural limits without a second budget runtime", () => {
        expect(SKILL_SOURCE).not.toContain("max_wall_clock_ms");
        expect(SKILL_SOURCE).not.toContain("max_steps");
        expect(normalizedSkill).toContain("najwyżej jeden canonical hybrid run");
        expect(normalizedSkill).toContain("najwyżej jeden fallback wyłącznie po `CLAIM_FALLBACK`");
        expect(normalizedSkill).toContain("najwyżej jedno automatyczne uproszczenie");
        expect(normalizedSkill).toContain("nie uruchamia automatycznie kolejnego scouta lub review");
        expect(normalizedSkill).toContain("Po tym wyniku nie wolno zadawać kolejnego pytania");
    });

    it("keeps WP5 blocking criteria separate from follow-up context", () => {
        const sectionStart = SKILL_SOURCE.indexOf("### Granica blocking i follow-up");
        const sectionEnd = SKILL_SOURCE.indexOf("### Adapter GitHub issue", sectionStart);
        const section = SKILL_SOURCE.slice(sectionStart, sectionEnd).replace(/\s+/g, " ");

        expect(section).toContain("`criteria.json` wyłącznie z `state.context_requirements.blocking`");
        expect(section).toContain("`state.context_requirements.follow_up` nie trafiają do canonical handoffu ani do `criteria.json`");
        expect(section).toContain("nie są bramką bieżącego raportu");
        expect(section).toContain("Nierozwiązane elementy są renderowane w checkpointach task-plan oraz w finalnym execution handoffie");
        expect(section).toContain("criteria_hash");
        expect(section).toContain("strategy_hash");
    });

    it("requires the initial draft before source/context work", () => {
        const draftStart = SKILL_SOURCE.indexOf("## Draft jako żywy artefakt");
        const contextStart = SKILL_SOURCE.indexOf("## Canonical repository-context");
        const draftContract = SKILL_SOURCE.slice(draftStart, contextStart);

        const firstWrite = draftContract.indexOf("w pierwszych operacjach zapisz minimalny, poprawny szkic Markdown");
        const sourceContextTransition = draftContract.indexOf("natychmiast przejdź do `source/context`");

        expect(draftStart).toBeGreaterThanOrEqual(0);
        expect(contextStart).toBeGreaterThan(draftStart);
        expect(firstWrite).toBeGreaterThanOrEqual(0);
        expect(sourceContextTransition).toBeGreaterThan(firstWrite);
        expect(draftContract).toContain("nie dopracowuj provisional WP");
    });

    it("uses one source/context gate based on blocking requirements", () => {
        expect(normalizedSkill).toContain("Decyzja o repository-context nie wynika z `source_kind`");
        expect(normalizedSkill).toContain("puste `blocking` oznacza brak scouta");
        expect(normalizedSkill).toContain("niepuste `blocking` wymaga dokładnie jednego canonical hybrid lifecycle");
        expect(normalizedSkill).toContain("`context_requirements.follow_up` pozostaje długiem dowodowym");
    });

    it("requires a preflight before emitting a decision question", () => {
        expect(normalizedSkill).toContain("preflightDecisionBatch(state, question_ids)");
        expect(normalizedSkill).toContain("Pytanie wolno wyemitować dopiero po `ready: true`");
        expect(normalizedSkill).toContain("checkpoint.state_revision == state.revision");
        expect(normalizedSkill).toContain("dostępność mutacji `propagate-decisions`");
        expect(normalizedSkill).toContain("`canOpenPackageDecisions()` i `canApprovePlan()`");
        expect(normalizedSkill).toContain("Przy `ready: false` caller zapisuje checkpoint z powodem");
        expect(normalizedSkill).toContain("Nie uruchamiaj automatycznego retry, review ani drugiego");
    });

    it("documents the explicit decision route and standalone start confirmation", () => {
        expect(normalizedSkill).toContain("Routing wyniku prowadzi do `review` albo `source/context`");
        expect(normalizedSkill).toContain("`decisions → review → source/context`");

        const normalizedStartSkill = GH_ISSUE_START_SKILL_SOURCE.replace(/\s+/g, " ");
        expect(normalizedStartSkill).toContain("Czy utworzyć plan wykonawczy?");
        expect(normalizedStartSkill).toContain("Utwórz plan wykonawczy");
        expect(normalizedStartSkill).toContain("Nie teraz");
        expect(normalizedStartSkill).toContain("`Nie teraz` kończy bieżący workflow bez planu i bez ponownego pytania");
        expect(normalizedStartSkill).toContain("`start.mjs` pozostaje adapterem stabilnej tożsamości i brancha");
    });
});

describe("task-plan WP4 intake and evidence contract", () => {
    const normalizedSkill = SKILL_SOURCE.replace(/\s+/g, " ");

    it("documents the canonical intake assessment without adapter heuristics", () => {
        for (const field of [
            "intake_assessment",
            "intent_authority",
            "diagnosis_reliability",
            "requirements_completeness",
            "technical_certainty",
            "task_type",
            "evidence_refs",
        ]) {
            expect(normalizedSkill).toContain(field);
        }
        expect(normalizedSkill).toContain("Adapter źródła normalizuje wyłącznie dane i pochodzenie");
        expect(normalizedSkill).toContain("nie dopowiada `task_type`");
        expect(normalizedSkill).toContain("`high` wymaga jawnych `evidence_refs`");
    });

    it("documents the three-way evidence separation and scope routing", () => {
        expect(normalizedSkill).toContain("confirmed_files");
        expect(normalizedSkill).toContain("candidate_paths");
        expect(normalizedSkill).toContain("discovery_required");
        expect(normalizedSkill).toContain("inventory/evidence-expansion");
        expect(normalizedSkill).toContain("known-scope-description");
        expect(normalizedSkill).toContain("nie trafia do kryteriów blocking");
        expect(normalizedSkill).toContain("`technical_certainty` pozostaje `unknown`");
    });
});

describe("task-plan canonical state contract", () => {
    it("requires direction and compatibility checks in the canonical critical review gate", () => {
        expect(REQUIRED_REVIEW_CHECKS).toEqual(expect.arrayContaining([
            "direction-and-simplicity",
            "backward-compatibility",
        ]));
    });

    it("keeps workflow outcome separate from the domain plan status", () => {
        const state = createInitialState({
            plan_id: "contract-state",
            draft_path: "docs/plan/contract-state.md",
            source_identity: "user:contract-state",
            source_kind: "user-input",
            input_profile: "brief-request",
            source_fetch_status: "not-required",
        }, {now: "2026-01-01T00:00:00Z"});
        state.workflow_outcome = "blocked";

        expect(WORKFLOW_OUTCOMES).toContain("blocked");
        expect(PLAN_STATUSES.has("blocked")).toBe(false);
        expect(validateTaskPlanState(state).valid).toBe(true);
    });

    it("documents the explicit runtime and approval validation modes", () => {
        expect(SKILL_SOURCE).toContain("validateRuntimeState");
        expect(SKILL_SOURCE).toContain("validateApprovalState");
        expect(SKILL_SOURCE).toContain("--mode runtime|approval");
        expect(SKILL_SOURCE).toContain("approval wymaga jawnego `--mode approval`");
    });

    it("keeps the four version concepts explicit in the contract", () => {
        const state = createInitialState({
            plan_id: "contract-versions",
            draft_path: "docs/plan/contract-versions.md",
            source_identity: "user:contract-versions",
            source_kind: "user-input",
            plan_version: 7,
            input_profile: "brief-request",
            source_fetch_status: "not-required",
        }, {now: "2026-01-01T00:00:00Z"});

        expect(state).toHaveProperty("schema_version");
        expect(state).toHaveProperty("revision");
        expect(state).toHaveProperty("plan_version");
        expect(state).toHaveProperty("checkpoint.state_revision");
        expect(state.schema_version).toBe(3);
        expect(state.revision).toBe(0);
        expect(state.plan_version).toBe(7);
        expect(state.checkpoint.state_revision).toBe(state.revision);
        expect(SKILL_SOURCE).toContain("plan_version");
        expect(SKILL_SOURCE).toContain("state_revision");
    });

    it("requires initial draft materialization to carry a checkpoint contract", () => {
        const normalizedSkill = SKILL_SOURCE.replace(/\s+/g, " ");

        expect(normalizedSkill).toContain("State store jest jedyną produkcyjną ścieżką tworzenia initial state i draftu");
        expect(normalizedSkill).toContain("create-initial");
        expect(normalizedSkill).toContain("checkpoint");
        expect(normalizedSkill).toContain("state_revision");
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
