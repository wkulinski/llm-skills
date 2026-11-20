import {expect, it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
it("runs public CLIs through 20/20/5 batches, cache loss, partial delivery and truthful reports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "learning-workflow-"));
    const scripts = path.resolve(".agents/skills/gh-review-learn/scripts");
    const cache = path.join(root, "var/agent/cache");
    const server = path.join(root, "server.json");
    const git = (args) => execFileSync("git", args, {cwd: root, encoding: "utf8"}).trim();
    const json = (file) => JSON.parse(fs.readFileSync(file));
    const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
    try {
        git(["init", "-b", "main"]); git(["config", "user.name", "Test"]); git(["config", "user.email", "test@example.test"]);
        git(["remote", "add", "origin", "git@github.com:example/project.git"]);
        fs.writeFileSync(path.join(root, ".gitignore"), "var/\n.env.local\nserver.json\nfake-bin/\n");
        fs.writeFileSync(path.join(root, "README.md"), "Rules\n"); fs.writeFileSync(path.join(root, "code.mjs"), "base\n");
        git(["add", "."]); git(["commit", "-m", "base"]); const base = git(["rev-parse", "HEAD"]);
        fs.writeFileSync(path.join(root, "code.mjs"), "fixed\n"); git(["add", "."]); git(["commit", "-m", "merged"]); const head = git(["rev-parse", "HEAD"]);
        fs.mkdirSync(path.join(root, "fake-bin"));
        fs.writeFileSync(path.join(root, ".env.local"), `BIN_PATH=./fake-bin\nexport REVIEW_SERVER_FILE='${server}'\n`);
        const gh = path.join(root, "fake-bin/gh");
        fs.writeFileSync(gh, `#!/usr/bin/env node
const fs=require('node:fs');
const state=JSON.parse(fs.readFileSync(process.env.REVIEW_SERVER_FILE));
const args=process.argv.slice(2);
if(args.includes('graphql')){process.stdout.write(JSON.stringify({data:{node:{reviewThreads:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}}));}
else {const endpoint=args.at(-1);let body;
if(endpoint==='repos/example/project')body={node_id:'REPO',full_name:'example/project',default_branch:'main'};
else if(endpoint.includes('/branches/'))body={commit:{sha:state.sha}};
else if(endpoint.includes('/pulls?'))body=state.prs;
else body=[];
process.stdout.write('HTTP/2.0 200 OK\\r\\nContent-Type: application/json\\r\\n\\r\\n'+JSON.stringify(body));}
`, {mode: 0o755});
        const time = "2026-11-18T00:00:00Z";
        const pr = (number) => ({number, node_id: `PR${number}`, body: `Description ${number}`, html_url: `https://example.test/pr/${number}`, user: null, created_at: time, updated_at: time, merged_at: time, base: {ref: "main", sha: base}, head: {sha: head}, merge_commit_sha: head});
        const state = {sha: head, prs: Array.from({length: 45}, (_, i) => pr(45 - i))}; write(server, state);
        const file = (name) => path.join(cache, `${name}.json`);
        const run = (name, args) => {
            try { return JSON.parse(execFileSync(process.execPath, [path.join(scripts, `${name}.mjs`), ...args], {cwd: root, encoding: "utf8"})); }
            catch (error) { if (error.status === 2) { return JSON.parse(error.stdout); } throw new Error(`${name}: ${error.stdout} ${error.stderr}`); }
        };
        const collect = (extra = []) => run("collect", ["--repo", "example/project", "--output", file("sources"), ...extra]);
        const inventory = () => run("collect", ["--repo", "example/project", "--inventory-only", "--output", file("inventory")]);
        const select = () => run("batch", ["select", "--inventory", file("inventory"), "--batch-size", "20"]).data;
        const prepare = (extra = []) => run("prepare", ["--sources", file("sources"), "--output", file("prepared"), ...extra]);
        const args = () => ["--sources", file("sources"), "--prepared", file("prepared"), "--result", file("result")];
        const result = () => {
            const input = json(file("prepared"));
            const changes = structuredClone(input.documentationChanges);
            const verification = {original: {status: "verified", sourceId: "PR1", sha: base, evidence: [{kind: "git_file", sha: base, path: "README.md", hash: digest("Rules\n")}], rationale: "Read original rules"},
                response: {sourceIds: [], relation: "none", appliesToSha: null}, correction: {status: "not_required", evidence: [], rationale: "Documentation suggestion"},
                current: {status: "verified", sha: head, evidence: [{kind: "git_file", sha: head, path: "README.md", hash: digest("Rules\n")}], rationale: "Read current rules"}};
            const entries = input.items.map((item) => ({prId: item.prId, rules: input.rules, sourceFingerprint: item.sourceFingerprint, projectSha: input.projectSha, contextFingerprint: input.context.fingerprint, sourceCompleteness: "complete", analysis: "complete", delivery: item.prId === "PR1" ? "delivery_pending" : "not_required",
                assessments: item.prId === "PR1" ? [{id: "A1", sources: [{id: "PR1", quote: "Description 1"}], historical: "suggestion", currency: "current_application", rationale: "Document the proof scope", verificationScope: "Git and docs", evidence: [], verification}] : [],
                dispositions: item.sourceIds.map((sourceId) => ({sourceId, status: item.prId === "PR1" ? "assessed" : "no_learning", rationale: "Synthetic analysis", assessmentIds: item.prId === "PR1" ? ["A1"] : []})),
                materialDispositions: item.materials.map((m) => ({id: m.id, status: m.status === "available" ? "used" : "unavailable", rationale: "Explicit material check"})),
                documents: item.prId === "PR1" ? [{path: "README.md", beforeHash: digest("Rules\n"), afterHash: digest("Both rules\n")}] : [], documentationChangeIds: item.prId === "PR1" ? ["C1", "C2"] : []}));
            if (entries.some((entry) => entry.prId === "PR1")) {
                for (const [id, text] of [["C1", "First selected rule\n"], ["C2", "Both rules\n"]]) {
                    changes.push({id, revision: 1, path: "README.md", section: "Rules", description: id === "C1" ? "Inspect resulting bytes" : "Record proof scope", rationale: "Make verification explicit", beforeHash: digest("Rules\n"), afterHash: digest(text), status: "proposed", references: [{prId: "PR1", assessmentId: "A1"}]});
                }
            }
            write(file("result"), {schemaVersion: 2, kind: "result", repository: input.repository, rules: input.rules, batchId: input.batchId, expectedLockHash: input.expectedLockHash, inputContextFingerprint: input.context.fingerprint, entries, documentationChanges: changes});
        };
        inventory(); const first = select(); expect(first.prNumbers).toEqual(Array.from({length: 20}, (_, i) => i + 1));
        collect(["--batch", first.batchId, "--prs", "1"]); prepare(); result(); run("validate-result", args());
        expect(run("record-result", args()).data.report.introduction).toBe("Nie wprowadzono zmian do dokumentacji");
        const lockPath = path.join(root, "review-learning.lock.json");
        fs.rmSync(cache, {recursive: true, force: true});
        expect(run("batch", ["resume", "--batch", first.batchId]).data.remaining.map((item) => item.number)).toEqual(Array.from({length: 19}, (_, i) => i + 2));
        const activeBeforeDelivery = json(lockPath).activeBatch;
        collect(["--prs", "1"]); prepare();
        write(file("result"), {delivery: {operationId: "workflow-delivery", userDecisionRef: "user:apply-C1", changes: [{id: "C1", revision: 1}], documents: [{path: "README.md", beforeHash: digest("Rules\n"), afterHash: digest("First selected rule\n"), afterBytes: Buffer.from("First selected rule\n").toString("base64")}]}});
        run("record-result", [...args(), "--begin-delivery"]); prepare();
        fs.writeFileSync(path.join(root, "README.md"), "First selected rule\n");
        write(file("result"), {delivery: {operationId: "workflow-delivery", finalDocumentsReviewed: true}});
        const confirmation = run("record-result", [...args(), "--confirm-delivery"]); write(file("event"), confirmation);
        expect(confirmation.data.report.applied.map((change) => change.id)).toEqual(["C1"]);
        expect(confirmation.data.report.proposals.map((change) => change.id)).toEqual(["C2"]);
        expect(confirmation.data.report.diff.inline).toContain("+First selected rule");
        expect(json(lockPath).activeBatch).toEqual(activeBeforeDelivery);
        inventory();
        const report = run("report", ["--sources", file("sources"), "--prepared", file("prepared"), "--inventory", file("inventory"), "--event", file("event"), "--output", path.join(cache, "report.md")]);
        expect(fs.readFileSync(report.data.output, "utf8")).toContain("Inspect resulting bytes");
        expect(report.data.report.applied[0].sourceLinks[0].url).toBe("https://example.test/pr/1");
        expect(report.data.report.progress.newRemaining).toBe(44); expect(report.data.report.progress.nextCommand).toContain(first.batchId);
        const lockBytes = fs.readFileSync(lockPath); const mtime = fs.statSync(lockPath).mtimeMs;
        expect(run("record-result", [...args(), "--confirm-delivery"]).data.report.introduction).toBe("Nie wprowadzono zmian do dokumentacji");
        expect(fs.readFileSync(lockPath)).toEqual(lockBytes); expect(fs.statSync(lockPath).mtimeMs).toBe(mtime);
        collect(["--batch", first.batchId]); prepare(); result(); run("record-result", args());
        expect(json(lockPath).activeBatch).toBeNull();
        expect(json(lockPath).documentationChanges.find((change) => change.id === "C1").status).toBe("applied");
        for (const size of [20, 5]) {
            inventory(); const batch = select(); expect(batch.prNumbers).toHaveLength(size);
            collect(["--batch", batch.batchId]); prepare(); result(); run("record-result", args());
        }
        inventory(); expect(select().newRemaining).toBe(0); expect(json(lockPath).entries).toHaveLength(45);
        const final = run("report", ["--inventory", file("inventory"), "--output", path.join(cache, "final.md")]).data.report;
        expect(final.progress.continuation).toContain("Koniec nowej historii"); expect(final.progress.pendingDelivery).toBe(1);
        fs.rmSync(cache, {recursive: true, force: true});
        const reread = run("report", ["--output", path.join(cache, "reread.md")]).data.report;
        expect(reread.progress.newRemaining).toBeNull(); expect(reread.applied).toEqual([]);
        expect(reread.proposals[0].sourceLinks[0].url).toBe("https://example.test/pr/1");
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
}, 180_000);
