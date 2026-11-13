import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {spawnSync} from "../../helpers/bounded-spawn-sync.mjs";
import {test} from "vitest";
import {FAILURE_CLASSES} from "../../../.agents/skills/_shared/scripts/context-scout-report.mjs";
import {abortHybrid, claimAttempt, evaluateAttempt, finalizeHybrid, prepareHybrid, settleAttempt} from "../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs";
import {enrichContextManifest, getWorktreeFingerprint} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const HELPER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs");
const REPORT_BUILDER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs");

function makeFixtureDir() {
    const cacheRoot = path.join(ROOT, "var", "agent", "cache");
    fs.mkdirSync(cacheRoot, {recursive: true});
    return fs.mkdtempSync(path.join(cacheRoot, "context-scout-hybrid-test-"));
}

function writeFixtures(dir, mode = "targeted", cwd = ROOT) {
    const prompt = path.join(dir, "prompt.txt");
    const manifest = path.join(dir, "manifest.json");
    const handoff = path.join(dir, "handoff.json");
    const criteria = path.join(dir, "criteria.json");
    fs.writeFileSync(prompt, "test prompt\n");
    const sourceManifest = enrichContextManifest({
        version: 1,
        role: "primary",
        repository: "",
        branch: "",
        head: "",
        stack_profile: "generic",
        rules: ["AGENTS.md"],
        documentation: [],
        "active_overrides": [],
        constraints: [],
        "already_read": ["AGENTS.md"],
        omitted: [],
    }, {cwd});
    fs.writeFileSync(manifest, JSON.stringify(sourceManifest));
    fs.writeFileSync(handoff, JSON.stringify({
        mode,
        "task_brief": "Map a test flow.",
        decisions: [],
        constraints: [],
    }));
    fs.writeFileSync(criteria, JSON.stringify({criteria: [{id: "C1", description: "test"}]}));
    return {prompt, manifest, handoff, criteria};
}

function validReport() {
    const evidence = {path: "AGENTS.md", "line_start": 1, "line_end": 1, relation: "defines"};
    return {
        version: 1,
        status: "COMPLETE",
        mode: "targeted",
        findings: [{"criterion_id": "C1", claim: "test claim", claim_type: "observed", confidence: "high", anchors: ["Repository Guidelines"], evidence: [evidence]}],
        coverage: [{"criterion_id": "C1", status: "covered", evidence: [evidence]}],
        risks: [],
        omitted: [],
        "next_step": "none",
    };
}

function prepare(dir, title = "test-run", mode = "targeted") {
    const files = writeFixtures(dir, mode);
    const result = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        title,
    }, ROOT);
    return {...result, files};
}

function claim(prepared, attempt = "primary") {
    return claimAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt});
}

function assertEvaluateRejectsWorktreeDrift(prepared, mutate, cleanup, expectedFingerprint) {
    const primary = claim(prepared);
    try {
        mutate();
        fs.writeFileSync(primary.reportPath, JSON.stringify(validReport()));
        assert.throws(
            () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken}),
            (error) => error.failure_class === FAILURE_CLASSES.SNAPSHOT_STALE
                && error.message.includes(`worktree.${expectedFingerprint} changed`),
        );
        const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
        assert.equal(state.phase, "ABORTED");
        assert.equal(state.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
        assert.equal(state.snapshot_changed, true);
        assert.equal(state.primary.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
    } finally {
        try {
            cleanup();
        } finally {
            abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
        }
    }
}

test("delegation contract supports independent harness agents without bypassing validation", () => {
    const policy = fs.readFileSync(path.join(ROOT, ".agents/skills/_shared/references/repository-context-hybrid.md"), "utf8");
    for (const transport of ["task", "Agent", "spawn_agent"]) {
        assert.ok(policy.includes("`" + transport + "`"));
    }
    assert.match(policy, /not an\s+exhaustive allowlist/);
    assert.match(policy, /requires no user approval/);
    assert.match(policy, /Do not fork the parent conversation/);
    assert.match(policy, /does not\s+consume the single discovery fallback/);
    assert.match(policy, /pass `dispatch.prompt` verbatim/);
    assert.doesNotMatch(policy, /native `task`|native task/);
    const playbook = fs.readFileSync(path.join(ROOT, ".agents/skills/_shared/references/repository-context-scout-playbook.md"), "utf8");
    assert.match(playbook, /`context-scout-fast`:.*CMM-first/);
    assert.match(playbook, /`context-scout`:.*bez CMM/);
    assert.match(playbook, /context-subagent-contract.md/);
});

test("prepare returns portable role instructions and never starts OpenCode", () => {
    const dir = makeFixtureDir();
    const result = prepare(dir);
    assert.equal(result.protocolVersion, 5);
    assert.equal(result.next.action, "CLAIM_PRIMARY");
    assert.equal(Object.hasOwn(result.next, "agent"), false);
    const claimed = claim(result);
    assert.deepEqual(Object.keys(claimed.dispatch).sort(), ["description", "prompt", "subagent_type"]);
    assert.equal(claimed.dispatch.subagent_type, "context-scout-fast");
    assert.equal(claimed.dispatch.description, "Scout repository context");
    assert.equal(Object.hasOwn(claimed, "agent"), false);
    assert.equal(Object.hasOwn(claimed, "taskPrompt"), false);
    assert.match(claimed.dispatch.prompt, /Do not delegate/);
    assert.match(claimed.dispatch.prompt, /even without a named harness profile/);
    assert.match(claimed.dispatch.prompt, /Use CMM only when available.*otherwise use file tools/);
    assert.match(claimed.dispatch.prompt, /native file tool \(write or apply_patch/);
    assert.match(claimed.dispatch.prompt, /Use absolute consumer-project paths/);
    assert.match(claimed.dispatch.prompt, /path parameter explicitly/);
    assert.equal(claimed.dispatch.prompt.includes(path.join(ROOT, ".agents/skills/_shared/references/repository-context-scout-playbook.md")), true);
    assert.equal(claimed.dispatch.prompt.includes(claimed.scoutPath), true);
    assert.match(claimed.dispatch.prompt, /at most 6 relevant files, 3 symbols, and 2 tests\/commands/);
    assert.match(claimed.dispatch.prompt, /exactly one compact, parent-ready finding per criterion/);
    assert.match(claimed.dispatch.prompt, /at most three minimal evidence ranges per finding/);
    assert.match(claimed.dispatch.prompt, /keep coverage\[\]\.evidence empty/);
    assert.match(claimed.dispatch.prompt, /search for that exact name and directly read its defining source/);
    assert.match(claimed.dispatch.prompt, /criteria\[\]\.required_evidence entry as a hard validator gate/);
    assert.match(claimed.dispatch.prompt, /anchor_mode=required-literal/);
    assert.match(claimed.dispatch.prompt, /A COMPLETE report must not claim that an artifact does not exist/);
    assert.match(claimed.dispatch.prompt, /return INCOMPLETE/);
    assert.match(claimed.dispatch.prompt, /COMPLETE: every criterion has direct evidence/);
    assert.match(claimed.dispatch.prompt, /INCOMPLETE: discovery or verification ran out/);
    assert.match(claimed.dispatch.prompt, /BLOCKED: a hard input/);
    assert.doesNotMatch(claimed.dispatch.prompt, /batch-render|init\b|<<|node \.|bash call/);
    assert.match(claimed.dispatch.prompt, /report the exact denial literally/);
    assert.match(claimed.dispatch.prompt, /Do not spend more than 24 steps/);
    assert.doesNotMatch(claimed.dispatch.prompt, /report_sha256/);
    assert.doesNotMatch(claimed.dispatch.prompt, /opencode run/);
    assert.throws(() => claim(result), /Duplicate claim|Cannot claim/);
    abortHybrid({state: result.statePath, "run-id": result.runId});
});

test("prepare rejects an invalid required-literal before creating a claimable run", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    fs.writeFileSync(files.criteria, JSON.stringify({criteria: [{
        id: "C1",
        description: "Require a literal.",
        required_evidence: [{path: "AGENTS.md", anchors: ["not-a-real-anchor"]}],
    }]}));

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "invalid-criteria",
        }, ROOT),
        (error) => error.code === "INVALID_CRITERIA_ANCHOR"
            && error.failure_class === FAILURE_CLASSES.INPUT_INVALID
            && error.next_action === "STOP"
            && error.criteriaErrors[0].criterion_id === "C1"
            && error.criteriaErrors[0].path === "AGENTS.md"
            && error.criteriaErrors[0].anchor === "not-a-real-anchor"
            && error.preflight.status === "FAILED"
            && typeof error.preflight.durationMs === "number"
            && error.diagnostics.input_error_cost_ms === error.preflight.durationMs
            && error.diagnostics.discovery_cost_ms === 0,
    );
    assert.equal(fs.readdirSync(dir).some((entry) => entry.endsWith(".state.json")), false);
});

