const GIT_VISIBLE_PATTERN_SET = "git-visible";

const BUILT_IN_PATTERN_SETS = {
    "php-source": [
        "**/*.php",
    ],
    "php-tooling": [
        "composer.json",
        "composer.lock",
        "phpstan*.neon",
        "phpstan*.neon.dist",
        "phpstan-baseline*.neon",
        "psalm*.xml",
        "psalm*.xml.dist",
        "phpunit*.xml",
        "phpunit*.xml.dist",
        "rector*.php",
        "ecs*.php",
        "pint.json",
        ".php-cs-fixer*.php",
        "deptrac*.yaml",
        "deptrac*.yml",
        "config/**/*.php",
        "config/**/*.yaml",
        "config/**/*.yml",
        "config/**/*.xml",
        "bin/**",
        "migrations/**/*.php",
        "stubs/**/*.php",
    ],
    "php-safe": [
        "@php-source",
        "@php-tooling",
    ],
    "js-ts-source": [
        "**/*.js",
        "**/*.jsx",
        "**/*.mjs",
        "**/*.cjs",
        "**/*.ts",
        "**/*.tsx",
        "**/*.mts",
        "**/*.cts",
        "**/*.vue",
        "**/*.svelte",
    ],
    "js-ts-tooling": [
        "package.json",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
        "bun.lock",
        "bun.lockb",
        "tsconfig*.json",
        "jsconfig*.json",
        "eslint.config.*",
        ".eslintrc",
        ".eslintrc.*",
        "prettier.config.*",
        ".prettierrc",
        ".prettierrc.*",
        "vitest.config.*",
        "vite.config.*",
        "jest.config.*",
        "babel.config.*",
        "postcss.config.*",
        "tailwind.config.*",
    ],
    "js-ts-tests": [
        "**/*.test.js",
        "**/*.test.jsx",
        "**/*.test.mjs",
        "**/*.test.cjs",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.js",
        "**/*.spec.jsx",
        "**/*.spec.mjs",
        "**/*.spec.cjs",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "tests/**/*.js",
        "tests/**/*.jsx",
        "tests/**/*.mjs",
        "tests/**/*.cjs",
        "tests/**/*.ts",
        "tests/**/*.tsx",
    ],
    "js-ts-safe": [
        "@js-ts-source",
        "@js-ts-tooling",
        "@js-ts-tests",
    ],
};

function resolvePatternEntries(entries, patternSets) {
    const state = {
        includeGitVisible: false,
        patternSets: [],
        patterns: [],
    };

    for (const entry of entries) {
        resolvePatternEntry(entry, patternSets, state, []);
    }

    return {
        includeGitVisible: state.includeGitVisible,
        patternSets: [...new Set(state.patternSets)].sort(),
        patterns: [...new Set(state.patterns)].sort(),
    };
}

function resolvePatternEntry(entry, patternSets, state, stack) {
    if (!entry.startsWith("@")) {
        state.patterns.push(entry);
        return;
    }

    const name = normalizePatternSetName(entry);
    if (name === GIT_VISIBLE_PATTERN_SET) {
        state.includeGitVisible = true;
        state.patternSets.push(`@${name}`);
        return;
    }

    if (stack.includes(name)) {
        throw new Error(`Circular pattern set reference: ${[...stack, name].map((item) => `@${item}`).join(" -> ")}.`);
    }

    const entries = Object.hasOwn(BUILT_IN_PATTERN_SETS, name)
        ? BUILT_IN_PATTERN_SETS[name]
        : patternSets[name];
    if (!entries) {
        throw new Error(`Unknown pattern set "@${name}".`);
    }

    state.patternSets.push(`@${name}`);
    for (const nestedEntry of entries) {
        resolvePatternEntry(nestedEntry, patternSets, state, [...stack, name]);
    }
}

function normalizePatternSetName(name) {
    if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error("Config patternSets names must be non-empty strings.");
    }

    return name.trim().replace(/^@/, "");
}

export {
    BUILT_IN_PATTERN_SETS,
    GIT_VISIBLE_PATTERN_SET,
    normalizePatternSetName,
    resolvePatternEntries,
    resolvePatternEntry,
};
