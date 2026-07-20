import assert from "node:assert/strict";
import test from "node:test";
import {validateCriteriaDocument} from "./context-criteria.mjs";

test("criteria validator accepts the canonical object format", () => {
    assert.equal(validateCriteriaDocument({criteria: [{id: "C1", description: "Map the flow."}]}).valid, true);
});

test("criteria validator rejects aliases, duplicates and incomplete entries", () => {
    assert.equal(validateCriteriaDocument(["C1"]).valid, false);
    const result = validateCriteriaDocument({criteria: [
        {id: "C1", description: "One"},
        {id: "C1", description: ""},
    ]});
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.includes("duplicate")));
    assert.ok(result.errors.some((error) => error.includes("description")));
});
