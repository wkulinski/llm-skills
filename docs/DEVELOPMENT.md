# Developing this catalog

This page is for contributors to **llm-skills**. Start with this repository's
[AGENTS.md](../AGENTS.md).

## Repository layout

- `.agents/skills/<name>/SKILL.md` is the authored skill source.
- A skill may own `scripts/`, `references/`, templates and assets; common runtime
  dependencies live in `_shared`.
- `.opencode/agents/` contains native context-role adapters; `.opencode/plugins/`
  contains project plugins.
- `distribution/` owns the bounded Linux/OpenCode reference delivery.
- `tests/skills/` and `tests/distribution/` test helper and delivery contracts.
- `var/` holds local ignored state/cache, not authored source.

Use kebab-case for new skill directories. See the
[authoring standard](../.agents/skills/_shared/references/skill-authoring-standard.md)
and [structure contract](../.agents/skills/_shared/references/skill-structure-contract.md)
before changing instructions. The [skills index](SKILLS.md) is maintained by
[skills-index-refresh](../.agents/skills/skills-index-refresh/SKILL.md).

## Tests and script choices

Install the development dependencies from the lockfile with `npm ci` when needed.
This catalog uses Vitest; `npm test` runs the unit and integration projects,
`npm run test:unit -- <file>` selects a focused unit file, and
`npm run test:integration -- <file>` selects an integration file. The catalog's
`.agents/qa-run.matrix.json` selects its checks for
[qa-run](../.agents/skills/qa-run/SKILL.md). Its `unit` targeted runner maps a
focused file to `npm run test:unit -- <file>`, so a limited run selects, for example:

```json
{"matrixHash": "<sha256 of the matrix>", "checks": [
    {"runner": "unit", "selectors": ["tests/skills/qa-run/scoped-run.test.mjs"]},
    {"section": "QA_CONFIG_CHANGED", "commandIndex": 0}
]}
```

Save it under `var/agent/cache/` and run
`node .agents/skills/qa-run/scripts/run-matrix.mjs --scope partial --selection var/agent/cache/qa-selection.json`.
Such a result reports `scope=partial` and does not replace the full QA required
before a commit.

Instruction-only changes to skill roots, shared references or native role
adapters select `INSTRUCTIONS_CHANGED` in the catalog matrix, which runs the
existing description, shared-file, inventory and scout-adapter contracts.
`PUBLIC_DOCS_CHANGED` runs the local-link test for root Markdown and Git-visible
`docs/**/*.md` (including new pages, excluding ignored private plans/cache).

For a focused documentation check:

```bash
npm run test:unit -- tests/documentation/local-links.test.mjs
```

The checker resolves Markdown links/images, reference links and quoted HTML
`href`/`src`: relative links from the page, `/path` from the repository root, and
heading fragments locally; external URLs are not fetched. Missing targets and
anchors report `file:line`. A link to a Git-ignored file fails. Consumer paths,
placeholders and command examples belong in inline or fenced code, not links.

### Pull request CI and external tests

[Catalog CI](../.github/workflows/ci.yml) runs on every pull request (including
instruction-only changes), pushes to `master`, and manual dispatch. Its reference
runner is GitHub-hosted Ubuntu 24.04 with Node 22. It uses `npm ci`, JavaScript
lint, shell syntax checks, and the complete Vitest `unit` project, which includes
the instruction contracts and the link checker above.

The job grants only `contents: read`, does not retain checkout credentials, and
does not reference repository secrets, protected environments or self-hosted
runners. Actions are pinned to full commit SHAs verified against their official
release tags; reverify the tag and action runtime when updating a pin.

Keep `unit` runnable without private env files, global OpenCode/Paseo, credentials
or model calls; use synthetic temporary fixtures for helper behavior. Tests that
resolve actually installed tools belong in `*.integration.test.mjs` (the
`integration` project, not run in CI).

Integration and cost-bearing runs are local operator actions. The Claude review
smoke also requires `CLAUDE_REVIEW_SMOKE=1` and the launch parameters required by
its [test entrypoint](../tests/skills/claude-review/claude-review.integration.test.mjs).
Do not wire credentials or live integrations into pull request jobs.

Keep shell scripts for small glue: env loading, path wiring, Git/filesystem
orchestration, traps and simple dispatch. Use `.mjs` for substantive parsing,
normalization, branching or structured output that benefits from fixture tests.
Do not rewrite a small shell helper solely to use Vitest. JS helpers use
temporary fixtures rather than the live repository for mutations.

## Catalog runtime extensions

Consumer model/role setup and the delivered session plugin are documented in
[configuration](CONFIGURATION.md#opencode-agent-runtime-model--thinking). The
catalog's own `opencode.jsonc` is not a consumer preset.

### Context price guard

`.opencode/plugins/context-price-guard.js` is a catalog-local plugin, not part of
the reference delivery. It tracks input tokens (including cache-read/write) for
models through the OpenAI provider and emits no-reply handoff notifications.

| Input-token threshold | Notification |
| --- | --- |
| 230,000 | Context heads-up |
| 240,000 | Handoff recommended |
| 250,000 | Handoff now |
| 265,000 | Critical context |
| More than 272,000 | Configured high-token threshold exceeded |

The thresholds are fixed, independent of the model's context size, and apply only
to the OpenAI provider. Dropping below the last warning level allows a later
crossing to notify again.

### Removing role adapters

A consumer `agent` override can outlive its `.opencode/agents/<name>.md` file and
recreate a role with defaults. When removing a catalog role, remove both its file
and catalog config key, keep remaining keys backed by an adapter or documented
built-in (`build`, `title`), and document the consumer cleanup.

### Claude access in this checkout

`.agents/skills` is the only authored source; this repository's tracked relative
symlink `.claude/skills → ../.agents/skills` exposes it to Claude Code.
`tests/skills/_shared/claude-skills-access.test.mjs` checks that projection. On
Windows, enable Git symlink support/Developer Mode or the link becomes a text file.

If a consumer has physical copies in both `.agents/skills` and `.claude/skills`,
OpenCode can expose duplicates; configure its Claude-skill discovery explicitly.

MCP configuration lives in root `.mcp.json` for Claude Code, `opencode.jsonc` for
OpenCode and `.codex/config.toml` for Codex. In the catalog's Claude setup,
`serena` must be on the PATH of the process launching the harness (a uv tool
install may require `~/.local/bin`); its `--context=claude-code` setting is
harness-specific.
