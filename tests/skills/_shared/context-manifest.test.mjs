import {execFileSync, spawnSync} from "node:child_process";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

import {
    enrichContextManifest,
    getWorktreeFingerprint,
    renderContextManifestSummary,
    validateContextManifest,
    verifyContextManifest,
} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ZERO_SHA256 = "0".repeat(64);
const MANIFEST_TOOL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.agents/skills/_shared/scripts/context-manifest.mjs");

const validManifest = {
    version: 1,
    role: "primary",
    repository: "acme/project",
    branch: "feature/context-routing",
    head: "abc123",
    rules: ["AGENTS.md"],
    documentation: ["docs/README.md"],
    active_overrides: [],
    constraints: ["no secrets in manifest"],
    already_read: ["AGENTS.md"],
    omitted: ["docs/HANDOFF.md"],
    worktree: {
        staged_sha256: ZERO_SHA256,
        unstaged_sha256: ZERO_SHA256,
        untracked_sha256: ZERO_SHA256,
        combined_sha256: ZERO_SHA256,
    },
};

function git(cwd, ...args) {
    return execFileSync("git", args, {cwd, encoding: "utf8"}).trim();
}

function makeGitRepo() {
    const repo = mkdtempSync(path.join(os.tmpdir(), "context-manifest-git-"));
    mkdirSync(repo, {recursive: true});
    git(repo, "init", "--quiet");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "user.name", "Context Test");
    writeFileSync(path.join(repo, "tracked.txt"), "initial\n");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "--quiet", "-m", "initial");
    return repo;
}

