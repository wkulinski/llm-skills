import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
    acceptResult,
    bindSession,
    jobDirectory,
    prepareJob,
    recordTimeout,
} from "../../../.agents/skills/claude-review/scripts/review-job.mjs";

const JOB_ID = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
const PARENT_ID = "17f0c96b-135c-400a-86d6-e5698b0a2a2c";
const SESSION_ID = "5b50c09c-8c97-4034-8ea0-3f34f38ba8ea";

let repo;

function git(args) {
    return execFileSync("git", args, {cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
}

function write(relativePath, content) {
    fs.mkdirSync(path.dirname(path.join(repo, relativePath)), {recursive: true});
    fs.writeFileSync(path.join(repo, relativePath), content);
}

function prepare(overrides = {}) {
    return prepareJob({
        jobId: JOB_ID,
        requirements: path.join(repo, "requirements.md"),
        model: "claude-opus-5-5",
        thinking: "low",
        timeoutSeconds: "60",
        ...overrides,
    }, {cwd: repo});
}

function inspect(overrides = {}) {
    return {
        Id: SESSION_ID,
        Provider: "claude",
        Model: "claude-opus-5-5",
        Thinking: "low",
        Cwd: repo,
        ParentAgentId: PARENT_ID,
        PendingPermissions: [],
        ...overrides,
    };
}

function jobPath() {
    return path.join(jobDirectory(repo, JOB_ID), "job.json");
}

function envelope(job, overrides = {}) {
    return JSON.stringify({
        version: 1,
        job_id: job.job_id,
        snapshot: job.snapshot,
        status: "COMPLETE",
        report_markdown: "No findings.\n\n### Verdict\n\nPASS — reviewed.",
        ...overrides,
    });
}

function preparedAndBound() {
    prepare();
    bindSession({jobPath: jobPath(), inspect: inspect(), parentId: PARENT_ID});
    return JSON.parse(fs.readFileSync(jobPath(), "utf8"));
}

beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claude-review-job-")));
    git(["init", "--quiet"]);
    git(["config", "user.name", "Test User"]);
    git(["config", "user.email", "test@example.invalid"]);
    write(".gitignore", "/var/\n/requirements.md\n");
    write("staged.txt", "base\n");
    write("unstaged.txt", "base\n");
    git(["add", "."]);
    git(["commit", "--quiet", "-m", "initial"]);
    write("requirements.md", "Sum must ignore negative numbers.\n");
    write("staged.txt", "staged change\n");
    git(["add", "staged.txt"]);
    write("unstaged.txt", "unstaged change\n");
    write("new-file.txt", "untracked\n");
});

afterEach(() => {
    fs.rmSync(repo, {force: true, recursive: true});
});

