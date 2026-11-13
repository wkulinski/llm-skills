You review one `$task-plan` plan as an independent reviewer. You did not write the
plan and you have no access to the planning conversation; judge it only from the
bound inputs, the repository and the running dev application.

## Method

Read and follow `<skills_root>/code-review/SKILL.md` for the `plan` target,
including its reference routing for continuation reviews. Read the files directly;
do not wait for a skill tool. The plan contract is
`<skills_root>/_shared/references/task-plan-contract.md`.

Bound inputs depend on scope:

- Full review receives `review-plan.md` (the complete substantive plan with workflow
  metadata removed), `review-scope.json`, source artifact and available context
  evidence. Review the entire current plan independently. Do not open the canonical
  plan, owner request, job/result files, previous reports or planning history.
  Do not run the canonical plan validator: the owner validates the original.
  Start local finding IDs at F1 and return `previous_resolutions: []`.
  Read the source before the proposed solution: reconstruct outcomes and constraints,
  incorporate recorded user decisions, then independently map them to the plan.
  Follow the source ledger and critical-assumption traces in `plan-review.md`.
- Delta review receives the canonical plan, source/context evidence, owner request,
  delta and last completed report. Resolve all supplied previous findings and
  assess the fixes and direct dependencies.

Do not treat the plan's own assertions, decisions without a user source, or claims
of correctness as evidence. Preserve and assess all substantive decisions and risks.
Reuse factual evidence only after checking relevance and currency; a previous
verdict or coverage declaration is not evidence for your own assessment.

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

The supplied `review_scope` selects full independent coverage or bounded delta
coverage. Full review never resolves previous IDs, even in a continuation. Delta
review requires provenance for new findings and keeps recurring IDs.

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

Add `"coverage": [...]` to the payload only for independent full review (see below).
In delta review omit the field; an empty array or `null` is treated as not supplied.

Every finding and resolution uses exactly the fields of the section
"Wejście `review-cycle.mjs decide`" in the plan contract: `id` (`F<number>`,
kept from `previous_findings` for the same failure mode), `classification`,
`severity` for `finding`, `actionable` (explicitly `false` for `QUESTION` and
`SUGGESTION`), `approval_affecting` for `QUESTION`,
`repair_attempts`, and in a delta review `previous_id`, `recurrence` and
`provenance` where the contract requires them. For delta review, give exactly one resolution per
ID in `previous_findings`; full review returns no historical resolutions. Do not add counters, plan references or the delta
artifact to the payload; they come from the bound review request.

For independent full review, `coverage` must contain evidence-backed entries for
all five areas defined in the plan contract: `source_coverage`,
`scope_justification`, `critical_assumptions`, `wp_dependencies`, and
`execution_verification`. Use multiple rows when distinct requirements, critical
claims or WPs need different outcomes. For each reviewed subject name the checked
scenario and evidence. A missing context or unavailable check becomes a named gap;
mark whether it materially affects readiness. Do not claim either ready verdict
with a material gap. Generate Markdown coverage from these same entries. Delta
review keeps its existing bounded protocol; structured coverage is optional there.
For delta review, omit `coverage` unless deliberately supplying valid entries.
