import {expect, it} from "vitest";
import {spawnSync} from "../../helpers/bounded-spawn-sync.mjs";

it("passes stdin and captures output", () => {
    const result = spawnSync(process.execPath, ["-e", "process.stdout.write(require('fs').readFileSync(0))"], {input: "report", encoding: "utf8"});
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("report");
});

it("terminates a blocked child even when it ignores SIGTERM", () => {
    expect(() => spawnSync(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {timeout: 500}))
        .toThrow(/ETIMEDOUT/);
});

it("reports subprocess permission or launch errors directly", () => {
    expect(() => spawnSync("/nonexistent/llm-skills-test-command", []))
        .toThrow(/ENOENT/);
});
