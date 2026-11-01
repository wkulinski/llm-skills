# First safe result

The goal is to establish project context **without changing application code,
running full QA or making a commit**. Installation and configuration still change
the consumer repository; review those changes separately.

## Before you start

Use a disposable copy or recoverable snapshot of a Git project with at least one
commit (a resolvable `HEAD`). You need Linux, Git, Bash and Node.js 22+ for the
reference delivery, plus OpenCode with a usable model account. The project does
not need to be a PHP application: this example uses the generic core.

1. Follow [installation](INSTALLATION.md) steps 1–2 to deliver the starter files.
2. In the consumer, merge the [minimal AGENTS/docs_map block](CONFIGURATION.md#ownership-and-skill-paths).
   The example points `MAIN_DOC` to the consumer's root `README.md`; create a
   short project description there if needed. Add `var/agent/` to the
   consumer's `.gitignore` so cache and durable work state stay local.
   Keep canonical working plans local while allowing optional read-only publications:

   ```gitignore
   /var/agent/
   /docs/drafts/
   /docs/plans/*
   !/docs/plans/issue-*/
   ```

   Replace an existing `/docs/plans/` rule with the last two lines; leaving the
   parent directory ignored would also hide its publications. The publisher
   reports ignored outputs instead of editing `.gitignore` or forcing staging.
3. Complete the [OpenCode role/MCP configuration](CONFIGURATION.md#opencode-agent-runtime-model--thinking),
   replacing all template placeholders with local values. Restart OpenCode.
4. Run the [context preflight](INSTALLATION.md#context-preflight).
   This context-only run needs no plan, model hierarchy or QA matrix.

## Check the installed generic profile locally

In a **fresh Bash shell at the consumer root**, with the generic profile unset
or explicitly configured and no PHP/CQRS override, run:

```bash
source .agents/skills/_shared/scripts/env-load.sh
ensure_repo_env_loaded
resolve_stack_profile
NODE_CMD="$(resolve_tool_cmd node node)"
"$NODE_CMD" --version
```

Expected result: `generic`, then a Node version such as `v22.x.x`. If the result
is `php-symfony-postgres`, check the project's active env. Existing PHP consumers
follow [the migration steps](../.agents/skills/_shared/references/project-profiles.md#migrating-existing-consumers).

## Invoke the first skill

Open the consumer root in the restarted OpenCode instance and send this prompt to
the agent:

```text
$context-refresh Quick. Load this project's context and report the manifest path
and any missing configuration. Do not edit application code, run full QA, or commit.
```

Expected outcome:

- a short context summary;
- the `docs_map` keys and documents used, including your `MAIN_DOC`;
- a change inventory and a validated context manifest under `CACHE_PATH`
  (default `var/agent/cache/`); use the returned paths;
- a list of missing files or tools, if any.

Compare `git status --short` before and after: it should remain unchanged; cache
files stay ignored. If the agent asks for a missing `MAIN_DOC`, supply the real
consumer path and update the map. If a role or tool cannot start, see
[troubleshooting](TROUBLESHOOTING.md).

## Next steps

Use the [skills index](SKILLS.md#trigger-table) to route by intent. Planning,
implementation, QA and commit are separate requests; a commit needs explicit
permission. For an existing plan, ask to execute its next WP.

Optional publication is a separate task-plan operation: explicitly bind a
canonical plan to a full GitHub issue URL, assess its final content (an explicit
empty selection is valid), then publish it to `docs/plans/issue-<number>/plan.md`.
See the [publication contract and command examples](../.agents/skills/_shared/references/task-plan-contract.md#publikacja-do-czytania)
and the [task-plan workflow](../.agents/skills/task-plan/SKILL.md#ocena-i-publikacja-planu).

The publication is not a new review or an input to plan execution. It remains
readable after a fresh checkout, even if the ignored local binding, assessment
or sources are unavailable. Missing inputs block refresh without deleting or
reconstructing anything. Manual output edits are conflicts requiring explicit
reconciliation; there is no automatic adoption/force mode. After WP completion
or any changed plan/report, the owner must confirm or correct the assessment
for final bytes. Commit preparation only refreshes one existing binding and
does not repeat that assessment or discover other plans.
