---
source_kind: github-issue
source_ref: https://github.com/acme/demo/issues/123
issue: 123
title: "Original issue title"
input_profile: brief-request
plan_status: awaiting-package-decisions
plan_version: 1
simplification_status: pending
fetched_at: 2026-01-01T00:00:00Z
source_updated_at: 2026-01-01T00:00:00Z
---

## Source

- source_data: issue body and comments
- source_ref: https://github.com/acme/demo/issues/123

## Goal and scope

Implement the explicitly accepted goal without expanding the source scope.

## Work packages

- WP1 — core package, status `accepted`.
- WP2 — package awaiting a separate decision.
- WP2 — wydzielony do [osobnego planu](./issue-123-wp-wp2-import-plan.md)

## Decisions and open questions

- Q1 [WP2][BLOCKING] Czy pakiet obejmuje także migrację danych?

## Evidence, risks and review

- Evidence: source and repository references remain attached to findings.
- Risk: unresolved blocking question keeps the plan out of `approved`.

## Acceptance and verification

- Every package has a terminal decision before final approval.

## Next action

Await package decisions.

## Execution handoff (when implementation is requested)

Not applicable until the user chooses `a) rozpocznij implementację`.
