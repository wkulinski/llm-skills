import fs from "node:fs";
import path from "node:path";

export const MODEL_HIERARCHY_PATH = ".agents/config/model-hierarchy.json";

export class ModelHierarchyError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "ModelHierarchyError";
        this.code = code;
        this.details = details;
    }
}

export function loadModelHierarchy({repoRoot = process.cwd(), fsOps = fs} = {}) {
    const root = path.resolve(repoRoot);
    const configPath = path.resolve(root, MODEL_HIERARCHY_PATH);
    if (!fsOps.existsSync(configPath)) {
        throw new ModelHierarchyError(
            "MODEL_HIERARCHY_NOT_FOUND",
            `Model hierarchy does not exist: ${MODEL_HIERARCHY_PATH}.`,
        );
    }

    let input;
    try {
        input = JSON.parse(fsOps.readFileSync(configPath, "utf8"));
    } catch (error) {
        throw new ModelHierarchyError("INVALID_MODEL_HIERARCHY", "Model hierarchy must be valid JSON.", causeDetails(error));
    }
    if (input?.version !== 1
        || input.order !== "strongest-to-weakest"
        || !Array.isArray(input.profiles)
        || input.profiles.length === 0) {
        throw new ModelHierarchyError(
            "INVALID_MODEL_HIERARCHY",
            "Model hierarchy must use version 1, order strongest-to-weakest and contain a non-empty profiles array.",
        );
    }

    const profiles = [];
    for (const [index, candidate] of input.profiles.entries()) {
        const profile = normalizeProfile(candidate, `profiles[${index}]`);
        const duplicate = profiles.some((existing) => (
            existing.reasoning === profile.reasoning
            && modelNamesMatch(existing.model, profile.model)
        ));
        if (duplicate) {
            throw new ModelHierarchyError("DUPLICATE_MODEL_PROFILE", `Duplicate model profile: ${formatProfile(profile)}.`);
        }
        profiles.push(profile);
    }
    return {version: 1, order: input.order, path: MODEL_HIERARCHY_PATH, profiles};
}

export function compareModelProfiles(hierarchy, {required, current} = {}) {
    const requiredProfile = normalizeProfile(required, "required profile");
    const currentProfile = normalizeProfile(current, "current profile");
    const requiredIndex = resolveProfileIndex(hierarchy, requiredProfile);
    if (requiredIndex === -1) {
        throw new ModelHierarchyError(
            "UNRANKED_REQUIRED_PROFILE",
            `Required profile is not ranked: ${formatProfile(requiredProfile)}.`,
        );
    }
    const currentIndex = resolveProfileIndex(hierarchy, currentProfile);
    if (currentIndex === -1) {
        throw new ModelHierarchyError(
            "UNRANKED_CURRENT_PROFILE",
            `Current profile is not ranked: ${formatProfile(currentProfile)}.`,
        );
    }
    return {
        sufficient: currentIndex <= requiredIndex,
        required: {...requiredProfile, rank: requiredIndex},
        current: {...currentProfile, rank: currentIndex},
    };
}

export function hasModelProfile(hierarchy, profile) {
    const normalized = normalizeProfile(profile, "profile");
    return resolveProfileIndex(hierarchy, normalized) !== -1;
}

function resolveProfileIndex(hierarchy, profile) {
    return hierarchy.profiles.findIndex((candidate) => (
        candidate.reasoning === profile.reasoning
        && modelNamesMatch(candidate.model, profile.model)
    ));
}

/**
 * Matches model identities regardless of the provider prefix.
 *
 * The shorter segment path must be a suffix of the longer one, so
 * `commandcode/deepseek/deepseek-v4.1-flash`, `deepseek/deepseek-v4.1-flash`
 * and `deepseek-v4.1-flash` describe the same model, while `gpt-6-sol` and
 * `gpt-6-sol-lite` remain distinct.
 */
function modelNamesMatch(left, right) {
    const leftSegments = modelSegments(left);
    const rightSegments = modelSegments(right);
    const [shorter, longer] = leftSegments.length <= rightSegments.length
        ? [leftSegments, rightSegments]
        : [rightSegments, leftSegments];
    if (shorter.length === 0) {
        return false;
    }
    const offset = longer.length - shorter.length;
    return shorter.every((segment, index) => segment === longer[offset + index]);
}

function modelSegments(model) {
    return model.split("/").filter((segment) => segment !== "");
}

function normalizeProfile(value, label) {
    if (!value || typeof value !== "object") {
        throw new ModelHierarchyError("INVALID_MODEL_PROFILE", `${label} must be an object.`);
    }
    const model = requiredString(value.model, `${label}.model`);
    const reasoning = requiredString(value.reasoning, `${label}.reasoning`);
    return {model, reasoning};
}

function requiredString(value, label) {
    if (typeof value !== "string" || value.trim() === "") {
        throw new ModelHierarchyError("INVALID_MODEL_PROFILE", `${label} must be a non-empty string.`);
    }
    return value.trim();
}

function formatProfile(profile) {
    return `${profile.model}@${profile.reasoning}`;
}

function causeDetails(error) {
    return {cause: error instanceof Error ? error.message : String(error)};
}
