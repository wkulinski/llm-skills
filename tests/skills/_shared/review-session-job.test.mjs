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
    readProjectConfig,
    recordFailure,
    resolveAttempts,
} from "../../../.agents/skills/_shared/scripts/review-session-job.mjs";

const JOB_ID = "6f1c2d3e-4a5b-4c6d-8e7f-901234567890";
const PARENT_ID = "17f0c96b-135c-400a-86d6-e5698b0a2a2c";
const MAIN_SESSION = "5b50c09c-8c97-4034-8ea0-3f34f38ba8ea";
const FALLBACK_SESSION = "9c1d2e3f-8c97-4034-8ea0-3f34f38ba8eb";
const SKILLS_ROOT = path.resolve(import.meta.dirname, "../../../.agents/skills");

const BOTH = {
    PLAN_REVIEW_1_HARNESS: "claude",
    PLAN_REVIEW_1_MODEL: "claude-opus-5-5",
    PLAN_REVIEW_1_THINKING: "high",
    PLAN_REVIEW_1_MODE: "auto",
    PLAN_REVIEW_2_HARNESS: "codex",
    PLAN_REVIEW_2_MODEL: "gpt-6.1-sol",
    PLAN_REVIEW_2_THINKING: "high",
    PLAN_REVIEW_2_MODE: "auto-review",
};

let repo;

function write(relativePath, content) {
    fs.mkdirSync(path.dirname(path.join(repo, relativePath)), {recursive: true});
    fs.writeFileSync(path.join(repo, relativePath), content);
}

function prepare(config = BOTH, overrides = {}) {
    return prepareJob({
        prefix: "PLAN_REVIEW",
        kind: "plan-review",
        jobId: JOB_ID,
        task: path.join(repo, "task.md"),
        context: [path.join(repo, "docs/plans/plan.md")],
        ...overrides,
    }, {cwd: repo, readConfig: () => config});
}

function jobPath() {
    return path.join(jobDirectory(repo, JOB_ID), "job.json");
}

function readJob() {
    return JSON.parse(fs.readFileSync(jobPath(), "utf8"));
}

function inspect(overrides = {}) {
    return {
        Id: MAIN_SESSION,
        Provider: "claude",
        Model: "claude-opus-5-5",
        Thinking: "high",
        Cwd: repo,
        ParentAgentId: PARENT_ID,
        PendingPermissions: [],
        ...overrides,
    };
}

const FALLBACK_INSPECT = {Id: FALLBACK_SESSION, Provider: "codex", Model: "gpt-6.1-sol", Thinking: "high"};

function envelope(job, overrides = {}) {
    return JSON.stringify({
        version: 1,
        job_id: job.job_id,
        binding_sha256: job.binding_sha256,
        status: "COMPLETE",
        report_markdown: "No findings.",
        payload: {verdict: "PLAN READY", findings: [], previous_resolutions: []},
        ...overrides,
    });
}

function preparedAndBound() {
    prepare();
    bindSession({jobPath: jobPath(), inspect: inspect(), parentId: PARENT_ID});
    return readJob();
}

beforeEach(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "review-session-job-")));
    execFileSync("git", ["init", "--quiet"], {cwd: repo});
    write(".gitignore", "/var/\n");
    write("docs/plans/plan.md", "# Plan\n");
    write("task.md", "Review the plan with <skills_root>/code-review/SKILL.md.\n");
});

afterEach(() => {
    fs.rmSync(repo, {force: true, recursive: true});
});

