import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {canonicalJson, validateLock, validateChangeRevisions} from "./contracts.mjs";
import {requireRepositoryRoot} from "../../_shared/scripts/repo-root.mjs";
import {writeFileAtomic} from "../../_shared/scripts/task-plan/atomic-file.mjs";

const fail = (code, message) => Object.assign(new Error(message), {code});
const digest = (bytes) => bytes === null ? null : createHash("sha256").update(bytes).digest("hex");

/** The callback owns the claim across asynchronous refresh and validation. */
export async function withConsumerLock({cwd = process.cwd(), repository, fsOps = fs}, work) {
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
        const current = bytes === null ? null : validateLock(JSON.parse(bytes), repository);
        const previousChanges = structuredClone(current?.documentationChanges ?? []);
        const currentJson = current === null ? null : canonicalJson({...current, entries: [...current.entries].sort((a, b) => a.prId.localeCompare(b.prId))});
        let committed = false;
        return await work({root, current, bytes, commit(next, {expectedLockHash, dryRun = false}) {
            if (committed) { throw fail("LOCK_CONFLICT", "Claim already committed; prepare a new operation"); }
            validateLock(next, repository);
            validateChangeRevisions(previousChanges, next.documentationChanges);
            const identical = currentJson === canonicalJson(next);
            if (!identical && digest(bytes) !== expectedLockHash) { throw fail("LOCK_CONFLICT", "Loaded lock no longer matches the prepared base; reread and prepare again"); }
            if (digest(read()) !== digest(bytes)) { throw fail("LOCK_CONFLICT", "Lock changed during validation"); }
            if (!identical && !dryRun) {
                writeFileAtomic(target, `${JSON.stringify(next, null, 2)}\n`, {rootDir: root, fsOps});
            }
            committed = true;
            return {changed: !identical && !dryRun, lock: next};
        }});
    } finally {
        try { fsOps.closeSync(descriptor); } finally { fsOps.unlinkSync(guard); }
    }
}
