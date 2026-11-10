import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync as nodeSpawnSync} from "node:child_process";

// Node's synchronous pipe transport can fail with EPERM in agent sandboxes.
// Use private regular files for captured streams, including JSON/RPC stdin.
// Explicit inherit/ignore/file descriptors retain their existing meaning.
export function spawnSync(command, args = [], options = {}) {
    const {input, encoding, stdio, maxBuffer = 1024 * 1024, ...rest} = options;
    const modes = Array.isArray(stdio) ? [...stdio] : Array(3).fill(stdio ?? "pipe");
    if (modes.length > 3) { throw new TypeError("file-process supports stdin/stdout/stderr only"); }
    while (modes.length < 3) { modes.push("pipe"); }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-process-"));
    const descriptors = [];
    const captures = new Map();
    try {
        const childStdio = modes.map((mode, index) => {
            if (mode !== "pipe" && mode !== null && mode !== undefined) { return mode; }
            if (index === 0 && input === undefined) { return "ignore"; }
            const file = path.join(directory, String(index));
            const descriptor = fs.openSync(file, "wx+", 0o600);
            descriptors.push(descriptor);
            if (index === 0) {
                // Use a separate read descriptor so the child starts at offset 0.
                fs.writeFileSync(descriptor, input, {encoding: encoding && encoding !== "buffer" ? encoding : "utf8"});
                const reader = fs.openSync(file, "r");
                descriptors.push(reader);
                return reader;
            }
            captures.set(index, file);
            return descriptor;
        });
        const result = nodeSpawnSync(command, args, {...rest, stdio: childStdio});
        const output = [null, null, null];
        for (const [index, file] of captures) {
            const size = fs.statSync(file).size;
            const length = Math.min(size, maxBuffer);
            const descriptor = fs.openSync(file, "r");
            let buffer;
            try {
                buffer = Buffer.alloc(length);
                const bytes = fs.readSync(descriptor, buffer, 0, length, 0);
                buffer = buffer.subarray(0, bytes);
            } finally { fs.closeSync(descriptor); }
            output[index] = encoding && encoding !== "buffer" ? buffer.toString(encoding) : buffer;
            if (size > maxBuffer && !result.error) {
                result.error = Object.assign(new Error("Captured subprocess output exceeds maxBuffer"), {code: "ENOBUFS"});
            }
        }
        return {...result, status: result.error ? null : result.status, output, stdout: output[1], stderr: output[2]};
    } finally {
        try {
            for (const descriptor of descriptors) { fs.closeSync(descriptor); }
        } finally { fs.rmSync(directory, {recursive: true, force: true}); }
    }
}

// The call sites use execFileSync's return/throw contract. Preserve status,
// signal and both captured streams on failures, including launch errors.
export function execFileSync(command, args = [], options = {}) {
    const result = spawnSync(command, args, options);
    if (result.error || result.status !== 0) {
        const error = result.error ?? new Error(`Command failed: ${command}`);
        Object.assign(error, {status: result.status, signal: result.signal, pid: result.pid,
            output: result.output, stdout: result.stdout, stderr: result.stderr});
        throw error;
    }
    return result.stdout;
}
