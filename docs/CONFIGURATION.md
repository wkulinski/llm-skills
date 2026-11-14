# Consumer configuration

Use this guide after [installing the delivery](INSTALLATION.md). Examples belong
in the **consumer project**: merge them with your existing rules, credentials,
provider settings and permissions instead of replacing them with catalog files.

## Ownership and skill paths

| Owner | Content |
| --- | --- |
| Catalog | Skill instructions, shared runtime rules and helper scripts, role adapters, session plugin, configuration templates |
| Consumer | `AGENTS.md`, documentation paths, active env, tool entrypoints, model hierarchy, QA matrix, OpenCode/MCP config and trust |

In your `AGENTS.md`, point the agent at the delivered path contract. A minimal
starting block is:

```md
## Skills
Use ./.agents/skills/_shared/references/skill-structure-contract.md for skill
path resolution and instruction priority. Follow the selected SKILL.md and
project rules. Runtime configuration comes from this project, not the catalog.

## Documentation paths
```

Append the following YAML as a fenced `yaml` block in the same `AGENTS.md`:

```yaml
docs_map:
    MAIN_DOC: README.md
    AGENT_RULES_DOC: AGENTS.md
```

`MAIN_DOC` must identify an existing document describing **your project**, not
this catalog's README. Ignore `var/agent/` in your project's `.gitignore`;
context windows write local state there, while plan and work state live under
`var/agent/task-plan/`, `var/agent/plan-execute/` and `var/agent/code-implement/`.

The [skill structure contract](../.agents/skills/_shared/references/skill-structure-contract.md)
defines the path notation (`./`, `<skill_dir>`, `<skills_root>`), instruction
priority and `shared_files` semantics.

