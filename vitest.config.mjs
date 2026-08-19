import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "unit",
                    include: ["tests/**/*.test.mjs"],
                    exclude: ["tests/**/*.integration.test.mjs"],
                    // Snapshot-sensitive hybrid lifecycle tests fingerprint the
                    // repository. Run unit files serially so another test cannot
                    // create a transient untracked fixture between prepare and claim.
                    fileParallelism: false,
                },
            },
            {
                test: {
                    name: "integration",
                    include: ["tests/**/*.integration.test.mjs"],
                    testTimeout: 30_000,
                },
            },
        ],
    },
});
