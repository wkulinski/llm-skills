#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

export class AtomicWriteError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = "AtomicWriteError";
        this.code = code;
        this.details = details;
    }
}

export function writeFileAtomic(filePath, contents, options = {}) {
    const fsOps = options.fsOps ?? fs;
    const target = path.resolve(filePath);
    if (options.rootDir) {
        assertInsideRoot(target, options.rootDir);
    }
    const temporary = `${target}.tmp-${process.pid}`;
    try {
        fsOps.mkdirSync(path.dirname(target), {recursive: true});
        fsOps.writeFileSync(temporary, contents, "utf8");
        fsOps.renameSync(temporary, target);
        return {path: target, written: true};
    } catch (error) {
        try {
            fsOps.unlinkSync(temporary);
        } catch {
            // Cleanup is best effort; the original target remains untouched.
        }
        throw new AtomicWriteError("WRITE_FAILED", `Could not write ${target}.`, {
            cause: error instanceof Error ? error.message : String(error),
            path: target,
        });
    }
}

export const writeAtomicFile = writeFileAtomic;

function assertInsideRoot(target, rootDir) {
    const root = path.resolve(rootDir);
    const relative = path.relative(root, target);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new AtomicWriteError("UNSAFE_PATH", "File target must remain inside rootDir.", {target, root});
    }
}
