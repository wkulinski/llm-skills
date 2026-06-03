# Curated LLM Skills

This repository is a source catalog of reusable LLM skills for PHP/Symfony/PostgreSQL projects. It contains skill definitions, shared runtime rules, and helper scripts that can be consumed from other repositories with a similar stack.

## About This Repository

### Intended stack
These skills are tuned for:
- PHP 8.x
- Symfony
- PostgreSQL
- Doctrine ORM (with optional CQRS/monolith overrides)

### Recommended use cases
Use this set when you want reusable implementation workflows for:
- feature/bugfix/refactor tasks in Symfony backends,
- quality gates (quick review + full QA),
- worklog + commit automation,
- documentation consistency after code changes.

The skills are designed to be portable between projects using the same stack. Runtime rules required by skills live inside `.agents/skills/**`, not in project-specific `docs/` files.

### Rules model
- Baseline standards (always on):
  - `.agents/skills/_shared/references/php-symfony-postgres-standards.md`
- Optional strict profile (only with env flag):
  - `.agents/skills/_shared/references/cqrs-monolith-standard-overrides.md`
- Runtime collaboration and quality procedures used by skills:
  - `.agents/skills/_shared/references/runtime-collaboration-guidelines.md`
  - `.agents/skills/_shared/references/runtime-quality-procedures.md`

`AGENTS.md` in this repository root is reserved for rules specific to this repository as a skills catalog, not for runtime rules of consumer projects.

## Using These Skills in Another Project

