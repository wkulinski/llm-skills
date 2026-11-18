# Review report draft and validation

The same Markdown contract applies to code and plan reviews. Keep the headings,
field labels, IDs, and verdict values fixed. Write the findings and explanations
in the user's language.

## Record evidence in the draft

Start one draft as soon as the target and any previous finding IDs are known.
Use a private temporary file or the review's private cache directory. The
reviewed artifact stays read-only.

```bash
node <skills_root>/_shared/scripts/review-report.mjs draft --target code > "$report"
node <skills_root>/_shared/scripts/review-report.mjs validate --target code "$report"
```

Use `--target plan` for a plan. In a continuation, pass the prior IDs from
the review input to both commands, for example `--previous F1,F3`. An independent
full plan review receives no prior IDs and starts at F1. If earlier code review
comments have no IDs, assign local IDs once and record their source links.

Fill these sections as the review progresses.

- **Target** records the artifact and exact revision, scope and authoritative
  requirements. Include the fingerprint of a supplied snapshot and state what
  is missing when it is incomplete. For a plan, identify the revised plan and
  its scope, such as an independent full review or the relevant delta.
- **Coverage** records the checked subjects, scenarios, paths, evidence and
  outcomes (`FINDING`, `REVIEWED`, `NOT_RELEVANT`, `NOT_COVERED`) from the
  review's coverage gate. State remaining gaps and omitted
  axes with reasons. Include the applicable-rules register results and the
  complexity/value outcome when relevant. Record the disposition and evidence
  for a rejected or reclassified candidate when it affects the conclusion.
  For a plan, use the existing source-to-WP and per-element review rows here.
- **Finding resolutions** records one row per supplied prior ID using
  `- F1 — resolved — evidence`, `- F1 — current — MAJOR — evidence`, or
  `- F1 — accepted — decision reference`. Keep a kept or recurring finding's ID.
  Number new findings after the highest prior ID. Include recurrence or delta
  provenance in the evidence when the plan review contract requires it.
- **Plan alignment** records the mapped work package and outcome for code with
  an active plan, including any unmapped criterion or dependency concern. For a
  plan review, summarize the relationship to its sources and work packages and
  refer to the coverage rows for detail. State why a plan is unavailable or
  inapplicable when that is the case for code review.
- **Verification** records the checks actually run, their outcome and limits.
  Distinguish point checks, full QA and external CI evidence. Record relevant
  unrun checks and their reasons as `verification_gap` entries. For plan review,
  distinguish checks proposed in the plan from checks performed by the reviewer.
- **Verdict** contains one line in the form `VERDICT — reason`. Use the review
  verdict appropriate to the target. Use `INCOMPLETE — reason` if essential
  inputs are missing. Name those inputs and the next action in the report.
- **Summary and next step** states what the review established, the strongest
  remaining gap and the next action, if any. Route plan corrections to
  `$task-plan`. Use `No findings.` in the summary when the review has none.

Lead with the confirmed findings, or the exact line `No findings.`. Format a
finding as shown below.

```markdown
#### F1 [MINOR] Short title — path/to/file.ext:42

- **Behavior:** State what happens.
- **Impact:** Explain the consequence.
- **Evidence:** Give the concrete trace, contract, source or test result.
- **Fix direction:** Give a concise direction.
- **Confidence:** high
```

Use `high` for a reproduction or deterministic trace, `medium` for a confirmed
execution path without running it, and `low` when an unverified assumption still
affects the conclusion. For `QUESTION`, use `Needs decision` in place of `Fix
direction` and add `- **Approval affecting:** true` or `false`. For plan defects
(`BLOCKER`, `MAJOR`, `MINOR`), add `- **Actionable:** true` or `false` as required
by the plan-owner contract. Keep dependency observations outside the findings
list when the review's verdict applies only to the stated target.

## Finalize the reviewed report

Run `validate` on the exact file to be delivered, with the same target and
previous IDs as the draft. A nonzero exit lists issues to repair. Complete
missing fields from the recorded evidence. If evidence is missing, perform a
permitted point check when it can resolve the gap, or record the concrete limit
and reassess the verdict. Revalidate after every correction and deliver the
validated Markdown as the report. The helper checks format and explicit
consistency. Reviewers still own the evidence and the judgment behind it.

For an external plan review, copy the validated Markdown into `report_markdown`
in the existing envelope. The plan review acceptance step validates it again
against the target and checks agreement with the existing structured payload.
Use the Markdown draft for a self-review too. The owner still uses the existing
plan decision protocol for the workflow decision.