describe("review-session configuration", () => {
    it("builds ordered attempts from complete profiles", () => {
        expect(resolveAttempts(BOTH, "PLAN_REVIEW")).toEqual({
            attempts: [
                {name: "1", provider: "claude", model: "claude-opus-5-5", thinking: "high", mode: "auto"},
                {name: "2", provider: "codex", model: "gpt-6.1-sol", thinking: "high", mode: "auto-review"},
            ],
            timeoutSeconds: 1200,
            problems: [],
            warnings: [],
        });
    });

    it("passes the required permission mode to the launch", () => {
        expect(prepare().next.launch).toMatchObject({mode: "auto"});
    });

    it.each(["HARNESS", "MODEL", "THINKING", "MODE"])("skips a profile missing %s and warns without exposing values", field => {
        const values = {...BOTH, [`PLAN_REVIEW_1_${field}`]: " "};
        const result = prepare(values);
        expect(result.next).toMatchObject({action: "launch", attempt: "2", launch: {mode: "auto-review"}});
        expect(result.warnings).toEqual([expect.objectContaining({code: "PROFILE_CONFIG_INVALID", profile: "1",
            missing_keys: [`PLAN_REVIEW_1_${field}`]})]);
        expect(readJob().config_warnings).toEqual(result.warnings);
    });

    it("warns and uses self review when no valid profiles remain", () => {
        const result = prepare({PLAN_REVIEW_2_MODE: "build"});
        expect(result.next).toEqual({action: "self", reason: "NO_VALID_PROFILES"});
        expect(result.warnings[0]).toMatchObject({profile: "2", missing_keys: ["PLAN_REVIEW_2_HARNESS", "PLAN_REVIEW_2_MODEL", "PLAN_REVIEW_2_THINKING"]});
        expect(fs.existsSync(path.join(repo, "var"))).toBe(false);
    });

    it("reads values from the project env files", () => {
        write(".env.local", "PLAN_REVIEW_1_HARNESS=opencode\nPLAN_REVIEW_TIMEOUT_SECONDS=600\n");
        const values = readProjectConfig(repo, "PLAN_REVIEW");
        expect(values.PLAN_REVIEW_1_HARNESS).toBe("opencode");
        expect(values.PLAN_REVIEW_TIMEOUT_SECONDS).toBe("600");
    });
});

const THREE = {
    ...BOTH,
    PLAN_REVIEW_3_HARNESS: "opencode",
    PLAN_REVIEW_3_MODEL: "commandcode/deepseek/deepseek-v4.1-flash",
    PLAN_REVIEW_3_THINKING: "high",
    PLAN_REVIEW_3_MODE: "build",
};
const THIRD_INSPECT = {Id: "ab1c2d3e-8c97-4034-8ea0-3f34f38ba8eb", Provider: "opencode",
    Model: THREE.PLAN_REVIEW_3_MODEL, Thinking: "high"};

describe("ordered review profiles", () => {
    it("tries three profiles in order, then returns self", () => {
        expect(prepare(THREE).next.attempt).toBe("1");
        expect(recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"}).next.attempt).toBe("2");
        expect(recordFailure({jobPath: jobPath(), reason: "TIMEOUT_STOPPED"}).next)
            .toMatchObject({attempt: "3", launch: {provider: "opencode", mode: "build"}});
        expect(recordFailure({jobPath: jobPath(), reason: "LAUNCH_FAILED"}).next)
            .toEqual({action: "self", reason: "ATTEMPTS_EXHAUSTED"});
    });

    it("continues from profile 1 to 3 when profile 2 is incomplete", () => {
        const result = prepare({...THREE, PLAN_REVIEW_2_MODE: ""});
        expect(result.next.attempt).toBe("1");
        expect(result.warnings[0]).toMatchObject({profile: "2", missing_keys: ["PLAN_REVIEW_2_MODE"]});
        expect(recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"}).next.attempt).toBe("3");
        expect(readJob().attempts.map(a => a.name)).toEqual(["1", "3"]);
    });

    it("accepts the third profile after two failures", () => {
        prepare(THREE);
        recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"});
        recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"});
        bindSession({jobPath: jobPath(), inspect: inspect(THIRD_INSPECT)});
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(readJob()), inspect: inspect(THIRD_INSPECT)}))
            .toMatchObject({decision: "ACCEPTED", reviewer: {attempt: "3", provider: "opencode"}});
    });

    it("skips empty profiles, including the first", () => {
        const thirdOnly = Object.fromEntries(Object.entries(THREE).filter(([key]) => key.includes("_3_")));
        expect(prepare(thirdOnly).next.attempt).toBe("3");
        expect(resolveAttempts({...BOTH, PLAN_REVIEW_2_HARNESS: "", PLAN_REVIEW_2_MODEL: "", PLAN_REVIEW_2_THINKING: "", PLAN_REVIEW_2_MODE: "", ...thirdOnly}, "PLAN_REVIEW")
            .attempts.map(x => x.name)).toEqual(["1", "3"]);
    });

    it("stops on a complete report requesting changes", () => {
        prepare(THREE);
        bindSession({jobPath: jobPath(), inspect: inspect()});
        const payload = {verdict: "PLAN CHANGES REQUESTED", findings: [{id: "F1"}]};
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(readJob(), {payload}), inspect: inspect()}))
            .toMatchObject({decision: "ACCEPTED", payload, next: {action: "evaluate"}});
        expect(() => recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"}))
            .toThrow(expect.objectContaining({code: "JOB_FINISHED"}));
    });

    it("does not try another profile when inputs change", () => {
        prepare(THREE);
        bindSession({jobPath: jobPath(), inspect: inspect()});
        const job = readJob();
        write("docs/plans/plan.md", "# Changed plan");
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect()}).next)
            .toMatchObject({action: "self", reason: "INPUT_CHANGED"});
    });
});

