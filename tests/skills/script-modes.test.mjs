import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Skills invoke scripts directly (`<skill_dir>/scripts/<name>.mjs`) and consumers
// treat a missing executable bit as a hard error, so every tracked script with a
// shebang must be committed as executable. lsm sync copies the mode as-is.
it("commits every tracked script with a shebang as executable", () => {
    const entries = execFileSync("git", ["ls-files", "-s", "--", ".agents/skills", "distribution"], {
        cwd: ROOT,
        encoding: "utf8",
    }).split("\n").filter(Boolean);

    const missing = entries
        .map(line => line.match(/^(\d+) \S+ \d+\t(.+)$/))
        .filter(match => match && /\.(?:mjs|cjs|js|sh)$/.test(match[2]))
        .filter(match => readFileSync(path.join(ROOT, match[2]), "utf8").startsWith("#!"))
        .filter(match => match[1] !== "100755")
        .map(match => match[2]);

    assert.deepEqual(missing, []);
});
