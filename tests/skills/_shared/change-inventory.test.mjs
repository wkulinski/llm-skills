import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync, spawnSync} from "node:child_process";
import {describe, it} from "vitest";
import {buildChangeInventory, getWorktreeFingerprint} from "../../../.agents/skills/_shared/scripts/change-inventory.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const SCRIPT = path.join(ROOT, ".agents/skills/_shared/scripts/change-inventory.mjs");

function git(cwd, args) {
    execFileSync("git", args, {cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
}

function temporaryRepository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "change-inventory-"));
    git(root, ["init", "--quiet"]);
    git(root, ["config", "user.name", "Test User"]);
    git(root, ["config", "user.email", "test@example.invalid"]);
    fs.writeFileSync(path.join(root, "tracked.txt"), "base\n", "utf8");
    git(root, ["add", "."]);
    git(root, ["commit", "--quiet", "-m", "initial"]);
    return root;
}

function withRepository(callback) {
    const root = temporaryRepository();
    try {
        return callback(root);
    } finally {
        fs.rmSync(root, {force: true, recursive: true});
    }
}

describe("change inventory", () => {
    it("returns four SHA256 hashes and is deterministic", () => {
        withRepository((root) => {
            const first = getWorktreeFingerprint({cwd: root});
            const second = getWorktreeFingerprint({cwd: root});
            const SHA256 = /^[a-f0-9]{64}$/;

            assert.deepEqual(first, second);
            assert.match(first.staged_sha256, SHA256);
            assert.match(first.unstaged_sha256, SHA256);
            assert.match(first.untracked_sha256, SHA256);
            assert.match(first.combined_sha256, SHA256);
        });
    });

    it("keeps staged and unstaged surfaces for the same file", () => {
        withRepository((root) => {
            fs.writeFileSync(path.join(root, "tracked.txt"), "staged\n", "utf8");
            git(root, ["add", "tracked.txt"]);
            fs.writeFileSync(path.join(root, "tracked.txt"), "staged\nworktree\n", "utf8");

            const inventory = buildChangeInventory({cwd: root});
            const file = inventory.files.find((entry) => entry.path === "tracked.txt");

            assert.equal(file.status, "staged+unstaged");
            assert.deepEqual(file.staged, {git_status: "M", insertions: 1, deletions: 1});
            assert.deepEqual(file.unstaged, {git_status: "M", insertions: 1, deletions: 0});
            assert.equal(inventory.stats.staged_files, 1);
            assert.equal(inventory.stats.unstaged_files, 1);
            assert.equal(inventory.stats.tracked_insertions, 2);
            assert.equal(inventory.stats.tracked_deletions, 1);
        });
    });

    it("parses renames as separate paths and preserves spaces", () => {
        withRepository((root) => {
            git(root, ["mv", "tracked.txt", "renamed file.txt"]);
            const inventory = buildChangeInventory({cwd: root});
            const paths = inventory.files.map((file) => file.path);

            assert.deepEqual(paths, ["renamed file.txt", "tracked.txt"]);
            assert.equal(paths.some((filePath) => filePath.includes(" -> ")), false);
            assert.equal(inventory.files.find((file) => file.path === "renamed file.txt").status, "staged");
            assert.equal(inventory.files.find((file) => file.path === "tracked.txt").status, "staged");
        });
    });

    it("does not pretend untracked files have diff statistics", () => {
        withRepository((root) => {
            fs.writeFileSync(path.join(root, "new file.txt"), "one\ntwo\n", "utf8");
            const inventory = buildChangeInventory({cwd: root});
            const file = inventory.files.find((entry) => entry.path === "new file.txt");

            assert.equal(file.status, "untracked");
            assert.equal(file.staged, null);
            assert.equal(file.unstaged, null);
            assert.deepEqual(file.untracked, {kind: "file"});
            assert.equal(inventory.stats.untracked_files, 1);
            assert.equal(inventory.stats.tracked_insertions, 0);
            assert.equal(inventory.stats.tracked_deletions, 0);
        });
    });

    it("labels untracked symlinks with kind symlink", () => {
        withRepository((root) => {
            fs.writeFileSync(path.join(root, "target.txt"), "target\n", "utf8");
            fs.symlinkSync("target.txt", path.join(root, "link.txt"));

            const inventory = buildChangeInventory({cwd: root});
            const file = inventory.files.find((entry) => entry.path === "link.txt");

            assert.equal(file.status, "untracked");
            assert.equal(file.staged, null);
            assert.equal(file.unstaged, null);
            assert.deepEqual(file.untracked, {kind: "symlink"});
            assert.equal(inventory.stats.untracked_files, 2);
            const target = inventory.files.find((entry) => entry.path === "target.txt");
            assert.deepEqual(target.untracked, {kind: "file"});
        });
    });

    it("keeps staged and untracked surfaces distinct for the same path", () => {
        withRepository((root) => {
            git(root, ["rm", "--cached", "--quiet", "tracked.txt"]);
            fs.writeFileSync(path.join(root, "tracked.txt"), "replacement\n", "utf8");

            const inventory = buildChangeInventory({cwd: root});
            const file = inventory.files.find((entry) => entry.path === "tracked.txt");

            assert.equal(file.status, "staged+untracked");
            assert.deepEqual(file.staged, {git_status: "D", insertions: 0, deletions: 1});
            assert.equal(file.unstaged, null);
            assert.deepEqual(file.untracked, {kind: "file"});
            assert.equal(inventory.stats.staged_files, 1);
            assert.equal(inventory.stats.untracked_files, 1);
        });
    });

    it("resolves the repository root when invoked from a subdirectory", () => {
        withRepository((root) => {
            const sub = path.join(root, "sub");
            fs.mkdirSync(sub);
            fs.writeFileSync(path.join(sub, "sub.txt"), "sub\n", "utf8");
            git(root, ["add", "sub/sub.txt"]);
            git(root, ["commit", "--quiet", "-m", "add sub"]);
            fs.writeFileSync(path.join(root, "root-new.txt"), "root untracked\n", "utf8");
            fs.writeFileSync(path.join(sub, "sub-new.txt"), "sub untracked\n", "utf8");
            fs.writeFileSync(path.join(sub, "sub.txt"), "sub changed\n", "utf8");

            const inventory = buildChangeInventory({cwd: sub});
            const paths = inventory.files.map((file) => file.path);
            assert.equal(inventory.stats.untracked_files, 2);
            assert.ok(paths.includes("root-new.txt"), "root-level untracked file missing");
            assert.ok(paths.includes("sub/sub-new.txt"), "subdir untracked file missing");
            assert.ok(paths.includes("sub/sub.txt"), "tracked subdir file missing");
        });
    });

    it("fingerprints raw content changes even when textconv is configured", () => {
        withRepository((root) => {
            fs.writeFileSync(path.join(root, ".gitattributes"), "*.bin diff=constant\n", "utf8");
            fs.writeFileSync(path.join(root, "textconv.sh"), "#!/usr/bin/env bash\nprintf 'constant\\n'\n", "utf8");
            fs.chmodSync(path.join(root, "textconv.sh"), 0o755);
            git(root, ["config", "diff.constant.textconv", path.join(root, "textconv.sh")]);
            fs.writeFileSync(path.join(root, "file.bin"), "before\0data", "utf8");
            git(root, ["add", "."]);
            git(root, ["commit", "--quiet", "-m", "initial binary"]);

            const empty = getWorktreeFingerprint({cwd: root});

            fs.writeFileSync(path.join(root, "file.bin"), "after\0data", "utf8");
            const changed = getWorktreeFingerprint({cwd: root});
            assert.notEqual(changed.unstaged_sha256, empty.unstaged_sha256);

            fs.writeFileSync(path.join(root, "file.bin"), "final\0data", "utf8");
            const changedAgain = getWorktreeFingerprint({cwd: root});
            assert.notEqual(changedAgain.unstaged_sha256, changed.unstaged_sha256);

            const inventory = buildChangeInventory({cwd: root});
            const file = inventory.files.find((entry) => entry.path === "file.bin");
            assert.ok(file, "file.bin missing from inventory");
            assert.equal(file.status, "unstaged");
            assert.deepEqual(file.unstaged, {git_status: "M", insertions: null, deletions: null});
        });
    });

    it("fails instead of treating a non-repository as an empty inventory", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "change-inventory-invalid-"));
        try {
            assert.throws(() => buildChangeInventory({cwd: root}), /Git command failed/);
        } finally {
            fs.rmSync(root, {force: true, recursive: true});
        }
    });

    it("builds the CLI output directory when necessary", () => {
        withRepository((root) => {
            const outputPath = path.join(root, "nested", "inventory.json");
            const result = spawnSync(process.execPath, [SCRIPT, "build", "--output", outputPath], {
                cwd: root,
                encoding: "utf8",
            });

            assert.equal(result.status, 0, result.stderr);
            const inventory = JSON.parse(fs.readFileSync(outputPath, "utf8"));
            assert.equal(inventory.stats.total, 0);
            assert.ok(Array.isArray(inventory.files));
        });
    });

    it("shows CLI usage", () => {
        const result = spawnSync(process.execPath, [SCRIPT, "--help"], {encoding: "utf8"});

        assert.equal(result.status, 0);
        assert.match(result.stdout, /Usage:/);
        assert.match(result.stdout, /build/);
    });
});
