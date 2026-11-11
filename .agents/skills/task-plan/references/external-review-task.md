You review one `$task-plan` plan as an independent reviewer. You did not write the
plan and you have no access to the planning conversation; judge it only from the
bound inputs, the repository and the running dev application.

## Method

Read and follow `<skills_root>/code-review/SKILL.md` for the `plan` target,
including its reference routing for continuation reviews. Read the files directly;
do not wait for a skill tool. The plan contract is
`<skills_root>/_shared/references/task-plan-contract.md`.

Bound inputs:

- the plan Markdown (`docs/plans/...`);
- its source artifact and, when present, the repository-context report and
  criteria from the plan front matter;
- in every continuation, the last completed round's report and finding IDs:
  either an accepted external result or the owner's self-review report with
  `reviewer.mode: self`, `plan`, `report_markdown` and `payload`; this may be
  newer than the last external job and is the source for previous findings;
- the review request JSON: `full_review_count`, `delta_review_count`, the `plan`
  reference or the `delta_review` artifact, and `previous_findings` with the IDs
  you must resolve.

Answers recorded in the plan as `[answered]` with `Source: current conversation`
are the user's decisions; you cannot see the conversation, so do not ask for proof
of them. Challenge such a decision only under the rules of `plan-review.md`.

You may run focused read-only commands (search, tests that do not write to the
repository) and drive the dev application through Playwright CLI according to
`<skills_root>/_shared/references/playwright-cli-verification.md` when a plan
claim depends on rendered behavior. The application runs on a dev environment
with test data; keep interactions read-only unless the user explicitly authorizes
changes to application data. Keep screenshots and other artifacts
under the cache directory named above.

Do not edit the plan, do not create questions in it, and do not run
`$task-plan`, its scripts that write (`store.mjs`, `edit.mjs`) or the
repository-context hybrid. Report a missing decision as a `QUESTION` finding.

The request's `review_scope` selects coverage: `full` means the whole plan,
including independent unchanged areas; `delta` means the fix and its direct
dependencies. If absent in an older request, infer `delta` when
`delta_review_count > 0`, otherwise `full`. Every continuation resolves all
previous finding IDs; the delta artifact binds versions even in a full review.
New findings in a delta review need fix provenance; a full review does not
require it for independently discovered defects. Recurring findings still keep
their IDs and recurrence assessments. Never reset counters or choose a narrower
scope than the request.

## Result

`report_markdown` is the review report in the `$code-review` output format for
the `plan` target. `payload` is:

```json
{
  "verdict": "PLAN READY | PLAN READY WITH CAVEAT | PLAN DISCUSS | PLAN CHANGES REQUESTED | PLAN BLOCKED",
  "findings": [],
  "previous_resolutions": []
}
```

Every finding and resolution uses exactly the fields of the section
"Wejście `review-cycle.mjs decide`" in the plan contract: `id` (`F<number>`,
kept from `previous_findings` for the same failure mode), `classification`,
`severity` for `finding`, `actionable` (explicitly `false` for `QUESTION` and
`SUGGESTION`), `approval_affecting` for `QUESTION`,
`repair_attempts`, and in a delta review `previous_id`, `recurrence` and
`provenance` where the contract requires them. Give exactly one resolution per
ID in `previous_findings`. Do not add counters, plan references or the delta
artifact to the payload; they come from the bound review request.
