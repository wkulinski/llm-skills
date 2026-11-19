import {expect, it} from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {createHash} from "node:crypto";
import {execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
it("runs the public CLIs through proposal, application, commit, cache loss and incremental work", () => {
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
        const state = {sha: head, prs: [pr(1)]}; write(server, state);
        const file = (name) => path.join(cache, `${name}.json`);
        const run = (name, args) => {
            try { return JSON.parse(execFileSync(process.execPath, [path.join(scripts, `${name}.mjs`), ...args], {cwd: root, encoding: "utf8"})); }
            catch (error) { if (error.status === 2) { return JSON.parse(error.stdout); } throw new Error(`${name}: ${error.stdout} ${error.stderr}`); }
        };
        const collect = () => run("collect", ["--repo", "example/project", "--output", file("sources")]);
        const prepare = (extra = []) => run("prepare", ["--sources", file("sources"), "--output", file("prepared"), ...extra]);
        const args = () => ["--sources", file("sources"), "--prepared", file("prepared"), "--result", file("result")];
        const result = (delivery, target = "lesson.md") => {
            const input = json(file("prepared"));
            const entries = input.items.map((item) => ({prId: item.prId, rules: input.rules, sourceFingerprint: item.sourceFingerprint, projectSha: input.projectSha, contextFingerprint: input.context.fingerprint, sourceCompleteness: "complete", analysis: "complete", delivery,
                assessments: [], dispositions: item.sourceIds.map((sourceId) => ({sourceId, status: "no_learning", rationale: "Synthetic analysis", assessmentIds: []})),
                materialDispositions: item.materials.map((m) => ({id: m.id, status: m.status === "available" ? "used" : "unavailable", rationale: "Explicit material check"})),
                documents: [{path: target, beforeHash: input.context.files.find((f) => f.path === target)?.hash ?? null, afterHash: digest("A new instruction\n")}], ...(delivery === "applied" ? {finalDocumentsReviewed: true} : {})}));
            write(file("result"), {schemaVersion: 1, kind: "result", repository: input.repository, rules: input.rules, expectedLockHash: input.expectedLockHash, inputContextFingerprint: input.context.fingerprint, entries});
        };
        expect(collect().status).toBe("complete"); expect(prepare().data.selected).toBe(1);
        result("delivery_pending"); expect(run("validate-result", args()).status).toBe("complete");
        run("record-result", args());
        const lockPath = path.join(root, "review-learning.lock.json");
        expect(json(lockPath).entries[0].delivery).toBe("delivery_pending");
        fs.rmSync(cache, {recursive: true, force: true}); collect(); prepare();
        expect(json(file("prepared")).items[0].reasons).toContain("delivery_pending");
        result("applied"); fs.writeFileSync(path.join(root, "lesson.md"), "A new instruction\n");
        run("validate-result", args()); run("record-result", args());
        git(["add", "lesson.md", "review-learning.lock.json"]); git(["commit", "-m", "docs and learning"]);
        const lockBytes = fs.readFileSync(lockPath); const mtime = fs.statSync(lockPath).mtimeMs;
        collect(); expect(prepare().data.selected).toBe(0);
        fs.rmSync(cache, {recursive: true, force: true}); collect(); expect(prepare().data.selected).toBe(0);
        expect(fs.readFileSync(lockPath)).toEqual(lockBytes); expect(fs.statSync(lockPath).mtimeMs).toBe(mtime);
        state.prs.push(pr(2)); state.prs[0].body = "Edited historical description"; write(server, state);
        collect(); prepare();
        const changed = json(file("prepared"));
        expect(changed.items.map((i) => i.prId)).toEqual(["PR1", "PR2"]);
        expect(changed.items[0].reasons).toContain("sources_changed"); expect(changed.items[1].reasons).toContain("new");
        prepare(["--prs", "2"]); result("delivery_pending", "next-lesson.md"); run("record-result", args());
        expect(json(lockPath).entries.map((e) => e.prId)).toEqual(["PR1", "PR2"]);
        fs.appendFileSync(path.join(root, "code.mjs"), "changed current context\n");
        fs.rmSync(cache, {recursive: true, force: true}); collect(); prepare();
        const refreshed = json(file("prepared"));
        expect(refreshed.items.every((i) => i.reasons.includes("context_changed"))).toBe(true);
        expect(refreshed.items.find((i) => i.prId === "PR2").reasons).toContain("delivery_pending");
        expect(refreshed.items.find((i) => i.prId === "PR1").previous.delivery).toBe("applied");
    } finally { fs.rmSync(root, {recursive: true, force: true}); }
}, 60_000);