describe("claude-review job preparation", () => {
    it("separates staged, unstaged and untracked surfaces and records hashes", () => {
        const result = prepare();
        const job = JSON.parse(fs.readFileSync(jobPath(), "utf8"));
        const directory = jobDirectory(repo, JOB_ID);

        expect(result.job_path).toBe(`var/agent/cache/claude-review/${JOB_ID}/job.json`);
        expect(fs.readFileSync(path.join(directory, "staged.diff"), "utf8")).toContain("+staged change");
        expect(fs.readFileSync(path.join(directory, "staged.diff"), "utf8")).not.toContain("unstaged change");
        expect(fs.readFileSync(path.join(directory, "unstaged.diff"), "utf8")).toContain("+unstaged change");
        expect(fs.readFileSync(path.join(directory, "untracked.txt"), "utf8")).toBe("new-file.txt\n");
        expect(job.snapshot.head).toBe(git(["rev-parse", "HEAD"]).trim());
        expect(job.snapshot.combined_sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(Object.keys(job.inputs)).toEqual(["inventory.json", "staged.diff", "unstaged.diff", "untracked.txt", "requirements.md", "prompt.md"]);
        expect(job.parameters).toEqual({provider: "claude", model: "claude-opus-5-5", thinking: "low", timeout_seconds: 60});
    });

    it("rejects an invalid job id before resolving a cache path", () => {
        expect(() => prepare({jobId: "../escape"})).toThrow(expect.objectContaining({code: "INVALID_JOB_ID"}));
        expect(fs.existsSync(path.join(repo, "var"))).toBe(false);
    });

    it("requires explicit model, thinking and a positive timeout", () => {
        expect(() => prepare({model: ""})).toThrow(expect.objectContaining({code: "INVALID_PARAMETERS"}));
        expect(() => prepare({thinking: ""})).toThrow(expect.objectContaining({code: "INVALID_PARAMETERS"}));
        expect(() => prepare({timeoutSeconds: "0"})).toThrow(expect.objectContaining({code: "INVALID_PARAMETERS"}));
    });

    it("allows exactly one attempt per job id", () => {
        prepare();
        expect(() => prepare()).toThrow(expect.objectContaining({code: "JOB_EXISTS"}));
    });

    it("keeps sensitive diffs out of the job and reports the coverage limit", () => {
        write("unstaged.txt", "token=ghp_Zx9Kq2Lm7Np4Rs8Tv1Wy6Bc3Df5Gh0Jk2Mn4P\n");
        const result = prepare();
        const directory = jobDirectory(repo, JOB_ID);

        expect(result.omitted_sensitive).toEqual([{surface: "unstaged", path: "unstaged.txt"}]);
        expect(fs.readFileSync(path.join(directory, "unstaged.diff"), "utf8")).toBe("");
        expect(fs.readFileSync(path.join(directory, "prompt.md"), "utf8")).toContain("omitted as sensitive");
    });
});

describe("claude-review session binding", () => {
    it("binds a session launched by the parent in the reviewed repository", () => {
        prepare();
        expect(bindSession({jobPath: jobPath(), inspect: inspect(), parentId: PARENT_ID}).session.id).toBe(SESSION_ID);
    });

    it.each([
        ["parent", {ParentAgentId: "other-parent"}],
        ["model", {Model: "claude-sonnet-5-5"}],
        ["provider", {Provider: "codex"}],
        ["cwd", {Cwd: os.tmpdir()}],
    ])("rejects a session with a foreign %s", (_, override) => {
        prepare();
        expect(() => bindSession({jobPath: jobPath(), inspect: inspect(override), parentId: PARENT_ID}))
            .toThrow(expect.objectContaining({code: "SESSION_MISMATCH"}));
    });

    it("refuses a second session for the same job", () => {
        preparedAndBound();
        expect(() => bindSession({jobPath: jobPath(), inspect: inspect(), parentId: PARENT_ID}))
            .toThrow(expect.objectContaining({code: "SESSION_ALREADY_BOUND"}));
    });
});

describe("claude-review result acceptance", () => {
    it("accepts a matching envelope as a report to evaluate, not as a verdict", () => {
        const job = preparedAndBound();
        const result = acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect()});

        expect(result).toMatchObject({decision: "ACCEPTED", status: "COMPLETE"});
        expect(result.report_markdown).toContain("No findings.");
    });

    it.each([
        ["another job", (job) => envelope(job, {job_id: "00000000-0000-4000-8000-000000000000"}), "JOB_MISMATCH"],
        ["another snapshot", (job) => envelope(job, {snapshot: {...job.snapshot, combined_sha256: "0".repeat(64)}}), "SNAPSHOT_MISMATCH"],
        ["text around JSON", (job) => `Here is the result: ${envelope(job)}`, "REPORT_INVALID"],
        ["an empty report", (job) => envelope(job, {report_markdown: " "}), "REPORT_INVALID"],
        ["an unknown status", (job) => envelope(job, {status: "PASS"}), "REPORT_INVALID"],
    ])("rejects an envelope with %s", (_, build, reason) => {
        const job = preparedAndBound();
        expect(acceptResult({jobPath: jobPath(), envelopeText: build(job), inspect: inspect()}))
            .toMatchObject({decision: "REJECTED", reason});
    });

    it("rejects a report from a different session", () => {
        const job = preparedAndBound();
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect({Id: "other-session"})}))
            .toMatchObject({decision: "REJECTED", reason: "SESSION_MISMATCH"});
    });

    it("rejects a report when a prepared input changed", () => {
        const job = preparedAndBound();
        fs.appendFileSync(path.join(jobDirectory(repo, JOB_ID), "requirements.md"), "extra\n");
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect()}))
            .toMatchObject({decision: "REJECTED", reason: "INPUT_CHANGED"});
    });

    it("blocks while a permission request is pending", () => {
        const job = preparedAndBound();
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect({PendingPermissions: [{tool: "Bash"}]})}))
            .toMatchObject({decision: "BLOCKED", reason: "PERMISSION_PENDING"});
    });

    it("marks the report stale when the change surface moves", () => {
        const job = preparedAndBound();
        write("unstaged.txt", "edited during review\n");
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect()}))
            .toMatchObject({decision: "STALE", reason: "SNAPSHOT_CHANGED"});
    });

    it("marks the report stale when HEAD moves even with an identical change fingerprint", () => {
        git(["stash", "--include-untracked", "--quiet"]);
        prepare();
        bindSession({jobPath: jobPath(), inspect: inspect(), parentId: PARENT_ID});
        const job = JSON.parse(fs.readFileSync(jobPath(), "utf8"));
        git(["commit", "--quiet", "--allow-empty", "-m", "next"]);

        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect()}))
            .toMatchObject({decision: "STALE", reason: "SNAPSHOT_CHANGED"});
    });
});

describe("claude-review timeout", () => {
    it("records a confirmed stop as INCOMPLETE without a retry", () => {
        preparedAndBound();
        expect(recordTimeout({jobPath: jobPath(), stopConfirmed: true}))
            .toEqual({status: "INCOMPLETE", reason: "TIMEOUT_STOPPED", retry_allowed: false});
    });

    it("blocks any new job while a stop remains unconfirmed", () => {
        preparedAndBound();
        expect(recordTimeout({jobPath: jobPath(), stopConfirmed: false}))
            .toEqual({status: "BLOCKED", reason: "TIMEOUT_STOP_UNCONFIRMED", retry_allowed: false});
        expect(() => prepare({jobId: "7f1c2d3e-4a5b-4c6d-8e7f-901234567890"}))
            .toThrow(expect.objectContaining({code: "UNCONFIRMED_STOP_PENDING"}));
    });
});
