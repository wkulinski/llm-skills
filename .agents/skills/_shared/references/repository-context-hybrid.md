# Repository-context hybrid

## Purpose

Use one deterministic primary/fallback flow for repository-context discovery.
The primary is `context-scout-fast` (DeepSeek V4 Flash Max + CMM); the fallback
is the independent `context-scout` (Luna High). Luna High is intentionally the
higher-reasoning second pass. Its additional cost is bounded because the helper
authorizes at most one fallback and only after the primary is rejected.

This policy applies to every `repository-context` brief, including `targeted`
and `cross-layer`. There is no direct scout route: targeted work also starts in
the primary and the fallback is always decided by validation, not by the task
name.

## Inputs

Both agents receive exactly the same:

- original task prompt;
- repository handoff;
- context manifest;
- criteria file.

### Input storage

Before `prepare`, the main agent MUST put every newly created immutable input
under repository-local `CACHE_PATH` (default: `./var/agent/cache`). New prompt,
handoff and criteria files should use a dedicated
`${CACHE_PATH}/repository-context/<task-slug>/` directory; a valid manifest
already stored under `CACHE_PATH` may be reused. The exact paths passed through
`--prompt-file`, `--manifest`, `--handoff`, `--criteria` and `--output-dir` must
remain under repository-local `CACHE_PATH`.

Never use `/tmp`, a home directory or another external location for files that
will be read by a scout. Choose the cache paths before `prepare`; an
`INPUT_INVALID` path rejection is a safety failure to correct, not a normal
discovery outcome or a way to probe permitted locations.

The manifest is the only source of repository, branch, HEAD and already-read
paths. The handoff contains only mode, normalized task brief, decisions and
constraints. The criteria file is the only source of acceptance criteria.

The fallback must not receive the primary's partial report, failure explanation,
hypotheses or unverified evidence. These remain orchestration metadata.

### Criteria and manifest migration

Criteria files remain backward compatible. `context-criteria.mjs` normalizes
legacy criteria to schema version `2`: an evidence entry with literal `anchors`
becomes `anchor_mode: required-literal`, while an entry without anchors becomes
`anchor_mode: scout-selected`. New criteria should declare `anchor_mode`
explicitly. Preflight still validates the exact path or path prefix, relation and
required literals before creating a claimable run, so legacy fixtures do not need
a mass rewrite. File budget wynika z konkretnych `required_evidence.path`, a
scout sam dobiera pozostałe minimalne evidence w stałym budżecie.

Manifests remain schema version `1`, but `prepare`, `validate` and `verify`
require repository, branch, HEAD and a complete worktree fingerprint. A legacy
manifest without that block must first be regenerated through
`context-manifest.mjs write`; validation returns
`MANIFEST_REGENERATION_REQUIRED` instead of mutating an immutable run input.
Paths remain repository-relative, and manifest/handoff inputs must contain
metadata rather than diff contents, reports or secrets. A changed fingerprint
requires a fresh manifest and a new run.

## Decision algorithm

1. Run helper `prepare`. Before delegation it validates the handoff with
   `.agents/skills/_shared/scripts/context-handoff.mjs`, then validate and verify
   the context manifest with `.agents/skills/_shared/scripts/context-manifest.mjs`;
   fail closed when the current Git metadata is unavailable or does not match.
2. After `prepare` the helper returns `CLAIM_PRIMARY`. The main agent calls
   `claim --attempt primary` to atomically move the attempt to running under a
   per-state lock and obtain a one-time dispatch token plus a ready-to-use
   `dispatch` object. The main agent passes `dispatch.subagent_type`,
   `dispatch.description` and `dispatch.prompt` directly to the native `task`
   tool. `dispatch.prompt` MUST be passed verbatim: never summarize, wrap,
   paraphrase or replace it with a reference such as "use the supplied prompt".
   The helper never starts OpenCode or an agent. A duplicate claim is rejected.
   Both scout adapters must read
   `./.agents/skills/_shared/references/repository-context-scout-playbook.md`
   before discovery; their local prompts contain only role-specific strategy and
   duplicated safety guards.
3. Call helper `settle --attempt primary --token <dispatch-token>`; its internal
   evaluation validates the report with:

   ```text
   node .agents/skills/_shared/scripts/context-scout-report.mjs validate \
     <report.json> --head <manifest.head> --criteria <criteria.json>
   ```

   The low-level `evaluate` operation requires the attempt to be running with the matching dispatch token;
   an attempt claimed but never evaluated stays in the running phase and is not
   silently finalized.
4. Accept the primary only when the validator exits with code `0`, the report
   status is `COMPLETE`, and every criterion has valid coverage.
