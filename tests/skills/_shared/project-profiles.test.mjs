import {spawnSync} from "node:child_process";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../");
const LOADER = path.join(ROOT, ".agents/skills/_shared/scripts/env-load.sh");
const PROFILE_REFERENCE = "<skills_root>/_shared/references/project-profiles.md";
const CONSUMERS = ["context-refresh", "code-implement", "code-review", "review-quick", "git-commit", "commit-message-write", "rules-sync", "docs-sync"];

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

describe("profile instruction routing", () => {
    it.each(CONSUMERS)("keeps %s standards available but delegates activation", (skill) => {
        const source = readFileSync(path.join(ROOT, `.agents/skills/${skill}/SKILL.md`), "utf8");
        const [, frontmatter, body] = source.split(/^---\s*$/m);
        for (const file of ["project-profiles.md", "php-symfony-postgres-standards.md", "cqrs-monolith-standard-overrides.md"]) {
            expect(frontmatter).toContain(`  - _shared/references/${file}`);
        }
        expect(frontmatter).toContain("  - _shared/scripts/env-load.sh");
        expect(body).toContain(PROFILE_REFERENCE);
        expect(body).not.toContain("CQRS_MONOLITH_STANDARD_OVERRIDES=1");
        expect(body).not.toContain("SKILLS_STACK_PROFILE=");
        expect(body).not.toContain("php-symfony-postgres-standards.md");
    });

    it("checks the profile before QA commands without changing matrix selection", () => {
        const source = readFileSync(path.join(ROOT, ".agents/skills/qa-run/SKILL.md"), "utf8");
        expect(source).toContain(PROFILE_REFERENCE);
        expect(source).toContain("Przed uruchomieniem komend macierzy");
        expect(source).toContain("algorytm macierzy nie zależy od profilu");
    });

    it("scopes preflight to tools needed by the current step", () => {
        for (const file of ["code-implement/SKILL.md", "_shared/references/runtime-quality-procedures.md"]) {
            const source = readFileSync(path.join(ROOT, ".agents/skills", file), "utf8");
            expect(source).toContain("resolve_tool_cmd");
            expect(source).toMatch(/wyłącznie (?:komendy )?narzędzi[^\n]*potrzebn[^\n]*wykonywanym kroku/);
            expect(source).not.toContain("co najmniej `composer`, `console`, `yarn`, `codecept`");
        }
    });

    it("centralizes structure and priority instead of maintaining runtime copies", () => {
        const source = readFileSync(path.join(ROOT, ".agents/skills/_shared/references/runtime-collaboration-guidelines.md"), "utf8");
        expect(source).toContain("./skill-structure-contract.md");
        expect(source).toContain("./project-profiles.md");
        expect(source).not.toContain("skill_dir` =");
        expect(source).not.toContain("1. Polecenie użytkownika");
        expect(source).not.toContain("1. Instrukcje systemowe");
    });

    it("documents migration before updating existing PHP consumers", () => {
        const source = readFileSync(path.join(ROOT, ".agents/skills/_shared/references/project-profiles.md"), "utf8");
        expect(source).toContain("**Before updating the installed skills**");
        expect(source).toContain("SKILLS_STACK_PROFILE=php-symfony-postgres");
        expect(source).toContain("refresh the context manifest");
        expect(readFileSync(path.join(ROOT, ".env.dist"), "utf8")).toContain("project-profiles.md");
    });
});
