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

For a full review, reconstruct expectations before assessing the proposed solution:

1. Read the raw source first. Record its requested outcomes, explicit constraints,
   reported symptoms and relevant boundary scenarios in a short source ledger.
   Distinguish requirements from suggested solutions; do not invent requirements.
2. Read the plan's recorded user decisions, incorporating authoritative decisions
   into that ledger without borrowing the author's source-to-WP mapping.
3. Read the proposed solution and independently map the ledger to WPs and
   acceptance criteria. Look for omitted outcomes and unsupported scope as well
   as defects in the proposed actions.

In the report, give each source requirement or constraint a concise row:
source reference and expected outcome → WP/criterion (or missing) → assessment
and evidence. Existing per-element scope and source coverage rows may serve this
purpose; do not maintain a second copy. A boundary scenario is a probe of a
requirement, not a new requirement. A delta review updates only the affected
ledger entries and their direct dependencies.

When the plan's author is also its reviewer, its own diagnosis is a claim, not
context. Read the raw source material, including attached screenshots, logs, and
comments, and compare the plan with it rather than with the plan's summary of it in
`Source assessment`.

A reviewer delegated to a separate session
(`<skills_root>/task-plan/SKILL.md`) has no access to
the planning conversation. Treat `[answered]` entries with `Source: current
conversation` as the user's decisions and challenge them only under the
**sense before consistency** rule below.

