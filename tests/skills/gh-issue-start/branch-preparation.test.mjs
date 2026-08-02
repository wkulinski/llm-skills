import {describe, expect, it} from "vitest";

import {
    applyDirtyTreeStrategy,
    DIRTY_TREE_STRATEGIES,
    normalizeDirtyTreeStrategy,
    promptDirtyTreeStrategy,
} from "../../../.agents/skills/gh-issue-start/scripts/branch-preparation.mjs";

describe("branch preparation helpers", () => {
    it("normalizes only supported dirty tree strategies", () => {
        expect(normalizeDirtyTreeStrategy("move-to-new-branch")).toBe("move-to-new-branch");
        expect(normalizeDirtyTreeStrategy("unknown")).toBe("");
    });

    it("supports arrow-key selection in an interactive terminal", () => {
        const inputBytes = [0x1b, 0x5b, 0x42, 0x0d];
        const output = {isTTY: true, write: (...args) => args.length};
        const input = {
            fd: 0,
            isRaw: false,
            isTTY: true,
            resume: (...args) => args.length,
            setRawMode: (...args) => args.length,
        };
        const read = (_fd, buffer, offset) => {
            buffer[offset] = inputBytes.shift();
            return 1;
        };

        const result = promptDirtyTreeStrategy({input, output, read});

        expect(DIRTY_TREE_STRATEGIES).toHaveLength(4);
        expect(result).toEqual({code: 0, strategy: "commit-wip"});
    });

    it("requires an explicit strategy outside a TTY", () => {
        const result = promptDirtyTreeStrategy({
            input: {isTTY: false},
            output: {isTTY: false},
        });

        expect(result.code).toBe(14);
        expect(result.stderr).toContain("--dirty-strategy");
    });

    it("commits WIP changes before switching to the issue branch", () => {
        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));
            if (command === "git" && args[0] === "show-ref") { return {status: 1, stdout: "", stderr: ""}; }
            if (command === "git" && args[0] === "checkout") { return {status: 0, stdout: "", stderr: ""}; }
            if (command === "git" && args[0] === "branch") { return {status: 0, stdout: "issue/12-target\n", stderr: ""}; }
            return {status: 0, stdout: "", stderr: ""};
        };

        const result = applyDirtyTreeStrategy({
            baseRef: "origin/main",
            branchName: "issue/12-target",
            execCommand,
            issueNumber: "12",
            remote: "origin",
            strategy: "commit-wip",
        });

        expect(result.code).toBe(0);
        expect(calls).toContain("git add -A");
        expect(calls).toContain("git commit -m wip: preserve changes before issue #12");
    });

    it("applies and drops the temporary stash when moving changes", () => {
        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));
            if (command === "git" && args[0] === "show-ref") { return {status: 1, stdout: "", stderr: ""}; }
            if (command === "git" && args[0] === "checkout") { return {status: 0, stdout: "", stderr: ""}; }
            if (command === "git" && args[0] === "branch") { return {status: 0, stdout: "issue/12-target\n", stderr: ""}; }
            return {status: 0, stdout: "", stderr: ""};
        };

        const result = applyDirtyTreeStrategy({
            baseRef: "origin/main",
            branchName: "issue/12-target",
            execCommand,
            issueNumber: "12",
            remote: "origin",
            strategy: "move-to-new-branch",
        });

        expect(result.code).toBe(0);
        expect(calls).toContain("git stash apply");
        expect(calls).toContain("git stash drop");
    });
});
