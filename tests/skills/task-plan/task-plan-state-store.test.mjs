import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

import {
    ARTIFACT_SET_INCOMPLETE,
    buildPlanId,
    MUTATION_TYPES,
    PROJECTION_STALE,
    PROJECTED,
    ensureState,
    loadState,
    retryProjection,
    updateState,
} from "../../../.agents/skills/task-plan/scripts/state-store.mjs";
import {parseDraftDocument} from "../../../.agents/skills/task-plan/scripts/draft.mjs";
import {canOpenPackageDecisions, canTransition} from "../../../.agents/skills/task-plan/scripts/state.mjs";
import {validatePlanDocument} from "../../../.agents/skills/task-plan/scripts/validate-plan.mjs";
import {
    abortHybrid,
    claimAttempt,
    evaluateAttempt,
    finalizeHybrid,
    prepareHybrid,
} from "../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs";
import {enrichContextManifest} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const STATE_STORE_SCRIPT = path.join(ROOT, ".agents/skills/task-plan/scripts/state-store.mjs");
const FIXTURE_ROOT = path.join(ROOT, "tests/fixtures/task-plan");
const STATE_ABSENT = readFixture("state-absent.json");
const STATE_INITIAL = readFixture("state-initial.json");
const STATE_RESTART = readFixture("state-restart.json");
const STATE_PROJECTION_RETRY = readFixture("state-projection-retry.json");
const STATE_REVISION = readFixture("state-revision.json");
const CONTEXT_REQUIREMENTS = readFixture("context-requirements.json");
const temporaryDirectories = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, {recursive: true, force: true});
    }
});

