# OWE report and bundle guide

OWE Stage 12 uses the complete analysis bundle (schema version 5) as its only
persisted report artifact. Navigation projections are rebuilt locally by the
CLI; no persisted index or detail files are required.

## Standard report directory

The default output root is `$OWC_PATH`, then `$CACHE_PATH/owc`, or
`./var/agent/cache/owc`. The directory can be overridden with `--analysis-dir`.

```text
$OWC_PATH/
└── report.json
```

`report.json` is written to a unique `0600` temporary file and published with a
single atomic rename. A failed write leaves the previous report untouched.
Old `CURRENT`, `generations/`, or `index.json` layouts are detected and must be
regenerated; they are not migrated.

### `brief`

The standard input for the analysis agent. It is deterministically generated on
stdout from `report.json` and constrained by `reporting.brief.max_bytes`. It
contains data quality, total usage, baseline cost, top agent/model/activity
projections, selected main-agent patterns, subagent aggregates, delegation
economics, strongest overlap signals, fallback economics, warnings, omitted
counts, and drill-down commands.

### Local projections

A compact machine-readable projection is built in memory for each `list` or
`show` command. It contains:

- `data_quality` and `summary`;
- bounded cost-baseline aggregates including total usage, models, and primary activities;
- projection counts used to report omitted rows when a ranking is bounded;
- delegation economics for delegating-step, child direct/subtree, output bytes, parent follow-up, and fallback additional cost;
- compact pattern, overlap, subagent, and root summaries;
- ranking views;
- report byte sizes and `ceil(bytes/4)` token estimates;
- a reading contract marking `report.json` as audit-only.

The projection does not get persisted and contains no detail-file paths.

### `report.json`

The authoritative complete model used for audit, debugging, or external
processing. Do not load it in full during standard agent analysis.

## Full bundle schema 5

Top-level sections:

- `summary`;
- additive `aggregates.by_agent`, `by_model`, and `by_primary_activity`;
- non-additive `by_activity_signal` and `by_tool_operation`;
- `aggregates.hybrid_families`, `aggregates.delegation_overlap`, and `aggregates.delegation_economics`;
- `candidate_spans` and non-filtering `candidate_views`;
- `pattern_groups`, `pattern_views`, and `pattern_summary`;
- `delegation_overlap_diagnostics`;
- complete `roots[]`;
- `methodology` manifest with active versions, effective thresholds, effective
  parameters and a stable hash;
- `warnings`.

### Methodology manifest

The manifest is part of the canonical report and contains:

- `activity_classification_version`, `fingerprint_version`,
  `pattern_grouping_version`, `representative_sampling_version` and
  `overlap_version`;
- `effective_thresholds` used by fingerprints, pattern grouping and overlap
  diagnostics;
- `effective_parameters` that affect parsing and classification;
- `methodology_hash`, calculated from schema version, active versions and all
  effective methodology inputs.

Reports without a manifest, or reports with different methodology hashes, are
not safely comparable. Comparison callers must emit a warning rather than
presenting the results as a single time series.

## Activity semantics

- `primary_activity` is a deterministic additive/navigation label.
- `activities` and `activity_signals` preserve all co-occurring signals.
- classification resolution is `direct`, `dominant`, `mixed`, `weak`, or `unknown`.
- `activity_classification.evidence` explains the assignment.

Per-object classifier versions, `activity` aliases, and reconstructible boolean
signals are intentionally omitted; the methodology manifest is the single
version source and `mutation_mode` is the canonical read/write value.

Do not interpret `primary_activity` as the complete semantic purpose.

## Fingerprints and pattern groups

Every span has `operation_fingerprint` with:

- version and hashes;
- exact canonical identity containing scope, primary activity, collapsed operation
  sequence, and mutation mode (`read_only`, `write`, or `unknown`);
- context-neutral `structural_family_id`;
- normalized operation sequence and diagnostic collapsed sequence;
- read/write/build/verification/delegation profile as diagnostics;
- bucketed step, tool, and output sizes as diagnostics;
- neighboring primary activities as diagnostics;
- resource-key counts.

Pattern groups contain frequency, distinct sessions/roots, total/median/p90 cost, agent/model distribution, diagnostics, representative examples, and member span IDs. Pattern membership is structural, not semantic.

## Delegation overlap

Each diagnostic contains:

- parent/child/delegation IDs and subagent;
- diagnostic level;
- exact path/query/symbol/command match counts;
- ordered, unordered, and overlapping exact-match counts;
- ordered exact matches before the parent's first write;
- shared operation types and structural families as bounded descriptive context;
- operation Jaccard and ordered-sequence similarity as descriptive metrics only;
- child subtree completion timestamp;
- ordered parent follow-up cost and separate unordered/overlapping exposure;
- one bounded post-child-completion window with timing metadata;
- limitations.

Structural similarity is not a classification signal. A structural-only case is
reported as `no_overlap_observed_in_window` unless exact ordered resource
evidence supports another diagnostic.

Resource keys are namespaced SHA-256 hashes of normalized values. They support equality comparison but are not anonymity against guessing.

## Cost semantics

Cost objects contain:

- `status`;
- `value_nano` only when fully priced;
- `priced_value_nano` for the visible priced portion;
- `priced_steps`, `eligible_steps`, and `currency`.

Never treat `priced_value_nano` as complete when `value_nano` is null. Never sum non-additive involved-step views.
