#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";
import {createLearningStore, readLearningLock, readPrHistory, verifyLearningStore} from "./learning-store.mjs";

/** Default status opens only the manifest. List opens the lightweight index; show opens one PR. */
export function learningStatus({cwd = process.cwd(), list = false, pr = null, history = false, verify = false} = {}) {
    const root = requireRepositoryRoot(cwd); const file = path.join(root, "review-learning.lock.json");
    if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) { throw new Error("Expected regular lock file"); }
    const manifest = JSON.parse(fs.readFileSync(file));
    if (manifest.schemaVersion !== 4) { throw new Error("Run compact-lock.mjs to migrate this legacy lock before using status"); }
    const result = {repository: manifest.repository, ...manifest.summary,
        lastAnalysisNote: manifest.summary.lastAnalysis ? null : "Historical analysis timestamp is unavailable; merge order is reported separately."};
    if (verify) { result.integrity = verifyLearningStore(readLearningLock({cwd: root})); }
    if (list || pr !== null) {
        const store = createLearningStore({cwd: root}); const index = store.read(manifest.index);
        if (list) {
            result.prs = index.entries.map((record) => ({prId: record.metadata.prId, number: record.pr?.number ?? null,
                mergedAt: record.pr?.mergedAt ?? null, analyzedAt: record.analyzedAt, analysis: record.metadata.analysis,
                delivery: record.metadata.delivery, rules: record.metadata.rules, historyGaps: record.historyGaps, reference: record.analysis}));
        }
        if (pr !== null) {
            const record = index.entries.find((entry) => entry.metadata.prId === pr || entry.pr?.number === Number(pr));
            if (!record) { throw new Error("PR has no saved analysis"); }
            result.revisions = readPrHistory(readLearningLock({cwd: root}), record.metadata.prId, {allRevisions: history});
        }
    }
    return result;
}
export function main(argv = process.argv.slice(2), {cwd = process.cwd()} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { return {code: 0, stdout: "Usage: status.mjs [--list | --pr NUMBER_OR_ID [--history] | --verify]\nOffline durable status, PR index, targeted sources/proofs and revisions, or full integrity audit. No cache or network required. Referenced evidence bytes can be read directly at their validated artifact paths.\n"}; }
    try {
        let options = {};
        if (!argv.length) { options = {}; }
        else if (argv.length === 1 && argv[0] === "--list") { options.list = true; }
        else if (argv.length === 1 && argv[0] === "--verify") { options.verify = true; }
        else if ([2, 3].includes(argv.length) && argv[0] === "--pr" && (argv.length === 2 || argv[2] === "--history")) { options = {pr: argv[1], history: argv.length === 3}; }
        else { throw new Error("Use --list, --verify, or --pr NUMBER_OR_ID [--history]"); }
        return {code: 0, stdout: `${JSON.stringify({status: "complete", data: learningStatus({cwd, ...options}), errors: []})}\n`};
    } catch (error) { return {code: 1, stdout: `${JSON.stringify({status: "error", data: null, errors: [{code: error.code ?? "STATUS_ERROR", message: error.message}]})}\n`}; }
}
if (isMainModule(import.meta.url)) { const result = main(); process.stdout.write(result.stdout); process.exitCode = result.code; }
