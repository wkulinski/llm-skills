# Context-scout report protocol

## Scout: one JSON file, no shell

Read the exact immutable prompt, manifest, handoff and criteria supplied by the
controller. Use the actual criteria IDs and mode; never assume C1–C3 or C1–C4.
The controller has already validated these inputs and verified the snapshot.

Build the complete report JSON in memory using the envelope in the installation's
`context-subagent-contract.md`. Write it with the native file tool exposed by the
profile (`write` or `apply_patch`) to the exact
attempt-specific `.scout.json` path supplied by `claim`. Do not run validators,
builder commands or a shell, initialize a ledger, or write the final report.
If a required tool operation is denied, report that denial literally; do not
choose another project's path or return the report body as a substitute file.

Choose exactly one status:

- `COMPLETE`: direct evidence and valid coverage for every criterion;
- `INCOMPLETE`: verified findings only, uncovered criteria blocked with reasons;
- `BLOCKED`: no findings, every criterion blocked or not applicable with a reason.

Each finding declares `claim_type` (`observed`, `structural`, `inferred`),
`confidence` (`high`, `medium`, `low`) and literal `anchors` present in its
evidence. Every anchor must occur in the cited source lines; a filename is not
an anchor unless those lines contain it. `omitted` must be an array of strings,
not objects. `next_step` must be a string; use an empty string when no follow-up
is needed, never `null`. Keep evidence paths repository-relative and ranges at most 80 lines.
Use absolute project paths in read tools and an explicit project `path` in
search tools. `read_coverage` records actual reads and concrete parent follow-ups,
not proof of freshness. Reserve at least 40% of the budget for evidence preflight,
coverage and writing the file; stop discovery when minimum coverage is reached.

Return only a compact acknowledgement with `status`, `scout_path`,
`findings_count` and `covered_criteria`. The acknowledgement never replaces the
file and the report body does not pass through the main agent's context.

## Controller: build and validate in the consumer project

The installation A supplies helpers and shared instructions. The consumer project
B supplies all inputs, code and data, independently of the session directory.
The controller retains a unique scout, ledger and report path for each attempt
under B's repository-local cache; neither another attempt nor another project's
files can fill a missing artifact. The output directory may have any name within
that cache. Common Git metadata is not a workflow data root.

When the attempt report does not yet exist, the controller reads its own scout
file, parses JSON and checks the status. It invokes the installation's existing
builder in B: first `init` with the saved HEAD, criteria and mode, then
`batch-render` with the scout bytes on stdin, the payload's status and the saved
report output path. The existing report validator remains authoritative. A valid
partial report is retained, not coerced to `COMPLETE`.

Missing scout files are `REPORT_MISSING`; invalid JSON, status or builder-rejected
content are `REPORT_INVALID`; read/write I/O failures are `REPORT_WRITE_FAILED`.
No synthetic report is created. The canonical hybrid controller owns retry,
fallback and finalization; the scout does not recover ledgers or start agents.