test("prepare rejects an output directory that the report builder cannot use", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    const forbiddenOutput = path.join(ROOT, "tests", "forbidden-context-artifacts");

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": forbiddenOutput,
            title: "invalid-output",
        }, ROOT),
        (error) => error.code === "INVALID_ARTIFACT_PATH"
            && error.failure_class === FAILURE_CLASSES.INPUT_INVALID
            && error.next_action === "STOP",
    );
    assert.equal(fs.existsSync(forbiddenOutput), false);
});

test("prepare requires explicit regeneration of a legacy manifest", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    const manifest = JSON.parse(fs.readFileSync(files.manifest, "utf8"));
    delete manifest.worktree;
    fs.writeFileSync(files.manifest, JSON.stringify(manifest));

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "legacy-manifest",
        }, ROOT),
        (error) => error.code === "MANIFEST_REGENERATION_REQUIRED"
            && error.failure_class === FAILURE_CLASSES.INPUT_INVALID
            && error.next_action === "STOP",
    );
    assert.equal(fs.readdirSync(dir).some((entry) => entry.endsWith(".state.json")), false);
});

test("prepare rejects contradictory duplicate evidence selectors", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    fs.writeFileSync(files.criteria, JSON.stringify({criteria: [{
        id: "C1",
        description: "Require one selector consistently.",
        required_evidence: [
            {path: "AGENTS.md", anchor_mode: "scout-selected"},
            {path: "AGENTS.md", anchor_mode: "required-literal", anchors: ["Repository Guidelines"]},
        ],
    }]}));

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "contradictory-criteria",
        }, ROOT),
        (error) => error.code === "INVALID_CRITERIA_RELATION"
            && error.criteriaErrors[0].criterion_id === "C1"
            && error.criteriaErrors[0].path === "AGENTS.md",
    );
    assert.equal(fs.readdirSync(dir).some((entry) => entry.endsWith(".state.json")), false);
});

test("prepare rejects required exact paths beyond the targeted hard budget", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    const requiredPaths = ["AGENTS.md", "README.md", "package.json", ".env.dist", ".gitignore", "eslint.config.mjs", "opencode.jsonc"];
    fs.writeFileSync(files.criteria, JSON.stringify({criteria: requiredPaths.map((requiredPath, index) => ({
        id: `C${index + 1}`,
        description: `Require ${requiredPath}.`,
        required_evidence: [{path: requiredPath}],
    }))}));

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "scope-too-broad",
        }, ROOT),
        (error) => error.code === "SCOPE_TOO_BROAD"
            && error.failure_class === FAILURE_CLASSES.SCOPE_INVALID
            && error.next_action === "STOP"
            && error.criteriaErrors[0].resource === "files"
            && error.criteriaErrors[0].criterion_ids.includes("C7"),
    );
    assert.equal(fs.readdirSync(dir).some((entry) => entry.endsWith(".state.json")), false);
});

test("prepare fails closed when the manifest worktree fingerprint is stale", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    const manifest = JSON.parse(fs.readFileSync(files.manifest, "utf8"));
    manifest.worktree.combined_sha256 = "0".repeat(64);
    fs.writeFileSync(files.manifest, JSON.stringify(manifest));

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "stale-manifest",
        }, ROOT),
        (error) => error.failure_class === FAILURE_CLASSES.SNAPSHOT_STALE
            && error.code === "SNAPSHOT_STALE"
            && error.next_action === "STOP"
            && error.snapshot_changed === true
            && /manifest verify failed/.test(error.message)
            && /worktree\.combined_sha256/.test(error.message),
    );
    assert.equal(fs.readdirSync(dir).some((entry) => entry.endsWith(".state.json")), false);
});

test("CLI exposes stale snapshot classification and diagnostics as JSON", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    const manifest = JSON.parse(fs.readFileSync(files.manifest, "utf8"));
    manifest.worktree.combined_sha256 = "0".repeat(64);
    fs.writeFileSync(files.manifest, JSON.stringify(manifest));

    const result = spawnSync(process.execPath, [
        HELPER,
        "prepare",
        "--prompt-file", files.prompt,
        "--manifest", files.manifest,
        "--handoff", files.handoff,
        "--criteria", files.criteria,
        "--output-dir", dir,
        "--title", "stale-cli",
    ], {cwd: ROOT, encoding: "utf8"});

    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    const envelope = JSON.parse(result.stderr);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.error.code, "SNAPSHOT_STALE");
    assert.equal(envelope.error.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
    assert.equal(envelope.error.next_action, "STOP");
    assert.equal(envelope.error.snapshot_changed, true);
    assert.equal(envelope.error.preflight.status, "FAILED");
    assert.equal(envelope.error.diagnostics.discovery_cost_ms, 0);
    assert.equal("stack" in envelope.error, false);
});

test("CLI does not report unavailable git metadata as a changed snapshot", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-hybrid-nogit-"));
    const cacheDir = path.join(dir, "var", "agent", "cache");
    fs.mkdirSync(cacheDir, {recursive: true});
    const files = writeFixtures(cacheDir);
    const result = spawnSync(process.execPath, [
        HELPER,
        "prepare",
        "--prompt-file", files.prompt,
        "--manifest", files.manifest,
        "--handoff", files.handoff,
        "--criteria", files.criteria,
        "--output-dir", cacheDir,
        "--title", "missing-git-metadata",
    ], {cwd: dir, encoding: "utf8"});

    assert.equal(result.status, 2);
    const envelope = JSON.parse(result.stderr);
    assert.equal(envelope.error.code, "MANIFEST_VERIFY_FAILED");
    assert.equal(envelope.error.failure_class, FAILURE_CLASSES.INPUT_INVALID);
    assert.equal(envelope.error.next_action, "STOP");
    assert.equal(envelope.error.snapshot_changed, false);
});

