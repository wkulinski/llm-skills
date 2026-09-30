# Smoke test Paseo Claude OpenCode DeepSeek

Date: 2026-09-30. Overall: **PARTIAL** — cross-harness connectivity PASS; exact scout workflow NOT VERIFIED.

## Environment

- Paseo CLI and daemon: 0.9.2, local daemon reachable.
- Claude Code: 2.1.284.
- OpenCode: 1.18.32.
- Local `claude auth status`: logged in, `authMethod: claude.ai`, `apiProvider: firstParty`, `subscriptionType: pro`. Account identifiers omitted.
- Paseo discovery exposes `claude-opus-5-5` and the configured OpenCode models.
- Local Paseo configuration has no explicit MCP injection setting. Version 0.9.2 documentation defines `daemon.mcp.injectIntoAgents: false` by default.

## Executed test

### 1. Opus via Paseo

Created session `e64b3da6-76a9-4c2e-865c-0b4f1a6f6579` using Claude, model `claude-opus-5-5`, thinking `low`, mode `default` (Always Ask). Empty API key/auth token/base URL overrides were supplied for the test process.

The model returned `PASEO_OPUS_SMOKE_OK`. Paseo `inspect` confirms provider `claude` and model `claude-opus-5-5`. The model reported no injected Paseo orchestration tools; that inventory is a model statement, not independent tool-catalog introspection. It is consistent with the configuration/default above.

The requested empty `/tmp` working directory was not used: Paseo placed the child in its parent's existing repository workspace. `inspect` reports `/home/wkulinski/code/llm-skills`. No repository discovery was requested or performed; automatically loaded project instructions remain part of the harness context. This test does not demonstrate workspace isolation.

Authentication evidence supports use of the existing subscription login, but billing was not independently checked in the Claude account dashboard. Paseo's `CostUsd` is token-cost telemetry, not proof of a separate API charge or proof of subscription debiting.

### 2. Opus delegates through Paseo CLI

Sent one additional prompt authorizing only a synthetic generic worker and its status/result inspection. Opus used Bash to invoke:

```text
paseo run --background --provider opencode \
  --model commandcode/deepseek/deepseek-v4.1-flash --mode build \
  --title "Smoke DeepSeek connectivity only" --json <synthetic-marker-prompt>
```

The actual command resolved the CLI using the repository `env-load.sh` helper. The synthetic prompt prohibited file reads/searches, tool use, edits, delegation, skills and scouts. Two specific Bash permission requests (launch; wait/inspect) were approved, without bypass mode or global permission changes.

Worker session: `5a66f1f5-ae05-47c6-8ac3-1d66b198f44f`.

Independent `paseo inspect` confirms:

- Provider: `opencode`.
- Model: `commandcode/deepseek/deepseek-v4.1-flash`.
- Mode: `build`.
- ParentAgentId: `e64b3da6-76a9-4c2e-865c-0b4f1a6f6579` (the Opus session).
- Status: `idle`; no pending permissions.

The worker returned exactly `DEEPSEEK_CONNECTIVITY_OK`. Opus received the result via `wait`, inspected it, and returned a summary containing the worker ID and model. The observed worker timeline contains the synthetic user prompt and marker, with no tool calls. Worker telemetry: 21,086 input tokens, 10 output tokens, `CostUsd: 0.0031689` (not independently reconciled with billing).

**Result: PASS for Opus → Paseo CLI → OpenCode/DeepSeek → Opus.** No custom bridge, additional plugin, MCP injection or runtime configuration changes were needed for this connectivity path.

## Exact scout: not verified

Read-only `opencode debug agent context-scout-fast` confirms:

```json
{
  "name": "context-scout-fast",
  "mode": "subagent",
  "model": {
    "providerID": "commandcode",
    "modelID": "deepseek/deepseek-v4.1-flash"
  },
  "steps": 48
}
```

Paseo exposes Build/Plan as OpenCode session modes. A generic `build` worker does not prove execution of this subagent, its permissions, role contract or report format.

The current repository-context policy requires controller-authorized native `task` dispatch and report validation. It does not authorize replacing dispatch with a Paseo generic worker. No scout was launched, no controller `prepare` was performed, and there is no claimed or abandoned hybrid run. No scout report validation is claimed.

Before a full scout test, deliberately specify how Paseo transports controller dispatch to the actual OpenCode subagent, preserving immutable inputs, role permissions, primary/fallback separation and `settle`/`abort`. Do not equate a build worker with the scout or switch its mode merely to satisfy discovery.

## Conclusion

The installed Paseo version already supports the required basic cross-harness orchestration via CLI. Upgrading to 0.10.2 or adding a custom MCP bridge is not necessary for this demonstrated path. The remaining design problem is integration of the existing controlled scout lifecycle, not communication between Claude and OpenCode.

Research report: `reports/abonament-claude-paseo.md`.

Both test sessions were archived after completion; their history remains available in Paseo. No pending permission request remains in those sessions. No runtime configuration or existing source file was changed. `git diff --check` passed; the new reports are untracked artifacts, so that command is not a content validator for them.

References for the tested Paseo version:

- https://github.com/getpaseo/paseo/blob/v0.9.2/public-docs/orchestration.md
- https://github.com/getpaseo/paseo/blob/v0.9.2/public-docs/mcp.md
