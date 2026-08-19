import {describe, expect, it} from "vitest";
import {validateHandoff} from "../../../.agents/skills/_shared/scripts/context-handoff.mjs";

const valid = {
    mode: "targeted",
    "task_brief": "Map a repository flow.",
    decisions: [],
    constraints: [],
};

describe("handoff validator", () => {
    it("accepts the contract", () => {
        expect(validateHandoff(valid).valid).toBe(true);
    });

    it("rejects missing fields, invalid mode and secrets", () => {
        const result = validateHandoff({
            ...valid,
            mode: "broad",
            token: "ghp_example_secret_value",
        });
        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("mode"))).toBe(true);
        expect(result.errors.some((error) => error.includes("secret"))).toBe(true);
    });

    it("accepts task-plan, risk and ordinary slug identifiers", () => {
        const result = validateHandoff({
            ...valid,
            task_brief: "Review task-plan-wp6 and risk-review for ordinary-slug handling.",
            decisions: ["feature/context-token-detection"],
            constraints: [
                "Documentation format: token: sk-<token>, sk-<value>, sk-xxxxxxxxxxxxxxxxxxxx or sk-aaaaaaaaaaaaaaaaaaaa.",
                "Documentation example: token: sk-aaaaaaaaaaaaaaaaaaaa",
            ],
        });

        expect(result.valid).toBe(true);
    });

    it("reports the secret category and field without exposing the value", () => {
        const value = "sk-proj-A1b2C3d4E5f6G7h8J9k0LmN1";
        const result = validateHandoff({
            ...valid,
            constraints: [`embedded JSON: {\"api_key\":\"${value}\"}`],
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("handoff appears to contain a secret");
        expect(result.errors.some((error) => error.includes("category=openai-token") && error.includes("field=$.constraints[0]"))).toBe(true);
        expect(result.errors.join("\n")).not.toContain(value);
    });
});
