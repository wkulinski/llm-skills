# Set of curated LLM Skills 

## Intended stack
These skills are tuned for:
- PHP 8.x
- Symfony
- PostgreSQL
- Doctrine ORM (with optional CQRS/monolith overrides)

## Recommended use cases
Use this set when you want reusable implementation workflows for:
- feature/bugfix/refactor tasks in Symfony backends,
- quality gates (quick review + full QA),
- worklog + commit automation,
- documentation consistency after code changes.

The skills are designed to be portable between projects using the same stack.
Runtime rules required by skills live inside `.agents/skills/**` (not in project-specific `docs/` files).

## Local setup 

### Environment contract
Minimal `.env.local` / `.env.dist` variables used by this repository:
- `GH_TOKEN` (optional): token for GitHub CLI/MCP work.
- `BIN_PATH` (optional): wrapper prefix for project tools (proxy path).
- `CACHE_PATH` (optional): local agent cache/state directory.
- `CQRS_MONOLITH_STANDARD_OVERRIDES` (`0|1`): enables CQRS/monolith overrides.

Shell scripts in `.agents/skills/**/scripts` auto-load `.env` and `.env.local` through `.agents/skills/_shared/scripts/env-load.sh`.
This helper also exposes `resolve_tool_cmd` for deterministic entrypoint resolution.

### Tool entrypoints (proxy optional)
Proxy wrappers are optional.

`resolve_tool_cmd` (from `.agents/skills/_shared/scripts/env-load.sh`) is the single source of truth for tool entrypoints.
Always run preflight through this helper; do not build tool paths manually from `BIN_PATH` and do not use extra heuristics.

Recommended shell pattern:
```bash
source .agents/skills/_shared/scripts/env-load.sh
COMPOSER_CMD="$(resolve_tool_cmd composer composer)"
CONSOLE_CMD="$(resolve_tool_cmd console bin/console)"
YARN_CMD="$(resolve_tool_cmd yarn yarn)"
CODECEPT_CMD="$(resolve_tool_cmd codecept vendor/bin/codecept codecept)"
```

If a required command cannot be resolved by `resolve_tool_cmd`, treat it as blocker and ask user for the correct entrypoint.
`resolve_tool_cmd` lazy-loads `.env` and `.env.local` automatically.

`CACHE_PATH` is used by local cache scripts (auto-loaded from `.env`/`.env.local`; you can still override it with `export` in current shell session).

### Documentation path map contract (project `AGENTS.md`)
Skills that read/write project documentation use a path map from the **consumer project** `AGENTS.md`.

Use this block in project `AGENTS.md`:
```yaml
docs_map:
    MAIN_DOC: docs/README.md
    AGENT_RULES_DOC: docs/AGENTS.md
    QUALITY_PROCEDURES_DOC: docs/QUALITY-PROCEDURES.md
    MODULE_INDEX_DOC: docs/modules/README.md
    MODULE_DOCS_GLOB: docs/modules/*/README.md
    TESTS_README: docs/tests/README.md
    WORKLOG_DIR: docs/worklog
    HANDOFF_DOC: var/agent/HANDOFF.md
    SKILLS_INDEX_DOC: docs/SKILLS.md
```

Key semantics:
- `*_DOC`: single file path
- `*_DIR`: directory path
- `*_GLOB`: glob pattern for multiple files
- All paths are repo-relative.

Required vs optional keys in this skills set:
- Required by `context-refresh`: `MAIN_DOC`
- Required by `docs-sync`: `MAIN_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB`
- Required by `docs-todo`: `MAIN_DOC`, `MODULE_DOCS_GLOB`
- Required by `worklog-add`: `WORKLOG_DIR`
- Required by `handoff-refresh`: `HANDOFF_DOC`
- Required by `skills-index-refresh`: `SKILLS_INDEX_DOC`
- Required by `git-commit`: `WORKLOG_DIR`
- Optional in selected skills: `TESTS_README`, `HANDOFF_DOC`, `SKILLS_INDEX_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB`, `WORKLOG_DIR`

Important:
- You do not have to define every key globally.
- Define only keys needed by skills you actually use in the target project.
- Missing required key blocks only the currently invoked skill; it does not invalidate the whole skills set.

If a required key is missing, the skill should stop and ask for the missing path instead of guessing.

Note on configuration boundaries:
- `.env` keys (`BIN_PATH`, `CACHE_PATH`, etc.) are runtime/environment configuration.
- `docs_map` in `AGENTS.md` is repository structure/configuration.

### Deterministic QA matrix (`$qa-run`)
`$qa-run` uses repo-level matrix config in:
`.agents/qa-run.matrix.json`

If the file is missing, the runner creates a default skeleton automatically.
Commands are executed exactly as defined in this JSON (no command discovery/heuristics), with fail-fast on the first error.

### Optional architecture profile
Set `CQRS_MONOLITH_STANDARD_OVERRIDES=1` to activate additional CQRS/modular-monolith conventions from:
`.agents/skills/_shared/references/cqrs-monolith-standard-overrides.md`.

## Rules model (baseline vs override)
- Baseline standards (always on):
  - `.agents/skills/_shared/references/php-symfony-postgres-standards.md`
- Optional strict profile (only with env flag):
  - `.agents/skills/_shared/references/cqrs-monolith-standard-overrides.md`
- Runtime collaboration + quality procedure used by skills:
  - `.agents/skills/_shared/references/runtime-collaboration-guidelines.md`
  - `.agents/skills/_shared/references/runtime-quality-procedures.md`

`AGENTS.md` in repository root is reserved for rules specific to this repository as a skills catalog, not for runtime rules of consumer projects.
