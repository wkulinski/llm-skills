import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {
    assessRiskForFullFinalPass,
    includeSessionRiskForFullFinalPass,
} from "../../../.agents/skills/qa-run/scripts/run-matrix/session/risk-assessment.mjs";
import {
    createDefaultSession,
    loadSession,
    updateSession,
} from "../../../.agents/skills/qa-run/scripts/run-matrix/session/session-store.mjs";
import {hashJson} from "../../../.agents/skills/qa-run/scripts/run-matrix/shared/hashing.mjs";

const tempRoots = [];

afterEach(() => {
    while (tempRoots.length > 0) {
        const tempRoot = tempRoots.pop();
        rmSync(tempRoot, {force: true, recursive: true});
    }
});

describe("run-matrix session state", () => {
    it("marks pending final full pass after risky delta sections", () => {
        const config = configWithRaw({
            RISK_CHANGED: {
                requiresFinalFullPass: true,
            },
        });
        const riskAssessment = assessRiskForFullFinalPass({
            ALWAYS_FULL: true,
            RISK_CHANGED: true,
        }, config);

        const session = updateSession(createDefaultSession(), {
            rerunReason: "post-fix-delta",
        }, "delta", currentState(), config, riskAssessment);

        expect(session.pendingFinalFullPass).toBe(true);
        expect(session.pendingReasons).toEqual([
            "section_requires_final_full_pass:RISK_CHANGED",
        ]);
        expect(session.lastRun).toEqual(expect.objectContaining({
            mode: "delta",
            rerunReason: "post-fix-delta",
        }));
    });

    it("clears pending final full pass on full-final-pass rerun", () => {
        const config = configWithRaw({});
        const session = updateSession({
            ...createDefaultSession(),
            pendingFinalFullPass: true,
            pendingReasons: ["section_requires_final_full_pass:RISK_CHANGED"],
        }, {
            rerunReason: "full-final-pass",
        }, "full", currentState(), config, {
            changedSections: [],
            reasons: [],
            shouldRunFullFinalPass: false,
        });

        expect(session.pendingFinalFullPass).toBe(false);
        expect(session.pendingReasons).toEqual([]);
        expect(session.lastFullPass).toEqual(expect.objectContaining({
            matrixHash: hashJson(config.raw),
            snapshotHash: hashJson(currentState().files),
        }));
    });

    it("keeps matrix_changed_since_last_full_pass as a pending reason for delta reruns", () => {
        const config = configWithRaw({
            SAFE_CHANGED: {
                requiresFinalFullPass: false,
            },
        });
        const session = {
            ...createDefaultSession(),
            lastFullPass: {
                matrixHash: "previous-matrix-hash",
            },
        };
        const baseRiskAssessment = assessRiskForFullFinalPass({
            SAFE_CHANGED: true,
        }, config);
        const riskAssessment = includeSessionRiskForFullFinalPass(
            baseRiskAssessment,
            session,
            config,
            "delta"
        );

        const nextSession = updateSession(session, {
            rerunReason: "post-fix-delta",
        }, "delta", currentState(), config, riskAssessment);

        expect(riskAssessment.shouldRunFullFinalPass).toBe(true);
        expect(riskAssessment.reasons).toEqual(["matrix_changed_since_last_full_pass"]);
        expect(nextSession.pendingFinalFullPass).toBe(true);
        expect(nextSession.pendingReasons).toEqual(["matrix_changed_since_last_full_pass"]);
    });

    it("rejects unsupported session versions", () => {
        const sessionPath = writeTempSession({
            version: 999,
            pendingFinalFullPass: false,
            pendingReasons: [],
        });

        expect(() => loadSession(sessionPath)).toThrow("Unsupported session version");
    });

    it("rejects invalid JSON session files", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-session-vitest-"));
        tempRoots.push(tempRoot);
        const sessionPath = path.join(tempRoot, "session.json");
        writeFileSync(sessionPath, "{not-json\n", "utf-8");

        expect(() => loadSession(sessionPath)).toThrow("Invalid JSON session");
    });
});

function configWithRaw(sections) {
    return {
        raw: {
            sectionOrder: Object.keys(sections),
            sections,
        },
        sections,
    };
}

function currentState() {
    return {
        files: {
            "changed.txt": {
                exists: true,
                hash: "changed-hash",
            },
        },
    };
}

function writeTempSession(session) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-session-vitest-"));
    tempRoots.push(tempRoot);
    const sessionPath = path.join(tempRoot, "session.json");
    writeFileSync(sessionPath, JSON.stringify(session), "utf-8");
    return sessionPath;
}
