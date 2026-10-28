import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {afterEach, describe, expect, it} from "vitest";

import {hashJson} from "../../../.agents/skills/qa-run/scripts/run-matrix/shared/hashing.mjs";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const runnerPath = path.join(repoRoot, ".agents/skills/qa-run/scripts/run-matrix.mjs");
const tempRoots = [];

afterEach(() => {
    while (tempRoots.length > 0) {
        rmSync(tempRoots.pop(), {force: true, recursive: true});
    }
});

describe("run-matrix scoped execution", () => {
    it("passes point selectors to the resolved tool as literal arguments without a shell", () => {
        const fixture = createFixture();
        const shellText = `$(touch ${fixture.pwnedPath}); echo \`id\` | cat > ${fixture.pwnedPath}`;
        const result = fixture.run("point", [
            {runner: "unit", selectors: ["tests/with space.test.mjs", shellText]},
        ]);

        expect(result.status, output(result)).toBe(0);
        expect(fixture.trace()).toEqual([
            {args: ["run-unit", "--", "tests/with space.test.mjs", shellText], tool: "fake-test"},
        ]);
        expect(existsSync(fixture.pwnedPath)).toBe(false);

        const summary = fixture.readSummary(result);
        expect(summary.scope).toBe("point");
        expect(summary.status).toBe("PASS");
        expect(summary.commands).toHaveLength(1);
        expect(summary.commands[0].section).toBe("targeted:unit");
    });

    it("runs only selected checks in matrix order, then tests in selection order", () => {
        const fixture = createFixture();
        const result = fixture.run("partial", [
            {runner: "unit", selectors: ["second.test.mjs"]},
            {commandIndex: 1, section: "LATE"},
            {runner: "unit", selectors: ["first.test.mjs"]},
            {commandIndex: 0, section: "EARLY"},
        ]);

        expect(result.status, output(result)).toBe(0);
        expect(fixture.trace()).toEqual([
            {label: "early-0"},
            {label: "late-1"},
            {args: ["run-unit", "--", "second.test.mjs"], tool: "fake-test"},
            {args: ["run-unit", "--", "first.test.mjs"], tool: "fake-test"},
        ]);
        expect(fixture.readSummary(result).scope).toBe("partial");
    });

    it("stops a partial run on the first failing check and returns its exit code", () => {
        const fixture = createFixture();
        const result = fixture.run("partial", [
            {commandIndex: 1, section: "LATE"},
            {commandIndex: 0, section: "FAILING"},
        ]);

        expect(result.status, output(result)).toBe(7);
        expect(fixture.trace()).toEqual([{label: "failing"}]);
        expect(fixture.readSummary(result).status).toBe("FAIL");
    });

    it.each([
        ["an unknown scope", (fixture) => fixture.runRaw(["--scope", "everything", "--selection", fixture.writeSelection([])])],
        ["a full scope with selection", (fixture) => fixture.runRaw(["--scope", "full", "--selection", fixture.writeSelection([{commandIndex: 0, section: "EARLY"}])])],
        ["a scoped run without selection", (fixture) => fixture.runRaw(["--scope", "point"])],
        ["a scoped full final pass", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}], {extraArgs: ["--rerun-reason", "full-final-pass"]})],
        ["an empty selection", (fixture) => fixture.run("partial", [])],
        ["point with two checks", (fixture) => fixture.run("point", [{commandIndex: 0, section: "EARLY"}, {commandIndex: 1, section: "LATE"}])],
        ["a stale matrix hash", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}], {matrixHash: "stale"})],
        ["a missing command index", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}, {commandIndex: 5, section: "LATE"}])],
        ["an empty command slot", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}, {commandIndex: 0, section: "LATE"}])],
        ["an empty selectors list", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}, {runner: "unit", selectors: []}])],
        ["an unconfigured runner", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}, {runner: "e2e", selectors: ["a"]}])],
        ["an unresolvable tool", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}, {runner: "missing", selectors: ["a"]}])],
        ["a duplicate check", (fixture) => fixture.run("partial", [{commandIndex: 0, section: "EARLY"}, {commandIndex: 0, section: "EARLY"}])],
        ["a selection outside CACHE_PATH", (fixture) => fixture.run("point", [{commandIndex: 0, section: "EARLY"}], {outsideCache: true})],
    ])("rejects %s before running any check", (_name, invoke) => {
        const fixture = createFixture();
        const result = invoke(fixture);

        expect(result.status, output(result)).not.toBe(0);
        expect(result.stderr).toContain("ERROR:");
        expect(fixture.trace()).toEqual([]);
    });

    it("records scoped runs in the session without replacing the earlier full pass", () => {
        const fixture = createFixture();
        const sessionPath = path.join(fixture.cacheRoot, "session.json");
        const full = fixture.runRaw(["--session", sessionPath]);
        expect(full.status, output(full)).toBe(0);
        const fullSession = readJson(sessionPath);
        expect(fullSession.lastFullPass).toBeDefined();

        const partial = fixture.run("partial", [{commandIndex: 0, section: "EARLY"}], {extraArgs: ["--session", sessionPath]});
        expect(partial.status, output(partial)).toBe(0);
        const partialSession = readJson(sessionPath);
        expect(partialSession.lastFullPass).toEqual(fullSession.lastFullPass);
        expect(partialSession.lastRun).toEqual(expect.objectContaining({
            evidenceCurrent: true,
            scope: "partial",
            selection: [{commandIndex: 0, kind: "matrix", section: "EARLY"}],
            status: "PASS",
        }));
        expect(fixture.readSummary(partial).selection).toEqual(partialSession.lastRun.selection);

        const failing = fixture.run("point", [{commandIndex: 0, section: "FAILING"}], {extraArgs: ["--session", sessionPath]});
        expect(failing.status, output(failing)).toBe(7);
        const failedSession = readJson(sessionPath);
        expect(failedSession.lastFullPass).toEqual(fullSession.lastFullPass);
        expect(failedSession.lastRun).toEqual(expect.objectContaining({scope: "point", status: "FAIL"}));
        expect(fixture.trace().map((entry) => entry.label)).toEqual(["always-full", "early-0", "late-1", "early-0", "failing"]);
    });

    it("marks evidence stale when a check mutates the working tree during a full run", () => {
        const fixture = createFixture({mutateDuringEarly: true});
        const sessionPath = path.join(fixture.cacheRoot, "session.json");
        const result = fixture.runRaw(["--session", sessionPath]);

        expect(result.status, output(result)).toBe(0);
        expect(result.stderr).toContain("WARN: working tree changed during QA");
        const summary = fixture.readSummary(result);
        expect(summary.status).toBe("PASS");
        expect(summary.evidence).toEqual(expect.objectContaining({current: false, inputsMutated: true}));
        expect(summary.evidence.inputSnapshotHash).not.toBe(summary.evidence.postRunSnapshotHash);
        expect(readJson(sessionPath).lastFullPass).toBeUndefined();
    });

    it("prints a short failure with exit code and scope note without full commands", () => {
        const fixture = createFixture();
        const result = fixture.run("point", [{commandIndex: 0, section: "FAILING"}]);

        expect(result.status).toBe(7);
        expect(result.stderr).toContain("FAIL [FAILING] #0 exit=7");
        expect(result.stderr).toMatch(/QA: FAIL scope=point evidence=current commands=1 /);
        expect(result.stderr).toContain("NOTE: scope=point is not full QA.");
        expect(output(result)).not.toContain("node -e");
        expect(output(result)).not.toContain("RUN [");
        const summaryText = readFileSync(path.join(path.dirname(fixture.summaryPath(result)), "summary.txt"), "utf-8");
        expect(summaryText).toContain("Scope: point (not full QA)");
        expect(summaryText).toContain("- [FAILING] #0 exit=7");
    });

    it("fails with a non-zero exit when the summary cannot be written", () => {
        const breakSummary = [
            "const fs = require('node:fs'); const path = require('node:path')",
            "const root = path.join(process.env.CACHE_PATH, 'qa-run')",
            "for (const dir of fs.readdirSync(root)) fs.mkdirSync(path.join(root, dir, 'summary.json'), {recursive: true})",
        ].join("; ");
        const fixture = createFixture({extraSections: {BREAK_SUMMARY: section([`node -e ${JSON.stringify(breakSummary)}`], ["rerun"])}});
        const result = fixture.run("point", [{commandIndex: 0, section: "BREAK_SUMMARY"}]);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("ERROR: QA PASS result could not be persisted");
        expect(result.stdout).not.toContain("QA: PASS");
    });

    it("hides a suspected secret in a selector from the console", () => {
        const fixture = createFixture();
        const secret = ["gh", "p_"].join("") + "Zx9Qw8Er7Ty6Ui5Op4As3Df2Gh1Jk0LmNbVcXz";
        const result = fixture.run("point", [{runner: "unit", selectors: [`--token=${secret}`]}]);

        expect(result.status, output(result)).toBe(0);
        expect(result.stdout).toContain("PASS [targeted:unit] <label omitted: possible secret>");
        expect(output(result)).not.toContain(secret);
        expect(fixture.trace()[0].args).toContain(`--token=${secret}`);
    });

    it("recovers current evidence after a stale full pass with a delta from the pre-run snapshot", () => {
        const fixture = createFixture({mutateDuringEarly: true});
        const sessionPath = path.join(fixture.cacheRoot, "session.json");
        const snapshotPath = path.join(fixture.cacheRoot, "before-initial.json");
        const initial = fixture.runRaw(["--session", sessionPath, "--snapshot-write", snapshotPath]);
        expect(fixture.readSummary(initial).evidence.current).toBe(false);

        const delta = fixture.runRaw(["--session", sessionPath, "--rerun-reason", "post-fix-delta", "--delta-from-snapshot", snapshotPath]);

        expect(delta.status, output(delta)).toBe(0);
        expect(fixture.readSummary(delta).evidence.current).toBe(true);
        expect(readJson(sessionPath).lastRun).toEqual(expect.objectContaining({evidenceCurrent: true, mode: "delta", scope: "full"}));
        expect(readJson(sessionPath).lastFullPass).toBeUndefined();
    });

    it("rejects targeted tests when the matrix does not configure them", () => {
        const fixture = createFixture({targetedTests: false});
        const result = fixture.run("point", [{runner: "unit", selectors: ["a.test.mjs"]}]);

        expect(result.status).toBe(2);
        expect(result.stderr).toContain("not configured in targetedTests");
        expect(fixture.trace()).toEqual([]);
    });

    it("keeps the default full run unchanged for a matrix without targeted tests", () => {
        const fixture = createFixture({targetedTests: false});
        const result = fixture.runRaw([]);

        expect(result.status, output(result)).toBe(0);
        expect(fixture.trace().map((entry) => entry.label)).toEqual(["always-full", "early-0", "late-1"]);
        expect(fixture.readSummary(result).scope).toBe("full");
    });
});

