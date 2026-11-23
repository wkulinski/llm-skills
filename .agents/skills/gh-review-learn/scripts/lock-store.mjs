import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalJson, validateLock, validateChangeRevisions} from "./contracts.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {writeFileAtomic} from "../../_shared/scripts/task-plan/atomic-file.mjs";
import {decodeLock} from "./storage.mjs";
import {sameLearningState, publishLearningState, readPrHistory, snapshotOf} from "./learning-store.mjs";

const fail = (code, message) => Object.assign(new Error(message), {code});
const digest = (bytes) => bytes === null ? null : createHash("sha256").update(bytes).digest("hex");

/** The callback owns the claim across asynchronous refresh and validation. */
export async function withConsumerLock({cwd = process.cwd(), repository, fsOps = fs, readStored}, work) {
    const root = requireRepositoryRoot(cwd);
    const target = path.join(root, "review-learning.lock.json");
    const guard = `${target}.write-lock`;
    let descriptor;
    try { descriptor = fsOps.openSync(guard, "wx", 0o600); } catch (error) {
        if (error.code === "EEXIST") { throw fail("LOCK_CONFLICT", "Another writer owns this consumer lock"); }
        throw error;
    }
    try {
        fsOps.writeFileSync(descriptor, JSON.stringify({pid: process.pid}));
        const read = () => {
            if (!fsOps.existsSync(target)) { return null; }
            const stat = fsOps.lstatSync(target);
            if (!stat.isFile() || stat.isSymbolicLink()) { throw fail("INVALID_PATH", "Lock must be a regular file"); }
            return fsOps.readFileSync(target);
        };
        const bytes = read();
        const current = bytes === null ? null : validateLock(readStored ? readStored(JSON.parse(bytes)) : decodeLock(JSON.parse(bytes), {cwd: root, fsOps}), repository);
        const previousChanges = structuredClone(current?.documentationChanges ?? []);
        let committed = false;
        return await work({root, current, bytes, commit(next, {expectedLockHash, dryRun = false, compact = false, histories, contexts, inventory, archives}) {
            if (committed) { throw fail("LOCK_CONFLICT", "Claim already committed; prepare a new operation"); }
            validateLock(next, repository);
            validateChangeRevisions(previousChanges, next.documentationChanges);
            const historyChanged = Object.entries(histories ?? {}).some(([id, history]) => {
                if (!current || JSON.parse(bytes).schemaVersion !== 4 || !current.entries.some((entry) => entry.prId === id)) { return true; }
                const old = readPrHistory(current, id)[0].history;
                return canonicalJson(old) !== canonicalJson(history);
            });
            const archiveChanged = (archives ?? []).some((ref) => !snapshotOf(current)?.manifest.archives.some((old) => old.path === ref.path));
            const identical = sameLearningState(current, next) && !historyChanged && !archiveChanged;
            if (!identical && digest(bytes) !== expectedLockHash) { throw fail("LOCK_CONFLICT", "Loaded lock no longer matches the prepared base; reread and prepare again"); }
            if (digest(read()) !== digest(bytes)) { throw fail("LOCK_CONFLICT", "Lock changed during validation"); }
            const migrate = compact && bytes !== null && JSON.parse(bytes).schemaVersion !== 4;
            if ((!identical || migrate) && !dryRun) {
                const manifest = publishLearningState(next, {cwd: root, previous: current, histories, contexts, inventory, archives, fsOps});
                // All referenced records exist before the only visible commit point.
                if (digest(read()) !== digest(bytes)) { throw fail("LOCK_CONFLICT", "Lock changed before manifest publication"); }
                writeFileAtomic(target, `${JSON.stringify(manifest, null, 2)}\n`, {rootDir: root, fsOps});
            }
            committed = true;
            return {changed: (!identical || migrate) && !dryRun, lock: next};
        }});
    } finally {
        try { fsOps.closeSync(descriptor); } finally { fsOps.unlinkSync(guard); }
    }
}
