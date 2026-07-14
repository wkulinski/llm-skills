import {describe, expect, it} from "vitest";

import {
    renderContextManifestSummary,
    validateContextManifest,
} from "../../../.agents/skills/_shared/scripts/context-handoff.mjs";

const validManifest = {
    version: 1,
    role: "primary",
    repository: "acme/project",
    branch: "feature/context-routing",
    head: "abc123",
    rules: ["AGENTS.md"],
    documentation: ["docs/README.md"],
    active_overrides: [],
    constraints: ["no secrets in manifest"],
    already_read: ["AGENTS.md"],
    omitted: ["docs/HANDOFF.md"],
};

describe("context handoff", () => {
    it("validates and summarizes a compact manifest", () => {
        expect(validateContextManifest(validManifest)).toEqual({valid: true, errors: []});
        expect(renderContextManifestSummary(validManifest)).toContain("context-manifest v1 (primary)");
    });

    it("rejects issue contents and invalid delegated roles", () => {
        const result = validateContextManifest({
            ...validManifest,
            role: "context-scout",
            issue_comments: ["full comment"],
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("role must be primary or context-refresher");
        expect(result.errors).toContain("manifest must not contain issue/comments/document contents");
    });

    it("requires all collection fields to be string arrays", () => {
        const result = validateContextManifest({...validManifest, rules: ["AGENTS.md", 42]});

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("rules must be an array of strings");
    });

    it("rejects machine-specific paths and secret-like values", () => {
        const result = validateContextManifest({
            ...validManifest,
            rules: ["/home/user/project/AGENTS.md"],
            constraints: ["GH_TOKEN=ghp_example_secret_value"],
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("rules must contain repo-relative paths");
        expect(result.errors).toContain("manifest appears to contain a secret");
    });
});
