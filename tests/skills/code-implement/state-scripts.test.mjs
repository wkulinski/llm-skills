import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {runStateClear} from "../../../.agents/skills/code-implement/scripts/state-clear.mjs";
import {runStateInit} from "../../../.agents/skills/code-implement/scripts/state-init.mjs";
import {runStateLog} from "../../../.agents/skills/code-implement/scripts/state-log.mjs";
import {runStateReadLog} from "../../../.agents/skills/code-implement/scripts/state-readlog.mjs";
import {formatIsoSeconds, formatLocalDate, formatLocalTime, resolveReadEventsPath, resolveStatePath} from "../../../.agents/skills/code-implement/scripts/state-utils.mjs";

describe("code-implement state scripts", () => {
    it("uses consumer-local durable paths independently of CACHE_PATH", () => {
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), "durable-state-"));
        const previous = process.env.CACHE_PATH;
        try {
            process.env.CACHE_PATH = "custom-cache";
            runStateInit({repoRoot});
            expect(resolveStatePath(repoRoot).absolute).toBe(path.join(repoRoot, "var/agent/code-implement/state.md"));
            expect(resolveReadEventsPath(repoRoot).absolute).toBe(path.join(repoRoot, "var/agent/code-implement/read-events.jsonl"));
            process.env.CACHE_PATH = "other-cache";
            expect(runStateInit({repoRoot}).stdout).toContain("(exists)");
            expect(runStateLog(["durable iteration"], {repoRoot}).code).toBe(0);
            expect(runStateReadLog(["--purpose", "verification", "--path", "test.mjs"], {repoRoot}).code).toBe(0);
            expect(readFileSync(resolveStatePath(repoRoot).absolute, "utf8")).toContain("durable iteration");
            runStateClear({repoRoot});
            expect(existsSync(path.join(repoRoot, "var/agent/code-implement/state.md"))).toBe(false);
            expect(existsSync(path.join(repoRoot, "var/agent/code-implement/read-events.jsonl"))).toBe(false);
            expect(existsSync(path.join(repoRoot, "custom-cache"))).toBe(false);
            expect(existsSync(path.join(repoRoot, "other-cache"))).toBe(false);
        } finally {
            if (typeof previous === "undefined") { delete process.env.CACHE_PATH; } else { process.env.CACHE_PATH = previous; }
            rmSync(repoRoot, {force: true, recursive: true});
        }
    });
    it("keeps one state when scripts run from a repository subdirectory", () => {
        const repoRoot = mkdtempSync(path.join(os.tmpdir(), "state-subdir-"));
        try {
            mkdirSync(path.join(repoRoot, ".git"));
            mkdirSync(path.join(repoRoot, "src/nested"), {recursive: true});
            const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/code-implement/scripts");
            const run = (script, args) => spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
                cwd: path.join(repoRoot, "src/nested"),
                env: {...process.env, CACHE_PATH: "var/agent/cache"},
                encoding: "utf8",
            });
            expect(run("state-init.mjs", []).status).toBe(0);
            expect(run("state-log.mjs", ["from", "subdirectory"]).status).toBe(0);
            expect(readFileSync(path.join(repoRoot, "var/agent/code-implement/state.md"), "utf8")).toContain("from subdirectory");
            expect(existsSync(path.join(repoRoot, "src/nested/var"))).toBe(false);
        } finally {
            rmSync(repoRoot, {force: true, recursive: true});
        }
    });
    it("prints read-log CLI help without requiring or writing state", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-help-test-"));
        try {
            const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/code-implement/scripts/state-readlog.mjs");
            for (const flag of ["--help", "-h"]) {
                const result = spawnSync(process.execPath, [script, flag], {
                    cwd: tempRoot,
                    env: {...process.env, CACHE_PATH: "var/agent/cache"},
                    encoding: "utf8",
                });

                expect(result.status).toBe(0);
                expect(result.stderr).toBe("");
                for (const literal of [
                    "purpose",
                    "discovery",
                    "read-before-write",
                    "event",
                    "source",
                    "read-mode",
                    "path",
                    "scope",
                    "cannot be combined",
                    "Put structured flags first",
                ]) {
                    expect(result.stdout).toContain(literal);
                }
            }

            expect(existsSync(resolveStatePath(tempRoot).absolute)).toBe(false);
            expect(existsSync(resolveReadEventsPath(tempRoot).absolute)).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("prints help for init, log and clear without touching state", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-help-test-"));
        try {
            const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../.agents/skills/code-implement/scripts");
            const run = (script, args) => spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
                cwd: tempRoot,
                env: {...process.env, CACHE_PATH: "var/agent/cache"},
                encoding: "utf8",
            });
            for (const script of ["state-init.mjs", "state-log.mjs", "state-clear.mjs"]) {
                for (const flag of ["--help", "-h"]) {
                    const result = run(script, [flag]);
                    expect(result.status).toBe(0);
                    expect(result.stdout).toContain(`Usage: ${script}`);
                }
            }
            expect(existsSync(resolveStatePath(tempRoot).absolute)).toBe(false);

            runStateInit({repoRoot: tempRoot});
            const before = readFileSync(resolveStatePath(tempRoot).absolute, "utf-8");
            const unknown = run("state-log.mjs", ["--message", "text"]);
            expect(unknown.status).toBe(2);
            expect(unknown.stderr).toContain("unknown option: --message");
            expect(run("state-init.mjs", ["extra"]).status).toBe(2);
            expect(readFileSync(resolveStatePath(tempRoot).absolute, "utf-8")).toBe(before);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("initializes a state file once and keeps it stable on rerun", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const now = new Date("2026-07-02T10:11:12.000Z");

            const created = runStateInit({repoRoot: tempRoot, now});
            const statePath = resolveStatePath(tempRoot).absolute;

            expect(created).toEqual({
                code: 0,
                stdout: `${resolveStatePath(tempRoot).display} (created)\n`,
            });
            expect(readFileSync(statePath, "utf-8")).toContain(`- Utworzono: ${formatLocalDate(now)} ${formatLocalTime(now)}`);

            const rerun = runStateInit({repoRoot: tempRoot, now});
            expect(rerun).toEqual({
                code: 0,
                stdout: `${resolveStatePath(tempRoot).display} (exists)\n`,
            });
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("logs iterations and read entries in the expected sections", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const statePath = resolveStatePath(tempRoot).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, [
                "# STAN CODE-IMPLEMENT (lokalny, niecommitowany)",
                "",
                "### Dziennik odczytów",
                "- [2026-07-02T10:00:00+02:00] first read",
                "",
                "### Dziennik iteracji",
                "- [2026-07-02T10:00:00+02:00] first iter",
                "",
                "### Inne",
                "- tail",
                "",
            ].join("\n"), "utf-8");

            expect(runStateReadLog(["rg", "foo"], {repoRoot: tempRoot, now: new Date("2026-07-02T10:12:13.000Z")})).toEqual({code: 0});
            expect(runStateLog(["git", "diff", "--stat"], {repoRoot: tempRoot, now: new Date("2026-07-02T10:13:14.000Z")})).toEqual({code: 0});

            const content = readFileSync(statePath, "utf-8");
            expect(content).toContain(`- [${formatIsoSeconds(new Date("2026-07-02T10:12:13.000Z"))}] rg foo`);
            expect(content).toContain(`- [${formatIsoSeconds(new Date("2026-07-02T10:13:14.000Z"))}] git diff --stat`);
            expect(content).toContain("### Inne");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports missing state and clears existing state files", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const statePath = resolveStatePath(tempRoot).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});

            expect(runStateLog(["rg", "foo"], {repoRoot: tempRoot})).toEqual({
                code: 1,
                stderr: `ERROR: missing state file: ${statePath}\n`,
            });

            writeFileSync(statePath, "content\n", "utf-8");
            const readEventsPath = resolveReadEventsPath(tempRoot).absolute;
            writeFileSync(readEventsPath, "{\"version\":1}\n", "utf-8");
            expect(runStateClear({repoRoot: tempRoot})).toEqual({
                code: 0,
                stdout: `${resolveStatePath(tempRoot).display} (cleared; ${resolveReadEventsPath(tempRoot).display} cleared)\n`,
            });
            expect(existsSync(readEventsPath)).toBe(false);
            expect(runStateClear({repoRoot: tempRoot})).toEqual({
                code: 0,
                stdout: `${resolveStatePath(tempRoot).display} (missing; nothing to clear)\n`,
            });
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("writes a validated structured read event without raw message content in the sidecar", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const statePath = resolveStatePath(tempRoot).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n\n### Dziennik iteracji\n", "utf-8");
            const now = new Date("2026-07-02T10:14:15.000Z");

            expect(runStateReadLog([
                "--purpose", "read-before-write",
                "--source", "parent",
                "--read-mode", "full",
                "--path", "src/example.mjs",
                "diff", "and", "current", "content",
            ], {repoRoot: tempRoot, now})).toEqual({code: 0});

            const state = readFileSync(statePath, "utf-8");
            expect(state).toContain("[read-event] event=read purpose=read-before-write source=parent mode=full path=src/example.mjs");
            expect(state).toContain("diff and current content");

            const eventsPath = resolveReadEventsPath(tempRoot).absolute;
            expect(existsSync(eventsPath)).toBe(true);
            const event = JSON.parse(readFileSync(eventsPath, "utf-8"));
            expect(event).toMatchObject({
                version: 1,
                observed_at: formatIsoSeconds(now),
                event: "read",
                purpose: "read-before-write",
                source: "parent",
                read_mode: "full",
                resource_kind: "path",
                resource: "src/example.mjs",
            });
            expect(event).not.toHaveProperty("message");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports an orphaned read-events sidecar accurately when clearing state", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const readEventsPath = resolveReadEventsPath(tempRoot).absolute;
            mkdirSync(path.dirname(readEventsPath), {recursive: true});
            writeFileSync(readEventsPath, "{\"version\":1}\n", "utf-8");

            expect(runStateClear({repoRoot: tempRoot})).toEqual({
                code: 0,
                stdout: `${resolveReadEventsPath(tempRoot).display} (cleared)\n`,
            });
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("rejects unknown structured read purposes without changing state or sidecar", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const statePath = resolveStatePath(tempRoot).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n", "utf-8");

            expect(runStateReadLog([
                "--purpose", "unknown-purpose",
                "--path", "src/example.mjs",
            ], {repoRoot: tempRoot})).toMatchObject({code: 1});
            expect(readFileSync(statePath, "utf-8")).toBe("### Dziennik odczytów\n");
            expect(existsSync(resolveReadEventsPath(tempRoot).absolute)).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("does not update state.md when the structured sidecar cannot be appended", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const statePath = resolveStatePath(tempRoot).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n", "utf-8");
            mkdirSync(resolveReadEventsPath(tempRoot).absolute);
            const before = readFileSync(statePath, "utf-8");

            expect(() => runStateReadLog([
                "--purpose", "verification",
                "--path", "src/example.mjs",
            ], {repoRoot: tempRoot})).toThrow();
            expect(readFileSync(statePath, "utf-8")).toBe(before);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("records report reuse as an event distinct from a file read", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const statePath = resolveStatePath(tempRoot).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n", "utf-8");

            expect(runStateReadLog([
                "--event", "report-reuse",
                "--scope", "scout-report-42",
                "reuse", "validated", "report",
            ], {repoRoot: tempRoot})).toEqual({code: 0});

            const event = JSON.parse(readFileSync(resolveReadEventsPath(tempRoot).absolute, "utf-8"));
            expect(event).toMatchObject({
                event: "report-reuse",
                read_mode: "report",
                resource_kind: "scope",
                resource: "scout-report-42",
            });
            expect(event.purpose).toBeNull();
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
