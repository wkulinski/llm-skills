import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {runIssueReview} from "../../../.agents/skills/gh-issue-review/scripts/finish.mjs";

describe("gh-issue-review", () => {
    it("creates a PR with a default reviewer and falls back when --json is unsupported", () => {
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
            if (command === "gh" && args[0] === "pr" && args[1] === "create" && args.includes("--json")) {
                return {status: 1, stdout: "", stderr: "unknown flag: --json\n"};
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
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
