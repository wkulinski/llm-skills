import {describe, expect, it} from "vitest";

import {
    buildChangeInspectReport,
    collectChangeInspectFiles,
    classifyChangeFiles,
    isCriticalFile,
    parseThreshold,
    splitGitLines,
    runChangeInspect,
} from "../../../.agents/skills/code-implement/scripts/change-inspect.mjs";

describe("change-inspect", () => {
    it("splits git output and parses threshold", () => {
        expect(splitGitLines("a\n\n b \n")).toEqual(["a", "b"]);
        expect(parseThreshold("17")).toBe(17);
        expect(parseThreshold("nope")).toBe(15);
    });

    it("identifies critical files and file types", () => {
        expect(isCriticalFile("src/Feature/Domain/Thing.php")).toBe(true);
        expect(isCriticalFile("docs/readme.md")).toBe(false);

        const classification = classifyChangeFiles([
            "src/Feature/Domain/Thing.php",
            "assets/app.ts",
            "translations/messages.en.yaml",
            "config/routes.yaml",
        ], 3);

        expect(classification).toMatchObject({
            detectedTypes: {
                hasJsTs: true,
                hasPhp: true,
                hasTranslations: true,
                hasTwig: false,
                hasStyle: false,
                hasYaml: true,
            },
            fileCount: 4,
            isLargeChange: true,
            reviewRequired: true,
            threshold: 3,
        });
        expect(classification.criticalFiles).toEqual([
            "config/routes.yaml",
            "src/Feature/Domain/Thing.php",
        ]);
    });

    it("renders the report text", () => {
        const report = buildChangeInspectReport({
            trackedFiles: [
                "src/Feature/Domain/Thing.php",
                "assets/app.ts",
            ],
            threshold: 10,
            untrackedFiles: [
                "translations/messages.en.yaml",
            ],
        });

        expect(report).toContain("Changed files (tracked): 2");
        expect(report).toContain("Untracked files: 1");
        expect(report).toContain("review_required=1");
        expect(report).toContain("Critical files touched (1):");
        expect(report).toContain("  - src/Feature/Domain/Thing.php");
        expect(report.endsWith("\n")).toBe(true);
    });

    it("collects git output and runs end-to-end with injected execFile", () => {
        const calls = [];
        const execFile = (command, args, options) => {
            calls.push({command, args, options});
            if (args.includes("diff")) {
                return "src/Feature/Domain/Thing.php\nassets/app.ts\n";
            }
            if (args.includes("ls-files")) {
                return "translations/messages.en.yaml\n";
            }
            throw new Error(`Unexpected call: ${args.join(" ")}`);
        };

        expect(collectChangeInspectFiles({cwd: "/repo", execFile})).toEqual({
            trackedFiles: ["src/Feature/Domain/Thing.php", "assets/app.ts"],
            untrackedFiles: ["translations/messages.en.yaml"],
        });
        calls.length = 0;
        expect(runChangeInspect({cwd: "/repo", thresholdArg: "10", execFile})).toContain("Total unique (tracked+untracked): 3");
        expect(calls).toHaveLength(2);
    });
});
