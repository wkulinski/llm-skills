import {describe, expect, it} from "vitest";

import {parseEslintJson} from "../../../.agents/skills/qa-run/scripts/run-matrix/parsers/eslint-json.mjs";
import {buildFailureSummary, genericTail, limitSummaryLines, stripAnsi, truncateLineToBytes} from "../../../.agents/skills/qa-run/scripts/run-matrix/parsers/failure-summary.mjs";
import {parsePhpStanJson} from "../../../.agents/skills/qa-run/scripts/run-matrix/parsers/phpstan-json.mjs";

describe("failure summary parsers", () => {
    it("parses PHPStan JSON output", () => {
        const input = JSON.stringify({
            errors: ["bootstrap failed"],
            files: {
                "src/Foo.php": {
                    messages: [
                        {
                            line: 42,
                            message: "Parameter #1 expects X, Y given",
                        },
                    ],
                },
            },
        });

        expect(parsePhpStanJson(input)).toEqual([
            "bootstrap failed",
            "src/Foo.php:42 Parameter #1 expects X, Y given",
        ]);
    });

    it("parses ESLint JSON output", () => {
        const input = JSON.stringify([
            {
                filePath: "src/foo.ts",
                messages: [
                    {
                        line: 7,
                        column: 3,
                        ruleId: "no-unused-vars",
                        message: "x is defined but never used",
                    },
                ],
            },
        ]);

        expect(parseEslintJson(input)).toEqual([
            "src/foo.ts:7:3 [no-unused-vars] x is defined but never used",
        ]);
    });

    it("falls back to generic tail when parser input is invalid", () => {
        const summary = buildFailureSummary(
            {
                failTailLines: 5,
                maxOutputBytes: 2000,
                parser: "phpstan-json",
                stripAnsi: true,
            },
            "stdout line",
            "stderr line",
            "spawn error",
            "{not-json",
            "line one\nline two"
        );

        expect(summary).toEqual(["stdout line", "stderr line", "spawn error"]);
    });

    it("strips ansi sequences before limiting lines", () => {
        const summary = limitSummaryLines(
            ["\u001b[31mred error\u001b[0m"],
            {
                failTailLines: 5,
                maxOutputBytes: 2000,
                stripAnsi: true,
            }
        );

        expect(summary).toEqual(["red error"]);
        expect(stripAnsi("\u001b[32mok\u001b[0m")).toBe("ok");
    });

    it("keeps only the configured tail lines", () => {
        const summary = limitSummaryLines(
            ["first", "second", "third"],
            {
                failTailLines: 2,
                maxOutputBytes: 2000,
                stripAnsi: true,
            }
        );

        expect(summary).toEqual(["second", "third"]);
    });

    it("truncates long lines to the configured byte budget", () => {
        const truncated = truncateLineToBytes("abcdefghijk", 10);

        expect(truncated).toContain("...[truncated]");
        expect(Buffer.byteLength(truncated, "utf-8")).toBeLessThanOrEqual(24);
    });

    it("normalizes generic tail by removing blank lines", () => {
        expect(genericTail("first\n\nsecond\n")).toEqual(["first", "second"]);
    });
});
