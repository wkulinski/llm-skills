import {mkdirSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

export const SNAPSHOT_VERSION = 1;

export function writeSnapshot(snapshotAbsPath, workingTreeState) {
    mkdirSync(path.dirname(snapshotAbsPath), {recursive: true});
    writeFileSync(snapshotAbsPath, `${JSON.stringify(workingTreeState, null, 2)}\n`, "utf-8");
}

export function loadSnapshot(snapshotAbsPath) {
    let raw;
    try {
        raw = readFileSync(snapshotAbsPath, "utf-8");
    } catch {
        throw new Error(`Cannot read snapshot file: ${snapshotAbsPath}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`Invalid JSON snapshot: ${snapshotAbsPath}`);
    }

    validateSnapshot(parsed, snapshotAbsPath);
    return parsed;
}

export function validateSnapshot(snapshot, snapshotAbsPath) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new Error(`Snapshot must be a JSON object: ${snapshotAbsPath}`);
    }

    if (snapshot.version !== SNAPSHOT_VERSION) {
        throw new Error(
            `Unsupported snapshot version in ${snapshotAbsPath}: ${snapshot.version ?? "missing"}`
        );
    }

    if (!snapshot.files || typeof snapshot.files !== "object" || Array.isArray(snapshot.files)) {
        throw new Error(`Snapshot "files" must be an object: ${snapshotAbsPath}`);
    }

    for (const [filePath, fingerprint] of Object.entries(snapshot.files)) {
        if (!fingerprint || typeof fingerprint !== "object" || Array.isArray(fingerprint)) {
            throw new Error(`Invalid fingerprint for "${filePath}" in ${snapshotAbsPath}`);
        }

        if (typeof fingerprint.exists !== "boolean") {
            throw new Error(`Snapshot fingerprint "exists" must be boolean for "${filePath}"`);
        }

        const hashIsValid = fingerprint.hash === null || typeof fingerprint.hash === "string";
        if (!hashIsValid) {
            throw new Error(`Snapshot fingerprint "hash" must be string|null for "${filePath}"`);
        }
    }
}

export function assertSnapshotRepoRoot(snapshot, repoRoot) {
    if (snapshot.repoRoot && snapshot.repoRoot !== repoRoot) {
        throw new Error(`Snapshot repo root mismatch: ${snapshot.repoRoot} != ${repoRoot}`);
    }
}

export function fingerprintEquals(left, right) {
    if (!left && !right) {
        return true;
    }

    if (!left || !right) {
        return false;
    }

    return left.exists === right.exists && left.hash === right.hash;
}

export function detectChangedFilesFromSnapshot(currentState, snapshot) {
    const currentFiles = currentState.files ?? {};
    const snapshotFiles = snapshot.files ?? {};
    const allFiles = new Set([
        ...Object.keys(snapshotFiles),
        ...Object.keys(currentFiles),
    ]);

    return [...allFiles]
        .filter((filePath) => !fingerprintEquals(snapshotFiles[filePath], currentFiles[filePath]))
        .sort();
}
