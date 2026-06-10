import {describe, expect, it} from "vitest";

import {globToRegExp, matchGlob} from "../../../.agents/skills/qa-run/scripts/run-matrix/patterns/glob.mjs";
import {BUILT_IN_PATTERN_SETS, GIT_VISIBLE_PATTERN_SET, resolvePatternEntries} from "../../../.agents/skills/qa-run/scripts/run-matrix/patterns/pattern-sets.mjs";
import {detectActiveSections, getActiveSectionNames, matchesResolvedPatterns} from "../../../.agents/skills/qa-run/scripts/run-matrix/patterns/section-activation.mjs";

describe("qa-run pattern helpers", () => {
    it("matches common glob patterns", () => {
        expect(matchGlob("**/*.mjs", "src/foo/bar.mjs")).toBe(true);
        expect(matchGlob("dir/**", "dir/nested/file.txt")).toBe(true);
        expect(matchGlob("file?.txt", "file1.txt")).toBe(true);
        expect(matchGlob("file?.txt", "file10.txt")).toBe(false);
    });

    it("builds a regexp for double-star directory patterns", () => {
        const regex = globToRegExp("config/**/*.php");

        expect(regex.test("config/services.php")).toBe(true);
        expect(regex.test("config/packages/dev/foo.php")).toBe(true);
        expect(regex.test("src/Foo.php")).toBe(false);
    });

    it("resolves built-in and nested pattern sets with sorting and deduplication", () => {
        const resolved = resolvePatternEntries(
            ["@js-ts-safe", "@project-extra", "**/*.mjs"],
            {
                "project-extra": ["@js-ts-safe", "**/*.mjs", "docs/**/*.md"],
            }
        );

        expect(resolved.includeGitVisible).toBe(false);
        expect(resolved.patternSets).toContain("@js-ts-safe");
        expect(resolved.patternSets).toContain("@project-extra");
        expect(resolved.patterns).toContain("**/*.mjs");
        expect(resolved.patterns).toContain("docs/**/*.md");
        expect(resolved.patterns).toEqual([...resolved.patterns].sort());
    });

    it("marks @git-visible as a special pattern set", () => {
        const resolved = resolvePatternEntries([`@${GIT_VISIBLE_PATTERN_SET}`], {});

        expect(resolved.includeGitVisible).toBe(true);
        expect(resolved.patternSets).toEqual([`@${GIT_VISIBLE_PATTERN_SET}`]);
    });

    it("rejects circular pattern set references", () => {
        expect(() => resolvePatternEntries(["@first"], {
            first: ["@second"],
            second: ["@first"],
        })).toThrow("Circular pattern set reference");
    });

    it("exposes built-in pattern sets", () => {
        expect(Object.keys(BUILT_IN_PATTERN_SETS)).toContain("php-safe");
        expect(Object.keys(BUILT_IN_PATTERN_SETS)).toContain("js-ts-safe");
    });

    it("matches resolved patterns and activates sections", () => {
        const config = {
            sectionOrder: ["ALWAYS_FULL", "ALWAYS_ON_RERUN", "JS_CHANGED"],
            sections: {
                ALWAYS_FULL: {
                    name: "ALWAYS_FULL",
                    resolvedPatterns: {includeGitVisible: false, patterns: []},
                    runOn: ["full"],
                },
                ALWAYS_ON_RERUN: {
                    name: "ALWAYS_ON_RERUN",
                    resolvedPatterns: {includeGitVisible: false, patterns: []},
                    runOn: ["rerun"],
                },
                JS_CHANGED: {
                    name: "JS_CHANGED",
                    resolvedPatterns: {includeGitVisible: false, patterns: ["**/*.mjs"]},
                    runOn: ["rerun"],
                },
            },
        };

        expect(matchesResolvedPatterns({includeGitVisible: true, patterns: []}, "any/file.txt")).toBe(true);

        const active = detectActiveSections(["src/foo.mjs"], config, "delta");

        expect(active).toEqual({
            ALWAYS_FULL: false,
            ALWAYS_ON_RERUN: true,
            JS_CHANGED: true,
        });
        expect(getActiveSectionNames(active)).toEqual(["ALWAYS_ON_RERUN", "JS_CHANGED"]);
    });
});
