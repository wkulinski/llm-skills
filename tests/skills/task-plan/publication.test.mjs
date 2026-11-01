import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {afterEach, it} from "vitest";

import {normalizeGitHubIssue, normalizeUserInput, normalizeFileSource, persistSource, buildPlanId} from "../../../.agents/skills/task-plan/scripts/source.mjs";
import {assessPublication, bindPublication, checkAssessment, checkPublication, loadPublication, publishPlan, refreshCommitPublication, renderPublication, selectCommitPublication, updatePublication} from "../../../.agents/skills/task-plan/scripts/publish.mjs";
import {writeFileAtomic} from "../../../.agents/skills/task-plan/scripts/atomic-file.mjs";

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) { fs.rmSync(root, {recursive: true, force: true}); } });

function fixture(kind = "user") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "publication-"));
    roots.push(root);
    assert.equal(spawnSync("git", ["init", "--quiet"], {cwd: root}).status, 0);
    fs.mkdirSync(path.join(root, "docs/plans"), {recursive: true});
    fs.writeFileSync(path.join(root, "input.md"), "File input");
    const normalizedSource = kind === "github" ? normalizeGitHubIssue({owner: "owner", repo: "repo", issue: 123, body: "Work"})
        : kind === "file" ? normalizeFileSource({repoRoot: root, filePath: "input.md"})
            : normalizeUserInput({body: "Work"});
    const persisted = persistSource(normalizedSource, {repoRoot: root});
    const planId = buildPlanId(normalizedSource.identity);
    const planPath = `docs/plans/${planId}.md`;
    fs.writeFileSync(path.join(root, planPath), `---\nplan_id: "${planId}"\nsource_identity: "${normalizedSource.identity}"\nsource_artifact: "var/agent/task-plan/${planId}/source.json"\nsource_sha256: "${persisted.sha256}"\n---\n# Example\n\n## Execution\n\n- [x] WP1 — 2026-10-01 — focused check passed\n`);
    fs.mkdirSync(path.join(root, "var/agent/plan-execute"), {recursive: true});
    fs.writeFileSync(path.join(root, "var/agent/plan-execute/last-plan.txt"), `${planPath}\n`);
    return {repoRoot: root, planPath};
}

const empty = () => ({confirm_current_inputs: true, sources: [], summaries: [], replacements: [], materials: []});
const issueUrl = "https://github.com/owner/repo/issues/123";
const bind = (options) => bindPublication({...options, issueUrl});
const load = (options) => loadPublication(options);
const current = (options) => { const {context, record} = load(options); return checkAssessment(context, record); };
function report(options, filename = "var/receipts/WP1-report.md", content = "Reason for the compromise.") {
    fs.mkdirSync(path.dirname(path.join(options.repoRoot, filename)), {recursive: true});
    fs.writeFileSync(path.join(options.repoRoot, filename), content);
    return filename;
}
function source(filename, disposition = "summary") {
    return {path: filename, disposition, status: "current", reason: "Unique rationale"};
}
function material(filename, overrides = {}) {
    return {name: "rationale.md", source_path: filename, kind: "report", duplicate: false,
        available_in_project: false, technical: false, text: "Detailed rationale", status: "current", source_paths: [filename],
        justification: {essential: "Explains the decision", unique: "Not in project or upstream", summary_insufficient: "Detailed table is necessary"}, ...overrides};
}

it("bind requires an explicit full URL and rejects a different GitHub source without writes", () => {
    const options = fixture("github");
    for (const value of ["123", "owner/repo#123", "https://github.com/owner/else/issues/123", "https://github.com/owner/repo/issues/124"]) {
        assert.throws(() => bindPublication({...options, issueUrl: value}));
        assert.equal(load(options).record, null);
    }
    assert.equal(bind(options).record.issue.url, issueUrl);
    const before = fs.readFileSync(load(options).context.recordPath);
    assert.throws(() => bindPublication({...options, issueUrl: "https://github.com/other/repo/issues/123"}));
    assert.deepEqual(fs.readFileSync(load(options).context.recordPath), before);
});