test("prepare rejects declared test and symbol surfaces beyond their hard budgets", () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    fs.writeFileSync(files.criteria, JSON.stringify({criteria: [{
        id: "C1",
        description: "Require too many verification targets.",
        required_tests: ["T1", "T2", "T3"],
        required_symbols: ["S1", "S2", "S3", "S4"],
    }]}));

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "verification-scope-too-broad",
        }, ROOT),
        (error) => error.code === "SCOPE_TOO_BROAD"
            && error.criteriaErrors.map((item) => item.resource).sort().join(",") === "symbols,tests"
            && error.criteriaErrors.every((item) => item.criterion_ids.includes("C1")),
    );
    assert.equal(fs.readdirSync(dir).some((entry) => entry.endsWith(".state.json")), false);
});

test("cross-layer primary retains the wider shared discovery budget", () => {
    const result = prepare(makeFixtureDir(), "cross-layer", "cross-layer");
    const claimed = claim(result);
    assert.match(claimed.dispatch.prompt, /at most 10 relevant files, 5 symbols, and 3 tests\/commands/);
    assert.doesNotMatch(claimed.dispatch.prompt, /at most 6 relevant files/);
    abortHybrid({state: result.statePath, "run-id": result.runId});
});

test("batch-render fails on empty stdin and succeeds with the report payload", () => {
    const prepared = prepare(makeFixtureDir(), "batch-render-stdin");
    const primary = claim(prepared);
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    const init = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "init",
        primary.ledgerPath,
        "--head",
        state.manifestHead,
        "--criteria",
        prepared.files.criteria,
        "--mode",
        "targeted",
    ], {cwd: ROOT, encoding: "utf8"});
    assert.equal(init.status, 0, init.stderr);

    const args = [REPORT_BUILDER, "batch-render", primary.ledgerPath, "--status", "COMPLETE", "--output", primary.reportPath];
    const empty = spawnSync(process.execPath, args, {cwd: ROOT, encoding: "utf8", input: ""});
    assert.notEqual(empty.status, 0);
    assert.equal(fs.existsSync(primary.reportPath), false);

    const rendered = spawnSync(process.execPath, args, {
        cwd: ROOT,
        encoding: "utf8",
        input: `${JSON.stringify(validReport())}\n`,
    });
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.equal(fs.existsSync(primary.reportPath), true);
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("fallback task prompt retains deterministic semantic criteria gates", () => {
    const result = prepare(makeFixtureDir());
    const primary = claim(result);
    fs.writeFileSync(primary.reportPath, "not-json");
    evaluateAttempt({state: result.statePath, "run-id": result.runId, attempt: "primary", token: primary.dispatchToken});
    const fallback = claim(result, "fallback");
    const primaryBudgetLine = primary.dispatch.prompt.split("\n").find((line) => line.startsWith("Budget contract:"));
    assert.match(fallback.dispatch.prompt, /criteria\[\]\.required_evidence entry as a hard validator gate/);
    assert.match(fallback.dispatch.prompt, /forbid_negative_claims/);
    assert.match(fallback.dispatch.prompt, /minimum_file_budget=0/);
    assert.match(fallback.dispatch.prompt, /effective_file_budget=6/);
    assert.equal(fallback.dispatch.prompt.includes(primaryBudgetLine), true);
    assert.match(fallback.dispatch.prompt, /COMPLETE: every criterion has direct evidence/);
    assert.match(fallback.dispatch.prompt, /native file tool \(write or apply_patch/);
    assert.doesNotMatch(fallback.dispatch.prompt, /batch-render|<<|node \./);
    abortHybrid({state: result.statePath, "run-id": result.runId});
});

test("missing report is retryable and requests exactly one fallback", () => {
    const prepared = prepare(makeFixtureDir(), "missing-report");
    const primary = claim(prepared);
    const evaluation = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken});

    assert.equal(evaluation.failure_class, FAILURE_CLASSES.REPORT_MISSING);
    assert.equal(evaluation.next.action, "CLAIM_FALLBACK");
    assert.equal(JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).primary.failure_class, FAILURE_CLASSES.REPORT_MISSING);
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("valid incomplete report is classified as retryable agent incompleteness", () => {
    const prepared = prepare(makeFixtureDir(), "agent-incomplete");
    const primary = claim(prepared);
    fs.writeFileSync(primary.scoutPath, JSON.stringify({...validReport(), status: "INCOMPLETE"}));

    const evaluation = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken});
    assert.equal(evaluation.failure_class, FAILURE_CLASSES.AGENT_INCOMPLETE);
    assert.equal(evaluation.next.action, "CLAIM_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("valid blocked report is classified as retryable agent incompleteness through the helper", () => {
    const prepared = prepare(makeFixtureDir(), "agent-blocked");
    const primary = claim(prepared);
    fs.writeFileSync(primary.scoutPath, JSON.stringify({
        ...validReport(),
        status: "BLOCKED",
        findings: [],
        coverage: [{criterion_id: "C1", status: "blocked", reason: "source was not available"}],
    }));

    const evaluation = evaluateAttempt({
        state: prepared.statePath,
        "run-id": prepared.runId,
        attempt: "primary",
        token: primary.dispatchToken,
        "duration-ms": "0",
    });
    assert.equal(evaluation.validation.schemaValid, true);
    assert.equal(evaluation.validation.status, "BLOCKED");
    assert.equal(evaluation.failure_class, FAILURE_CLASSES.AGENT_INCOMPLETE);
    assert.equal(evaluation.next.action, "CLAIM_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("a slow but valid report is accepted without a post-hoc soft timeout", () => {
    const prepared = prepare(makeFixtureDir(), "agent-timeout");
    const primary = claim(prepared);
    fs.writeFileSync(primary.reportPath, JSON.stringify(validReport()));

    const evaluation = evaluateAttempt({
        state: prepared.statePath,
        "run-id": prepared.runId,
        attempt: "primary",
        token: primary.dispatchToken,
        "duration-ms": "300000",
    });
    assert.equal(evaluation.validation.valid, true);
    assert.equal(evaluation.failure_class, null);
    assert.equal(evaluation.next.action, "FINALIZE");
    assert.equal(finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId}).fallback_count, 0);
});

test("explicit external timeout acknowledgement still classifies a valid report as retryable", () => {
    const prepared = prepare(makeFixtureDir(), "external-agent-timeout");
    const primary = claim(prepared);
    fs.writeFileSync(primary.reportPath, JSON.stringify(validReport()));

    const evaluation = evaluateAttempt({
        state: prepared.statePath,
        "run-id": prepared.runId,
        attempt: "primary",
        token: primary.dispatchToken,
        ack: {timed_out: true},
        "duration-ms": "17",
    });
    assert.equal(evaluation.failure_class, FAILURE_CLASSES.AGENT_TIMEOUT);
    assert.equal(evaluation.validation.failure_class, FAILURE_CLASSES.AGENT_TIMEOUT);
    assert.equal(evaluation.next.action, "CLAIM_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("report IO failure is retryable without being treated as a missing report", () => {
    const prepared = prepare(makeFixtureDir(), "report-write-failed");
    const primary = claim(prepared);
    fs.mkdirSync(primary.reportPath);

    const evaluation = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken});
    assert.equal(evaluation.failure_class, FAILURE_CLASSES.REPORT_WRITE_FAILED);
    assert.equal(evaluation.next.action, "CLAIM_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("legacy run command fails closed instead of spawning an agent", () => {
    const result = spawnSync(process.execPath, [HELPER, "run"], {cwd: ROOT, encoding: "utf8"});
    assert.equal(result.status, 2);
    assert.match(result.stdout, /prepare/);
});

