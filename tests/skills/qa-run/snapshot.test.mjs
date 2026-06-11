import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";

import {
    assertSnapshotRepoRoot,
    detectChangedFilesFromSnapshot,
    fingerprintEquals,
    loadSnapshot,
    validateSnapshot,
} from "../../../.agents/skills/qa-run/scripts/run-matrix/change-detection/snapshot.mjs";

const tempRoots = [];

afterEach(() => {
    while (tempRoots.length > 0) {
        const tempRoot = tempRoots.pop();
        rmSync(tempRoot, {force: true, recursive: true});
    }
});

describe("snapshot change detection", () => {
    it("compares missing and present file fingerprints", () => {
        expect(fingerprintEquals(null, null)).toBe(true);
        expect(fingerprintEquals(void 0, void 0)).toBe(true);
        expect(fingerprintEquals(null, {exists: true, hash: "abc"})).toBe(false);
        expect(fingerprintEquals({exists: false, hash: null}, {exists: false, hash: null})).toBe(true);
        expect(fingerprintEquals({exists: true, hash: "abc"}, {exists: true, hash: "abc"})).toBe(true);
        expect(fingerprintEquals({exists: true, hash: "abc"}, {exists: true, hash: "def"})).toBe(false);
        expect(fingerprintEquals({exists: true, hash: "abc"}, {exists: false, hash: null})).toBe(false);
    });

    it("detects added, deleted, and modified files from snapshot state", () => {
        const snapshot = {
            files: {
                "deleted.mjs": {exists: true, hash: "old-deleted"},
                "modified.mjs": {exists: true, hash: "old-modified"},
                "same.mjs": {exists: true, hash: "same"},
            },
        };
        const currentState = {
            files: {
                "added.mjs": {exists: true, hash: "new-added"},
                "modified.mjs": {exists: true, hash: "new-modified"},
                "same.mjs": {exists: true, hash: "same"},
            },
        };

        expect(detectChangedFilesFromSnapshot(currentState, snapshot)).toEqual([
            "added.mjs",
            "deleted.mjs",
            "modified.mjs",
        ]);
    });

    it("rejects unsupported snapshot versions", () => {
        expect(() => validateSnapshot({
            version: 999,
            files: {},
        }, "snapshot.json")).toThrow("Unsupported snapshot version");
    });

    it("rejects invalid JSON snapshot files", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "qa-run-snapshot-vitest-"));
        tempRoots.push(tempRoot);
        const snapshotPath = path.join(tempRoot, "snapshot.json");
        writeFileSync(snapshotPath, "{not-json\n", "utf-8");

        expect(() => loadSnapshot(snapshotPath)).toThrow("Invalid JSON snapshot");
    });

    it("rejects snapshots from a different repo root", () => {
        expect(() => assertSnapshotRepoRoot({
            repoRoot: "/different/repo",
        }, "/current/repo")).toThrow("Snapshot repo root mismatch: /different/repo != /current/repo");
    });
});