describe("review-session preparation", () => {
    it("falls back to self review without any profiles and writes nothing", () => {
        expect(prepare({})).toEqual({job_path: null, next: {action: "self", reason: "NOT_CONFIGURED"}});
        expect(fs.existsSync(path.join(repo, "var"))).toBe(false);
    });

    it("falls back to self review for an invalid configuration", () => {
        expect(prepare({...BOTH, PLAN_REVIEW_TIMEOUT_SECONDS: "0"}).next).toMatchObject({action: "self", reason: "CONFIG_INVALID"});
    });

    it("binds the inputs and returns the preferred launch", () => {
        const result = prepare();
        const job = readJob();
        const prompt = fs.readFileSync(path.join(jobDirectory(repo, JOB_ID), "prompt.md"), "utf8");

        expect(result.job_path).toBe(`var/agent/cache/review-session/${JOB_ID}/job.json`);
        expect(result.next).toMatchObject({action: "launch", attempt: "1", launch: {provider: "claude", model: "claude-opus-5-5", thinking: "high", cwd: repo, wait_timeout_seconds: 1200}});
        expect(job.context_refs).toEqual([{path: "docs/plans/plan.md", sha256: expect.stringMatching(/^[a-f0-9]{64}$/)}]);
        expect(prompt).toContain(job.binding_sha256);
        expect(prompt).toContain(`${SKILLS_ROOT}/code-review/SKILL.md`);
        expect(prompt).toContain("do not run `$context-refresh`");
    });

    it("rejects an invalid job id and inputs outside the repository", () => {
        expect(() => prepare(BOTH, {jobId: "../escape"})).toThrow(expect.objectContaining({code: "INVALID_JOB_ID"}));
        expect(() => prepare(BOTH, {context: [os.tmpdir()]})).toThrow(expect.objectContaining({code: "INVALID_CONTEXT_REF"}));
    });

    it("prepares a job id exactly once", () => {
        prepare();
        expect(() => prepare()).toThrow(expect.objectContaining({code: "JOB_EXISTS"}));
    });
});

