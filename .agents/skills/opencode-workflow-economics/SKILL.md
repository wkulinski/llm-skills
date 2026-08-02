---
name: opencode-workflow-economics
description: Diagnose OpenCode session history to find recurring costly main-agent work, evaluate subagent and fallback economics, and detect possible child-to-parent work duplication. OpenCode-specific collector; diagnostic only.
---

# OWE — OpenCode Workflow Economics

Use this skill when the user wants to understand how OpenCode distributes work between the main agent, subagents, models, and primary/fallback workflows, or wants evidence-based candidates for cheaper delegation.

OWE is a **diagnostic skill**. It analyzes existing OpenCode history. It does not create agents, run parallel experiments, change configuration, or manage development workflows.

## Objective hierarchy

1. Preserve result quality and required validation.
2. Find recurring, expensive main-agent work that may be expressible as a bounded subagent contract.
3. Diagnose whether existing delegations replace parent work or merely add another cost layer.
4. Keep measured facts, deterministic structure, contextual diagnostics, and semantic inference separate.

## Runtime

The bundled scripts are dependency-free `.mjs` files using standard Node-compatible APIs. No build or package installation is required.

```bash
node <skill_dir>/scripts/owe.mjs
```

`prepare`, `inspect`, and `doctor` automatically start a short-lived local
OpenCode server when the configured endpoint is unavailable. Use
`--server existing` to require a manually managed server. Navigation through
an already generated report is local.

## Prepare data

Initialize project files once:

```bash
node <skill_dir>/scripts/owe.mjs init
```

Edit `.owe/pricing.json`, then verify the OpenCode connection:

```bash
node <skill_dir>/scripts/owe.mjs doctor
```

Prepare the default 30-day report:

```bash
node <skill_dir>/scripts/owe.mjs prepare --since 30d --content compact
```

The default `--server auto` mode selects a free localhost port, waits for the
server health check, and stops only the process started by OWE after the
operation. To use an existing server explicitly:

```bash
node <skill_dir>/scripts/owe.mjs doctor --server existing --base-url http://127.0.0.1:4096
```

The standard output is one canonical report:

```text
$OWC_PATH/ (or the documented default when unset)
└── report.json
```

`report.json` is the canonical audit artifact. `brief`, `list`, and `show` build
bounded local projections from it; do not read the JSON in full during standard
analysis.

Each successful `prepare` writes a complete temporary report with mode `0600`
and publishes it with one atomic rename. Failed preparation does not replace a
previous report. Legacy `CURRENT`, `generations/`, or old `index.json` layouts
are not migrated; the CLI asks the user to run `owe prepare` again.

Reports are local diagnostic artifacts and may contain user prompts, task prompts, paths,
queries and assistant responses when enabled in the privacy configuration. By default they
are written under `$OWC_PATH`, then `$CACHE_PATH/owc`, or `./var/agent/cache/owc`.
The generated files are disposable and should be removed when their source sessions are no
longer needed.

## Mandatory reading order

1. Run `owe brief`.
2. Validate data quality, pricing coverage, warnings, and sample size.
3. Select at most 3–5 recurring patterns materially relevant to the user's objective.
4. Drill down with `list` and `show`.
5. Inspect overlap details only for important subagents or suspicious delegations.
6. Read a root detail only when bounded semantic hints remain insufficient.
7. Do not read `report.json` unless auditing or debugging OWE.
8. Do not inspect application source code, Git history, or raw OpenCode output unless the user explicitly requests repository-level verification.

The standard drill-down is adaptive: run `owe brief` first, then stop when it answers
the baseline question. Use `list models --limit 10` or `list activities --limit 10`
only when a fuller ranking is needed; use `list subagents --limit 10` and at most
selected overlap details for delegation analysis; use `list patterns --limit 10`
and no more than 3-5 pattern details for new candidates. Use text `show root` only
when bounded semantic hints remain insufficient; its default output is bounded, while
`show root --json` is an explicit audit/debugging read.

Useful navigation:

```bash
node <skill_dir>/scripts/owe.mjs brief
node <skill_dir>/scripts/owe.mjs list models --limit 10
node <skill_dir>/scripts/owe.mjs list activities --limit 10
node <skill_dir>/scripts/owe.mjs list subagents --limit 10

node <skill_dir>/scripts/owe.mjs list patterns --sort total-cost --limit 10
node <skill_dir>/scripts/owe.mjs list patterns --view high-cost-read-only --limit 10
node <skill_dir>/scripts/owe.mjs show pattern <pattern-id>

node <skill_dir>/scripts/owe.mjs list overlaps --diagnostic strong_repeated_work_signal
node <skill_dir>/scripts/owe.mjs show overlap <delegation-id>

node <skill_dir>/scripts/owe.mjs list roots --sort cost --limit 10
node <skill_dir>/scripts/owe.mjs show root <session-id>
```

Use `--json` only when machine-readable detail is required.

## Analysis procedure

### 1. Validate evidence

Check:

- pricing and usage coverage;
- incomplete provider steps;
- invalid or unlinked task-to-child relations;
- activity-classification ambiguity;
- number of distinct root sessions behind recurring patterns;
- overlap diagnostics with insufficient evidence;
- report truncation and pattern-group limits.

