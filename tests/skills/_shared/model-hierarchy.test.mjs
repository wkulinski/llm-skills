import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {it} from "vitest";

import {
    compareModelProfiles,
    hasModelProfile,
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

it("compares model profiles by configured order regardless of the provider prefix", () => {
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

it("matches the same model with or without a provider prefix in both directions", () => {
    const hierarchy = loadModelHierarchy({repoRoot: repositoryWithProfiles([
        {model: "deepseek/deepseek-v4.1-flash", reasoning: "max"},
        {model: "openai/gpt-6-sol", reasoning: "medium"},
    ])});

    const comparison = compareModelProfiles(hierarchy, {
        required: {model: "deepseek/deepseek-v4.1-flash", reasoning: "max"},
        current: {model: "commandcode/deepseek/deepseek-v4.1-flash", reasoning: "max"},
    });
    assert.equal(comparison.sufficient, true);
    assert.equal(comparison.current.rank, 0);

    assert.equal(compareModelProfiles(hierarchy, {
        required: {model: "commandcode/openai/gpt-6-sol", reasoning: "medium"},
        current: {model: "gpt-6-sol", reasoning: "medium"},
    }).sufficient, true);

    assert.equal(hasModelProfile(hierarchy, {
        model: "commandcode/deepseek/deepseek-v4.1-flash",
        reasoning: "max",
    }), true);
    assert.equal(hasModelProfile(hierarchy, {model: "deepseek-v4.1-flash", reasoning: "max"}), true);
    assert.equal(hasModelProfile(hierarchy, {
        model: "commandcode/deepseek/deepseek-v4.1-flash",
        reasoning: "high",
    }), false);
});

it("does not match a different model that only shares a segment prefix", () => {
    const hierarchy = loadModelHierarchy({repoRoot: repositoryWithProfiles([
        {model: "openai/gpt-6-sol", reasoning: "medium"},
        {model: "openai/gpt-6-luna", reasoning: "max"},
    ])});

    assert.equal(hasModelProfile(hierarchy, {model: "openai/gpt-6-sol-lite", reasoning: "medium"}), false);
    assert.equal(hasModelProfile(hierarchy, {model: "openai/gpt-6", reasoning: "medium"}), false);
    assert.equal(hasModelProfile(hierarchy, {model: "openai/gpt-6-sol", reasoning: "max"}), false);
    assert.equal(hasModelProfile(hierarchy, {model: "gpt-6-luna", reasoning: "max"}), true);
});

it("rejects provider-agnostic duplicates at the same reasoning level", () => {
    assert.throws(
        () => loadModelHierarchy({repoRoot: repositoryWithProfiles([
            {model: "openai/gpt-6-sol", reasoning: "medium"},
            {model: "commandcode/openai/gpt-6-sol", reasoning: "medium"},
        ])}),
        (error) => error instanceof ModelHierarchyError && error.code === "DUPLICATE_MODEL_PROFILE",
    );
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