it("bind/assess support file and user plans, explicit empty selection and leave plan and pointer unchanged", () => {
    for (const kind of ["file", "user"]) {
        const options = fixture(kind);
        const before = fs.readFileSync(path.join(options.repoRoot, options.planPath));
        const pointer = fs.readFileSync(path.join(options.repoRoot, "var/agent/plan-execute/last-plan.txt"));
        bind(options);
        assert.throws(() => assessPublication({...options, input: {confirm_current_inputs: true}}));
        assert.throws(() => assessPublication({...options, input: {...empty(), confirm_current_inputs: false}}));
        assessPublication({...options, input: empty()});
        assert.equal(current(options).current, true);
        assert.deepEqual(fs.readFileSync(path.join(options.repoRoot, options.planPath)), before);
        assert.deepEqual(fs.readFileSync(path.join(options.repoRoot, "var/agent/plan-execute/last-plan.txt")), pointer);
        const recordFile = load(options).context.recordPath;
        const mtime = fs.statSync(recordFile).mtimeMs;
        assessPublication({...options, input: empty()});
        bind(options);
        assert.equal(fs.statSync(recordFile).mtimeMs, mtime);
        fs.copyFileSync(path.join(options.repoRoot, options.planPath), path.join(options.repoRoot, "docs/plans/renamed.md"));
        assert.throws(() => bind({...options, planPath: "docs/plans/renamed.md"}), {code: "NON_CANONICAL_PLAN_PATH"});
    }
});

it("hashes all evaluated reports including omitted duplicates and confirms unchanged ready text for new hashes", () => {
    const options = fixture();
    const filename = report(options);
    const duplicate = report(options, "var/receipts/WP1-duplicate.md");
    fs.appendFileSync(path.join(options.repoRoot, options.planPath), `\nReceipt: [report](../../../${filename}) and \`${duplicate}\`.\n`);
    bind(options);
    assert.throws(() => assessPublication({...options, input: empty()}), {code: "ASSESSMENT_SOURCE_REQUIRED"});
    const input = {...empty(), sources: [source(filename), source(duplicate, "omitted")],
        summaries: [{text: "The bounded compromise is intentional.", status: "current", source_paths: [filename], wp_id: "WP1"}]};
    assessPublication({...options, input});
    assert.equal(current(options).current, true);
    fs.appendFileSync(path.join(options.repoRoot, duplicate), " Changed duplicate");
    assert.equal(current(options).current, false);
    assessPublication({...options, input});
    assert.equal(current(options).current, true);
    assert.equal(load(options).record.assessment.selection.summaries[0].text, input.summaries[0].text);
    fs.appendFileSync(path.join(options.repoRoot, filename), " Changed source");
    assert.equal(current(options).current, false);
    fs.unlinkSync(path.join(options.repoRoot, filename));
    assert.match(current(options).reasons.join(), /source unavailable/);
});

it("invalidates on any plan bytes, selection and publication rule changes even with a completed WP", () => {
    const options = fixture();
    bind(options);
    assessPublication({...options, input: empty()});
    fs.appendFileSync(path.join(options.repoRoot, options.planPath), "\nA new shared decision.\n");
    assert.match(current(options).reasons.join(), /plan changed/);
    assessPublication({...options, input: empty()});
    const {context, record} = load(options);
    record.assessment.selection.summaries.push({text: "Unconfirmed edit", status: "current", source_paths: []});
    fs.writeFileSync(context.recordPath, JSON.stringify(record));
    assert.match(current(options).reasons.join(), /selection changed/);
    assessPublication({...options, input: empty()});
    const next = load(options).record;
    next.rules_version = 0;
    fs.writeFileSync(context.recordPath, JSON.stringify(next));
    assert.match(current(options).reasons.join(), /rules changed/);
});

it("requires all three material exceptions and rejects duplicates, norms, technical paths and output collisions", () => {
    const options = fixture();
    const filename = report(options);
    bind(options);
    const input = {...empty(), sources: [source(filename, "material")], materials: [material(filename)]};
    assessPublication({...options, input});
    for (const overrides of [{duplicate: true}, {technical: true}, {available_in_project: true}, {kind: "standard"},
        {justification: {essential: "yes", unique: "yes"}}, ...["plan.md", "PLAN.md", "README.md", "../escape.md", "sub/file.md", "plan.original.md"].map((name) => ({name}))]) {
        assert.throws(() => assessPublication({...options, input: {...input, materials: [material(filename, overrides)]}}));
    }
    assert.throws(() => assessPublication({...options, input: {...input, materials: [material(filename), material(filename, {name: "Rationale.md"})]}}));
    const technical = report(options, "var/agent/qa-run/report.md");
    assert.throws(() => assessPublication({...options, input: {...empty(), sources: [source(technical, "material")], materials: [material(technical)]}}), {code: "INVALID_MATERIAL"});
});

