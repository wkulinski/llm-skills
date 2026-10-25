# Troubleshooting

Start with the [first-use walkthrough](FIRST-USE.md) and your consumer's actual
configuration. Fix the named dependency at its owner; do not change application
code, relax trust boundaries or bypass a validator to obtain a green result.

| Symptom | Check / safe next action | Source of truth |
| --- | --- | --- |
| Skill not listed, or only the entrypoint directories exist | Check the delivered closure, shared files and skill discovery path. Use the full delivery, not a link to the author's checkout. Restart OpenCode. | [Delivery contract](INSTALLATION.md#delivery-and-ownership) |
| `Missing dependency: <path>` | Read the exact path in the error. For a source dependency, select a complete reviewed source; for a consumer file, configure that file explicitly. `verify` is static, not a configuration repair tool. | [Preflight](INSTALLATION.md#4-preflight-before-invoking-a-workflow) |
| `Unmanaged file conflict` | Compare and back up the local file; explicitly decide ownership. Never invent a receipt or use an overwrite/force workaround. | [Copy boundary](INSTALLATION.md#2-preview-compare-then-copy) |
| `Locally modified managed file` or symlink rejection | Keep the local edit safe. Review the candidate diff and restore a known snapshot if appropriate; do not delete the receipt or follow the symlink. | [Update and rollback](INSTALLATION.md#update-and-rollback) |
| Missing `docs_map` or `MAIN_DOC` | Add the real project document path to consumer `AGENTS.md`; create the document if this is a new project. Do not point it at the catalog's docs. | [Minimal map](CONFIGURATION.md#ownership-and-skill-paths), [context-refresh](../.agents/skills/context-refresh/SKILL.md) |
| Manifest cannot resolve Git HEAD/repository metadata | Start in the actual consumer root with an existing commit; a newly initialized, unborn repository cannot supply a HEAD fingerprint. Initial repository setup/commit needs a separate explicit decision. Report the real local/remote repository identity; do not invent a remote or claim a manifest passed. | [First-use prerequisites](FIRST-USE.md#before-you-start), [context-refresh](../.agents/skills/context-refresh/SKILL.md) |
| docs-sync/commit requests module docs or the index path | Configure the keys required by that workflow, not dummy global values. Missing optional data in one workflow need not block unrelated skills. | [Expanded map](CONFIGURATION.md#expand-docs_map-only-for-the-workflows-you-use) |
| `COMMIT_MESSAGE_DIR=/tmp/` looks inconsistent with relative paths | That key explicitly allows an absolute directory. Scout/cache input paths are a different contract and remain repo-local. | [Path semantics](CONFIGURATION.md#expand-docs_map-only-for-the-workflows-you-use) |
| Generic project unexpectedly gets PHP conventions | Check active env precedence and `SKILLS_STACK_PROFILE`. Shipping the PHP baseline does not activate it. Existing PHP projects should select the PHP profile before updating, not silently switch to generic. | [Project profiles](../.agents/skills/_shared/references/project-profiles.md) |
| Invalid stack profile or CQRS flag | Correct the explicit values/combination in active env. Do not interpret a nonzero exit as an acceptable fallback to generic. | [Profile errors](../.agents/skills/_shared/references/project-profiles.md) |
| `node`, an application tool or a wrapper cannot be resolved | In the consumer root, use `resolve_tool_cmd` and inspect its active `BIN_PATH`. Do not invent another wrapper path. Install/provide only the tools needed by the chosen task; PHP tools are not prerequisites for generic context loading. | [Tool configuration](CONFIGURATION.md#stack-profile-and-tool-entrypoints) |
| Context subagent absent, wrong model or stale permissions | Check the three delivered adapters and matching `agent` keys, locally available model IDs and reasoning settings. Restart the full OpenCode process after changes. | [Agent runtime](CONFIGURATION.md#opencode-agent-runtime-model--thinking) |
| MCP command fails or the scout cannot access CMM | Check the server executable, credentials and permissions in consumer config. A shell PATH may differ from the process launching OpenCode. Follow the canonical primary/fallback helper decision; never select fallback just to bypass missing setup. | [Runtime config](CONFIGURATION.md#opencode-agent-runtime-model--thinking), [hybrid policy](../.agents/skills/_shared/references/repository-context-hybrid.md) |
| Session model/reasoning variables are unset | Check that the session plugin was delivered and OpenCode restarted; inspect an agent shell call rather than `!`/PTY. If still unobservable, use only the owner's explicit-profile/one-WP attestation path. | [Session metadata](CONFIGURATION.md#session-model-environment), [plan-execute](../.agents/skills/plan-execute/SKILL.md) |
| Plan is not ready or current profile is insufficient | Inspect the validator result, real hierarchy and selected WP. Do not edit a checkbox or infer identity from session logs to bypass the gate. | [task-plan](../.agents/skills/task-plan/SKILL.md), [plan-execute](../.agents/skills/plan-execute/SKILL.md) |
| QA matrix is absent or names catalog npm commands in a different application | Author/validate the consumer matrix using that workflow. Do not run the catalog's tests as evidence for application QA. | [qa-run](../.agents/skills/qa-run/SKILL.md) |
| A rendered UI/PHP/runtime branch needs additional tools | Stop before entering an unconfigured specialist branch. Consult its declared stack/tools rather than adding all optional dependencies to the generic starter. | [Skills requirements](SKILLS.md#support-metrics) |

## What to include in a support report

Record the selected catalog revision or development payload hash, Linux/Node and
OpenCode versions, intended stack profile, selected skill, exact non-secret error
and the failed stage (delivery, configuration or skill execution). Include only
the relevant sanitized paths/output. Do not attach active env files, credentials,
raw session exports or unrelated application data. Installer implementation bugs
belong to the installer; catalog contract/instruction bugs belong here.