function createFixture({extraSections = {}, mutateDuringEarly = false, targetedTests = true} = {}) {
    const root = mkdtempSync(path.join(os.tmpdir(), "qa-run-scoped-"));
    tempRoots.push(root);
    const workRepo = path.join(root, "repo");
    const cacheRoot = path.join(root, "cache");
    const tracePath = path.join(root, "trace.jsonl");
    const pwnedPath = path.join(root, "pwned");
    mkdirSync(path.join(workRepo, "bin"), {recursive: true});
    mkdirSync(cacheRoot, {recursive: true});
    spawnSync("git", ["init", "-q"], {cwd: workRepo});

    const toolPath = path.join(workRepo, "bin", "fake-test");
    writeFileSync(toolPath, [
        "#!/usr/bin/env node",
        "require('node:fs').appendFileSync(process.env.QA_TRACE, JSON.stringify({tool: 'fake-test', args: process.argv.slice(2)}) + '\\n');",
        "",
    ].join("\n"));
    chmodSync(toolPath, 0o755);

    const config = {
        sectionOrder: ["ALWAYS_FULL", "ALWAYS_ON_RERUN", "EARLY", "FAILING", "LATE"],
        sections: {
            ALWAYS_FULL: section([traceCommand("always-full")], ["full"]),
            ALWAYS_ON_RERUN: section([traceCommand("always-on-rerun")], ["rerun"]),
            EARLY: section([
                mutateDuringEarly
                    ? `${traceCommand("early-0")} && echo changed > bin/generated.txt`
                    : traceCommand("early-0"),
            ], ["full"], ["bin/**"]),
            LATE: section(["", traceCommand("late-1")], ["full"], ["bin/**"]),
            // Never activated by an initial run: only an explicit selection runs it.
            FAILING: section([`${traceCommand("failing")} && exit 7`], ["rerun"]),
            ...extraSections,
        },
    };
    config.sectionOrder.push(...Object.keys(extraSections));
    if (targetedTests) {
        config.targetedTests = {
            missing: {args: [], tool: "qa-run-missing-tool-for-test"},
            unit: {args: ["run-unit", "--"], tool: "fake-test"},
        };
    }
    const configPath = path.join(root, "matrix.json");
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

    const runRaw = (args) => spawnSync("node", [runnerPath, "--config", configPath, ...args], {
        cwd: workRepo,
        encoding: "utf-8",
        env: {
            ...process.env,
            BIN_PATH: "bin",
            CACHE_PATH: cacheRoot,
            QA_TRACE: tracePath,
        },
    });
    const writeSelection = (checks, {matrixHash = hashJson(config), outsideCache = false} = {}) => {
        const selectionPath = path.join(outsideCache ? root : cacheRoot, "selection.json");
        writeFileSync(selectionPath, JSON.stringify({checks, matrixHash}));
        return selectionPath;
    };

    return {
        cacheRoot,
        pwnedPath,
        readSummary(result) {
            return JSON.parse(readFileSync(this.summaryPath(result), "utf-8"));
        },
        summaryPath(result) {
            const match = output(result).match(/INFO: QA summary written: (.+)$/m);
            expect(match, output(result)).not.toBeNull();
            return path.resolve(workRepo, match[1]);
        },
        run(scope, checks, {extraArgs = [], ...selectionOptions} = {}) {
            return runRaw(["--scope", scope, "--selection", writeSelection(checks, selectionOptions), ...extraArgs]);
        },
        runRaw,
        trace() {
            if (!existsSync(tracePath)) {
                return [];
            }
            return readFileSync(tracePath, "utf-8").trim().split("\n").map((line) => JSON.parse(line));
        },
        writeSelection,
    };
}

function section(commands, runOn, patterns = []) {
    return {commands, patterns, requiresFinalFullPass: false, runOn};
}

function traceCommand(label) {
    const script = `require('node:fs').appendFileSync(process.env.QA_TRACE, JSON.stringify({label: ${JSON.stringify(label)}}) + '\\n')`;
    return `node -e ${JSON.stringify(script)}`;
}

function readJson(jsonPath) {
    return JSON.parse(readFileSync(jsonPath, "utf-8"));
}

function output(result) {
    return `${result.stdout}\n${result.stderr}`;
}
