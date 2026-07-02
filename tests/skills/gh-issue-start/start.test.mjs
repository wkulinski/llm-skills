import {describe, expect, it} from "vitest";

import {extractSubjectKeywords, runIssueStart} from "../../../.agents/skills/gh-issue-start/scripts/start.mjs";

describe("gh-issue-start", () => {
    it("creates an issue, checkout branch, and assigns the current user", () => {
        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));

            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("nameWithOwner")) {
                return {status: 0, stdout: "acme/demo\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("defaultBranchRef")) {
                return {status: 0, stdout: "main\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "search") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "gh" && args[0] === "issue" && args[1] === "create") {
                return {status: 0, stdout: "https://github.com/acme/demo/issues/77\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "issue" && args[1] === "view" && args[2] === "77" && args.includes(".state + \"\t\" + .title")) {
                return {status: 0, stdout: "OPEN\tAdd support\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "user") {
                return {status: 0, stdout: "codex\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "issue" && args[1] === "view" && args[2] === "77" && args.includes(".assignees[].login")) {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "gh" && args[0] === "issue" && args[1] === "edit") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "git" && args[0] === "fetch") {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "git" && args[0] === "show-ref") {
                if (args[3] === "refs/remotes/origin/main") {
                    return {status: 0, stdout: "", stderr: ""};
                }
                return {status: 1, stdout: "", stderr: ""};
            }
            if (command === "git" && args[0] === "checkout") {
                return {status: 0, stdout: "", stderr: ""};
            }

            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        };

        const result = runIssueStart(["--desc", "feat: add support"], {execCommand});

        expect(result).toEqual({
            code: 0,
            stdout: "Issue #77 ready on branch issue/77-feat-add-support.\n",
        });
        expect(extractSubjectKeywords("feat: add [support] now, please")).toBe("add support now, please");
        expect(calls).toContain("gh issue create --repo acme/demo --title feat: add support --body ");
        expect(calls).toContain("git checkout -b issue/77-feat-add-support origin/main");
        expect(calls).toContain("gh issue edit 77 --add-assignee codex");
    });

    it("rejects ambiguous search results", () => {
        const execCommand = (command, args) => {
            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("nameWithOwner")) {
                return {status: 0, stdout: "acme/demo\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("defaultBranchRef")) {
                return {status: 0, stdout: "main\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "search") {
                return {status: 0, stdout: "1\tOne\n2\tTwo\n", stderr: ""};
            }
            return {status: 0, stdout: "", stderr: ""};
        };

        const result = runIssueStart(["--desc", "feat: search target"], {execCommand});

        expect(result.code).toBe(21);
        expect(result.stderr).toContain("Multiple issues match title keywords:");
    });
});