it("preserves publisher hashes and unresolved intent across bind/assess, and applies common lock/base checks", () => {
    const options = fixture();
    bind(options);
    const {context} = load(options);
    const outputs = {"plan.md": "publisher hash"};
    const intent = {outputs: {"plan.md": "pending hash"}};
    const previous = updatePublication(context, (record) => ({...record, outputs, intent}));
    assessPublication({...options, input: empty()});
    bind(options);
    assert.deepEqual(load(options).record.outputs, outputs);
    assert.deepEqual(load(options).record.intent, intent);
    assert.throws(() => assessPublication({...options, input: empty(), expectedBase: previous.base}), {code: "PUBLICATION_CONFLICT"});
    fs.writeFileSync(`${context.recordPath}.lock`, "another writer");
    assert.throws(() => assessPublication({...options, input: empty()}), {code: "PUBLICATION_LOCKED"});
    fs.unlinkSync(`${context.recordPath}.lock`);
    const fresh = load(options).context;
    assert.throws(() => updatePublication(fresh, (record) => {
        fs.appendFileSync(fresh.absolute, "\nchanged concurrently\n");
        return record;
    }), {code: "PUBLICATION_CONFLICT"});
});

it("CLI help is nonmutating and bind/assess/check use the shared facade", () => {
    const options = fixture();
    const cli = path.resolve(".agents/skills/task-plan/scripts/publish.mjs");
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], {cwd: options.repoRoot, encoding: "utf8"});
    assert.equal(run("--help").status, 0);
    assert.equal(load(options).record, null);
    assert.equal(run("bind", "--path", options.planPath, "--issue", issueUrl).status, 0);
    const result = spawnSync(process.execPath, [cli, "assess", "--path", options.planPath, "--input", "-"], {
        cwd: options.repoRoot, encoding: "utf8", input: JSON.stringify(empty()),
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(run("check", "--path", options.planPath).status, 0);
});

function render(options, projectFiles = []) {
    const {context, record} = load(options);
    return renderPublication({markdown: context.loaded.markdown, record, projectFiles,
        sourceContents: Object.fromEntries(record.assessment.sources.map((entry) => [entry.path, fs.readFileSync(path.join(options.repoRoot, entry.path), "utf8")]))});
}

it("renders unstarted, partial and completed states faithfully with stable identity and no tooling metadata", () => {
    for (const progress of ["- [ ] WP1\n- [ ] WP2", "- [x] WP1 — 2026-10-01 — Narrow test passed\n- [ ] WP2", "- [x] WP1 — 2026-10-01 — Narrow test passed\n- [x] WP2 — 2026-10-02 — Review accepted"]) {
        const options = fixture();
        const file = path.join(options.repoRoot, options.planPath);
        const front = fs.readFileSync(file, "utf8").split("# Example")[0];
        const body = `# Example\n\n## Execution\n\n<details>\n<summary>Progress</summary>\n\n${progress}\n\n</details>\n\n## Scope\n\nPreserve the bounded scope, criteria and świadomy kompromis.\n\n## Work packages\n\n### WP1 — Work\n\n- Goal: Correct result.\n- Acceptance criteria: Scope remains bounded.\n- Estimated size: medium\n- Difficulty: v1\n  - Logic: 1\n- Verification: Focused checks.\n\n### WP2 — Next\n\n- Scope: Next result.\n\n## Decisions and open questions\n\nD1: Intentional compromise.\n\n## Risks and discovery debt\n\nBounded risk.\n\n## Execution environment\n\n- Default model: hidden\n- Default reasoning: high\n`;
        fs.writeFileSync(file, front + body);
        bind(options);
        assessPublication({...options, input: empty()});
        const outputs = render(options);
        assert.deepEqual(Object.keys(outputs), ["plan.md"]);
        assert.ok(outputs["plan.md"].includes(progress));
        for (const value of ["Preserve the bounded scope, criteria and świadomy kompromis.", "- Acceptance criteria: Scope remains bounded.", "D1: Intentional compromise.", "Bounded risk.", issueUrl]) {
            assert.ok(outputs["plan.md"].includes(value));
        }
        assert.doesNotMatch(outputs["plan.md"], /source_sha256|source_artifact|Default model|Difficulty|Estimated size|Execution environment/);
        assert.deepEqual(render(options), outputs);
    }
});