describe("review-session attempts", () => {
    it("accepts a matching envelope and returns the reviewer identity", () => {
        const job = preparedAndBound();
        const result = acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect()});

        expect(result).toMatchObject({
            decision: "ACCEPTED",
            reviewer: {mode: "external", attempt: "1", provider: "claude", model: "claude-opus-5-5", session_id: MAIN_SESSION},
            payload: {verdict: "PLAN READY"},
            next: {action: "evaluate"},
        });
        expect(fs.existsSync(path.join(jobDirectory(repo, JOB_ID), "result.json"))).toBe(true);
    });

    it("moves to profile 2 after a provider failure and accepts its report", () => {
        const job = preparedAndBound();
        const failure = recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"});
        expect(failure.next).toMatchObject({action: "launch", attempt: "2", launch: {provider: "codex", model: "gpt-6.1-sol"}});

        bindSession({jobPath: jobPath(), inspect: inspect(FALLBACK_INSPECT), parentId: PARENT_ID});
        const result = acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect(FALLBACK_INSPECT)});
        expect(result.reviewer).toMatchObject({attempt: "2", provider: "codex"});
    });

    it("ends in self review when every attempt failed", () => {
        preparedAndBound();
        recordFailure({jobPath: jobPath(), reason: "TIMEOUT_STOPPED"});
        expect(recordFailure({jobPath: jobPath(), reason: "LAUNCH_FAILED"}).next).toEqual({action: "self", reason: "ATTEMPTS_EXHAUSTED"});
        expect(readJob().result).toEqual({decision: "SELF", reason: "ATTEMPTS_EXHAUSTED"});
    });

    it("goes straight to self review with only one profile", () => {
        const mainOnly = Object.fromEntries(Object.entries(BOTH).filter(([key]) => key.includes("_1_")));
        prepare(mainOnly);
        expect(recordFailure({jobPath: jobPath(), reason: "LAUNCH_FAILED"}).next).toMatchObject({action: "self"});
    });

    it.each([
        ["provider", {Provider: "codex"}],
        ["cwd", {Cwd: os.tmpdir()}],
        ["model", {Model: "claude-sonnet-5-5"}],
        ["parent_id", {ParentAgentId: "other-parent"}],
    ])("treats a session with a foreign %s as a failed attempt", (field, override) => {
        prepare();
        const result = bindSession({jobPath: jobPath(), inspect: inspect(override), parentId: PARENT_ID});
        expect(result).toMatchObject({ok: false, reason: "SESSION_MISMATCH", details: [field], next: {action: "launch", attempt: "2"}});
    });

    it("binds without a parent id when the coordinator does not run under Paseo", () => {
        prepare();
        expect(bindSession({jobPath: jobPath(), inspect: inspect({ParentAgentId: null, Thinking: null})}).ok).toBe(true);
    });

    it.each([
        ["another job", (job) => envelope(job, {job_id: "00000000-0000-4000-8000-000000000000"}), "JOB_MISMATCH"],
        ["another binding", (job) => envelope(job, {binding_sha256: "0".repeat(64)}), "BINDING_MISMATCH"],
        ["text around JSON", (job) => `Result: ${envelope(job)}`, "REPORT_INVALID"],
        ["no payload", (job) => envelope(job, {payload: null}), "REPORT_INVALID"],
        ["an incomplete review", (job) => envelope(job, {status: "INCOMPLETE"}), "EXECUTOR_INCOMPLETE"],
    ])("rejects %s and offers profile 2", (_, build, reason) => {
        const job = preparedAndBound();
        expect(acceptResult({jobPath: jobPath(), envelopeText: build(job), inspect: inspect()}))
            .toMatchObject({decision: expect.any(String), reason, next: {action: "launch", attempt: "2"}});
    });

    it("finds the envelope after a log separator but not text sharing its line", () => {
        const job = preparedAndBound();
        const parsed = (text) => acceptResult({jobPath: jobPath(), envelopeText: text, inspect: inspect()});
        expect(parsed(`---\n\n${envelope(job)}\n`)).toMatchObject({decision: "ACCEPTED"});
    });

    it("rejects an envelope that shares its line with other text", () => {
        const job = preparedAndBound();
        expect(acceptResult({jobPath: jobPath(), envelopeText: `---\nResult: ${envelope(job)}`, inspect: inspect()}))
            .toMatchObject({reason: "REPORT_INVALID"});
    });

    it("blocks the attempt while a permission request is pending", () => {
        const job = preparedAndBound();
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect({PendingPermissions: [{tool: "Bash"}]})}))
            .toMatchObject({decision: "BLOCKED", reason: "PERMISSION_PENDING", next: {action: "launch"}});
    });

    it("ends in self review of the current state when a bound input changed", () => {
        const job = preparedAndBound();
        write("docs/plans/plan.md", "# Plan\n\nEdited during review.\n");
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(job), inspect: inspect()}))
            .toMatchObject({decision: "STALE", reason: "INPUT_CHANGED", next: {action: "self", reason: "INPUT_CHANGED"}});
        expect(() => recordFailure({jobPath: jobPath(), reason: "LAUNCH_FAILED"})).toThrow(expect.objectContaining({code: "JOB_FINISHED"}));
    });
});