test("valid primary finalizes without fallback and records required metrics", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primary = claim(prepared);
    fs.writeFileSync(primary.scoutPath, JSON.stringify(validReport()));
    const settled = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "123", ack: {session_ids: ["session-test"], task_tools: 1}});
    assert.equal(settled.evaluate.validation.valid, true);
    assert.equal(settled.evaluate.next.action, "FINALIZE");
    const final = settled.finalized;
    assert.equal(final.fast_first_pass, true);
    assert.equal(final.fallback_count, 0);
    assert.equal(final.hybrid_final, true);
    assert.match(final.logical_input_hash, /^[a-f0-9]{64}$/);
    assert.equal(final.rerun_of, null);
    assert.equal(final.preflight.status, "PASSED");
    assert.equal(typeof final.preflight.durationMs, "number");
    assert.equal(final.snapshot_changed, false);
    assert.equal(final.report_written, true);
    assert.equal(final.diagnostics.input_error_cost_ms, 0);
    assert.equal(final.diagnostics.preflight_cost_ms, final.preflight.durationMs);
    assert.equal(final.diagnostics.discovery_cost_ms, 123);
    assert.equal(final.diagnostics.discovery.attempts, 1);
    assert.equal(final.primary.report_written, true);
    assert.equal(final.final.agent, "context-scout-fast");
    assert.equal(final.minimum_file_budget, 0);
    assert.equal(final.effective_file_budget, 6);
    assert.equal(final.budget.hard_file_budget, 6);
    assert.equal(typeof final.primary.durationMs, "number");
    assert.match(final.primary.reportSha256, /^[a-f0-9]{64}$/);
    assert.equal(final.dispatch_audit.primary.ack.task_tools, 1);
    assert.equal(fs.existsSync(primary.ledgerPath), true);
});

test("builds the report from the primary scout file using its saved head, criteria and mode", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir, "scout-report");
    const primary = claim(prepared);
    fs.writeFileSync(primary.scoutPath, JSON.stringify(validReport()));
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "123"});

    assert.equal(evaluated.validation.valid, true);
    assert.equal(fs.existsSync(primary.reportPath), true);
    const ledger = JSON.parse(fs.readFileSync(primary.ledgerPath, "utf8"));
    assert.equal(ledger.head, JSON.parse(fs.readFileSync(prepared.files.manifest, "utf8")).head);
    assert.equal(ledger.mode, "targeted");
    assert.deepEqual(ledger.criteria, ["C1"]);
    assert.equal(evaluated.next.action, "FINALIZE");
    finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("builds an incomplete report from the scout file without coercing it to COMPLETE", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir, "scout-incomplete");
    const incomplete = {
        version: 1,
        status: "INCOMPLETE",
        mode: "targeted",
        findings: [],
        coverage: [{criterion_id: "C1", status: "blocked", reason: "direct verification was not completed"}],
        read_coverage: {covered: [], follow_up: []},
        risks: [],
        omitted: [],
        next_step: "retry the bounded discovery",
    };
    const primary = claim(prepared);
    fs.writeFileSync(primary.scoutPath, JSON.stringify(incomplete));
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "123"});

    assert.equal(evaluated.validation.reportExists, true);
    assert.equal(evaluated.validation.status, "INCOMPLETE");
    assert.equal(evaluated.failure_class, FAILURE_CLASSES.AGENT_INCOMPLETE);
    assert.equal(evaluated.next.action, "CLAIM_FALLBACK");
    const stateAfterEvaluation = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    assert.equal(stateAfterEvaluation.primary.reportDiscardedPath, null);
    assert.equal(JSON.parse(fs.readFileSync(stateAfterEvaluation.primary.partialReportPath, "utf8")).status, "INCOMPLETE");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

for (const [label, payload] of [
    ["invalid JSON", "not-json"],
    ["invalid status", JSON.stringify({...validReport(), status: "DONE"})],
    ["builder-rejected evidence mentioning an IO code", JSON.stringify({...validReport(), findings: [{...validReport().findings[0], anchors: ["ENOENT"]}]})],
]) {
    test(`scout file with ${label} is REPORT_INVALID and fallback can finalize`, () => {
        const prepared = prepare(makeFixtureDir(), "invalid-scout");
        try {
            const primary = claim(prepared);
            fs.writeFileSync(primary.scoutPath, payload);
            const rejected = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "0"});
            assert.equal(rejected.evaluate.validation.failure_class, FAILURE_CLASSES.REPORT_INVALID);
            assert.equal(rejected.evaluate.next.action, "CLAIM_FALLBACK");
            assert.equal(fs.existsSync(primary.reportPath), false);
            const fallback = claim(prepared, "fallback");
            fs.writeFileSync(fallback.scoutPath, JSON.stringify(validReport()));
            const accepted = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallback.dispatchToken, "duration-ms": "0"});
            assert.equal(accepted.finalized.hybrid_final, true);
            assert.equal(accepted.finalized.fallback_count, 1);
        } finally {
            if (JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).phase !== "FINALIZED") {
                abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
            }
        }
    });
}

test("an unreadable scout or unwritable ledger is REPORT_WRITE_FAILED", () => {
    for (const blockedPath of ["scoutPath", "ledgerPath"]) {
        const prepared = prepare(makeFixtureDir(), "scout-io");
        const primary = claim(prepared);
        if (blockedPath === "ledgerPath") { fs.writeFileSync(primary.scoutPath, JSON.stringify(validReport())); }
        fs.mkdirSync(primary[blockedPath]);
        const rejected = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "0"});
        assert.equal(rejected.evaluate.validation.failure_class, FAILURE_CLASSES.REPORT_WRITE_FAILED);
        assert.equal(fs.existsSync(primary.reportPath), false);
        const fallback = claim(prepared, "fallback");
        const final = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallback.dispatchToken, "duration-ms": "0"});
        assert.equal(final.finalized.hybrid_final, false);
        assert.equal(final.finalized.fallback.failure_class, FAILURE_CLASSES.REPORT_MISSING);
    }
});

test("another attempt's scout file or a ledger cannot substitute for a missing scout", () => {
    const prepared = prepare(makeFixtureDir(), "own-scout-only");
    const primary = claim(prepared);
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    fs.writeFileSync(state.fallback.scoutPath, JSON.stringify(validReport()));
    fs.writeFileSync(primary.ledgerPath, JSON.stringify({batch_report: validReport()}));
    const rejected = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, ack: validReport(), "duration-ms": "0"});
    assert.equal(rejected.evaluate.validation.failure_class, FAILURE_CLASSES.REPORT_MISSING);
    assert.equal(fs.existsSync(primary.reportPath), false);
    const fallback = claim(prepared, "fallback");
    const accepted = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallback.dispatchToken, "duration-ms": "0"});
    assert.equal(accepted.finalized.hybrid_final, true);
    assert.equal(accepted.finalized.final.agent, "context-scout");
    assert.equal(accepted.finalized.fast_first_pass, false);
});

