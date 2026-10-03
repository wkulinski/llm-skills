# Plan review

This file is the conditional reference of `$code-review` for the `plan` target.
Load it only when the review target is `plan`; a `code` review does not use it.
Each section extends the skill-root section (`<skill_dir>/SKILL.md`) with the
same topic.

## Plan expected behavior

For a `plan` target, the plan is the work product under review, not proof of its
own claims. Compare it with the referenced source artifact, explicit user
decisions, repository evidence, and the plan contract defined by `$task-plan`
(`<skills_root>/task-plan/SKILL.md`).
Do not treat `candidate paths`, `discovery debt`, or a plan's suggested diagnosis
as confirmed facts without supporting evidence.

A plan verdict is decided by this review, not inherited from a plan as owner, from
an auxiliary report, or from the plan's own structure. Report honest coverage; if
relevant evidence is unavailable, say so instead of lowering the bar for the
verdict.

## Plan context

For a `plan` target, also read the relevant `$task-plan` contract
(`<skills_root>/task-plan/SKILL.md`) and only the
repository documentation needed to verify ownership, boundaries, dependencies,
paths, or acceptance checks claimed by the plan. Do not turn plan review into a
second full implementation discovery pass.

## Plan integrity and execution readiness

Use this section only for a `plan` target. Check the plan against the `$task-plan`
contract (`<skills_root>/task-plan/SKILL.md`) without editing it:

- `Source and objective` describes the actual requested outcome, symptoms, constraints, and verified versus unverified claims;
- every source point is mapped to a WP or has a justified `excluded` decision;
- `Scope`, ownership, boundaries, dependencies, and WP order are consistent;
- `confirmed paths`, `candidate paths`, and `discovery debt` are kept distinct;
- `Direction, simplicity and consistency` names the existing mechanism, simpler alternatives, minimality, and ownership rather than asserting them generically;
- each WP has an actionable goal, scope, out-of-scope boundary, discovery notes, acceptance criteria, and verification;
- acceptance criteria have a concrete test or check, and the execution environment/command contract is internally consistent;
- every planned permanent test passes the **Durable tests versus one-off change verification** gate from the deep review checklists, applied to each listed test rather than replaced by a general coverage statement; history-only scenarios are removed from permanent test scope, while a scenario verifying an actual migration contract or target invariant stays, and any necessary one-off checks are explicitly distinguished in `Verification`;
- open questions, missing evidence, or discovery debt that could change public behavior, ownership, WP boundaries, data models, or acceptance criteria are treated as blockers or questions;
- the plan does not copy global workflow rules, describe its own drafting history, or claim `ready` independently of `$task-plan` validation.
- for source points about user interaction, the plan resolves every mismatch with a `Q<number> [open]` question, an `N<number> [note]` note, or a check; a conflict that changes acceptance criteria but is recorded only as a note is a plan finding.

When a plan is incomplete, report the missing evidence or contradiction in the
plan rather than inventing implementation details or silently correcting it. A
listed test or command is planned verification, not evidence that it was run.

## Plan coverage

For a `plan` target, also account for the source-to-WP mapping, required plan
sections, open questions, discovery debt, evidence artifacts, and execution
readiness. Do not treat a complete plan document as proof that its contents are
correct.

## Plan verdicts

For a `plan` target, use plan-specific wording:

- **PLAN BLOCKED** — a BLOCKER, invalid plan structure, or execution-blocking coverage gap remains;
- **PLAN CHANGES REQUESTED** — no blocker, but one or more MAJOR or actionable MINOR findings remain;
- **PLAN DISCUSS** — an approval-affecting QUESTION or high-risk `NOT_COVERED` area remains;
- **PLAN READY WITH CAVEAT** — only MINOR findings that are non-actionable or explicitly accepted by the user remain; an actionable MINOR forces `PLAN CHANGES REQUESTED` instead;
- **PLAN READY** — no unresolved plan defects or material coverage gaps remain.

For a `plan` target, a violated hard rule maps to at least `PLAN CHANGES
REQUESTED`; when its severity is `BLOCKER`, the verdict is `PLAN BLOCKED`. An
unresolved application of a hard rule maps to `PLAN DISCUSS`.

`PLAN READY` is a result of this read-only review phase, not the `$task-plan`
`ready` status. The canonical plan validator and plan owner remain responsible for
that status. `SUGGESTION` never changes the verdict or opens another round.
