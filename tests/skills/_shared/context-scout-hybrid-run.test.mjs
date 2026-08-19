import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "vitest";
import {FAILURE_CLASSES} from "../../../.agents/skills/_shared/scripts/context-scout-report.mjs";
import {abortHybrid, claimAttempt, evaluateAttempt, finalizeHybrid, prepareHybrid, settleAttempt} from "../../../.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs";
import {enrichContextManifest} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const HELPER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-hybrid-run.mjs");
const REPORT_BUILDER = path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs");

function makeFixtureDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "context-scout-hybrid-test-"));
}

function writeFixtures(dir, mode = "targeted") {
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
        rules: ["AGENTS.md"],
        documentation: [],
        "active_overrides": [],
        constraints: [],
        "already_read": ["AGENTS.md"],
        omitted: [],
    });
    if (!sourceManifest.repository) {
        sourceManifest.repository = "local/repository";
    }
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

test("prepare returns native task instructions and never starts OpenCode", () => {
    const dir = makeFixtureDir();
    const result = prepare(dir);
    assert.equal(result.protocolVersion, 3);
    assert.equal(result.next.action, "CLAIM_PRIMARY");
    assert.equal(result.next.agent, "context-scout-fast");
    const claimed = claim(result);
    assert.match(claimed.taskPrompt, /Do not delegate/);
    assert.match(claimed.taskPrompt, /batch-render/);
    assert.match(claimed.taskPrompt, /at most 6 relevant files, 3 symbols, and 2 tests\/commands/);
    assert.match(claimed.taskPrompt, /exactly one compact, parent-ready finding per criterion/);
    assert.match(claimed.taskPrompt, /at most three minimal evidence ranges per finding/);
    assert.match(claimed.taskPrompt, /keep coverage\[\]\.evidence empty/);
    assert.match(claimed.taskPrompt, /search for that exact name and directly read its defining source/);
    assert.match(claimed.taskPrompt, /criteria\[\]\.required_evidence entry as a hard validator gate/);
    assert.match(claimed.taskPrompt, /anchor_mode=required-literal/);
    assert.match(claimed.taskPrompt, /A COMPLETE report must not claim that an artifact does not exist/);
    assert.match(claimed.taskPrompt, /return INCOMPLETE/);
    assert.match(claimed.taskPrompt, /initialize the ledger exactly once/);
    assert.match(claimed.taskPrompt, /send it directly to batch-render as the second and final builder operation/);
    assert.match(claimed.taskPrompt, /node \.\/\.agents\/skills\/_shared\/scripts\/context-scout-report-builder\.mjs batch-render/);
    assert.match(claimed.taskPrompt, /COMPLETE: every criterion has direct evidence/);
    assert.match(claimed.taskPrompt, /INCOMPLETE: discovery or verification ran out/);
    assert.match(claimed.taskPrompt, /BLOCKED: a hard input/);
    assert.match(claimed.taskPrompt, /<<'REPORT_JSON'\n<STATUS_REPORT_JSON>\nREPORT_JSON/);
    assert.match(claimed.taskPrompt, /run the opening command, payload, and closing marker as one bash call/);
    assert.match(claimed.taskPrompt, /Do not run batch-render with empty stdin/);
    assert.match(claimed.taskPrompt, /Do not create a separate input file/);
    assert.match(claimed.taskPrompt, /process substitution/);
    assert.doesNotMatch(claimed.taskPrompt, /node \.agents\/skills\/_shared\/scripts\/context-scout-report-builder\.mjs/);
    assert.match(claimed.taskPrompt, /Do not spend more than 24 steps/);
    assert.doesNotMatch(claimed.taskPrompt, /report_sha256/);
    assert.doesNotMatch(claimed.taskPrompt, /opencode run/);
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
    const dir = makeFixtureDir();
    const files = writeFixtures(dir);
    const result = spawnSync(process.execPath, [
        HELPER,
        "prepare",
        "--prompt-file", files.prompt,
        "--manifest", files.manifest,
        "--handoff", files.handoff,
        "--criteria", files.criteria,
        "--output-dir", dir,
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
    assert.match(claimed.taskPrompt, /at most 10 relevant files, 5 symbols, and 3 tests\/commands/);
    assert.doesNotMatch(claimed.taskPrompt, /at most 6 relevant files/);
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
    const primaryBudgetLine = primary.taskPrompt.split("\n").find((line) => line.startsWith("Budget contract:"));
    assert.match(fallback.taskPrompt, /criteria\[\]\.required_evidence entry as a hard validator gate/);
    assert.match(fallback.taskPrompt, /forbid_negative_claims/);
    assert.match(fallback.taskPrompt, /minimum_file_budget=0/);
    assert.match(fallback.taskPrompt, /effective_file_budget=6/);
    assert.equal(fallback.taskPrompt.includes(primaryBudgetLine), true);
    assert.match(fallback.taskPrompt, /COMPLETE: every criterion has direct evidence/);
    assert.match(fallback.taskPrompt, /<<'REPORT_JSON'\n<STATUS_REPORT_JSON>\nREPORT_JSON/);
    assert.match(fallback.taskPrompt, /Do not create a separate input file/);
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
    fs.writeFileSync(primary.reportPath, JSON.stringify({...validReport(), status: "INCOMPLETE"}));

    const evaluation = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken});
    assert.equal(evaluation.failure_class, FAILURE_CLASSES.AGENT_INCOMPLETE);
    assert.equal(evaluation.next.action, "CLAIM_FALLBACK");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("valid blocked report is classified as retryable agent incompleteness through the helper", () => {
    const prepared = prepare(makeFixtureDir(), "agent-blocked");
    const primary = claim(prepared);
    fs.writeFileSync(primary.reportPath, JSON.stringify({
        ...validReport(),
        status: "BLOCKED",
        findings: [],
        coverage: [{criterion_id: "C1", status: "blocked", reason: "source was not available"}],
    }));

    const evaluation = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken});
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
    fs.writeFileSync(primary.reportPath, JSON.stringify(validReport()));
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
});