### Recommended installation and management
For installing, updating, and managing these skills in consumer repositories, use [LLM Skills Manager (LSM)](https://github.com/wkulinski/lsm).

Treat this repository as the source catalog, and use LSM as the default operational workflow for:
- installing selected skills into a target project,
- updating synchronized skills,
- managing additions and removals in a controlled way.

Prefer LSM over manually copying or maintaining `.agents/skills/**` in downstream projects.

### What to paste into project `AGENTS.md`
If a consumer project uses these skills, add the following blocks to that project's `AGENTS.md`.

#### 1. Skill path resolution contract
```md
## Globalny kontrakt ścieżek dla skilli
- Po wybraniu skilla agent zna pełną ścieżkę do aktywnego `SKILL.md`.

Definicje:
- `skill_dir` oznacza katalog aktywnego `SKILL.md`.
- `skills_root` oznacza katalog nadrzędny wobec `skill_dir`.

## Notacja ścieżek w skillach
- W treści `SKILL.md` używaj wyłącznie jawnej notacji:
    - `./...` dla ścieżek repo-relative (`./` = root repo),
    - `<skill_dir>/...` dla plików należących do aktywnego skilla,
    - `<skills_root>/_shared/...` dla plików współdzielonych,
    - `<skills_root>/<nazwa-skilla>/SKILL.md` dla odwołań do innych skilli.
- Nie używaj w treści `SKILL.md` gołych ścieżek względnych typu `scripts/...`, `references/...`, `assets/...`, `templates/...`, `_shared/...` ani `../...`.
- Frontmatter `shared_files` pozostaje zapisywany bez placeholderów, ewentualnie do `skills_root`, bo jest konsumowany przez tooling repo.
- Jeśli skill wskazuje plik lub skrypt, agent ma użyć dokładnie tej ścieżki po podstawieniu placeholderów według powyższej notacji.
- Brak pliku, brak skryptu, brak prawa wykonania albo błąd uruchomienia wymaganego skryptu jest twardym błędem procedury.
- W takim przypadku agent przerywa wykonanie i czeka na decyzję użytkownika.
- Agent nie stosuje fallbacków ani obejść dla brakujących lub niesprawnych skryptów.
```

#### 2. `docs_map` block
Start with a minimal map and add more keys only for skills you actually use.

Minimal example:
```yaml
docs_map:
    MAIN_DOC: docs/README.md
    AGENT_RULES_DOC: docs/AGENTS.md
    COMMIT_MESSAGE_DIR: /tmp/
    HANDOFF_DOC: var/agent/HANDOFF.md
    SKILLS_INDEX_DOC: docs/SKILLS.md
```

Extended example:
```yaml
docs_map:
    MAIN_DOC: docs/README.md
    AGENT_RULES_DOC: docs/AGENTS.md
    QUALITY_PROCEDURES_DOC: docs/QUALITY-PROCEDURES.md
    MODULE_INDEX_DOC: docs/modules/README.md
    MODULE_DOCS_GLOB: docs/modules/*/README.md
    TESTS_README: docs/tests/README.md
    COMMIT_MESSAGE_DIR: /tmp/
    HANDOFF_DOC: var/agent/HANDOFF.md
    SKILLS_INDEX_DOC: docs/SKILLS.md
```

Key semantics:
- `*_DOC`: single file path
- `*_DIR`: directory path
- All paths are repo-relative.

Required vs optional keys in this skills set:
- Required by `context-refresh`: `MAIN_DOC`
- Required by `docs-sync`: `MAIN_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB`
- Required by `docs-todo`: `MAIN_DOC`, `MODULE_DOCS_GLOB`
- Required by `commit-message-write`: `COMMIT_MESSAGE_DIR`
- Required by `handoff-refresh`: `HANDOFF_DOC`
- Required by `skills-index-refresh`: `SKILLS_INDEX_DOC`
- Required by `git-commit`: `COMMIT_MESSAGE_DIR`
- Optional in selected skills: `TESTS_README`, `HANDOFF_DOC`, `SKILLS_INDEX_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB`, `COMMIT_MESSAGE_DIR`

Important:
- You do not have to define every key globally.
- Define only keys needed by skills you actually use in the target project.
- Missing a required key blocks only the currently invoked skill; it does not invalidate the whole skills set.
- If a required key is missing, the skill should stop and ask for the missing path instead of guessing.

Configuration boundary:
- `.env` keys like `BIN_PATH` and `CACHE_PATH` are runtime or environment configuration.
- `docs_map` in `AGENTS.md` is repository structure configuration.

## Runtime Setup for Consumer Projects

## Development in This Repository

### Tests
This repository uses Vitest for executable tests around skill helper scripts.

Run the test suite with:
```bash
npm test
```

The local QA matrix (`.agents/qa-run.matrix.json`) runs `npm test` when Node scripts, test files, or package metadata change.

### Environment contract
Minimal `.env.local` or `.env.dist` variables used by this repository:
- `GH_TOKEN` (optional): token for GitHub CLI/MCP work.
- `BIN_PATH` (optional): wrapper prefix for project tools (proxy path).
- `CACHE_PATH` (optional): local agent cache/state directory.
- `CQRS_MONOLITH_STANDARD_OVERRIDES` (`0|1`): enables CQRS/monolith overrides.

Shell scripts in `.agents/skills/**/scripts` auto-load `.env` and `.env.local` through `.agents/skills/_shared/scripts/env-load.sh`. This helper also exposes `resolve_tool_cmd` for deterministic entrypoint resolution.

### Tool entrypoints
Proxy wrappers are optional.

`resolve_tool_cmd` from `.agents/skills/_shared/scripts/env-load.sh` is the single source of truth for tool entrypoints. Always run preflight through this helper; do not build tool paths manually from `BIN_PATH` and do not use extra heuristics.

Recommended shell pattern:
```bash
source .agents/skills/_shared/scripts/env-load.sh
COMPOSER_CMD="$(resolve_tool_cmd composer composer)"
CONSOLE_CMD="$(resolve_tool_cmd console bin/console)"
YARN_CMD="$(resolve_tool_cmd yarn yarn)"
CODECEPT_CMD="$(resolve_tool_cmd codecept vendor/bin/codecept codecept)"
```

If a required command cannot be resolved by `resolve_tool_cmd`, treat it as a blocker and ask the user for the correct entrypoint. `resolve_tool_cmd` lazy-loads `.env` and `.env.local` automatically.

`CACHE_PATH` is used by local cache scripts. It is auto-loaded from `.env` or `.env.local`, but you can still override it with `export` in the current shell session.

### Deterministic QA matrix (`$qa-run`)
`$qa-run` uses repo-level matrix config in `.agents/qa-run.matrix.json`.

If the file is missing, the runner creates a default skeleton automatically. Commands are executed exactly as defined in this JSON, with no command discovery or heuristics and with fail-fast on the first error.

### Optional architecture profile
Set `CQRS_MONOLITH_STANDARD_OVERRIDES=1` to activate additional CQRS or modular-monolith conventions from `.agents/skills/_shared/references/cqrs-monolith-standard-overrides.md`.
