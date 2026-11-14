# Context-scout report protocol

## Scout: one JSON file, read-only discovery

Read the exact immutable prompt, manifest, handoff and criteria supplied by the
controller. Use the actual criteria IDs and mode; never assume C1–C3 or C1–C4.
The controller has already validated these inputs and verified the snapshot.

Build the complete report JSON in memory using the envelope in the installation's
`context-subagent-contract.md`. Write it with the native file tool exposed by the
profile (`write` or `apply_patch`) to the exact
attempt-specific `.scout.json` path supplied by `claim`. Do not run validators,
builder commands, initialize a ledger, or write the final report. Read-only shell
access is a fallback for unavailable file tools, under the playbook boundaries;
never use it to write the scout file or execute helpers.
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
is needed, never `null`. Keep evidence paths repository-relative and valid ranges within the source file. Prefer the smallest sufficient range.
Use absolute project paths in read tools and an explicit project `path` in
search tools. `read_coverage` records actual reads and concrete parent follow-ups,
not proof of freshness. Follow-ups may refer to a read file when the reason
identifies its remaining range or uncertainty. Stop discovery when criteria are
supported; there are no numeric report, file, step or read quotas.

Return only a compact acknowledgement with `status` and `scout_path`. The
acknowledgement never replaces the
file and the report body does not pass through the main agent's context.


### Minimal BLOCKED report

This is the complete minimal envelope. Replace the mode and expand coverage to
all actual criteria IDs; retain `version: 1`. Put the literal failure in each
reason. `risks` may contain strings; objects require claim metadata and evidence.
Omit optional `read_coverage` unless exact paths and line ranges are available.

```json
{
  "version": 1,
  "status": "BLOCKED",
  "mode": "targeted",
  "findings": [],
  "coverage": [
    {"criterion_id": "C1", "status": "blocked", "evidence": [], "reason": "Required input could not be read: literal tool denial"}
  ],
  "risks": [],
  "omitted": [],
  "next_step": "Restore the required read capability before discovery."
}
```

## Controller: build and validate in the consumer project

The installation A supplies helpers and shared instructions. The consumer project
B supplies all inputs, code and data, independently of the session directory.
The controller retains a unique scout, ledger and report path for each attempt
under B's repository-local cache; neither another attempt nor another project's
files can fill a missing artifact. The output directory may have any name within
that cache. Common Git metadata is not a workflow data root.

On every `settle`, the controller reads its own scout file, parses JSON and
checks the status. It invokes the installation's existing
builder in B: first `init` with the saved HEAD, criteria and mode, then
`batch-render` with the scout bytes on stdin, the payload's status and the saved
report output path. The existing report validator remains authoritative. A valid
partial report is retained, not coerced to `COMPLETE`.

A rejected report yields `validation.diagnostics` with `stage` (`read-scout` for
a missing or non-JSON file, `scout-status`, builder `init` or `batch-render`, or
`report-mode`), `scoutPath` and `message`; builder failures also carry
`exitCode` and `signal`. No synthetic report is created. The single-scout
controller returns these diagnostics to the same scout for report repair without
new discovery. Repeated errors without progress stop
the run. A schema-valid partial result is finalized and returned to the main
agent; no automatic fallback is started.
