import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {afterEach, test} from "vitest";
import {prepareScout, claimScout, settleScout, abortScout} from "../../../.agents/skills/_shared/scripts/context-scout-run.mjs";
import {enrichContextManifest} from "../../../.agents/skills/_shared/scripts/context-manifest.mjs";

const temp = [];
afterEach(() => { for (const root of temp.splice(0)) { fs.rmSync(root, {recursive: true, force: true}); } });
function fixture(worktree = false) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "single-scout-")); temp.push(root);
    const git = (cwd, ...args) => execFileSync("git", args, {cwd, stdio: "pipe"});
    git(root, "init", "-q"); git(root, "config", "user.name", "Fixture"); git(root, "config", "user.email", "fixture@example.test");
    fs.writeFileSync(path.join(root, "AGENTS.md"), "Repository Guidelines\n".repeat(140));
    fs.writeFileSync(path.join(root, ".gitignore"), "var/\n"); git(root, "add", "."); git(root, "commit", "-qm", "fixture");
    let cwd = root;
    if (worktree) { cwd = path.join(root, "issue"); git(root, "worktree", "add", "--detach", cwd); }
    const dir = path.join(cwd, "var/agent/cache/scout"); fs.mkdirSync(dir, {recursive: true});
    const write = (name, value) => { const file = path.join(dir, name); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); return file; };
    const manifest = enrichContextManifest({version: 1, role: "primary", stack_profile: "generic", rules: ["AGENTS.md"], documentation: [], active_overrides: [], constraints: [], already_read: [], omitted: []}, {cwd});
    const args = {
        "prompt-file": write("prompt.txt", "Map repository rules."), manifest: write("manifest.json", manifest),
        handoff: write("handoff.json", {mode: "cross-layer", task_brief: "Map rules.", decisions: [], constraints: []}),
        criteria: write("criteria.json", {criteria: [{id: "C1", description: "Map rules.", required_evidence: [{path: "AGENTS.md", anchors: ["Repository Guidelines"]}]}]}),
        "output-dir": dir,
    };
    const prepared = prepareScout(args, cwd);
    const common = {state: prepared.statePath, "run-id": prepared.runId};
    return {cwd, args, prepared, common, write};
}
function report(status = "COMPLETE") {
    const evidence = {path: "AGENTS.md", line_start: 1, line_end: 140};
    return {version: 1, status, mode: "cross-layer", findings: status === "COMPLETE" ? [{criterion_id: "C1", claim: "Repository rules.", claim_type: "observed", confidence: "high", anchors: ["Repository Guidelines"], evidence: [evidence]}] : [],
        coverage: [{criterion_id: "C1", status: status === "COMPLETE" ? "covered" : "blocked", evidence: [], reason: "Required external input unavailable."}], risks: [], omitted: [], next_step: ""};
}
function start(f) { const claim = claimScout(f.common); return {...claim, args: {...f.common, token: claim.dispatchToken}}; }

