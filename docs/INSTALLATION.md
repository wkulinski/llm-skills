# Reference delivery: Linux and OpenCode

This is the independent reference procedure for the **v1 delivery contract**.
It copies regular files; it is not a new skill manager. LSM remains the recommended
integration. This repository defines the delivery contract; LSM owns its correct
implementation and installer release testing. This catalog does not certify or
assign verification statuses to LSM releases. The independent reference procedure
does not depend on LSM. Claude Code, Codex and non-Linux environments are outside its
verified scope. Installing files does not mark any skill workflow Verified.

## Delivery and ownership

The versioned specification is
[`distribution/linux-opencode/manifest.json`](../distribution/linux-opencode/manifest.json).
Its directory selectors expand at the **pinned source revision** into a sorted
list of file paths, SHA-256 hashes and executable flags. Review that concrete list,
not just the selector names. The delivered set contains:

- the [12-skill starter closure](SKILLS.md#starter-set-and-dependency-closure),
  including each skill's scripts, references and assets;
- all of `_shared`, including transitive local module dependencies and the PHP
  standards (availability does not activate the PHP profile);
- the three conditional specialist branches (`dev-mate`,
  `frontend-ui-consistency`, `php-structure-refactor`), for 15 skills total;
- the `context-refresher`, `context-scout-fast` and `context-scout` role adapters;
- `.opencode/plugins/session-model-env.js` (automatically loaded project plugin);
- hierarchy, OpenCode and env **templates** plus the license, placed under
  `.agents/skills-templates/`, not over the consumer's active configuration.

The source catalog's `.claude/skills` symlink, other plugins, machine-specific MCP
wrapper, repository `AGENTS.md`, `opencode.jsonc`, active model hierarchy and env
are **not** copied. No symlink is followed inside the selected source or target
paths. A symlink, missing declared shared file, missing skill definition or
non-regular payload produces a concrete error before copying.

Consumer-owned files remain consumer-owned: `AGENTS.md`, documentation, QA matrix,
model hierarchy, OpenCode/MCP/provider config, trust/permissions and all secrets.
Even an existing byte-identical payload file is a conflict on first installation:
the procedure cannot infer its ownership. An existing role adapter or plugin is
configuration too; compare and decide explicitly rather than using a force flag.

## 1. Select and inspect an immutable source

Prerequisites: Linux, Git, Bash, Node.js 22+ and an existing consumer repository.
OpenCode and authenticated model providers are needed for subsequent agent runs,
not for the reference copy. The project runtime was designed around OpenCode
1.18.x; config shapes were cross-checked against the 1.18.29 documentation. A
passing copy test is not a claim of compatibility with every OpenCode release.

Use a trusted local clone of this catalog. Choose a reviewed release tag or full
commit hash; do not install from an unpinned branch tip or a dirty working tree.
The selected revision must include this document and the delivery helper.

```bash
CATALOG=/absolute/path/to/llm-skills
CONSUMER=/absolute/path/to/consumer
REV='replace-with-reviewed-tag-or-full-commit-hash'
COMMIT=$(git -C "$CATALOG" rev-parse --verify "$REV^{commit}")
WORK=$(mktemp -d)
mkdir "$WORK/source"
git -C "$CATALOG" archive "$COMMIT" | tar -x -C "$WORK/source"
SOURCE="$WORK/source"
node "$SOURCE/distribution/reference-copy.mjs" --help
node "$SOURCE/distribution/reference-copy.mjs" list "$SOURCE" > "$WORK/files.json"
```

Inspect `files.json` and the source itself. Keep `COMMIT`, the expanded list and
the exported source together in a safe local location for update/rollback. The
receipt records the payload's `contentSha256`; record the chosen Git commit in
your installation/change log as well. SHA-256 here detects drift, not publisher
identity. Authenticate the chosen revision through your own trusted channel.
The helper never fetches sources, executes their scripts or installs packages.

For an unreleased development snapshot, export the reviewed regular files and
record the content hash explicitly as **development-only**; do not describe its
base HEAD as the installed commit. See the evidence limits below.

## 2. Preview, compare, then copy

Make a recoverable consumer snapshot first (including any ignored configuration
you want to protect, without publishing secrets). Do not run copies concurrently
with agent edits or another installer.

```bash
node "$SOURCE/distribution/reference-copy.mjs" copy "$SOURCE" "$CONSUMER" > "$WORK/preview.json"
# Review every add/update/remove in preview.json and the candidate contents.
git -C "$CONSUMER" status --short
node "$SOURCE/distribution/reference-copy.mjs" copy "$SOURCE" "$CONSUMER" --apply
git -C "$CONSUMER" diff -- .agents/skills .opencode/agents .opencode/plugins/session-model-env.js
git -C "$CONSUMER" status --short
```

Dry-run is the default and writes nothing to the consumer. New files are
untracked, so `git diff` alone is not a review of them: use the expanded list and
read the candidate source files before `--apply`, then inspect `git status`.
For an existing path, `git diff --no-index -- "$CONSUMER/path" "$SOURCE/path"`
shows the candidate difference (exit code 1 means a difference, not an error).

On success, `.agents/skills-delivery.json` records the exact managed file set and
hashes/modes. Retain it with your consumer snapshot. Never invent or edit the
receipt to adopt existing files. For a conflict, stop, compare the local file to
the candidate, and explicitly decide whether to keep the local installation or
back it up outside the delivery paths before retrying a fresh installation.
There is no `--force` or implicit configuration merge.

All predictable conflicts are checked before the first write. The file batch is
**not a filesystem transaction**: an I/O error or interruption can leave a partial
copy. Restore the consumer snapshot before retrying; do not repair ownership by
fabricating a receipt. There is no automatic backup or network recovery.

## 3. Integrate consumer configuration explicitly

Do not copy this catalog's live configuration or replace active env. Compare the
delivered templates and merge local values using [consumer configuration](CONFIGURATION.md):

- [AGENTS and docs_map](CONFIGURATION.md#ownership-and-skill-paths), including
  [additional workflow keys and path exceptions](CONFIGURATION.md#expand-docs_map-only-for-the-workflows-you-use);
- [stack migration and tool entrypoints](CONFIGURATION.md#stack-profile-and-tool-entrypoints);
- [OpenCode roles, hierarchy, MCP and session metadata](CONFIGURATION.md#opencode-agent-runtime-model--thinking);
- [consumer QA configuration](CONFIGURATION.md#qa-and-further-configuration).

Restart the full OpenCode process after configuration changes. Templates, role
files and a passing file-integrity check are not proof of a configured runtime.
For the narrower first context result, use [first use](FIRST-USE.md).

## 4. Preflight before invoking a workflow

```bash
node "$SOURCE/distribution/reference-copy.mjs" verify "$SOURCE" "$CONSUMER"
```

This checks regular-file payload integrity and required consumer-owned file
**presence only**. A missing file names the exact dependency and exits nonzero.
It does not validate the semantics of configuration, MCP health, account access
or successful LLM execution. Complete these separate checks in the consumer:

- In a fresh Bash shell at its root, source
  `.agents/skills/_shared/scripts/env-load.sh`, run `ensure_repo_env_loaded`, then
  `resolve_stack_profile`; require the intended result and no error. Resolve only
  tools needed by the chosen workflow through `resolve_tool_cmd`.
- Validate a real plan through the task-plan validator before execution. Its
  validation checks the hierarchy; use plan-execute `check-environment` for the
  selected WP and require `action: execute`, `sufficient: true` (or the explicit
  one-WP user attestation). No guessed model profile is a preflight success.
- Inspect `opencode debug agent context-refresher`, `context-scout-fast` and
  `context-scout`: all roles must load, with the intended profiles and read-only
  scout permissions. Check MCP connectivity with the harness and a real initial
  codebase-memory `list_projects` call, plus Serena/Context7 availability. A failed
  required MCP blocks that workflow; static `verify` cannot bypass the hybrid.
- In an agent shell call, inspect `OPENCODE_SESSION_MODEL` and
  `OPENCODE_SESSION_VARIANT`. If unavailable, use the documented explicit-profile
  or user-attestation path; do not inspect session logs to infer identity.
- Validate the project-specific QA matrix through the qa-run workflow before
  invoking QA/commit. No full QA or paid LLM smoke is triggered by this copy.

## Update and rollback

Keep the old exported source and receipt/snapshot. Export the next **pinned**
revision into another directory, expand its manifest, and compare the old/new
lists and source diff before copying. For example:

```bash
node "$NEW_SOURCE/distribution/reference-copy.mjs" list "$NEW_SOURCE" > "$WORK/new-files.json"
diff -u "$WORK/files.json" "$WORK/new-files.json"
node "$NEW_SOURCE/distribution/reference-copy.mjs" copy "$NEW_SOURCE" "$CONSUMER"
# Review the candidate source diff and all planned operations, then:
node "$NEW_SOURCE/distribution/reference-copy.mjs" copy "$NEW_SOURCE" "$CONSUMER" --apply
node "$NEW_SOURCE/distribution/reference-copy.mjs" verify "$NEW_SOURCE" "$CONSUMER"
```

`diff` returns 1 when files differ. Updates replace/remove **only** files present
in the previous receipt, and only while their content and executable flags still
match it. A newly introduced path must not collide with an unmanaged file. Extra
consumer files, even inside skill directories, are left untouched. A missing or
edited managed file blocks the batch, including removals. Configuration remains
outside the managed set; compare new templates and integrate changes manually.
Restart OpenCode and repeat the preflight after integration. If a role is removed
in a future manifest, remove its consumer `agent` override only after explicit
review, so OpenCode does not recreate an orphan role from the override.

To roll back, use the same `copy OLD_SOURCE CONSUMER` preview/apply and
`verify OLD_SOURCE CONSUMER` sequence. This restores the old known set, deleting
only unchanged, receipt-owned files introduced by the newer set; it never removes
unmanaged files or recursively deletes directories. Rollback of consumer-owned
configuration is a separate decision using your own snapshot. A conflict is not
permission to overwrite local changes or delete the receipt.

## Evidence and limitations

The durable check is `tests/distribution/reference-copy.test.mjs`, using a
synthetic consumer under `tests/fixtures/delivery/consumer/`. It exercises the real
manifest/closure, shared module imports, regular files and executable modes,
CLI installation, update and rollback, exact missing-dependency errors, conflicts,
consumer configuration preservation and source/target symlink rejection.

WP4 development verification uses the current reviewed **unreleased v1 payload**
and isolated fixture revisions, recording hashes in the test/run output. It is
not evidence that a public release tag has shipped these files,
nor that a model-driven consumer workflow has completed. A Linux/OpenCode
consumer run is still outstanding. Retest this procedure against the chosen
published commit when publishing a release.

Recorded WP4 run (2026-10-24, Linux, Node.js 22.21.1): **15/15 focused tests
passed**, including a complete CLI install → update → rollback using the full
payload exported through `git archive` from two pinned synthetic fixture commits.
The v1 fixture payload hash was
`3a2bc3443db722f9bf5dda44a3da8e122da0f58ba22c91ced761272578213bfa`;
the update fixture (one additional file) was
`59a55595dcb4716634656c01820dcd0c203a676d0010cb7a6cb5739babdefc7c`.
Fixture Git IDs were `1f03d05c069a70e872d2e04ff2b3c9d85cdde0e5` and
`218832ad2217145071d40c83d87ce6889091c57a`: these are **temporary fixture IDs,
not release commits in this repository**. Tests clean up those repositories;
the retained evidence is this result and the repeatable test, not a published
artifact. Own configuration and a private-env marker were unchanged, removal of
a locally edited managed file was refused, and missing dependencies failed with
their paths. Live model/MCP execution was not tested; installer testing is outside
this repository's responsibility.