test("recovers a valid report from the primary ledger when render was interrupted", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir, "ledger-recovery");
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    const init = spawnSync(process.execPath, [
        path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs"),
        "init",
        state.primary.ledgerPath,
        "--head",
        state.manifestHead,
        "--criteria",
        prepared.files.criteria,
        "--mode",
        "targeted",
    ], {cwd: ROOT, encoding: "utf8"});
    assert.equal(init.status, 0, init.stderr);
    const batch = spawnSync(process.execPath, [
        path.join(ROOT, ".agents/skills/_shared/scripts/context-scout-report-builder.mjs"),
        "batch",
        state.primary.ledgerPath,
    ], {cwd: ROOT, encoding: "utf8", input: `${JSON.stringify(validReport())}\n`});
    assert.equal(batch.status, 0, batch.stderr);

    const primary = claim(prepared);
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "123"});

    assert.equal(evaluated.validation.valid, true);
    assert.equal(fs.existsSync(primary.reportPath), true);
    assert.equal(evaluated.next.action, "FINALIZE");
    finalizeHybrid({state: prepared.statePath, "run-id": prepared.runId});
});

test("recovers an incomplete report from the ledger without coercing it to COMPLETE", () => {
    const dir = makeFixtureDir();
    const prepared = prepare(dir, "ledger-incomplete-recovery");
    const state = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    const init = spawnSync(process.execPath, [
        REPORT_BUILDER,
        "init",
        state.primary.ledgerPath,
        "--head",
        state.manifestHead,
        "--criteria",
        prepared.files.criteria,
        "--mode",
        "targeted",
    ], {cwd: ROOT, encoding: "utf8"});
    assert.equal(init.status, 0, init.stderr);
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
    const batch = spawnSync(process.execPath, [REPORT_BUILDER, "batch", state.primary.ledgerPath], {
        cwd: ROOT,
        encoding: "utf8",
        input: `${JSON.stringify(incomplete)}\n`,
    });
    assert.equal(batch.status, 0, batch.stderr);

    const primary = claim(prepared);
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken, "duration-ms": "123"});

    assert.equal(evaluated.validation.reportExists, true);
    assert.equal(evaluated.validation.status, "INCOMPLETE");
    assert.equal(evaluated.failure_class, FAILURE_CLASSES.AGENT_INCOMPLETE);
    assert.equal(evaluated.next.action, "CLAIM_FALLBACK");
    const stateAfterEvaluation = JSON.parse(fs.readFileSync(prepared.statePath, "utf8"));
    assert.equal(JSON.parse(fs.readFileSync(stateAfterEvaluation.primary.reportDiscardedPath, "utf8")).status, "INCOMPLETE");
    abortHybrid({state: prepared.statePath, "run-id": prepared.runId});
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
    assert.equal(primary.next.agent, "context-scout");
    assert.equal(fs.existsSync(primaryClaim.reportPath), false);
    const discardedPrimary = JSON.parse(fs.readFileSync(prepared.statePath, "utf8")).primary.reportDiscardedPath;
    assert.equal(typeof discardedPrimary, "string");
    assert.equal(fs.existsSync(discardedPrimary), true);
    const stateAfterPrimary = fs.readFileSync(prepared.statePath, "utf8");
    assert.doesNotMatch(stateAfterPrimary, /not-json|validator_failed/);
    const fallbackClaim = claim(prepared, "fallback");
    assert.equal(fallbackClaim.agent, "context-scout");
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
    const relativePath = "AGENTS.md";
    const absolutePath = path.join(ROOT, relativePath);
    const original = fs.readFileSync(absolutePath, "utf8");
    const clean = spawnSync("git", ["diff", "--quiet", "--", relativePath], {cwd: ROOT, encoding: "utf8"});
    assert.equal(clean.status, 0, "AGENTS.md must be clean before the drift test");
    const prepared = prepare(makeFixtureDir(), "stale-unstaged-worktree");

    assertEvaluateRejectsWorktreeDrift(
        prepared,
        () => fs.writeFileSync(absolutePath, `${original}\nunstaged drift\n`),
        () => fs.writeFileSync(absolutePath, original),
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
    const evaluated = evaluateAttempt({state: prepared.statePath, "run-id": prepared.runId, attempt: "primary", token: primary.dispatchToken});
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
