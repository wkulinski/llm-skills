---
name: code-review
description: Deep, read-only review of software changes and task plans. Reviews working-tree, staged, commit-range, branch, PR, file, pasted-code, or existing-plan targets against requirements and repository conventions. Uses risk-based review depth, traces blast radius or plan dependencies beyond the artifact, validates findings with evidence, and filters false positives before a merge or execution-readiness verdict. Use with `$code-review` for a full review.
compatibility: Git-based projects.
metadata:
  mode: read-only
shared_files:
  - _shared/references/skill-routing-policy.md
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/repository-context-hybrid.md
  - _shared/references/context-subagent-contract.md
  - _shared/scripts/change-inventory.mjs
---

# Code Review

## Mission

Find real defects and merge risks, not stylistic preferences.

A good review answers:

1. What changed and what was supposed to change?
2. What behavior can this change affect beyond the edited lines?
3. What evidence supports each reported issue?
4. What was actually reviewed and what remains uncertain?
5. Is the change safe to merge, or is the plan ready for execution?

Prefer a small number of high-confidence findings over speculative noise, but do not stop after finding the first serious issue.

## Core principles

- **Review behavior, not taste.** Do not report a defect merely because the code differs from your preferred style or architecture.
- **The reviewed artifact is the entry point, not the system boundary.** For code, trace callers, callees, contracts, state, tests, configuration, and integrations. For plans, trace source coverage, ownership, dependencies, execution order, acceptance criteria, and the evidence behind proposed work.
- **Repository-local rules beat generic advice.** Discover the project's own conventions, commands, architecture, and constraints before applying generic assumptions.
- **Evidence before severity.** Every accepted finding must have a concrete failure mode or violated contract and enough evidence for its severity.
- **Adapt depth to risk.** Do not spend five reviewers on a trivial local change; do not use a shallow single-pass review for a cross-system or high-risk change.
- **Separate intent from implementation.** Product disagreements are not bugs unless expected behavior is grounded in an authoritative source.
- **Review the review.** Independently challenge candidate findings before publishing them.

## Hard rules

- **Read-only review.** Do not edit source files, stage, commit, reset, checkout, rebase, push, or publish review comments unless the user explicitly asks for those actions.
- Never include secret values, credentials, private keys, tokens, passwords, or unnecessary personal data in findings, evidence, prompts, logs, or review comments. Redact sensitive values and report only the type and location needed to act.
- Do not fix findings during review unless the user explicitly changes the task to implementation.
- Do not assume tests prove behavior merely because they pass.
- Never invent line numbers, commands, repository conventions, runtimes, package managers, container names, test scripts, or framework behavior.
- Every accepted finding must be independently checked by the coordinating reviewer before final output.
- If review coverage is materially limited, say so. Never present a partial review as complete.

## 1. Resolve review target and scope

Determine the narrowest correct review surface.

First classify the review target:

- `code` — an implementation change or supplied code whose behavior is being evaluated;
- `plan` — an existing task-plan Markdown document whose execution-readiness is being evaluated.

Creating a plan or revising a plan as its owner remains `$task-plan`. This skill's
`plan` target is an independent, read-only review and never takes ownership of the
plan's Markdown, status, questions, or validation lifecycle.

### Read change inventory

For a working-tree `code` review, always regenerate the change inventory at the
beginning of the review:

```bash
node <skills_root>/_shared/scripts/change-inventory.mjs build --output <CACHE_PATH>/repository-context/change-inventory.json
```

Read the resulting `files[]`, `stats`, and `subsystems[]` as the change inventory
for this review instead of running ad-hoc git commands. The inventory fingerprint
identifies the exact snapshot that was reviewed. A file entry can contain both
`staged` and `unstaged` surfaces for the same path; review both, and treat the
surface counters as non-exclusive.

Supported inputs:

- no explicit scope for `code`: inspect repository status and review the complete working tree, including staged, unstaged, and untracked files, against the current baseline
- commit: review the exact commit
- commit range: review the exact range
- branch: compare against the appropriate merge-base
- PR/change request: read its title/description and review its diff
- files/directories: review only the requested surface plus necessary propagation context
- plan: review one explicitly identified existing plan and the source/evidence artifacts it references; do not review every plan by default
- pasted code: review the supplied code and explicitly note that repository-level propagation checks may be unavailable
- pasted plan: review the supplied plan and explicitly note that referenced source/context evidence may be unavailable

Record internally:

