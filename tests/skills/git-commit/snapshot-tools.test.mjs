import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {describe, expect, it} from "vitest";

import {
    createSnapshot,
    listSnapshotDelta,
    readPointer,
    resolveSnapshotDir,
    showSnapshotDelta,
    splitLines,
    uniqueSorted,
} from "../../../.agents/skills/git-commit/scripts/snapshot-tools.mjs";

describe("snapshot tools", () => {
    it("splits lines and resolves unique sorted values", () => {
        expect(splitLines("a\n\n b \n")).toEqual(["a", "b"]);
        expect(uniqueSorted(["b", "a", "a"])).toEqual(["a", "b"]);
    });

    it("reuses a valid snapshot pointer and creates a new directory when requested", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-tools-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(repoRoot);
            const pointerFile = path.join(tempRoot, "pointer.txt");
            const existingSnapshot = path.join(tempRoot, "snapshot-existing");
            mkdirSync(existingSnapshot);
            writeFileSync(pointerFile, `repo_root=${repoRoot}\nsnapshot_dir=${existingSnapshot}\n`, "utf-8");

            expect(readPointer(pointerFile, repoRoot)).toBe(existingSnapshot);

            const created = resolveSnapshotDir({
                forceNew: true,
                now: new Date("2026-07-01T10:00:00.000Z"),
                pointerFile,
                randomHex: () => "deadbeef",
                repoRoot,
            });
            expect(created).toBe("/tmp/agent-git-commit-snapshot-20260701-100000-deadbeef");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("creates a snapshot with copied files and metadata", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-create-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(path.join(repoRoot, "src"), {recursive: true});
            writeFileSync(path.join(repoRoot, "src", "file.txt"), "hello\n", "utf-8");
            const pointerFile = path.join(tempRoot, "pointer.txt");

            const execCommand = (command, args) => {
                const key = args.join(" ");
                if (key.includes("status -sb")) {
                    return {status: 0, stdout: "## main\n", stderr: ""};
                }
                if (key.includes("rev-parse HEAD")) {
                    return {status: 0, stdout: "base-head\n", stderr: ""};
                }
                if (key.includes("diff --name-only")) {
                    return {status: 0, stdout: "src/file.txt\n", stderr: ""};
                }
                if (key.includes("ls-files --others --exclude-standard")) {
                    return {status: 0, stdout: "notes.txt\n", stderr: ""};
                }
                throw new Error(`Unexpected command: ${command} ${key}`);
            };

            const snapshotDir = createSnapshot({
                execCommand,
                now: new Date("2026-07-01T10:00:00.000Z"),
                pointerFile,
                randomHex: () => "deadbeef",
                repoRoot,
            });

            expect(snapshotDir).toBe("/tmp/agent-git-commit-snapshot-20260701-100000-deadbeef");
            expect(readFileSync(path.join(snapshotDir, "base-head.txt"), "utf-8")).toBe("base-head\n");
            expect(readFileSync(path.join(snapshotDir, "files", "src", "file.txt"), "utf-8")).toBe("hello\n");
            expect(readFileSync(path.join(snapshotDir, "missing-at-snapshot.txt"), "utf-8")).toBe("notes.txt\n");
            expect(readFileSync(pointerFile, "utf-8")).toContain(`snapshot_dir=${snapshotDir}`);
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("lists delta files from snapshot and current state", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-delta-list-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(path.join(repoRoot, "src"), {recursive: true});
            writeFileSync(path.join(repoRoot, "src", "modified.txt"), "now\n", "utf-8");
            writeFileSync(path.join(repoRoot, "src", "new.txt"), "new\n", "utf-8");
            const snapshotDir = path.join(tempRoot, "snapshot");
            mkdirSync(path.join(snapshotDir, "files", "src"), {recursive: true});
            writeFileSync(path.join(snapshotDir, "base-head.txt"), "base-head\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "changed-tracked.txt"), "src/modified.txt\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "untracked.txt"), "src/untracked.txt\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "files", "src", "modified.txt"), "old\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "files", "src", "untracked.txt"), "old-untracked\n", "utf-8");

            const execCommand = (command, args) => {
                const key = args.join(" ");
                if (key.includes("diff --name-only")) {
                    return {status: 0, stdout: "src/modified.txt\nsrc/new.txt\n", stderr: ""};
                }
                if (key.includes("ls-files --others --exclude-standard")) {
                    return {status: 0, stdout: "src/untracked.txt\n", stderr: ""};
                }
                throw new Error(`Unexpected command: ${command} ${key}`);
            };

            const output = listSnapshotDelta({
                execCommand,
                repoRoot,
                snapshotDir,
            });

            expect(output).toBe([
                "DELTA_PRESENT",
                "- src/modified.txt",
                "- src/new.txt",
                "- src/untracked.txt",
                "",
            ].join("\n"));
            expect(readFileSync(path.join(snapshotDir, "delta-all.txt"), "utf-8")).toBe([
                "src/modified.txt",
                "src/new.txt",
                "src/untracked.txt",
                "",
            ].join("\n"));
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("does not report a file deleted before the snapshot as a new delta", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-predeleted-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(repoRoot);
            const snapshotDir = path.join(tempRoot, "snapshot");
            mkdirSync(snapshotDir, {recursive: true});
            writeFileSync(path.join(snapshotDir, "base-head.txt"), "base-head\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "changed-tracked.txt"), "src/deleted.txt\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "untracked.txt"), "", "utf-8");
            writeFileSync(path.join(snapshotDir, "missing-at-snapshot.txt"), "src/deleted.txt\n", "utf-8");

            const execCommand = (command, args) => {
                const key = args.join(" ");
                if (key.includes("diff --name-only")) {
                    return {status: 0, stdout: "src/deleted.txt\n", stderr: ""};
                }
                if (key.includes("ls-files --others --exclude-standard")) {
                    return {status: 0, stdout: "", stderr: ""};
                }
                throw new Error(`Unexpected command: ${command} ${key}`);
            };

            expect(listSnapshotDelta({execCommand, repoRoot, snapshotDir})).toBe("DELTA_EMPTY\n");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports a file restored after being deleted before the snapshot", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-restored-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(path.join(repoRoot, "src"), {recursive: true});
            writeFileSync(path.join(repoRoot, "src", "restored.txt"), "restored\n", "utf-8");
            const snapshotDir = path.join(tempRoot, "snapshot");
            mkdirSync(snapshotDir, {recursive: true});
            writeFileSync(path.join(snapshotDir, "base-head.txt"), "base-head\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "changed-tracked.txt"), "src/restored.txt\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "untracked.txt"), "", "utf-8");
            writeFileSync(path.join(snapshotDir, "missing-at-snapshot.txt"), "src/restored.txt\n", "utf-8");

            const execCommand = (command, args) => {
                const key = args.join(" ");
                if (key.includes("diff --name-only")) {
                    return {status: 0, stdout: "", stderr: ""};
                }
                if (key.includes("ls-files --others --exclude-standard")) {
                    return {status: 0, stdout: "", stderr: ""};
                }
                throw new Error(`Unexpected command: ${command} ${key}`);
            };

            expect(listSnapshotDelta({execCommand, repoRoot, snapshotDir})).toBe("DELTA_PRESENT\n- src/restored.txt\n");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("reports a file deleted after the snapshot", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-postdeleted-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(repoRoot);
            const snapshotDir = path.join(tempRoot, "snapshot");
            mkdirSync(path.join(snapshotDir, "files", "src"), {recursive: true});
            writeFileSync(path.join(snapshotDir, "base-head.txt"), "base-head\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "changed-tracked.txt"), "src/deleted.txt\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "untracked.txt"), "", "utf-8");
            writeFileSync(path.join(snapshotDir, "files", "src", "deleted.txt"), "before\n", "utf-8");

            const execCommand = (command, args) => {
                const key = args.join(" ");
                if (key.includes("diff --name-only")) {
                    return {status: 0, stdout: "src/deleted.txt\n", stderr: ""};
                }
                if (key.includes("ls-files --others --exclude-standard")) {
                    return {status: 0, stdout: "", stderr: ""};
                }
                throw new Error(`Unexpected command: ${command} ${key}`);
            };

            expect(listSnapshotDelta({execCommand, repoRoot, snapshotDir})).toBe("DELTA_PRESENT\n- src/deleted.txt\n");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("shows diffs for a listed file", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-delta-show-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(path.join(repoRoot, "src"), {recursive: true});
            writeFileSync(path.join(repoRoot, "src", "file.txt"), "new line\n", "utf-8");
            const snapshotDir = path.join(tempRoot, "snapshot");
            mkdirSync(path.join(snapshotDir, "files", "src"), {recursive: true});
            writeFileSync(path.join(snapshotDir, "base-head.txt"), "base-head\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "delta-all.txt"), "src/file.txt\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "files", "src", "file.txt"), "old line\n", "utf-8");

            const output = showSnapshotDelta({
                repoRoot,
                snapshotDir,
                target: "src/file.txt",
            });

            expect(output).toContain("File: src/file.txt");
            expect(output).toContain("-old line");
            expect(output).toContain("+new line");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });

    it("shows all listed diffs from delta-all", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "snapshot-delta-show-all-vitest-"));
        try {
            const repoRoot = path.join(tempRoot, "repo");
            mkdirSync(path.join(repoRoot, "src"), {recursive: true});
            writeFileSync(path.join(repoRoot, "src", "file.txt"), "new line\n", "utf-8");
            const snapshotDir = path.join(tempRoot, "snapshot");
            mkdirSync(path.join(snapshotDir, "files", "src"), {recursive: true});
            writeFileSync(path.join(snapshotDir, "base-head.txt"), "base-head\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "delta-all.txt"), "src/file.txt\n", "utf-8");
            writeFileSync(path.join(snapshotDir, "files", "src", "file.txt"), "old line\n", "utf-8");

            const output = showSnapshotDelta({
                repoRoot,
                snapshotDir,
                target: "--all",
            });

            expect(output).toContain("File: src/file.txt");
            expect(output).toContain("+new line");
        } finally {
            rmSync(tempRoot, {force: true, recursive: true});
        }
    });
});