test("installation helpers build in an external consumer project and its configured cache", () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "hybrid consumer project-"));
    let prepared;
    try {
        fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Repository Guidelines\n");
        fs.writeFileSync(path.join(cwd, ".env"), "CACHE_PATH='consumer cache'\n");
        fs.writeFileSync(path.join(cwd, ".gitignore"), "consumer cache/\n");
        fs.mkdirSync(path.join(cwd, "src"));
        const git = (args) => {
            const result = spawnSync("git", args, {cwd, encoding: "utf8"});
            assert.equal(result.status, 0, result.stderr);
        };
        git(["init", "-q", "-b", "consumer-branch"]);
        git(["add", "."]);
        git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"]);
        const outputDir = path.join(cwd, "consumer cache/arbitrary-output-name");
        fs.mkdirSync(outputDir, {recursive: true});
        const files = writeFixtures(outputDir, "targeted", cwd);
        prepared = prepareHybrid({"prompt-file": files.prompt, manifest: files.manifest, handoff: files.handoff, criteria: files.criteria, "output-dir": outputDir}, path.join(cwd, "src"));
        const primary = claim(prepared);
        assert.equal(primary.dispatch.prompt.includes(`Consumer project root: ${cwd}`), true);
        assert.match(primary.dispatch.prompt, /Consumer branch: consumer-branch/);
        assert.equal(primary.dispatch.prompt.includes(path.join(ROOT, ".agents/skills/_shared/references/repository-context-scout-playbook.md")), true);
        assert.equal(primary.dispatch.prompt.includes(primary.scoutPath), true);
        assert.equal(primary.scoutPath.startsWith(outputDir + path.sep), true);
        assert.doesNotMatch(primary.dispatch.prompt, /batch-render|<<|node \./);
        fs.writeFileSync(primary.scoutPath, JSON.stringify(validReport()));
        const accepted = settleAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "0"});
        assert.equal(accepted.finalized.hybrid_final, true);
        assert.equal(fs.existsSync(primary.ledgerPath), true);
        assert.equal(fs.existsSync(primary.reportPath), true);
    } finally {
        if (prepared && JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).phase !== "FINALIZED") {
            abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
        }
        fs.rmSync(cwd, {recursive: true, force: true});
    }
});

test("invalid primary requests exactly one isolated fallback", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primaryClaim = claim(prepared);
    fs.writeFileSync(primaryClaim.reportPath, "not-json");
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primaryClaim.dispatchToken, "duration-ms": "17"});
    assert.equal(primary.validation.valid, false);
    assert.equal(primary.failure_class, FAILURE_CLASSES.REPORT_INVALID);
    assert.equal(primary.next.action, "CLAIM_FALLBACK");
    assert.equal(Object.hasOwn(primary.next, "agent"), false);
    assert.equal(fs.existsSync(primaryClaim.reportPath), false);
    const discardedPrimary = JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).primary.reportDiscardedPath;
    assert.equal(typeof discardedPrimary, "string");
    assert.equal(fs.existsSync(discardedPrimary), true);
    const stateAfterPrimary = fs.readFileSync(prepared.statePath, "utf8");
    assert.doesNotMatch(stateAfterPrimary, /not-json|validator_failed/);
    const fallbackClaim = claim(prepared, "fallback");
    assert.equal(fallbackClaim.dispatch.subagent_type, "context-scout");
    assert.equal(fallbackClaim.dispatch.description, "Retry repository context");
    assert.match(fallbackClaim.dispatch.prompt, /even without a named harness profile/);
    assert.match(fallbackClaim.dispatch.prompt, /direct source reads only, without CMM/);
    assert.doesNotMatch(fallbackClaim.dispatch.prompt, /Use CMM only when available/);
    fs.writeFileSync(fallbackClaim.reportPath, JSON.stringify(validReport()));
    const fallback = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallbackClaim.dispatchToken, "duration-ms": "23"});
    assert.equal(fallback.validation.valid, true);
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallbackClaim.dispatchToken}),
        /Cannot evaluate fallback/,
    );
    const final = finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(final.fast_first_pass, false);
    assert.equal(final.fallback_count, 1);
    assert.equal(final.hybrid_final, true);
    assert.equal(final.failure_class, FAILURE_CLASSES.REPORT_INVALID);
    assert.equal(final.primary.failure_class, FAILURE_CLASSES.REPORT_INVALID);
    assert.equal(final.primary.next_action, "CLAIM_FALLBACK");
    assert.equal(final.fallback.failure_class, null);
    assert.equal(final.fallback.next_action, "FINALIZE");
    assert.equal(final.final.failure_class, null);
    assert.equal(final.final.agent, "context-scout");
    assert.equal(final.report_written, true);
    assert.equal(final.primary.report_written, true);
    assert.equal(final.fallback.report_written, true);
    assert.equal(final.diagnostics.discovery_cost_ms, 40);
    assert.equal(final.diagnostics.discovery.attempts, 2);
    assert.equal(final.effective_file_budget, 6);
    assert.deepEqual(final.budget, JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).budget);
});

test("report mode must match the canonical handoff mode", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primaryClaim = claim(prepared);
    const report = {...validReport(), mode: "cross-layer"};
    fs.writeFileSync(primaryClaim.reportPath, JSON.stringify(report));
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primaryClaim.dispatchToken});
    assert.equal(primary.validation.valid, false);
    assert.equal(primary.validation.reason, "mode_mismatch");
    assert.equal(primary.next.action, "CLAIM_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("invalid fallback is final and cannot trigger another attempt", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primaryClaim = claim(prepared);
    fs.writeFileSync(primaryClaim.reportPath, "not-json");
    const primary = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primaryClaim.dispatchToken});
    const fallbackClaim = claim(prepared, "fallback");
    fs.writeFileSync(fallbackClaim.reportPath, "still-not-json");
    const fallback = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "fallback", token: fallbackClaim.dispatchToken});
    assert.equal(fallback.failure_class, FAILURE_CLASSES.REPORT_INVALID);
    assert.equal(fallback.next.action, "FINALIZE");
    const final = finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(final.fallback_count, 1);
    assert.equal(final.hybrid_final, false);
    assert.equal(final.final.status, "INCOMPLETE");
    assert.equal(final.failure_class, FAILURE_CLASSES.REPORT_INVALID);
    assert.equal(final.final.failure_class, FAILURE_CLASSES.REPORT_INVALID);
    assert.equal(fs.existsSync(primaryClaim.reportPath), false);
    assert.equal(fs.existsSync(JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).primary.reportDiscardedPath), true);
});

test("concurrent preparations use isolated run artifacts", () => {
    const first = prepare(makeFixtureDir(), "first");
    const second = prepare(makeFixtureDir(), "second");
    const firstClaim = claim(first);
    const secondClaim = claim(second);
    assert.notEqual(first.runId, second.runId);
    assert.notEqual(first.statePath, second.statePath);
    assert.notEqual(firstClaim.reportPath, secondClaim.reportPath);
    assert.equal(fs.existsSync(first.statePath), true);
    assert.equal(fs.existsSync(second.statePath), true);
    abortHybrid({state: first.statePath, "run-id": first.runId});
    abortHybrid({state: second.statePath, "run-id": second.runId});
});