- scope mode
- baseline and target, preferably exact revisions
- changed file inventory
- diff size
- touched subsystems and boundaries
- whether the change affects public contracts, persistent state, authorization/trust boundaries, asynchronous execution, concurrency, deployment/configuration, or other high-impact surfaces

Do not begin forming findings until scope and intended behavior are understood.

Treat staged, unstaged, and untracked files as separate parts of the inventory. Do not treat a tracked-file diff alone as a complete working-tree review. If a user explicitly excludes part of the inventory, or a tool cannot inspect it, record that limitation in coverage instead of presenting the review as complete.

For `plan`, record the canonical plan path, source artifact/reference, context
report/reference, and any available hashes before judging the plan. If a referenced
artifact is unavailable or stale, report the resulting coverage gap; do not silently
reconstruct or mutate the plan's identity.

### Active-plan context for code

For a `code` target with no explicitly supplied plan, check whether
`${CACHE_PATH:-var/agent/cache}/plan-execute/last-plan.txt` exists. This is the
only automatic plan lookup: do not search every plan in the repository.

When the pointer exists:

- resolve its single repository-relative canonical plan path; never treat the
  pointer as a copy of the plan or as a source of work-package status;
- validate the resolved plan through the `$task-plan` contract before relying on
  it, and record an invalid, stale, or non-canonical plan as a coverage gap;
- determine whether the reviewed change maps to the current work package or to
  another explicitly identifiable work package, using the changed behavior,
  scope, and execution evidence rather than filename similarity alone;
- review the mapped work package's goal, scope, out-of-scope boundary,
  dependencies, acceptance criteria, and planned verification in addition to
  the ordinary code-review lenses;
- if the mapping is ambiguous, do not infer plan compliance. Record the plan
  alignment as `NOT_COVERED` or raise a `QUESTION` when it materially affects
  confidence.

An active plan is an additional source of expected behavior, never a substitute
for reviewing correctness, propagation, contracts, or operational risk in code.

## 2. Establish expected behavior

Before judging implementation, locate the strongest available sources of intent in this order:

1. explicit user requirement in the current task
2. task plan/specification/acceptance criteria
3. issue or change-request description
4. repository architecture/design documentation and decision records
5. public contracts, schemas, migration guarantees, or compatibility requirements
6. established repository conventions
7. tests and current code as behavioral evidence, not unquestionable product authority

A project may keep task plans or specifications outside version control. If a relevant plan is discoverable, verify that it actually corresponds to the reviewed change before treating it as authoritative.

For a `code` target, apply the active-plan alignment from Section 1 whenever a
valid plan pointer was found. Use the plan's acceptance criteria as expected
behavior, but do not accept implementation merely because it appears to follow
the plan.

If expected behavior cannot be determined and the concern is a product choice, classify it as `QUESTION`, not a defect.

For a `plan` target, the plan is the work product under review, not proof of its
own claims. Compare it with the referenced source artifact, explicit user
decisions, repository evidence, and the plan contract defined by `$task-plan`
(`<skills_root>/task-plan/SKILL.md`).
Do not treat `candidate paths`, `discovery debt`, or a plan's suggested diagnosis
as confirmed facts without supporting evidence.

## 3. Discover project context

Do not encode assumptions about languages, frameworks, build tools, or runtime environments into the review.

Instead, discover what this project actually uses and how it expects work to be validated. Read relevant sources such as:

- repository instructions and nested path-specific instructions
- README/development/contributing documentation
- architecture/design documentation
- build, dependency, workspace, and tool configuration
- test/lint/typecheck/static-analysis configuration
- CI configuration when it clarifies canonical validation commands
- local skills or project-specific reviewer guidance when present

Use the project's documented commands and execution environment whenever possible. Do not guess how to run tests, linters, builds, containers, interpreters, compilers, or package managers.

Technology-specific knowledge should come from the model, the code, and repository documentation. The skill defines **what must be investigated**, not a tutorial for each technology.

For a `plan` target, also read the relevant `$task-plan` contract
(`<skills_root>/task-plan/SKILL.md`) and only the
repository documentation needed to verify ownership, boundaries, dependencies,
paths, or acceptance checks claimed by the plan. Do not turn plan review into a
second full implementation discovery pass.

## 4. Assess risk and choose review depth

Use one coordinating reviewer for every review. A small/local change with simple behavior needs only the directly relevant checks. A cross-system or high-risk change needs several bounded passes by the same coordinator, selected from the review lenses in Section 5.

