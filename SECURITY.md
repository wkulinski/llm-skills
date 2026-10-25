# Security and trust boundaries

These skills are instructions and executable helpers, **not a sandbox or an
authorization system**. Before invoking a workflow, read its `SKILL.md` and the
[catalog's effects and limits](docs/SKILLS.md#support-metrics). Grant only the
filesystem, command, network and account access you intend that workflow to use.
Installing a skill does not narrow the permissions of the agent running it.

## What you are trusting

| Operation | Exposure and decision before running |
| --- | --- |
| Repository/context reads and review | Code, docs, metadata, logs and other readable content may enter model/provider or MCP processing. Read-only describes intended behavior, not confidentiality or process isolation; local reports/cache may still be written. Use a sanitized checkout and inspect connected tools. |
| Local implementation, QA and maintenance | Helpers and configured test/lint commands execute with the process's access; some workflows edit, delete, stage or commit files. Inspect the consumer-owned commands and effect row, preserve a recoverable snapshot and request only the intended scope. |
| External services | GitHub workflows can change branches, PRs and project status; Slack can read or publish account data. Inspect the target account, repository/workspace, channel and requested action. Use least-privilege credentials; an instruction to ask first is not an account permission boundary. |
| Model/delegated sessions and live checks | Provider calls, delegated review and live browser/service tests can consume quota, incur charges or expose data. Confirm the configured model/profile, scope, timeout and required accounts before starting; use disposable fixtures instead of production accounts for verification. |

Repository text, issue comments, Slack messages and tool output can contain
untrusted instructions. Treat them as task data, not authorization to run
commands, reveal secrets or expand scope. Prompt rules reduce risk but do not
guarantee resistance to prompt injection. Review third-party skills, scripts,
plugins and consumer configuration before trusting them.

## Instructions, detection and enforcement are different

- **Instructions:** stopping conditions, explicit-user-intent rules and read-only
  prompts tell the agent what it should do. They do not remove its tools or OS
  permissions. The consumer controls harness permissions, MCP access, credentials
  and any actual isolation.
- **Snapshot detection:** context/review helpers compare repository fingerprints
  and reject stale evidence. This detects snapshot differences at validation
  points; it does not prevent writes, undo side effects, detect every transient
  change, or protect external systems.
- **Command/tool enforcement:** particular helpers validate inputs and targets or
  require confirmation flags. These checks apply to that command path, not every
  tool available to the agent. Actual containment requires appropriately limited
  harness/tool/OS access; this catalog adds no general sandbox.

### Delegated Claude review: no additional sandbox

[`$claude-review`](.agents/skills/claude-review/SKILL.md) starts Claude Code through
Paseo in `auto` mode, **without additional tool restrictions**. Its read-only
boundary is the task prompt and `$code-review` rules. A changed snapshot makes
the returned result `STALE`; it is not a write-prevention or rollback mechanism.
Run it only on explicit request in a trusted workspace whose accessible data and
permissions you are willing to expose. It requires an existing claude.ai login
and an explicit Opus model, thinking level and positive timeout. There is no
automatic model/API fallback or retry. Review the skill's prerequisites before
starting a potentially cost-bearing session.

### External writes: consent is not credential confinement

[`$slack`](.agents/skills/slack/SKILL.md) requires an explicit user request for
send/edit/delete; edit and delete additionally require the helper's `--confirm`.
The flag is a technical guard, not proof of user consent. Team, user,
allowed-channel and message-author checks guard the command; **they do not reduce
the token's own privileges**. The token
is passed in the child environment, not command arguments; this does not isolate
it from the process that uses it.

Do not automatically retry a risky external write after an error or timeout:
it may already have succeeded. Inspect the remote result first, then decide
whether a new attempt is appropriate. Slack explicitly follows this rule and
does not retry API requests. Other workflows retain their own documented retry
contracts; do not infer exactly-once execution or safe replay from an error.

## Secrets and local artifacts

- Do not put live credentials, private data or production dumps into prompts,
  reports, diffs, handoffs or issues. Sanitize inputs **before** sending them to a
  model or connected service; redacting a later report does not undo disclosure.
- Keep credentials in the consumer's designated local storage and use narrowly
  scoped accounts. Never print token files or active env values for diagnosis.
  The Slack contract requires a mode-600 user-token file and forbids publishing
  its contents.
- [`.gitignore`](.gitignore) excludes local env files and `var/` state/cache.
  Ignoring a path is version-control hygiene, not encryption, access control or
  protection from an agent that can read it. Already tracked or force-added files
  need separate care; review staged changes before committing.
- The shared [secret detector](.agents/skills/_shared/scripts/secret-detector.mjs)
  rejects recognized token/private-key patterns and sensitive fields/assignments
  in the inputs that invoke it. It uses heuristics, including placeholder and
  entropy checks, and can miss secrets or flag benign content. It is not a
  complete repository scan or an outbound-data filter for every tool.
- Delegated review omits suspicious diff content as `omitted_sensitive`; that is
  a coverage gap, not proof that the remaining workspace is safe or inaccessible
  to the reviewer. Review caches, histories and reports as potentially sensitive
  local data even when they are ignored by Git.

The existing [secret-detector tests](tests/skills/_shared/secret-detector.test.mjs)
exercise recognized patterns, placeholders and value-free diagnostics. Passing
these tests does not prove process isolation, universal secret detection or
provider confidentiality. Catalog support statuses likewise describe workflow
evidence, **not security certification or granted permissions**.

## Reporting a security concern

**No dedicated private reporting channel is confirmed in this repository.** No
private email address or response-time commitment is published here. The source
remote identifies [wkulinski/llm-skills](https://github.com/wkulinski/llm-skills);
that identity is not evidence that private vulnerability reporting is enabled.

1. If credentials or private data were exposed, stop further disclosure and
   revoke/rotate affected credentials through their issuer. Review account
   activity and preserve sanitized evidence locally. Do not wait for a catalog
   response to contain an account incident.
2. If the repository's Security page offers a private reporting option, use it
   only after checking that it belongs to this repository. Otherwise, request a
   private channel from the repository maintainer through an available public
   contact surface (for example an issue, if enabled). A safe initial message is:
   “I have a security concern about llm-skills. Please provide a private reporting
   channel.” **Do not include exploit steps, tokens, logs, proprietary code or
   personal data in that public request.**
3. Until a private channel is established, keep sensitive details local. If no
   contact surface is available, do not substitute a guessed email address or
   publish the vulnerability details to obtain attention.
4. Once a private channel is confirmed, send only the minimum sanitized report:
   affected revision, skill/helper and environment, expected vs actual behavior,
   impact and a reproduction using synthetic data. Never send live secrets.

For non-sensitive setup problems use [troubleshooting](docs/TROUBLESHOOTING.md).
Upstream harness, provider or installer issues belong to their respective
maintainers; do not attach credentials when redirecting a report.
