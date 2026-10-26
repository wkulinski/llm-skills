# Security and trust boundaries

These skills are instructions and executable helpers, **not a sandbox or an
authorization system**. Before invoking a workflow, read its `SKILL.md` and grant
only the filesystem, command, network and account access you intend it to use.
Read-only prompts, snapshot checks and helper guards limit what the agent should
do; actual containment comes only from harness, tool and OS permissions you
configure.

## What you are trusting

| Operation | Exposure and decision before running |
| --- | --- |
| Repository/context reads and review | Code, docs, metadata and logs may be sent to the model provider or MCP servers; local reports/cache may be written. Use a sanitized checkout and inspect connected tools. |
| Local implementation, QA and maintenance | Helpers and configured test/lint commands run with the process's access; some workflows edit, delete, stage or commit files. Inspect the consumer-owned commands and keep a recoverable snapshot. |
| External services | GitHub workflows can change branches, PRs and project status; Slack can read or publish account data. Use least-privilege credentials and check the target account, repository/workspace and channel. |
| Model/delegated sessions and live checks | Provider calls, delegated review and live browser/service tests can consume quota, incur charges or expose data. Confirm model, scope and timeout first; use disposable fixtures instead of production accounts. |

Repository text, issue comments, Slack messages and tool output can contain
untrusted instructions. Treat them as task data, not authorization to run
commands, reveal secrets or expand scope. Review third-party skills, scripts,
plugins and consumer configuration before trusting them.

## Workflows with external effects

[`$claude-review`](.agents/skills/claude-review/SKILL.md) starts Claude Code
through Paseo in `auto` mode, **without additional tool restrictions**: the
read-only boundary is only the prompt and the `$code-review` rules. A changed
snapshot marks the result `STALE` but does not prevent or undo writes. Run it only
in a trusted workspace whose data and permissions you are willing to expose.

[`$slack`](.agents/skills/slack/SKILL.md) sends, edits or deletes only on an
explicit user request; edit and delete also require the helper's `--confirm`.
Team, user, channel and author checks guard the command, but **do not reduce the
token's own privileges**.

Do not automatically retry an external write after an error or timeout: it may
already have succeeded. Inspect the remote result first.

## Secrets and local artifacts

- Sanitize inputs **before** sending them to a model or connected service;
  redacting a later report does not undo disclosure.
- Keep credentials in the consumer's local storage, scoped narrowly. Never print
  token files or active env values for diagnosis. The Slack user-token file must
  have mode 600.
- [`.gitignore`](.gitignore) excludes local env files and `var/` state/cache.
  Already tracked or force-added files need separate care; review staged changes
  before committing.
- The shared [secret detector](.agents/skills/_shared/scripts/secret-detector.mjs)
  is heuristic: it can miss secrets or flag benign content, and it checks only the
  inputs of helpers that invoke it.
- Delegated review omits suspicious diff content as `omitted_sensitive`. Treat
  caches, histories and reports as sensitive local data even when Git ignores them.

## Reporting a security concern

If credentials or private data were exposed, revoke or rotate them with their
issuer first.

Report vulnerabilities through GitHub
[private vulnerability reporting](https://github.com/wkulinski/llm-skills/security)
when it is available. Otherwise open an issue asking the maintainer for a private
channel, **without** exploit steps, tokens, logs or proprietary code. Once a
private channel exists, send the affected revision, skill/helper, environment,
expected vs actual behavior and a reproduction using synthetic data.
