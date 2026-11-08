import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it, vi} from "vitest";
import {spawnSync} from "../../helpers/bounded-spawn-sync.mjs";
import {assertStorageLayout, resolveArtifactCacheRoot} from "../../../.agents/skills/_shared/scripts/artifact-path.mjs";
import {resolveCacheRoot} from "../../../.agents/skills/agent-cache-clear/scripts/clear.mjs";
import {getCacheRoot} from "../../../.agents/skills/qa-run/scripts/run-matrix/shared/paths.mjs";
import {defaultAnalysisDir} from "../../../.agents/skills/opencode-workflow-economics/scripts/owe.mjs";

const CLI = fileURLToPath(new URL("../../../.agents/skills/_shared/scripts/artifact-path.mjs", import.meta.url));
const roots = [];
function project(configuration) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "artifact cache project-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "src"));
    if (configuration !== undefined) { fs.writeFileSync(path.join(root, ".env"), configuration); }
    return root;
}
afterEach(() => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) { fs.rmSync(root, {recursive: true, force: true}); }
});

describe("project cache resolver", () => {
    it.each([
        ["CACHE_PATH='local cache'\nUNRELATED_VALUE=not-for-output\n", "local cache"],
        [undefined, "var/agent/cache"],
        ["CACHE_PATH=\n", "var/agent/cache"],
    ])("uses project configuration or its default, ignoring inherited cache: %s", (configuration, expected) => {
        const root = project(configuration);
        vi.stubEnv("CACHE_PATH", "/another-environment/cache");
        vi.stubEnv("OWC_PATH", "");
        const originalCwd = process.cwd();
        const expectedRoot = path.join(root, expected);
        expect(resolveArtifactCacheRoot(path.join(root, "src"))).toBe(expectedRoot);
        expect(assertStorageLayout({cwd: root}).cacheRoot).toBe(expectedRoot);
        expect(resolveCacheRoot(undefined, root).absolute).toBe(expectedRoot);
        expect(getCacheRoot(root)).toBe(expectedRoot);
        expect(defaultAnalysisDir(root)).toBe(path.join(expectedRoot, "owc"));
        const result = spawnSync(process.execPath, [CLI, "cache-root"], {cwd: path.join(root, "src"), encoding: "utf8"});
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe(`${expectedRoot}\n`);
        expect(result.stderr).toBe("");
        expect(process.cwd()).toBe(originalCwd);
        expect(process.env.CACHE_PATH).toBe("/another-environment/cache");
        expect(process.env.UNRELATED_VALUE).toBeUndefined();
    });

    it("memoizes configuration per root without mixing projects or global env", () => {
        const first = project("CACHE_PATH=shared-name\n");
        const second = project("CACHE_PATH=shared-name\n");
        vi.stubEnv("CACHE_PATH", "parent-cache");
        expect(resolveArtifactCacheRoot(first)).toBe(path.join(first, "shared-name"));
        expect(resolveArtifactCacheRoot(second)).toBe(path.join(second, "shared-name"));
        fs.writeFileSync(path.join(first, ".env"), "CACHE_PATH=changed-on-disk\n");
        expect(resolveArtifactCacheRoot(first)).toBe(path.join(first, "shared-name"));
        expect(process.env.CACHE_PATH).toBe("parent-cache");
        expect(assertStorageLayout({cwd: first, cachePath: "explicit"}).cacheRoot).toBe(path.join(first, "explicit"));
        expect(() => assertStorageLayout({cwd: first, cachePath: "../outside"})).toThrow();
    });

    it("honors active env file precedence through the existing Bash loader", () => {
        const root = project("CACHE_PATH=base\n");
        fs.writeFileSync(path.join(root, ".env.local"), "CACHE_PATH=local\n");
        fs.writeFileSync(path.join(root, ".env.test"), "CACHE_PATH=test-cache\n");
        fs.writeFileSync(path.join(root, ".env.test.local"), "CACHE_PATH=test-local\n");
        vi.stubEnv("APP_ENV", "test");
        expect(resolveArtifactCacheRoot(root)).toBe(path.join(root, "test-local"));
    });

    it("tolerates undefined references in project env files like other env-load callers", () => {
        // Shell interpolation in the env file, not a JavaScript template.
        const root = project("DATABASE_URL=$" + "{DB_HOST}/app\nAPP_SECRET=abc$undefined_part\nCACHE_PATH=interpolated-cache\n");
        fs.writeFileSync(path.join(root, ".env.local"), "DB_HOST=localhost\n");
        expect(resolveArtifactCacheRoot(root)).toBe(path.join(root, "interpolated-cache"));
        const result = spawnSync(process.execPath, [CLI, "cache-root"], {cwd: root, encoding: "utf8"});
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toBe(`${path.join(root, "interpolated-cache")}\n`);
    });

    it("reports a bounded loader diagnostic when project env aborts the resolver", () => {
        const root = project("echo 'env loader aborted' >&2\nexit 3\n");
        expect(() => resolveArtifactCacheRoot(root)).toThrow(expect.objectContaining({
            code: "INVALID_CACHE_PATH",
            message: expect.stringContaining("exit 3: env loader aborted"),
        }));
    });

    it.each(["../outside", "/outside/cache", ".", "var/agent", "var/agent/task-plan", "docs/plans/nested"])(
        "rejects unsafe project cache %s in the API, qa-run and CLI", (cachePath) => {
            const root = project(`CACHE_PATH='${cachePath}'\n`);
            expect(() => resolveArtifactCacheRoot(root)).toThrow(expect.objectContaining({code: "INVALID_CACHE_PATH"}));
            expect(() => getCacheRoot(root)).toThrow(expect.objectContaining({code: "INVALID_CACHE_PATH"}));
            const result = spawnSync(process.execPath, [CLI, "cache-root"], {cwd: root, encoding: "utf8"});
            expect(result.status).toBe(1);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain("INVALID_CACHE_PATH");
        },
    );

    it("rechecks physical boundaries even after configuration has been memoized", () => {
        const root = project("CACHE_PATH=cache\n");
        expect(resolveArtifactCacheRoot(root)).toBe(path.join(root, "cache"));
        fs.mkdirSync(path.join(root, "target"));
        fs.symlinkSync(path.join(root, "target"), path.join(root, "cache"));
        expect(() => resolveArtifactCacheRoot(root)).toThrow(/symlinks/);
    });
});
