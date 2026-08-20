import {REQUIRED_REVIEW_CHECKS} from "../../../.agents/skills/task-plan/scripts/state.mjs";

export function createCompletedCriticalReview(overrides = {}) {
    const {checks = REQUIRED_REVIEW_CHECKS, ...rest} = overrides;
    return {
        iteration: 1,
        plan_version: 1,
        stage: "critical-review",
        complete: true,
        ...rest,
        checks: [...checks],
    };
}

export function createValidPlanState(overrides = {}) {
    const planVersion = overrides.plan_version ?? 1;
    const packages = overrides.packages ?? [
        {
            id: "WP1",
            goal: "Core",
            scope: "Core scope",
            dependencies: [],
            acceptance_criteria: ["C1"],
            risks: [],
            questions: [],
            decision_status: "pending",
        },
        {
            id: "WP2",
            goal: "Dependent",
            scope: "Dependent scope",
            dependencies: ["WP1"],
            acceptance_criteria: ["C2"],
            risks: [],
            questions: [],
            decision_status: "pending",
        },
    ];

    return {
        source_kind: "github-issue",
        plan_status: "awaiting-package-decisions",
        plan_version: planVersion,
        packages,
        findings: [],
        review_history: [createCompletedCriticalReview({plan_version: planVersion})],
        simplification: {result: "no-change"},
        blockers: [],
        scope_questions: [],
        decisions: [],
        user_decisions: [],
        session_strategy: {
            mode: "staged",
            rationale: "WP1 precedes dependent work.",
            stages: [{
                id: "S1",
                title: "Core",
                rationale: "Stabilize the core contract first.",
                work_package_ids: ["WP1"],
                dependencies: [],
                session_boundary: "same-session",
                entry_criteria: ["Scope confirmed."],
                exit_criteria: ["Core contract documented."],
            }],
            session_boundary_recommendation: "Review dependent work in a new session.",
            dependencies: ["WP2 depends_on WP1"],
            entry_criteria: ["Intent confirmed."],
            exit_criteria: ["Every stage has a terminal result."],
        },
        ownership_redundancy_review: {
            required: false,
            requirement_basis: "not-applicable",
            requirement_decision_ref: "",
            status: "not-required",
            subjects: [],
        },
        ...overrides,
    };
}