Never treat missing pricing as zero cost. Never present a small or one-session sample as a stable workflow pattern.

### 2. Establish the cost baseline

Report:

- total API-equivalent cost and pricing coverage;
- cost share by main agent, subagent, model, and additive `primary_activity`;
- delegation and configured fallback counts;
- recurring-pattern count and accumulated cost;
- retry, error, and output-size signals where material.

Do not sum `by_activity_signal` or involved-step cost rows. They are intentionally non-additive.

### 3. Interpret activity conservatively

Every step retains multiple observable activity signals.

- `primary_activity` is a deterministic navigation label used for additive accounting and span boundaries.
- `activities` contains all co-occurring signals.
- `activity_classification.resolution` is `direct`, `dominant`, `mixed`, `weak`, or `unknown`.
- `activity_classification.evidence` explains the classification.

Never treat `primary_activity` as the complete semantic purpose of a task.

### 4. Analyze recurring operational patterns

Start with main-agent patterns ranked by accumulated cost and frequency. Do not analyze all groups merely because they exist.

For each selected pattern:

- report occurrences, distinct sessions, distinct roots, total cost, median, and p90;
- inspect representative examples;
- describe the structural shape, such as `repository.search → file.read{4-7}`;
- test whether the examples are semantically coherent;
- only then infer a possible task class and delegation opportunity.

A deterministic structural group is not automatically one semantic task class. If the examples represent unrelated work, keep it as an operational family and do not recommend one specialized subagent.

Prefer candidates that are frequent, costly in aggregate, bounded, weakly coupled to ongoing architectural reasoning, and capable of returning a compact evidence-based result. Write-involving and mixed patterns may be candidates, but require stronger scrutiny than read-only work.

### 5. Diagnose child-to-parent overlap

Use these diagnostic levels:

- `no_overlap_observed_in_window`;
- `possible_repeated_work`;
- `strong_repeated_work_signal`;
- `mixed_followup`;
- `insufficient_evidence`.

Interpret them conservatively:

- exact path/query/symbol/command matches are stronger than similar operation sequences;
- overlap before the parent's first write is more suggestive of repeated discovery;
- reads after writes or during verification may be deliberate validation;
- `strong_repeated_work_signal` requires its threshold from ordered pre-write path/query/symbol intersections only;
- command matches are a separate weaker signal, and post-write exact matches are reported as `mixed_followup` rather than strengthening `strong`;
- shared operation types, structural families, Jaccard and LCS are bounded descriptive context only; they never raise a repeated-work label;
- even `strong_repeated_work_signal` is diagnostic evidence, not causal proof of waste.

For material delegations report child cost, bounded parent follow-up cost, exact resource matches, pre-write matches, structural-family overlap, window stop reason, and printed limitations.

Timing is canonical: child completion is the latest known completion timestamp
from the complete child subtree. The single bounded parent window separates
`ordered_after_child`, `unordered`, and `overlapping` evidence. Only ordered
steps affect repeated-work labels or parent follow-up cost; unordered and
overlapping steps are reported as unassigned exposure. Missing timing must be
called out as a limitation and cannot produce a strong or possible repeated-work
label.

### 6. Evaluate subagents and fallbacks

For each important subagent or hybrid family consider:

- delegating-step overhead;
- child direct and subtree cost;
- returned output size;
- fallback frequency and additional fallback cost;
- distribution of no-overlap, mixed, possible, and strong repeated-work diagnostics;
- whether the parent proceeds to implementation/verification or repeats discovery.

Do not claim why a fallback occurred solely from sequence. Do not attribute all parent follow-up cost to the child result.

### 7. Separate certainty levels

Use these labels explicitly:

- **Measured:** tokens, prices, tool counts/status, validated links, direct/subtree cost, exact hashed resource matches, fallback counts.
- **Deterministic structural:** activity signals, fingerprints, exact pattern membership.
- **Contextual diagnostic:** bounded parent follow-up and overlap classification.
- **Inferred:** semantic task class, delegability, likely redundancy, expected savings, and quality risk.

Expected savings must be a range with assumptions. Never subtract child cost from a main-agent span as if the two executions were guaranteed substitutes.

## Required output

Produce:

1. **Executive verdict** — the largest credible opportunity and its evidence strength.
2. **Recurring main-agent patterns** — only the selected high-value groups, ranked by accumulated cost and frequency.
3. **Delegation candidates** — inferred task class, evidence, upside, risk, and confidence.
4. **Existing subagent economics** — useful, neutral, or likely additive behavior.
5. **Child-to-parent overlap** — aggregate results and important examples with limitations.
6. **Hybrid and fallback economics** — frequency and additional cost.
7. **Do not delegate** — work that should remain with a strong agent.
8. **Evidence limits and next observations** — missing data or signals to watch in future history.

Do not propose or launch an orchestration framework. Recommendations may describe a small future validation step, but OWE itself remains diagnostic.

Read supporting references only when needed:

- `<skill_dir>/references/methodology.md`
- `<skill_dir>/references/decision-matrix.md`
- `<skill_dir>/references/bundle-schema.md`
- `<skill_dir>/references/field-inventory.md` when auditing report-field changes