5. The helper assigns every rejected input or attempt to one stable failure
   class. `INPUT_INVALID` and `SCOPE_INVALID` are deterministic preflight
   failures and stop before a claimable run. `SNAPSHOT_STALE` aborts the run and
   requires a new manifest or a new run. A claimed primary may request fallback
   only for a retryable class:

   | Class | Meaning | Primary next action | Retryable |
   |---|---|---|---|
   | `INPUT_INVALID` | missing/invalid required input, path or anchor | stop before claim | no |
   | `SCOPE_INVALID` | required surface exceeds the hard budget | stop before claim | no |
   | `SNAPSHOT_STALE` | immutable input changed after `prepare` | abort | no |
   | `AGENT_INCOMPLETE` | valid `INCOMPLETE`/`BLOCKED` discovery result | claim fallback | yes |
   | `AGENT_TIMEOUT` | external harness reported that it interrupted the attempt | claim fallback | yes |
   | `REPORT_MISSING` | claimed attempt left no report artifact | claim fallback | yes |
   | `REPORT_INVALID` | report schema, mode or coverage validation failed | claim fallback | yes |
   | `REPORT_WRITE_FAILED` | report artifact could not be written/read/recovered | claim fallback | yes |

   For a claimable run, the failure class is recorded in state and final
    metadata; preflight failures carry the class on the structured error because
    no claimable state is created. The helper does not infer timeout from elapsed
    duration: `durationMs` is an observational metric. An external harness may
     pass an explicit timeout acknowledgement after actually interrupting a task;
     the helper remains authoritative for classification.
   Schema-valid `INCOMPLETE` i `BLOCKED` pozostają niezaakceptowane, ale są
   zachowywane pod `partialReportPath` zamiast przenoszenia do `discarded`.
   Claimed attempt bez raportu pozostaje `REPORT_MISSING`; helper nie tworzy
   sztucznego raportu bez evidence i zachowuje normalną decyzję o pojedynczym
   fallbacku.
6. Delegate exactly one `context-scout` fallback through native `task` only when
    `settle` returns `CLAIM_FALLBACK`, then call `claim --attempt fallback` to
    obtain its dispatch token and ready-to-use `dispatch` object. Pass that
    object's fields directly to native `task`, including `dispatch.prompt`
    verbatim. The fallback receives the same immutable inputs and budget, never
    the primary's report or failure explanation.
7. Call `settle --attempt fallback --token <dispatch-token>` with the same
   immutable inputs. A rejected fallback always finalizes the run and never
   creates another fallback.
8. Return the valid final report, or the actual failure status plus
   `partialReportPath` if an attempt produced a schema-valid partial report.
   Never create a second fallback. `finalize` records `fast_first_pass`,
   `fallback_count`, `hybrid_final`, and the failure class for each attempt.
   Partial artifacts do not set `hybrid_final` and downstream remains blocked
   unless the active skill explicitly permits using bounded partial evidence.
9. After a successful `prepare`, always end through `settle` or `abort`, also
   when task delegation or report writing fails. `evaluate` and `finalize`
   remain low-level diagnostic operations, not a second canonical happy path.

## Agent boundaries

- Neither scout may delegate another scout or invoke this helper.
- `context-scout-fast` is never run standalone; the main agent delegates it
  through native `task` only after `prepare`.
- `context-scout` is delegated directly by the main agent only after the helper
  returns `CLAIM_FALLBACK` and the main agent claims that attempt.
- Neither scout may edit files, run QA/review, create commits, read issues or
  comments, or execute `$context-refresh`.
- The main agent owns orchestration, validation and metrics.
- The fallback is an independent retry, not a continuation of primary context.
- Schema-invalid, mode-mismatched or unreadable reports are moved to a run-scoped
  discarded artifact before fallback delegation. Schema-valid `INCOMPLETE` and
  `BLOCKED` reports remain at their original path as partial artifacts. Fallback
  still receives only its own report path.
- If the helper cannot be started or a phase/token check fails, stop and report
  the blocker; do not bypass the primary.
- After a validated final report, the main agent may perform targeted reads for
  implementation or review but must not repeat broad repository discovery.

## Run isolation

The controller does not use a worktree-wide lock. Recursion and duplicate
attempts within one run are prevented by native task delegation, denied
task/helper execution in scout permissions, unique `runId` artifact paths, and
fail-closed phases. Independent runs may execute concurrently; each run keeps
its own state, reports, input hashes, and final metadata. Claim transitions use
a per-state lock; no worktree-wide lock is required.

