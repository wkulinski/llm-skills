# Developing this catalog

This page is for contributors to **llm-skills**, not consumer application setup.
Start with this repository's [AGENTS.md](../AGENTS.md). Users installing skills
should follow [first use](FIRST-USE.md) and [consumer configuration](CONFIGURATION.md).

## Repository layout

- `.agents/skills/<name>/SKILL.md` is the authored skill source.
- A skill may own `scripts/`, `references/`, templates and assets; common runtime
  dependencies live in `_shared`.
- `.opencode/agents/` contains native context-role adapters; `.opencode/plugins/`
  contains project plugins. These are not skills discovered by copying SKILL.md.
- `distribution/` owns the bounded Linux/OpenCode reference delivery.
- `tests/skills/` and `tests/distribution/` test helper and delivery contracts.
- `var/` holds local ignored state/cache, not authored source.

Use kebab-case for new skill directories. See the
[authoring standard](../.agents/skills/_shared/references/skill-authoring-standard.md)
and [structure contract](../.agents/skills/_shared/references/skill-structure-contract.md)
before changing instructions. User-facing documentation is English; skill
descriptions/instructions remain Polish. Do not maintain a second full translation.
The [single skills index](SKILLS.md) is maintained by
[skills-index-refresh](../.agents/skills/skills-index-refresh/SKILL.md), not a
second hand-maintained catalog or generator.

## Tests and script choices

Install the development dependencies from the lockfile with `npm ci` when needed.
This catalog uses Vitest; `npm test` runs the unit and integration projects,
`npm run test:unit -- <file>` selects a focused unit file, and
`npm run test:integration -- <file>` selects an integration file. These are
**catalog** commands, not consumer application QA commands. The catalog's
`.agents/qa-run.matrix.json` selects its checks; use
[qa-run](../.agents/skills/qa-run/SKILL.md) for the operational QA workflow and
[git-commit](../.agents/skills/git-commit/SKILL.md) for a requested commit.

Instruction-only changes to skill roots, shared references or native role
adapters select `INSTRUCTIONS_CHANGED` in the catalog matrix, which runs the
existing description, shared-file, inventory and scout-adapter contracts.
`PUBLIC_DOCS_CHANGED` runs the local-link test for root Markdown and Git-visible
`docs/**/*.md` (including new pages, excluding ignored private plans/cache).
The installation test shares the same checker; there is no separate QA runner.

For a focused documentation check:

```bash
npm run test:unit -- tests/documentation/local-links.test.mjs
```

Use Markdown links/images, reference links or quoted HTML `href`/`src` for real
repository sources. Relative links resolve from the page; `/path` means the
repository root. Markdown heading fragments (ATX headings and explicit HTML
anchors) are checked locally; external URL schemes are not fetched. Missing
targets/references/anchors report `file:line`. A local file that exists only in
ignored/private storage is not a publishable target and also fails; Git-visible
new source files are allowed before commit. Query-string URLs and generated-site
routes are not local source paths supported by this check.

Consumer paths, template placeholders and command examples belong in inline or
fenced code, not clickable local links. Code and comments are not link inputs;
a real local link containing a placeholder fails instead of being silently
exempted. Keep example configuration local to its consumer context, without
inventing matching files in this catalog.

### Pull request CI and external tests

[Catalog CI](../.github/workflows/ci.yml) runs on every pull request (including
instruction-only changes), pushes to `master`, and manual dispatch. Its reference
runner is GitHub-hosted Ubuntu 24.04 with Node 22. It uses `npm ci`, JavaScript
lint, shell syntax checks, and the complete Vitest `unit` project. The unit run
already includes the WP7 instruction contracts and public-link checker above;
there is no second copy of those checks or of the QA selection algorithm.

The job grants only `contents: read`, does not retain checkout credentials, and
does not reference repository secrets, protected environments or self-hosted
runners. Actions are pinned to full commit SHAs verified against their official
release tags; reverify the tag and action runtime when updating a pin. Dependency
installation requires the public registry; “offline” describes the checks, not
a network-isolated GitHub runner or a sandbox for malicious dependencies.

