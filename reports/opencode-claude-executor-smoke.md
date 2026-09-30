# OpenCode orchestrates a Claude skill executor

Date: 2026-09-30. Verdict: **PASS for the bounded synthetic executor scenario**.

## What was tested

```text
OpenCode / DeepSeek (orchestrator)
  → Paseo CLI
    → Claude Code / Opus 5.5 (executor, separate temporary workspace)
      → native Skill invocation
      → JSON result
  ← wait/inspect and result comparison by OpenCode
```

No plugin installation, MCP injection, production configuration change, scout,
repository discovery, or source-code change was required. This does not certify
existing production skills for executor mode.

## Environment and authentication

- Paseo CLI/daemon 0.9.2; reachable; Claude and OpenCode available.
- Claude Code 2.1.284, OpenCode 1.18.32 (versions established in the preceding test).
- Local Claude auth status: logged in through `claude.ai`, provider `firstParty`,
  subscription `pro`. Account identifiers omitted.
- Claude launch supplied empty `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and
  `ANTHROPIC_BASE_URL` overrides. No new credentials were installed.
- These observations support the existing subscription-login path. Actual billing
  was not independently reconciled in the account dashboard; Paseo `CostUsd`
  telemetry does not establish API charges.

## Fixture

Temporary workspace: `/tmp/opencode/paseo-executor-smoke-20260930`.

Files:

- `.claude/skills/paseo-executor-smoke/SKILL.md`
- `CLAUDE.md`

Launch helper: `/tmp/opencode/paseo-executor-sm-20260930-launch.sh` (syntax check
`bash -n` passed; invoked through Bash, not installed as a production entrypoint).

The temporary skill requires sorting the caller's numbers and returning their sum,
with `status: COMPLETE`, `delegated: false`, and the marker
`EXECUTOR_SKILL_LOADED_7c92`. The marker is stored in the skill body, not in the
Claude launch prompt. The prompt supplies only `[8,3,5]`, the skill name, scope,
and escalation instructions. This is synthetic complete context, not an actual
scout report. The fixture forbids file discovery, shell operations, edits and
further delegation by Claude after loading the skill.

## Observed sessions

### Orchestrator

- ID: `17f0c96b-135c-400a-86d6-e5698b0a2a2c`
- Provider: `opencode`
- Model: `commandcode/deepseek/deepseek-v4.1-flash`
- Mode: `build`
- Cwd: `/home/wkulinski/code/llm-skills`

OpenCode ran the launch helper, received the child ID, used `paseo wait` and
`paseo inspect`, then compared the returned fields to the expected numeric result.
It returned PASS with the actual child metadata and payload.

### Executor

- ID: `5b50c09c-8c97-4034-8ea0-3f34f38ba8ea`
- Provider: `claude`
- Model: `claude-opus-5-5`
- Thinking: `low`
- Mode: `default` (Always Ask), not bypass mode
- Cwd: `/tmp/opencode/paseo-executor-smoke-20260930`
- ParentAgentId: `17f0c96b-135c-400a-86d6-e5698b0a2a2c`
- Workspace: `wks_122e95dfede4ee7c`
- Completion state: idle; no pending permissions

The separate workspace was created using `--new-workspace local --cwd <fixture>`.
Unlike the preceding connectivity test, this explicitly selected workspace kept
Claude outside the repository while preserving its parent relationship.

Claude's observed timeline is:

```text
[User] <complete synthetic handoff, skill name, scope and escalation rules>
[Skill] paseo-executor-smoke
{"status":"COMPLETE","skill_marker":"EXECUTOR_SKILL_LOADED_7c92","sorted":[3,5,8],"sum":16,"delegated":false}
```

This is a native skill event, not merely a claim that the skill was loaded. No
other tool event or further delegation appeared in the executor's timeline.

## Independent verification

A local Python assertion against fresh Paseo command output checked:

1. Exact received JSON equals the expected fields, marker, sorted numbers and sum.
2. Child provider/model equal Claude/Opus 5.5.
3. Child ParentAgentId equals the OpenCode orchestrator ID.
4. Child Cwd equals the temporary fixture directory.
5. Native `[Skill] paseo-executor-smoke` event exists.
6. No Shell/Agent/Read/Grep/Glob/Write/Edit event appears in the small executor log.

Result: PASS. The orchestrator's natural-language verdict was not the sole evidence.

Both test sessions were archived after completion, retaining their history. The
temporary fixture remains under `/tmp/opencode` for reproduction. No runtime
settings or production files were changed by this test. `git diff --check`
passed; unrelated worktree changes observed at the end were not modified or
reviewed, and that command does not validate the untracked report's contents.

## Limits and implications

- This verifies a synthetic skill without nested delegation, not execution of
  `code-implement`, `task-plan`, `plan-execute`, or another production workflow.
- The repository's `.claude` directory currently contains `settings.json`; the
  point-in-time directory read did not show a local skills projection. The test
  therefore deliberately used a temporary native skill, not the catalog's skills.
- Existing skills that mandate context gathering or subagent delegation need an
  explicit supported executor contract before being used this way. A handoff
  prompt must not contradict their mandatory instructions.
- No production scout ran and no hybrid controller was prepared or left active.
- No code implementation, tests of implementation quality, cancellation,
  reconnection, malformed results or missing-skill escalation were tested.
- Claude's no-delegation behavior was observed for this task; prompt instructions
  alone are not a general enforceable security boundary.
- No claim of individual Anthropic approval for Paseo follows from this test.

The basic transport and native skill loading work in the installed stack. The
remaining design work is task/skill selection, bounded handoff and result
validation, while OpenCode retains ownership of scouts and workflow decisions.
