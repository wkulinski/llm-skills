# Context-scout report protocol

Before building a report, read the handoff and use the exact criteria IDs and
mode supplied there. Never assume C1-C3 or C1-C4.

Initialize a ledger outside the repository:

```text
node .agents/skills/_shared/scripts/context-scout-report-builder.mjs init "$LEDGER" \
  --head "$HEAD" --criteria "$CRITERIA" --mode "$MODE"
```

Invoke the builder once per operation and reuse the returned IDs in later calls;
do not use shell command substitution or compound shell commands:

```text
add-evidence "$LEDGER" --path "repo/file" --line-start 1 --line-end 2
add-finding "$LEDGER" --criterion C1 --claim "..." --claim-type structural --confidence high --anchors "literal,terms" --evidence E1,E2
set-coverage "$LEDGER" --criterion C1 --status covered --evidence E1,E2
batch-render "$LEDGER" --status <STATUS> --output "$REPORT" < report.json
add-covered-path "$LEDGER" --path "repo/file" --line-start 1 --line-end 2 --locator "Symbol" --relation "defines"
add-follow-up "$LEDGER" --path "repo/other-file" --reason "required only for implementation read-before-write"
add-risk "$LEDGER" --text "..."
add-omitted "$LEDGER" --text "..."
set-next-step "$LEDGER" --text "..."
check "$LEDGER"  # recovery/debug path only
```

For a normal scout attempt, use one `batch-render` operation with the complete
report JSON on stdin. `<STATUS>` and the payload status must match exactly and
must be one of `COMPLETE`, `INCOMPLETE` or `BLOCKED`. Use `COMPLETE` only when
every criterion is covered, `INCOMPLETE` for bounded partial discovery, and
`BLOCKED` for a hard boundary with no findings and a reason for every criterion.
The older `batch` + `render` sequence remains a recovery path for an interrupted
ledger, not the canonical scout finalization path.
`--claim-type` must be `observed`, `structural` or `inferred`; `--confidence`
must be `high`, `medium` or `low`. Use `inferred` for interpretations and make
their uncertainty explicit in the claim. `--anchors` lists literal terms that
must occur inside the cited evidence ranges; split a claim instead of using
anchors that belong to different files. `add-covered-path` records the exact read set that the parent should not repeat
without a documented reason. `add-follow-up` records a bounded path that remains
outside the scout's read set and why the parent may need it. `--claim` and
`--evidence` are for `add-finding`. `add-risk`, `add-omitted` and `set-next-step`
require `--text`. Do not hand-write the final JSON.

`add-covered-path` may additionally receive `--purpose`, `--source` and
`--read-mode` to record declared read context. These fields are validated against
the shared read-purpose enum and do not prove freshness or non-redundancy.

Ledger and report output paths must be under repository-local `CACHE_PATH`
(default: `./var/agent/cache`). The builder rejects writes to source and
configuration paths.

Reserve at least 40% of the step budget for evidence preflight, coverage,
`check` and `render`. Once every handoff criterion has minimal evidence, stop
discovery and finalize instead of broadening the read set. A single evidence
range may span at most 80 lines. A missing or
unverifiable evidence item means `INCOMPLETE`.
