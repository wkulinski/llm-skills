# Skills Index

Main workflow routing is defined in
[`skill-routing-policy.md`](../.agents/skills/_shared/references/skill-routing-policy.md).
Use the trigger table to choose by intent and check the starter dependencies
before installing. The alphabetical skill list is at the end.

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
| Run deterministic matrix QA: linters, tests and review | `$qa-run` | QA report and session ledger; `point`/`partial` runs report a limited scope, never full QA |
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
| Clear the local agent cache | `$agent-cache-clear` | explicitly empty `CACHE_PATH`; durable work data is preserved |

### Communication

| Intent | Skill | Next step |
| --- | --- | --- |
| Read Slack channels/DMs, find/manage channels and people, download files or explicitly send, edit or delete your own message | `$slack` | bounded Slack CLI operation with dynamic lookup and consumer-project configuration |

## Starter set and dependency closure

The seven **entrypoints** are `$context-refresh`, `$task-plan`, `$plan-execute`,
`$code-implement`, `$code-review`, `$qa-run` and `$git-commit`. They call further
skills, so installing only their directories is not enough.

Required calls, including transitive helpers:

- **Planning/execution:** `$task-plan` → `$code-review`;
  `$plan-execute` → `$task-plan` (plan API) + `$code-implement`.
- **Implementation:** `$code-implement` → `$review-quick`, with
  `$context-refresh` when context is not current.
- **QA:** `$qa-run` → `$review-quick`.
- **Commit:** `$git-commit` → `$qa-run` + `$commit-message-write`, plus
  `$docs-sync` and `$skills-index-refresh` when the consumer maps their documents
  in `docs_map` (otherwise the step is skipped and reported). `$docs-sync` can
  also call `$skills-index-refresh`. A commit does not clear `CACHE_PATH` or
  durable work data.
- **Cache maintenance:** `$agent-cache-clear` runs only on an explicit user
  request with workflows stopped.

The **unconditional starter closure is 12 skills**: the seven entrypoints plus
`$review-quick`, `$docs-sync`, `$skills-index-refresh`, `$commit-message-write` and
the explicit maintenance skill `$agent-cache-clear`. Keep every skill's own scripts/references/assets and all
declared `shared_files`, including their shared module dependencies. Native scout
agents and harness/MCP configuration are configured separately.

For all documented specialist branches, extend that closure with
`$dev-mate` (Symfony runtime), `$frontend-ui-consistency` (rendered UI) and
`$php-structure-refactor` (PHP structural changes): **15 skills in total**.
Install only the branches you intend to use, together with their tools. The
remaining skills are independent opt-in entrypoints.

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