describe("task-plan canonical state store", () => {
    it("returns virtual-initial without creating state and builds complete memory state", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory, STATE_ABSENT.plan);

        const loaded = loadState(plan, {clock: fixedClock()});
        const state = ensureState(plan, {clock: fixedClock()});

        expect(loaded).toMatchObject({
            status: STATE_ABSENT.expected.status,
            revision: STATE_ABSENT.expected.revision,
        });
        expect(fs.existsSync(loaded.paths.state_path)).toBe(STATE_ABSENT.expected.state_file);
        expect(fs.existsSync(loaded.paths.draft_path)).toBe(STATE_ABSENT.expected.draft_file);
        expect(state).toMatchObject({
            schema_version: 2,
            workflow_phase: "intake",
            workflow_outcome: "running",
            source_fetch_status: "pending",
            context_requirements: {blocking: [], follow_up: []},
        });
        expect(state).toEqual(expect.objectContaining({
            packages: [],
            findings: [],
            review_history: [],
            decisions: [],
            user_decisions: [],
            scope_questions: [],
            session_strategy: expect.any(Object),
            ownership_redundancy_review: expect.any(Object),
        }));
        for (const removedField of [
            "active_segment_started_at",
            "elapsed_active_ms",
            "max_steps",
            "steps_used",
            "max_wall_clock_ms",
            "budget_status",
            "applied_mutations",
        ]) {
            expect(state).not.toHaveProperty(removedField);
        }
        expect(MUTATION_TYPES).not.toContain("budget-update");
        expect(MUTATION_TYPES).toContain("plan-revision");
        expect(MUTATION_TYPES).not.toContain("question-propagate");
        const stableId = buildPlanId(plan);
        expect(buildPlanId({...plan, plan_id: stableId})).toBe(stableId);
        expect(stableId).not.toContain("/");
        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: {reason: "cannot skip initial materialization"},
        }, {clock: fixedClock()})).toThrowError(expect.objectContaining({code: "INITIAL_MUTATION_REQUIRED"}));
    });

    it("materializes complete initial state, checkpoint and draft through the first mutation", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory, STATE_INITIAL.plan);

        const result = updateState(plan, STATE_INITIAL.mutation, {clock: fixedClock()});

        expect(result).toMatchObject({ok: true, code: "APPLIED", projection_status: PROJECTED});
        expect(result.state).toMatchObject({
            revision: STATE_INITIAL.expected.revision,
            workflow_phase: STATE_INITIAL.expected.workflow_phase,
            source_fetch_status: STATE_INITIAL.expected.source_fetch_status,
            checkpoint: expect.objectContaining({
                phase: "initial-draft",
                state_revision: STATE_INITIAL.expected.state_revision,
            }),
        });
        expect(fs.existsSync(result.paths.state_path)).toBe(true);
        expect(fs.existsSync(result.paths.draft_path)).toBe(true);
        const draft = fs.readFileSync(result.paths.draft_path, "utf8");
        expect(draft).toContain("state_revision: \"1\"");
        expect(draft).toContain("<!-- task-plan:generated:start -->");
        expect(draft).toContain("<!-- task-plan:generated:end -->");
        expect(validatePlanDocument(draft, {
            kind: "main",
            state: JSON.parse(fs.readFileSync(result.paths.state_path, "utf8")),
        }).valid).toBe(true);
        expect(loadState(plan, {clock: fixedClock()}).status).toBe("persisted");
        expect(result.state.plan_version).toBe(STATE_INITIAL.plan.plan_version);
    });

    it("reprojects generated state while preserving narrative content", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});
        const narrative = "\n## Maintainer note\nThis narrative must survive projection retry.\n";
        fs.appendFileSync(initial.paths.draft_path, narrative, "utf8");

        const updated = updateState(plan, {
            type: "checkpoint",
            payload: {reason: "refresh generated state"},
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        const projected = fs.readFileSync(updated.paths.draft_path, "utf8");

        expect(projected).toContain("This narrative must survive projection retry.");
        expect(projected.match(/<!-- task-plan:generated:start -->/g)).toHaveLength(1);
        expect(projected.match(/<!-- task-plan:generated:end -->/g)).toHaveLength(1);
        expect(projected.match(/<!-- task-plan:session-strategy:start -->/g)).toHaveLength(1);
        expect(projected.match(/<!-- task-plan:session-strategy:end -->/g)).toHaveLength(1);
        expect(projected).toContain("state_revision: \"2\"");
        expect(parseDraftDocument(projected).body).toContain("refresh generated state");
    });

    it("blocks an incomplete generated projection instead of overwriting the draft", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});
        const before = fs.readFileSync(initial.paths.draft_path, "utf8");
        fs.writeFileSync(initial.paths.draft_path, before.replace("<!-- task-plan:generated:end -->", ""), "utf8");

        const stale = updateState(plan, {
            type: "checkpoint",
            payload: {reason: "must block"},
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});

        expect(stale).toMatchObject({ok: false, code: PROJECTION_STALE, workflow_outcome: "blocked"});
        expect(fs.readFileSync(stale.paths.draft_path, "utf8")).toBe(before.replace("<!-- task-plan:generated:end -->", ""));
        expect(loadState(plan, {clock: fixedClock()}).workflow_outcome).toBe("blocked");

        fs.writeFileSync(stale.paths.draft_path, before, "utf8");
        const retry = retryProjection(plan, {
            expected_revision: stale.state.revision,
            clock: fixedClock("2026-01-01T00:00:02Z"),
        });
        expect(retry).toMatchObject({ok: true, code: "RETRIED", projection_status: PROJECTED});
        expect(retry.state.workflow_outcome).toBe("running");
        expect(retry.state.revision).toBe(stale.state.revision);
        expect(fs.readFileSync(retry.paths.draft_path, "utf8")).toContain("state_revision: \"2\"");
    });

    it("blocks projection when session strategy markers are incomplete", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});
        const before = fs.readFileSync(initial.paths.draft_path, "utf8");
        const corrupted = before.replace("<!-- task-plan:session-strategy:end -->", "");
        fs.writeFileSync(initial.paths.draft_path, corrupted, "utf8");

        const stale = updateState(plan, {
            type: "checkpoint",
            payload: {reason: "must reject corrupt strategy markers"},
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        expect(stale).toMatchObject({ok: false, code: PROJECTION_STALE, workflow_outcome: "blocked"});
        expect(fs.readFileSync(stale.paths.draft_path, "utf8")).toBe(corrupted);
    });

    it("rejects an incomplete artifact pair instead of bootstrapping the missing file", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});

        fs.rmSync(initial.paths.draft_path);
        const loaded = loadState(plan, {clock: fixedClock()});

        expect(loaded.code).toBe(ARTIFACT_SET_INCOMPLETE);
        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: {reason: "must not bootstrap"},
        }, {clock: fixedClock()})).toThrowError(expect.objectContaining({code: ARTIFACT_SET_INCOMPLETE}));
        expect(retryProjection(plan, {clock: fixedClock()})).toMatchObject({ok: false, code: "RESTART_REQUIRED"});
        expect(fs.existsSync(initial.paths.draft_path)).toBe(false);
    });

    it("requires an explicit restart when the draft exists without state", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory, STATE_RESTART.plan);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});

        expect(STATE_RESTART.missing_artifact).toBe("state");
        fs.rmSync(initial.paths[`${STATE_RESTART.missing_artifact}_path`]);

        const loaded = loadState(plan, {clock: fixedClock()});
        expect(loaded).toMatchObject({
            code: STATE_RESTART.expected_code,
            status: STATE_RESTART.expected_code,
        });
        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: {reason: "must not bootstrap missing state"},
        }, {clock: fixedClock()})).toThrowError(expect.objectContaining({code: STATE_RESTART.expected_code}));
        expect(fs.existsSync(initial.paths.draft_path)).toBe(true);
        expect(fs.existsSync(initial.paths.state_path)).toBe(false);
    });

    it("protects revisions without replaying arbitrary mutations", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory, STATE_REVISION.plan);
        updateState(plan, createMutation(), {clock: fixedClock()});

        const mutation = STATE_REVISION.mutation;
        const applied = updateState(plan, mutation, {clock: fixedClock()});

        expect(applied.state.revision).toBe(STATE_REVISION.expected.first_revision);
        expect(applied.state.plan_version).toBe(STATE_REVISION.expected.plan_version);
        expect(applied.state.schema_version).toBe(2);
        expect(parseDraftDocument(fs.readFileSync(applied.paths.draft_path, "utf8")).metadata.state_revision).toBe("2");
        expect(() => updateState(plan, STATE_REVISION.stale_mutation, {clock: fixedClock()})).toThrowError(
            expect.objectContaining({code: STATE_REVISION.expected.stale_code}),
        );
        expect(() => updateState(plan, {
            type: "set",
            payload: {plan_status: "approved"},
        }, {clock: fixedClock()})).toThrowError(expect.objectContaining({code: "UNKNOWN_MUTATION"}));
        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: "not an object",
        }, {clock: fixedClock()})).toThrowError(expect.objectContaining({code: "INVALID_MUTATION"}));
    });

    it("keeps the previous canonical state when the next state write fails", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        updateState(plan, createMutation(), {clock: fixedClock()});

        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: {reason: "must remain unapplied"},
        }, {
            clock: fixedClock("2026-01-01T00:00:01Z"),
            writeState: () => {
                throw new Error("state disk full");
            },
        })).toThrowError(expect.objectContaining({code: "STATE_WRITE_FAILED"}));

        const persisted = loadState(plan, {clock: fixedClock()});
        expect(persisted.revision).toBe(1);
        expect(persisted).not.toHaveProperty("applied_mutations");
    });

    it("keeps the previous state when the atomic state temp write fails", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});
        const previousState = fs.readFileSync(initial.paths.state_path, "utf8");
        const failingFs = {
            ...fs,
            writeFileSync(filePath, contents, encoding) {
                if (String(filePath).startsWith(`${initial.paths.state_path}.tmp-`)) {
                    throw new Error("state disk full");
                }
                return fs.writeFileSync(filePath, contents, encoding);
            },
        };

        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: {reason: "must remain unapplied"},
        }, {clock: fixedClock("2026-01-01T00:00:01Z"), fsOps: failingFs})).toThrowError(
            expect.objectContaining({code: "STATE_WRITE_FAILED"}),
        );
        expect(fs.readFileSync(initial.paths.state_path, "utf8")).toBe(previousState);
    });

    it("routes question decisions and full propagation through known mutations", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory, {
            scope_questions: [{
                id: "SQ1",
                prompt: "Czy źródło jest kompletne?",
                impact: "Zmienia kryteria kontekstu.",
                decision_needed: "Potwierdzić kompletność.",
                blocking: true,
                resolved: false,
            }],
        });
        updateState(plan, createMutation(), {clock: fixedClock()});

        const decision = updateState(plan, {
            type: "question-decision",
            payload: {
                question_id: "SQ1",
                decision_ref: "D1",
                answer: "yes",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:01Z",
                affected_refs: ["session_strategy"],
            },
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        expect(decision.state.user_decisions[0].propagation_status).toBe("pending");

        updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "source/context", reason: "source intake starts"},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")});
        updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "review", reason: "source intake complete"},
        }, {clock: fixedClock("2026-01-01T00:00:03Z")});
        const current = loadState(plan).state;
        const propagated = updateState(plan, {
            type: "plan-revision",
            payload: {
                packages: current.packages,
                findings: current.findings,
                session_strategy: {...current.session_strategy, rationale: "Source completeness was confirmed."},
                reason: "Propagate the source decision.",
                propagated_decision_ref: "D1",
            },
        }, {clock: fixedClock("2026-01-01T00:00:04Z")});
        expect(propagated.state.user_decisions[0]).toMatchObject({
            propagation_status: "propagated",
        });
    });

    it("records source fetch completion and failure through dedicated mutations", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        updateState(plan, createMutation(), {clock: fixedClock()});

        const complete = updateState(plan, {
            type: "source-fetch-complete",
            payload: {
                fetched_at: "2026-01-01T00:00:01Z",
                source_updated_at: "2025-12-31T23:59:00Z",
            },
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        expect(complete.state).toMatchObject({
            source_fetch_status: "complete",
            fetched_at: "2026-01-01T00:00:01Z",
            source_updated_at: "2025-12-31T23:59:00Z",
            source_fetch_error: null,
        });
        expect(parseDraftDocument(fs.readFileSync(complete.paths.draft_path, "utf8")).metadata).toMatchObject({
            source_fetch_status: "complete",
            fetched_at: "2026-01-01T00:00:01Z",
            source_updated_at: "2025-12-31T23:59:00Z",
        });

        const failed = updateState(plan, {
            type: "source-fetch-failed",
            payload: {error: "network unavailable"},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")});
        expect(failed.state).toMatchObject({
            source_fetch_status: "failed",
            fetched_at: null,
            source_updated_at: null,
            source_fetch_error: "network unavailable",
            source_fetch_failed_at: "2026-01-01T00:00:02Z",
        });
        const failedDraft = parseDraftDocument(fs.readFileSync(failed.paths.draft_path, "utf8"));
        expect(failedDraft.metadata).toMatchObject({
            source_fetch_status: "failed",
            source_fetch_error: "network unavailable",
        });
        expect(failedDraft.metadata).not.toHaveProperty("fetched_at");
        expect(failedDraft.metadata).not.toHaveProperty("source_updated_at");
        expect(() => updateState(plan, {
            type: "source-fetch-complete",
            payload: {fetched_at: "2026-01-01T00:00:03Z"},
        }, {clock: fixedClock("2026-01-01T00:00:03Z")})).toThrowError(
            expect.objectContaining({code: "INVALID_STATE"}),
        );
    });

    it("keeps blocking and follow-up context requirements distinct and unique", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        updateState(plan, createMutation(), {clock: fixedClock()});

        const updated = updateState(plan, {
            type: "context-requirements-update",
            payload: CONTEXT_REQUIREMENTS,
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        expect(updated.state.context_requirements).toEqual(CONTEXT_REQUIREMENTS);
        expect(updated.state.context_requirements.follow_up[0]).not.toHaveProperty("verified");

        expect(() => updateState(plan, {
            type: "context-requirements-update",
            payload: {
                blocking: [{id: "B1", criterion: "Another blocking criterion."}],
                follow_up: [{
                    id: "B1",
                    reason: "Must remain follow-up.",
                    owner: "planner",
                    target_phase: "review",
                }],
            },
        }, {clock: fixedClock("2026-01-01T00:00:02Z")})).toThrowError(
            expect.objectContaining({code: "INVALID_STATE"}),
        );
        expect(() => updateState(plan, {
            type: "context-requirements-update",
            payload: {
                blocking: [],
                follow_up: [{
                    id: "F2",
                    reason: "Must remain unresolved.",
                    owner: "planner",
                    target_phase: "review",
                    verified: true,
                }],
            },
        }, {clock: fixedClock("2026-01-01T00:00:03Z")})).toThrowError(
            expect.objectContaining({code: "INVALID_CONTEXT_REQUIREMENTS"}),
        );
    });

    it("keeps the latest hybrid attempt as an audit reference without local deduplication", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        updateState(plan, createMutation(), {clock: fixedClock()});

        const attempt = updateState(plan, {
            type: "hybrid-attempt",
            payload: {
                run_id: "run-1",
                attempt_id: "attempt-1",
                attempt_hash: "attempt-hash-1",
                criteria_hash: "criteria-hash-1",
                strategy_hash: "strategy-hash-1",
                status: "complete",
            },
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        expect(attempt.state).toMatchObject({
            hybrid_attempt_id: "attempt-1",
            hybrid_attempt_hash: "attempt-hash-1",
            hybrid_attempt: expect.objectContaining({
                run_id: "run-1",
                criteria_hash: "criteria-hash-1",
                strategy_hash: "strategy-hash-1",
            }),
        });

        const repeated = updateState(plan, {
            type: "hybrid-attempt",
            payload: {
                run_id: "run-2",
                attempt_id: "attempt-2",
                attempt_hash: "attempt-hash-2",
                criteria_hash: "criteria-hash-1",
                strategy_hash: "strategy-hash-1",
            },
        }, {clock: fixedClock("2026-01-01T00:00:02Z")});
        expect(repeated.state).toMatchObject({
            hybrid_attempt_id: "attempt-2",
            hybrid_attempt_hash: "attempt-hash-2",
            hybrid_attempt: expect.objectContaining({
                run_id: "run-2",
                criteria_hash: "criteria-hash-1",
                strategy_hash: "strategy-hash-1",
            }),
        });
    });

    it("keeps an incomplete scout result out of COMPLETE after the single fallback", () => {
        const directory = makeTemporaryDirectory();
        const prepared = prepareIncompleteHybrid(directory);
        let finalized = false;

        try {
            const primary = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary"});
            fs.writeFileSync(primary.reportPath, "not-json", "utf8");
            const primaryResult = evaluateAttempt({
                state: prepared.statePath,
                "run-id": prepared.runId,
                attempt: "primary",
                token: primary.dispatchToken,
            });
            expect(primaryResult.next.action).toBe("CLAIM_FALLBACK");

            const fallback = claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback"});
            fs.writeFileSync(fallback.reportPath, "still-not-json", "utf8");
            const fallbackResult = evaluateAttempt({
                state: prepared.statePath,
                "run-id": prepared.runId,
                attempt: "fallback",
                token: fallback.dispatchToken,
            });
            expect(fallbackResult.next.action).toBe("FINALIZE");

            const final = finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
            finalized = true;
            expect(final.fallback_count).toBe(1);
            expect(final.hybrid_final).toBe(false);
            expect(final.final.status).toBe("INCOMPLETE");
            expect(final.final.status).not.toBe("COMPLETE");
        } finally {
            if (!finalized) {
                abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
            }
        }
    });

    it("accepts known machine mutations through the public state-store API", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory, {
            plan_id: "known-mutations",
            draft_path: "docs/draft/known-mutations.md",
            source_identity: "user:known-mutations",
            packages: [statePackage()],
            scope_questions: [stateQuestion()],
        });
        const results = [updateState(plan, createMutation(), {clock: fixedClock()})];

        results.push(updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "source/context", reason: "initial draft is complete"},
        }, {clock: fixedClock("2026-01-01T00:00:01Z")}));
        results.push(updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "review", reason: "source intake is complete"},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")}));
        results.push(updateState(plan, {
            type: "plan-transition",
            payload: {to: "needs-clarification", reason: "source needs clarification"},
        }, {clock: fixedClock("2026-01-01T00:00:03Z")}));
        results.push(updateState(plan, {
            type: "package-decision",
            payload: {
                package_id: "WP1",
                decision_status: "accepted",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:03Z",
            },
        }, {clock: fixedClock("2026-01-01T00:00:03Z")}));
        const reopened = updateState(plan, {
            type: "package-reopen",
            payload: {
                package_id: "WP1",
                reason: "scope changed",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:04Z",
            },
        }, {clock: fixedClock("2026-01-01T00:00:04Z")});
        results.push(reopened);
        results.push(updateState(plan, {
            type: "question-decision",
            payload: {
                question_id: "SQ1",
                decision_ref: "D1",
                answer: "yes",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:05Z",
                affected_refs: ["session_strategy"],
            },
        }, {clock: fixedClock("2026-01-01T00:00:05Z")}));
        const beforeRevision = results.at(-1).state;
        results.push(updateState(plan, {
            type: "plan-revision",
            payload: {
                packages: beforeRevision.packages,
                findings: beforeRevision.findings,
                session_strategy: {...beforeRevision.session_strategy, rationale: "Scope was confirmed by the user."},
                reason: "Apply the scope decision.",
                propagated_decision_ref: "D1",
            },
        }, {clock: fixedClock("2026-01-01T00:00:06Z")}));
        results.push(updateState(plan, {
            type: "review-record",
            payload: {
                review: {
                    iteration: 1,
                    plan_version: 3,
                    stage: "critical-review",
                    complete: true,
                    checks: [
                        "intent-and-acceptance",
                        "technical-scope",
                        "edge-cases-and-verification",
                        "risks-and-dependencies",
                    ],
                },
            },
        }, {clock: fixedClock("2026-01-01T00:00:07Z")}));
        results.push(updateState(plan, {
            type: "finding-record",
            payload: {
                finding: {
                    id: "F1",
                    severity: "LOW",
                    claim: "A follow-up is still open.",
                    evidence: ["context:F1"],
                    evidence_ref: "context:F1",
                    impact: "The later phase needs one more check.",
                    recommendation: "Verify it during review.",
                    status: "open",
                },
            },
        }, {clock: fixedClock("2026-01-01T00:00:08Z")}));
        results.push(updateState(plan, {
            type: "simplification-record",
            payload: {result: "no-change"},
        }, {clock: fixedClock("2026-01-01T00:00:09Z")}));
        expect(results[1].state.workflow_phase).toBe("source/context");
        expect(results[2].state.workflow_phase).toBe("review");
        expect(results[3].state.plan_status).toBe("needs-clarification");
        expect(results[4].state.packages[0].decision_status).toBe("accepted");
        expect(reopened.state.packages[0].decision_status).toBe("revision-requested");
        expect(reopened.state.plan_version).toBe(2);
        expect(results[6].state.user_decisions[0].propagation_status).toBe("pending");
        expect(results[7].state.user_decisions[0].propagation_status).toBe("propagated");
        expect(results[8].state.review_complete).toBe(true);
        expect(results[9].state.findings[0].id).toBe("F1");
        expect(results.at(-1).state.simplification_status).toBe("no-change");
        expect(results.at(-1).state).not.toHaveProperty("steps_used");
        expect(results.map((result) => result.state.revision)).toEqual(
            results.map((_, index) => index + 1),
        );
        const finalMetadata = parseDraftDocument(fs.readFileSync(results.at(-1).paths.draft_path, "utf8")).metadata;
        expect(finalMetadata.state_revision).toBe(String(results.at(-1).state.revision));
    });

    it("blocks after a stale projection and retries only the projection", () => {
        const directory = makeTemporaryDirectory();
        let failProjection = false;
        const plan = makePlan(directory, {
            ...STATE_PROJECTION_RETRY.plan,
            writeDraft: (target, content) => {
                if (failProjection) {
                    throw new Error("projection unavailable");
                }
                fs.mkdirSync(path.dirname(target), {recursive: true});
                fs.writeFileSync(target, content, "utf8");
            },
        });
        updateState(plan, createMutation(), {clock: fixedClock()});
        failProjection = true;

        const stale = updateState(plan, STATE_PROJECTION_RETRY.mutation, {
            clock: fixedClock("2026-01-01T00:00:01Z"),
        });
        expect(stale).toMatchObject({
            ok: false,
            code: STATE_PROJECTION_RETRY.expected.stale_code,
            workflow_outcome: "blocked",
        });
        expect(stale.state.projection_status).toBe(PROJECTION_STALE);
        expect(() => updateState(plan, {
            type: "question-decision",
            payload: {},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")})).toThrowError(expect.objectContaining({code: PROJECTION_STALE}));
        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: {resume: true, reason: "must not hide a stale projection"},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")})).toThrowError(expect.objectContaining({code: PROJECTION_STALE}));

        failProjection = false;
        const retry = retryProjection(plan, {
            expected_revision: stale.state.revision,
            clock: fixedClock("2026-01-01T00:00:03Z"),
        });
        expect(retry).toMatchObject({
            ok: true,
            code: STATE_PROJECTION_RETRY.expected.retry_code,
            projection_status: PROJECTED,
        });
        expect(retry.state.workflow_outcome).toBe(STATE_PROJECTION_RETRY.expected.workflow_outcome);
        expect(retry.state.revision).toBe(stale.state.revision);
        expect(retry.state.checkpoint.reason).toBe("Draft projection is synchronized with state.");
    });

    it("requires an explicit reasoned checkpoint to resume a projected blocked workflow", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});
        const blocked = {
            ...initial.state,
            workflow_outcome: "blocked",
            projection_status: PROJECTED,
        };
        fs.writeFileSync(initial.paths.state_path, `${JSON.stringify(blocked, null, 2)}\n`, "utf8");

        expect(() => updateState(plan, {
            type: "checkpoint",
            expected_revision: blocked.revision,
            payload: {reason: "ordinary checkpoint"},
        }, {clock: fixedClock("2026-01-01T00:00:01Z")})).toThrowError(expect.objectContaining({code: "WORKFLOW_BLOCKED"}));
        expect(() => updateState(plan, {
            type: "checkpoint",
            expected_revision: blocked.revision,
            payload: {resume: true},
        }, {clock: fixedClock("2026-01-01T00:00:01Z")})).toThrowError(expect.objectContaining({code: "WORKFLOW_BLOCKED"}));
        expect(() => updateState(plan, {
            type: "checkpoint",
            payload: {resume: true, reason: "User resolved the blocker."},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")})).toThrowError(expect.objectContaining({code: "EXPECTED_REVISION_REQUIRED"}));

        const resumed = updateState(plan, {
            type: "checkpoint",
            expected_revision: blocked.revision,
            payload: {resume: true, reason: "User resolved the blocker."},
        }, {clock: fixedClock("2026-01-01T00:00:03Z")});
        expect(resumed.state).toMatchObject({
            workflow_outcome: "running",
            projection_status: PROJECTED,
            revision: blocked.revision + 1,
        });
    });

    it("revises an empty initial plan and reaches approval through the typed lifecycle", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        updateState(plan, createMutation(), {clock: fixedClock()});
        updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "source/context", reason: "start source intake"},
        }, {clock: fixedClock("2026-01-01T00:00:01Z")});
        updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "review", reason: "source intake complete"},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")});
        const beforeRevision = loadState(plan).state;
        const revised = updateState(plan, {
            type: "plan-revision",
            payload: {
                packages: [statePackage()],
                findings: [],
                session_strategy: strategyForPackages(["WP1"]),
                reason: "Define the reviewed implementation package.",
            },
        }, {clock: fixedClock("2026-01-01T00:00:03Z")});
        expect(beforeRevision.packages).toEqual([]);
        expect(revised.state.plan_version).toBe(beforeRevision.plan_version + 1);
        expect(revised.state.packages).toHaveLength(1);
        const revisedDraft = fs.readFileSync(revised.paths.draft_path, "utf8");
        expect(revisedDraft).toContain("<!-- task-plan:session-strategy:start -->");
        expect(revisedDraft).toContain(revised.state.session_strategy.rationale);

        updateState(plan, {
            type: "review-record",
            payload: {review: completeReview(1, revised.state.plan_version, "critical-review")},
        }, {clock: fixedClock("2026-01-01T00:00:04Z")});
        updateState(plan, {
            type: "simplification-record",
            payload: {result: "no-change", control_review_complete: true},
        }, {clock: fixedClock("2026-01-01T00:00:05Z")});
        const readyForDecisions = loadState(plan).state;
        expect(readyForDecisions.package_decision_gate).toBe("closed");
        expect(canOpenPackageDecisions(readyForDecisions)).toEqual({ready: true, reasons: []});
        expect(canTransition("plan", "review-pending", "awaiting-package-decisions", readyForDecisions)).toBe(true);
        updateState(plan, {
            type: "workflow-phase-transition",
            payload: {to: "decisions", reason: "review complete"},
        }, {clock: fixedClock("2026-01-01T00:00:06Z")});
        updateState(plan, {
            type: "plan-transition",
            payload: {to: "awaiting-package-decisions", reason: "open package decisions"},
        }, {clock: fixedClock("2026-01-01T00:00:07Z")});
        updateState(plan, {
            type: "package-decision",
            payload: {
                package_id: "WP1",
                decision_status: "accepted",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:08Z",
            },
        }, {clock: fixedClock("2026-01-01T00:00:08Z")});
        const approved = updateState(plan, {
            type: "plan-transition",
            payload: {to: "approved", reason: "user approved the reviewed plan"},
        }, {clock: fixedClock("2026-01-01T00:00:09Z")});
        expect(approved.state.plan_status).toBe("approved");
    });

    it("rejects invalid or no-op plan revisions without propagating decisions", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory, {scope_questions: [stateQuestion()]});
        updateState(plan, createMutation(), {clock: fixedClock()});
        const initial = loadState(plan).state;
        expect(() => updateState(plan, {
            type: "plan-revision",
            payload: {
                packages: initial.packages,
                findings: initial.findings,
                session_strategy: initial.session_strategy,
                reason: "not in review",
            },
        }, {clock: fixedClock("2026-01-01T00:00:01Z")})).toThrowError(expect.objectContaining({code: "INVALID_PLAN_REVISION_PHASE"}));

        updateState(plan, {type: "workflow-phase-transition", payload: {to: "source/context"}}, {clock: fixedClock("2026-01-01T00:00:02Z")});
        updateState(plan, {type: "workflow-phase-transition", payload: {to: "review"}}, {clock: fixedClock("2026-01-01T00:00:03Z")});
        const reviewState = loadState(plan).state;
        expect(() => updateState(plan, {
            type: "plan-revision",
            payload: {
                packages: reviewState.packages,
                findings: reviewState.findings,
                session_strategy: reviewState.session_strategy,
                reason: "no semantic change",
            },
        }, {clock: fixedClock("2026-01-01T00:00:04Z")})).toThrowError(expect.objectContaining({code: "PLAN_REVISION_NO_CHANGE"}));

        expect(() => updateState(plan, {
            type: "question-decision",
            payload: {
                question_id: "SQ1",
                decision_ref: "D1",
                answer: "yes",
                decision_source: "user",
                decided_at: "2026-01-01T00:00:05Z",
                affected_refs: ["context.blocking"],
            },
        }, {clock: fixedClock("2026-01-01T00:00:05Z")})).toThrowError(expect.objectContaining({code: "INVALID_QUESTION_DECISION"}));
        const unchanged = loadState(plan).state;
        expect(unchanged.user_decisions).toEqual([]);
        expect(unchanged.scope_questions[0].resolved).toBe(false);
    });

    it("materializes valid title-only and detailed-plan initial drafts from state", () => {
        const titleDirectory = makeTemporaryDirectory();
        const titlePlan = makePlan(titleDirectory, {input_profile: "title-only"});
        const title = updateState(titlePlan, createMutation(), {clock: fixedClock()});
        expect(title.state.plan_status).toBe("needs-clarification");
        expect(parseDraftDocument(fs.readFileSync(title.paths.draft_path, "utf8")).metadata.plan_status).toBe("needs-clarification");

        const detailedDirectory = makeTemporaryDirectory();
        const detailedPlan = makePlan(detailedDirectory, {
            source: {
                source_kind: "user-input",
                source_ref: "user:detailed-plan",
                title: "Detailed source",
                input_profile: "detailed-plan",
                body: "Original implementation outline.",
            },
        });
        const detailed = updateState(detailedPlan, createMutation(), {clock: fixedClock()});
        const document = fs.readFileSync(detailed.paths.draft_path, "utf8");
        expect(document).toContain("## Source plan");
        expect(document).toContain("Original implementation outline.");
        expect(document).toContain("## Review findings");
        expect(document).toContain("## Revised plan");
        expect(document).toContain(detailed.state.session_strategy.rationale);
    });

    it("repairs a draft revision left stale after a state-only commit", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        const initial = updateState(plan, createMutation(), {clock: fixedClock()});
        const advanced = {
            ...initial.state,
            revision: initial.state.revision + 1,
            projection_status: PROJECTED,
            updated_at: "2026-01-01T00:00:01Z",
        };
        fs.writeFileSync(initial.paths.state_path, `${JSON.stringify(advanced, null, 2)}\n`, "utf8");

        expect(() => updateState(plan, {
            type: "checkpoint",
            expected_revision: advanced.revision,
            payload: {reason: "must repair projection first"},
        }, {clock: fixedClock("2026-01-01T00:00:02Z")})).toThrowError(expect.objectContaining({code: PROJECTION_STALE}));

        const repaired = retryProjection(plan, {
            expected_revision: advanced.revision,
            clock: fixedClock("2026-01-01T00:00:03Z"),
        });
        expect(repaired).toMatchObject({ok: true, projection_status: PROJECTED});
        expect(repaired.state.revision).toBe(advanced.revision);
        expect(parseDraftDocument(fs.readFileSync(repaired.paths.draft_path, "utf8")).metadata.state_revision)
            .toBe(String(advanced.revision));
    });

    it("rejects a fourth review and makes review-limit-reached terminal", () => {
        const directory = makeTemporaryDirectory();
        const plan = makePlan(directory);
        updateState(plan, createMutation(), {clock: fixedClock()});
        updateState(plan, {type: "workflow-phase-transition", payload: {to: "source/context"}}, {clock: fixedClock("2026-01-01T00:00:01Z")});
        updateState(plan, {type: "workflow-phase-transition", payload: {to: "review"}}, {clock: fixedClock("2026-01-01T00:00:02Z")});
        for (let iteration = 1; iteration <= 3; iteration += 1) {
            updateState(plan, {
                type: "review-record",
                payload: {review: completeReview(iteration, iteration, "critical-review")},
            }, {clock: fixedClock(`2026-01-01T00:00:0${iteration + 2}Z`)});
        }
        expect(() => updateState(plan, {
            type: "review-record",
            payload: {review: completeReview(4, 4, "critical-review")},
        }, {clock: fixedClock("2026-01-01T00:00:06Z")})).toThrowError(expect.objectContaining({code: "REVIEW_LIMIT_REACHED"}));
        updateState(plan, {
            type: "plan-transition",
            payload: {to: "review-limit-reached", reason: "review did not converge"},
        }, {clock: fixedClock("2026-01-01T00:00:07Z")});
        expect(loadState(plan).state.workflow_outcome).toBe("blocked");
        expect(() => updateState(plan, {
            type: "plan-transition",
            payload: {to: "review-pending", reason: "not allowed"},
        }, {clock: fixedClock("2026-01-01T00:00:08Z")})).toThrowError(expect.objectContaining({code: "RESTART_REQUIRED"}));
    });

    it("uses the same known mutation list from the CLI without callback contracts", () => {
        const directory = makeTemporaryDirectory();
        const planPath = path.join(directory, "plan.json");
        fs.writeFileSync(planPath, JSON.stringify(makePlan(directory)), "utf8");

        const ensureResult = spawnSync(process.execPath, [STATE_STORE_SCRIPT, "ensure", "--plan", planPath], {
            cwd: ROOT,
            encoding: "utf8",
        });
        expect(ensureResult.status).toBe(0);
        expect(JSON.parse(ensureResult.stdout)).toMatchObject({schema_version: 2, workflow_phase: "intake"});

        const retryResult = spawnSync(process.execPath, [
            STATE_STORE_SCRIPT,
            "retry-projection",
            "--plan",
            planPath,
        ], {cwd: ROOT, encoding: "utf8"});
        expect(retryResult.status).toBe(1);
        expect(JSON.parse(retryResult.stdout).code).toBe("RESTART_REQUIRED");

        const unknownMutation = path.join(directory, "mutation.json");
        fs.writeFileSync(unknownMutation, JSON.stringify({type: "set", payload: {}}), "utf8");
        const updateResult = spawnSync(process.execPath, [
            STATE_STORE_SCRIPT,
            "update",
            "--plan",
            planPath,
            "--mutation",
            unknownMutation,
        ], {cwd: ROOT, encoding: "utf8"});
        expect(updateResult.status).toBe(1);
        expect(JSON.parse(updateResult.stdout).code).toBe("UNKNOWN_MUTATION");
    });
});

