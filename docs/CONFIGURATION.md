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
    CACHE_PATH: var/agent/cache/
```

`MAIN_DOC` must identify an existing document describing **your project**, not
this catalog's README. Ignore `var/agent/cache/` in your project's `.gitignore`;
context workflows write local state there.

The [skill structure contract](../.agents/skills/_shared/references/skill-structure-contract.md)
defines the path notation (`./`, `<skill_dir>`, `<skills_root>`), instruction
priority and `shared_files` semantics.

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
    CACHE_PATH: var/agent/cache/
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
| `CACHE_PATH` | Repository-local cache/state directory; default `var/agent/cache/` |

Other paths are repository-relative to the consumer root. A missing required key
blocks only the workflow that needs it; each `SKILL.md` lists its required keys.

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

`CACHE_PATH` in active env controls helper state; keep a nondefault location
consistent with the documentation map and ignored by Git. `OWC_PATH` is an
optional economics-report destination.

## OpenCode agent runtime (model + thinking)

The [delivered template](../distribution/linux-opencode/opencode.json.dist) is a
merge example, **not ready-to-run config**. In the consumer's `opencode.jsonc`:

- register `.agents/skills` under `skills.paths`;
- configure the three delivered roles under `agent`, using the adapter filename
  without `.md` as the key;
- choose available provider/model IDs and reasoning settings. Keep the primary
  `context-scout-fast` fast and the fallback `context-scout` stronger;
- use `variant` for ordinary role reasoning; the fast-role
  `options.thinking.type` setting in the template is provider-specific;
- allow the main agent to delegate the context roles and keep the scout
  adapters' read-only permissions.

Role definitions belong in `.opencode/agents/`; model/thinking overrides belong
in consumer config, not `.env` or the adapter Markdown.

Configure the required MCP servers (`codebase-memory`, `serena`, `context7`) with
your own commands, credentials and tool permissions. Local MCP commands are arrays
in OpenCode config; see the [OpenCode configuration documentation](https://opencode.ai/docs/config/).
GitHub authentication is needed only for GitHub workflows.

Restart the whole OpenCode process, including a running web/server process, after
config, adapter, skill or plugin changes; a new session in the old process does
not reload them.

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

## QA and further configuration

Author `.agents/qa-run.matrix.json` with your application's commands before
requesting QA or a commit; the catalog's own npm/Vitest matrix does not apply to
other projects. [qa-run](../.agents/skills/qa-run/SKILL.md) defines the schema and
execution; [git-commit](../.agents/skills/git-commit/SKILL.md) defines the commit
sequence.