it("replaces assessed local reports in Markdown, reference links, HTML and plain text without deleting rationale", () => {
    const options = fixture();
    const filename = report(options);
    const file = path.join(options.repoRoot, options.planPath);
    fs.appendFileSync(file, `\n## Work packages\n\n### WP1 — Work\n\nReason stays: [receipt](../../${filename}).\n[receipt again][local]\n[local]: ../../${filename}\n<a href="../../${filename}">receipt</a>\n<a href=../../${filename}>receipt</a>\nTrace: \`${filename}\`.\nTooling [proof](../../var/agent/context/manifest.json).\n`);
    bind(options);
    const replacement = {reference: filename, text: "Exact unique compromise — no new verification claimed.", status: "current", source_paths: [filename]};
    assessPublication({...options, input: {...empty(), sources: [source(filename)], replacements: [replacement]}});
    const result = render(options)["plan.md"];
    assert.match(result, /Reason stays: Exact unique compromise/);
    assert.equal(result.split(replacement.text).length - 1, 5);
    assert.doesNotMatch(result, /var\/|manifest\.json|href=|\[local\]:/);
    assert.match(result, /Tooling proof/);
});

it("rebases project/upstream links, handles definitions across fences, and preserves fenced examples", () => {
    const options = fixture();
    const file = path.join(options.repoRoot, options.planPath);
    fs.appendFileSync(file, '\n[code](../../src/Example.mjs)\n[docs][d]\n<a href="../guide.md">Guide</a>\n```md\n[example](var/local/sample.md)\n```\n[d]: ../guide.md\nProfile: `.agents/profiles/local.md`\n');
    bind(options);
    assessPublication({...options, input: {...empty(), replacements: [{reference: ".agents/profiles/local.md", text: "[Profile](https://github.com/owner/upstream/blob/main/profile.md)", status: "current", source_paths: []}]}});
    const result = render(options, ["src/Example.mjs", "docs/guide.md"])["plan.md"];
    assert.match(result, /\[code\]\(\.\.\/\.\.\/\.\.\/src\/Example\.mjs\)/);
    assert.match(result, /\[d\]: \.\.\/\.\.\/guide\.md/);
    assert.match(result, /href="\.\.\/\.\.\/guide\.md"/);
    assert.match(result, /```md\n\[example\]\(var\/local\/sample\.md\)\n```/);
    assert.match(result, /https:\/\/github.com\/owner\/upstream/);
});

it("requires explicit history on reopened work and keeps original result dates", () => {
    const options = fixture();
    const file = path.join(options.repoRoot, options.planPath);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/- \[x\] WP1[^\n]+/, "- [ ] WP1") + "\n## Work packages\n\n### WP1 — Work\n\n- Acceptance criteria: Revised result.\n");
    bind(options);
    const summary = {text: "2026-10-01 — original check passed for earlier criteria.", status: "current", source_paths: [], wp_id: "WP1"};
    assessPublication({...options, input: {...empty(), summaries: [summary]}});
    assert.throws(() => render(options), {code: "ASSESSMENT_REOPENED_WP"});
    assessPublication({...options, input: {...empty(), summaries: [{...summary, status: "historical"}]}});
    const result = render(options)["plan.md"];
    assert.match(result, /- \[ \] WP1/);
    assert.match(result, /\[historical\] 2026-10-01 — original check passed for earlier criteria/);
    assert.match(result, /Revised result/);
});

it("emits only a selected exceptional material and refuses unknown local references or changed source bytes", () => {
    const options = fixture();
    const filename = report(options, "var/receipts/decision-report.md", "# Essential reasoning\n\nUnique result.\n");
    bind(options);
    assessPublication({...options, input: {...empty(), sources: [source(filename, "material")], materials: [material(filename)]}});
    const result = render(options);
    assert.deepEqual(Object.keys(result), ["plan.md", "rationale.md"]);
    assert.equal(result["rationale.md"], "# Essential reasoning\n\nUnique result.\n");
    assert.match(result["plan.md"], /\[rationale.md\]\(rationale.md\) — Detailed rationale Explains the decision/);
    fs.appendFileSync(path.join(options.repoRoot, filename), "Changed");
    assert.throws(() => render(options), {code: "ASSESSMENT_STALE"});
    fs.appendFileSync(path.join(options.repoRoot, options.planPath), "\n[Unknown](../../var/unknown.md)\n");
    assessPublication({...options, input: empty()});
    assert.throws(() => render(options), {code: "UNRESOLVED_REFERENCE"});
});

