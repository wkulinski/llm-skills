import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {it} from "vitest";

import {
    compareModelProfiles,
    loadModelHierarchy,
    ModelHierarchyError,
} from "../../../.agents/skills/_shared/scripts/model-hierarchy.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

function repositoryWithProfiles(profiles) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-hierarchy-"));
    const configDir = path.join(root, ".agents", "config");
    fs.mkdirSync(configDir, {recursive: true});
    fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), `${JSON.stringify({
        version: 1,
        order: "strongest-to-weakest",
        profiles,
    }, null, 2)}\n`, "utf8");
    return root;
}

it("compares exact model and reasoning profiles by configured order", () => {
    const root = repositoryWithProfiles([
        {model: "model/b", reasoning: "high"},
        {model: "model/b", reasoning: "medium"},
        {model: "model/a", reasoning: "medium"},
    ]);
    const hierarchy = loadModelHierarchy({repoRoot: root});

    assert.equal(compareModelProfiles(hierarchy, {
        required: {model: "model/b", reasoning: "medium"},
        current: {model: "model/b", reasoning: "high"},
    }).sufficient, true);
    assert.equal(compareModelProfiles(hierarchy, {
        required: {model: "model/b", reasoning: "high"},
        current: {model: "model/a", reasoning: "medium"},
    }).sufficient, false);
});

it("rejects duplicate and unranked profiles instead of guessing", () => {
    const duplicateRoot = repositoryWithProfiles([
        {model: "model/a", reasoning: "medium"},
        {model: "model/a", reasoning: "medium"},
    ]);
    assert.throws(
        () => loadModelHierarchy({repoRoot: duplicateRoot}),
        (error) => error instanceof ModelHierarchyError && error.code === "DUPLICATE_MODEL_PROFILE",
    );

    const hierarchy = loadModelHierarchy({repoRoot: repositoryWithProfiles([
        {model: "model/a", reasoning: "medium"},
    ])});
    assert.throws(
        () => compareModelProfiles(hierarchy, {
            required: {model: "model/a", reasoning: "medium"},
            current: {model: "model/b", reasoning: "high"},
        }),
        (error) => error instanceof ModelHierarchyError && error.code === "UNRANKED_CURRENT_PROFILE",
    );
});

it("requires a project-local hierarchy instead of using a fallback", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-hierarchy-missing-"));
    assert.throws(
        () => loadModelHierarchy({repoRoot: root}),
        (error) => error instanceof ModelHierarchyError && error.code === "MODEL_HIERARCHY_NOT_FOUND",
    );
});

it("ships a valid JSON template that can be copied to the project config path", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "model-hierarchy-template-"));
    const configDir = path.join(root, ".agents", "config");
    fs.mkdirSync(configDir, {recursive: true});
    const template = fs.readFileSync(path.join(
        ROOT,
        ".agents",
        "skills",
        "plan-execute",
        "model-hierarchy.json.dist",
    ), "utf8");
    assert.doesNotThrow(() => JSON.parse(template));
    fs.writeFileSync(path.join(configDir, "model-hierarchy.json"), template, "utf8");

    const hierarchy = loadModelHierarchy({repoRoot: root});
    assert.equal(hierarchy.order, "strongest-to-weakest");
    assert.equal(hierarchy.profiles.length, 3);
});