describe("profile memory within a planning cycle", () => {
    const NEXT_ID = "7f1c2d3e-4a5b-4c6d-8e7f-901234567890";
    function secondProfileAccepted(config = THREE) {
        prepare(config);
        recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"});
        bindSession({jobPath: jobPath(), inspect: inspect(FALLBACK_INSPECT)});
        return acceptResult({jobPath: jobPath(), envelopeText: envelope(readJob()), inspect: inspect(FALLBACK_INSPECT)});
    }
    function next(config = THREE, options = {}) {
        return prepare(config, {jobId: NEXT_ID, previousJob: jobPath(), ...options});
    }
    it("starts the next round at the successful profile and keeps later fallbacks", () => {
        secondProfileAccepted();
        const result = next();
        expect(result).toMatchObject({cycle_id: JOB_ID, skipped_profiles: [{profile: "1", reason: "PROVIDER_ERROR"}],
            next: {action: "launch", attempt: "2"}});
        const nextPath = path.resolve(repo, result.job_path);
        expect(recordFailure({jobPath: nextPath, reason: "TIMEOUT_STOPPED"}).next.attempt).toBe("3");
        bindSession({jobPath: nextPath, inspect: inspect(THIRD_INSPECT)});
        acceptResult({jobPath: nextPath, envelopeText: envelope(JSON.parse(fs.readFileSync(nextPath))), inspect: inspect(THIRD_INSPECT)});
        const third = next(THREE, {jobId: "8f1c2d3e-4a5b-4c6d-8e7f-901234567890", previousJob: nextPath});
        expect(third).toMatchObject({cycle_id: JOB_ID, next: {attempt: "3"}});
        expect(third.skipped_profiles.map(p => p.profile)).toEqual(["1", "2"]);
    });
    it("re-enables a profile when its settings change", () => {
        secondProfileAccepted();
        expect(next({...THREE, PLAN_REVIEW_1_MODE: "changed-mode"}).next.attempt).toBe("1");
    });
    it("resets the ladder for a new cycle without a previous-job link", () => {
        secondProfileAccepted();
        expect(next(THREE, {previousJob: undefined})).toMatchObject({cycle_id: NEXT_ID, next: {attempt: "1"}});
    });
    it("uses self review without repeating exhausted profiles", () => {
        prepare(BOTH);
        recordFailure({jobPath: jobPath(), reason: "LAUNCH_FAILED"});
        recordFailure({jobPath: jobPath(), reason: "TIMEOUT_STOPPED"});
        const result = next(BOTH);
        expect(result).toMatchObject({job_path: null, next: {action: "self", reason: "CYCLE_PROFILES_EXHAUSTED"}});
        expect(result.skipped_profiles.map(p => p.profile)).toEqual(["1", "2"]);
    });
    it("keeps a reviewer available after a valid report requesting repairs", () => {
        prepare(BOTH);
        bindSession({jobPath: jobPath(), inspect: inspect()});
        acceptResult({jobPath: jobPath(), envelopeText: envelope(readJob(), {payload: {
            verdict: "PLAN CHANGES REQUESTED", findings: [{id: "F1", classification: "finding", severity: "MAJOR", actionable: true, repair_attempts: 0}], previous_resolutions: []}}), inspect: inspect()});
        expect(next(BOTH).next.attempt).toBe("1");
    });
    it("does not disable the current reviewer when inputs become stale", () => {
        prepare(THREE);
        recordFailure({jobPath: jobPath(), reason: "PROVIDER_ERROR"});
        bindSession({jobPath: jobPath(), inspect: inspect(FALLBACK_INSPECT)});
        const before = readJob();
        write("docs/plans/plan.md", "# Changed during review");
        expect(acceptResult({jobPath: jobPath(), envelopeText: envelope(before), inspect: inspect(FALLBACK_INSPECT)}).reason).toBe("INPUT_CHANGED");
        expect(next().next.attempt).toBe("2");
    });
    it("does not disable a reviewer when a failure is recorded after inputs changed", () => {
        prepare();
        write("docs/plans/plan.md", "# Edited before the timeout was recorded");
        expect(recordFailure({jobPath: jobPath(), reason: "TIMEOUT_STOPPED"}))
            .toMatchObject({decision: "STALE", reason: "INPUT_CHANGED"});
        expect(next(BOTH).next.attempt).toBe("1");
    });
    it("remembers an invalid report across rounds", () => {
        preparedAndBound();
        expect(acceptResult({jobPath: jobPath(), envelopeText: "invalid report", inspect: inspect()}).reason).toBe("REPORT_INVALID");
        bindSession({jobPath: jobPath(), inspect: inspect(FALLBACK_INSPECT)});
        acceptResult({jobPath: jobPath(), envelopeText: envelope(readJob()), inspect: inspect(FALLBACK_INSPECT)});
        expect(next(BOTH).next.attempt).toBe("2");
    });
    it("does not repeat an unchanged configuration warning in the next round", () => {
        const config = {...THREE, PLAN_REVIEW_1_MODE: ""};
        const first = prepare(config);
        expect(first.warnings[0].profile).toBe("1");
        bindSession({jobPath: jobPath(), inspect: inspect(FALLBACK_INSPECT)});
        acceptResult({jobPath: jobPath(), envelopeText: envelope(readJob()), inspect: inspect(FALLBACK_INSPECT)});
        expect(next(config)).not.toHaveProperty("warnings");
    });
    it("rejects an unfinished predecessor", () => {
        prepare();
        expect(() => next()).toThrow(expect.objectContaining({code: "PREVIOUS_JOB_UNFINISHED"}));
    });
    it("does not inherit failures from another plan or skill", () => {
        secondProfileAccepted();
        write("docs/plans/other.md", "# Other plan");
        expect(() => next(THREE, {context: [path.join(repo, "docs/plans/other.md")]}))
            .toThrow(expect.objectContaining({code: "CYCLE_JOB_MISMATCH"}));
        expect(() => next(THREE, {prefix: "OTHER_REVIEW"}))
            .toThrow(expect.objectContaining({code: "CYCLE_JOB_MISMATCH"}));
    });
});

