import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {describe, expect, it} from "vitest";

// Cost-bearing smoke: runs one real Claude Code review through Paseo.
// Opt in explicitly with CLAUDE_REVIEW_SMOKE=1 plus explicit launch parameters.
const SMOKE_ENABLED = process.env.CLAUDE_REVIEW_SMOKE === "1";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../");
const HELPER = path.join(ROOT, ".agents/skills/claude-review/scripts/review-job.mjs");
const FIXTURE_DIR = path.join(ROOT, "tests/fixtures/claude-review-smoke");

function paseo(args) {
    const command = execFileSync("bash", ["-c", `source "${ROOT}/.agents/skills/_shared/scripts/env-load.sh" && resolve_tool_cmd paseo`], {cwd: ROOT, encoding: "utf8"}).trim();
    return execFileSync(command, args, {cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024});
}

function helper(args) {
    return JSON.parse(execFileSync("node", [HELPER, ...args], {cwd: ROOT, encoding: "utf8"}));
}

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) { throw new Error(`${name} is required when CLAUDE_REVIEW_SMOKE=1`); }
    return value;
}

describe.skipIf(!SMOKE_ENABLED)("claude-review live smoke (local symlinked skills)", () => {
    it("runs one executor review and accepts its report for the reviewed snapshot", () => {
        const model = requiredEnv("CLAUDE_REVIEW_MODEL");
        const thinking = requiredEnv("CLAUDE_REVIEW_THINKING");
        const timeoutSeconds = requiredEnv("CLAUDE_REVIEW_TIMEOUT_SECONDS");
        const parentId = requiredEnv("PASEO_AGENT_ID");
        const jobId = crypto.randomUUID();
        const cache = path.join(ROOT, "var/agent/cache/claude-review-smoke");
        const requirements = path.join(cache, `${jobId}-requirements.md`);
        let sessionId = null;

        fs.mkdirSync(cache, {recursive: true});
        fs.mkdirSync(FIXTURE_DIR, {recursive: true});
        fs.writeFileSync(requirements, "`sumPositive(numbers)` returns the sum of the strictly positive numbers only; negative numbers and zero are ignored.\n");
        fs.writeFileSync(path.join(FIXTURE_DIR, "sum-positive.mjs"), "export function sumPositive(numbers) {\n    return numbers.reduce((total, value) => total + value, 0);\n}\n");

        try {
            const prepared = helper(["prepare", "--job-id", jobId, "--requirements", requirements, "--model", model, "--thinking", thinking, "--timeout-seconds", timeoutSeconds]);
            const jobDir = path.dirname(path.join(ROOT, prepared.job_path));
            const prompt = fs.readFileSync(path.join(ROOT, prepared.prompt_path), "utf8");

            const launched = JSON.parse(paseo([
                "run", "--background", "--provider", "claude", "--model", model, "--thinking", thinking,
                "--mode", "auto", "--cwd", ROOT, "--title", `claude-review smoke ${jobId}`,
                "--env", "ANTHROPIC_API_KEY=", "--env", "ANTHROPIC_AUTH_TOKEN=", "--env", "ANTHROPIC_BASE_URL=",
                "--json", prompt,
            ]));
            sessionId = launched.agentId ?? launched.id ?? launched.Id;
            expect(sessionId, JSON.stringify(launched)).toBeTruthy();

            fs.writeFileSync(path.join(jobDir, "inspect-launch.json"), paseo(["inspect", sessionId, "--json"]));
            helper(["bind-session", "--job", prepared.job_path, "--inspect", path.join(jobDir, "inspect-launch.json"), "--parent-id", parentId]);

            paseo(["wait", sessionId, "--timeout", timeoutSeconds, "--json"]);
            fs.writeFileSync(path.join(jobDir, "inspect-final.json"), paseo(["inspect", sessionId, "--json"]));
            fs.writeFileSync(path.join(jobDir, "envelope.txt"), paseo(["logs", sessionId, "--filter", "text", "--tail", "1"]));
            const timeline = paseo(["logs", sessionId]);
            fs.writeFileSync(path.join(jobDir, "timeline.txt"), timeline);

            const result = helper(["accept", "--job", prepared.job_path, "--envelope", path.join(jobDir, "envelope.txt"), "--inspect", path.join(jobDir, "inspect-final.json")]);
            fs.writeFileSync(path.join(jobDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);

            expect(timeline).toMatch(/\[Skill\] code-review/);
            expect(result.decision, JSON.stringify(result)).toBe("ACCEPTED");
            expect(result.report_markdown).toMatch(/sum-positive\.mjs/);
            expect(result.report_markdown).toMatch(/negative|ujemn/i);
        } finally {
            fs.rmSync(FIXTURE_DIR, {recursive: true, force: true});
            if (sessionId) {
                try { paseo(["archive", sessionId, "--force"]); } catch { /* reported by the session state */ }
            }
        }
    }, 30 * 60 * 1000);
});
