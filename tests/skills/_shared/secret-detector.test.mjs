import {describe, expect, it} from "vitest";

import {
    detectSecrets,
    formatSecretValidationErrors,
} from "../../../.agents/skills/_shared/scripts/secret-detector.mjs";

describe("shared secret detector", () => {
    it("requires token boundaries and a meaningful sk-token contract", () => {
        const token = "sk-proj-A1b2C3d4E5f6G7h8J9k0LmN1";
        const result = detectSecrets({
            constraints: [
                `prefix-${token}`,
                "sk-aaaaaaaaaaaaaaaaaaaa",
                "token: sk-<token>",
            ],
        });

        expect(result).toEqual([]);
        expect(detectSecrets({constraints: [token]})).toEqual([
            {category: "openai-token", field: "$.constraints[0]"},
        ]);
    });

    it("detects real tokens even when they occur in path-like metadata", () => {
        const token = "sk-proj-A1b2C3d4E5f6G7h8J9k0LmN1";
        const result = detectSecrets({
            branch: `feature/${token}`,
            rules: [`docs/${token}.md`],
            constraints: [token],
        });

        expect(result).toEqual([
            {category: "openai-token", field: "$.branch"},
            {category: "openai-token", field: "$.rules[0]"},
            {category: "openai-token", field: "$.constraints[0]"},
        ]);
    });

    it("accepts ordinary paths, branch slugs and token-format placeholders", () => {
        expect(detectSecrets({
            branch: "feature/task-plan-wp6-risk-review",
            rules: ["docs/plan/repository-context-hybrid-hardening-plan.md", "docs/sk-release-notes-2024-spring-plan.md"],
            documentation: ["docs/README.md", "docs/sk-architecture-decision-records.md"],
            constraints: ["token: sk-<token>", "github_pat_<token>"],
        })).toEqual([]);
    });

    it("detects a high-entropy legacy OpenAI token", () => {
        const token = "sk-A1b2C3d4E5f6G7h8J9k0LmN1P2q3R4s5T6u7V8w9X0y1Z2";
        expect(detectSecrets({constraints: [token]})).toEqual([
            {category: "openai-token", field: "$.constraints[0]"},
        ]);
    });

    it("reports sensitive fields and assignments without exposing values", () => {
        const password = "hunter2-secret";
        const result = detectSecrets({
            token: "plain-token-value",
            constraints: [`embedded JSON: {\"password\":\"${password}\"}`],
        });

        expect(result).toEqual([
            {category: "sensitive-field", field: "$.token"},
            {category: "sensitive-assignment", field: "$.constraints[0]"},
        ]);

        const errors = formatSecretValidationErrors("handoff", {
            constraints: ["ghp_example_secret_value"],
        });
        expect(errors).toContain("handoff appears to contain a secret");
        expect(errors.some((error) => error.includes("category=github-token") && error.includes("field=$.constraints[0]"))).toBe(true);
        expect(errors.join("\n")).not.toContain("ghp_example_secret_value");
    });
});
