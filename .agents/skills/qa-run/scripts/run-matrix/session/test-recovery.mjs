import {readFileSync, statSync} from "node:fs";
import path from "node:path";

import {parseJunitTestCases} from "../parsers/codeception-junit.mjs";
import {buildScopedPlan} from "../selection/scoped-selection.mjs";
import {hashJson} from "../shared/hashing.mjs";

export function normalizeTestRetry(value) {
    if (value === void 0) {
        return void 0;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some((key) => !["runner", "report", "format"].includes(key))
        || typeof value.runner !== "string" || !value.runner.trim()
        || typeof value.report !== "string" || !value.report.trim()
        || path.isAbsolute(value.report) || value.report.split(/[\\/]/).includes("..")
        || !["codeception-junit", "vitest-json"].includes(value.format)) {
        throw new Error("testRetry requires runner, repo-relative report and format (codeception-junit or vitest-json).");
    }
    return {...value};
}

export function reportStamp(repoRoot, retry) {
    if (!retry) {
        return null;
    }
    try {
        const stat = statSync(path.resolve(repoRoot, retry.report), {bigint: true});
        return `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}`;
    } catch { return null; }
}

// Only a newly written structured report can identify the failed tests. Never infer
// executable arguments from human-readable diagnostics or reuse an old report.
export function readFailedTests(repoRoot, retry, beforeStamp) {
    try {
        const report = readFreshReport(repoRoot, retry, beforeStamp);
        if (!report) {
            return null;
        }
        let selectors;
        if (retry.format === "codeception-junit") {
            const cases = readJunitCases(report).filter((item) => item.failures.length > 0);
            const failures = [...report.matchAll(/<(?:failure|error)\b/g)].length;
            if (!failures || cases.reduce((sum, item) => sum + item.failures.length, 0) !== failures) {
                return null;
            }
            selectors = cases.map(({attrs}) => codeceptionSelector(repoRoot, attrs));
        } else {
            const data = JSON.parse(report);
            if (!Array.isArray(data.testResults) || !Number.isInteger(data.numFailedTests) || data.numFailedTests < 0) {
                return null;
            }
            const failedAssertions = data.testResults.flatMap((file) => (file.assertionResults ?? [])
                .filter((test) => test.status === "failed"));
            if (failedAssertions.length !== data.numFailedTests) {
                return null;
            }
            // Loading and hook errors can fail a file without a failed assertion.
            // Vitest's positional arguments select files, not individual names.
            selectors = data.testResults.filter((file) => file.status === "failed"
                || file.assertionResults?.some((test) => test.status === "failed"))
                .map((file) => testPath(repoRoot, file.name));
        }
        return selectors.length ? {runner: retry.runner, selectors: [...new Set(selectors)]} : null;
    } catch { return null; }
}

function readFreshReport(repoRoot, retry, beforeStamp) {
    const stamp = reportStamp(repoRoot, retry);
    if (!stamp || stamp === beforeStamp) {
        return null;
    }
    return readFileSync(path.resolve(repoRoot, retry.report), "utf8");
}

function readJunitCases(report) {
    if (!/<\/(?:testsuite|testsuites)>\s*$/.test(report.trim())) {
        throw new Error("Incomplete JUnit report");
    }
    const cases = parseJunitTestCases(report);
    if (cases.length !== [...report.matchAll(/<testcase\b/g)].length) {
        throw new Error("Unidentifiable JUnit test cases");
    }
    return cases;
}

function codeceptionSelector(repoRoot, attrs) {
    const file = testPath(repoRoot, attrs.file);
    // Dataset variants of a method share one Codeception selector.
    const method = /^(?:.*::)?([A-Za-z_][A-Za-z0-9_]*)(?:$| with data set |\s*#)/.exec(attrs.name ?? "")?.[1];
    if (!method) {
        throw new Error("Missing test method");
    }
    return `${file}:${method}`;
}

export function verifyCodeceptionRetry(repoRoot, verification, beforeStamp) {
    try {
        const report = readFreshReport(repoRoot, verification, beforeStamp);
        if (!report) {
            return false;
        }
        const cases = readJunitCases(report);
        const selected = cases.filter(({attrs}) => codeceptionSelector(repoRoot, attrs) === verification.selector);
        return selected.length > 0 && selected.every((item) => !item.skipped && item.failures.length === 0);
    } catch { return false; }
}

function testPath(repoRoot, rawFile) {
    if (typeof rawFile !== "string" || !rawFile) {
        throw new Error("Missing test path");
    }
    let file = rawFile;
    for (const prefix of ["/srv/app/", "/app/", "/workspace/"]) {
        if (file.startsWith(prefix)) {
            file = file.slice(prefix.length);
        }
    }
    const relative = path.relative(repoRoot, path.resolve(repoRoot, file)).split(path.sep).join("/");
    if (!relative || relative.startsWith("../") || path.isAbsolute(relative) || relative.startsWith("-")) {
        throw new Error("Test path outside repository");
    }
    return relative;
}

export function matrixPlan(config, activeSections) {
    return config.sectionOrder.filter((name) => activeSections[name]).flatMap((name) =>
        config.sections[name].commands.map((command) => ({section: name, commandIndex: command.sourceIndex})));
}

export function createRecoveryCheckpoint({config, plan, executed, repoRoot, binding, originReason, previous = null}) {
    const failedIndex = executed.findIndex((item) => item.status !== "PASS" && item.status !== "SKIP-CACHED");
    if (failedIndex < 0) {
        return null;
    }
    const failed = executed[failedIndex];
    const pending = plan.slice(failedIndex);
    if (failed.failedTests) {
        const check = pending[0];
        const testRetry = check.testRetry ?? config.sections[check.section]?.commands
            .find((command) => command.sourceIndex === check.commandIndex)?.testRetry;
        pending[0] = {...failed.failedTests, testRetry};
    } else if (!previous) {
        return null;
    }
    return {
        matrixHash: hashJson(config.raw), repoRoot, binding,
        originReason: previous?.originReason ?? originReason,
        reusedCommands: (previous?.reusedCommands ?? 0) + failedIndex,
        pending,
    };
}

export function buildRecoveryPlan({checkpoint, config, repoRoot, binding, resolveTool}) {
    if (!checkpoint || checkpoint.repoRoot !== repoRoot || checkpoint.binding !== binding
        || checkpoint.matrixHash !== hashJson(config.raw) || !Array.isArray(checkpoint.pending)
        || !checkpoint.pending.length) {
        throw new Error("No matching failed-test checkpoint for this repository, HEAD and matrix. No full-suite fallback was run.");
    }
    // Resolve and validate the whole queue before executing anything. Keep the
    // original order: retry failed tests first, then commands skipped by fail-fast.
    const plan = checkpoint.pending.flatMap((check) => check.runner
        ? check.selectors.map((selector) => ({...check, selectors: [selector]}))
        : [check]);
    const entries = plan.map((check) => {
        if (check.runner && !check.testRetry) {
            throw new Error("Failed-test checkpoint is missing its testRetry report binding. No unverified retry was run.");
        }
        const selectionCheck = check.runner ? {runner: check.runner, selectors: check.selectors} : check;
        const [entry] = buildScopedPlan({
            config, resolveTool, scope: "point",
            selection: {matrixHash: hashJson(config.raw), checks: [selectionCheck]},
        });
        if (check.runner && normalizeTestRetry(check.testRetry).format === "codeception-junit") {
            entry.command.testVerification = {...check.testRetry, selector: check.selectors[0]};
        }
        return entry;
    });
    return {entries, plan};
}
