import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {runStateClear} from "../../../.agents/skills/code-implement/scripts/state-clear.mjs";
import {runStateInit} from "../../../.agents/skills/code-implement/scripts/state-init.mjs";
import {runStateLog} from "../../../.agents/skills/code-implement/scripts/state-log.mjs";
import {runStateReadLog} from "../../../.agents/skills/code-implement/scripts/state-readlog.mjs";
import {formatIsoSeconds, formatLocalDate, formatLocalTime, resolveReadEventsPath, resolveStatePath} from "../../../.agents/skills/code-implement/scripts/state-utils.mjs";

describe("code-implement state scripts", () => {
    it("initializes a state file once and keeps it stable on rerun", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache");
            const now = new Date("2026-07-02T10:11:12.000Z");

            const created = runStateInit({cachePath, now});
            const statePath = resolveStatePath(cachePath).absolute;

            expect(created).toEqual({
                code: 0,
                stdout: `${resolveStatePath(cachePath).display} (created)\n`,
            });
            expect(readFileSync(statePath, "utf-8")).toContain(`- Utworzono: ${formatLocalDate(now)} ${formatLocalTime(now)}`);

            const rerun = runStateInit({cachePath, now});
            expect(rerun).toEqual({
                code: 0,
                stdout: `${resolveStatePath(cachePath).display} (exists)\n`,
            });
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("logs iterations and read entries in the expected sections", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache");
            const statePath = resolveStatePath(cachePath).absolute;
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

            expect(runStateReadLog(["rg", "foo"], {cachePath, now: new Date("2026-07-02T10:12:13.000Z")})).toEqual({code: 0});
            expect(runStateLog(["git", "diff", "--stat"], {cachePath, now: new Date("2026-07-02T10:13:14.000Z")})).toEqual({code: 0});

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
            const cachePath = path.join(tempRoot, "cache");
            const statePath = resolveStatePath(cachePath).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});

            expect(runStateLog(["rg", "foo"], {cachePath})).toEqual({
                code: 1,
                stderr: `ERROR: missing state file: ${statePath}\n`,
            });

            writeFileSync(statePath, "content\n", "utf-8");
            const readEventsPath = resolveReadEventsPath(cachePath).absolute;
            writeFileSync(readEventsPath, "{\"version\":1}\n", "utf-8");
            expect(runStateClear({cachePath})).toEqual({
                code: 0,
                stdout: `${resolveStatePath(cachePath).display} (cleared; ${resolveReadEventsPath(cachePath).display} cleared)\n`,
            });
            expect(existsSync(readEventsPath)).toBe(false);
            expect(runStateClear({cachePath})).toEqual({
                code: 0,
                stdout: `${resolveStatePath(cachePath).display} (missing; nothing to clear)\n`,
            });
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("writes a validated structured read event without raw message content in the sidecar", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache");
            const statePath = resolveStatePath(cachePath).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n\n### Dziennik iteracji\n", "utf-8");
            const now = new Date("2026-07-02T10:14:15.000Z");

            expect(runStateReadLog([
                "--purpose", "read-before-write",
                "--source", "parent",
                "--read-mode", "full",
                "--path", "src/example.mjs",
                "diff", "and", "current", "content",
            ], {cachePath, now})).toEqual({code: 0});

            const state = readFileSync(statePath, "utf-8");
            expect(state).toContain("[read-event] event=read purpose=read-before-write source=parent mode=full path=src/example.mjs");
            expect(state).toContain("diff and current content");

            const eventsPath = resolveReadEventsPath(cachePath).absolute;
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
            const cachePath = path.join(tempRoot, "cache");
            const readEventsPath = resolveReadEventsPath(cachePath).absolute;
            mkdirSync(path.dirname(readEventsPath), {recursive: true});
            writeFileSync(readEventsPath, "{\"version\":1}\n", "utf-8");

            expect(runStateClear({cachePath})).toEqual({
                code: 0,
                stdout: `${resolveReadEventsPath(cachePath).display} (cleared)\n`,
            });
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("rejects unknown structured read purposes without changing state or sidecar", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache");
            const statePath = resolveStatePath(cachePath).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n", "utf-8");

            expect(runStateReadLog([
                "--purpose", "unknown-purpose",
                "--path", "src/example.mjs",
            ], {cachePath})).toMatchObject({code: 1});
            expect(readFileSync(statePath, "utf-8")).toBe("### Dziennik odczytów\n");
            expect(existsSync(resolveReadEventsPath(cachePath).absolute)).toBe(false);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("does not update state.md when the structured sidecar cannot be appended", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache");
            const statePath = resolveStatePath(cachePath).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n", "utf-8");
            mkdirSync(resolveReadEventsPath(cachePath).absolute);
            const before = readFileSync(statePath, "utf-8");

            expect(() => runStateReadLog([
                "--purpose", "verification",
                "--path", "src/example.mjs",
            ], {cachePath})).toThrow();
            expect(readFileSync(statePath, "utf-8")).toBe(before);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("records report reuse as an event distinct from a file read", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "code-implement-state-test-"));
        try {
            const cachePath = path.join(tempRoot, "cache");
            const statePath = resolveStatePath(cachePath).absolute;
            mkdirSync(path.dirname(statePath), {recursive: true});
            writeFileSync(statePath, "### Dziennik odczytów\n", "utf-8");

            expect(runStateReadLog([
                "--event", "report-reuse",
                "--scope", "scout-report-42",
                "reuse", "validated", "report",
            ], {cachePath})).toEqual({code: 0});

            const event = JSON.parse(readFileSync(resolveReadEventsPath(cachePath).absolute, "utf-8"));
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