test("one scout finalizes a complete report with unbounded valid ranges in an external consumer", () => {
    const f = fixture(); const c = start(f);
    assert.equal(c.dispatch.subagent_type, "context-scout");
    assert.match(c.dispatch.prompt, /no numeric limits/);
    assert.doesNotMatch(c.dispatch.prompt, /CLAIM_FALLBACK|effective_file_budget|at most/);
    fs.writeFileSync(c.scoutPath, JSON.stringify(report()));
    const result = settleScout(c.args);
    assert.equal(result.next.action, "RETURN_RESULT"); assert.equal(result.finalized.complete, true);
    assert.ok(fs.existsSync(result.finalized.final.reportPath));
    assert.equal(result.finalized.schemaValid, true);
    assert.throws(() => claimScout(f.common), /Cannot claim/);
});
for (const status of ["INCOMPLETE", "BLOCKED"]) {
    test(`valid ${status} is returned without automatic rediscovery`, () => {
        const f = fixture(); const c = start(f); fs.writeFileSync(c.scoutPath, JSON.stringify(report(status)));
        const result = settleScout(c.args);
        assert.equal(result.next.action, "RETURN_RESULT"); assert.equal(result.finalized.complete, false);
        assert.equal(result.finalized.status, status); assert.ok(result.finalized.final.reportPath);
    });
}
test("report errors are repaired in the same claimed context without another discovery claim", () => {
    const f = fixture(true); const c = start(f);
    fs.writeFileSync(c.scoutPath, JSON.stringify({...report(), version: 0}));
    const invalid = settleScout(c.args);
    assert.equal(invalid.next.action, "REPAIR_REPORT"); assert.match(invalid.validation.diagnostics.message, /version must be 1/);
    assert.match(invalid.next.prompt, /same scout context/); assert.match(invalid.next.prompt, /do not repeat discovery/);
    assert.throws(() => claimScout(f.common), /Cannot claim/);
    fs.writeFileSync(c.scoutPath, JSON.stringify(report()));
    const result = settleScout(c.args);
    assert.equal(result.finalized.complete, true); assert.equal(result.finalized.validationHistory.length, 1);
});
test("unchanged validation errors stop instead of looping", () => {
    const f = fixture(); const c = start(f); fs.writeFileSync(c.scoutPath, "not-json");
    assert.equal(settleScout(c.args).next.action, "REPAIR_REPORT");
    const result = settleScout(c.args);
    assert.equal(result.next.action, "STOP"); assert.equal(result.validation.reason, "NO_REPAIR_PROGRESS");
    assert.equal(result.finalized.schemaValid, false); assert.equal(result.finalized.final.reportPath, null);
});
test("a cycle of validation errors also stops without a numeric retry budget", () => {
    const f = fixture(); const c = start(f);
    for (const version of [0, 1, 0]) {
        const payload = report(); if (version === 0) { payload.version = 0; } else { payload.mode = "targeted"; }
        fs.writeFileSync(c.scoutPath, JSON.stringify(payload));
        const result = settleScout(c.args);
        assert.equal(result.next.action, version === 0 && result.phase === "FINALIZED" ? "STOP" : "REPAIR_REPORT");
    }
    assert.equal(JSON.parse(fs.readFileSync(f.prepared.statePath)).phase, "FINALIZED");
});
test("a missing report can be supplied by the same scout", () => {
    const f = fixture(); const c = start(f); assert.equal(settleScout(c.args).next.action, "REPAIR_REPORT");
    fs.writeFileSync(c.scoutPath, JSON.stringify(report())); assert.equal(settleScout(c.args).finalized.complete, true);
});
test("wrong mode is repaired even when its JSON envelope is otherwise valid", () => {
    const f = fixture(); const c = start(f); fs.writeFileSync(c.scoutPath, JSON.stringify({...report(), mode: "targeted"}));
    assert.equal(settleScout(c.args).validation.diagnostics.stage, "report-mode");
    fs.writeFileSync(c.scoutPath, JSON.stringify(report())); assert.equal(settleScout(c.args).finalized.complete, true);
});
for (const changed of ["prompt", "source"]) {
    test(`changed ${changed} aborts the run instead of accepting stale evidence`, () => {
        const f = fixture(); const c = start(f);
        fs.writeFileSync(changed === "prompt" ? f.args["prompt-file"] : path.join(f.cwd, "AGENTS.md"), "changed\n");
        assert.throws(() => settleScout(c.args), /changed/);
        assert.equal(JSON.parse(fs.readFileSync(f.prepared.statePath)).phase, "ABORTED");
    });
}
test("duplicate claim and wrong token cannot take ownership", () => {
    const f = fixture(); const c = start(f); assert.throws(() => claimScout(f.common), /Cannot claim/);
    assert.throws(() => settleScout({...c.args, token: "other"}), /Matching scout token/);
    assert.equal(abortScout(f.common).phase, "ABORTED");
});
test("preflight still rejects wrong evidence paths and inputs outside consumer cache", () => {
    const f = fixture(); f.write("criteria.json", {criteria: [{id: "C1", description: "Missing path.", required_evidence: [{path: "missing.php"}]}]});
    assert.throws(() => prepareScout(f.args, f.cwd), /INVALID_CRITERIA_PATH/);
    assert.throws(() => prepareScout({...f.args, "prompt-file": path.join(f.cwd, "AGENTS.md")}, f.cwd), /CACHE_PATH/);
});
test("historical two-scout protocol state is not resumed", () => {
    const f = fixture(); const state = JSON.parse(fs.readFileSync(f.prepared.statePath)); state.protocolVersion = 5;
    fs.writeFileSync(f.prepared.statePath, JSON.stringify(state)); assert.throws(() => claimScout(f.common), /historical runs/);
});

test("JSON null is returned for report repair instead of crashing the controller", () => {
    const f = fixture(); const c = start(f); fs.writeFileSync(c.scoutPath, "null");
    const result = settleScout(c.args);
    assert.equal(result.next.action, "REPAIR_REPORT"); assert.equal(result.validation.diagnostics.stage, "scout-status");
    abortScout(f.common);
});
