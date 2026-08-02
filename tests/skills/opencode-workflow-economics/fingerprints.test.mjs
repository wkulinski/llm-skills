import {describe, expect, it} from "vitest";

import {
    buildOperationFingerprint,
    FINGERPRINT_VERSION,
} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/fingerprints.mjs";
import {buildPatternGroups} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/pattern-groups.mjs";

const settings = {
    step_count_maxima: [1, 4, 8],
    tool_call_count_maxima: [1, 3, 7, 15],
    output_byte_maxima: [1024, 16_384, 131_072],
};

describe("OWE fingerprint identity", () => {
    it("does not split identical work by neighboring activity or output size", () => {
        const first = fingerprint({
            output_bytes: 100n,
            previous_primary_activity: "repository_search",
            next_primary_activity: "verification",
        });
        const second = fingerprint({
            output_bytes: 500_000n,
            previous_primary_activity: "delegation",
            next_primary_activity: "implementation",
        });

        expect(first.version).toBe(FINGERPRINT_VERSION);
        expect(first.signature_hash).toBe(second.signature_hash);
        expect(first.structural_family_hash).toBe(second.structural_family_hash);
        expect(first.signature).toEqual({
            scope: "main_agent",
            primary_activity: "repository_search",
            collapsed_operation_sequence: ["file.read{2-3}"],
            mutation_mode: "read_only",
        });
        expect(first.diagnostics.output_size_bucket).toBe("1-1024");
        expect(second.diagnostics.output_size_bucket).toBe("131073+");
    });

    it("keeps collapsed repetition scale in the identity", () => {
        const micro = fingerprint({tools: tools("read", 2)});
        const broad = fingerprint({tools: tools("read", 4)});

        expect(micro.signature.collapsed_operation_sequence).toEqual(["file.read{2-3}"]);
        expect(broad.signature.collapsed_operation_sequence).toEqual(["file.read{4-7}"]);
        expect(micro.signature_hash).not.toBe(broad.signature_hash);
    });

    it("separates read-only, write, and unknown mutation modes", () => {
        const readOnly = fingerprint({tools: tools("read", 1)});
        const write = fingerprint({tools: tools("write", 1)});
        const unknown = fingerprint({tools: [{tool_category: "other", tool_name: "custom"}]});
        const empty = fingerprint({tools: []});

        expect(readOnly.signature.mutation_mode).toBe("read_only");
        expect(write.signature.mutation_mode).toBe("write");
        expect(unknown.signature.mutation_mode).toBe("unknown");
        expect(unknown.diagnostics.profile).not.toHaveProperty("read_only");
        expect(empty.signature.mutation_mode).toBe("unknown");
        expect(readOnly.signature_hash).not.toBe(write.signature_hash);
    });

    it("groups identity matches despite diagnostic differences", () => {
        const firstFingerprint = fingerprint({output_bytes: 100n, previous_primary_activity: "search"});
        const secondFingerprint = fingerprint({output_bytes: 500_000n, previous_primary_activity: "delegation"});
        const result = buildPatternGroups([{
            steps: [],
            spans: [
                patternSpan("root-1", firstFingerprint),
                patternSpan("root-2", secondFingerprint),
            ],
        }]);

        expect(result.groups).toHaveLength(1);
        expect(result.groups[0]).toMatchObject({occurrences: 2, distinct_root_sessions: 2});
    });
});

function fingerprint(overrides = {}) {
    return buildOperationFingerprint({
        primary_activity: "repository_search",
        activities: ["repository_search"],
        step_count: 1,
        tool_calls: overrides.tools?.length ?? 2,
        output_bytes: overrides.output_bytes ?? 100n,
    }, overrides.tools ?? tools("read", 2), {
        scope: "main_agent",
        previous_primary_activity: overrides.previous_primary_activity ?? null,
        next_primary_activity: overrides.next_primary_activity ?? null,
        settings,
    });
}

function tools(category, count) {
    return Array.from({length: count}, () => ({
        tool_category: category,
        tool_name: category,
        operation_category: category === "read" ? "file.read" : category === "write" ? "file.write" : null,
    }));
}

function patternSpan(rootSessionId, operationFingerprint) {
    return {
        id: `${rootSessionId}:span:0`,
        root_session_id: rootSessionId,
        session_id: rootSessionId,
        agent_name: "main",
        activities: ["repository_search"],
        activity_signal_counts: {retry_recovery: 0},
        mixed_step_count: 0,
        tool_errors: 0,
        tool_calls: 2,
        output_bytes: operationFingerprint.diagnostics.output_size_bucket === "131073+" ? 500_000n : 100n,
        usage: {},
        cost: {
            status: "complete",
            value_nano: 1n,
            priced_value_nano: 1n,
            priced_steps: 1,
            eligible_steps: 1,
            currency: "USD",
        },
        semantic_hints: [],
        operation_fingerprint: operationFingerprint,
    };
}
