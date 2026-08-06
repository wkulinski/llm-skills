# Methodology

## Evidence layers

OWE separates four layers:

1. **Measured** — normalized provider usage, tool metadata, timestamps, validated links, and locally configured pricing.
2. **Deterministic structural** — activity signals, spans, fingerprints, and exact canonical pattern membership.
3. **Contextual diagnostic** — bounded parent follow-up and child-to-parent overlap classification.
4. **Agent inference** — semantic task class, delegability, likely redundancy, expected savings, and quality risk.

The final layer must never be presented as directly measured.

## Progressive disclosure

The complete `report.json` is the audit source of truth, but it is not the standard LLM input. The analysis agent should:

1. run `owe brief`;
2. select a small number of economically material patterns;
3. inspect their bounded `show pattern` projections;
4. inspect overlap or root details only when necessary;
5. avoid loading `report.json` unless auditing OWE.

This prevents duplicate cross-sections from being mistaken for independent observations and controls context cost.

## Pattern methodology

Grouping uses an exact versioned identity made of scope, primary activity,
collapsed operation sequence, and mutation mode. Neighbor activity, output size,
step/tool count buckets, model, price, session ID, timestamp, and raw content do
not define a group. They remain diagnostics inside it.

A group is a repeated operational shape, not a semantic task class. Semantic coherence must be checked from representative examples before recommending a specialized subagent.

Representative sampling prefers distinct root sessions in this order: an example
near the median cost, the highest-cost example from another root, and an atypical
tool-count or operation-shape example from another root. A pattern observed in
only one root is explicitly limited and must not be treated as a stable delegation
class.

Accumulated cost and distinct root-session count are generally more important than a single expensive occurrence.

## Overlap methodology

The child completion timestamp is the latest known completion timestamp from the
entire child subtree. One bounded parent window is classified into:

- `ordered_after_child`: parent start is at or after child completion;
- `unordered`: parent start is unavailable, or child completion is unavailable;
- `overlapping`: parent starts before child completion and ends after it.

Only ordered steps contribute to parent follow-up cost and repeated-work labels.
Unordered and overlapping steps remain separate, unassigned exposure. Exact
resource-key equality is stronger than structural similarity. A strong repeated-
work signal must meet its threshold using ordered path/query/symbol intersections
before the parent's first write. Command matches remain a separate weaker signal
and never contribute to `strong_repeated_work_signal`; exact matches after the
first parent write are reported as `mixed_followup` and do not strengthen strong.
Matches before the parent's first write are more suggestive of repeated discovery.
When a structured read-purpose event is unambiguously correlated with an exact
pre-write path match and no stronger repeated-work evidence wins, classify it as
`declared_read_context` instead of ordinary repeated work. The declared context
remains attached to the evidence when a stronger label is retained. It preserves
exact matches and costs while recording a workflow declaration; it is not proof
that the read was necessary.
Jaccard, LCS, shared operation types and structural families remain bounded
descriptive observations after the Stage 11 ablation; they do not promote a
delegation to `possible_repeated_work` or `strong_repeated_work_signal`.

Overlap can still be necessary verification. Diagnostic labels intentionally avoid causal claims or a synthetic redundancy score.

## Economic interpretation

Direct child cost, child subtree cost, delegating-step overhead, parent follow-up exposure, and fallback cost are separate quantities. Do not add or subtract them without checking whether records overlap and whether the compared work is actually substitutable.

Expected savings should be a range with explicit assumptions, not a single exact forecast.

## Quality boundary

OWE can observe verification runs, retries, fallback, and repeated work, but it does not determine whether final code or analysis is correct. Result quality remains a separate judgment based on task-specific evidence.