it("renders without validator-only source/context artifacts and ignores report paths used solely in fenced examples", () => {
    const options = fixture("file");
    const file = path.join(options.repoRoot, options.planPath);
    fs.appendFileSync(file, "\n```md\nExample var/receipts/WP1-report.md\n```\n");
    const sourceFile = path.join(options.repoRoot, "var/agent/task-plan", path.basename(file, ".md"), "source.json");
    fs.unlinkSync(sourceFile);
    bind(options);
    assessPublication({...options, input: empty()});
    const result = render(options)["plan.md"];
    assert.match(result, /Snapshot — kopia do czytania, nie plan wykonawczy/);
    assert.match(result, /2026-10-01 — focused check passed/);
    assert.match(result, /```md\nExample var\/receipts\/WP1-report.md\n```/);
});

function preparedPublication() {
    const options = fixture();
    bind(options);
    assessPublication({...options, input: empty()});
    return options;
}
function target(options, name = "plan.md") { return path.join(options.repoRoot, "docs/plans/issue-123", name); }

it("publishes idempotently without writes, staging or changes to canonical bytes and pointer; check is read-only", () => {
    const options = preparedPublication();
    const planBefore = fs.readFileSync(path.join(options.repoRoot, options.planPath));
    const pointerPath = path.join(options.repoRoot, "var/agent/plan-execute/last-plan.txt");
    const pointerBefore = fs.readFileSync(pointerPath);
    const recordFile = load(options).context.recordPath;
    const recordBefore = fs.readFileSync(recordFile);
    assert.deepEqual(checkPublication(options).changed, ["plan.md"]);
    assert.equal(fs.existsSync(target(options)), false);
    assert.deepEqual(fs.readFileSync(recordFile), recordBefore);
    assert.deepEqual(publishPlan(options).changed, ["plan.md"]);
    const mtime = fs.statSync(target(options)).mtimeMs;
    const bytes = fs.readFileSync(target(options));
    const recordMtime = fs.statSync(recordFile).mtimeMs;
    assert.equal(publishPlan({...options, writeAtomic() { assert.fail("No writes expected"); }}).unchanged, true);
    assert.deepEqual(fs.readFileSync(target(options)), bytes);
    assert.equal(fs.statSync(target(options)).mtimeMs, mtime);
    assert.equal(fs.statSync(recordFile).mtimeMs, recordMtime);
    assert.deepEqual(fs.readFileSync(path.join(options.repoRoot, options.planPath)), planBefore);
    assert.deepEqual(fs.readFileSync(pointerPath), pointerBefore);
    assert.equal(spawnSync("git", ["diff", "--cached", "--name-only"], {cwd: options.repoRoot, encoding: "utf8"}).stdout, "");
});

it("refuses manual edits, missing local ownership and a publication bound to another plan/repository", () => {
    const options = preparedPublication();
    publishPlan(options);
    const original = fs.readFileSync(target(options));
    fs.appendFileSync(target(options), "Manual result edit");
    assert.throws(() => publishPlan(options), {code: "PUBLICATION_OUTPUT_CONFLICT"});
    assessPublication({...options, input: empty()});
    assert.throws(() => publishPlan(options), {code: "PUBLICATION_OUTPUT_CONFLICT"});
    fs.writeFileSync(target(options), original);
    fs.unlinkSync(load(options).context.recordPath);
    assert.throws(() => publishPlan(options), {code: "PUBLICATION_NOT_BOUND"});
    bind(options);
    assessPublication({...options, input: empty()});
    assert.throws(() => publishPlan(options), {code: "PUBLICATION_OUTPUT_CONFLICT"});
    assert.deepEqual(fs.readFileSync(target(options)), original);
    const other = fixture();
    bindPublication({...other, issueUrl: "https://github.com/other/repo/issues/123"});
    assessPublication({...other, input: empty()});
    fs.mkdirSync(path.dirname(target(other)), {recursive: true});
    fs.writeFileSync(target(other), original);
    assert.throws(() => publishPlan(other), {code: "PUBLICATION_OUTPUT_CONFLICT"});
});

