import {describe, expect, it} from "vitest";

import {DEFAULT_CONFIG} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/config.mjs";
import {
    buildMethodologyManifest,
    compareMethodologies,
    METHODOLOGY_VERSIONS,
    REPORT_SCHEMA_VERSION,
} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/methodology.mjs";

describe("OWE methodology manifest", () => {
    it("records schema, algorithm versions and effective thresholds", () => {
        const manifest = buildMethodologyManifest(DEFAULT_CONFIG);

        expect(REPORT_SCHEMA_VERSION).toBe(5);
        expect(manifest).toMatchObject({
            activity_classification_version: "deterministic_activity_signals_v2",
            fingerprint_version: "operation_fingerprint_v2",
            pattern_grouping_version: "exact_fingerprint_identity_v2",
            representative_sampling_version: "representative_sampling_v2",
            overlap_version: "deterministic_evidence_rules_v5_declared_read_context",
            effective_thresholds: {
                fingerprints: {step_count_maxima: [1, 4, 8]},
                patterns: {min_occurrences: 2},
                delegation_overlap: {max_parent_steps: 8},
            },
        });
        expect(manifest.methodology_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("keeps the hash stable and changes it for thresholds or versions", () => {
        const first = buildMethodologyManifest(DEFAULT_CONFIG);
        const same = buildMethodologyManifest(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
        const changedThreshold = buildMethodologyManifest({
            ...DEFAULT_CONFIG,
            diagnostics: {
                ...DEFAULT_CONFIG.diagnostics,
                patterns: {...DEFAULT_CONFIG.diagnostics.patterns, min_occurrences: 3},
            },
        });
        const changedVersion = buildMethodologyManifest(DEFAULT_CONFIG, {
            ...METHODOLOGY_VERSIONS,
            fingerprint_version: "operation_fingerprint_v3",
        });

        expect(same.methodology_hash).toBe(first.methodology_hash);
        expect(changedThreshold.methodology_hash).not.toBe(first.methodology_hash);
        expect(compareMethodologies(first, changedVersion)).toMatchObject({
            compatible: false,
            differences: expect.arrayContaining(["fingerprint_version", "methodology_hash"]),
        });
    });

    it("warns when reports have incompatible or missing methodology", () => {
        const manifest = buildMethodologyManifest(DEFAULT_CONFIG);
        const changed = buildMethodologyManifest({
            ...DEFAULT_CONFIG,
            diagnostics: {
                ...DEFAULT_CONFIG.diagnostics,
                delegation_overlap: {...DEFAULT_CONFIG.diagnostics.delegation_overlap, max_parent_steps: 9},
            },
        });

        expect(compareMethodologies(manifest, manifest)).toEqual({compatible: true, differences: [], warning: null});
        expect(compareMethodologies(manifest, changed).warning).toContain("incompatible methodologies");
        expect(compareMethodologies(manifest, {schema_version: 3}).warning).toContain("incompatible methodologies");
    });
});
