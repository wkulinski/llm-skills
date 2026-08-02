import {defineConfig} from "vitest/config";

export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "unit",
                    include: ["tests/**/*.test.mjs"],
                    exclude: ["tests/**/*.integration.test.mjs"],
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