test("concurrent claims serialize and only one caller obtains the token", async () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir, "claim-race");
    const moduleUrl = new URL("../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs", import.meta.url).href;
    const script = `import {claimAttempt} from ${JSON.stringify(moduleUrl)}; try { claimAttempt({state: process.env.STATE, "run-id": process.env.RUN_ID, attempt: "primary"}); } catch (error) { console.error(error.message); process.exitCode = 1; }`;
    const launch = () => new Promise((resolve) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
            cwd: ROOT,
            env: {...process.env, STATE: prepared.statePath, RUN_ID: prepared.runId},
            stdio: ["ignore", "ignore", "pipe"],
        });
        let stderr = "";
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("close", (code) => resolve({code, stderr}));
    });
    const results = await Promise.all([launch(), launch()]);
    assert.deepEqual(results.map((result) => result.code).sort((a, b) => a - b), [0, 1]);
    assert.match(results.find((result) => result.code === 1).stderr, /Cannot claim|Duplicate claim/);
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("concurrent identical preparations reject one before claim", async () => {
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    const moduleUrl = new URL("../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs", import.meta.url).href;
    const script = `import {prepareHybrid} from ${JSON.stringify(moduleUrl)}; try { const result = prepareHybrid({"prompt-file": process.env.PROMPT, manifest: process.env.MANIFEST, handoff: process.env.HANDOFF, criteria: process.env.CRITERIA, "output-dir": process.env.OUTPUT, title: "prepare-race"}, process.env.ROOT); process.stdout.write(JSON.stringify(result)); } catch (error) { process.stderr.write(JSON.stringify({code: error.code, failure_class: error.failure_class})); process.exitCode = 1; }`;
    const launch = () => new Promise((resolve) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
            cwd: ROOT,
            env: {...process.env, ROOT, PROMPT: files.prompt, MANIFEST: files.manifest, HANDOFF: files.handoff, CRITERIA: files.criteria, OUTPUT: dir},
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
        child.on("close", (code) => resolve({code, stdout, stderr}));
    });

    const results = await Promise.all([launch(), launch()]);
    assert.deepEqual(results.map((result) => result.code).sort((left, right) => left - right), [0, 1]);
    const successful = results.find((result) => result.code === 0);
    const rejected = results.find((result) => result.code === 1);
    assert.equal(JSON.parse(successful.stdout).next.action, "CLAIM_PRIMARY");
    assert.ok(["IDENTICAL_LOGICAL_RUN", "LOGICAL_RUN_IN_PROGRESS"].includes(JSON.parse(rejected.stderr).code));
    const successfulRun = JSON.parse(successful.stdout);
    abortHybrid({state: successfulRun.statePath, "run-id": successfulRun.runId});
});

test("identical logical rerun is rejected before a second claim", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "repeatable");
    const firstPrimary = claim(first);
    fs.writeFileSync(firstPrimary.reportPath, JSON.stringify(validReport()));
    evaluateAttempt({state: first.statePath, "run-id": first.runId, attempt: "primary", token: firstPrimary.dispatchToken});
    finalizeHybrid({state: first.statePath, "run-id": first.runId});

    const files = writeFixtures(dir);
    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "repeatable",
        }, ROOT),
        (error) => error.code === "IDENTICAL_LOGICAL_RUN"
            && error.failure_class === FAILURE_CLASSES.INPUT_INVALID
            && error.next_action === "STOP"
            && error.rerun_of === first.runId
            && error.preflight.status === "REJECTED"
            && error.diagnostics.discovery_cost_ms === 0,
    );
});

test("an explicitly identified aborted run can be retried and records its parent", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "aborted-rerun");
    abortHybrid({state: first.statePath, "run-id": first.runId});
    const files = writeFixtures(dir);
    const second = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        title: "aborted-rerun",
        "retry-aborted": first.runId,
    }, ROOT);

    const firstState = JSON.parse(fs.readFileSync(first.statePath, "utf8"));
    const secondState = JSON.parse(fs.readFileSync(second.statePath, "utf8"));
    assert.equal(second.logical_input_hash, first.logical_input_hash);
    assert.equal(secondState.logical_input_hash, firstState.logical_input_hash);
    assert.equal(second.rerun_of, first.runId);
    assert.equal(secondState.rerun_of, first.runId);
    const secondPrimary = claim(second);
    fs.writeFileSync(secondPrimary.reportPath, JSON.stringify(validReport()));
    const final = settleAttempt({state: second.statePath, "run-id": second.runId, attempt: "primary", token: secondPrimary.dispatchToken});
    assert.equal(final.finalized.rerun_of, first.runId);
});

test("retry-aborted rejects a run that was not aborted", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "invalid-aborted-rerun");
    const files = writeFixtures(dir);

    assert.throws(
        () => prepareHybrid({
            "prompt-file": files.prompt,
            manifest: files.manifest,
            handoff: files.handoff,
            criteria: files.criteria,
            "output-dir": dir,
            title: "invalid-aborted-rerun",
            "retry-aborted": first.runId,
        }, ROOT),
        (error) => error.code === "RETRY_ABORTED_INVALID"
            && error.failure_class === FAILURE_CLASSES.INPUT_INVALID
            && error.next_action === "STOP",
    );
    abortHybrid({state: first.statePath, "run-id": first.runId});
});

test("changed strategy receives a new logical input hash", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "changed-strategy");
    const files = writeFixtures(dir, "cross-layer");
    const second = prepareHybrid({
        "prompt-file": files.prompt,
        manifest: files.manifest,
        handoff: files.handoff,
        criteria: files.criteria,
        "output-dir": dir,
        title: "changed-strategy",
    }, ROOT);

    assert.notEqual(second.logical_input_hash, first.logical_input_hash);
    assert.equal(second.rerun_of, null);
    abortHybrid({state: first.statePath, "run-id": first.runId});
    abortHybrid({state: second.statePath, "run-id": second.runId});
});

test("criteria and worktree snapshot changes receive new logical input hashes", () => {
    const dir = makeFixtureDir();
    const first = prepare(dir, "changed-inputs");
    const criteriaFiles = writeFixtures(dir);
    fs.writeFileSync(criteriaFiles.criteria, JSON.stringify({criteria: [{id: "C1", description: "changed criterion"}]}));
    const changedCriteria = prepareHybrid({
        "prompt-file": criteriaFiles.prompt,
        manifest: criteriaFiles.manifest,
        handoff: criteriaFiles.handoff,
        criteria: criteriaFiles.criteria,
        "output-dir": dir,
        title: "changed-inputs",
    }, ROOT);
    const snapshotPath = path.join(ROOT, `.context-wp7-snapshot-${process.pid}-${Date.now()}`);
    let changedSnapshot;

    try {
        fs.writeFileSync(snapshotPath, "snapshot change\n");
        const snapshotFiles = writeFixtures(dir);
        fs.writeFileSync(snapshotFiles.criteria, JSON.stringify({criteria: [{id: "C1", description: "changed criterion"}]}));
        changedSnapshot = prepareHybrid({
            "prompt-file": snapshotFiles.prompt,
            manifest: snapshotFiles.manifest,
            handoff: snapshotFiles.handoff,
            criteria: snapshotFiles.criteria,
            "output-dir": dir,
            title: "changed-inputs",
        }, ROOT);
        assert.notEqual(changedCriteria.logical_input_hash, first.logical_input_hash);
        assert.notEqual(changedSnapshot.logical_input_hash, changedCriteria.logical_input_hash);
    } finally {
        fs.rmSync(snapshotPath, {force: true});
        abortHybrid({state: first.statePath, "run-id": first.runId});
        abortHybrid({state: changedCriteria.statePath, "run-id": changedCriteria.runId});
        if (changedSnapshot) {
            abortHybrid({state: changedSnapshot.statePath, "run-id": changedSnapshot.runId});
        }
    }
});

