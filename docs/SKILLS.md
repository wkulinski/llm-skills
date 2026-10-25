# Skills Index

Main workflow routing is defined in
[`skill-routing-policy.md`](../.agents/skills/_shared/references/skill-routing-policy.md).
Use the trigger table to choose by intent, then check the support metrics and
starter dependencies before installing. The alphabetical skill list is at the end.

## Trigger table

### Planning

| Intent | Skill | Next step |
| --- | --- | --- |
| Prepare an execution plan from an issue, file or description | `$task-plan` | critical assessment, then plan validation |
| Add a requirement, correct scope or request a write while planning | `$task-plan` | revise and review the plan, without implementing repository changes |
| Execute or resume an existing plan or WP | `$plan-execute` | pass the selected WP to `$code-implement` |

### Implementation

| Intent | Skill | Next step |
| --- | --- | --- |
| Implement a feature, bugfix or refactor without an existing plan | `$code-implement` | implementation, evidence and lightweight verification |
| Perform structural PHP operations: move/copy/rename, class or AST transformations | `$php-structure-refactor` | refactor through Phpactor or Rector |
| Create or assess views and UI elements using existing patterns | `$frontend-ui-consistency` | consistent UI and Playwright CLI verification |

### Code and plan review

| Intent | Skill | Next step |
| --- | --- | --- |
| Review code/current changes or perform a separate read-only plan review | `$code-review` | findings first, coverage and verdict before merge or plan execution |
| Quickly check an increment during implementation or explicitly request a quick-check | `$review-quick` | findings-first report without a formal verdict |
| Delegate read-only code review from OpenCode to Claude Code (Opus) through Paseo | `$claude-review` | reviewer report assessed by the `$code-review` gate |

### Instruction review

| Intent | Skill | Next step |
| --- | --- | --- |
| Audit a skill, local rules, agent or whole catalog against the authoring standard | `$skill-review` | findings or standard gaps with evidence, without editing files |
| Align local rules and remove duplicates of the `_shared` baseline | `$rules-sync` | synchronized rules with explicitly reported overrides |

### QA and commit

| Intent | Skill | Next step |
| --- | --- | --- |
| Run deterministic matrix QA: linters, tests and review | `$qa-run` | QA report and session ledger |
| Commit changes using the repository workflow | `$git-commit` | full testing, validation and commit procedure |
| Prepare only the commit message | `$commit-message-write` | write `COMMIT_MESSAGE_DIR/commit-message.txt` |

### Documentation

| Intent | Skill | Next step |
| --- | --- | --- |
| Reconcile documentation after substantial changes | `$docs-sync` | consolidated duplicates and consistent references |
| List open TODO items from documentation | `$docs-todo` | task list without implementation |
| Update the module atlas | `$module-atlas-sync` | current map of module roles, entrypoints, relationships and APIs |
| Refresh the skills index: list and trigger table | `$skills-index-refresh` | `SKILLS_INDEX_DOC` aligned with the catalog |

### Issue handling

| Intent | Skill | Next step |
| --- | --- | --- |
| Start work on an issue | `$gh-issue-start` | branch, In progress status and assignee |
| Send an issue for review | `$gh-issue-review` | push, PR, In review status and optional reviewer |
| Set an issue status in GitHub Projects v2 | `$gh-issue-status-set` | update status using a branch or issue number |

### Diagnostics

| Intent | Skill | Next step |
| --- | --- | --- |
| Diagnose runtime, logs, profiler or the DI container | `$dev-mate` | structured AI Mate evidence before deciding |
| Analyze costs and duplicated work in OpenCode sessions | `$opencode-workflow-economics` | subagent and fallback economics report |
| Load or refresh project context | `$context-refresh` | context manifest and repository state |
| Hand context over to another agent | `$handoff-refresh` | state snapshot for the next session |
| Clear the local agent cache | `$agent-cache-clear` | remove state from `CACHE_PATH` |

### Communication

| Intent | Skill | Next step |
| --- | --- | --- |
| Read a Slack channel/thread or explicitly send, edit or delete your own message | `$slack` | bounded Slack CLI operation with consumer-project configuration |

## Support metrics

