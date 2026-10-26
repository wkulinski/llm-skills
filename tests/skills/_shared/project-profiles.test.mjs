import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const LOADER = path.join(ROOT, ".agents/skills/_shared/scripts/env-load.sh");

function withConsumer(files, env, check) {
    const directory = mkdtempSync(path.join(os.tmpdir(), "skills-profile-"));
    try {
        for (const [name, contents] of Object.entries(files)) {
            writeFileSync(path.join(directory, name), contents);
        }
        const cleanEnv = {...process.env};
        for (const key of ["APP_ENV", "SKILLS_STACK_PROFILE", "CQRS_MONOLITH_STANDARD_OVERRIDES", "BIN_PATH", "BASH_ENV", "ENV"]) {
            delete cleanEnv[key];
        }
        const result = spawnSync("bash", ["-c", `set -euo pipefail; source "$1"; ensure_repo_env_loaded "$2"; STACK_PROFILE="$(resolve_stack_profile "$2")" || exit $?; printf "%s:%s\\n" "$STACK_PROFILE" "\${CQRS_MONOLITH_STANDARD_OVERRIDES:-0}"; : > "$2/after-preflight"`, "profile-test", LOADER, directory], {
            cwd: directory,
            env: {...cleanEnv, ...env},
            encoding: "utf8",
        });
        check(result, directory);
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
}

describe("project profile resolution", () => {
    it.each([undefined, "", "generic"])("resolves %s to generic without PHP tools", (profile) => {
        const env = profile === undefined ? {} : {SKILLS_STACK_PROFILE: profile};
        withConsumer({}, env, (result) => {
            expect(result.status).toBe(0);
            expect(result.stdout).toBe("generic:0\n");
            expect(result.stderr).toBe("");
        });
    });

    it.each(["0", "1"])("preserves explicit PHP selection with CQRS=%s", (override) => {
        withConsumer({".env.local": `SKILLS_STACK_PROFILE=php-symfony-postgres\nCQRS_MONOLITH_STANDARD_OVERRIDES=${override}\n`}, {}, (result) => {
            expect(result.status).toBe(0);
            expect(result.stdout).toBe(`php-symfony-postgres:${override}\n`);
        });
    });

    it.each([
        [{SKILLS_STACK_PROFILE: "unknown"}, "SKILLS_STACK_PROFILE_INVALID"],
        [{SKILLS_STACK_PROFILE: "PHP-SYMFONY-POSTGRES"}, "SKILLS_STACK_PROFILE_INVALID"],
        [{SKILLS_STACK_PROFILE: "generic", CQRS_MONOLITH_STANDARD_OVERRIDES: "1"}, "CQRS_OVERRIDE_REQUIRES_PHP_PROFILE"],
        [{CQRS_MONOLITH_STANDARD_OVERRIDES: "1"}, "CQRS_OVERRIDE_REQUIRES_PHP_PROFILE"],
    ])("fails before subsequent writes for invalid configuration %j", (env, error) => {
        withConsumer({}, env, (result, directory) => {
            expect(result.status).toBe(2);
            expect(result.stdout).toBe("");
            expect(result.stderr).toContain(error);
            expect(existsSync(path.join(directory, "after-preflight"))).toBe(false);
        });
    });

    it("uses final active env values rather than the template or an earlier layer", () => {
        withConsumer({
            ".env": "APP_ENV=dev\nSKILLS_STACK_PROFILE=invalid-earlier-layer\n",
            ".env.local": "SKILLS_STACK_PROFILE=generic\n",
            ".env.dev": "SKILLS_STACK_PROFILE=generic\n",
            ".env.dev.local": "SKILLS_STACK_PROFILE=php-symfony-postgres\nCQRS_MONOLITH_STANDARD_OVERRIDES=1\n",
            ".env.dist": "SKILLS_STACK_PROFILE=invalid-template\n",
        }, {}, (result) => {
            expect(result.status).toBe(0);
            expect(result.stdout).toBe("php-symfony-postgres:1\n");
        });
    });

    it("skips .env.local in test and applies test-specific overrides", () => {
        withConsumer({
            ".env": "APP_ENV=test\nSKILLS_STACK_PROFILE=generic\n",
            ".env.local": "SKILLS_STACK_PROFILE=invalid-skipped-layer\nCQRS_MONOLITH_STANDARD_OVERRIDES=1\n",
            ".env.test": "SKILLS_STACK_PROFILE=php-symfony-postgres\n",
            ".env.test.local": "CQRS_MONOLITH_STANDARD_OVERRIDES=1\n",
        }, {}, (result) => {
            expect(result.status).toBe(0);
            expect(result.stdout).toBe("php-symfony-postgres:1\n");
        });
    });

    it("ignores .env.dist when runtime selection is absent", () => {
        withConsumer({".env.dist": "SKILLS_STACK_PROFILE=php-symfony-postgres\nCQRS_MONOLITH_STANDARD_OVERRIDES=1\n"}, {}, (result) => {
            expect(result.status).toBe(0);
            expect(result.stdout).toBe("generic:0\n");
        });
    });
});
