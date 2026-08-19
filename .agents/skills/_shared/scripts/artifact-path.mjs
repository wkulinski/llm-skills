import {tmpdir} from "node:os";
import {isAbsolute, relative, resolve} from "node:path";

export function allowedArtifactRoots(cwd = process.cwd()) {
    return [resolve(cwd, "var/agent/cache"), resolve(tmpdir())];
}

export function assertArtifactPath(filePath, label, cwd = process.cwd()) {
    if (typeof filePath !== "string" || filePath.trim() === "") {
        const error = new Error(`${label} path is required`);
        error.code = "INVALID_ARTIFACT_PATH";
        throw error;
    }
    const resolved = resolve(cwd, filePath);
    const allowed = allowedArtifactRoots(cwd).some((root) => {
        const candidate = relative(root, resolved);
        return candidate === "" || (!candidate.startsWith("..") && !isAbsolute(candidate));
    });
    if (!allowed) {
        const error = new Error(`${label} must be under var/agent/cache or the system temporary directory`);
        error.code = "INVALID_ARTIFACT_PATH";
        throw error;
    }
    return resolved;
}
