import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn as nodeSpawn} from "node:child_process";
import {PassThrough} from "node:stream";
import {promisify} from "node:util";

// Keep asynchronous ChildProcess events and live log streams while the child
// writes regular files instead of Node's socket-based stdout/stderr pipes.
// Current consumers are noninteractive: stdin is ignored or supplied up front.
export function spawn(command, args = [], options = {}) {
    const {input, encoding, stdio, ...rest} = options;
    const modes = Array.isArray(stdio) ? [...stdio] : Array(3).fill(stdio ?? "pipe");
    if (modes.length > 3) { throw new TypeError("file-process supports stdin/stdout/stderr only"); }
    while (modes.length < 3) { modes.push("pipe"); }
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "skill-async-process-"));
    const descriptors = [];
    const captures = [];
    const cleanup = () => {
        try {
            for (const descriptor of descriptors.splice(0)) { fs.closeSync(descriptor); }
        } finally { fs.rmSync(directory, {recursive: true, force: true}); }
    };
    let child;
    try {
        const childStdio = modes.map((mode, index) => {
            if (mode !== "pipe" && mode !== null && mode !== undefined) { return mode; }
            if (index === 0 && input === undefined) { return "ignore"; }
            const file = path.join(directory, String(index));
            const descriptor = fs.openSync(file, "wx+", 0o600);
            descriptors.push(descriptor);
            if (index === 0) {
                fs.writeFileSync(descriptor, input, {encoding: encoding && encoding !== "buffer" ? encoding : "utf8"});
                const reader = fs.openSync(file, "r");
                descriptors.push(reader);
                return reader;
            }
            const stream = new PassThrough();
            captures.push({index, descriptor, stream, offset: 0});
            return descriptor;
        });
        child = nodeSpawn(command, args, {...rest, stdio: childStdio});
    } catch (error) {
        cleanup();
        throw error;
    }
    const drain = () => {
        for (const capture of captures) {
            const size = fs.fstatSync(capture.descriptor).size;
            while (capture.offset < size) {
                const buffer = Buffer.alloc(Math.min(64 * 1024, size - capture.offset));
                const count = fs.readSync(capture.descriptor, buffer, 0, buffer.length, capture.offset);
                if (count === 0) { break; }
                capture.offset += count;
                capture.stream.write(buffer.subarray(0, count));
            }
        }
    };
    for (const capture of captures) {
        child[capture.index === 1 ? "stdout" : "stderr"] = capture.stream;
        child.stdio[capture.index] = capture.stream;
    }
    const timer = setInterval(drain, 20);
    child.once("close", () => {
        clearInterval(timer);
        try {
            drain();
            for (const capture of captures) { capture.stream.end(); }
        } finally { cleanup(); }
    });
    return child;
}

// Match the execFile callback and util.promisify contracts used by benchmarks.
export function execFile(command, args, suppliedOptions, suppliedCallback) {
    const options = typeof suppliedOptions === "function" ? {} : suppliedOptions ?? {};
    const callback = typeof suppliedOptions === "function" ? suppliedOptions : suppliedCallback;
    const {encoding = "utf8", maxBuffer = 1024 * 1024} = options;
    const child = spawn(command, args, options);
    const chunks = [[], []];
    const sizes = [0, 0];
    let error = null;
    [child.stdout, child.stderr].forEach((stream, index) => stream?.on("data", (chunk) => {
        sizes[index] += chunk.length;
        if (sizes[index] <= maxBuffer) { chunks[index].push(chunk); }
        else if (!error) {
            error = Object.assign(new Error("Captured subprocess output exceeds maxBuffer"), {code: "ENOBUFS"});
            child.kill(options.killSignal ?? "SIGTERM");
        }
    }));
    child.once("error", (failure) => { error = failure; });
    child.once("close", (code, signal) => {
        const [stdout, stderr] = chunks.map((items) => {
            const buffer = Buffer.concat(items);
            return encoding && encoding !== "buffer" ? buffer.toString(encoding) : buffer;
        });
        if (error || code !== 0) {
            error ??= new Error(`Command failed: ${command}`);
            Object.assign(error, {code: error.code ?? code, signal, stdout, stderr});
        }
        callback?.(error, stdout, stderr);
    });
    return child;
}

execFile[promisify.custom] = (command, args, options) => new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => error ? reject(error) : resolve({stdout, stderr}));
});
