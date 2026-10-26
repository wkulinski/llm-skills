# Troubleshooting

Fix the named dependency at its owner (delivery, consumer configuration or the
skill) rather than working around a validator.

| Symptom | Check / next action | Source of truth |
| --- | --- | --- |
| Skill not listed, or only the entrypoint directories exist | Check the delivered closure, shared files and skill discovery path; deliver the full set, then restart OpenCode. | [Delivery contract](INSTALLATION.md#delivery-and-ownership) |
| `Missing dependency: <path>` | Read the exact path in the error. For a source dependency, select a complete source revision; for a consumer file, create or configure that file. | [Preflight](INSTALLATION.md#4-preflight-before-invoking-a-workflow) |
| `Unmanaged file conflict` | Compare and back up the local file, then decide its ownership explicitly. | [Copy boundary](INSTALLATION.md#2-preview-compare-then-copy) |
| `Locally modified managed file` or symlink rejection | Review the candidate diff and keep or restore the local edit from your snapshot. | [Update and rollback](INSTALLATION.md#update-and-rollback) |
| Missing `docs_map` or `MAIN_DOC` | Add the real project document path to consumer `AGENTS.md`; create the document in a new project. | [Minimal map](CONFIGURATION.md#ownership-and-skill-paths), [context-refresh](../.agents/skills/context-refresh/SKILL.md) |
| Manifest cannot resolve Git HEAD | Run from the consumer root of a repository with at least one commit; an unborn repository has no HEAD fingerprint. | [First-use prerequisites](FIRST-USE.md#before-you-start) |
| docs-sync/commit asks for module docs or the index path | Configure the keys required by that workflow. | [Expanded map](CONFIGURATION.md#expand-docs_map-only-for-the-workflows-you-use) |
| Generic project gets PHP conventions | Check active env precedence and `SKILLS_STACK_PROFILE`. | [Project profiles](../.agents/skills/_shared/references/project-profiles.md) |
| Invalid stack profile or CQRS flag | Correct the values or their combination in active env; the workflow stops until then. | [Project profiles](../.agents/skills/_shared/references/project-profiles.md) |
| `node`, an application tool or a wrapper cannot be resolved | In the consumer root, use `resolve_tool_cmd` and inspect the active `BIN_PATH`. | [Tool configuration](CONFIGURATION.md#stack-profile-and-tool-entrypoints) |
| Context subagent absent, wrong model or stale permissions | Check the three delivered adapters, matching `agent` keys, model IDs and reasoning settings; restart the whole OpenCode process. | [Agent runtime](CONFIGURATION.md#opencode-agent-runtime-model--thinking) |
| MCP command fails or the scout cannot access CMM | Check the server executable, credentials and permissions in consumer config; the PATH of the process launching OpenCode may differ from your shell. | [Runtime config](CONFIGURATION.md#opencode-agent-runtime-model--thinking), [hybrid policy](../.agents/skills/_shared/references/repository-context-hybrid.md) |
| Session model/reasoning variables are unset | Check that the session plugin was delivered and OpenCode restarted; inspect the values in an agent shell call, not `!`/PTY. Otherwise use the explicit-profile or one-WP attestation path. | [Session metadata](CONFIGURATION.md#session-model-environment), [plan-execute](../.agents/skills/plan-execute/SKILL.md) |
| Plan is not ready or current profile is insufficient | Inspect the validator result, the model hierarchy and the selected WP. | [task-plan](../.agents/skills/task-plan/SKILL.md), [plan-execute](../.agents/skills/plan-execute/SKILL.md) |
| QA matrix is absent or names the catalog's npm commands | Author the consumer matrix for your application. | [qa-run](../.agents/skills/qa-run/SKILL.md) |
| A UI/PHP/runtime branch needs additional tools | Install the tools declared by that skill before using the branch. | [Starter set](SKILLS.md#starter-set-and-dependency-closure) |

## What to include in a support report

The catalog revision, Linux/Node and OpenCode versions, stack profile, selected
skill, the exact error and the failed stage (delivery, configuration or skill
execution). Attach only sanitized output, never env files or credentials.
Installer bugs belong to the installer; contract/instruction bugs belong here.