it("fails before output writes on changed/missing sources, rules, selection and plan, including reopened WP", () => {
    const options = preparedPublication();
    const filename = report(options);
    const input = {...empty(), sources: [source(filename, "omitted")]};
    assessPublication({...options, input});
    publishPlan(options);
    const before = fs.readFileSync(target(options));
    fs.appendFileSync(path.join(options.repoRoot, filename), "Changed");
    assert.throws(() => publishPlan(options), {code: "ASSESSMENT_STALE"});
    fs.unlinkSync(path.join(options.repoRoot, filename));
    assert.throws(() => publishPlan(options), {code: "ASSESSMENT_STALE"});
    assessPublication({...options, input: empty()});
    const {context, record} = load(options);
    record.rules_version = 0;
    fs.writeFileSync(context.recordPath, JSON.stringify(record));
    assert.throws(() => publishPlan(options), {code: "ASSESSMENT_STALE"});
    assessPublication({...options, input: empty()});
    const changed = load(options).record;
    changed.assessment.selection.summaries.push({text: "New selection", status: "current", source_paths: []});
    fs.writeFileSync(context.recordPath, JSON.stringify(changed));
    assert.throws(() => publishPlan(options), {code: "ASSESSMENT_STALE"});
    assessPublication({...options, input: empty()});
    fs.writeFileSync(context.absolute, fs.readFileSync(context.absolute, "utf8").replace(/- \[x\] WP1[^\n]+/, "- [ ] WP1"));
    assert.throws(() => publishPlan(options), {code: "ASSESSMENT_STALE"});
    assert.deepEqual(fs.readFileSync(target(options)), before);
    assessPublication({...options, input: empty()});
    publishPlan(options);
    assert.match(fs.readFileSync(target(options), "utf8"), /- \[ \] WP1/);
});

it("rejects ignored outputs, secrets and output/source symlinks before publishing", () => {
    const ignored = preparedPublication();
    fs.writeFileSync(path.join(ignored.repoRoot, ".gitignore"), "/docs/plans/\n");
    assert.throws(() => publishPlan(ignored), {code: "PUBLICATION_IGNORED"});
    assert.equal(fs.existsSync(target(ignored)), false);
    const secret = preparedPublication();
    fs.appendFileSync(path.join(secret.repoRoot, secret.planPath), `\npassword = ${"highly" + "Sensitive" + "SyntheticCredential928374"}\n`);
    assessPublication({...secret, input: empty()});
    assert.throws(() => publishPlan(secret), {code: "PUBLICATION_SECRET"});
    assert.equal(fs.existsSync(target(secret)), false);
    const symlink = preparedPublication();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "publication-outside-"));
    roots.push(outside);
    fs.symlinkSync(outside, path.dirname(target(symlink)), "dir");
    assert.throws(() => publishPlan(symlink));
    assert.deepEqual(fs.readdirSync(outside), []);
    const sourceLink = preparedPublication();
    const external = path.join(outside, "report.md");
    fs.writeFileSync(external, "External data");
    fs.symlinkSync(external, path.join(sourceLink.repoRoot, "linked-report.md"));
    assert.throws(() => assessPublication({...sourceLink, input: {...empty(), sources: [source("linked-report.md")]}}));
});

it("preserves deselected and foreign files and publishes all selected materials before replacing plan", () => {
    const options = preparedPublication();
    publishPlan(options);
    const filename = report(options, "var/receipts/decision-report.md", "# Detailed rationale\n");
    assessPublication({...options, input: {...empty(), sources: [source(filename, "material")], materials: [material(filename)]}});
    const written = [];
    publishPlan({...options, writeAtomic(outputFilename, content, config) {
        written.push(path.basename(outputFilename));
        if (outputFilename === target(options)) { assert.equal(fs.existsSync(target(options, "rationale.md")), true); }
        return writeFileAtomic(outputFilename, content, config);
    }});
    assert.ok(written.indexOf("rationale.md") < written.indexOf("plan.md"));
    const foreign = target(options, "foreign.md");
    fs.writeFileSync(foreign, "Foreign bytes");
    assessPublication({...options, input: empty()});
    publishPlan(options);
    assert.equal(fs.readFileSync(foreign, "utf8"), "Foreign bytes");
    assert.equal(fs.readFileSync(target(options, "rationale.md"), "utf8"), "# Detailed rationale\n");
    assert.doesNotMatch(fs.readFileSync(target(options), "utf8"), /rationale\.md/);
});

