import {closeSync, existsSync, fchmodSync, mkdirSync, openSync, readFileSync, writeFileSync} from "node:fs";
import path from "node:path";

import {hashJson} from "../shared/hashing.mjs";

export const SESSION_VERSION = 1;

export function createDefaultSession() {
    return {
        version: SESSION_VERSION,
        pendingFinalFullPass: false,
        pendingReasons: [],
    };
}

export function loadSession(sessionAbsPath) {
    if (!sessionAbsPath || !existsSync(sessionAbsPath)) {
        return createDefaultSession();
    }

    let raw;
    try {
        raw = readFileSync(sessionAbsPath, "utf-8");
    } catch {
        throw new Error(`Cannot read session file: ${sessionAbsPath}`);
    }

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`Invalid JSON session: ${sessionAbsPath}`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Session must be a JSON object: ${sessionAbsPath}`);
    }

    if (parsed.version !== SESSION_VERSION) {
        throw new Error(`Unsupported session version in ${sessionAbsPath}: ${parsed.version ?? "missing"}`);
    }

    return {
        ...parsed,
        pendingFinalFullPass: Boolean(parsed.pendingFinalFullPass),
        pendingReasons: Array.isArray(parsed.pendingReasons) ? parsed.pendingReasons : [],
    };
}

export function saveSession(sessionAbsPath, session) {
    if (!sessionAbsPath) {
        return;
    }

    mkdirSync(path.dirname(sessionAbsPath), {mode: 0o700, recursive: true});
    const content = `${JSON.stringify(session, null, 2)}\n`;
    const fd = openSync(sessionAbsPath, "w", 0o600);
    try {
        // Creation mode does not restrict an existing session's permissions.
        fchmodSync(fd, 0o600);
        writeFileSync(fd, content, "utf-8");
    } finally {
        closeSync(fd);
    }
    console.log(`INFO: Session written: ${sessionAbsPath}`);
}

/**
 * `outcome.status` is the process result; `lastRun.evidenceCurrent` says whether
 * the checked input state still matches the working tree after the run.
 * Only a passing, current, full-scope full-mode run is recorded as a full pass.
 */
export function updateSession(session, cli, mode, currentState, config, riskAssessment, outcome = {}) {
    const matrixHash = hashJson(config.raw);
    const scope = cli.scope ?? "full";
    const snapshotHash = hashJson(currentState.files);
    const postRunSnapshotHash = outcome.postRunState
        ? hashJson(outcome.postRunState.files)
        : snapshotHash;
    const inputsMutated = postRunSnapshotHash !== snapshotHash;
    const status = outcome.status ?? "UNKNOWN";
    const matrixChangedSinceLastFullPass = mode === "delta"
        && session.lastFullPass?.matrixHash
        && session.lastFullPass.matrixHash !== matrixHash;
    const nextSession = {
        ...session,
        version: SESSION_VERSION,
        matrixHash,
        lastRun: {
            completedAt: new Date().toISOString(),
            evidenceCurrent: !inputsMutated,
            inputsMutated,
            matrixHash,
            mode,
            postRunSnapshotHash,
            rerunReason: cli.rerunReason,
            scope,
            selection: outcome.selection ?? null,
            snapshotHash,
            status,
        },
    };
    const isCurrentFullPass = scope === "full" && mode === "full" && status === "PASS" && !inputsMutated;

    if (cli.rerunReason === "full-final-pass" && isCurrentFullPass) {
        nextSession.pendingFinalFullPass = false;
        nextSession.pendingReasons = [];
    } else if (mode === "delta" && (riskAssessment.shouldRunFullFinalPass || matrixChangedSinceLastFullPass)) {
        nextSession.pendingFinalFullPass = true;
        nextSession.pendingReasons = [
            ...new Set([
                ...(nextSession.pendingReasons ?? []),
                ...riskAssessment.reasons,
                ...(matrixChangedSinceLastFullPass ? ["matrix_changed_since_last_full_pass"] : []),
            ]),
        ];
    }

    if (isCurrentFullPass) {
        nextSession.lastFullPass = {
            completedAt: nextSession.lastRun.completedAt,
            matrixHash: nextSession.matrixHash,
            snapshotHash: nextSession.lastRun.snapshotHash,
        };
    }

    return nextSession;
}
