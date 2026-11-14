# Repository context

One `context-scout` collects evidence for the main agent. There is no automatic
fallback, second role or numeric discovery budget. Model and reasoning belong
to the consumer configuration. A second independent opinion is a separate,
explicit main-agent decision, never an error-handling branch.

## Harness-independent delegation

Use the current client's independent subagent mechanism (`task`, `Agent`,
`spawn_agent` or equivalent). These names are examples, not an allowlist. Start
with a fresh context containing the unchanged `dispatch.prompt`; do not fork
parent history. Map the logical `subagent_type` to a configured role when
available, otherwise a generic independent agent. A missing named role is not a
blocker and transport substitution requires no approval. Remember the returned
agent/session ID: report corrections must resume that same context.

The installation A supplies instructions and helpers. Consumer B is selected
before initialization. Run helpers with B as cwd. Prepare all new prompt,
handoff and criteria files and the context manifest under B's repository-local
CACHE_PATH resolved by `artifact-path.mjs cache-root`. The controller checks
input hashes and repository/branch/HEAD/worktree fingerprints before delegation
and validation. A snapshot change aborts the run; do not reuse stale evidence.
Installation instructions may be outside B; read-only file access is governed
by the scout playbook, not by the session directory.

## Lifecycle

1. `prepare` validates the immutable inputs, declared required paths/anchors and
   manifest. There are no file, symbol, command, step or report-length quotas.
2. `claim` returns a one-time token and `dispatch` for one `context-scout`.
   Delegate the prompt verbatim and retain the agent/session ID. A duplicate
   claim is rejected. The helper never starts an agent itself.
3. The scout reads the supplied playbook and inputs, discovers sources and
   writes its `.scout.json` using native `write`/`apply_patch`. It does not run
   helpers or validators. Read-only shell access is allowed when file tools are
   unavailable, under the playbook boundaries.
4. `settle` builds and validates the report. `RETURN_RESULT` finalizes any
   schema-valid COMPLETE, INCOMPLETE or BLOCKED report. Only COMPLETE means all
   criteria are covered; partial results retain their findings and explicit gaps.
   Downstream task-plan still requires COMPLETE before accepting planning evidence.
5. `REPAIR_REPORT` contains diagnostics and a repair prompt. Send it to the
   same scout agent/session; do not spawn another agent or repeat discovery.
   The scout fixes the report from already-read sources, or honestly marks
   missing evidence blocked. Call `settle` again with the same token. Previous
   diagnostics remain in state. Repeated error signatures, including cycles,
   end with STOP/NO_REPAIR_PROGRESS rather than an endless repair loop.
6. Abort when delegation is unavailable, the session cannot be resumed or the
   user stops work. A prepared run must end through `settle` or `abort`.

Historical protocol-5 runs are not resumed or rewritten. Prepare a new run with
the current helper. Unique run paths and a claim lock protect artifacts without
a cross-project registry. No automatic rediscovery or retry is hidden in prepare.

```text
node <skills_root>/_shared/scripts/context-scout-run.mjs prepare \
  --prompt-file <prompt> --manifest <manifest> --handoff <handoff> \
  --criteria <criteria> --output-dir <output> --title <title>
node <skills_root>/_shared/scripts/context-scout-run.mjs claim \
  --state <statePath> --run-id <runId>
node <skills_root>/_shared/scripts/context-scout-run.mjs settle \
  --state <statePath> --run-id <runId> --token <dispatchToken>
node <skills_root>/_shared/scripts/context-scout-run.mjs abort \
  --state <statePath> --run-id <runId>
```

## Discovery vs pointed reads

| Situation | Action |
|---|---|
| Known file/symbol/owner | Pointed read for a named uncertainty or read-before-write guard |
| Unknown owners/dependencies, cross-layer mapping | One scout through this lifecycle |
| Fresh report available | Reuse it; do not repeat broad discovery |
| Partial report with named gaps | Main agent resolves those gaps by pointed reads or reports the actual blocker |

A criterion and its declared evidence requirements determine completion, not a
counter. Prefer small relevant ranges and a concise report; large output should
be narrowed, not treated as exhausted budget. Required paths/anchors, valid source
ranges, proportional claims, role boundaries and tenant/project isolation remain
hard gates. Reports describe reads; they never establish snapshot freshness.