Increase review depth when the change spans subsystems or has material risk involving one or more of:

- authorization, privacy, or trust boundaries
- persistent state, migrations, or data integrity
- public or inter-component contracts
- asynchronous processing, retries, idempotency, ordering, or concurrency
- external effects or integrations
- framework/runtime lifecycle behavior
- performance-sensitive or high-volume paths
- broad refactors with many callers/consumers
- deployment, configuration, scheduled execution, or operational behavior
- changes whose correctness depends on several independent assumptions

Review depth means relevant lenses and verification. Do not add a pass that repeats an already covered question.

### Complexity/value gate

For every non-trivial change, challenge whether the added complexity buys durable value before issuing the final verdict. For a trivial change with no meaningful added complexity, record this gate as `NOT_RELEVANT`.

Ask:

- What concrete, durable problem, invariant, contract, or operational need does the added complexity solve?
- Is the problem recurring, expected, and important enough to justify it, or is this a one-off niche case?
- What complexity was added: states and transitions, branches, flags, fallbacks, heuristics, abstractions, configuration, dependencies, caches, or special compatibility paths?
- Can the same effect be achieved by simplifying or removing an existing part of the solution instead of adding another layer?
- What concrete failure remains if the new mechanism is removed? Is that failure supported by a requirement, code path, test, or operational evidence?
- Does every new state, transition, heuristic, or special case map to an observable requirement or a meaningful invariant?

Treat local hole-patches, one-off tweaks, heuristics compensating for other heuristics, and state machines without a measurable behavioral gain as warning signals, not automatic findings. Report a finding only when the complexity creates a concrete correctness, reliability, security, performance, or maintenance risk. Do not use arbitrary line-count or state-count thresholds.

Record one gate outcome in the coverage/summary:

- `JUSTIFIED` — the added complexity protects a durable requirement and simpler alternatives are insufficient;
- `SIMPLIFY` — the same outcome is achievable with a materially simpler or smaller solution;
- `QUESTION` — the expected value or recurring need cannot be established;
- `NOT_RELEVANT` — the change adds no meaningful complexity.

`SIMPLIFY` becomes a severity-rated finding only when the current complexity has concrete impact; otherwise report it as a `SUGGESTION` or keep it as a review note.

## 5. Deep review contract

Trace risk beyond edited lines as far as needed to evaluate behavior.

### Correctness and propagation

Check where relevant:

- requirements/spec alignment
- branch, state-machine, and lifecycle logic
- boundary, empty, invalid, and exceptional inputs
- error propagation and recovery paths
- callers, alternate entry points, and consumers
- stale assumptions in tests, fixtures, configuration, or documentation that are behaviorally significant

If a public name, signature, field, message, event, configuration key, output, or other contract changes, search for producers, consumers, and assertions of the old contract.

### Contracts and integrations

When behavior crosses a boundary, inspect both sides of that boundary.

Examples include:

- request/response or command/event contracts
- serialization/deserialization
- internal module interfaces
- external integrations
- generated artifacts and source-of-truth relationships
- compatibility with older/newer consumers when compatibility matters

Do not assume a local change is safe merely because the edited file is internally consistent.

### State, persistence, and data flow

When stateful behavior changes, inspect where relevant:

- creation and consumption of identifiers/values being matched
- deduplication, early-return, skip, cache, and guard logic
- migrations and existing-data implications
- transactional/atomicity boundaries
- partial failure and retry behavior
- data loss, duplication, stale state, or inconsistent state transitions
- serialization and compatibility of stored data

### Security and privacy

Inspect only relevant trust boundaries, including where applicable:

- authorization and isolation
- untrusted input crossing into privileged operations
- injection or unsafe interpretation of input
- path/filesystem/network/command boundaries
- secret or sensitive-data exposure
- data newly visible to a broader observer
- unsafe deserialization or dynamic execution

A pre-existing datum exposed to a new observer is still a security/privacy change.

### Reliability and concurrency

Where relevant, inspect:

- retries and idempotency
- ordering guarantees
- duplicate delivery/execution
- races and lost updates
- locking or atomicity assumptions
- timeout/cancellation behavior
- cleanup on failure
- restart/resume behavior
- scheduled or bulk execution blast radius

### Performance

Report performance issues only when they are meaningful for realistic workloads.

Look for:

