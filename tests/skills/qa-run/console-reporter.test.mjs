import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {
    printCommandResult,
    printRunResult,
} from "../../../.agents/skills/qa-run/scripts/run-matrix/reporting/console-reporter.mjs";

let logSpy;
let errorSpy;

beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => null);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => null);
});

afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
});

describe("run-matrix console reporter", () => {
    it("keeps ERROR status and log locations visible in silent mode", () => {
        printCommandResult({
            durationMs: 0,
            error: "spawn /missing ENOENT",
            exitCode: 1,
            label: "a.test.mjs",
            section: "targeted:unit",
            status: "ERROR",
            stderrLog: "var/run/001.stderr.log",
            stdoutLog: "var/run/001.stdout.log",
            summary: ["hidden detail"],
        }, {outputMode: "silent"});

        const text = errorSpy.mock.calls.flat().join("\n");
        expect(text).toContain("ERROR [targeted:unit] a.test.mjs exit=1");
        expect(text).toContain("Logs: stdout=var/run/001.stdout.log stderr=var/run/001.stderr.log");
        expect(text).not.toContain("hidden detail");
    });

    it("prints one pass line with scope, evidence and artifacts, plus a note for limited scopes", () => {
        printRunResult({
            commands: [{durationMs: 1200, status: "PASS"}, {durationMs: 0, status: "SKIP-CACHED"}],
            evidence: {current: true},
            failures: [],
            scope: "partial",
            status: "PASS",
        }, {relativeDir: "var/agent/cache/qa-run/run-id"});

        expect(logSpy.mock.calls.flat()).toEqual([
            "QA: PASS scope=partial evidence=current commands=2 cached=1 duration=1.2s artifacts=var/agent/cache/qa-run/run-id",
            "NOTE: scope=partial is not full QA.",
        ]);
        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("reports stale evidence and failures on stderr", () => {
        printRunResult({
            commands: [{durationMs: 10, exitCode: 7, label: "#0", section: "PHP", status: "FAIL"}],
            evidence: {current: false},
            failures: [{exitCode: 7, label: "#0", section: "PHP"}],
            scope: "full",
            status: "FAIL",
        }, {relativeDir: "artifacts"});

        expect(errorSpy.mock.calls.flat()).toEqual([
            "QA: FAIL scope=full evidence=stale commands=1 cached=0 duration=0.0s artifacts=artifacts",
            "Failed: [PHP] #0 exit=7",
        ]);
    });
});
