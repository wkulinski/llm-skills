import {describe, expect, it} from "vitest";

import {
    buildRunSummary,
    renderSummaryText,
} from "../../../.agents/skills/qa-run/scripts/run-matrix/reporting/summary-writer.mjs";
import {hashJson} from "../../../.agents/skills/qa-run/scripts/run-matrix/shared/hashing.mjs";

describe("run-matrix summary writer", () => {
    it("builds the persisted summary contract", () => {
        const files = ["src/changed.mjs"];
        const rawConfig = {
            sectionOrder: ["JS_CHANGED"],
        };
        const summary = buildRunSummary({
            activeSections: {
                ALWAYS_FULL: false,
                JS_CHANGED: true,
            },
            artifacts: {
                relativeDir: "var/agent/cache/qa-run/run-id",
            },
            cli: {
                rerunReason: "post-fix-delta",
            },
            commands: [passedCommand()],
            config: {
                raw: rawConfig,
            },
            configNotices: [],
            failures: [],
            files,
            mode: "delta",
            riskAssessment: {
                changedSections: ["JS_CHANGED"],
                reasons: ["section_requires_final_full_pass:JS_CHANGED"],
                shouldRunFullFinalPass: true,
            },
            session: {
                pendingFinalFullPass: true,
                pendingReasons: ["section_requires_final_full_pass:JS_CHANGED"],
            },
            skippedNoChanges: ["PHP_CHANGED"],
            skippedNoCommands: [],
            status: "PASS",
        });

        expect(summary).toEqual(expect.objectContaining({
            activeSections: ["JS_CHANGED"],
            artifactsDir: "var/agent/cache/qa-run/run-id",
            changedFilesCount: 1,
            changedFilesHash: hashJson(files),
            matrixHash: hashJson(rawConfig),
            mode: "delta",
            pendingFinalFullPass: true,
            pendingFinalFullPassReasons: ["section_requires_final_full_pass:JS_CHANGED"],
            rerunReason: "post-fix-delta",
            skippedNoChanges: ["PHP_CHANGED"],
            skippedNoCommands: [],
            status: "PASS",
        }));
        expect(summary.riskAssessment).toEqual({
            changedSections: ["JS_CHANGED"],
            pendingFinalFullPass: true,
            pendingFinalFullPassReasons: ["section_requires_final_full_pass:JS_CHANGED"],
        });
    });

    it("renders failure details and config notices in summary text", () => {
        const text = renderSummaryText({
            activeSections: ["JS_CHANGED"],
            artifactsDir: "var/agent/cache/qa-run/run-id",
            commands: [
                passedCommand(),
                {
                    ...passedCommand(),
                    status: "SKIP-CACHED",
                },
            ],
            configNotices: [
                {
                    message: "ESLint command uses parser=generic-tail",
                    section: "JS_CHANGED",
                },
            ],
            failures: [
                {
                    command: "node -e fail",
                    exitCode: 7,
                    section: "JS_CHANGED",
                    summary: ["first failure", "second failure"],
                },
            ],
            mode: "delta",
            pendingFinalFullPass: true,
            rerunReason: "post-fix-delta",
            status: "FAIL",
        });

        expect(text).toContain("QA: FAIL");
        expect(text).toContain("Mode: delta");
        expect(text).toContain("Commands: 2 total / 1 executed / 1 cached");
        expect(text).toContain("Pending final full pass: yes");
        expect(text).toContain("- [JS_CHANGED] node -e fail exit=7");
        expect(text).toContain("  - first failure");
        expect(text).toContain("Config notices:");
        expect(text).toContain("- [JS_CHANGED] ESLint command uses parser=generic-tail");
        expect(text.endsWith("\n\n")).toBe(true);
    });
});

function passedCommand() {
    return {
        command: "node -e ok",
        durationMs: 10,
        exitCode: 0,
        section: "JS_CHANGED",
        status: "PASS",
    };
}
