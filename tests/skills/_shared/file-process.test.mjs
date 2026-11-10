import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {promisify} from "node:util";
import {spawn, execFile} from "../../../.agents/skills/_shared/scripts/file-process-async.mjs";
import {afterEach, describe, expect, it, vi} from "vitest";
import {spawnSync, execFileSync} from "../../../.agents/skills/_shared/scripts/file-process.mjs";

const scratch = [];
function temporaryDirectory() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-process-test-"));
    scratch.push(dir);
    return dir;
}
afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of scratch.splice(0)) { fs.rmSync(dir, {recursive: true, force: true}); }
});

describe("file-backed subprocess capture", () => {
    it("uses private regular files for all streams and cleans up", () => {
        const dir = temporaryDirectory();
        vi.stubEnv("TMPDIR", dir);
        const code = `const fs=require("node:fs");
            for (const fd of [0,1,2]) {
                if (!fs.fstatSync(fd).isFile()) process.exit(91);
                if ((fs.fstatSync(fd).mode & 0o777) !== 0o600) process.exit(92);
            }
            process.stdout.write(fs.readFileSync(0)); process.stderr.write("diagnostic");`;
        const result = spawnSync(process.execPath, ["-e", code], {input: "rpc payload", encoding: "utf8"});
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("rpc payload");
        expect(result.stderr).toBe("diagnostic");
        expect(result.output).toEqual([null, "rpc payload", "diagnostic"]);
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("preserves binary stdin and returns buffers by default", () => {
        const input = Buffer.from([0, 255, 128, 10]);
        const result = spawnSync(process.execPath, ["-e", 'process.stdout.write(require("node:fs").readFileSync(0))'], {input});
        expect(result.stdout).toEqual(input);
        expect(Buffer.isBuffer(result.stderr)).toBe(true);
    });

    it("preserves nonzero exits and execFileSync failure details", () => {
        const code = 'process.stdout.write("partial");process.stderr.write("invalid");process.exit(7)';
        expect(spawnSync(process.execPath, ["-e", code], {encoding: "utf8"}).status).toBe(7);
        try {
            execFileSync(process.execPath, ["-e", code], {encoding: "utf8"});
            expect.fail("expected failure");
        } catch (error) {
            expect(error).toMatchObject({status: 7, stdout: "partial", stderr: "invalid"});
        }
    });

    it.each(["missing", "timeout"])("cleans up on %s", (kind) => {
        const dir = temporaryDirectory();
        vi.stubEnv("TMPDIR", dir);
        const result = kind === "missing"
            ? spawnSync(path.join(dir, "missing"), [], {encoding: "utf8"})
            : spawnSync(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {timeout: 200, killSignal: "SIGKILL"});
        expect(result.error.code).toBe(kind === "missing" ? "ENOENT" : "ETIMEDOUT");
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("preserves explicit output descriptors and ignored streams", () => {
        const file = path.join(temporaryDirectory(), "stdout");
        const descriptor = fs.openSync(file, "wx+", 0o600);
        try {
            const result = spawnSync(process.execPath, ["-e", 'process.stdout.write("direct")'], {stdio: ["ignore", descriptor, "ignore"]});
            expect(result.error).toBeUndefined();
            expect(result.stdout).toBeNull();
            expect(result.stderr).toBeNull();
            expect(fs.readFileSync(file, "utf8")).toBe("direct");
        } finally { fs.closeSync(descriptor); }
    });

    it("honors encoding and output limits without returning success on overflow", () => {
        expect(execFileSync(process.execPath, ["-e", 'process.stdout.write("ok")'], {encoding: "utf8"})).toBe("ok");
        const result = spawnSync(process.execPath, ["-e", 'process.stdout.write("123456")'], {encoding: "utf8", maxBuffer: 3});
        expect(result.stdout).toBe("123");
        expect(result.error.code).toBe("ENOBUFS");
        expect(() => execFileSync(process.execPath, ["-e", 'process.stdout.write("123456")'], {maxBuffer: 3})).toThrow(/maxBuffer/);
    });
});


describe("asynchronous file-backed capture", () => {
    it("streams both outputs before close, accepts stdin and cleans up", async () => {
        const dir = temporaryDirectory();
        vi.stubEnv("TMPDIR", dir);
        const child = spawn(process.execPath, ["-e", `const fs=require("node:fs");
            if (![0,1,2].every(fd=>fs.fstatSync(fd).isFile())) process.exit(91);
            process.stdout.write(fs.readFileSync(0));
            setTimeout(()=>{process.stderr.write("later");},100);`], {input: "request"});
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        const code = await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
        });
        expect(code).toBe(0);
        expect(stdout).toBe("request");
        expect(stderr).toBe("later");
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("delivers logs while a child is still running and supports killing it", async () => {
        const dir = temporaryDirectory();
        vi.stubEnv("TMPDIR", dir);
        const child = spawn(process.execPath, ["-e", 'process.stdout.write("ready");setInterval(()=>{},1000)']);
        const closed = new Promise((resolve) => child.once("close", (code, signal) => resolve({code, signal})));
        await new Promise((resolve, reject) => {
            child.once("error", reject);
            child.stdout.once("data", (chunk) => {
                expect(chunk.toString()).toBe("ready");
                expect(child.exitCode).toBeNull();
                resolve();
            });
        });
        child.kill("SIGTERM");
        expect(await closed).toMatchObject({signal: "SIGTERM"});
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    it("preserves promisified execFile success and nonzero failure output", async () => {
        const run = promisify(execFile);
        await expect(run(process.execPath, ["-e", 'process.stdout.write("out");process.stderr.write("err")']))
            .resolves.toEqual({stdout: "out", stderr: "err"});
        await expect(run(process.execPath, ["-e", 'process.stderr.write("bad");process.exit(5)']))
            .rejects.toMatchObject({code: 5, stderr: "bad"});
    });

    it("reports missing commands and output overflow and removes private data", async () => {
        const dir = temporaryDirectory();
        vi.stubEnv("TMPDIR", dir);
        const run = promisify(execFile);
        await expect(run(path.join(dir, "missing"), [])).rejects.toMatchObject({code: "ENOENT"});
        expect(fs.readdirSync(dir)).toEqual([]);
        await expect(run(process.execPath, ["-e", 'process.stdout.write("12345")'], {maxBuffer: 2}))
            .rejects.toMatchObject({code: "ENOBUFS"});
        expect(fs.readdirSync(dir)).toEqual([]);
    });
});
