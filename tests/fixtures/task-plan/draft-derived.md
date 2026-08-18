---
source_kind: derived-work-package
source_ref: https://github.com/acme/demo/issues/123
input_profile: brief-request
parent_issue: 123
parent_draft: issue-123-plan.md
work_package_id: WP2
plan_status: needs-clarification
package_decision_gate: closed
plan_version: 1
simplification_status: pending
source_fetch_status: complete
fetched_at: 2026-01-01T00:00:00Z
source_updated_at: 2026-01-01T00:00:00Z
---

## Source

- source_kind: derived-work-package
- parent_draft: issue-123-plan.md

<!-- task-plan:session-strategy:start -->
## Session strategy

- Mode: `decisions`
- Rationale: The separated package runs its own bounded workflow.
- Stages: 1. intake; 2. planning; 3. review; 4. decisions
- Work packages: WP2
- Session boundary recommendation: resume in a dedicated session.
- Dependencies: parent draft separation link
- Entry criteria: explicit `separate` decision recorded.
- Exit criteria: every blocking question has an explicit user decision.
<!-- task-plan:session-strategy:end -->

## Goal and scope

The separated package has its own review scope.

## Work packages

- WP2 — status `pending` until its own workflow is complete.

## Decisions and open questions

### Decyzje zakresowe przed decyzjami pakietowymi

- Brak.

### Decyzje pakietowe

- Niedostępne: `package_decision_gate` jest zamknięta. Najpierw zakończ review, uproszczenie i decyzje zakresowe.

## Evidence, risks and review

- The parent draft remains the source of the separation link.

## Acceptance and verification

- The package receives an explicit terminal decision.

## Next action

Run the package's own task-plan workflow.

## Execution handoff (when implementation is requested)

Not applicable.