function makePlan(repoRoot, overrides = {}) {
    return {
        repo_root: repoRoot,
        state_root: path.join(repoRoot, "var", "agent", "task-plan"),
        plan_id: "state-store-demo",
        draft_path: "docs/draft/state-store-demo.md",
        source_identity: "user:state-store-demo",
        ...overrides,
    };
}

function readFixture(fileName) {
    return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, fileName), "utf8"));
}

function prepareIncompleteHybrid(directory) {
    const prompt = path.join(directory, "prompt.txt");
    const manifest = path.join(directory, "manifest.json");
    const handoff = path.join(directory, "handoff.json");
    const criteria = path.join(directory, "criteria.json");
    fs.writeFileSync(prompt, "test prompt\n", "utf8");
    const contextManifest = enrichContextManifest({
        version: 1,
        role: "primary",
        repository: "",
        branch: "",
        head: "",
        rules: ["AGENTS.md"],
        documentation: [],
        active_overrides: [],
        constraints: [],
        already_read: ["AGENTS.md"],
        omitted: [],
    });
    if (!contextManifest.repository) {
        contextManifest.repository = "local/repository";
    }
    fs.writeFileSync(manifest, JSON.stringify(contextManifest), "utf8");
    fs.writeFileSync(handoff, JSON.stringify({mode: "targeted", task_brief: "Map a test flow.", decisions: [], constraints: []}), "utf8");
    fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "test"}]}), "utf8");

    return prepareHybrid({
        "prompt-file": prompt,
        manifest,
        handoff,
        criteria,
        "output-dir": directory,
        title: "task-plan-incomplete-scout",
    }, ROOT);
}

