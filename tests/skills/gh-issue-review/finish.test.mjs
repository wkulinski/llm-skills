import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {runIssueReview} from "../../../.agents/skills/gh-issue-review/scripts/finish.mjs";

describe("gh-issue-review", () => {
    it("creates a PR with a default reviewer using a lease-protected push", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "gh-issue-review-test-"));
        const reviewersFile = path.join(tempRoot, "default-reviewers.txt");
        writeFileSync(reviewersFile, "reviewer-one\n", "utf-8");

        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));

            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("nameWithOwner")) {
                return {status: 0, stdout: "acme/demo\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("defaultBranchRef")) {
                return {status: 0, stdout: "main\n", stderr: ""};
            }
            if (command === "git" && args[0] === "rev-parse") {
                return {status: 0, stdout: "issue/12-add-support\n", stderr: ""};
            }
            if (command === "git" && args[0] === "log" && args.includes("--pretty=%s")) {
                return {status: 0, stdout: "feat: add support #12\n", stderr: ""};
            }
            if (command === "git" && args[0] === "log" && args.includes("--oneline")) {
                return {status: 0, stdout: "abc123 add support\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "issue" && args[1] === "view" && args[2] === "12" && args.includes(".state + \"\t\" + .title")) {
                return {status: 0, stdout: "OPEN\tAdd support\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "user") {
                return {status: 0, stdout: "codex\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "issue" && args[1] === "view" && args[2] === "12" && args.includes(".assignees[].login")) {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "git" && args[0] === "fetch") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "git" && args[0] === "show-ref") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "git" && args[0] === "rebase") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "git" && args[0] === "push") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "gh" && args[0] === "pr" && args[1] === "view") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "gh" && args[0] === "pr" && args[1] === "create") {
                return {status: 0, stdout: "https://github.com/acme/demo/pull/88\n", stderr: ""};
            }

            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        };

        try {
            const result = runIssueReview(["--template", ""], {cwd: tempRoot, execCommand, reviewersFile});

            expect(result).toEqual({
                code: 0,
                stdout: "PR created: https://github.com/acme/demo/pull/88\n",
            });
            expect(calls.some((call) => call.startsWith("gh pr create --base main --head issue/12-add-support --title #12 Add support --body-file"))).toBe(true);
            expect(calls.some((call) => call.includes("--reviewer reviewer-one"))).toBe(true);
            expect(calls).toContain("git push --force-with-lease --set-upstream origin HEAD:refs/heads/issue/12-add-support");
            expect(calls.some((call) => call.includes("--force ") || call.endsWith("--force"))).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    function makeExec({branch = "issue/12-add-support", pushStatus = 0, createResult} = {}) {
        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));
            const ok = (stdout = "") => ({status: 0, stdout, stderr: ""});
            if (command === "gh" && args[1] === "view" && args.includes("nameWithOwner")) { return ok("acme/demo\n"); }
            if (command === "gh" && args[1] === "view" && args.includes("defaultBranchRef")) { return ok("develop\n"); }
            if (command === "git" && args[0] === "rev-parse") { return ok(`${branch}\n`); }
            if (command === "gh" && args[0] === "issue" && args.includes(".state + \"\t\" + .title")) { return ok("OPEN\tAdd support\n"); }
            if (command === "gh" && args[0] === "api") { return ok("codex\n"); }
            if (command === "git" && args[0] === "push") { return {status: pushStatus, stdout: "", stderr: "rejected (stale info)\n"}; }
            if (command === "gh" && args[0] === "pr" && args[1] === "create") {
                return createResult ?? ok("https://github.com/acme/demo/pull/9\n");
            }
            return ok();
        };
        return {calls, execCommand};
    }

    const baseOptions = {cwd: os.tmpdir(), reviewersFile: "/nonexistent"};

    it.each([
        ["develop", /base branch/],
        ["HEAD", /Detached HEAD/],
        ["feature/login", /does not match issue/],
    ])("refuses to rebase or push on branch %s", (branch, message) => {
        const {calls, execCommand} = makeExec({branch});
        const result = runIssueReview(["--reviewer", "bob"], {...baseOptions, execCommand});

        expect(result.code).toBe(14);
        expect(result.stderr).toMatch(message);
        expect(calls.some((call) => /^git (rebase|push|fetch)/.test(call))).toBe(false);
    });

    it("refuses when --issue-number disagrees with the branch", () => {
        const {calls, execCommand} = makeExec();
        const result = runIssueReview(["--reviewer", "bob", "--issue-number", "99"], {...baseOptions, execCommand});

        expect(result.code).toBe(14);
        expect(calls.some((call) => call.startsWith("git rebase"))).toBe(false);
    });

    it("does not create a PR when the push fails", () => {
        const {calls, execCommand} = makeExec({pushStatus: 1});
        const result = runIssueReview(["--reviewer", "bob", "--template", ""], {...baseOptions, execCommand});

        expect(result.code).toBe(43);
        expect(result.stderr).toContain("rejected (stale info)");
        expect(calls.some((call) => call.startsWith("gh pr create"))).toBe(false);
    });

    it("reports gh stderr when PR creation fails", () => {
        const {execCommand} = makeExec({createResult: {status: 1, stdout: "", stderr: "head branch not found on remote\n"}});
        const result = runIssueReview(["--reviewer", "bob", "--template", ""], {...baseOptions, execCommand});

        expect(result.code).toBe(41);
        expect(result.stderr).toContain("head branch not found on remote");
    });
});