it("recovers only recognized partial writes at every record/material/plan boundary", () => {
    for (const failureAt of [1, 2, 3, 4]) {
        const options = preparedPublication();
        const filename = report(options, "var/receipts/decision-report.md", "# Rationale\n");
        assessPublication({...options, input: {...empty(), sources: [source(filename, "material")], materials: [material(filename)]}});
        let writes = 0;
        assert.throws(() => publishPlan({...options, writeAtomic(outputFilename, content, config) {
            if (++writes === failureAt) { throw new Error("Injected I/O failure"); }
            return writeFileAtomic(outputFilename, content, config);
        }}), /Injected I\/O failure/);
        if (fs.existsSync(target(options))) { assert.match(fs.readFileSync(target(options), "utf8"), /^> Snapshot/); }
        publishPlan(options);
        assert.equal(load(options).record.intent, null);
        assert.equal(publishPlan(options).unchanged, true);
    }
    const options = preparedPublication();
    assert.throws(() => publishPlan({...options, writeAtomic(filename, content, config) {
        const result = writeFileAtomic(filename, content, config);
        if (filename === target(options)) { throw new Error("After plan publication"); }
        return result;
    }}));
    assert.ok(load(options).record.intent);
    fs.appendFileSync(target(options), "Unrecognized manual edit");
    assert.throws(() => publishPlan(options), {code: "PUBLICATION_OUTPUT_CONFLICT"});
});

it("blocks a competing publisher and detects input changes immediately before output writes", () => {
    const options = preparedPublication();
    let competing = false;
    publishPlan({...options, writeAtomic(filename, content, config) {
        if (!competing) {
            competing = true;
            assert.throws(() => publishPlan(options), {code: "PUBLICATION_LOCKED"});
        }
        return writeFileAtomic(filename, content, config);
    }});
    const another = preparedPublication();
    assert.throws(() => publishPlan({...another, writeAtomic(filename, content, config) {
        const result = writeFileAtomic(filename, content, config);
        if (filename.endsWith("publication.json")) { fs.appendFileSync(path.join(another.repoRoot, another.planPath), "\nConcurrent new decision\n"); }
        return result;
    }}), {code: "ASSESSMENT_STALE"});
    assert.equal(fs.existsSync(target(another)), false);
});

it("commit preparation refreshes only an explicit binding or the read-only pointer, never scans or re-assesses", () => {
    const options = preparedPublication();
    const pointerPath = path.join(options.repoRoot, "var/agent/plan-execute/last-plan.txt");
    const pointer = fs.readFileSync(pointerPath);
    const selected = selectCommitPublication({repoRoot: options.repoRoot});
    assert.equal(selected.planPath, options.planPath);
    const assessment = load(options).record.assessment;
    const otherSource = normalizeUserInput({body: "Other plan"});
    const otherId = buildPlanId(otherSource.identity);
    fs.writeFileSync(path.join(options.repoRoot, "docs/plans", `${otherId}.md`), "Other local plan must not be inspected");
    const first = refreshCommitPublication({repoRoot: options.repoRoot});
    assert.deepEqual(first.changed, ["plan.md"]);
    assert.deepEqual(load(options).record.assessment, assessment);
    assert.deepEqual(fs.readFileSync(pointerPath), pointer);
    assert.deepEqual(fs.readdirSync(path.dirname(target(options))), ["plan.md"]);
    assert.equal(refreshCommitPublication({repoRoot: options.repoRoot}).unchanged, true);
    fs.writeFileSync(pointerPath, "broken pointer\n");
    assert.throws(() => refreshCommitPublication({repoRoot: options.repoRoot}), {code: "INVALID_PLAN_POINTER"});
    assert.equal(refreshCommitPublication(options).unchanged, true); // explicit selection overrides pointer
    fs.unlinkSync(pointerPath);
    assert.deepEqual(refreshCommitPublication({repoRoot: options.repoRoot}), {action: "skip", reason: "no-plan-selected"});
    assert.deepEqual(fs.readFileSync(target(options), "utf8").includes("Other local plan"), false);
    const unbound = fixture();
    assert.deepEqual(refreshCommitPublication({repoRoot: unbound.repoRoot}), {action: "skip", reason: "selected-plan-not-bound"});
    assert.throws(() => refreshCommitPublication(unbound), {code: "PUBLICATION_NOT_BOUND"});
});