function statePackage() {
    return {
        id: "WP1",
        goal: "Validate the state API.",
        scope: "State mutations",
        dependencies: [],
        acceptance_criteria: ["Known mutations are explicit."],
        risks: [],
        questions: [],
        decision_status: "pending",
    };
}

function stateQuestion() {
    return {
        id: "SQ1",
        prompt: "Czy źródło jest wystarczające?",
        impact: "Zmienia zakres review.",
        decision_needed: "Potwierdzić źródło.",
        blocking: true,
        resolved: false,
    };
}

function strategyForPackages(packageIds) {
    return {
        mode: "staged",
        rationale: "Execute the reviewed packages in one explicit stage.",
        stages: [{
            id: "S1",
            title: "Reviewed implementation",
            rationale: "Implement only the accepted package scope.",
            work_package_ids: packageIds,
            dependencies: [],
            session_boundary: "same-session",
            entry_criteria: ["Review is complete."],
            exit_criteria: ["Acceptance criteria pass."],
        }],
        session_boundary_recommendation: "Stop after the reviewed package.",
        dependencies: [],
        entry_criteria: ["Scope is confirmed."],
        exit_criteria: ["Package is complete."],
    };
}

function completeReview(iteration, planVersion, stage) {
    return {
        iteration,
        plan_version: planVersion,
        stage,
        complete: true,
        checks: [
            "intent-and-acceptance",
            "technical-scope",
            "edge-cases-and-verification",
            "risks-and-dependencies",
        ],
    };
}

function createMutation() {
    return {type: "create-initial", payload: {}};
}

function fixedClock(value = "2026-01-01T00:00:00Z") {
    return {
        value,
        now() {
            return this.value;
        },
    };
}

function makeTemporaryDirectory() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "task-plan-state-store-"));
    temporaryDirectories.push(directory);
    return directory;
}
