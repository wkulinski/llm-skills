import {mkdirSync, mkdtempSync, rmSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {normalizeCriteriaDocument, preflightCriteriaDocument, validateCriteriaDocument} from "../../../.agents/skills/_shared/scripts/context-criteria.mjs";

describe("criteria validator", () => {
    it("accepts the canonical object format", () => {
        expect(validateCriteriaDocument({criteria: [{id: "C1", description: "Map the flow."}]}).valid).toBe(true);
        expect(validateCriteriaDocument({criteria: [{
            id: "C1",
            description: "Map the flow.",
            forbid_negative_claims: true,
            required_evidence: [{path: "AGENTS.md", relation: "defines", anchors: ["Repository Guidelines"]}],
        }]}).valid).toBe(true);
    });

    it("rejects aliases, duplicates and incomplete entries", () => {
        expect(validateCriteriaDocument(["C1"]).valid).toBe(false);
        const result = validateCriteriaDocument({criteria: [
            {id: "C1", description: "One"},
            {id: "C1", description: ""},
        ]});
        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("duplicate"))).toBe(true);
        expect(result.errors.some((error) => error.includes("description"))).toBe(true);
    });

    it("rejects malformed semantic evidence requirements", () => {
        const result = validateCriteriaDocument({criteria: [{
            id: "C1",
            description: "Map the flow.",
            forbid_negative_claims: "yes",
            required_evidence: [
                {path: "AGENTS.md", path_prefix: "tests/"},
                {path: "../outside", anchors: []},
            ],
        }]});

        expect(result.valid).toBe(false);
        expect(result.errors.join("\n")).toMatch(/forbid_negative_claims/);
        expect(result.errors.join("\n")).toMatch(/exactly one safe repo-relative path or path_prefix/);
        expect(result.errors.join("\n")).toMatch(/anchors/);
    });

    it("normalizes legacy anchors and supports both anchor modes", () => {
        const normalized = normalizeCriteriaDocument({
            version: 2,
            criteria: [{
                id: "C1",
                description: "Map the flow.",
                required_evidence: [
                    {path: "AGENTS.md", anchors: ["Repository Guidelines"]},
                    {path_prefix: "tests/", anchor_mode: "scout-selected"},
                    {path: "README.md", anchor_mode: "required-literal", anchors: ["skills"]},
                ],
            }],
        });

        expect(normalized.version).toBe(2);
        expect(normalized.criteria[0].required_evidence.map((entry) => entry.anchor_mode)).toEqual([
            "required-literal",
            "scout-selected",
            "required-literal",
        ]);
    });

    it("preflights paths, anchors and relations without substitute lookup", () => {
        const invalidAnchor = preflightCriteriaDocument({criteria: [{
            id: "C1",
            description: "Map the flow.",
            required_evidence: [{path: "AGENTS.md", anchors: ["not-a-real-anchor"]}],
        }]});
        expect(invalidAnchor.valid).toBe(false);
        expect(invalidAnchor.errors).toEqual([expect.objectContaining({
            code: "INVALID_CRITERIA_ANCHOR",
            criterion_id: "C1",
            path: "AGENTS.md",
            anchor: "not-a-real-anchor",
        })]);

        const invalidPath = preflightCriteriaDocument({criteria: [{
            id: "C1",
            description: "Map the flow.",
            required_evidence: [{path: "does-not-exist.mjs"}],
        }]});
        expect(invalidPath.errors[0]).toEqual(expect.objectContaining({code: "INVALID_CRITERIA_PATH", path: "does-not-exist.mjs"}));

        const invalidRelation = preflightCriteriaDocument({criteria: [{
            id: "C1",
            description: "Map the flow.",
            required_evidence: [{path: "AGENTS.md", relation: "defines relation"}],
        }]});
        expect(invalidRelation.errors[0]).toEqual(expect.objectContaining({code: "INVALID_CRITERIA_RELATION", relation: "defines relation"}));
    });

    it("preflights valid scout-selected and required-literal path prefixes", () => {
        const result = preflightCriteriaDocument({version: 2, criteria: [
            {
                id: "C1",
                description: "Map the shared context helpers.",
                required_evidence: [{path_prefix: "tests/skills/_shared/", anchor_mode: "scout-selected"}],
            },
            {
                id: "C2",
                description: "Locate the criteria validator.",
                required_evidence: [{path_prefix: "tests/skills/_shared/", anchor_mode: "required-literal", anchors: ["validateCriteriaDocument"]}],
            },
        ]});

        expect(result.valid).toBe(true);
        expect(result.document.criteria.map((criterion) => criterion.required_evidence[0].anchor_mode)).toEqual(["scout-selected", "required-literal"]);
    });

    it("rejects missing and empty path prefixes", () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "criteria-preflight-"));
        mkdirSync(path.join(root, "empty"));
        try {
            const empty = preflightCriteriaDocument({criteria: [{
                id: "C1",
                description: "Require a readable prefix.",
                required_evidence: [{path_prefix: "empty/"}],
            }]}, root);
            expect(empty.errors[0]).toEqual(expect.objectContaining({code: "INVALID_CRITERIA_PATH", path: "empty/"}));

            const missing = preflightCriteriaDocument({criteria: [{
                id: "C1",
                description: "Require an existing prefix.",
                required_evidence: [{path_prefix: "missing/"}],
            }]}, root);
            expect(missing.errors[0]).toEqual(expect.objectContaining({code: "INVALID_CRITERIA_PATH", path: "missing/"}));
        } finally {
            rmSync(root, {recursive: true, force: true});
        }
    });

    it("rejects invalid and contradictory anchor mode declarations", () => {
        const invalidMode = validateCriteriaDocument({criteria: [{
            id: "C1",
            description: "Use an explicit mode.",
            required_evidence: [{path: "AGENTS.md", anchor_mode: "automatic"}],
        }]});
        expect(invalidMode.valid).toBe(false);
        expect(invalidMode.errors.join("\n")).toMatch(/anchor_mode/);

        const mixedAnchors = validateCriteriaDocument({criteria: [{
            id: "C1",
            description: "Keep mode and anchors consistent.",
            required_evidence: [{path: "AGENTS.md", anchor_mode: "scout-selected", anchors: ["Repository Guidelines"]}],
        }]});
        expect(mixedAnchors.valid).toBe(false);
        expect(mixedAnchors.errors.join("\n")).toMatch(/anchors must be omitted/);
    });

    it("preflights broad declared surfaces without numeric quotas", () => {
        const result = preflightCriteriaDocument({criteria: [{
            id: "C1", description: "Large but explicit task.",
            required_evidence: Array.from({length: 20}, () => ({path: "AGENTS.md"})),
            required_tests: Array.from({length: 30}, (_, i) => `T${i}`),
            required_symbols: 50,
        }]});
        expect(result.valid).toBe(true);
        expect(result).not.toHaveProperty("budget");
    });
});
