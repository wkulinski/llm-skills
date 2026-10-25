# First safe result

Start here from the [catalog README](../README.md). The goal is to establish
project context **without changing application code, running full QA or making
a commit**. Installing/configuring files still changes the consumer repository;
review those changes separately. A model session may incur your normal provider
charges; the local shell check below makes no model request.

## Before you start

Use a disposable copy or recoverable snapshot of a Git project with at least one
existing commit (a resolvable `HEAD`). You need Linux,
Git, Bash and Node.js 22+ for the reference delivery, plus OpenCode with a usable
model account for the skill invocation. Configure the native context roles and
their required MCP access before asking an agent to run them. The project does
not need to be a PHP application: this example uses the generic core.

1. Follow [installation](INSTALLATION.md) to deliver the full starter closure.
   LSM is recommended; the independent pinned-source reference path is available
   without it. Do not copy only seven entrypoint directories or use a symlink
   into the author's checkout.
2. In the consumer, merge the [minimal AGENTS/docs_map block](CONFIGURATION.md#ownership-and-skill-paths).
   The example points `MAIN_DOC` to the consumer's root `README.md`; create a
   short project description there if needed. A completely new repository needs
   its initial commit prepared separately and explicitly before this walkthrough;
   the context workflow does not create one for you. Add `var/agent/cache/` to the
   consumer's `.gitignore`.
3. Complete the [OpenCode role/MCP configuration](CONFIGURATION.md#opencode-agent-runtime-model--thinking),
   replacing all template placeholders with local values. Restart OpenCode.
   Do not copy the catalog's live configuration or secrets.
4. Run the [installation preflight](INSTALLATION.md#4-preflight-before-invoking-a-workflow).
   Static `verify` checks file integrity/presence only. It does not prove that
   providers, model profiles or MCP servers work. A missing hierarchy or QA matrix
   is reported there because the full starter needs it; configure them before
   claiming full-starter readiness. The narrower context-refresh operation
   requires `MAIN_DOC`, not a task plan or a QA run.

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

Expected result: `generic`, then a Node version such as `v22.x.x`. No PHP tool
lookup, network request, application edit, QA run or commit is part of this check.
If the result is `php-symfony-postgres`, check the project's active env instead
of overriding it blindly. For an existing PHP consumer use its intended profile
and follow the [migration contract](../.agents/skills/_shared/references/project-profiles.md).

## Invoke the first skill

Open the consumer root in the freshly restarted OpenCode instance, then send:

```text
$context-refresh Quick. Load this project's context and report the manifest path
and any missing configuration. Do not edit application code, run full QA, or commit.
```

This is a **prompt to the agent**, not a Bash command. Select the installed skill
if the harness asks which `$context-refresh` to use. The
[skill](../.agents/skills/context-refresh/SKILL.md) owns the refresh procedure and
its delegation policy; do not replace it with a hand-written sequence here.

Expected outcome:

- a short “Context loaded/refreshed” report (it may say
  `Kontekst załadowany/odświeżony`, because the instructions are Polish);
- the actual `docs_map` keys and documents used, including your `MAIN_DOC`;
- a generated change inventory and a validated/verified context manifest under
  repository-local `CACHE_PATH` (default `var/agent/cache/`); use the returned
  paths rather than assuming a particular manifest filename;
- an honest list of missing files/tools or optional omissions, not a fabricated
  success. No application-code edits or full QA/commit should occur.

Local cache files are expected side effects. Compare `git status --short` before
and after; ignored state should not become a tracked application change. Never
publish raw env contents or secret-bearing session output as evidence.

If the agent asks for a missing `MAIN_DOC`, supply the **real consumer path** and
update its map. If a role or tool cannot start, stop at that dependency and use
[troubleshooting](TROUBLESHOOTING.md); do not bypass the context policy.

## Choose the next result deliberately

Use the [single skills index](SKILLS.md#trigger-table) to route by intent. A task
plan is a separate request; implementation changes files; QA executes configured
commands; commit needs explicit permission. For an existing plan, ask to execute
its next WP rather than routing straight to code-implement. Per-skill instructions
own those procedures and their required configuration.

The deterministic file checks and this reader walkthrough do not establish
end-to-end model support for every workflow. Consult the
[support/evidence table](SKILLS.md#support-metrics), not the presence of a skill
directory, before relying on a workflow in another environment.
