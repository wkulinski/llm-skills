import {chmodSync, mkdtempSync, rmSync, statSync, writeFileSync} from "node:fs";
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
    saveSession,
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
    it("keeps new and updated sessions private without changing existing parent permissions", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-session-vitest-"));
        tempRoots.push(tempRoot);
        chmodSync(tempRoot, 0o755);
        const sessionDir = path.join(tempRoot, "new", "nested");
        const sessionPath = path.join(sessionDir, "session.json");
        const session = {
            ...createDefaultSession(),
            lastRun: {selection: [{kind: "test", runner: "unit", selectors: ["a.test.mjs"]}]},
        };

        saveSession(sessionPath, session);

        expect(statSync(sessionPath).mode & 0o777).toBe(0o600);
        expect(statSync(sessionDir).mode & 0o777).toBe(0o700);
        expect(statSync(path.dirname(sessionDir)).mode & 0o777).toBe(0o700);
        expect(statSync(tempRoot).mode & 0o777).toBe(0o755);
        expect(loadSession(sessionPath)).toEqual(session);

        chmodSync(sessionPath, 0o644);
        chmodSync(sessionDir, 0o755);
        const updatedSession = {...session, pendingFinalFullPass: true};
        saveSession(sessionPath, updatedSession);

        expect(statSync(sessionPath).mode & 0o777).toBe(0o600);
        expect(statSync(sessionDir).mode & 0o777).toBe(0o755);
        expect(statSync(tempRoot).mode & 0o777).toBe(0o755);
        expect(loadSession(sessionPath)).toEqual(updatedSession);
    });

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
        }, {status: "PASS"});

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

    it("keeps the earlier full pass and pending gate after point and partial passes", () => {
        const config = configWithRaw({});
        const fullPass = updateSession(createDefaultSession(), {rerunReason: "initial"}, "full", currentState(), config, noRisk(), {status: "PASS"});
        const pending = {...fullPass, pendingFinalFullPass: true, pendingReasons: ["section_requires_final_full_pass:RISK"]};

        for (const scope of ["point", "partial"]) {
            const selection = [{kind: "test", runner: "unit", selectors: ["a.test.mjs"]}];
            const next = updateSession(pending, {rerunReason: "initial", scope}, "full", currentState("other"), config, noRisk(), {selection, status: "PASS"});

            expect(next.lastFullPass).toEqual(fullPass.lastFullPass);
            expect(next.pendingFinalFullPass).toBe(true);
            expect(next.pendingReasons).toEqual(["section_requires_final_full_pass:RISK"]);
            expect(next.lastRun).toEqual(expect.objectContaining({scope, selection, status: "PASS"}));
        }
    });

    it("does not record a full pass for failures, delta runs, or stale evidence", () => {
        const config = configWithRaw({});
        const previous = {
            ...createDefaultSession(),
            lastFullPass: {completedAt: "earlier", matrixHash: hashJson(config.raw), snapshotHash: "earlier-snapshot"},
            pendingFinalFullPass: true,
            pendingReasons: ["section_requires_final_full_pass:RISK"],
        };
        const cases = [
            [{rerunReason: "full-final-pass"}, "full", {status: "FAIL"}],
            [{rerunReason: "post-fix-delta"}, "delta", {status: "PASS"}],
            [{rerunReason: "full-final-pass"}, "full", {postRunState: currentState("mutated"), status: "PASS"}],
            [{rerunReason: "full-final-pass"}, "full", {}],
        ];

        for (const [cli, mode, outcome] of cases) {
            const next = updateSession(previous, cli, mode, currentState(), config, noRisk(), outcome);

            expect(next.lastFullPass).toEqual(previous.lastFullPass);
            expect(next.pendingFinalFullPass).toBe(true);
        }
    });

    it("identifies the checked content and separates process status from evidence freshness", () => {
        const config = configWithRaw({});
        const before = updateSession(createDefaultSession(), {rerunReason: "initial"}, "full", currentState("v1"), config, noRisk(), {status: "PASS"});
        const after = updateSession(createDefaultSession(), {rerunReason: "initial"}, "full", currentState("v2"), config, noRisk(), {status: "PASS"});
        const mutated = updateSession(createDefaultSession(), {rerunReason: "initial"}, "full", currentState("v1"), config, noRisk(), {
            postRunState: currentState("v2"),
            status: "PASS",
        });

        expect(Object.keys(currentState("v1").files)).toEqual(Object.keys(currentState("v2").files));
        expect(before.lastRun.snapshotHash).not.toBe(after.lastRun.snapshotHash);
        expect(before.lastRun).toEqual(expect.objectContaining({evidenceCurrent: true, inputsMutated: false, matrixHash: hashJson(config.raw)}));
        expect(mutated.lastRun).toEqual(expect.objectContaining({
            evidenceCurrent: false,
            inputsMutated: true,
            postRunSnapshotHash: after.lastRun.snapshotHash,
            snapshotHash: before.lastRun.snapshotHash,
            status: "PASS",
        }));
        expect(mutated.lastFullPass).toBeUndefined();
    });

    it("loads a legacy version 1 session without scope metadata", () => {
        const legacy = {
            lastFullPass: {completedAt: "earlier", matrixHash: "legacy-matrix", snapshotHash: "legacy-snapshot"},
            lastRun: {completedAt: "earlier", mode: "full", rerunReason: "initial", snapshotHash: "legacy-snapshot"},
            matrixHash: "legacy-matrix",
            pendingFinalFullPass: false,
            pendingReasons: [],
            version: 1,
        };
        const session = loadSession(writeTempSession(legacy));
        const next = updateSession(session, {rerunReason: "initial", scope: "point"}, "full", currentState(), configWithRaw({}), noRisk(), {status: "PASS"});

        expect(session).toEqual(legacy);
        expect(next.lastFullPass).toEqual(legacy.lastFullPass);
        expect(next.lastRun.scope).toBe("point");
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

function currentState(contentHash = "changed-hash") {
    return {
        files: {
            "changed.txt": {
                exists: true,
                hash: contentHash,
            },
        },
    };
}

function noRisk() {
    return {changedSections: [], reasons: [], shouldRunFullFinalPass: false};
}

function writeTempSession(session) {
    const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-session-vitest-"));
    tempRoots.push(tempRoot);
    const sessionPath = path.join(tempRoot, "session.json");
    writeFileSync(sessionPath, JSON.stringify(session), "utf-8");
    return sessionPath;
}