test("input mutation and wrong run-id fail closed", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const primary = claim(prepared);
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": "wrong", attempt: "primary", token: primary.dispatchToken}),
        /run-id/,
    );
    fs.appendFileSync(prepared.files.prompt, "changed\n");
    assert.throws(
        () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken}),
        (error) => /input changed/.test(error.message) && error.failure_class === FAILURE_CLASSES.SNAPSHOT_STALE,
    );
    const staleState = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    assert.equal(staleState.phase, "ABORTED");
    assert.equal(staleState.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
    assert.equal(staleState.snapshot_changed, true);
    fs.writeFileSync(prepared.files.prompt, "test prompt\n");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("worktree drift during evaluate aborts before accepting a report", () => {
    const prepared = prepare(makeFixtureDir(), "stale-worktree");
    const primary = claim(prepared);
    const driftPath = path.join(ROOT, `.context-snapshot-drift-${process.pid}-${Date.now()}`);

    try {
        fs.writeFileSync(driftPath, "untracked drift\n");
        fs.writeFileSync(primary.reportPath, JSON.stringify(validReport()));

        assert.throws(
            () => evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken}),
            (error) => /snapshot changed after prepare/.test(error.message)
                && error.failure_class === FAILURE_CLASSES.SNAPSHOT_STALE,
        );
        const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
        assert.equal(state.phase, "ABORTED");
        assert.equal(state.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
        assert.equal(state.snapshot_changed, true);
        assert.equal(state.primary.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
    } finally {
        fs.rmSync(driftPath, {force: true});
        abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
    }
});

test("staged worktree drift during evaluate aborts before accepting a report", () => {
    const relativePath = `.context-staged-drift-${process.pid}-${Date.now()}`;
    const absolutePath = path.join(ROOT, relativePath);
    const prepared = prepare(makeFixtureDir(), "stale-staged-worktree");

    assertEvaluateRejectsWorktreeDrift(
        prepared,
        () => {
            fs.writeFileSync(absolutePath, "staged drift\n");
            const staged = spawnSync("git", ["add", "--", relativePath], {cwd: ROOT, encoding: "utf8"});
            assert.equal(staged.status, 0, staged.stderr);
        },
        () => {
            const reset = spawnSync("git", ["reset", "--quiet", "--", relativePath], {cwd: ROOT, encoding: "utf8"});
            assert.equal(reset.status, 0, reset.stderr);
            fs.rmSync(absolutePath, {force: true});
        },
        "staged_sha256",
    );
});

test("unstaged worktree drift during evaluate aborts before accepting a report", () => {
    const relativePath = `.context-unstaged-drift-${process.pid}-${Date.now()}`;
    const absolutePath = path.join(ROOT, relativePath);
    const prepared = prepare(makeFixtureDir(), "stale-unstaged-worktree");

    assertEvaluateRejectsWorktreeDrift(
        prepared,
        () => {
            fs.writeFileSync(absolutePath, "unstaged drift\n");
            const intent = spawnSync("git", ["add", "-N", "--", relativePath], {cwd: ROOT, encoding: "utf8"});
            assert.equal(intent.status, 0, intent.stderr);
        },
        () => {
            const reset = spawnSync("git", ["reset", "--quiet", "--", relativePath], {cwd: ROOT, encoding: "utf8"});
            assert.equal(reset.status, 0, reset.stderr);
            fs.rmSync(absolutePath, {force: true});
        },
        "unstaged_sha256",
    );
});

test("snapshot stale during claim aborts before dispatch and does not create a fallback", () => {
    const prepared = prepare(makeFixtureDir(), "stale-claim");
    fs.appendFileSync(prepared.files.prompt, "changed before claim\n");

    assert.throws(
        () => claim(prepared),
        (error) => /input changed/.test(error.message) && error.failure_class === FAILURE_CLASSES.SNAPSHOT_STALE,
    );
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    assert.equal(state.phase, "ABORTED");
    assert.equal(state.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
    assert.equal(state.primary.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
    assert.equal(state.fallback.used, false);
    fs.writeFileSync(prepared.files.prompt, "test prompt\n");
    assert.equal(abortHybrid({state: prepared.statePath, "run-id": prepared.runId}).phase, "ABORTED");
});

test("snapshot stale during finalize aborts an accepted primary", () => {
    const prepared = prepare(makeFixtureDir(), "stale-finalize");
    const primary = claim(prepared);
    fs.writeFileSync(primary.reportPath, JSON.stringify(validReport()));
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "1"});
    assert.equal(evaluated.next.action, "FINALIZE");
    fs.appendFileSync(prepared.files.prompt, "changed before finalize\n");

    assert.throws(
        () => finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId}),
        (error) => /input changed/.test(error.message) && error.failure_class === FAILURE_CLASSES.SNAPSHOT_STALE,
    );
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    assert.equal(state.phase, "ABORTED");
    assert.equal(state.failure_class, FAILURE_CLASSES.SNAPSHOT_STALE);
    assert.equal(state.snapshot_changed, true);
    fs.writeFileSync(prepared.files.prompt, "test prompt\n");
    assert.equal(abortHybrid({state: prepared.statePath, "run-id": prepared.runId}).phase, "ABORTED");
});

test("abort after an interrupted primary is idempotent", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir);
    const first = abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(first.phase, "ABORTED");
    const second = abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
    assert.equal(second.phase, "ABORTED");
});

function fixtureGit(cwd, args) {
    const result = spawnSync("git", args, {cwd, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
}

function initializeConsumer(cwd, branch, configured = true) {
    fs.mkdirSync(cwd, {recursive: true});
    fs.writeFileSync(path.join(cwd, "AGENTS.md"), "# Repository Guidelines\n");
    fs.writeFileSync(path.join(cwd, ".gitignore"), "var/\ncache-data/\n.agents/\n.worktrees/\n");
    if (configured) { fs.writeFileSync(path.join(cwd, ".env"), "CACHE_PATH=cache-data\n"); }
    fixtureGit(cwd, ["init", "-q", "-b", branch]);
    fixtureGit(cwd, ["add", "."]);
    fixtureGit(cwd, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "fixture"]);
}

function isolatedInstallation(configured = true) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "scout-topologies-"));
    const installation = path.join(root, "installation-a");
    initializeConsumer(installation, "installation", configured);
    fs.cpSync(path.join(ROOT, ".agents/skills/_shared"), path.join(installation, ".agents/skills/_shared"), {recursive: true});
    const dataDirectories = ["cache-data", "var/agent/cache", "var/agent/task-plan", "var/agent/plan-execute", "var/agent/code-implement"];
    for (const directory of dataDirectories) {
        fs.mkdirSync(path.join(installation, directory), {recursive: true});
        fs.writeFileSync(path.join(installation, directory, "sentinel"), directory);
    }
    return {root, installation, dataDirectories, helper: path.join(installation, ".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs")};
}

function workflowContents({installation, dataDirectories}) {
    const result = {};
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) { visit(target); } else {
                result[path.relative(installation, target)] = fs.readFileSync(target, "utf8");
            }
        }
    };
    for (const directory of dataDirectories) { visit(path.join(installation, directory)); }
    return result;
}

function consumerInputs(cwd, configured = true) {
    const cache = path.join(cwd, configured ? "cache-data" : "var/agent/cache");
    const output = path.join(cache, "same-task");
    fs.mkdirSync(output, {recursive: true});
    return {output, ...writeFixtures(output, "targeted", cwd)};
}

