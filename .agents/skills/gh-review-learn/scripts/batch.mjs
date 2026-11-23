#!/usr/bin/env node
import fs from "node:fs";
import {readLearningLock} from "./learning-store.mjs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {validateInventory, upgradeLock, fingerprint, assertRepository, canonicalJson, RULES} from "./contracts.mjs";
import {withConsumerLock} from "./lock-store.mjs";
import {hashBytes, fail, errorResponse} from "./validate-result.mjs";
import {createGitReader} from "./prepare.mjs";
import {shellCommand} from "./report.mjs";
import {fileURLToPath} from "node:url";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {assertArtifactPath, resolveArtifactCacheRoot} from "../../_shared/scripts/artifact-path.mjs";
import {isMainModule} from "../../_shared/scripts/is-main-module.mjs";

export function batchView(batch, cacheRoot) {
    return {batchId: batch.id, batchSize: batch.limit, repository: batch.repository, boundary: batch.boundary,
        prIds: batch.prIds, prNumbers: batch.prNumbers, recordedPrIds: batch.recordedPrIds,
        remaining: batch.members.filter((pr) => !batch.recordedPrIds.includes(pr.id)),
        collectCommand: shellCommand(["node", fileURLToPath(new URL("./collect.mjs", import.meta.url)), "--repo", batch.repository.name, "--branch", batch.repository.branch, "--batch", batch.id, "--output", path.join(cacheRoot, "gh-review-learn", "sources.json")])};
}
export async function selectBatch({inventory, batchSize, cwd = process.cwd(), fsOps = fs, now = () => new Date().toISOString()}) {
    const cacheRoot = resolveArtifactCacheRoot(cwd);
    validateInventory(inventory);
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) { throw fail("INVALID_BATCH", "Batch size must be a positive safe integer"); }
    if (inventory.read.completeness !== "complete") { throw fail("INCOMPLETE_READ", "A complete inventory is required before selecting a batch"); }
    const origin = createGitReader(cwd)(["remote", "get-url", "origin"]).toString("utf8").trim();
    const match = origin.match(/^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
    if (!match || match[1].toLowerCase() !== inventory.repository.name.toLowerCase()) { throw fail("REPOSITORY_CONFLICT", "Inventory differs from consumer origin"); }
    return withConsumerLock({cwd, repository: inventory.repository, fsOps}, ({current, bytes, commit}) => {
        if (current?.activeBatch) {
            const active = current.activeBatch;
            assertRepository(active.repository, inventory.repository);
            if (active.limit !== batchSize || active.boundary !== inventory.read.boundary) { throw fail("BATCH_CONFLICT", "Active batch size or read scope differs; resume the stored batch"); }
            for (const member of active.members) {
                if (canonicalJson(inventory.prs.find((pr) => pr.id === member.id) ?? null) !== canonicalJson(member)) { throw fail("BATCH_CONFLICT", `Active batch member changed or disappeared: ${member.number}`); }
            }
            return {...batchView(active, cacheRoot), changed: false};
        }
        const candidates = inventory.prs.filter((pr) => !current?.entries.some((entry) => entry.prId === pr.id))
            .sort((a, b) => a.mergedAt < b.mergedAt ? -1 : a.mergedAt > b.mergedAt ? 1 : a.number - b.number || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        if (!candidates.length) { return {batchId: null, batchSize, remaining: [], newRemaining: 0, inventoryReadAt: inventory.read.finishedAt, changed: false}; }
        const next = current ? upgradeLock(current) : {schemaVersion: 2, kind: "lock", repository: inventory.repository, rules: {...RULES}, entries: [], documentationChanges: [], activeBatch: null, activeDelivery: null, lastDelivery: null};
        const members = candidates.slice(0, batchSize);
        next.activeBatch = {id: randomUUID(), limit: batchSize, repository: inventory.repository, scopeFingerprint: fingerprint(inventory.repository), boundary: inventory.read.boundary, selectedAt: now(), inventoryReadAt: inventory.read.finishedAt,
            prIds: members.map((pr) => pr.id), prNumbers: members.map((pr) => pr.number), members, recordedPrIds: []};
        commit(next, {expectedLockHash: bytes === null ? null : hashBytes(bytes), inventory});
        return {...batchView(next.activeBatch, cacheRoot), changed: true, newRemaining: candidates.length - members.length, inventoryReadAt: inventory.read.finishedAt};
    });
}
export function resumeBatch({cwd = process.cwd()} = {}) {
    const root = requireRepositoryRoot(cwd);
    const file = path.join(root, "review-learning.lock.json");
    if (!fs.existsSync(file) || fs.lstatSync(file).isSymbolicLink()) { throw fail("BATCH_CONFLICT", "No regular consumer lock to resume"); }
    const lock = readLearningLock({cwd: root});
    if (!lock.activeBatch) { throw fail("BATCH_CONFLICT", "No active batch to resume"); }
    return batchView(lock.activeBatch, resolveArtifactCacheRoot(root));
}
export async function abandonBatch({batchId, userDecisionRef, cwd = process.cwd(), fsOps = fs, now = () => new Date().toISOString()}) {
    if (typeof batchId !== "string" || !batchId.trim() || typeof userDecisionRef !== "string" || !userDecisionRef.trim()) { throw fail("INVALID_ARGUMENT", "Abandon requires a batch ID and explicit user decision reference"); }
    return withConsumerLock({cwd, fsOps}, ({current, bytes, commit}) => {
        if (!current?.activeBatch && current?.lastBatch?.id === batchId && current.lastBatch.status === "abandoned" && current.lastBatch.userDecisionRef === userDecisionRef) {
            return {batchId, event: "batch_abandoned", changed: false, recordedPrIds: current.lastBatch.recordedPrIds};
        }
        if (current?.activeBatch?.id !== batchId) { throw fail("BATCH_CONFLICT", "Requested batch is not active"); }
        const next = upgradeLock(current);
        next.lastBatch = {...next.activeBatch, status: "abandoned", abandonedAt: now(), userDecisionRef};
        next.activeBatch = null;
        const saved = commit(next, {expectedLockHash: hashBytes(bytes)});
        return {batchId, event: "batch_abandoned", changed: saved.changed, recordedPrIds: next.lastBatch.recordedPrIds};
    });
}
function selectArguments(rest) {
    const args = {};
    for (let index = 0; index < rest.length; index += 2) {
        const name = rest[index];
        if (!["--inventory", "--batch-size"].includes(name) || Object.hasOwn(args, name) || !rest[index + 1] || rest[index + 1].startsWith("--")) { throw fail("INVALID_ARGUMENT", `Invalid argument: ${name}`); }
        args[name] = rest[index + 1];
    }
    if (!args["--inventory"] || !/^[1-9][0-9]*$/.test(args["--batch-size"] ?? "")) { throw fail("INVALID_ARGUMENT", "--inventory and positive --batch-size are required"); }
    return args;
}
export async function main(argv = process.argv.slice(2), {cwd = process.cwd()} = {}) {
    if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) { return {code: 0, stdout: "Usage: batch.mjs select --inventory <cache/path> --batch-size <N> | resume [--batch ID] | abandon --batch ID --user-decision-ref REF\nSelect oldest new PRs, resume the unchanged active batch, or explicitly abandon it while preserving recorded results.\n"}; }
    try {
        const [operation, ...rest] = argv;
        let data;
        if (operation === "resume" && (!rest.length || (rest.length === 2 && rest[0] === "--batch"))) {
            data = resumeBatch({cwd});
            if (rest.length && data.batchId !== rest[1]) { throw fail("BATCH_CONFLICT", "Requested batch is not active"); }
        }
        else if (operation === "abandon" && rest.length === 4 && rest[0] === "--batch" && rest[2] === "--user-decision-ref") {
            data = await abandonBatch({batchId: rest[1], userDecisionRef: rest[3], cwd});
        }
        else if (operation === "select") {
            const args = selectArguments(rest);
            const root = requireRepositoryRoot(cwd);
            const inventory = JSON.parse(fs.readFileSync(assertArtifactPath(path.resolve(root, args["--inventory"]), "Inventory", root), "utf8"));
            data = await selectBatch({inventory, batchSize: Number(args["--batch-size"]), cwd: root});
        } else { throw fail("INVALID_ARGUMENT", "Expected select, resume or abandon"); }
        return {code: 0, stdout: `${JSON.stringify({status: "complete", data, errors: []})}\n`};
    } catch (error) { return errorResponse(error); }
}
if (isMainModule(import.meta.url)) {
    const response = await main(); process.stdout.write(response.stdout); if (response.stderr) { process.stderr.write(response.stderr); } process.exitCode = response.code;
}
