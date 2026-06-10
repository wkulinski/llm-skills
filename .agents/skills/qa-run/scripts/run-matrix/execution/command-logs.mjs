import {createHash} from "node:crypto";
import {mkdirSync} from "node:fs";
import path from "node:path";

import {sanitizePathPart, toRepoRelativePath} from "../shared/paths.mjs";

export function createCommandLogs(repoRoot, commandsDir, commandIndex, section, command) {
    mkdirSync(commandsDir, {recursive: true});
    const commandHash = createHash("sha256").update(command).digest("hex").slice(0, 12);
    const prefix = `${String(commandIndex).padStart(3, "0")}-${sanitizePathPart(section)}-${commandHash}`;
    const stdoutPath = path.join(commandsDir, `${prefix}.stdout.log`);
    const stderrPath = path.join(commandsDir, `${prefix}.stderr.log`);

    return {
        stderrAbsPath: stderrPath,
        stderrLog: toRepoRelativePath(repoRoot, stderrPath),
        stdoutAbsPath: stdoutPath,
        stdoutLog: toRepoRelativePath(repoRoot, stdoutPath),
    };
}
