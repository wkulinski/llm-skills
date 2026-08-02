import {describe, expect, it} from "vitest";

import {analyzeCorpusCase, CORPUS_CASES, CORPUS_VERSION} from "../../../.agents/skills/opencode-workflow-economics/corpus/cases.mjs";

describe("OWE methodology corpus", () => {
    it("has reviewed expectations for every corpus case", () => {
        expect(CORPUS_VERSION).toBe("owe-methodology-corpus-v3");
        expect(CORPUS_CASES).toHaveLength(3);
        for (const item of CORPUS_CASES) {
            expect(item.id).toBeTruthy();
            expect(item.description).toBeTruthy();
            expect(item.roots.length).toBeGreaterThan(0);
            expect(item.expectations).toBeTruthy();
        }
    });

    it("keeps recurring pattern and semantic review expectations", () => {
        const result = analyzeCorpusCase(CORPUS_CASES[0]);
        const coherent = findPattern(result, ["repository.search", "file.read{2-3}"]);
        expect(coherent).toMatchObject({
            occurrences: 2,
            distinct_root_sessions: 2,
        });
        expect(new Set(coherent.representative_examples.map((example) => example.root_session_id)).size).toBe(2);
        expect(findPattern(result, ["repository.search", "file.read", "file.write"])).toMatchObject({
            occurrences: 2,
            distinct_root_sessions: 2,
        });
        expect(findPattern(result, ["file.read{2-3}"])).toMatchObject({
            occurrences: 2,
            distinct_root_sessions: 2,
        });
        expect(CORPUS_CASES[0].expectations.coherent_pattern).toMatchObject({semantic_coherent: true, delegable: true});
        expect(CORPUS_CASES[0].expectations.mixed_pattern).toMatchObject({semantic_coherent: false, delegable: false});
        expect(result.summary.recurring_pattern_groups).toBeGreaterThanOrEqual(3);
    });

    it("maximizes root diversity when more examples are available than roots in the baseline", () => {
        const extraRoot = JSON.parse(JSON.stringify(CORPUS_CASES[0].roots[0]).replaceAll("pattern-coherent-1", "pattern-coherent-3"));
        const result = analyzeCorpusCase({
            ...CORPUS_CASES[0],
            roots: [...CORPUS_CASES[0].roots, extraRoot],
        });
        const coherent = findPattern(result, ["repository.search", "file.read{2-3}"]);

        expect(coherent.representative_examples).toHaveLength(3);
        expect(coherent.representative_examples.map((example) => example.root_session_id)).toEqual([
            "pattern-coherent-1",
            "pattern-coherent-2",
            "pattern-coherent-3",
        ]);
    });

    it("keeps distinct representative spans when every occurrence belongs to one root", () => {
        const source = JSON.parse(JSON.stringify(CORPUS_CASES[0].roots[0]));
        const session = source.tree[0];
        const firstMessage = session.messages[1];
        const middleMessage = JSON.parse(JSON.stringify(CORPUS_CASES[0].roots[2].tree[0].messages[1]).replaceAll("pattern-mixed-1", "single-root-middle"));
        const secondMessage = JSON.parse(JSON.stringify(firstMessage).replaceAll("pattern-coherent-1", "single-root-repeat-2"));
        source.root_session_id = "single-root";
        session.session.id = "single-root";
        session.session.title = "single-root";
        session.messages = [session.messages[0], firstMessage, middleMessage, secondMessage];

        const result = analyzeCorpusCase({
            ...CORPUS_CASES[0],
            roots: [source],
        });
        const pattern = findPattern(result, ["repository.search", "file.read{2-3}"]);

        expect(pattern).toMatchObject({occurrences: 2, distinct_root_sessions: 1});
        expect(pattern.representative_examples).toHaveLength(2);
        expect(new Set(pattern.representative_examples.map((example) => example.root_session_id)).size).toBe(1);
    });

    it("matches the reviewed overlap labels and timing evidence", () => {
        const result = analyzeCorpusCase(CORPUS_CASES[1]);
        const byId = new Map(result.delegation_overlap_diagnostics.map((item) => [item.delegation_id, item]));
        for (const [id, expectation] of Object.entries(CORPUS_CASES[1].expectations.diagnostics)) {
            expect(byId.get(id), id).toMatchObject({diagnostic: expectation.diagnostic});
            expect(byId.get(id).evidence.exact_resource_matches_before_first_write).toBe(expectation.pre_write_matches);
            if (typeof expectation.same_command_count !== "undefined")
            { expect(byId.get(id).evidence.same_command_count).toBe(expectation.same_command_count); }
            if (typeof expectation.unordered_matches !== "undefined")
            { expect(byId.get(id).evidence.unordered_exact_matches).toBe(expectation.unordered_matches); }
            if (typeof expectation.overlapping_matches !== "undefined")
            { expect(byId.get(id).evidence.overlapping_exact_matches).toBe(expectation.overlapping_matches); }
            if (typeof expectation.child_completion !== "undefined")
            { expect(byId.get(id).evidence.child_completed_at_ms).toBe(BigInt(expectation.child_completion)); }
            if (typeof expectation.unknown_timing_steps !== "undefined")
            { expect(byId.get(id).evidence.steps_with_unknown_timing).toBe(expectation.unknown_timing_steps); }
            if (typeof expectation.post_write_matches !== "undefined")
            { expect(byId.get(id).evidence.exact_resource_matches_after_first_write).toBe(expectation.post_write_matches); }
            if (typeof expectation.command_pre_write_matches !== "undefined")
            { expect(byId.get(id).evidence.command_exact_matches_before_first_write).toBe(expectation.command_pre_write_matches); }
            if (expectation.ordered)
            { expect(byId.get(id).evidence.steps_with_unknown_timing).toBe(0); }
            if (expectation.deliberate_verification)
            { expect(byId.get(id).evidence.shared_operation_types).toContain("verification.test"); }
            if (expectation.limitation)
            { expect(byId.get(id).limitations.join(" ")).toContain(expectation.limitation); }
        }
    });

    it("does not promote post-write matches to strong evidence", () => {
        const result = analyzeCorpusCase(CORPUS_CASES[1]);
        const diagnostic = result.delegation_overlap_diagnostics.find((item) => item.delegation_id === "overlap-post-write-not-strong:tool:0");

        expect(diagnostic).toMatchObject({diagnostic: "mixed_followup"});
        expect(diagnostic.evidence).toMatchObject({
            semantic_exact_matches_before_first_write: 0,
            command_exact_matches_before_first_write: 1,
            exact_resource_matches_after_first_write: 3,
        });
        expect(diagnostic.limitations.join(" ")).toContain("do not strengthen strong_repeated_work_signal");
    });

    it("keeps structural similarity as descriptive context without a repeated-work label", () => {
        const result = analyzeCorpusCase(CORPUS_CASES[1]);
        const diagnostic = result.delegation_overlap_diagnostics.find((item) => item.delegation_id === "overlap-structural:tool:0");

        expect(diagnostic).toMatchObject({diagnostic: "no_overlap_observed_in_window"});
        expect(diagnostic.evidence).toMatchObject({
            operation_jaccard: 1,
            ordered_sequence_similarity: 1,
            shared_operation_types: ["repository.search"],
        });
        expect(diagnostic.limitations.join(" ")).toContain("descriptive context only");
    });

    it("does not promote multiple shared operation types without exact resources", () => {
        const result = analyzeCorpusCase(CORPUS_CASES[1]);
        const diagnostic = result.delegation_overlap_diagnostics.find((item) => item.delegation_id === "overlap-multi-structural:tool:0");

        expect(diagnostic).toMatchObject({diagnostic: "no_overlap_observed_in_window"});
        expect(diagnostic.evidence).toMatchObject({
            exact_resource_matches: 0,
            operation_jaccard: 1,
            ordered_sequence_similarity: 1,
            shared_operation_types: ["file.read", "repository.search"],
        });
    });

    it("keeps unordered and overlapping exposure out of follow-up cost", () => {
        const result = analyzeCorpusCase(CORPUS_CASES[1]);
        const byId = new Map(result.delegation_overlap_diagnostics.map((item) => [item.delegation_id, item]));

        expect(byId.get("overlap-strong:tool:0")).toMatchObject({
            parent_followup: {steps: 1},
            parent_exposure: {unordered: {steps: 0}, overlapping: {steps: 0}},
        });
        expect(byId.get("overlap-unknown-time:tool:0")).toMatchObject({
            parent_followup: {steps: 0, cost: {eligible_steps: 0}},
            parent_exposure: {unordered: {steps: 1}, overlapping: {steps: 0}},
        });
        expect(byId.get("overlap-overlapping-time:tool:0")).toMatchObject({
            parent_followup: {steps: 0, cost: {eligible_steps: 0}},
            parent_exposure: {unordered: {steps: 0}, overlapping: {steps: 1}},
        });
    });

    it("handles timing boundaries and configured window limits", () => {
        const boundaryResult = analyzeCorpusCase(CORPUS_CASES[1]);
        const boundaryDiagnostics = new Map(boundaryResult.delegation_overlap_diagnostics.map((item) => [item.delegation_id, item]));

        expect(boundaryDiagnostics.get("overlap-boundary-time:tool:0")).toMatchObject({
            diagnostic: "strong_repeated_work_signal",
            parent_followup: {steps: 1, cost: {eligible_steps: 1}},
            parent_exposure: {total_cost: {eligible_steps: 0}},
        });
        expect(boundaryDiagnostics.get("overlap-missing-child-time:tool:0")).toMatchObject({
            parent_followup: {steps: 0, cost: {eligible_steps: 0}},
            parent_exposure: {unordered: {steps: 1}},
        });
        expect(boundaryDiagnostics.get("overlap-missing-parent-end:tool:0")).toMatchObject({
            parent_followup: {steps: 0, cost: {eligible_steps: 0}},
            parent_exposure: {unordered: {steps: 1}},
        });

        const limitedCase = {
            ...CORPUS_CASES[1],
            roots: [CORPUS_CASES[1].roots.find((item) => item.root_session_id === "overlap-window-limit")],
            config: {diagnostics: {delegation_overlap: {max_parent_steps: 1}}},
        };
        const limited = analyzeCorpusCase(limitedCase).delegation_overlap_diagnostics[0];
        expect(limited.evidence.window_stop_reason).toBe("step_limit");
        expect(limited.parent_followup.steps).toBe(1);

        const elapsedCase = {
            ...CORPUS_CASES[1],
            roots: [CORPUS_CASES[1].roots.find((item) => item.root_session_id === "overlap-strong")],
            config: {diagnostics: {delegation_overlap: {max_elapsed_ms: 5}}},
        };
        const elapsed = analyzeCorpusCase(elapsedCase).delegation_overlap_diagnostics[0];
        expect(elapsed.evidence.window_stop_reason).toBe("elapsed_limit");
        expect(elapsed.parent_followup.steps).toBe(0);
    });

    it("preserves the pricing coverage matrix", () => {
        for (const [id, expectation] of Object.entries(CORPUS_CASES[2].expectations.statuses)) {
            const result = analyzeCorpusCase(CORPUS_CASES[2].roots.find((item) => item.root_session_id === id)
                ? {...CORPUS_CASES[2], roots: [CORPUS_CASES[2].roots.find((item) => item.root_session_id === id)]}
                : CORPUS_CASES[2]);
            const step = result.roots[0].steps[0];
            expect(step, id).toMatchObject({status: expectation.step_status, cost_status: expectation.cost_status});
            expect(result.roots[0].totals.cost.status, id).toBe(expectation.pricing_status);
        }
    });
});

function findPattern(result, operations) {
    return result.pattern_groups.find((item) => item.signature.collapsed_operation_sequence.join("|") === operations.join("|"));
}