Keep `unit` runnable without private env files, global OpenCode/Paseo, credentials
or model calls. Use synthetic temporary fixtures for helper behavior. Tests that
resolve actual installed tools belong in `*.integration.test.mjs`, selected by
the separate `integration` project, rather than being skipped in `unit` or losing
their assertions. `npm test` includes both projects and is **not** the ordinary
CI command. Do not hide helper failures by reclassifying them as integrations.

CI has no live-smoke input or job; manual dispatch runs the same offline checks.
Integration and cost-bearing runs remain local operator actions with their own
prerequisites and explicit consent. In particular, the Claude review smoke also
requires `CLAUDE_REVIEW_SMOKE=1` and all launch parameters required by its
[test entrypoint](../tests/skills/claude-review/claude-review.integration.test.mjs).
Do not wire credentials or live integrations into untrusted pull request jobs.
Static checks or a local clean-container run do not establish that GitHub Actions
has passed, nor do they verify another OS or the consumer's model-driven workflow.

Keep shell scripts for small glue: env loading, path wiring, Git/filesystem
orchestration, traps and simple dispatch. Use `.mjs` for substantive parsing,
normalization, branching or structured output that benefits from fixture tests.
Do not rewrite a small shell helper solely to use Vitest. Shell entrypoints use
`#!/usr/bin/env bash`, `set -euo pipefail`, syntax checks and a focused smoke;
new shell scripts must be executable. JS helpers should use temporary fixtures
rather than the live repository for mutations. Keep changes in the relevant
skill or shared owner; do not introduce another loader, runner or manager.

## Catalog runtime extensions

Consumer model/role setup and the delivered session plugin are documented once
in [configuration](CONFIGURATION.md#opencode-agent-runtime-model--thinking).
The catalog's live `opencode.jsonc` is not a distributable consumer preset.
Do not move per-role model/thinking settings into `.env` or adapter Markdown.

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

The fixed thresholds do not depend on model context size/pricing and do not
apply to other providers. A model with a smaller limit may never reach them.
Dropping below the last warning level allows a later crossing to notify again.
Restart OpenCode after plugin changes.

### Removing role adapters

A consumer `agent` override can outlive its `.opencode/agents/<name>.md` file and
recreate a role with defaults. When removing a catalog role, remove both its file
and catalog config key, keep remaining keys backed by an adapter or documented
built-in (`build`, `title`), and document the consumer cleanup/restart. Detecting
orphan consumer overrides belongs to the synchronizer, not a permanent blacklist
of one removed name.

For older consumers of the removed `diff-reviewer` role, the one-off migration is
to remove its stale `agent` key and leftover adapter, then restart OpenCode. This
is historical migration guidance, not a ban on that identifier.

### Claude access in this checkout

`.agents/skills` is the only authored source; this repository's tracked relative
symlink `.claude/skills → ../.agents/skills` exposes it to Claude Code.
`tests/skills/_shared/claude-skills-access.test.mjs` checks that projection. On
Windows, enable Git symlink support/Developer Mode or the link may become a text
file; this does not make Windows a verified consumer target.

Consumer delivery uses independent regular files, never links to this checkout.
Target projection belongs to the installer. If a consumer intentionally has
physical copies in both `.agents/skills` and `.claude/skills`, OpenCode can expose
duplicates; configure its Claude-skill discovery explicitly rather than treating
two authored copies as the catalog source.

Claude Code uses root `.mcp.json`, whereas OpenCode uses `opencode.jsonc` and
Codex uses `.codex/config.toml`; these are not interchangeable. In the catalog's
Claude setup, `serena` must be on the PATH of the process launching the harness
(a uv tool install may require `~/.local/bin`). Its `--context=claude-code` setting
is harness-specific. Check the installed version's contexts instead of copying
one harness's MCP config into another.
