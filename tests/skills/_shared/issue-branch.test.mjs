import {describe, expect, it} from "vitest";

import {
    makeIssueBranch,
    parseIssueBranch,
    runIssueBranchCli,
    slugifyIssueBranchTitle,
} from "../../../.agents/skills/_shared/scripts/issue-branch.mjs";

describe("issue-branch", () => {
    it("slugifies branch titles and makes branch names", () => {
        expect(slugifyIssueBranchTitle("Zażółć gęślą jaźń!")).toBe("zazolc-gesla-jazn");
        expect(makeIssueBranch("12", "Zażółć gęślą jaźń!")).toBe("issue/12-zazolc-gesla-jazn");
    });

    it("parses issue numbers from branch names and git fallback", () => {
        expect(parseIssueBranch("refs/heads/issue/123-title")).toBe("123");
        expect(parseIssueBranch("issue-456-title")).toBe("456");

        const execCommand = (command, args, options) => {
            expect(command).toBe("git");
            expect(args).toEqual(["rev-parse", "--abbrev-ref", "HEAD"]);
            expect(options).toEqual({encoding: "utf-8"});
            return "issue/789-title\n";
        };

        expect(parseIssueBranch("", {execCommand})).toBe("789");
    });

    it("renders CLI output", () => {
        expect(runIssueBranchCli(["slugify", "Zażółć", "gęślą"])).toBe("zazolc-gesla\n");
        expect(runIssueBranchCli(["make", "--issue", "42", "--title", "Demo"])).toBe("issue/42-demo\n");
        expect(runIssueBranchCli(["parse", "--branch", "issue-77-demo"])).toBe("77\n");
    });

    it("runs as a CLI", () => {
        expect(runIssueBranchCli(["slugify", "Próba"]).trim()).toBe("proba");
        expect(runIssueBranchCli(["make", "--issue", "9", "--title", "Próba"])).toBe("issue/9-proba\n");
    });
});