These are **declared requirements and effects**, not guarantees. Status meanings
come from the [support contract](../README.md#supported-environment-and-verification-status).
Every entry is **Unverified**: no OpenCode consumer run has been recorded yet.
Deterministic source tests alone do not promote an entry to Verified. OpenCode on
Linux is the release target; Claude Code, Codex and other operating systems
remain unverified. Installer correctness is the installer's responsibility, not
a skill support metric. A file-readable instruction is not proof that a
harness can execute its tools or delegation protocol.

Before invoking a workflow, read [Security and trust boundaries](../SECURITY.md).
Effect rows are not permission grants or technical isolation: read-only prompts,
snapshot-change detection and command-enforced guards have different limits.
In particular, delegated Claude review has no additional sandbox; external-write
credentials can have broader privileges than the helper's target checks.

The four requirement axes are independent:

- **Stack:** `Neutral` means no application framework is prescribed by this
  workflow, not universal support. `Profile-selected` uses the shared
  [project-profile contract](../.agents/skills/_shared/references/project-profiles.md).
  PHP, Symfony UI and Symfony runtime rows remain stack-specific.
- **Agent environment:** `File tools` requires repository read/write tools as
  appropriate; `CLI tools` also requires command execution. `Hybrid` additionally
  needs native task delegation, primary/fallback scout adapters and CMM for the
  primary, as defined by the [hybrid contract](../.agents/skills/_shared/references/repository-context-hybrid.md).
  These describe capabilities, not verified harness support.
- **Tools/config:** only additional requirements are listed; follow each
  [skill's instructions](../.agents/skills) and its `docs_map` requirements before
  use. Commands are resolved using the existing tool-entrypoint contract. A
  selected stack does not by itself require every tool in that stack.
- **Architecture:** `Profile-selected` activates only the explicitly selected
  baseline/override; `Not prescribed` does not impose CQRS or another application
  architecture. A Symfony runtime dependency is not a CQRS dependency.

In the dependency column, **M** means a required skill call and **C** a conditional
branch (install it before using that branch); **—** means no additional skill call
is required by the inspected workflow. References that only name another owner
or recommend a next action are not mandatory calls. Source: the current
`.agents/skills/<name>/SKILL.md`, its routed references and declared `shared_files`.
Read-only rows may still write local cache/report artifacts; they do not edit the
reviewed code or publish external changes.

| Skill | Stack | Agent environment | Tools/config | Architecture | Effects and limits | Support / evidence | Skill dependencies |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `$agent-cache-clear` | Neutral | CLI tools | Git, Node; `CACHE_PATH` | Not prescribed | Deletes cache contents, including resumable state; explicit request or successful commit only | Unverified — consumer run pending | — |
| `$claude-review` | Profile-selected via reviewer | OpenCode coordinator → Claude Code | Git, Bash, Node, Paseo CLI/daemon; trusted workspace, claude.ai login, explicit Opus/thinking/timeout | Profile-selected via reviewer | Starts a cost-bearing review session; read-only is a prompt boundary, not a sandbox; snapshot changes invalidate report | Unverified — consumer run pending | M: `$code-review` |
| `$code-implement` | Profile-selected | CLI tools + Hybrid when discovery is needed | Git, Bash, Node; task-specific tool entrypoints, context manifest | Profile-selected | Edits code/docs and local state; focused verification; no implicit full QA or commit | Unverified — consumer run pending | M: `$review-quick`; C: `$context-refresh`, `$dev-mate`, `$frontend-ui-consistency`, `$php-structure-refactor` |
| `$code-review` | Profile-selected | CLI tools + Hybrid when discovery is needed | Git, Bash, Node; scoped verification tools; plan helpers for plan target | Profile-selected | Read-only code/plan assessment; local reports/check artifacts; no automatic fixes | Unverified — consumer run pending | C: `$task-plan` contract for plan target |
| `$commit-message-write` | Profile-selected | CLI tools | Git, Bash, Node; `COMMIT_MESSAGE_DIR` | Profile-selected | Writes message file; no staging or commit | Unverified — consumer run pending | — |
| `$context-refresh` | Profile-selected | CLI tools; main agent or explicit refresher role | Git, Bash, Node; `MAIN_DOC`, optional mapped docs | Profile-selected | Reads repo/docs/env, writes context manifest and inventory; never exports secrets | Unverified — consumer run pending | C: `$dev-mate` for runtime diagnostics |
| `$dev-mate` | PHP/Symfony runtime | CLI tools | AI Mate `mate` entrypoint and reachable app; direct Mate MCP only if a required resource is CLI-inaccessible | Not prescribed | Bounded log/profiler/DI inspection; sensitive runtime data, not an implementation workflow | Unverified — consumer run pending | — |
| `$docs-sync` | Profile-selected | File tools + repository commands | Git, Bash; `MAIN_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB`; optional rule/test docs | Profile-selected | Edits docs and, when reconciling procedural drift, skill instructions; no application implementation | Unverified — consumer run pending | C: `$skills-index-refresh` for stale skill index |
| `$docs-todo` | Neutral | File tools | `MAIN_DOC`, `MODULE_DOCS_GLOB` | Not prescribed | Reads and lists TODOs; no implementation | Unverified — consumer run pending | — |
| `$frontend-ui-consistency` | Twig, Symfony UX Live Components, Stimulus, CSS/SCSS | CLI tools + image reading | Bash, Node, Git, Playwright CLI/browser; explicit app URL and auth setup where needed | Not prescribed | UI consultation/audit/edits and rendered checks; no unrequested redesign or production browser profile | Unverified — consumer run pending | — |
| `$gh-issue-review` | Neutral | CLI tools | Git, Node, authenticated `gh`; repository and Projects v2 permissions | Not prescribed | Fetch/rebase/push (helper specifies force), PR/reviewer updates, then project status; inspect risk before running | Unverified — consumer run pending | M: `$gh-issue-status-set` |
| `$gh-issue-start` | Neutral | CLI tools | Git, Node, authenticated `gh`; repository and Projects v2 permissions | Not prescribed | Fetch, branch creation/checkout, issue/assignee changes; dirty-tree strategy requires a decision | Unverified — consumer run pending | M: `$gh-issue-status-set`; C: `$task-plan` only after explicit planning consent |
| `$gh-issue-status-set` | Neutral | CLI tools | Git, Node, authenticated `gh`, Projects v2 field/status; issue-search MCP for documented fallback | Not prescribed | Changes issue project membership/status; asks for ambiguous identifiers | Unverified — consumer run pending | — |
| `$git-commit` | Profile-selected | CLI tools; transitive Hybrid capability | Git, Bash, Node; QA matrix, project checks, `COMMIT_MESSAGE_DIR`, mapped docs | Profile-selected | QA may fix files; updates docs/index, stages and commits, removes handoff/snapshot/cache; explicit commit intent required | Unverified — consumer run pending | M: `$qa-run`, `$commit-message-write`, `$agent-cache-clear`; C: `$docs-sync`, `$skills-index-refresh` when their `docs_map` keys are set |
| `$handoff-refresh` | Neutral | File tools | `HANDOFF_DOC` | Not prescribed | Writes local ignored handoff; does not commit it | Unverified — consumer run pending | — |
| `$module-atlas-sync` | Neutral; documented module layout | File tools + repository navigation | `MAIN_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB` | Not prescribed | Edits module atlas and reports broken/stale references | Unverified — consumer run pending | — |
| `$opencode-workflow-economics` | Neutral | OpenCode history access + CLI tools | Node, OpenCode server/CLI, pricing configuration | Not prescribed | Reads session history, may start/stop a temporary local server, writes reports that may contain prompts; no workflow/config changes | Unverified — consumer run pending | — |
| `$php-structure-refactor` | PHP | CLI tools; symbolic navigation preferred | Node, PHP, Phpactor or Rector; php-cs-fixer when formatting is needed | Not prescribed | Structural/AST edits and dry runs; not a QA replacement | Unverified — consumer run pending | C: `$dev-mate` for runtime diagnosis |
| `$plan-execute` | Profile-selected via executor | CLI tools; transitive Hybrid capability | Git, Node, model hierarchy; observable session profile or explicit attestation; network only for external profile ranking | Profile-selected via executor | Selects one WP, invokes executor and atomically records verified completion; local plan pointer | Unverified — consumer run pending | M: `$task-plan`, `$code-implement` |
| `$qa-run` | Profile-selected checks | CLI tools | Git, Bash, Node; `.agents/qa-run.matrix.json` and its configured commands | Profile-selected for review | Runs matrix commands and quick review; repair mode may edit files; reports/snapshots/session ledger; no commit | Unverified — consumer run pending | M: `$review-quick` |
| `$review-quick` | Profile-selected | CLI tools | Git, Bash; scoped check tools; Node/Playwright only for a rendered checkpoint | Profile-selected | In-agent read-only checkpoint, not a merge verdict or full QA | Unverified — consumer run pending | C: `$dev-mate` for runtime evidence |
| `$rules-sync` | Profile-selected | File tools + repository commands | Git, Bash; `AGENTS.md`, mapped rules/quality docs or documented fallback | Profile-selected | Edits local rule docs, removes proven duplicates and preserves explicit local overrides | Unverified — consumer run pending | — |
| `$skill-review` | Neutral; instruction catalog | CLI tools | Node; instruction artifacts, authoring standard; catalog mode reads OpenCode agent configuration | Not prescribed | Read-only instruction audit; writes local collector reports; no runtime guarantee | Unverified — consumer run pending | — |
| `$skills-index-refresh` | Neutral | File tools | `SKILLS_INDEX_DOC`; `MAIN_DOC` language only when creating an index | Not prescribed | Edits index list/triggers and existing optional support rows; never promotes support automatically | Unverified — consumer run pending | — |
| `$slack` | Neutral | CLI tools | Node 22+, official Slack CLI; consumer `.slack/config.json`, user token file with mode 600 | Not prescribed | Bounded reads; sends/edits/deletes own messages only on explicit request; local cache | Unverified — consumer run pending | — |
| `$task-plan` | Neutral planning; repo-selected rules | CLI tools + Hybrid for repository context | Git, Bash, Node, model hierarchy; `gh` only for GitHub source; ranking network when needed | Repo-selected rules | Writes plan and source/cache artifacts; mandatory read-only plan review; no code, branch or PR changes | Unverified — consumer run pending | M: `$code-review`; C: `$context-refresh` through startup policy |

## Starter set and dependency closure

The seven **entrypoints** are `$context-refresh`, `$task-plan`, `$plan-execute`,
`$code-implement`, `$code-review`, `$qa-run` and `$git-commit`. They are entrypoints,
not a seven-directory standalone installation.

Required calls, including transitive helpers:

- **Planning/execution:** `$task-plan` → `$code-review`;
  `$plan-execute` → `$task-plan` (plan API) + `$code-implement`.
- **Implementation:** `$code-implement` → `$review-quick`, with
  `$context-refresh` when context is not current.
- **QA:** `$qa-run` → `$review-quick`.
- **Commit:** `$git-commit` → `$qa-run` + `$commit-message-write` +
  `$agent-cache-clear`, plus `$docs-sync` and `$skills-index-refresh` when the
  consumer maps their documents in `docs_map` (otherwise the step is skipped and
  reported). `$docs-sync` can also call `$skills-index-refresh`; this does not add
  another directory to the closure.

The **unconditional starter closure is 12 skills**: the seven entrypoints plus
`$review-quick`, `$docs-sync`, `$skills-index-refresh`, `$commit-message-write` and
`$agent-cache-clear`. Keep every skill's own scripts/references/assets and all
declared `shared_files`, including their shared module dependencies. File
availability is separate from activation: shipping the PHP baseline does not
enable it. Native scout agents and harness/MCP configuration are **not** skills
and are not installed merely by copying these directories.

For all documented specialist branches, extend that closure with
`$dev-mate` (Symfony runtime), `$frontend-ui-consistency` (rendered UI) and
`$php-structure-refactor` (PHP structural changes): **15 skills in total**.
Install only the branches you intend to use, but do not enter one without its
tools/configuration. GitHub issue lifecycle, Slack, delegated Claude review,
economics analysis, TODO listing, handoff creation, module-atlas maintenance,
rules synchronization and instruction audits are separate opt-in entrypoints,
not hidden dependencies of the starter workflow.

This closure defines the catalog's dependency requirements based on the inspected
instruction calls; the installer is responsible for delivering them. End-to-end
skill workflow evidence for OpenCode is still outstanding; no starter workflow is
marked Verified here.

## Skill list

- `$agent-cache-clear`
- `$claude-review`
- `$code-implement`
- `$code-review`
- `$commit-message-write`
- `$context-refresh`
- `$dev-mate`
- `$docs-sync`
- `$docs-todo`
- `$frontend-ui-consistency`
- `$gh-issue-review`
- `$gh-issue-start`
- `$gh-issue-status-set`
- `$git-commit`
- `$handoff-refresh`
- `$module-atlas-sync`
- `$opencode-workflow-economics`
- `$php-structure-refactor`
- `$plan-execute`
- `$qa-run`
- `$review-quick`
- `$rules-sync`
- `$skill-review`
- `$skills-index-refresh`
- `$slack`
- `$task-plan`