describe("context manifest", () => {
    it("validates and summarizes a compact manifest", () => {
        expect(validateContextManifest(validManifest)).toEqual({valid: true, errors: []});
        expect(renderContextManifestSummary(validManifest)).toContain("context-manifest v1 (primary)");
    });

    it("rejects issue contents and invalid delegated roles", () => {
        const result = validateContextManifest({
            ...validManifest,
            role: "context-scout",
            issue_comments: ["full comment"],
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("role must be primary or context-refresher");
        expect(result.errors).toContain("manifest must not contain issue/comments/document contents");
    });

    it("requires all collection fields to be string arrays", () => {
        const result = validateContextManifest({...validManifest, rules: ["AGENTS.md", 42]});

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("rules must be an array of strings");
    });

    it("requires a complete worktree fingerprint block", () => {
        const missing = validateContextManifest({...validManifest, worktree: undefined});
        expect(missing.valid).toBe(false);
        expect(missing.errors).toContain("MANIFEST_REGENERATION_REQUIRED: regenerate the manifest with context-manifest.mjs write before prepare");
        expect(missing.errors).toContain("worktree must be an object");

        const malformed = validateContextManifest({
            ...validManifest,
            worktree: {...validManifest.worktree, staged_sha256: "not-a-sha256"},
        });
        expect(malformed.valid).toBe(false);
        expect(malformed.errors).toContain("worktree.staged_sha256 must be a lowercase sha256 hash");
    });

    it("rejects machine-specific paths and secret-like values", () => {
        const result = validateContextManifest({
            ...validManifest,
            rules: ["/home/user/project/AGENTS.md"],
            constraints: ["GH_TOKEN=ghp_example_secret_value"],
        });

        expect(result.valid).toBe(false);
        expect(result.errors).toContain("rules must contain repo-relative paths");
        expect(result.errors).toContain("manifest appears to contain a secret");
        expect(result.errors.some((error) => error.includes("category=github-token") && error.includes("field=$.constraints[0]"))).toBe(true);
        expect(result.errors.join("\n")).not.toContain("ghp_example_secret_value");
    });

    it("accepts task-plan, risk and path or branch slugs", () => {
        const result = validateContextManifest({
            ...validManifest,
            branch: "feature/task-plan-wp6-risk-review-sk-aaaaaaaaaaaaaaaaaaaa",
            rules: ["docs/plan/task-plan-wp6.md", "docs/sk-aaaaaaaaaaaaaaaaaaaa.md"],
            documentation: ["docs/README.md", "docs/task-plan/risk-review.md"],
            constraints: ["Documentation format: token: sk-<token>"],
        });

        expect(result.valid).toBe(true);
    });

    it("rejects an embedded private key while reporting only its category and field", () => {
        const key = [
            "-----BEGIN PRIVATE KEY-----",
            "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
            "-----END PRIVATE KEY-----",
        ].join("\\n");
        const result = validateContextManifest({
            ...validManifest,
            constraints: [`embedded JSON: {\"private_key\":\"${key}\"}`],
        });

        expect(result.valid).toBe(false);
        expect(result.errors.some((error) => error.includes("category=private-key") && error.includes("field=$.constraints[0]"))).toBe(true);
        expect(result.errors.join("\n")).not.toContain(key);
    });

    it("enriches missing repository metadata from git", () => {
        const calls = [];
        const manifest = enrichContextManifest({
            ...validManifest,
            repository: "",
            branch: "",
            head: "",
        }, {
            execFile: (_command, args) => {
                calls.push(args.join(" "));
                if (args[0] === "remote") { return "git@github.com:acme/project.git\n"; }
                if (args[0] === "branch") { return "feature/context-routing\n"; }
                if (args[0] === "rev-parse") { return "abc123\n"; }
                return "";
            },
            now: new Date("2026-07-14T12:00:00.000Z"),
        });

        expect(manifest).toMatchObject({
            repository: "acme/project",
            branch: "feature/context-routing",
            head: "abc123",
            generated_at: "2026-07-14T12:00:00.000Z",
        });
        expect(calls).toHaveLength(6);
        expect(manifest.worktree).toEqual({
            staged_sha256: EMPTY_SHA256,
            unstaged_sha256: EMPTY_SHA256,
            untracked_sha256: EMPTY_SHA256,
            combined_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        });
    });

    it("hashes empty, unstaged, staged and non-ignored untracked worktrees deterministically", () => {
        const repo = makeGitRepo();
        try {
            const empty = getWorktreeFingerprint({cwd: repo});
            expect(empty.staged_sha256).toBe(EMPTY_SHA256);
            expect(empty.unstaged_sha256).toBe(EMPTY_SHA256);
            expect(empty.untracked_sha256).toBe(EMPTY_SHA256);

            writeFileSync(path.join(repo, "tracked.txt"), "unstaged\n");
            const unstaged = getWorktreeFingerprint({cwd: repo});
            expect(unstaged.unstaged_sha256).not.toBe(empty.unstaged_sha256);
            expect(unstaged.staged_sha256).toBe(empty.staged_sha256);

            git(repo, "add", "tracked.txt");
            const staged = getWorktreeFingerprint({cwd: repo});
            expect(staged.staged_sha256).not.toBe(empty.staged_sha256);
            expect(staged.unstaged_sha256).toBe(empty.unstaged_sha256);

            writeFileSync(path.join(repo, "untracked.txt"), "untracked secret-shaped text\n");
            const untracked = getWorktreeFingerprint({cwd: repo});
            expect(untracked.untracked_sha256).not.toBe(empty.untracked_sha256);
            expect(untracked.combined_sha256).not.toBe(staged.combined_sha256);
            expect(JSON.stringify(untracked)).not.toContain("untracked secret-shaped text");
        } finally {
            rmSync(repo, {recursive: true, force: true});
        }
    });

    it("verify checks git metadata and worktree fingerprint", () => {
        const repo = makeGitRepo();
        try {
            const manifest = enrichContextManifest({
                ...validManifest,
                repository: "local/repository",
                branch: "",
                head: "",
            }, {cwd: repo});
            expect(verifyContextManifest(manifest, repo)).toEqual({valid: true, errors: []});

            const metadataStale = verifyContextManifest({...manifest, branch: "other-branch", head: "0".repeat(64)}, repo);
            expect(metadataStale.valid).toBe(false);
            expect(metadataStale.errors.some((error) => error.startsWith("branch:"))).toBe(true);
            expect(metadataStale.errors.some((error) => error.startsWith("head:"))).toBe(true);

            writeFileSync(path.join(repo, "untracked.txt"), "changed\n");
            const stale = verifyContextManifest(manifest, repo);
            expect(stale.valid).toBe(false);
            expect(stale.errors.some((error) => error.startsWith("worktree.untracked_sha256:"))).toBe(true);
            expect(stale.errors.some((error) => error.startsWith("worktree.combined_sha256:"))).toBe(true);
            expect(readFileSync(path.join(repo, "untracked.txt"), "utf8")).toBe("changed\n");
        } finally {
            rmSync(repo, {recursive: true, force: true});
        }
    });

    it("verifies a manifest through the CLI and rejects a changed worktree", () => {
        const repo = makeGitRepo();
        const manifestPath = path.join(os.tmpdir(), `context-manifest-${process.pid}-${Date.now()}.json`);
        try {
            const manifest = enrichContextManifest({
                ...validManifest,
                repository: "local/repository",
                branch: "",
                head: "",
            }, {cwd: repo});
            writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);

            const current = spawnSync(process.execPath, [MANIFEST_TOOL, "verify", manifestPath], {
                cwd: repo,
                encoding: "utf8",
            });
            expect(current.status).toBe(0);
            expect(current.stdout).toContain("context manifest: current");

            writeFileSync(path.join(repo, "untracked.txt"), "drift\n");
            const stale = spawnSync(process.execPath, [MANIFEST_TOOL, "verify", manifestPath], {
                cwd: repo,
                encoding: "utf8",
            });
            expect(stale.status).not.toBe(0);
            expect(stale.stderr).toContain("worktree.untracked_sha256");
        } finally {
            rmSync(manifestPath, {force: true});
            rmSync(repo, {recursive: true, force: true});
        }
    });
});