When a plan claim depends on rendered behavior (a reproduced symptom, an "already
works" conclusion, the current interaction), you may check it in the dev
application through Playwright CLI according to
`<skills_root>/_shared/references/playwright-cli-verification.md`. Keep these checks read-only, including persistent application data,
unless the user explicitly authorizes the changes.

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

This limit does not excuse checking critical assumptions. An assumption is
critical when disproving it would change scope, architecture/ownership, WP order
or dependencies, public behavior, or acceptance criteria. For each such claim:

- name the claim and a concrete scenario that could disprove it;
- trace the actual mechanism in repository code, including the relevant producer,
  consumer or alternate entrypoint when the claim crosses that boundary;
- compare that trace with the proposed WP and verification; record paths/symbols
  and the conclusion, or the exact missing evidence and its consequence.

For example, a claim that shared validation covers all writes requires checking
the form, import and background entrypoints that can reach the write, rather than
only locating the validator. Check only entrypoints relevant to the claim. There
is no minimum file, command or finding count. For a plan without runtime code,
trace the corresponding document, CLI or workflow contract instead. Combine these
traces with the coverage rows below rather than adding a parallel report.

## Plan integrity and execution readiness

Use this section only for a `plan` target. Check the plan against the `$task-plan`
contract (`<skills_root>/_shared/references/task-plan-contract.md`, procedure owner
`<skills_root>/task-plan/SKILL.md`) without editing it:

- **sense before consistency:** for every planned change (each edited path and each `Scope` action) and every verification command, answer two questions separately: what requires it (source sentence, user decision, or acceptance criterion), and what concrete outcome is lost if it is removed. A source mapping proves only that the plan cites a point; a source requirement does not prove the action makes sense. No requirement means unrequested scope, at least MAJOR, including any edit to the plan's own source material, which stays read-only unless explicitly requested. Nothing lost on removal is a finding when the element traces only to the source's `Suggested diagnosis or solution`, an unclassified source sentence, or the planner's own inference: MAJOR for an edit or `Scope` action, actionable MINOR for a check. When it traces to `Requested outcome`, `Explicit constraints`, or a user decision (`D<n>`), the owner cannot drop it alone: raise an approval-affecting QUESTION that challenges the source instead of planning its execution. Once the user confirms such an element after the challenge, record it as `accepted` and do not raise it again. A check that confirms no acceptance criterion or named risk is an actionable MINOR: remove it rather than fix it;
- **symptom traceability:** for every source point that reports a defect, the plan explains how its confirmed cause produces the symptom as the reporter described it, from the reporter's action or conditions to the observed message, state, or appearance. Reproducing the same message by a different path confirms a mechanism, not the reported scenario; the missing link must be evidenced or recorded as an unverified hypothesis. A conclusion that a defect cannot be reproduced, or that an existing mechanism already satisfies the requirement, needs both a trace in code of the conditions that produce the reported symptom and a comparison of the plan's evidence with the reporter's evidence; plan evidence showing the same state the reporter rejected contradicts the conclusion. A plan that replaces the reported symptom with its own success criterion, or whose WP addresses a different symptom without that link, has at least a MAJOR finding. When the source does not say what exactly is wrong, raise an approval-affecting QUESTION instead;
- `Source and objective` states the requested outcome, and `Source assessment` separates the actual requested outcome, symptoms, constraints, and verified versus unverified claims;
- when the domain check required by `$task-plan` applies, material term meanings and boundary scenarios are resolved by evidence or explicit decisions, and their consequences agree across WP scope and acceptance criteria; an invented scenario alone is not a source requirement;
- durable domain or architectural knowledge follows `$task-plan`'s documentation selection criteria: existing decisions are referenced rather than duplicated, and necessary documentation work has a target meaning, path, and observable acceptance result in the appropriate WP, within the agreed scope;
- every source point is mapped to a WP or has a justified `excluded` decision;
- `Scope`, ownership, boundaries, dependencies, and WP order are consistent;
- `confirmed paths`, `candidate paths`, and `discovery debt` are kept distinct;
- `Direction, simplicity and consistency` names the existing mechanism, simpler alternatives, minimality, and ownership rather than asserting them generically;
- each WP has an actionable goal, scope, out-of-scope boundary, discovery notes, acceptance criteria, and verification;
- in a new plan, each WP's `Difficulty: v1` block matches the WP's actual execution, independently of executor selection. Its concise `Profile rationale` justifies the lowest sufficient model/reasoning profile assigned through `Execution environment` (default or override), including the boundary against the immediately lower candidate when one exists. Shared `Profile evidence` in `Execution environment` records the sources and limitations once for the plan (or states explicitly that no data was available); benchmark results inform the agent's judgment without thresholds or reordering the project hierarchy. A missing or unsupported rationale, a missing `Profile evidence` field, or a contradiction with the assigned profile is at least MAJOR because the validator does not assess this judgment. Legacy plans, including historical point-based rationales, do not require migration; apply the current selection contract to new or materially changed choices;
- a new plan has a 3–5 sentence preamble below its title and one closed, non-nested `details` block per section except the visible `Work package summaries`, with headings outside and exactly one blank line after `summary`; legacy unwrapped plans remain readable without mass migration;
- each `Work package summaries` entry matches its WP and describes only the change and result; for a WP that fixes a reported defect it also names the defect as the reporter sees it and, when the reader needs it to understand why the change helps, its cause. A reader who knows the project goal but not the code or the conversation understands the outcome; exclusions belong in the full WP. An entry with exclusions, paths, code symbols, plan identifiers, unexplained jargon, or clipped keyword phrasing is an actionable MINOR finding, and an entry that adds scope, contradicts the WP's `Out of scope`, or leaves out a change the reader needs to understand the WP's result is at least MAJOR; leaving out a `Scope` detail that does not help that understanding is not a finding;
- acceptance criteria have a concrete test or check, and the execution environment/command contract is internally consistent;
- in a new plan, each WP records its checks in `Verification: v1` with separate `Durable tests` and `One-off checks`, and every acceptance criterion whose result is observable only in the rendered application has a browser check (route or URL, role, steps, kind of evidence) in `One-off checks`; a missing browser check for such a criterion is an actionable MINOR, or MAJOR when no other check confirms the criterion;
- every planned permanent test passes the **Durable tests versus one-off change verification** gate from the deep review checklists, applied to each listed test rather than replaced by a general coverage statement; history-only scenarios are removed from permanent test scope, while a scenario verifying an actual migration contract or target invariant stays, and any necessary one-off checks are explicitly distinguished in `Verification`;
- open questions, missing evidence, or discovery debt that could change public behavior, ownership, WP boundaries, data models, or acceptance criteria are treated as blockers or questions;
- unanswered dependent questions remain blockers; the absence of questions in the current round does not establish readiness when a material prerequisite is still unresolved;
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
- `severity` (`BLOCKER`, `MAJOR`, `MINOR`) for a `finding` only, and `actionable` stated explicitly (`false` for `QUESTION` and `SUGGESTION`); a `QUESTION` also states `approval_affecting`;
- the affected section or WP and the evidence for it;
- in a delta-review: the resolution of every prior ID (`resolved`, `current` with its current severity, or `accepted`), and for each new or recurring finding the same-failure-mode and new-evidence assessment or, for a delta review, the provenance in the changed scope. A full review reports independent findings with local IDs and no historical
  resolutions; reconciliation belongs to the owner.

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
- symptom traceability: one line per source point that reports a defect, with the
  symptom as reported, the plan's explanation, and the evidence compared;
- source-to-WP mapping: other source points → WP only where the accuracy of the
  mapping is in doubt;
- other checks: one sentence per WP or per section.

In a re-review, limit these rows to the scope defined by
`<skill_dir>/references/re-review.md`.

For independent external full review, also return the structured `coverage`
defined in `<skills_root>/_shared/references/task-plan-contract.md`. Render the
report's coverage from those same entries, supplemented by the source ledger and
per-element checks above; do not independently invent a second set of outcomes.
The helper checks completeness and internal consistency; the owner checks that
the cited evidence supports the scenario and that no material subject is omitted.

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