When A supplies shared skills and B is the consumer, read **B's** `AGENTS.md`
and resolve its document paths from B, even if the session is open elsewhere.
B can be a main checkout or worktree outside A. Configure client discovery and
role registration for A's actual paths; no copy into B or parent/child directory
layout is required. See the [shared-installation example](INSTALLATION.md#shared-installation-and-private-project-data).

## Expand docs_map only for the workflows you use

For the starter's documentation/commit path, extend the same map:

```yaml
docs_map:
    MAIN_DOC: README.md
    AGENT_RULES_DOC: AGENTS.md
    MODULE_INDEX_DOC: docs/modules/README.md
    MODULE_DOCS_GLOB: docs/modules/*/README.md
    COMMIT_MESSAGE_DIR: /tmp/
    SKILLS_INDEX_DOC: docs/SKILLS.md
```

Create a module index (it may state that there are no modules yet). A missing
skills index is created by `$skills-index-refresh`.

| Key | Meaning and consumer |
| --- | --- |
| `MAIN_DOC` | Single project document; required by context-refresh and docs-sync |
| `AGENT_RULES_DOC` | Optional single rules document |
| `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB` | Module index and module README glob; required by docs-sync, which the commit path invokes |
| `COMMIT_MESSAGE_DIR` | Output directory for commit-message-write/git-commit; **an absolute directory such as `/tmp/` is allowed** |
| `SKILLS_INDEX_DOC` | Index destination required by skills-index-refresh |
| `HANDOFF_DOC` | Optional local handoff path; required by handoff-refresh |
| `TESTS_README`, `QUALITY_PROCEDURES_DOC` | Optional existing project documents |

Other paths are repository-relative to the consumer root. A missing required key
blocks only the workflow that needs it; each `SKILL.md` lists its required keys.

## Cache and durable state

`CACHE_PATH` is an **active env setting in B**, not a `docs_map` key. A legacy
entry in the map is ignored. Configure it in B's env files loaded through
`env-load.sh`; the [project-profile contract](../.agents/skills/_shared/references/project-profiles.md#resolve-before-work)
defines their precedence. An unset or empty project value defaults to B's
`var/agent/cache`. The resolver discards inherited `CACHE_PATH`, so another
process's absolute path does not select B's store.

Run `node <skills_root>/_shared/scripts/artifact-path.mjs cache-root` with B as
the actual working directory. `<CACHE_PATH>` in instructions means the absolute
result, not shell expansion of a possibly inherited variable. Keep it strictly
inside B, ignored by Git and separate from protected durable storage; existing
symlink and path-boundary checks still apply.

Durable state remains under B's `var/agent/task-plan/`, `var/agent/plan-execute/`
and `var/agent/code-implement/`, independently of cache configuration. These
directories must not point to A's or another environment's data. The process
creating an environment copies **configuration values**, then assigns its own
paths and resources; it must not inherit a pointer or symlink to another store.

## Stack profile and tool entrypoints

The default is the portable **generic** core. Select
`SKILLS_STACK_PROFILE=php-symfony-postgres` in active env for PHP/Symfony
projects. Activation, env precedence, failure conditions and the
[migration of existing PHP consumers](../.agents/skills/_shared/references/project-profiles.md#migrating-existing-consumers)
are defined in [project-profiles.md](../.agents/skills/_shared/references/project-profiles.md).

Keep application configuration in the consumer's active env. Do not copy the
catalog's `.env.dist` wholesale: its example `BIN_PATH` may name wrappers you do
not have. Without wrappers, leave `BIN_PATH` empty and use native tools. Tools
are resolved through `resolve_tool_cmd`; PHP tools, Playwright, AI Mate and
Phpactor/Rector are needed only by the skills that declare them.

Cache configuration belongs to [cache and durable state](#cache-and-durable-state).
Economics reports default to `<CACHE_PATH>/owc`; `OWC_PATH` is an optional
override, and explicit `--analysis-dir` takes precedence.

## OpenCode agent runtime (model + thinking)

The [delivered template](../distribution/linux-opencode/opencode.json.dist) is a
merge example, **not ready-to-run config**. In the consumer's `opencode.jsonc`:

- register the actual local or shared skills path under `skills.paths`;
- configure the two delivered roles under `agent`, using the adapter filename
  without `.md` as the key;
- choose available provider/model IDs and reasoning settings for the refresher
  and the single `context-scout`; there is no automatic fallback;
- use `variant` for role reasoning as supported by the provider;
- allow the main agent to delegate the context roles and keep the scout
  adapters' read-only code permissions. Each scout may write its complete JSON
  only to the exact attempt path supplied by the controller, through the native
  `write` or `apply_patch` tool exposed by its profile; read-only shell access is permitted only when file tools are unavailable,
  under the shared playbook boundaries.

Role definitions belong in `.opencode/agents/`; model/thinking overrides belong
in consumer config, not `.env` or the adapter Markdown.

Configure MCP servers with your own commands, credentials and tool permissions.
Codebase Memory and Serena are optional layers with a file fallback; Context7
and other services are needed only by workflows that use them. Local MCP commands are arrays
in OpenCode config; see the [OpenCode configuration documentation](https://opencode.ai/docs/config/).
GitHub authentication is needed only for GitHub workflows.

Restart the whole OpenCode process, including a running web/server process, after
config, adapter, skill or plugin changes; a new session in the old process does
not reload them.

### Private tool contexts

The environment creator owns each B's data directories, MCP configuration and
connection lifecycle. Share executables and skill instructions, while assigning
separate stores and runtime processes/endpoints to parallel environments. A
different project record in a shared database or one switchable active project
is not an independent context. These requirements do not require B under A.

For Codebase Memory, provide a private store (for the checked local binary,
`CBM_CACHE_DIR`), an allowed root covering B (`CBM_ALLOWED_ROOT`) and a dedicated
runtime for B. When sharing a wrapper anchored in A, explicitly configure B's
absolute resource paths rather than inheriting the wrapper's defaults. Preparing
and updating B's index belongs to the environment creator; scouts do not index
or repair the server. Pass its ready index names and preparation result through
the handoff's existing `constraints`, with store/runtime ownership. Without all
of these confirmations the scout uses files without querying that connection.

With confirmed readiness, `list_projects` verifies the name, `root_path` and
branch. It is not a readiness or isolation certificate, and a `status: ready`
field is not required. The live fixture used a local build identifying as `dev`:
explicit indexing returned `status: indexed`, and `list_projects` returned the
correct root and branch without `status`. The scout then used that index and
verified evidence directly in B. A missing matching ready index or another
branch requires file fallback and a concrete diagnostic in `risks`.

The checked scope establishes explicit preparation and lookup, not a guarantee
that a watcher will keep every later source edit or branch current. Validate
automatic refresh for the deployed version in the environment's preparation
mechanism; enabling a watcher alone is not proof of readiness. Local `dev`
observations must not be advertised as a guarantee for other builds.

For Serena, confirm private state and B's absolute active root before symbol
operations. The live fixture used separate `SERENA_HOME` directories and
processes, with the project bound at startup. Symbol lookup and editing worked
without an exposed `activate_project`; another environment stayed unchanged.
Startup binding is sufficient. Activate only on an owned connection that needs
and exposes it. With unconfirmed ownership, a wrong root or unavailable symbols,
use files; never switch another environment's active project. The
[symbolic-tool policy](../.agents/skills/_shared/references/symbolic-navigation-and-editing-policy.md#2a-preflight-sereny)
and [repository-context policy](../.agents/skills/_shared/references/repository-context.md)
remain the procedural owners.

### Session model environment

The delivered `.opencode/plugins/session-model-env.js` exposes the active profile
to **agent shell calls**:

| Variable | Meaning |
| --- | --- |
| `OPENCODE_SESSION_MODEL` | Runtime provider/model identifier |
| `OPENCODE_SESSION_VARIANT` | Exact reasoning variant; omitted for the neutral default |
| `OPENCODE_SESSION_AGENT` | Agent name for diagnostics |
| `OPENCODE_SESSION_ID` | Session ID for diagnostics |

Terminal `!`/PTY commands may not receive these values; inspect them in an agent
shell call.

Planning/execution also requires a consumer-owned
`.agents/config/model-hierarchy.json` with real model/reasoning pairs ordered
strongest first; start from the delivered `.dist` template. The
[plan-execute skill](../.agents/skills/plan-execute/SKILL.md) defines the model
gate, explicit-profile fallback and one-WP user attestation.

### External plan review

`$task-plan` can run its read-only plan review in a separate agent session
through the harness CLI directly, without Paseo. Configure it in B's active env (for example `.env.local`):

```bash
PLAN_REVIEW_1_HARNESS=claude
PLAN_REVIEW_1_MODEL=claude-sonnet-5-5
PLAN_REVIEW_1_THINKING=low
PLAN_REVIEW_1_MODE=auto

PLAN_REVIEW_2_HARNESS=codex
PLAN_REVIEW_2_MODEL=gpt-6.1-sol
PLAN_REVIEW_2_THINKING=medium
PLAN_REVIEW_2_MODE=auto-review

PLAN_REVIEW_3_HARNESS=opencode
PLAN_REVIEW_3_MODEL=commandcode/deepseek/deepseek-v4.1-flash
PLAN_REVIEW_3_THINKING=high
PLAN_REVIEW_3_MODE=build

PLAN_REVIEW_TIMEOUT_SECONDS=1200
```

`HARNESS` selects `claude` (Claude Code), `codex` (Codex CLI) or `opencode`
(OpenCode), resolved through `resolve_tool_cmd` in B. `MODEL` and `THINKING`
are native CLI identifiers (`--model` plus Claude `--effort`, Codex
`model_reasoning_effort`, or OpenCode `--variant`). `MODE` selects Claude's
permission mode, Codex's sandbox mapping, or OpenCode's built-in `build`/`plan` agent. See the
[mode mapping](../.agents/skills/_shared/references/review-session-contract.md#konfiguracja).
Codex `auto-review` maps to `workspace-write` with `approval_policy=never`;
it does not invoke Paseo's approval reviewer. OpenCode permissions come from
its configuration; the runner does not enable `--auto`. Direct execution requires
a POSIX runtime (use WSL on Windows). The reviewer CLI runs with the coordinator's environment: B's env files are
used only to resolve the executable (`BIN_PATH`), so application variables such
as API keys are not passed to it. The CLI must support these noninteractive
options; unsupported settings fail the profile instead of selecting defaults.
Model ids can differ between harnesses. Profiles are tried in preference order 1 → 2 → 3; empty
profiles are skipped silently. All four settings (`HARNESS`, `MODEL`, `THINKING`,
`MODE`) are required in each configured profile. Incomplete profiles are skipped
with a warning; other valid profiles remain available. The coordinator mentions
configuration warnings in its next progress update or final result without
pausing or asking for approval. Rejected model/mode identifiers at launch also
advance to the next profile with a brief notice. Replace the old `MAIN_*` and `FALLBACK_*` keys with
`1_*` and `2_*`; the old env names are no longer read. Without any profile, when configured CLIs are unavailable, or when every attempt fails, the plan owner performs the review itself as
before. The
[review-session contract](../.agents/skills/_shared/references/review-session-contract.md)
owns the attempt order and result checks. Failed profiles stay disabled for
subsequent rounds of the same planning cycle; changing a profile's settings
re-enables it. A valid report requesting repairs remains a successful review.
A new cycle after a terminal ready/blocked decision resets the ladder. This
memory belongs to the cycle's review jobs, not to global provider state.

## QA and further configuration

Author `.agents/qa-run.matrix.json` with your application's commands before
requesting QA or a commit; the catalog's own npm/Vitest matrix does not apply to
other projects. [qa-run](../.agents/skills/qa-run/SKILL.md) defines the schema and
execution; [git-commit](../.agents/skills/git-commit/SKILL.md) defines the commit
sequence.

To let workflows run a single test or a few checks instead of the whole matrix,
add named test runners to the matrix. A runner is never part of full QA; its
`tool` is resolved through `resolve_tool_cmd` and selectors are passed as
separate arguments:

```json
"targetedTests": {
    "codeception": {"tool": "composer", "args": ["--proxy-quiet", "test", "--"], "parser": "codeception-junit"}
}
```

A `point` or `partial` run reads a selection file stored under `CACHE_PATH`; its
result is never a full QA gate:

```bash
node <skills_root>/qa-run/scripts/run-matrix.mjs --scope point --selection <CACHE_PATH>/qa-selection.json
```

The selection format, ordering and session rules are owned by
[qa-run](../.agents/skills/qa-run/SKILL.md); when to run which check is owned by
[runtime guidelines §5](../.agents/skills/_shared/references/runtime-collaboration-guidelines.md#5-qa-command-policy-single-source-of-truth).
