import {describe, expect, it} from "vitest";

import {collectConfigNotices} from "../../../.agents/skills/qa-run/scripts/run-matrix/config/notices.mjs";
import {parseConfig} from "../../../.agents/skills/qa-run/scripts/run-matrix/config/normalizer.mjs";

describe("qa-run config normalizer", () => {
    it("requires explicit section contract fields", () => {
        expect(() => parseTestConfig({
            sectionOrder: ["MISSING_COMMANDS"],
            sections: {
                MISSING_COMMANDS: {
                    patterns: [],
                    runOn: ["full"],
                    requiresFinalFullPass: false,
                },
            },
        })).toThrow('Config section "MISSING_COMMANDS" field "commands" is required.');
    });

    it("rejects invalid section order declarations", () => {
        expect(() => parseTestConfig({
            sectionOrder: ["MISSING_SECTION"],
            sections: {
                EXISTING_SECTION: minimalSection(),
            },
        })).toThrow('Config sectionOrder references missing section "MISSING_SECTION".');

        expect(() => parseTestConfig({
            sectionOrder: [],
            sections: {
                EXISTING_SECTION: minimalSection(),
            },
        })).toThrow("Config sections missing from sectionOrder: EXISTING_SECTION.");
    });

    it("rejects invalid parser names", () => {
        expect(() => parseTestConfig({
            sectionOrder: ["FILES_CHANGED"],
            sections: {
                FILES_CHANGED: {
                    ...minimalSection(),
                    commands: [
                        {
                            cmd: "node -e \"console.log('not reached')\"",
                            parser: "unknown-parser",
                        },
                    ],
                },
            },
        })).toThrow("parser must be one of: generic-tail, phpstan-json, eslint-json");
    });

    it("applies output precedence from root to section to command", () => {
        const config = parseTestConfig({
            outputDefaults: {
                failTailLines: 10,
                maxOutputBytes: 1000,
                parser: "generic-tail",
            },
            sectionOrder: ["FILES_CHANGED"],
            sections: {
                FILES_CHANGED: {
                    ...minimalSection(),
                    output: {
                        failTailLines: 20,
                    },
                    commands: [
                        {
                            cmd: "node -e \"console.error('not reached')\"",
                            output: {
                                maxOutputBytes: 2000,
                            },
                            parser: "eslint-json",
                        },
                    ],
                },
            },
        });

        expect(config.sections.FILES_CHANGED.commands[0].output).toEqual(expect.objectContaining({
            failTailLines: 20,
            maxOutputBytes: 2000,
            outputMode: "quiet-on-pass",
            parser: "eslint-json",
            parserInputBytes: 5242880,
            stripAnsi: true,
        }));
    });

    it("disables section cache without enabled=true or resolved patterns", () => {
        const config = parseTestConfig({
            sectionOrder: ["ALWAYS_FULL", "FILES_CHANGED"],
            sections: {
                ALWAYS_FULL: {
                    ...minimalSection(),
                    cache: {
                        enabled: true,
                    },
                    patterns: [],
                    runOn: ["full"],
                },
                FILES_CHANGED: {
                    ...minimalSection(),
                    cache: {
                        enabled: false,
                        envKeys: ["NODE_ENV", "NODE_ENV"],
                    },
                    patterns: ["**/*.mjs"],
                },
            },
        });

        expect(config.sections.ALWAYS_FULL.cache).toEqual({
            enabled: false,
            envKeys: [],
        });
        expect(config.sections.FILES_CHANGED.cache).toEqual({
            enabled: false,
            envKeys: ["NODE_ENV"],
        });
    });

    it("rejects removed command alias and command-level cache", () => {
        expect(() => parseTestConfig({
            sectionOrder: ["FILES_CHANGED"],
            sections: {
                FILES_CHANGED: {
                    ...minimalSection(),
                    commands: [
                        {
                            command: "node -e \"console.log('not reached')\"",
                        },
                    ],
                },
            },
        })).toThrow('command object requires non-empty "cmd"');

        expect(() => parseTestConfig({
            sectionOrder: ["FILES_CHANGED"],
            sections: {
                FILES_CHANGED: {
                    ...minimalSection(),
                    commands: [
                        {
                            cmd: "node -e \"console.log('not reached')\"",
                            cache: {
                                enabled: true,
                            },
                        },
                    ],
                },
            },
        })).toThrow("command cache is not supported");
    });

    it("reports notices only for active sections needing machine parser config", () => {
        const config = parseTestConfig({
            sectionOrder: ["ACTIVE", "INACTIVE"],
            sections: {
                ACTIVE: {
                    ...minimalSection(),
                    commands: [
                        "node -e \"console.log('ok')\" -- phpstan",
                        {
                            cmd: "node -e \"console.log('ok')\" -- eslint",
                            parser: "eslint-json",
                        },
                    ],
                },
                INACTIVE: {
                    ...minimalSection(),
                    commands: [
                        "node -e \"console.log('ok')\" -- phpstan",
                    ],
                },
            },
        });

        const notices = collectConfigNotices(config, {
            ACTIVE: true,
            INACTIVE: false,
        });

        expect(notices.map((notice) => notice.code)).toEqual([
            "machine-parser-available",
            "machine-parser-flag-not-visible",
        ]);
        expect(notices.map((notice) => notice.section)).toEqual(["ACTIVE", "ACTIVE"]);
    });
});

function parseTestConfig(config) {
    return parseConfig(JSON.stringify(config), "test-matrix.json");
}

function minimalSection() {
    return {
        patterns: ["**/*.mjs"],
        commands: ["node -e \"console.log('ok')\""],
        runOn: ["rerun"],
        requiresFinalFullPass: false,
    };
}
