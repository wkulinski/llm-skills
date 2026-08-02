# OWE Stage 0 Baseline

Generate the reproducible fixture and local CLI baseline with:

```bash
node .agents/skills/opencode-workflow-economics/benchmarks/run-baseline.mjs
```

The generated `baseline.json` is written to `.owe/benchmarks/` by
default. The directory is ignored because benchmark results are local artifacts.

The baseline records p50/p95 wall-clock measurements for the four standard
navigation scenarios, stdout byte/token estimates, report sizes, corpus
methodology counts, and unavailable measurements. `ceil(bytes/4)` is only an
auxiliary estimate. Model usage, instruction tokens, model turns, peak RSS,
and real `prepare` latency require a separate benchmark against OpenCode
session history and are intentionally not inferred from fixtures.

Measure the Stage 3 adaptive drill-down against that baseline with:

```bash
node .agents/skills/opencode-workflow-economics/benchmarks/run-stage3.mjs
```

The generated `stage3.json` is written to `.owe/benchmarks/`.

The result records bounded brief/root guardrails, one-vs-two hint projections,
auxiliary token estimates, the recommended root-drill-down rate, the selected
hint count, additional read commands, `show root` counts, and p50/p95 command
count deltas. The root-drill-down rate is a deterministic recommendation proxy
based on the bounded brief and corpus root count; it is not an observed LLM
follow-up rate. It is a fixture-only measurement and does not make the Stage 4
index decision.

## Stage 4 index gate

Measure projection performance without reading `index.json` across the required
corpus sizes:

```bash
node .agents/skills/opencode-workflow-economics/benchmarks/run-stage4.mjs
```

The benchmark measures p50/p95 latency for `list patterns`, `show pattern`, and
the standard projection sequence, plus peak RSS. The no-index worker rebuilds
projections from canonical `report.json`; it does not use a persisted index or
detail artifacts. The output contains the threshold decision and explicitly
records whether Stage 5 has started.

## Stage 11 structural-similarity ablation

Compare the legacy structural classifier with the exact-resource-only classifier:

```bash
node .agents/skills/opencode-workflow-economics/benchmarks/run-stage11.mjs
```

The benchmark reports precision, recall, confusion matrices, and structural-only
cases. Jaccard, LCS, shared operation types, and structural families remain in
the evidence as bounded descriptive context, but the production classifier does
not use them to emit repeated-work labels. The report records that Stage 12 has
not started.

## Stage 16 final non-inferiority benchmark

Repeat the four Stage 0 scenarios and record the final quality gates with:

```bash
node .agents/skills/opencode-workflow-economics/benchmarks/run-final.mjs
```

The final report compares p50/p95 wall-clock time, command counts and auxiliary
stdout-token estimates, and records pattern expectations, the overlap confusion
matrix, pricing consistency, root drill-down rate and a fixed recommendation
rubric. Model usage, instruction tokens, model turns, RSS and top-5 agreement
remain explicitly `unavailable` unless the Stage 0 artifact contains those
measurements; the runner never infers them. A corpus-version mismatch makes
performance deltas descriptive rather than comparable. The report always marks
that Stage 17 has not started.