- repeated remote/storage I/O
- unbounded work or result sets
- accidental multiplicative work
- pathological algorithmic growth
- missing batching/pagination/streaming where scale requires it
- expensive work in hot paths
- resource growth in long-running processes

Do not report micro-optimizations without evidence of practical impact.

### Architecture and maintainability

Review architecture only when it affects correctness, change risk, or long-term maintainability.

Check:

- consistency with established project boundaries
- misplaced or duplicated business policy
- inappropriate coupling across boundaries
- abstractions that hide important behavior or multiply failure modes
- dependency additions that duplicate established capabilities
- changes that make future correctness materially harder to reason about

Do not block on “I would design it differently.”

### Tests and verification

Treat test quality as first-class.

Check whether tests:

- cover the intended changed behavior
- include regression coverage for bug fixes
- exercise meaningful negative/error/boundary paths
- cover distinct execution paths that can actually fail
- validate contracts rather than implementation trivia
- can fail for the defect they claim to prevent
- derive their expected result from an authoritative requirement, contract, or
  independently established invariant rather than the implementation's current
  output
- would have failed before the regression was fixed when that can be safely
  established, rather than merely passing against the new implementation
- control or explicitly isolate time, time zone, locale, randomness, ordering,
  asynchronous completion, external I/O, and shared state whenever they can
  affect the result
- use stable contracts, roles, or selectors. A test may cover translated or
  rendered UI behavior, but should not couple to incidental copy, fragile DOM
  structure, or parser output when a stable behavioral contract exists
- are not duplicates whose only difference is data that cannot change the
  exercised behavior
- exercise the meaningful failure mode of a stateful, cross-boundary, or
  otherwise complex mechanism; a trivial unit assertion is not sufficient as
  the only evidence for the mechanism's higher-risk behavior

Do not request tests that merely vary values without exercising a distinct behavior.

Do not reject a test merely because it uses a translation, DOM, or fixture. The
defect is unstable coupling or an untrustworthy oracle, not the technology in
isolation.

#### Durable tests versus one-off change verification

Apply this gate to both implemented tests and tests proposed in a plan. A proof
that a change was completed is not automatically a lasting specification of the
system. Do not turn the change list into a list of permanent tests.

For each proposed permanent test, identify the rule of the target system and
ask: **Would we need this separate scenario if the system had been built from
scratch to the target contract, without knowing the removed code, old limit, or
history of the task?** Check the need for the scenario, its special input values,
and its assertions—not just its name or stated justification.

- If removing that history removes the reason for the separate scenario, require
  its removal from the permanent suite or planned test scope. Keep any necessary
  proof of the change as a one-off execution check.
- If an existing test owns the target rule, prefer updating that test. A new
  permanent scenario needs a distinct case justified by the target contract,
  not merely a difference between the old and new implementation.
- A test failing before the fix is useful regression evidence, but is not by
  itself a reason to retain a separate test. Apply both this gate and the
  regression checks above.

Example: after removing a limit of 10 records, a separate “displays 11 records”
test justified only by the old limit is change verification, not a permanent
scenario. A test that the list contains the complete expected set of eligible
records can specify the target contract, if that is the requirement; first check
whether the existing list test already owns it. The number 11 in a fixture is
not itself a defect. Renaming the test or replacing 11 with 17 does not repair a
scenario whose only reason to exist is the removed limit. Likewise, a negative
assertion is legitimate when the target contract independently requires an
absence; removal history alone does not establish that requirement.

### Active-plan alignment for code

When Section 1 identified a valid active plan for a `code` review, assess the
change against the mapped work package as well as the normal code-review
contract:

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

### Plan integrity and execution readiness

Use this section only for a `plan` target. Check the plan against the `$task-plan`
contract (`<skills_root>/task-plan/SKILL.md`) without editing it:

- `Source and objective` describes the actual requested outcome, symptoms, constraints, and verified versus unverified claims;
- every source point is mapped to a WP or has a justified `excluded` decision;
- `Scope`, ownership, boundaries, dependencies, and WP order are consistent;
- `confirmed paths`, `candidate paths`, and `discovery debt` are kept distinct;
- `Direction, simplicity and consistency` names the existing mechanism, simpler alternatives, minimality, and ownership rather than asserting them generically;
- each WP has an actionable goal, scope, out-of-scope boundary, discovery notes, acceptance criteria, and verification;
- acceptance criteria have a concrete test or check, and the execution environment/command contract is internally consistent;
- every planned permanent test passes the **Durable tests versus one-off change verification** gate above; history-only scenarios are removed from permanent test scope, and any necessary one-off checks are explicitly distinguished in `Verification`;
- open questions, missing evidence, or discovery debt that could change public behavior, ownership, WP boundaries, data models, or acceptance criteria are treated as blockers or questions;
- the plan does not copy global workflow rules, describe its own drafting history, or claim `ready` independently of `$task-plan` validation.

