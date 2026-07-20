import assert from "node:assert/strict";
import test from "node:test";
import {validateHandoff} from "./context-handoff.mjs";

const valid = {
    mode: "targeted",
    task_brief: "Map a repository flow.",
    decisions: [],
    constraints: [],
};

test("handoff validator accepts the contract", () => {
    assert.equal(validateHandoff(valid).valid, true);
});

test("handoff validator rejects missing fields, invalid mode and secrets", () => {
    const result = validateHandoff({
        ...valid,
        mode: "broad",
        token: "ghp_example_secret_value",
    });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("mode")));
    assert.ok(result.errors.some((error) => error.includes("secret")));
});
