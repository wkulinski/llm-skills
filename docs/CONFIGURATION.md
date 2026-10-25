# Consumer configuration

Use this guide after [installing the delivery](INSTALLATION.md), before the
[first-use walkthrough](FIRST-USE.md). Examples belong in the **consumer project**,
not this catalog. Compare and merge; never replace existing rules, credentials,
provider settings or permissions with catalog files.

## Ownership and skill paths

| Owner | Content |
| --- | --- |
| Catalog | Skill instructions, shared runtime rules and helper scripts, role adapters, session plugin, configuration templates |
| Consumer | `AGENTS.md`, documentation paths, active env, tool entrypoints, model hierarchy, QA matrix, OpenCode/MCP config and trust |
| Installer | Correctly delivering the catalog's required file set while respecting the consumer boundary |

In your `AGENTS.md`, point the agent at the delivered path contract instead of
copying its rules into a second document. A minimal starting block is:

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
    CACHE_PATH: var/agent/cache/
```

`MAIN_DOC` must identify an existing document describing **your application or
project**, not this catalog's README. The example assumes the consumer already
has a root `README.md`. Use its real path if different. Ignore `var/agent/cache/`
in your project's `.gitignore`; context workflows write local state there.

The skill path contract distinguishes the project root (`./`), the selected
skill's own directory (`<skill_dir>`) and the delivered catalog (`<skills_root>`).
The [canonical contract](../.agents/skills/_shared/references/skill-structure-contract.md)
owns the exact notation, instruction priority and `shared_files` semantics.
`shared_files` describes availability; it is not an instruction to load every
reference into every session.

## Expand docs_map only for the workflows you use

For the starter's documentation/commit path, extend the same map; do not add a
second conflicting block:

```yaml
docs_map:
    MAIN_DOC: README.md
    AGENT_RULES_DOC: AGENTS.md
    MODULE_INDEX_DOC: docs/modules/README.md
    MODULE_DOCS_GLOB: docs/modules/*/README.md
    COMMIT_MESSAGE_DIR: /tmp/
    SKILLS_INDEX_DOC: docs/SKILLS.md
    CACHE_PATH: var/agent/cache/
```

These are example destinations, not documents delivered into your application.
Create an appropriate module index (even if it explains that there are no module
entries yet). Populate module documents when they apply. A new skills index may
be created at its mapped destination by its owning workflow.

| Key | Meaning and consumer |
| --- | --- |
| `MAIN_DOC` | Single project document; required by context-refresh and docs-sync |
| `AGENT_RULES_DOC` | Optional single rules document; use your real rules file |
| `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB` | Module index and module README glob; required by docs-sync, which the commit path invokes |
| `COMMIT_MESSAGE_DIR` | Output directory for commit-message-write/git-commit; **an absolute directory such as `/tmp/` is allowed** |
| `SKILLS_INDEX_DOC` | Index destination required by skills-index-refresh |
| `HANDOFF_DOC` | Optional local handoff path; required if invoking handoff-refresh |
| `TESTS_README`, `QUALITY_PROCEDURES_DOC` | Optional existing project documents, not alternate owners of skill procedures |
| `CACHE_PATH` | Repository-local cache/state directory; default `var/agent/cache/` |

Unless a key explicitly permits otherwise, use repository-relative paths, with
the consumer root as their base. `*_DOC` keys denote files, `*_DIR` denotes a
directory, and `MODULE_DOCS_GLOB` denotes a glob. The absolute
`COMMIT_MESSAGE_DIR` exception does **not** allow scout inputs outside the repo:
the [hybrid context contract](../.agents/skills/_shared/references/repository-context-hybrid.md)
requires repository-local cache inputs.

Missing required keys block only the workflow that needs them. Check its
`SKILL.md` for the authoritative current requirements; do not add every optional
key just to make a global checklist green.

## Stack profile and tool entrypoints

The default is the portable **generic** core. It does not apply PHP/Symfony/CQRS
standards or require PHP application tools just because those files are shipped.
For an existing PHP consumer, select `SKILLS_STACK_PROFILE=php-symfony-postgres`
in active env **before updating**, preserving its CQRS flag. The exact activation,
env precedence, failure conditions and migration are owned by
[project-profiles.md](../.agents/skills/_shared/references/project-profiles.md).

Keep application configuration in the consumer's active env. Do not copy the
catalog's `.env.dist` wholesale: its example `BIN_PATH` may name wrappers you do
not have. For a generic project without wrappers, use native tools (leave
`BIN_PATH` unset or empty). Resolve required tools through the existing
`resolve_tool_cmd` helper, not guessed wrapper paths. PHP tools, Playwright,
AI Mate and Phpactor/Rector are conditional on the selected task/branch; see
[the catalog](SKILLS.md) before entering one.

`CACHE_PATH` in active env controls helper state. If you use a nondefault cache
location, keep the documentation map consistent and the directory ignored.
`OWC_PATH` is an optional persistent economics-report destination, not a starter
requirement. Tokens and credentials stay in consumer-controlled env/provider
storage, never in a copied template or committed documentation.

## OpenCode agent runtime (model + thinking)

The [delivered template](../distribution/linux-opencode/opencode.json.dist) is a
merge example, **not ready-to-run config**. In the consumer's `opencode.jsonc`:

- register `.agents/skills` under `skills.paths`;
- configure the three delivered roles under `agent`, using the adapter filename
  without `.md` as the key;
- choose available provider/model IDs and exact reasoning settings. Keep the
  primary `context-scout-fast` fast and the fallback `context-scout` stronger;
- use `variant` for ordinary role reasoning; the illustrated fast-role
  `options.thinking.type` setting is provider-specific, not universal;
- allow the main agent to delegate the context roles according to your trust
  policy. Preserve the scout adapters' read-only permissions.

Role definitions belong in `.opencode/agents/`; model/thinking overrides belong
in consumer config, not `.env` or the adapter Markdown. Implementation, UI and
diagnostics execute through their skills, not additional mandatory subagents.
The canonical repository-context policy still owns primary/fallback routing.

Configure required MCP servers (`codebase-memory`, `serena`, `context7`) with
your own installed commands, credentials and tool permissions. Local MCP
commands are arrays in OpenCode config; do not copy this catalog's machine-local
codebase-memory wrapper. Use the
[OpenCode configuration documentation](https://opencode.ai/docs/config/) for the
installed version. GitHub authentication is needed only for GitHub work.

Restart OpenCode, including a running web/server process, after config, adapter,
skill or plugin changes. A new session in the old process is not a reload.
The [installation preflight](INSTALLATION.md#4-preflight-before-invoking-a-workflow)
lists role/MCP checks; [troubleshooting](TROUBLESHOOTING.md) maps common failures
to their owners.

### Session model environment

The delivered `.opencode/plugins/session-model-env.js` uses the project plugin
loader to expose the active profile to **agent shell calls**:

| Variable | Meaning |
| --- | --- |
| `OPENCODE_SESSION_MODEL` | Runtime provider/model identifier |
| `OPENCODE_SESSION_VARIANT` | Exact reasoning variant, when observable |
| `OPENCODE_SESSION_AGENT` | Agent name for diagnostics |
| `OPENCODE_SESSION_ID` | Session ID for diagnostics |

The lookup is best-effort: absent metadata must not break a shell command. A
neutral/default variant may be omitted. Older OpenCode terminal `!`/PTY commands
may not provide the session context, so inspect the values in an agent shell
call rather than using PTY output as proof of failure.

The plugin is not a model gate. Planning/execution also requires a consumer-owned
`.agents/config/model-hierarchy.json`, with real model/reasoning pairs ordered
strongest first. Compare the delivered `.dist` template before creating it.
The [plan-execute skill](../.agents/skills/plan-execute/SKILL.md) owns comparison,
explicit-profile fallback and one-WP user attestation. Missing metadata is not
permission to guess the model from logs or bypass that gate.

## QA and further configuration

Author `.agents/qa-run.matrix.json` for your application's commands before
requesting QA or a commit. The catalog's npm/Vitest matrix is not a generic
application matrix. [qa-run](../.agents/skills/qa-run/SKILL.md) owns the schema,
validation and execution; [git-commit](../.agents/skills/git-commit/SKILL.md) owns
the commit sequence. These are later, explicitly requested workflows, not part
of the first safe context result.

Claude Code/Codex configuration files are not interchangeable with OpenCode's.
Target-specific skill projection belongs to the installer. This walkthrough
does not enable those targets or promise their runtime support.