When a plan is incomplete, report the missing evidence or contradiction in the
plan rather than inventing implementation details or silently correcting it. A
listed test or command is planned verification, not evidence that it was run.

## 6. Verify candidate findings

A candidate becomes a finding only if it has:

- a concrete affected behavior or contract
- a specific code/plan location or missing-verification surface
- a plausible execution path from input/event/state to failure, or from a plan assumption/WP to an execution risk
- an explanation of impact
- evidence strong enough for its severity

For `BLOCKER`, require direct reproduction when practical, such as:

- a focused failing test
- a deterministic trace with concrete inputs/state
- a clear violated safety, security, data-integrity, or compatibility invariant

If a serious issue is plausible but not proven, lower confidence/severity or classify it as `QUESTION`.

Passing lint/typecheck/build is hygiene evidence, not behavioral proof.

This skill is **read-only**, which means it must not edit source, change Git
state, alter persistent application data, or perform externally visible actions.
It may run documented, safe, non-destructive commands when they directly answer
a review question. Keep every command proportional to the changed behavior or a
candidate finding, and record its command, result, and limitation.

Permitted mechanical evidence includes a focused test, a targeted lint or
typecheck, a build, a safe reproduction, or a narrowly scoped inspection tool.
Use documented project entrypoints; do not guess commands, create test data in a
shared environment, or run an action that can mutate production-like state.

Do not run a full test suite, repository-wide lint, or full QA matrix unless the
user explicitly requests it. `$qa-run` remains the normal workflow for full QA.
Do not expand a focused check into a broader run merely because it is available.

For a change affecting rendered UI, run a proportional Playwright checkpoint
when `playwright-cli` and a safe application target are available. First inspect
the installed CLI with `playwright-cli --help`, then follow the safe-session and
artifact rules in
`<skills_root>/frontend-ui-consistency/references/playwright-cli-verification.md`.
The checkpoint should cover the changed state and relevant interaction, use a
stable snapshot/role/selector, and check new console or request errors. Add a
relevant viewport or accessibility/state check when the change's risk requires
it. Do not use Playwright interactions that persist application data.

If a relevant selected focused check is unavailable, report a
`verification_gap`. If a required UI checkpoint cannot run because
`playwright-cli` or a safe application target is unavailable, report the same
gap for that UI behavior. Do not treat missing mechanical verification as a
blocker unless the claim cannot be evaluated without it, and do not present the
unverified behavior as proven.

## 7. Review the review

Before publishing findings, perform a false-positive pass.

For each candidate ask:

1. Did I read the actual relevant code, plan, or evidence?
2. Is the claimed behavior or plan outcome reachable?
3. Is the expectation authoritative or merely my preference?
4. Does existing validation or surrounding logic already prevent the failure?
5. Is this the same underlying failure mode as another finding?
6. Is the severity proportional to actual impact?
7. Can the user act on the finding?
8. Is the cited location real and relevant?

Deduplicate overlapping findings by failure mode, not by file.

Discard compliments, generic advice, speculative refactors, and style-only comments from the findings list.

After the false-positive pass, ensure that each inventory entry has an explicit
review outcome before publishing the verdict.

## 8. Coverage

Before final verdict, account for every meaningful changed area.

Use one of the following outcomes for every inventory entry:

- `FINDING` — issue reported
- `REVIEWED` — reviewed, no issue found
- `NOT_RELEVANT` — no behavioral review needed
- `NOT_COVERED` — insufficient context, tools, or evidence

If any high-risk area is `NOT_COVERED`, the verdict cannot be an unconditional `PASS`.

For a `plan` target, also account for the source-to-WP mapping, required plan
sections, open questions, discovery debt, evidence artifacts, and execution
readiness. Do not treat a complete plan document as proof that its contents are
correct.

## 9. Severity

Use exactly:

