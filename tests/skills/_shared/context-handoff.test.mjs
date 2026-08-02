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
});
