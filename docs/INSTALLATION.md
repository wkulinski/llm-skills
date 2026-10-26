# Reference delivery: Linux and OpenCode

Reference procedure for the **v1 delivery contract** on Linux with OpenCode. It
copies regular files and does not depend on LSM. LSM, the recommended installer,
implements the same contract; its correctness and release testing belong to LSM.

## Delivery and ownership

The versioned specification is
[`distribution/linux-opencode/manifest.json`](../distribution/linux-opencode/manifest.json).
Its directory selectors expand at the **pinned source revision** into a sorted
list of file paths, SHA-256 hashes and executable flags. Review that concrete list,
not just the selector names. The delivered set contains:

- the [12-skill starter closure](SKILLS.md#starter-set-and-dependency-closure),
  including each skill's scripts, references and assets;
- all of `_shared`, including transitive local module dependencies and the PHP
  standards (activated only by the [stack profile](CONFIGURATION.md#stack-profile-and-tool-entrypoints));
- the three conditional specialist branches (`dev-mate`,
  `frontend-ui-consistency`, `php-structure-refactor`), for 15 skills total;
- the `context-refresher`, `context-scout-fast` and `context-scout` role adapters;
- `.opencode/plugins/session-model-env.js` (automatically loaded project plugin);
- hierarchy, OpenCode and env **templates** plus the license, placed under
  `.agents/skills-templates/`, not over the consumer's active configuration.

The catalog's `.claude/skills` symlink, other plugins and machine-specific MCP
wrapper are **not** copied. A symlink in the source or target paths, a missing
declared shared file, a missing skill definition or a non-regular payload stops
the copy with a concrete error.

Consumer-owned files (`AGENTS.md`, documentation, QA matrix, model hierarchy,
OpenCode/MCP/provider config, permissions and secrets) are never copied. On first
installation even an existing byte-identical payload file is a conflict, because
its ownership cannot be inferred; this includes an existing role adapter or plugin.

## 1. Select and inspect an immutable source

Prerequisites: Linux, Git, Bash, Node.js 22+ and an existing consumer repository.
OpenCode and authenticated model providers are needed for agent runs, not for the
copy. Config shapes were checked against OpenCode 1.18.x.

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
the exported source together for update/rollback, and record the commit in your
change log; the receipt records only the payload's `contentSha256`. The hashes
detect drift, not publisher identity. The helper never fetches sources, executes
their scripts or installs packages.

## 2. Preview, compare, then copy

Make a recoverable consumer snapshot first, including ignored configuration you
want to protect. Do not run copies concurrently with agent edits or another
installer.

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

On success, `.agents/skills-delivery.json` records the managed file set with
hashes and modes; keep it with your snapshot and do not edit it. For a conflict,
compare the local file to the candidate and either keep the local installation or
move the file outside the delivery paths before retrying. There is no `--force`
or implicit configuration merge.

Conflicts are checked before the first write, but the batch is **not a filesystem
transaction**: an I/O error or interruption can leave a partial copy. Restore the
consumer snapshot before retrying.

## 3. Integrate consumer configuration explicitly

Compare the delivered templates and merge local values using
[consumer configuration](CONFIGURATION.md):

- [AGENTS and docs_map](CONFIGURATION.md#ownership-and-skill-paths), including
  [additional workflow keys and path exceptions](CONFIGURATION.md#expand-docs_map-only-for-the-workflows-you-use);
- [stack migration and tool entrypoints](CONFIGURATION.md#stack-profile-and-tool-entrypoints);
- [OpenCode roles, hierarchy, MCP and session metadata](CONFIGURATION.md#opencode-agent-runtime-model--thinking);
- [consumer QA configuration](CONFIGURATION.md#qa-and-further-configuration).

## 4. Preflight before invoking a workflow

```bash
node "$SOURCE/distribution/reference-copy.mjs" verify "$SOURCE" "$CONSUMER"
```

This checks payload integrity and the **presence** of required consumer-owned
files for the full starter; a missing file names the exact dependency and exits
nonzero. For a context-only first run, use the context preflight below without
requiring the plan/execution or QA configuration checked by `verify`.

### Context preflight

- In a fresh Bash shell at its root, source
  `.agents/skills/_shared/scripts/env-load.sh`, run `ensure_repo_env_loaded`, then
  `resolve_stack_profile`; require the intended result and no error.
- Inspect `opencode debug agent context-refresher`, `context-scout-fast` and
  `context-scout`: all roles must load, with the intended profiles and read-only
  scout permissions. Check MCP connectivity with the harness and a real initial
  codebase-memory `list_projects` call, plus Serena/Context7 availability.

### Additional workflow checks

- Before executing a plan, validate it through the task-plan validator, then run
  plan-execute `check-environment` for the selected WP and require `action: execute`,
  `sufficient: true` (or the explicit one-WP user attestation).
- For planning/execution, inspect `OPENCODE_SESSION_MODEL` and
  `OPENCODE_SESSION_VARIANT` in an agent shell call.
- Before QA/commit, validate the project-specific QA matrix through the qa-run
  workflow.

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

Updates replace or remove **only** files from the previous receipt whose content
and executable flags still match it; a missing or edited managed file blocks the
whole batch. A new path must not collide with an unmanaged file, and extra
consumer files are left untouched. Compare new templates and integrate
configuration changes manually, then restart OpenCode and repeat the preflight.
When a role disappears from the manifest, also remove its consumer `agent`
override; otherwise OpenCode recreates the role with defaults.

To roll back, run the same `copy OLD_SOURCE CONSUMER` preview/apply and
`verify OLD_SOURCE CONSUMER` sequence. It restores the old set, deleting only
unchanged receipt-owned files introduced by the newer set; it never removes
unmanaged files or directories. Consumer-owned configuration is restored from
your own snapshot.

## Tests

`tests/distribution/reference-copy.test.mjs` exercises the real manifest and
closure with a synthetic consumer (`tests/fixtures/delivery/consumer/`): install,
update, rollback, conflicts, missing dependencies and symlink rejection.
