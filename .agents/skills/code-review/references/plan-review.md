# Plan review

This file is the conditional reference of `$code-review` for the `plan` target.
Load it only when the review target is `plan`; a `code` review does not use it.
Each section extends the skill-root section (`<skill_dir>/SKILL.md`) with the
same topic.

## Plan expected behavior

For a `plan` target, the plan is the work product under review, not proof of its
own claims. Compare it with the referenced source artifact, explicit user
decisions, repository evidence, and the plan contract owned by `$task-plan`
(`<skills_root>/task-plan/SKILL.md`; document schemas in
`<skills_root>/_shared/references/task-plan-contract.md`).
Do not treat `candidate paths`, `discovery debt`, or a plan's suggested diagnosis
as confirmed facts without supporting evidence.

A plan verdict is decided by this review, not inherited from a plan as owner, from
an auxiliary report, or from the plan's own structure. Report honest coverage; if
relevant evidence is unavailable, say so instead of lowering the bar for the
verdict.

## Plan context

For a `plan` target, also read the relevant `$task-plan` contract
(`<skills_root>/task-plan/SKILL.md` and
`<skills_root>/_shared/references/task-plan-contract.md`) and only the
repository documentation needed to verify ownership, boundaries, dependencies,
paths, or acceptance checks claimed by the plan. Do not turn plan review into a
second full implementation discovery pass.

## Plan integrity and execution readiness

Use this section only for a `plan` target. Check the plan against the `$task-plan`
contract (`<skills_root>/_shared/references/task-plan-contract.md`, procedure owner
`<skills_root>/task-plan/SKILL.md`) without editing it:

- **sense before consistency:** for every planned change (each edited path and each `Scope` action) and every verification command, answer two questions separately: what requires it (source sentence, user decision, or acceptance criterion), and what concrete outcome is lost if it is removed. A source mapping proves only that the plan cites a point; a source requirement does not prove the action makes sense. No requirement means unrequested scope, at least MAJOR, including any edit to the plan's own source material, which stays read-only unless explicitly requested. Nothing lost on removal is a finding when the element traces only to the source's `Suggested diagnosis or solution`, an unclassified source sentence, or the planner's own inference: MAJOR for an edit or `Scope` action, actionable MINOR for a check. When it traces to `Requested outcome`, `Explicit constraints`, or a user decision (`D<n>`), the owner cannot drop it alone: raise an approval-affecting QUESTION that challenges the source instead of planning its execution. Once the user confirms such an element after the challenge, record it as `accepted` and do not raise it again. A check that confirms no acceptance criterion or named risk is an actionable MINOR: remove it rather than fix it;
- `Source and objective` states the requested outcome, and `Source assessment` separates the actual requested outcome, symptoms, constraints, and verified versus unverified claims;
- every source point is mapped to a WP or has a justified `excluded` decision;
- `Scope`, ownership, boundaries, dependencies, and WP order are consistent;
- `confirmed paths`, `candidate paths`, and `discovery debt` are kept distinct;
- `Direction, simplicity and consistency` names the existing mechanism, simpler alternatives, minimality, and ownership rather than asserting them generically;
- each WP has an actionable goal, scope, out-of-scope boundary, discovery notes, acceptance criteria, and verification;
- in a new plan, each WP's `Difficulty: v1` block matches the WP's actual execution, and its `Profile rationale` follows the contract format, names the threshold from that difficulty, and selects the same model and reasoning that `Execution environment` assigns to the WP (default or override); a missing or contradicting `Profile rationale` is at least MAJOR, because the validator does not check it; legacy plans without `Difficulty` are not a finding;
- a new plan has a 3–5 sentence preamble below its title and one closed, non-nested `details` block per section except the visible `Work package summaries`, with headings outside and exactly one blank line after `summary`; legacy unwrapped plans remain readable without mass migration;
- each `Work package summaries` entry matches its WP and describes only the change and result: a reader who knows the project goal but not the code or the conversation understands the outcome; exclusions belong in the full WP. An entry with exclusions, paths, code symbols, plan identifiers, unexplained jargon, or clipped keyword phrasing is an actionable MINOR finding, and an entry that adds scope, contradicts the WP's `Out of scope`, or leaves out a change the reader needs to understand the WP's result is at least MAJOR; leaving out a `Scope` detail that does not help that understanding is not a finding;
- acceptance criteria have a concrete test or check, and the execution environment/command contract is internally consistent;
- every planned permanent test passes the **Durable tests versus one-off change verification** gate from the deep review checklists, applied to each listed test rather than replaced by a general coverage statement; history-only scenarios are removed from permanent test scope, while a scenario verifying an actual migration contract or target invariant stays, and any necessary one-off checks are explicitly distinguished in `Verification`;
- open questions, missing evidence, or discovery debt that could change public behavior, ownership, WP boundaries, data models, or acceptance criteria are treated as blockers or questions;
- the plan does not copy global workflow rules, describe its own drafting history, or claim `ready` independently of `$task-plan` validation.
- for source points about user interaction, the plan resolves every mismatch with a `Q<number> [open]` question, an `N<number> [note]` note, or a check; a conflict that changes acceptance criteria but is recorded only as a note is a plan finding.

When a plan is incomplete, report the missing evidence or contradiction in the
plan rather than inventing implementation details or silently correcting it. A
listed test or command is planned verification, not evidence that it was run.

## Findings handed to the plan owner

The document contract (required sections and field schemas, including the
review-cycle input) is
`<skills_root>/_shared/references/task-plan-contract.md`; the owner procedure
belongs to `$task-plan` (`<skills_root>/task-plan/SKILL.md`). This review reports
against them and does not restate them. Return each finding in the
form the owner feeds to its review-cycle helper:

- a stable ID `F<number>`; in a re-review a kept or recurring finding keeps its prior ID;
- `classification`: `finding`, `QUESTION`, or `SUGGESTION`;
- `severity` (`BLOCKER`, `MAJOR`, `MINOR`) for a `finding` only, and `actionable` stated explicitly (a `QUESTION` states `approval_affecting` instead);
- the affected section or WP and the evidence for it;
- in a re-review: the resolution of every prior ID (`resolved`, `current` with its current severity, or `accepted`), and for each new or recurring finding the same-failure-mode and new-evidence assessment or the provenance in the changed scope.

## Plan coverage

For a `plan` target, also account for the source-to-WP mapping, required plan
sections, open questions, discovery debt, evidence artifacts, and execution
readiness. Do not treat a complete plan document as proof that its contents are
correct.

Report one outcome per check from "Plan integrity and execution readiness", using
the coverage outcomes of `<skill_dir>/SKILL.md` Section 8. Cover the checks that
the canonical plan validator enforces with one reference to its result (status and
errors) instead of separate rows; a check it enforces only in part, such as the
presence but not the accuracy of the source mapping, keeps a row for the part it
does not check. Give every judgment-based check one row with brief evidence in its
natural unit:

- sense before consistency: one line per element with its requirement and its loss
  on removal, e.g. `Scope 3 → AC2; loss: …`;
- source-to-WP mapping: source point → WP only where the accuracy of the mapping is
  in doubt;
- other checks: one sentence per WP or per section.

In a re-review, limit these rows to the scope defined by
`<skill_dir>/references/re-review.md`.

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
