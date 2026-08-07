---
source_kind: github-issue
source_ref: https://github.com/acme/demo/issues/123
issue: 123
title: "Original issue title"
input_profile: brief-request
plan_status: review-pending
package_decision_gate: closed
plan_version: 1
simplification_status: pending
fetched_at: 2026-01-01T00:00:00Z
source_updated_at: 2026-01-01T00:00:00Z
---

## Source

- source_data: issue body and comments
- source_ref: https://github.com/acme/demo/issues/123

## Session strategy

- Mode: `planning`
- Rationale: Plan the accepted goal from the fetched issue before package decisions.
- Stages: 1. intake; 2. planning; 3. review; 4. decisions
- Work packages: WP1, WP2
- Session boundary recommendation: resume after the review gate opens.
- Dependencies: source fetch, repository context
- Entry criteria: source fetched and assessed.
- Exit criteria: every blocking question has an explicit user decision.

## Goal and scope

Implement the explicitly accepted goal without expanding the source scope.

## Work packages

- WP1 — core package, status `pending`.
- WP2 — package pending review and a later decision.
- No package decision is requested before the review gate opens.
- After an explicit `separate`: WP2 — wydzielony do [osobnego planu](./issue-123-wp-wp2-plan.md)

## Decisions and open questions

### Decyzje zakresowe przed decyzjami pakietowymi

- Brak.

### Decyzje pakietowe

- Niedostępne: `package_decision_gate` jest zamknięta. Najpierw zakończ review, uproszczenie i decyzje zakresowe.

## Evidence, risks and review

- Evidence: source and repository references remain attached to findings.
- Risk: unresolved blocking question keeps the plan out of `approved`.

## Acceptance and verification

- Every package has a terminal decision before final approval.

## Next action

Run the critical review and simplification before opening package decisions.

## Execution handoff (when implementation is requested)

Not applicable until the user chooses `a) rozpocznij implementację`.
