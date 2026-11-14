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
| Context subagent absent, wrong model or stale permissions | Check the two delivered adapters, matching `agent` keys, model IDs and reasoning settings; restart the whole OpenCode process. | [Agent runtime](CONFIGURATION.md#opencode-agent-runtime-model--thinking) |
| MCP command fails or the scout cannot access CMM | Check the server executable, credentials and permissions in consumer config; the PATH of the process launching OpenCode may differ from your shell. | [Runtime config](CONFIGURATION.md#opencode-agent-runtime-model--thinking), [repository-context policy](../.agents/skills/_shared/references/repository-context.md) |
| Session model/reasoning variables are unset | Check that the session plugin was delivered and OpenCode restarted; inspect the values in an agent shell call, not `!`/PTY. Otherwise use the explicit-profile or one-WP attestation path. | [Session metadata](CONFIGURATION.md#session-model-environment), [plan-execute](../.agents/skills/plan-execute/SKILL.md) |
| Plan is not ready or current profile is insufficient | Inspect the validator result, the model hierarchy and the selected WP. | [task-plan](../.agents/skills/task-plan/SKILL.md), [plan-execute](../.agents/skills/plan-execute/SKILL.md) |
| QA matrix is absent or names the catalog's npm commands | Author the consumer matrix for your application. | [qa-run](../.agents/skills/qa-run/SKILL.md) |
| A UI/PHP/runtime branch needs additional tools | Install the tools declared by that skill before using the branch. | [Starter set](SKILLS.md#starter-set-and-dependency-closure) |
| Manifest shows another branch/root, or a PHP wrapper targets A instead of B | Run the absolute helper from A with actual cwd inside B; Git selects B's own root, including worktrees. Check B's env/tool configuration. | [Shared installation](INSTALLATION.md#shared-installation-and-private-project-data) |
| `MODULE_NOT_FOUND` for a helper absent from a worktree | Resolve the helper from installation A instead of assuming `.agents/skills` exists in B. | [Shared path contract](../.agents/skills/_shared/references/skill-structure-contract.md) |
| Cache/ledger is rejected as outside `CACHE_PATH` | Run `cache-root` in B and use that result for B's inputs/output. Check B's active env; a legacy `docs_map` entry and inherited process value do not configure B. Preserve the validator boundary. | [Cache ownership](CONFIGURATION.md#cache-and-durable-state) |
| `external_directory` denies A's playbook or B's attempt file | Inspect the literal denial and consumer permissions for the required operations, then restart the client after changes. B need not be nested under A. | [Runtime configuration](CONFIGURATION.md#opencode-agent-runtime-model--thinking) |
| Scout acknowledges success but no valid report exists | Check the exact attempt `.scout.json` and controller failure class. The scout's native writer must be available; the controller builds and validates in B. An acknowledgement cannot replace the file. | [Report protocol](../.agents/skills/_shared/references/context-scout-report-protocol.md) |
| `REPORT_INVALID` after a scout file was written | Use the validator diagnostic to check literal anchors, field types and coverage. Keep tool-fallback diagnostics in `risks`; do not weaken validation or silently fix a model's artifact. | [Scout contract](../.agents/skills/_shared/references/context-subagent-contract.md#raport-scouta) |
| CMM lacks `status`, has another branch, or has no confirmed private store/runtime/readiness | `status` is not required. Match the prepared ready index's root/branch only after ownership and readiness were confirmed; otherwise use files and report the reason. Do not query an unconfirmed connection or index from a scout. | [Private tool contexts](CONFIGURATION.md#private-tool-contexts) |
| Serena has no `activate_project`, or shows an unexpected root | A private startup-bound B connection is valid without activation. Confirm its root; use files on a foreign/unconfirmed connection instead of switching it. | [Serena preflight](../.agents/skills/_shared/references/symbolic-navigation-and-editing-policy.md#2a-preflight-sereny) |
| Provider quota or unavailable model blocks native `task` | Record the provider error and missing live verification, terminate retries and settle/abort through the controller. Change the test profile only with an explicit decision; static permissions are not a positive live test. | [Scout lifecycle](../.agents/skills/_shared/references/repository-context.md#lifecycle) |

Consumer synchronization is a separate rollout. Resume affected consumer work,
including Collecta #627, after its own installation/configuration is updated
and verified; the upstream change does not perform that synchronization.

## What to include in a support report

### Context scout tests stop at a subprocess

The scout CLI tests use a [bounded subprocess helper](../tests/helpers/bounded-spawn-sync.mjs).
It reports launch/pipe errors such as `EPERM` immediately and kills a blocked
child after 10 seconds. Vitest's test timeout cannot interrupt `spawnSync`
because the worker's event loop is blocked during that call.

A sandbox can break subprocess pipe transport even for a minimal Node child.
Compare a minimal stdin roundtrip inside and outside the sandbox before
attributing the failure to the report builder. A passing run outside the
sandbox does not identify the particular sandbox rule responsible for it.

The default QA execution environment is owned by
[QA Command Policy](../.agents/skills/_shared/references/runtime-collaboration-guidelines.md#5-qa-command-policy-single-source-of-truth).
Launchers can override the user's Codex configuration: Paseo's `auto-review`
mode explicitly selects `workspace-write`, while its `full-access` mode selects
`danger-full-access`. Check the active session mode when it differs from
`~/.codex/config.toml`.

### Runtime subprocess capture in restricted sandboxes

Runtime scripts use the shared [synchronous capture helper](../.agents/skills/_shared/scripts/file-process.mjs)
and [asynchronous capture helper](../.agents/skills/_shared/scripts/file-process-async.mjs).
Captured stdin/stdout/stderr use private regular files instead of Node's
socket-based pipes. Files are removed after completion or launch failure;
explicit `inherit`, `ignore` and numeric descriptors keep their meaning.
Asynchronous commands expose live stdout/stderr streams and keep process events
and `kill()`, so QA and benchmark logs remain available while commands run.
Interactive stdin and IPC channels are outside these helpers' runtime contract.

The audit covered every JavaScript/module and shell script under
`.agents/skills`, including benchmark runners:

| Area | Capture paths covered |
| --- | --- |
| Context and planning | Manifest/fingerprint Git calls, scout preflight/build/validation, plan publication, cache resolver, external review runner |
| Git and GitHub | Issue branch/start/status/review, commit snapshots and staging checks |
| Implement/review | Change inspection and Claude review Git snapshots |
| QA and browser tools | Working-tree inspection, tool resolution, command output streaming, auth helpers |
| PHP tooling and Slack | CLI resolution, status probes, RPC stdin, structured tool output |
| Economics benchmarks | Git snapshots, validators, CLI workers and managed-server logs |

Direct Node child-process imports remain only in the two runtime helpers and
in test code. Shell pipelines use OS pipes and do not use Node's synchronous
socket transport. Test subprocesses still use their bounded test helper; run
QA with the permissions required by the execution policy above.

The synchronous helper checks `maxBuffer` after the child exits and limits the
returned capture in memory; it does not stop a running child when its temporary
output file reaches that size. Keep command-specific timeouts for bounded
execution. The asynchronous `execFile` wrapper checks its capture limit while
collecting output and terminates an overflowing child.

This change fixes transport, not command permissions, network access, scout
reader availability or malformed scout JSON. Consumer installations must be
synchronized separately. The regression checks include regular-file stdin and
outputs, binary payloads, cleanup, missing commands, timeout, live logs,
termination, nonzero exits and capture overflow.


The catalog revision, Linux/Node and OpenCode versions, stack profile, selected
skill, the exact error and the failed stage (delivery, configuration or skill
execution). Attach only sanitized output, never env files or credentials.
Installer bugs belong to the installer; contract/instruction bugs belong here.
