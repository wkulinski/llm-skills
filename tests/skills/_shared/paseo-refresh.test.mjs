import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SCRIPT = path.join(ROOT, ".agents/skills/_shared/scripts/paseo-refresh.sh");
const BASH = ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash"].find((candidate) => existsSync(candidate)) ?? "bash";

const PASEO_STUB = `#!/usr/bin/env bash
log="\${STUB_LOG:?}"
printf '%s\\n' "$*" >> "$log"
if [[ "\${1:-}" == "daemon" && "\${2:-}" == "status" ]]; then
  n="$(grep -c '^daemon status' "$log" 2>/dev/null || true)"
  if [[ "\${STUB_MODE:-success}" == "success" && "\${n:-0}" -ge 3 ]]; then
    printf 'localDaemon: running\\nconnectedDaemon: reachable\\n'
  else
    printf 'localDaemon: not_ready\\nconnectedDaemon: unreachable\\n'
  fi
  exit 0
fi
if [[ "\${1:-}" == "provider" && "\${2:-}" == "diagnostic" ]]; then exit 0; fi
if [[ "\${1:-}" == "ls" ]]; then printf 'agent-a\\nagent-b\\n'; exit 0; fi
if [[ "\${1:-}" == "agent" && "\${2:-}" == "reload" ]]; then exit 0; fi
exit 0
`;

const SYSTEMCTL_STUB = `#!/usr/bin/env bash
exit 0
`;

function writeExecutable(filePath, content) {
    writeFileSync(filePath, content, "utf8");
    chmodSync(filePath, 0o755);
}

function createSandbox() {
    const root = mkdtempSync(path.join(os.tmpdir(), "paseo-refresh-"));
    const binDir = path.join(root, "bin");
    const homeDir = path.join(root, "home");
    const logPath = path.join(root, "calls.log");
    mkdirSync(binDir, {recursive: true});
    mkdirSync(homeDir, {recursive: true});
    writeFileSync(logPath, "", "utf8");
    writeExecutable(path.join(binDir, "paseo"), PASEO_STUB);
    writeExecutable(path.join(binDir, "systemctl"), SYSTEMCTL_STUB);
    return {
        root,
        homeDir,
        logPath,
        env: {
            ...process.env,
            HOME: homeDir,
            PATH: `${binDir}:${process.env.PATH ?? ""}`,
            STUB_LOG: logPath,
            STUB_MODE: "success",
        },
    };
}

function readCalls(logPath) {
    return readFileSync(logPath, "utf8").split("\n").filter(Boolean);
}

describe("paseo refresh daemon readiness gate", () => {
    it("waits for daemon readiness before the provider diagnostic in --hard mode", () => {
        const sandbox = createSandbox();
        try {
            const cached = path.join(sandbox.homeDir, ".cache", "opencode", "packages", "opencode-cmd-provider-test", "cache.bin");
            mkdirSync(path.dirname(cached), {recursive: true});
            writeFileSync(cached, "stale", "utf8");

            const result = spawnSync(BASH, [SCRIPT, "--hard"], {
                cwd: sandbox.root,
                env: sandbox.env,
                encoding: "utf8",
            });

            expect(result.status).toBe(0);
            expect(result.stdout).toContain("Paseo daemon reachable");
            expect(result.stdout).toContain("OpenCode provider refreshed");
            expect(result.stdout).toContain("Claude provider refreshed");
            expect(result.stdout).toContain("(2 agent(s) reloaded)");
            expect(existsSync(cached)).toBe(false);

            const calls = readCalls(sandbox.logPath);
            const statusProbes = calls.filter((call) => call.startsWith("daemon status")).length;
            const diagnosticIndex = calls.findIndex((call) => call.startsWith("provider diagnostic"));
            const lastStatusIndex = calls.lastIndexOf("daemon status --no-color");
            expect(statusProbes).toBeGreaterThanOrEqual(3);
            expect(diagnosticIndex).toBeGreaterThan(lastStatusIndex);
        } finally {
            rmSync(sandbox.root, {force: true, recursive: true});
        }
    });

    it("skips the readiness gate in default mode", () => {
        const sandbox = createSandbox();
        try {
            const result = spawnSync(BASH, [SCRIPT], {
                cwd: sandbox.root,
                env: sandbox.env,
                encoding: "utf8",
            });

            expect(result.status).toBe(0);
            expect(result.stdout).not.toContain("Waiting for Paseo daemon readiness");
            expect(result.stdout).toContain("OpenCode provider refreshed");
            expect(result.stdout).toContain("Claude provider refreshed");

            const calls = readCalls(sandbox.logPath);
            expect(calls.some((call) => call.startsWith("daemon status"))).toBe(false);
            expect(calls).toContain("provider diagnostic opencode");
            expect(calls).toContain("provider diagnostic claude");
            expect(calls.indexOf("provider diagnostic claude")).toBeLessThan(calls.findIndex((call) => call.startsWith("agent reload")));
        } finally {
            rmSync(sandbox.root, {force: true, recursive: true});
        }
    });

    it("fails without running diagnostics when the daemon never becomes reachable", () => {
        const sandbox = createSandbox();
        try {
            const result = spawnSync(BASH, [SCRIPT, "--hard"], {
                cwd: sandbox.root,
                env: {...sandbox.env, STUB_MODE: "timeout", PASEO_READY_TIMEOUT: "1"},
                encoding: "utf8",
            });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain("did not become reachable");
            expect(readCalls(sandbox.logPath).some((call) => call.startsWith("provider diagnostic"))).toBe(false);
        } finally {
            rmSync(sandbox.root, {force: true, recursive: true});
        }
    });
});
