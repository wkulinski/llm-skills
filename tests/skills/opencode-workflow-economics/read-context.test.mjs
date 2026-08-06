import {describe, expect, it} from "vitest";

import {analyzeCorpusCase, CORPUS_CASES} from "../../../.agents/skills/opencode-workflow-economics/corpus/cases.mjs";
import {buildReportIndex} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/report-index.mjs";

describe("OWE declared read context", () => {
    it("retains a stronger repeated-work signal while preserving declared context", () => {
        const definition = structuredClone(CORPUS_CASES[1]);
        const root = definition.roots.find((item) => item.root_session_id === "overlap-strong");
        const followupStep = root.tree[0].messages[2];
        const finish = followupStep.parts.pop();
        followupStep.parts.push({
            type: "tool",
            tool: "shell",
            state: {
                status: "completed",
                input: {
                    command: "node .agents/skills/code-implement/scripts/state-readlog.mjs --purpose read-before-write --source parent --path src/Order.mjs",
                },
                output: "ok",
            },
        }, finish);

        const result = analyzeCorpusCase({
            ...definition,
            roots: [root],
        });
        const diagnostic = result.delegation_overlap_diagnostics[0];

        expect(diagnostic.diagnostic).toBe("strong_repeated_work_signal");
        expect(diagnostic.evidence.declared_read_contexts).toEqual([
            expect.objectContaining({purpose: "read-before-write", source: "parent", event: "read"}),
        ]);
        expect(diagnostic.evidence.exact_resource_matches_before_first_write).toBe(2);
        expect(diagnostic.limitations.join(" ")).toContain("workflow metadata");
        expect(result.summary.strong_repeated_work_signals).toBe(1);
        expect(result.summary.declared_read_contexts).toBe(1);
        expect(buildReportIndex(result).overlap_views.declared_read_context).toEqual([]);
    });

    it("keeps untagged exact overlap conservative", () => {
        const result = analyzeCorpusCase({
            ...CORPUS_CASES[1],
            roots: [CORPUS_CASES[1].roots.find((item) => item.root_session_id === "overlap-strong")],
        });

        expect(result.delegation_overlap_diagnostics[0].diagnostic).toBe("strong_repeated_work_signal");
        expect(result.summary.declared_read_contexts).toBe(0);
    });

    it("uses declared context when no stronger repeated-work signal exists", () => {
        const definition = structuredClone(CORPUS_CASES[1]);
        const root = definition.roots.find((item) => item.root_session_id === "overlap-strong");
        const parentStep = root.tree[0].messages[2];
        const parentTool = parentStep.parts.find((part) => part.type === "tool");
        parentTool.tool = "read";
        parentTool.state.input = {filePath: "src/Order.mjs"};
        const finish = parentStep.parts.pop();
        parentStep.parts.push({
            type: "tool",
            tool: "shell",
            state: {
                status: "completed",
                input: {
                    command: "node .agents/skills/code-implement/scripts/state-readlog.mjs --purpose read-before-write --source parent --path src/Order.mjs",
                },
                output: "ok",
            },
        }, finish);
        const childTool = root.tree[1].messages[1].parts.find((part) => part.type === "tool");
        childTool.tool = "read";
        childTool.state.input = {filePath: "src/Order.mjs"};

        const result = analyzeCorpusCase({...definition, roots: [root]});
        const diagnostic = result.delegation_overlap_diagnostics[0];

        expect(diagnostic.diagnostic).toBe("declared_read_context");
        expect(diagnostic.evidence.declared_read_contexts).toHaveLength(1);
        expect(buildReportIndex(result).overlap_views.declared_read_context).toEqual([diagnostic.delegation_id]);
    });
});