- **BLOCKER** — likely security/privacy breach, data loss/corruption, severe production failure, fundamentally broken primary behavior, unsafe compatibility/migration change, or an execution-blocking plan defect; merge or execution must stop
- **MAJOR** — real correctness/reliability/security/compatibility defect, or plan defect that should be fixed before merge or execution
- **MINOR** — real but limited defect or maintainability risk with concrete impact; merge may proceed with caveat
- **QUESTION** — unresolved behavior/product decision that materially affects confidence and needs clarification
- **SUGGESTION** — optional improvement; not counted as a defect and never blocks

Do not inflate severity to make a review look useful.

## 10. Verdict

For a `code` target, choose one:

- **BLOCK** — one or more BLOCKER findings
- **CHANGES REQUESTED** — no blocker, but one or more MAJOR findings
- **DISCUSS** — no blocker/major, but an approval-affecting QUESTION or high-risk NOT_COVERED area remains
- **PASS WITH CAVEAT** — only MINOR findings remain
- **PASS** — no unresolved defects and no material coverage gap

For a `plan` target, use plan-specific wording:

- **PLAN BLOCKED** — a BLOCKER, invalid plan structure, or execution-blocking coverage gap remains;
- **PLAN CHANGES REQUESTED** — no blocker, but one or more MAJOR findings remain;
- **PLAN DISCUSS** — an approval-affecting QUESTION or high-risk `NOT_COVERED` area remains;
- **PLAN READY WITH CAVEAT** — only MINOR findings remain;
- **PLAN READY** — no unresolved plan defects or material coverage gaps remain.

`PLAN READY` is an independent review result, not the `$task-plan` `ready`
status. The canonical plan validator and plan owner remain responsible for that
status.

## 11. Output format

Lead with findings. Do not bury defects under a long summary.

For every finding:

`F<n> [SEVERITY] Short title — path/to/file.ext:line`

Then include:

- **Behavior:** what happens
- **Impact:** why it matters
- **Evidence:** concrete path/contract/test/trace supporting the claim
- **Fix direction:** concise direction, not a full implementation unless requested
- **Confidence:** high / medium / low

For `QUESTION`, replace **Fix direction** with **Needs decision**.

Then provide:

### Target

`code` or `plan`, with the reviewed artifact and scope.

### Coverage

A compact table/list of reviewed areas and any `NOT_COVERED` surfaces.
Include the `Complexity/value gate` outcome when the gate was relevant.

### Plan alignment

For a `code` review with an active-plan pointer, state the resolved plan path,
mapped work package, plan-alignment outcome, and any unmapped acceptance
criterion or scope/dependency concern. Otherwise say that no active-plan
pointer was available or applicable.

### Verification

List the mechanical checks actually run, their results, and any relevant limits.
Explicitly distinguish focused checks from full QA. If a relevant lint, test,
build, safe reproduction, or Playwright checkpoint was not run, state why and
report a `verification_gap`; do not turn an otherwise reviewable source area
into `NOT_COVERED`. Full verification is handled by `$qa-run` unless the user
explicitly requests otherwise.

### Summary and next step

State concisely:

- the review activities completed, including traces, source reads, and commands
  actually run;
- the general assessment and finding status (`No findings` when none were
  accepted);
- the strongest remaining blind spot or verification gap;
- the recommended next action, such as a focused check, `$qa-run`, plan
  correction through `$task-plan`, clarification, or no further action.

### Example command

For a default working-tree review, regenerate the change inventory (see Section 1):

```bash
node <skills_root>/_shared/scripts/change-inventory.mjs build --output <CACHE_PATH>/repository-context/change-inventory.json
```

Review the union of staged, unstaged, and untracked paths from the inventory's `files[]`;
do not silently replace it with only the output of `git diff`.

Prompt examples:

- `$code-review` — perform a full review of the current working tree;
- `$code-review` — independently review the existing plan `./docs/plans/example.md` for execution readiness.

### Verdict

`VERDICT — one-sentence reason`

For a `plan` target, describe changes to the plan as the next action and route
them to `$task-plan`; do not edit the plan from this skill.

If there are no findings, say `No findings.` explicitly before the review
details and repeat that status in the Summary. Still include the strongest
remaining blind spot.

## 12. Re-review after fixes

When explicitly asked to re-review fixes:

- review the fix delta first
- verify that prior findings are actually resolved
- for `code`, trace newly affected execution paths
- for `plan`, trace newly affected source mappings, ownership, dependencies, and acceptance criteria
- do not automatically reopen unrelated areas from the original review
- report regressions introduced by the fixes
- do not edit a plan; route plan corrections through `$task-plan`
- do not continue into an automatic fix/re-review loop unless explicitly requested
