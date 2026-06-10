import {existsSync, mkdirSync, readFileSync, writeFileSync} from "node:fs";
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

    mkdirSync(path.dirname(sessionAbsPath), {recursive: true});
    writeFileSync(sessionAbsPath, `${JSON.stringify(session, null, 2)}\n`, "utf-8");
    console.log(`INFO: Session written: ${sessionAbsPath}`);
}

export function updateSession(session, cli, mode, currentState, config, riskAssessment) {
    const matrixHash = hashJson(config.raw);
    const matrixChangedSinceLastFullPass = mode === "delta"
        && session.lastFullPass?.matrixHash
        && session.lastFullPass.matrixHash !== matrixHash;
    const nextSession = {
        ...session,
        version: SESSION_VERSION,
        matrixHash,
        lastRun: {
            completedAt: new Date().toISOString(),
            mode,
            rerunReason: cli.rerunReason,
            snapshotHash: hashJson(currentState.files),
        },
    };

    if (cli.rerunReason === "full-final-pass") {
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

    if (mode === "full") {
        nextSession.lastFullPass = {
            completedAt: nextSession.lastRun.completedAt,
            matrixHash: nextSession.matrixHash,
            snapshotHash: nextSession.lastRun.snapshotHash,
        };
    }

    return nextSession;
}