it("commit preparation stops on stale completed-WP report or changed shared decision, reopen and reclose criteria", () => {
    const options = preparedPublication();
    const filename = report(options);
    const input = {...empty(), sources: [source(filename, "omitted")]};
    assessPublication({...options, input});
    refreshCommitPublication(options);
    fs.appendFileSync(path.join(options.repoRoot, filename), "Report change while checkbox stays completed");
    assert.throws(() => refreshCommitPublication(options), {code: "ASSESSMENT_STALE"});
    assessPublication({...options, input});
    fs.appendFileSync(path.join(options.repoRoot, options.planPath), "\nD1: A changed shared decision.\n");
    assert.throws(() => refreshCommitPublication(options), {code: "ASSESSMENT_STALE"});
    assessPublication({...options, input});
    const file = path.join(options.repoRoot, options.planPath);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/- \[x\] WP1[^\n]+/, "- [ ] WP1"));
    assert.throws(() => refreshCommitPublication(options), {code: "ASSESSMENT_STALE"});
    assessPublication({...options, input});
    refreshCommitPublication(options);
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("- [ ] WP1", "- [x] WP1 — 2026-11-01 — Revised criteria check passed") + "\nNew acceptance criteria: revised.\n");
    assert.throws(() => refreshCommitPublication(options), {code: "ASSESSMENT_STALE"});
    assessPublication({...options, input});
    refreshCommitPublication(options);
    assert.match(fs.readFileSync(target(options), "utf8"), /2026-11-01 — Revised criteria check passed/);
    fs.appendFileSync(target(options), "Manual edit");
    assert.throws(() => refreshCommitPublication(options), {code: "PUBLICATION_OUTPUT_CONFLICT"});
    assert.equal(spawnSync("git", ["diff", "--cached", "--name-only"], {cwd: options.repoRoot, encoding: "utf8"}).stdout, "");
});

it("Git sees only issue publications and exceptional materials while canonical plans, drafts and state stay local", () => {
    const options = preparedPublication();
    const rootIgnore = fs.readFileSync(new URL("../../../.gitignore", import.meta.url), "utf8");
    fs.writeFileSync(path.join(options.repoRoot, ".gitignore"), rootIgnore);
    const filename = report(options, "var/receipts/decision-report.md", "# Essential result\n");
    assessPublication({...options, input: {...empty(), sources: [source(filename, "material")], materials: [material(filename)]}});
    publishPlan(options);
    fs.mkdirSync(path.join(options.repoRoot, "docs/drafts"), {recursive: true});
    fs.writeFileSync(path.join(options.repoRoot, "docs/drafts/draft.md"), "Local draft");
    for (const name of [options.planPath, "docs/drafts/draft.md", path.relative(options.repoRoot, load(options).context.recordPath)]) {
        assert.equal(spawnSync("git", ["check-ignore", "--quiet", name], {cwd: options.repoRoot}).status, 0, name);
    }
    for (const name of ["docs/plans/issue-123/plan.md", "docs/plans/issue-123/rationale.md"]) {
        assert.equal(spawnSync("git", ["check-ignore", "--quiet", name], {cwd: options.repoRoot}).status, 1, name);
    }
    const visible = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {cwd: options.repoRoot, encoding: "utf8"}).stdout;
    assert.match(visible, /docs\/plans\/issue-123\/plan\.md/);
    assert.match(visible, /docs\/plans\/issue-123\/rationale\.md/);
    assert.ok(!visible.includes(options.planPath));
});

it("never copies the canonical plan, tracked project documentation or identical materials under new names", () => {
    const options = preparedPublication();
    assert.throws(() => assessPublication({...options, input: {...empty(), sources: [source(options.planPath, "material")], materials: [material(options.planPath)]}}), {code: "INVALID_MATERIAL"});
    const filename = report(options, "var/receipts/decision-report.md", "Unique details\n");
    const duplicate = report(options, "var/receipts/duplicate-report.md", "Unique details\n");
    const input = {...empty(), sources: [source(filename, "material")], materials: [material(filename)]};
    assessPublication({...options, input});
    assert.throws(() => render(options, [filename]), {code: "INVALID_MATERIAL"});
    assessPublication({...options, input: {...empty(), sources: [source(filename, "material"), source(duplicate, "material")],
        materials: [material(filename), material(duplicate, {name: "different.md"})]}});
    assert.throws(() => render(options), {code: "INVALID_MATERIAL"});
});

it("does not leak local traces introduced by otherwise confirmed replacement or summary text", () => {
    const options = preparedPublication();
    fs.appendFileSync(path.join(options.repoRoot, options.planPath), "\n[Receipt](../../var/private.md)\n");
    assessPublication({...options, input: {...empty(), replacements: [{reference: "var/private.md", text: "[Still private](../../var/other.md)", status: "current", source_paths: []}]}});
    assert.throws(() => render(options), {code: "UNRESOLVED_REFERENCE"});
});