An active or finalized run blocks another `prepare` with the same logical input
hash. An `ABORTED` run may be retried only by passing its exact identifier as
`--retry-aborted <runId>`; the new state records that identifier as `rerun_of`.
Changed criteria, strategy or snapshot produce a new hash and do not use this
recovery flag.

## Benchmark snapshot requirements

Benchmark harnesses must generate prompt, handoff, criteria and manifest inputs
for the exact snapshot being measured. The manifest and all input hashes must be
recorded in run metadata, and the snapshot hash must be checked before and after
execution. A result with a stale manifest, changed snapshot, missing runtime
dependency, or unclassified harness must not be presented as canonical.

## Metrics

Record separately:

```text
protocolVersion
primaryAgent
fallbackAgent
fast_first_pass
fallback_count
hybrid_final
failure_class
primary.valid
primary.status
primary.failure_class
primary.partialReportPath
primary.durationMs
fallback.used
fallback.valid
fallback.status
fallback.failure_class
fallback.partialReportPath
fallback.durationMs
final.agent
final.status
final.failure_class
final.partialReportPath
```

Durations are measured automatically from delegation readiness to `settle`;
the optional `--duration-ms` value may override them for an external harness.
Durations do not invalidate an otherwise valid report; `AGENT_TIMEOUT` requires
an explicit timeout acknowledgement from a controller that interrupted the task.

## Regression matrix

The final `_shared` matrix is intentionally distributed across focused tests:

| Area | Verification |
|---|---|
| Criteria anchors and budgets | `context-criteria.test.mjs` |
| Retry classes and report lifecycle | `context-scout-report.test.mjs` |
| Secret false/true positives | `secret-detector.test.mjs`, `context-handoff.test.mjs`, `context-manifest.test.mjs` |
| Scout permissions and native integration | `context-scout-agent-contract.test.mjs`, `context-scout-opencode.integration.test.mjs` |

The matrix covers criteria validation, report validation, secret handling and
scout permission contracts. Benchmark and live smoke checks remain optional
cost-bearing layers.

Do not describe `hybrid_final: 8/8` as `primary: 8/8`.

## Controller commands

The main agent uses the state and `runId` returned by each step:

```text
node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs prepare \
  --prompt-file <prompt> --manifest <manifest> --handoff <handoff> \
  --criteria <criteria> --output-dir <output> --title <title>

# Every placeholder above resolves under repository-local CACHE_PATH.

# Claim the next attempt to obtain a one-time token and native task dispatch.
node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs claim \
  --state <statePath> --run-id <runId> --attempt primary

# Call native task with claim.dispatch.subagent_type, description and prompt.
# Pass claim.dispatch.prompt verbatim; do not summarize or replace it.

node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs settle \
  --state <statePath> --run-id <runId> --attempt primary --token <dispatch-token>

# Delegate fallback only when next.action is CLAIM_FALLBACK, then claim it.
```

`claim` is idempotence-guarded: it atomically moves the attempt from pending to
running, emits a one-time dispatch token and a ready-to-use `dispatch` object,
and rejects duplicate claims. It does not expose parallel top-level agent or
prompt fields. `settle` requires the matching token and a running phase. The
low-level `evaluate` and `finalize` commands exist for diagnostics and
state-machine tests.

The scout writes the complete report artifact to the path returned by `claim` and
returns only a compact acknowledgement. The acknowledgement is diagnostic
metadata; the helper always validates the report file itself.

If orchestration must stop before `settle`, call `abort` with the same state
and `runId` so the run is marked `ABORTED`.

## No benchmark overfitting

Prompts and agent instructions may improve general discovery, evidence handling,
budget management and report finalization. They must not contain task-specific
paths, symbols, expected findings or instructions that solve a benchmark case.

## Testing layers

- Use Vitest for validators, state transitions, isolation, artifact paths, metrics
  and static prompt contracts.
- Use `opencode debug agent <name>` for integration tests of the resolved agent
  description, permissions and tool visibility without invoking a model.
- Keep live model/task tests optional and explicitly gated because they incur
  cost and can depend on external MCP state. OpenCode's V2 Session SDK may drive
  create/prompt/wait/event flows when a repeatable end-to-end harness is needed.
- A live smoke test must use the native `task` path and the same
  `prepare`/`claim`/`settle` controller; never restore `opencode run`.

## Helper contract

The shared helper
`.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs` implements a
`prepare` → `claim` → `settle` state machine plus `abort`. Low-level `evaluate`
and `finalize` operations support diagnostics and tests. The helper must keep the
original prompt/handoff/manifest/criteria unchanged between primary and
fallback, isolate concurrent runs by unique artifact paths, reject invalid
phases and run IDs, and emit machine-readable metadata for both attempts. It
must never spawn `opencode` or any other agent process.
