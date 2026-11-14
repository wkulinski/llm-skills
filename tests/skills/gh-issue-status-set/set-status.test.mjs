import {chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

import {runIssueStatusSet} from "../../../.agents/skills/gh-issue-status-set/scripts/set-status.mjs";

const SET_STATUS_SCRIPT = fileURLToPath(new URL("../../../.agents/skills/gh-issue-status-set/scripts/set-status.mjs", import.meta.url));

describe("gh-issue-status-set", () => {
    it("updates the project status with the legacy item-edit path", () => {
        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));

            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("nameWithOwner")) {
                return {status: 0, stdout: "acme/demo\n", stderr: ""};
            }
            if (command === "git" && args[0] === "rev-parse") {
                return {status: 0, stdout: "issue/123-demo\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "graphql" && args.some((arg) => String(arg).includes("projectItems"))) {
                return {status: 0, stdout: "item-1\tProject Alpha\t7\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "item-edit" && args[2] === "--help") {
                return {status: 0, stdout: "Usage: gh project item-edit\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "field-list") {
                return {status: 0, stdout: JSON.stringify({fields: [{name: "Status", options: [{name: "In review"}]}]}), stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "item-edit") {
                return {status: 0, stdout: "", stderr: ""};
            }

            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        };

        const result = runIssueStatusSet(["--status", "In review"], {execCommand});

        expect(result).toEqual({
            code: 0,
            stdout: "Status 'In review' ustawiony dla issue #123 w projekcie acme/7 (element item-1).\n",
        });
        expect(calls.some((call) => call.includes("\\(.project.number)"))).toBe(true);
        expect(calls).toContain("gh project item-edit --project acme/7 --id item-1 --field Status --single-select-option In review");
    });

    it("maps semantic status names to a localized project option", () => {
        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));
            if (command === "gh" && args[0] === "repo" && args[1] === "view") {
                return {status: 0, stdout: "acme/demo\n", stderr: ""};
            }
            if (command === "git" && args[0] === "rev-parse") {
                return {status: 0, stdout: "issue/123-demo\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "graphql" && args.some((arg) => String(arg).includes("projectItems"))) {
                return {status: 0, stdout: "item-1\tProject Alpha\t7\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "item-edit" && args[2] === "--help") {
                return {status: 0, stdout: "Usage: gh project item-edit\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "field-list") {
                return {status: 0, stdout: JSON.stringify({fields: [{name: "Status", options: [{name: "W trakcie"}]}]}), stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "item-edit") {
                return {status: 0, stdout: "", stderr: ""};
            }

            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        };

        const result = runIssueStatusSet(["--status", "In progress"], {execCommand});

        expect(result.code).toBe(0);
        expect(calls).toContain("gh project item-edit --project acme/7 --id item-1 --field Status --single-select-option W trakcie");
    });

    it("adds an issue to a project and uses the id-based item editor", () => {
        const calls = [];
        const execCommand = (command, args) => {
            calls.push([command, ...args].join(" "));

            if (command === "gh" && args[0] === "repo" && args[1] === "view" && args.includes("nameWithOwner")) {
                return {status: 0, stdout: "acme/demo\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "graphql" && args.some((arg) => String(arg).includes("projectItems"))) {
                return {status: 0, stdout: "", stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "item-add") {
                return {status: 0, stdout: "item-9\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "item-edit" && args[2] === "--help") {
                return {status: 0, stdout: "Usage: gh project item-edit --project-id\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "users/acme") {
                return {status: 0, stdout: "Organization\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "graphql" && args.some((arg) => String(arg).includes("projectV2"))) {
                if (String(args[args.length - 1]).includes(".data.organization.projectV2.id")) {
                    return {status: 0, stdout: "project-1\n", stderr: ""};
                }
                if (String(args[args.length - 1]).includes('select(.name=="Status")') && String(args[args.length - 1]).includes(".options")) {
                    return {status: 0, stdout: "option-1\n", stderr: ""};
                }
                return {status: 0, stdout: "field-1\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "project" && args[1] === "item-edit" && args[2] === "--project-id") {
                return {status: 0, stdout: "", stderr: ""};
            }

            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        };

        const result = runIssueStatusSet(["--status", "Ready", "--issue", "45", "--project-number", "9"], {execCommand});

        expect(result).toEqual({
            code: 0,
            stdout: "Status 'Ready' ustawiony dla issue #45 w projekcie acme/9 (element item-9).\n",
        });
        expect(calls).toContain("gh project item-add 9 --owner acme --url https://github.com/acme/demo/issues/45 --format json -q .id");
        expect(calls).toContain("gh project item-edit --project-id project-1 --id item-9 --field-id field-1 --single-select-option-id option-1");
    });

    it("rejects malformed project numbers instead of invoking another project", () => {
        const execCommand = (command, args) => {
            if (command === "gh" && args[0] === "repo" && args[1] === "view") {
                return {status: 0, stdout: "acme/demo\n", stderr: ""};
            }
            if (command === "git" && args[0] === "rev-parse") {
                return {status: 0, stdout: "issue/123-demo\n", stderr: ""};
            }
            if (command === "gh" && args[0] === "api" && args[1] === "graphql") {
                return {status: 0, stdout: "item-1\tProject Alpha\t(.project.number)\n", stderr: ""};
            }

            throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
        };

        const result = runIssueStatusSet(["--status", "In progress"], {execCommand});

        expect(result.code).toBe(7);
        expect(result.stderr).toContain("Nieprawidłowy numer projektu");
    });

    it("runs gh outside a repository when owner, repo and issue are explicit", () => {
        const outside = realpathSync(mkdtempSync(path.join(os.tmpdir(), "set-status-outside-")));
        try {
            const binDirectory = path.join(outside, "bin");
            const logFile = path.join(outside, "gh.log");
            const workDirectory = path.join(outside, "work");
            mkdirSync(binDirectory);
            mkdirSync(workDirectory);
            writeFileSync(path.join(binDirectory, "gh"), `#!/usr/bin/env bash\nprintf '%s %s\\n' "$PWD" "$1" >> ${JSON.stringify(logFile)}\n`, "utf8");
            chmodSync(path.join(binDirectory, "gh"), 0o755);

            const result = spawnSync(process.execPath, [
                SET_STATUS_SCRIPT, "--status", "In review", "--issue", "12", "--owner", "acme", "--repo", "demo",
            ], {
                cwd: workDirectory,
                encoding: "utf8",
                env: {...process.env, PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`},
            });

            expect(result.status, result.stderr).toBe(4);
            expect(result.stderr).toContain("nie jest w żadnym ProjectV2");
            expect(readFileSync(logFile, "utf8")).toBe(`${workDirectory} api\n`);
        } finally {
            rmSync(outside, {force: true, recursive: true});
        }
    });
});
