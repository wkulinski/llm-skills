import {execFile} from "node:child_process";
import {readFile, rm, writeFile} from "node:fs/promises";
import {mkdtempSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {afterEach, describe, expect, it} from "vitest";

import {
    DEFAULT_CONFIG,
    findRemovedConfigFields,
    loadConfig,
} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/config.mjs";
import {buildMethodologyManifest} from "../../../.agents/skills/opencode-workflow-economics/scripts/lib/methodology.mjs";

const execFileAsync = promisify(execFile);
const CLI = path.resolve(".agents/skills/opencode-workflow-economics/scripts/owe.mjs");
const TEMPLATE = path.resolve(".agents/skills/opencode-workflow-economics/templates/config.json");
const temporaryRoots = [];

afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("OWE configuration", () => {
    it("keeps only user-facing fields in the config template", async () => {
        const template = JSON.parse(await readFile(TEMPLATE, "utf8"));

        expect(Object.keys(template)).toEqual([
            "version",
            "opencode",
            "collection",
            "privacy",
            "tool_mappings",
            "hybrid_families",
        ]);
        expect(template.tool_mappings).toEqual({});
        expect(template).not.toHaveProperty("shell_rules");
        expect(template).not.toHaveProperty("diagnostics");
        expect(template).not.toHaveProperty("reporting");
    });

    it("exposes the OWE timeout defaults in the generated configuration", async () => {
        const config = await loadConfig(TEMPLATE);

        expect(config.opencode.request_timeout_ms).toBe(120000);
        expect(config.opencode.startup_timeout_ms).toBe(30000);
        expect(config.opencode.readiness_probe_timeout_ms).toBe(2000);
        expect(config.opencode.request_retry_count).toBe(2);
    });

    it("initializes the minimal user configuration", async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "owe-config-init-"));
        temporaryRoots.push(root);

        await execFileAsync(process.execPath, [CLI, "init", "--directory", root], {encoding: "utf8"});

        const generated = JSON.parse(await readFile(path.join(root, ".owe", "config.json"), "utf8"));
        const template = JSON.parse(await readFile(TEMPLATE, "utf8"));
        expect(generated).toEqual(template);
    });

    it("ignores removed internal fields and reports their use", async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "owe-config-legacy-"));
        temporaryRoots.push(root);
        const configPath = path.join(root, "config.json");
        await writeFile(configPath, JSON.stringify(JSON.parse(`{
            "opencode": {"base_url": "http://example.test", "directory": "."},
            "collection": {"content_mode": "metadata", "max_sessions": 7, "concurrency": 2},
            "privacy": {"include_titles": true},
            "tool_mappings": {"custom_read": "read"},
            "shell_rules": [{"category": "repository.search", "pattern": "never-match"}],
            "diagnostics": {
                "fingerprints": {"step_count_maxima": [999]},
                "patterns": {"max_groups": 1},
                "delegation_overlap": {"max_parent_steps": 1}
            },
            "reporting": {"brief": {"max_bytes": 1}}
        }`)), "utf8");

        const warnings = [];
        const config = await loadConfig(configPath, {onWarning: (warning) => warnings.push(warning)});

        expect(findRemovedConfigFields(JSON.parse(await readFile(configPath, "utf8")))).toEqual([
            "shell_rules",
            "diagnostics",
            "reporting",
        ]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("shell_rules, diagnostics, reporting");
        expect(readProperty(readProperty(config, "collection"), "content_mode")).toBe("metadata");
        expect(readProperty(readProperty(config, "collection"), "max_sessions")).toBe(7);
        expect(readProperty(readProperty(config, "privacy"), "include_titles")).toBe(true);
        expect(readProperty(readProperty(config, "tool_mappings"), "custom_read")).toBe("read");
        expect(readProperty(config, "shell_rules")).toEqual(readProperty(DEFAULT_CONFIG, "shell_rules"));
        expect(readProperty(config, "diagnostics")).toEqual(readProperty(DEFAULT_CONFIG, "diagnostics"));
        expect(readProperty(config, "reporting")).toEqual(readProperty(DEFAULT_CONFIG, "reporting"));
        const manifest = buildMethodologyManifest(config);
        expect(manifest.effective_thresholds).toEqual(buildMethodologyManifest(DEFAULT_CONFIG).effective_thresholds);
        expect(readProperty(readProperty(readProperty(manifest, "effective_parameters"), "collection"), "content_mode")).toBe("metadata");
    });

    it("prints the removed-field warning through the CLI", async () => {
        const root = mkdtempSync(path.join(os.tmpdir(), "owe-config-cli-warning-"));
        temporaryRoots.push(root);
        const configPath = path.join(root, "config.json");
        await writeFile(configPath, JSON.stringify(JSON.parse(`{"reporting": {"brief": {"max_bytes": 1}}}`)), "utf8");

        let error;
        try {
            await execFileAsync(process.execPath, [
                CLI,
                "brief",
                "--directory",
                root,
                "--config",
                configPath,
                "--analysis-dir",
                path.join(root, "analysis"),
            ], {encoding: "utf8"});
        } catch (caught) {
            error = caught;
        }

        expect(error?.stderr).toContain("OWE config warning: Ignored removed internal fields: reporting. Runtime defaults are used.");
        expect(error?.stderr).toContain("OWE canonical report not found");
    });
});

function readProperty(object, key) {
    return object[key];
}
