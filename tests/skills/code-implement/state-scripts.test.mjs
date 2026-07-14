import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {runStateClear} from "../../../.agents/skills/code-implement/scripts/state-clear.mjs";
import {runStateInit} from "../../../.agents/skills/code-implement/scripts/state-init.mjs";
import {runStateLog} from "../../../.agents/skills/code-implement/scripts/state-log.mjs";
import {runStateReadLog} from "../../../.agents/skills/code-implement/scripts/state-readlog.mjs";
import {formatIsoSeconds, formatLocalDate, formatLocalTime, resolveStatePath} from "../../../.agents/skills/code-implement/scripts/state-utils.mjs";

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
            expect(runStateClear({cachePath})).toEqual({
                code: 0,
                stdout: `${resolveStatePath(cachePath).display} (cleared)\n`,
            });
            expect(runStateClear({cachePath})).toEqual({
                code: 0,
                stdout: `${resolveStatePath(cachePath).display} (missing; nothing to clear)\n`,
            });
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