function helperCommand(fixture, cwd, command, args) {
    const result = spawnSync(process.execPath, [fixture.helper, command, ...args], {
        cwd, encoding: "utf8", env: {...process.env, CACHE_PATH: path.join(fixture.installation, "cache-data")},
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
}

for (const topology of ["local", "independent", "worktree"]) {
    for (const configured of [true, false]) {
        test(`full scout-file lifecycle in ${topology} with ${configured ? "project" : "default"} cache`, {timeout: 30_000}, () => {
            const fixture = isolatedInstallation(configured);
            let prepared;
            let cwd = fixture.installation;
            try {
                if (topology === "independent") {
                    cwd = path.join(fixture.root, "consumer-b");
                    initializeConsumer(cwd, "consumer-b", configured);
                    assert.equal(fs.existsSync(path.join(cwd, ".agents")), false);
                } else if (topology === "worktree") {
                    cwd = path.join(fixture.installation, ".worktrees/consumer-b");
                    fixtureGit(fixture.installation, ["worktree", "add", "-q", "-b", "consumer-b", cwd, "HEAD"]);
                    assert.equal(fs.statSync(path.join(cwd, ".git")).isFile(), true);
                    assert.equal(fixtureGit(fixture.installation, ["check-ignore", ".worktrees/consumer-b"]), ".worktrees/consumer-b");
                }
                const inputs = consumerInputs(cwd, configured);
                const beforeA = workflowContents(fixture);
                const beforeB = getWorktreeFingerprint({cwd});
                prepared = helperCommand(fixture, cwd, "prepare", ["--prompt-file", inputs.prompt, "--manifest", inputs.manifest,
                    "--handoff", inputs.handoff, "--criteria", inputs.criteria, "--output-dir", inputs.output, "--title", "same-task"]);
                const claimed = helperCommand(fixture, cwd, "claim", ["--state", prepared.statePath, "--run-id", prepared.runId, "--attempt", "primary"]);
                assert.equal(claimed.dispatch.prompt.includes(`Consumer project root: ${cwd}`), true);
                assert.equal(claimed.dispatch.prompt.includes(path.join(fixture.installation, ".agents/skills/_shared/references/repository-context-scout-playbook.md")), true);
                assert.equal(claimed.scoutPath.startsWith(inputs.output + path.sep), true);
                fs.writeFileSync(claimed.scoutPath, JSON.stringify(validReport()));
                const settled = helperCommand(fixture, cwd, "settle", ["--state", prepared.statePath, "--run-id", prepared.runId,
                    "--attempt", "primary", "--token", claimed.dispatchToken, "--duration-ms", "0"]);
                assert.equal(settled.finalized.hybrid_final, true);
                assert.equal(settled.finalized.final.reportPath, claimed.reportPath);
                assert.deepEqual(getWorktreeFingerprint({cwd}), beforeB);
                if (topology !== "local") { assert.deepEqual(workflowContents(fixture), beforeA); }
                for (const directory of fixture.dataDirectories) {
                    assert.equal(fs.readFileSync(path.join(fixture.installation, directory, "sentinel"), "utf8"), directory);
                }
                assert.equal(fs.existsSync(claimed.ledgerPath), true);
                assert.equal(fs.existsSync(claimed.reportPath), true);
            } finally {
                if (prepared && JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).phase !== "FINALIZED") {
                    helperCommand(fixture, cwd, "abort", ["--state", prepared.statePath, "--run-id", prepared.runId]);
                }
                fs.rmSync(fixture.root, {recursive: true, force: true});
            }
        });
    }
}

// A controller process stays alive between claim and settlement so the parent
// controls a real overlap, rather than inferring concurrency from timestamps.
function concurrentController(fixture, cwd, inputs) {
    const moduleUrl = new URL(`file://${fixture.helper}`).href;
    const script = `import fs from "node:fs";
import {prepareHybrid, claimAttempt, settleAttempt, abortHybrid} from ${JSON.stringify(moduleUrl)};
const inputs = JSON.parse(process.env.FIXTURE_INPUTS);
const prepared = prepareHybrid({"prompt-file":inputs.prompt, manifest:inputs.manifest, handoff:inputs.handoff, criteria:inputs.criteria, "output-dir":inputs.output, title:"same-task"});
const claimed = claimAttempt({state:prepared.statePath,"run-id":prepared.runId,attempt:"primary"});
process.send({event:"claimed",prepared,claimed});
process.on("message", () => {
 try {
  fs.writeFileSync(claimed.scoutPath, process.env.FIXTURE_REPORT);
  const result = settleAttempt({state:prepared.statePath,"run-id":prepared.runId,attempt:"primary",token:claimed.dispatchToken,"duration-ms":"0"});
  process.send({event:"settled",result}, () => process.disconnect());
 } catch (error) {
  abortHybrid({state:prepared.statePath,"run-id":prepared.runId});
  process.send({event:"failed",message:error.message}, () => process.disconnect());
  process.exitCode=1;
 }
});`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {cwd,
        env: {...process.env, CACHE_PATH: path.join(fixture.installation, "cache-data"), FIXTURE_INPUTS: JSON.stringify(inputs), FIXTURE_REPORT: JSON.stringify(validReport())},
        stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    const messages = new Map();
    const waiters = new Map();
    child.on("message", (message) => {
        messages.set(message.event, message);
        waiters.get(message.event)?.resolve(message);
    });
    const exited = new Promise((resolve) => child.on("close", (code, signal) => {
        for (const [event, waiter] of waiters) {
            if (!messages.has(event)) { waiter.reject(new Error(`controller exited (${code}, ${signal}): ${stderr}`)); }
        }
        resolve({code, signal});
    }));
    return {child, exited, wait(event) {
        if (messages.has(event)) { return Promise.resolve(messages.get(event)); }
        return new Promise((resolve, reject) => waiters.set(event, {resolve, reject}));
    }};
}

for (const interruptFirst of [false, true]) {
    test(`independent concurrent controllers ${interruptFirst ? "survive interruption of one environment" : "both finalize"}`, {timeout: 30_000}, async () => {
        const fixture = isolatedInstallation();
        const processes = [];
        const claimed = [];
        const consumers = ["consumer-b", "consumer-c"].map((name) => path.join(fixture.root, name));
        const beforeA = workflowContents(fixture);
        try {
            for (const cwd of consumers) {
                initializeConsumer(cwd, path.basename(cwd));
                processes.push(concurrentController(fixture, cwd, consumerInputs(cwd)));
            }
            claimed.push(...await Promise.all(processes.map((controller) => controller.wait("claimed"))));
            assert.notEqual(processes[0].child.pid, processes[1].child.pid);
            assert.notEqual(claimed[0].prepared.statePath, claimed[1].prepared.statePath);
            assert.notEqual(claimed[0].claimed.scoutPath, claimed[1].claimed.scoutPath);
            for (const [index, message] of claimed.entries()) {
                assert.equal(message.claimed.scoutPath.startsWith(path.join(consumers[index], "cache-data") + path.sep), true);
            }
            if (interruptFirst) {
                processes[0].child.kill("SIGTERM");
                await processes[0].exited;
            } else { processes[0].child.send("finish"); }
            processes[1].child.send("finish");
            const survivors = interruptFirst ? [processes[1]] : processes;
            for (const controller of survivors) {
                const settled = await controller.wait("settled");
                assert.equal(settled.result.finalized.hybrid_final, true);
                assert.equal((await controller.exited).code, 0);
            }
            if (interruptFirst) {
                const {prepared} = claimed[0];
                assert.equal(JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).phase, "PRIMARY_RUNNING");
                assert.equal(helperCommand(fixture, consumers[0], "abort", ["--state", prepared.statePath, "--run-id", prepared.runId]).phase, "ABORTED");
            }
            assert.deepEqual(workflowContents(fixture), beforeA);
        } finally {
            for (const controller of processes) { if (controller.child.exitCode === null) { controller.child.kill("SIGTERM"); } }
            await Promise.all(processes.map((controller) => controller.exited));
            for (const [index, message] of claimed.entries()) {
                if (JSON.parse(fs.readFileSync(message.prepared.statePath, "utf8")).phase !== "FINALIZED") {
                    helperCommand(fixture, consumers[index], "abort", ["--state", message.prepared.statePath, "--run-id", message.prepared.runId]);
                }
            }
            fs.rmSync(fixture.root, {recursive: true, force: true});
        }
    });
}
