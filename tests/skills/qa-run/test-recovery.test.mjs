import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";

import {normalizeTestRetry, readFailedTests, reportStamp, verifyCodeceptionRetry} from "../../../.agents/skills/qa-run/scripts/run-matrix/session/test-recovery.mjs";

const runner = path.resolve(import.meta.dirname, "../../../.agents/skills/qa-run/scripts/run-matrix.mjs");
const roots = [];
afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, {recursive: true, force: true});
    }
});

function fixture() {
    const root = mkdtempSync(path.join(os.tmpdir(), "qa-failed-tests-"));
    roots.push(root);
    const cache = path.join(root, "var/agent/cache");
    mkdirSync(path.join(root, "bin"), {recursive: true});
    mkdirSync(cache, {recursive: true});
    writeFileSync(path.join(root, ".env"), "CACHE_PATH=var/agent/cache\n");
    writeFileSync(path.join(root, ".gitignore"), "var/\ntrace.jsonl\nreport.xml\nremaining.txt\nblocked\nlint-blocked\nreport-mode\n");
    writeFileSync(path.join(root, "source.php"), "initial");
    const script = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync('trace.jsonl', JSON.stringify(args) + '\\n');
if (args[0] === 'full') {
 fs.writeFileSync('report.xml', '<testsuite tests="3" failures="2"><testcase file="/srv/app/tests/FooCest.php" name="first"><failure message="bad"/></testcase><testcase file="/srv/app/tests/FooCest.php" name="second"><error message="bad"/></testcase><testcase file="/srv/app/tests/FooCest.php" name="passed"/></testsuite>');
 process.exit(1);
}
if (fs.existsSync('blocked') && args[0].endsWith(':second')) process.exit(1);
const mode = fs.existsSync('report-mode') ? fs.readFileSync('report-mode', 'utf8') : 'passed';
if (mode === 'stale') process.exit(0);
const [file, method] = args[0].split(':');
const name = mode === 'unrelated' ? method + 'Other' : method;
const body = mode === 'skipped' ? '<skipped/>' : '';
fs.writeFileSync('report.xml', '<testsuite><testcase file="' + file + '" name="' + name + '">' + body + '</testcase></testsuite>');
`;
    const wrapper = path.join(root, "bin", "test-wrapper");
    writeFileSync(wrapper, script); chmodSync(wrapper, 0o755);
    const section = (commands) => ({patterns: ["**/*.php"], commands, runOn: ["full", "rerun"], requiresFinalFullPass: false});
    const config = {sectionOrder: ["PHP", "TWIG"], targetedTests: {codeception: {tool: "test-wrapper", args: []}}, sections: {
        PHP: section(["node -e \"require('node:fs').appendFileSync('trace.jsonl', JSON.stringify(['lint'])+'\\n')\"", {
            cmd: "bin/test-wrapper full", testRetry: {runner: "codeception", report: "report.xml", format: "codeception-junit"},
        }]),
        TWIG: section(["node -e \"require('node:fs').writeFileSync('remaining.txt','done')\""]),
    }};
    writeFileSync(path.join(root, "matrix.json"), JSON.stringify(config));
    spawnSync("git", ["init", "-q"], {cwd: root});
    spawnSync("git", ["add", "."], {cwd: root});
    spawnSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "-qm", "fixture"], {cwd: root});
    writeFileSync(path.join(root, "source.php"), "changed");
    const session = path.join(cache, "session.json");
    return {root, config, session,
        run(reason = "initial") { return spawnSync(process.execPath, [runner, "--config", "matrix.json", "--session", session, "--rerun-reason", reason], {
            cwd: root, encoding: "utf8", env: {...process.env, BIN_PATH: path.join(root, "bin")},
        }); },
        trace() { return readFileSync(path.join(root, "trace.jsonl"), "utf8").trim().split("\n").map(JSON.parse); },
        state() { return JSON.parse(readFileSync(session, "utf8")); },
    };
}

function output(result) { return result.stdout + result.stderr; }

describe("failed test recovery", () => {
    it("retries only failed methods through the wrapper and resumes checks skipped by fail-fast", () => {
        const f = fixture();
        const initial = f.run();
        expect(initial.status, output(initial)).toBe(1);
        expect(f.state().testRecovery.pending[0].selectors).toEqual(["tests/FooCest.php:first", "tests/FooCest.php:second"]);
        writeFileSync(path.join(f.root, "source.php"), "repair");
        const retry = f.run("failed-tests");
        expect(retry.status, output(retry)).toBe(0);
        expect(f.trace()).toEqual([["lint"], ["full"], ["tests/FooCest.php:first"], ["tests/FooCest.php:second"]]);
        expect(readFileSync(path.join(f.root, "remaining.txt"), "utf8")).toBe("done");
        expect(f.state().lastCompletedQa.verification).toBe("full-with-failed-test-retry");
        expect(f.state().lastFullPass).toBeUndefined();
        expect(f.state().testRecovery).toBeNull();
        const again = f.run("failed-tests");
        expect(again.status).not.toBe(0);
        expect(f.trace()).toHaveLength(4);
    }, 120_000);

    it("keeps only unresolved tests for subsequent retries and does not run pending checks early", () => {
        const f = fixture(); f.run();
        writeFileSync(path.join(f.root, "blocked"), "1");
        const retry = f.run("failed-tests");
        expect(retry.status, output(retry)).toBe(1);
        expect(f.state().testRecovery.pending[0]).toMatchObject({runner: "codeception", selectors: ["tests/FooCest.php:second"]});
        rmSync(path.join(f.root, "blocked"));
        expect(f.run("failed-tests").status).toBe(0);
        expect(f.trace()).toEqual([["lint"], ["full"], ["tests/FooCest.php:first"], ["tests/FooCest.php:second"], ["tests/FooCest.php:second"]]);
    }, 120_000);

    it("keeps pending matrix checks when a later lint fails after test recovery", () => {
        const f = fixture();
        f.config.sections.TWIG.commands.unshift("node -e \"if(require('node:fs').existsSync('lint-blocked'))process.exit(7)\"");
        writeFileSync(path.join(f.root, "matrix.json"), JSON.stringify(f.config));
        writeFileSync(path.join(f.root, "lint-blocked"), "1");
        expect(f.run().status).toBe(1);
        expect(f.run("failed-tests").status).toBe(7);
        expect(f.state().testRecovery.pending).toEqual([
            {section: "TWIG", commandIndex: 0}, {section: "TWIG", commandIndex: 1},
        ]);
        expect(f.state().lastCompletedQa).toBeUndefined();
        expect(() => readFileSync(path.join(f.root, "remaining.txt"))).toThrow();

        rmSync(path.join(f.root, "lint-blocked"));
        const retry = f.run("failed-tests");
        expect(retry.status, output(retry)).toBe(0);
        expect(readFileSync(path.join(f.root, "remaining.txt"), "utf8")).toBe("done");
        expect(f.state().lastCompletedQa.verification).toBe("full-with-failed-test-retry");
        expect(f.state().testRecovery).toBeNull();
        expect(f.trace()).toEqual([["lint"], ["full"], ["tests/FooCest.php:first"], ["tests/FooCest.php:second"]]);
    }, 120_000);

    it.each(["skipped", "stale", "unrelated"])("retains the failed selector when Codeception exits zero with a %s report", (mode) => {
        const f = fixture();
        expect(f.run().status).toBe(1);
        writeFileSync(path.join(f.root, "report-mode"), mode);
        const retry = f.run("failed-tests");
        expect(retry.status, output(retry)).toBe(1);
        expect(f.state().lastCompletedQa).toBeUndefined();
        expect(f.state().testRecovery.pending[0].selectors).toEqual(["tests/FooCest.php:first"]);
        expect(() => readFileSync(path.join(f.root, "remaining.txt"))).toThrow();
        expect(f.trace()).toEqual([["lint"], ["full"], ["tests/FooCest.php:first"]]);

        rmSync(path.join(f.root, "report-mode"));
        const verified = f.run("failed-tests");
        expect(verified.status, output(verified)).toBe(0);
        expect(f.state().lastCompletedQa.verification).toBe("full-with-failed-test-retry");
        expect(readFileSync(path.join(f.root, "remaining.txt"), "utf8")).toBe("done");
    }, 120_000);

    it("finishes a failed final pass by retry without requiring another full pass", () => {
        const f = fixture();
        writeFileSync(f.session, JSON.stringify({version: 1, pendingFinalFullPass: true, pendingReasons: ["dependency-repair"]}));
        expect(f.run("full-final-pass").status).toBe(1);
        expect(f.state().testRecovery.originReason).toBe("full-final-pass");
        expect(f.run("failed-tests").status).toBe(0);
        expect(f.state().pendingFinalFullPass).toBe(false);
        expect(f.state().lastFullPass).toBeUndefined();
    }, 120_000);

    it("does not mint current completion when a retry mutates its inputs", () => {
        const f = fixture(); f.run();
        const wrapper = path.join(f.root, "bin/test-wrapper");
        writeFileSync(wrapper, readFileSync(wrapper, "utf8") + "\nfs.writeFileSync('source.php', String(Date.now()));\n");
        const result = f.run("failed-tests");
        expect(result.status, output(result)).toBe(0);
        expect(f.state().lastRun.evidenceCurrent).toBe(false);
        expect(f.state().lastCompletedQa).toBeUndefined();
    }, 120_000);

    it("rejects a different HEAD without rerunning the suite", () => {
        const f = fixture(); f.run();
        spawnSync("git", ["-c", "user.name=QA", "-c", "user.email=qa@example.test", "commit", "--allow-empty", "-qm", "another head"], {cwd: f.root});
        expect(f.run("failed-tests").status).not.toBe(0);
        expect(f.trace()).toEqual([["lint"], ["full"]]);
    }, 120_000);

    it("rejects restarting a full initial run while failed tests have a checkpoint", () => {
        const f = fixture(); f.run();
        const result = f.run();
        expect(result.status).not.toBe(0);
        expect(output(result)).toContain("Use --rerun-reason failed-tests");
        expect(f.trace()).toEqual([["lint"], ["full"]]);
    }, 120_000);

    it("rejects changed matrices before executing any retry", () => {
        const f = fixture(); f.run();
        f.config.targetedTests.codeception.args.push("changed");
        writeFileSync(path.join(f.root, "matrix.json"), JSON.stringify(f.config));
        const result = f.run("failed-tests");
        expect(result.status).not.toBe(0);
        expect(output(result)).toContain("No matching failed-test checkpoint");
        expect(f.trace()).toEqual([["lint"], ["full"]]);
    }, 120_000);

    it("does not treat a lint failure as a failed-test checkpoint", () => {
        const f = fixture(); f.config.sections.PHP.commands[0] = "exit 7";
        writeFileSync(path.join(f.root, "matrix.json"), JSON.stringify(f.config));
        expect(f.run().status).toBe(7);
        expect(f.state().testRecovery).toBeNull();
        expect(f.run("failed-tests").status).not.toBe(0);
    }, 120_000);

    it("rejects invalid report configuration", () => {
        expect(() => normalizeTestRetry({runner: "x", report: "../secret.xml", format: "codeception-junit"})).toThrow();
        expect(() => normalizeTestRetry({runner: "x", report: "report.xml", format: "unknown"})).toThrow();
    }, 120_000);

    it("refuses stale, incomplete and unidentifiable reports", () => {
        const f = fixture();
        const retry = {runner: "codeception", report: "report.xml", format: "codeception-junit"};
        const report = path.join(f.root, "report.xml");
        writeFileSync(report, '<testsuite><testcase file="tests/A.php" name="first"><failure/></testcase></testsuite>');
        expect(readFailedTests(f.root, retry, reportStamp(f.root, retry))).toBeNull();
        writeFileSync(report, '<testsuite><testcase name="first"><failure/></testcase></testsuite>');
        expect(readFailedTests(f.root, retry, null)).toBeNull();
        writeFileSync(report, '<testsuite><testcase file="tests/A.php" name="first"><failure/></testcase>');
        expect(readFailedTests(f.root, retry, null)).toBeNull();
    }, 120_000);

    it("verifies all Codeception dataset variants and accepts self-closing passing cases", () => {
        const f = fixture();
        const verification = {report: "report.xml", selector: "tests/A.php:first"};
        const report = path.join(f.root, verification.report);
        const passed = '<testcase file="/srv/app/tests/A.php" name="first with data set #0"/>';
        writeFileSync(report, `<testsuite>${passed}<testcase file="tests/A.php" name="first with data set #1"/></testsuite>`);
        expect(verifyCodeceptionRetry(f.root, verification, null)).toBe(true);
        expect(verifyCodeceptionRetry(f.root, verification, reportStamp(f.root, verification))).toBe(false);
        writeFileSync(report, `<testsuite>${passed}<testcase file="tests/A.php" name="first with data set #1"><skipped/></testcase></testsuite>`);
        expect(verifyCodeceptionRetry(f.root, verification, null)).toBe(false);
        writeFileSync(report, `<testsuite>${passed}<testcase file="tests/A.php" name="first with data set #1"><failure/></testcase></testsuite>`);
        expect(verifyCodeceptionRetry(f.root, verification, null)).toBe(false);
        rmSync(report);
        expect(verifyCodeceptionRetry(f.root, verification, null)).toBe(false);
    }, 120_000);

    it("maps vitest failures to distinct failed files and excludes passing files", () => {
        const f = fixture();
        const retry = {runner: "unit", report: "report.json", format: "vitest-json"};
        writeFileSync(path.join(f.root, retry.report), JSON.stringify({numFailedTests: 2, testResults: [
            {name: path.join(f.root, "tests/a.test.mjs"), assertionResults: [{status: "failed"}, {status: "failed"}]},
            {name: path.join(f.root, "tests/b.test.mjs"), assertionResults: [{status: "passed"}]},
        ]}));
        expect(readFailedTests(f.root, retry, null)).toEqual({runner: "unit", selectors: ["tests/a.test.mjs"]});
    }, 120_000);

    it("includes load and hook failures from a real Vitest report, even without failed assertions", () => {
        const f = fixture();
        const vitest = fileURLToPath(new URL("../../../node_modules/vitest/vitest.mjs", import.meta.url));
        const imports = `import {it, expect, beforeAll} from ${JSON.stringify(import.meta.resolve("vitest"))};\n`;
        writeFileSync(path.join(f.root, "vitest.config.mjs"), "export default {test: {fileParallelism: false}};\n");
        writeFileSync(path.join(f.root, "assertion.test.mjs"), imports + "it('fails', () => expect(1).toBe(2));\n");
        writeFileSync(path.join(f.root, "load.test.mjs"), "throw new Error('suite loading failed');\n");
        writeFileSync(path.join(f.root, "hook.test.mjs"), imports + "beforeAll(() => {throw new Error('setup failed');}); it('blocked by setup', () => {});\n");
        writeFileSync(path.join(f.root, "passing.test.mjs"), imports + "it('passes', () => expect(true).toBe(true));\n");
        const report = {runner: "unit", report: "report.json", format: "vitest-json"};
        const result = spawnSync(process.execPath, [vitest, "run", "--root", f.root, "--config", path.join(f.root, "vitest.config.mjs"),
            "--reporter=json", "--outputFile=report.json"], {cwd: f.root, encoding: "utf8"});
        expect(result.status, output(result)).toBe(1);
        expect(readFailedTests(f.root, report, null)?.selectors.sort()).toEqual(["assertion.test.mjs", "hook.test.mjs", "load.test.mjs"]);

        rmSync(path.join(f.root, "assertion.test.mjs"));
        const suitesOnly = spawnSync(process.execPath, [vitest, "run", "--root", f.root, "--config", path.join(f.root, "vitest.config.mjs"),
            "--reporter=json", "--outputFile=report.json"], {cwd: f.root, encoding: "utf8"});
        expect(suitesOnly.status, output(suitesOnly)).toBe(1);
        expect(readFailedTests(f.root, report, null)?.selectors.sort()).toEqual(["hook.test.mjs", "load.test.mjs"]);
    }, 120_000);
});
