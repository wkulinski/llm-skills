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
add-finding "$LEDGER" --criterion C1 --claim "..." --evidence E1,E2
set-coverage "$LEDGER" --criterion C1 --status covered --evidence E1,E2
add-risk "$LEDGER" --text "..."
add-omitted "$LEDGER" --text "..."
set-next-step "$LEDGER" --text "..."
check "$LEDGER"
render "$LEDGER" --status COMPLETE --output "$REPORT"
```

`--claim` and `--evidence` are for `add-finding`. `add-risk`, `add-omitted` and
`set-next-step` require `--text`. Do not hand-write the final JSON.

Ledger and report output paths must be under `var/agent/cache` or the system
temporary directory. The builder rejects writes to source and configuration
paths.

Reserve at least 40% of the step budget for evidence preflight, coverage,
`check` and `render`. Once every handoff criterion has minimal evidence, stop
discovery and finalize. A missing or unverifiable evidence item means
`INCOMPLETE`.
