import {describe, expect, it} from "vitest";

import {analyzeCorpusCase, CORPUS_CASES} from "../../../.agents/skills/opencode-workflow-economics/corpus/cases.mjs";
import {buildReportIndex} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-index.mjs";

describe("OWE Stage 12 report field reduction", () => {
    it("removes aliases, duplicated projections, per-object versions and derived booleans", () => {
        const bundle = analyzeCorpusCase(CORPUS_CASES[0]);
        const step = bundle.roots[0].steps[0];
        const span = bundle.roots[0].spans[0];

        expect(step).not.toHaveProperty("activity");
        expect(step).not.toHaveProperty("activity_classification.method");
        expect(step).toHaveProperty("primary_activity");
        expect(step).toHaveProperty("activity_classification.resolution");
        expect(step).toHaveProperty("activity_classification.evidence");
        expect(step).toHaveProperty("provider_id", "provider");
        expect(step).toHaveProperty("reported_model_id", "model");
        expect(step).toHaveProperty("model_variant");

        expect(span).not.toHaveProperty("activity");
        expect(span).not.toHaveProperty("classification_method");
        expect(span).not.toHaveProperty("read_only");
        expect(span).not.toHaveProperty("operation_fingerprint.diagnostics.profile.read_only");
        expect(span).toHaveProperty("primary_activity");
        expect(span).toHaveProperty("activities");
        expect(span).toHaveProperty("operation_fingerprint.mutation_mode");

        expect(bundle.aggregates).not.toHaveProperty("by_activity");
        expect(bundle.candidate_views).not.toHaveProperty("high_cost");
        expect(bundle.candidate_views).toHaveProperty("low_risk_read_only");
        expect(bundle.aggregates).toHaveProperty("by_activity_signal");
    });

    it("keeps overlap evidence while removing the duplicated parent follow-up activities", () => {
        const bundle = analyzeCorpusCase(CORPUS_CASES[1]);
        const delegation = bundle.roots
            .flatMap((root) => root.delegations)
            .find((item) => item.parent_followup?.steps > 0);

        expect(delegation.parent_followup).not.toHaveProperty("activities");
        expect(delegation.parent_followup).toHaveProperty("primary_activities");
        expect(delegation.parent_followup).toHaveProperty("activity_sets");
        expect(bundle.delegation_overlap_diagnostics[0].evidence).toHaveProperty("exact_resource_matches");
        expect(bundle.delegation_overlap_diagnostics[0].evidence).toHaveProperty("ordered_exact_matches");
    });

    it("does not expose the removed read-only projection boolean", () => {
        const index = buildReportIndex(analyzeCorpusCase(CORPUS_CASES[0]));
        expect(index.patterns[0]).not.toHaveProperty("read_only");
        expect(index.patterns[0]).toHaveProperty("mutation_mode");
    });

    it("keeps low-risk candidates equivalent to fingerprint mutation mode", () => {
        const bundle = analyzeCorpusCase(CORPUS_CASES[0]);
        const spans = bundle.roots.flatMap((root) => root.spans);
        const eligibleActivities = new Set([
            "repository_discovery",
            "file_reading",
            "external_research",
            "verification",
            "build",
            "skill_loading",
        ]);
        const expected = spans
            .filter((span) => span.operation_fingerprint.mutation_mode === "read_only")
            .filter((span) => eligibleActivities.has(span.primary_activity))
            .map((span) => span.id)
            .sort();

        expect(bundle.candidate_views.low_risk_read_only.slice().sort()).toEqual(expected);
        expect(expected.length).toBeGreaterThan(0);
    });
});
