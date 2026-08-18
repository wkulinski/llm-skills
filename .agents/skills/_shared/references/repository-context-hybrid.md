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

The manifest is the only source of repository, branch, HEAD and already-read
paths. The handoff contains only mode, normalized task brief, decisions and
constraints. The criteria file is the only source of acceptance criteria.

The fallback must not receive the primary's partial report, failure explanation,
hypotheses or unverified evidence. These remain orchestration metadata.

## Decision algorithm

1. Run helper `prepare`. Before delegation it validates the handoff with
   `.agents/skills/_shared/scripts/context-handoff.mjs`, then validate and verify
   the context manifest with `.agents/skills/_shared/scripts/context-manifest.mjs`;
   fail closed when the current Git metadata is unavailable or does not match.
2. After `prepare` the helper returns `CLAIM_PRIMARY`. The main agent calls
  `claim --attempt primary` to atomically move the attempt to running under a
  per-state lock and obtain
   a one-time dispatch token plus the exact task prompt, then delegates
   `context-scout-fast` through the native `task` tool using that prompt and
   report path. The helper never starts OpenCode or an agent. A duplicate claim is
   rejected. Both scout adapters must read
   `./.agents/skills/_shared/references/repository-context-scout-playbook.md`
   before discovery; their local prompts contain only role-specific strategy and
   duplicated safety guards.
3. Call helper `evaluate --attempt primary --token <dispatch-token>`; it validates
   the report with:

   ```text
   node .agents/skills/_shared/scripts/context-scout-report.mjs validate \
     <report.json> --head <manifest.head> --criteria <criteria.json>
   ```

   `evaluate` requires the attempt to be running with the matching dispatch token;
   an attempt claimed but never evaluated stays in the running phase and is not
   silently finalized.
4. Accept the primary only when the validator exits with code `0`, the report
   status is `COMPLETE`, and every criterion has valid coverage.
5. Delegate exactly one `context-scout` fallback through native `task` only when
   `evaluate` returns `CLAIM_FALLBACK`, which occurs for:
   - invalid or missing JSON;
   - validator failure;
   - `INCOMPLETE` or `BLOCKED`;
   - missing criterion coverage;
   - process timeout;
   - step limit before a valid report.
   Call `claim --attempt fallback` first to obtain its dispatch token and prompt.
6. Call `evaluate --attempt fallback --token <dispatch-token>` with the same
   immutable inputs, then call `finalize`.
7. Return the valid final report, or the actual failure status if both attempts
   fail. Never create a second fallback. `finalize` records `fast_first_pass`,
   `fallback_count`, and `hybrid_final`.
8. After a successful `prepare`, always end through `finalize` or `abort`, also
   when task delegation or report writing fails.
9. One-shot alternative: after `claim` and native task delegation,
   `settle --attempt primary|fallback --token <dispatch-token>` performs
   `evaluate` + `finalize` in a single operation. `settle` finalizes only when
   evaluation returns `FINALIZE`; for an invalid primary it returns
   `CLAIM_FALLBACK` and leaves the run in `FALLBACK_PENDING`. `settle-batch`
   reads a JSON list of `{state, runId, attempt, token}` entries from stdin,
   processes each independently, and returns machine-readable results (one
   failure never blocks the others).

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
- Invalid report files are moved to a run-scoped discarded artifact before
  fallback delegation; fallback receives only its own report path, while the
  original artifact remains available for audit.
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
primary.valid
primary.status
primary.durationMs
fallback.used
fallback.valid
fallback.status
fallback.durationMs
final.agent
final.status
```

Durations are measured automatically from delegation readiness to `evaluate`;
the optional `--duration-ms` value may override them for an external harness.

Do not describe `hybrid_final: 8/8` as `primary: 8/8`.

## Controller commands

The main agent uses the state and `runId` returned by each step:

```text
node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs prepare \
  --prompt-file <prompt> --manifest <manifest> --handoff <handoff> \
  --criteria <criteria> --output-dir <output> --title <title>

# Claim the next attempt to obtain a one-time dispatch token and task prompt.
node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs claim \
  --state <statePath> --run-id <runId> --attempt primary

# Delegate next.agent with next.taskPrompt through the native task tool.

node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs evaluate \
  --state <statePath> --run-id <runId> --attempt primary --token <dispatch-token>

# For the one-shot settlement path, replace evaluate+finalize with:
node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs settle \
  --state <statePath> --run-id <runId> --attempt primary --token <dispatch-token>

# Delegate fallback only when next.action is CLAIM_FALLBACK, then claim it.

node .agents/skills/_shared/scripts/context-scout-hybrid-run.mjs finalize \
  --state <statePath> --run-id <runId>
```

`claim` is idempotence-guarded: it atomically moves the attempt from pending to
running, emits a one-time dispatch token and task prompt, and rejects duplicate
claims. `evaluate` requires the matching token and a running phase.

The scout writes the complete report artifact to the path returned by `claim` and
returns only a compact acknowledgement. The acknowledgement is diagnostic
metadata; the helper always validates the report file itself.

If orchestration must stop before `finalize`, call `abort` with the same state
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
  `prepare`/`evaluate`/`finalize` controller; never restore `opencode run`.

## Helper contract

The shared helper
`.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs` implements a
`prepare` → `evaluate` → `finalize` state machine plus `abort`. It must keep the
original prompt/handoff/manifest/criteria unchanged between primary and
fallback, isolate concurrent runs by unique artifact paths, reject invalid
phases and run IDs, and emit machine-readable metadata for both attempts. It
must never spawn `opencode` or any other agent process.
