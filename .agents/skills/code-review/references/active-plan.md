# Active plan for code review

Load this reference for a `code` target when "Active-plan context for code" in
`SKILL.md` selects it: the caller supplied a plan, or automatic lookup is allowed
and the `plan-execute` pointer exists.

## Resolve the plan

When the plan comes from the pointer, resolve its single repository-relative
canonical plan path; never treat the pointer as a copy of the plan or as a
source of work-package status.

For a supplied or pointer-resolved plan:

- validate the plan through the `$task-plan` contract before relying on it, and
  record an invalid, stale, or non-canonical plan as a coverage gap;
- determine whether the reviewed change maps to the current work package or to
  another explicitly identifiable work package, using the changed behavior,
  scope, and execution evidence rather than filename similarity alone;
- assess the mapped work package under "Active-plan alignment" below;
- if the mapping is ambiguous, do not infer plan compliance. Record the plan
  alignment as `NOT_COVERED` or raise a `QUESTION` when it materially affects
  confidence.

An active plan is an additional source of expected behavior, never a substitute
for reviewing correctness, propagation, contracts, or operational risk in code.

## Active-plan alignment

When a valid active plan was identified, assess the change against the mapped
work package as well as the normal code-review contract:

- does the implemented behavior satisfy the work package's objective and
  acceptance criteria?
- has the change stayed inside its stated scope and out-of-scope boundary?
- are prerequisite work packages, ownership boundaries, and dependencies
  respected?
- does the chosen verification provide the evidence promised by the work
  package, or is a deviation justified and visible?

Do not turn this into a full review of every work package or a replacement for
the code review. A plan mismatch, omitted acceptance criterion, or unjustified
scope expansion is a code-review concern when it affects the reviewed change.
Report the outcome under "Plan alignment" in the `SKILL.md` output format.