it("keeps acceptance retryable when writing the report fails", () => {
    const job = preparedAndBound();
    const resultPath = path.join(job.directory, "result.json");
    fs.mkdirSync(resultPath);
    const input = {jobPath: jobPath(), inspect: inspect(), envelopeText: envelope(job)};
    expect(() => acceptResult(input)).toThrow();
    expect(readJob().result).not.toMatchObject({decision: "ACCEPTED"});
    fs.rmdirSync(resultPath);
    expect(acceptResult(input).decision).toBe("ACCEPTED");
    expect(JSON.parse(fs.readFileSync(resultPath, "utf8")).decision).toBe("ACCEPTED");
});

describe("independent full plan inputs", () => {
    function inputs(scope = "full") {
        write("docs/plans/plan.md", "---\nrevision: 10\nreview_reviewer: previous-model\nreviewed_revision: 10\nsource_artifact: source.json\n---\n# Plan\nD13: substantive decision remains.\n");
        write("source.json", '{"requirement":"retain history"}');
        write("request.json", JSON.stringify({review_scope: scope, full_review_count: 2, delta_review_count: 0, previous_findings: [{id: "F8"}]}));
        write("prior-result.json", '{"verdict":"PLAN READY"}');
        return ["docs/plans/plan.md", "request.json", "source.json", "prior-result.json"].map(file => path.join(repo, file));
    }
    it("hides owner history while preserving substantive text and evidence", () => {
        prepare(BOTH, {context: inputs()});
        const job = readJob();
        const prompt = fs.readFileSync(path.join(job.directory, "prompt.md"), "utf8");
        expect(prompt).not.toContain("prior-result.json");
        expect(prompt).not.toContain("request.json");
        expect(prompt).not.toContain("docs/plans/plan.md");
        expect(prompt).toContain("source.json");
        const view = fs.readFileSync(path.join(job.directory, "review-plan.md"), "utf8");
        expect(view).toContain("D13: substantive decision remains.");
        expect(view).not.toContain("review_reviewer");
        expect(view).not.toContain("revision:");
        expect(job.context_refs).toHaveLength(4);
    });
    it.each(["docs/plans/plan.md", "view"])("rejects changed %s despite hidden owner refs", file => {
        prepare(BOTH, {context: inputs()});
        bindSession({jobPath: jobPath(), inspect: inspect()});
        const job = readJob();
        fs.appendFileSync(file === "view" ? path.join(job.directory, "review-plan.md") : path.join(repo, file), "changed");
        expect(acceptResult({jobPath: jobPath(), inspect: inspect(), envelopeText: envelope(job)})).toMatchObject({reason: "INPUT_CHANGED"});
    });
    it("leaves no job directory after a rejected view so the same job_id can be retried", () => {
        const context = inputs();
        const withoutSource = context.filter(file => !file.endsWith("source.json"));
        expect(() => prepare(BOTH, {context: withoutSource})).toThrow(/Missing bound evidence/);
        expect(() => prepare(BOTH, {context})).not.toThrow();
    });
    it("preserves history in delta review", () => {
        prepare(BOTH, {context: inputs("delta")});
        expect(readJob().reviewer_context_refs).toBeUndefined();
        expect(fs.readFileSync(path.join(readJob().directory, "prompt.md"), "utf8")).toContain("prior-result.json");
    });
});
