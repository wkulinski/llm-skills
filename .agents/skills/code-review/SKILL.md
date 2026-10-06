---
name: code-review
description: >-
  Dogłębny, tylko odczytowy przegląd zmian w kodzie i planów zadań: ocenia je
  względem wymagań i konwencji repo, śledzi wpływ poza artefaktem i filtruje
  fałszywe trafienia. Użyj, gdy potrzebujesz werdyktu przed merge lub wdrożeniem
  planu.
compatibility: Git-based projects.
metadata:
  mode: read-only
shared_files:
  - code-review/references/review-checklists.md
  - code-review/references/plan-review.md
  - code-review/references/active-plan.md
  - code-review/references/re-review.md
  - _shared/references/task-plan-contract.md
  - _shared/references/skill-routing-policy.md
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/rule-conformance-policy.md
  - _shared/references/repository-context-hybrid.md
  - _shared/references/playwright-cli-verification.md
  - _shared/references/user-facing-behavior-assessment.md
  - _shared/scripts/change-inventory.mjs
  - _shared/scripts/playwright-access-prepare.sh
  - _shared/scripts/playwright-preflight.sh
  - _shared/scripts/playwright-auth-bootstrap.sh
  - _shared/scripts/playwright-auth-bootstrap.mjs
  - _shared/scripts/playwright-auth-finalize.mjs
  - _shared/scripts/is-main-module.mjs
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
- **Adapt depth to risk.** Do not apply every lens to a trivial local change; do not use a shallow single pass for a cross-system or high-risk change.
- **Separate intent from implementation.** Product disagreements are not bugs unless expected behavior is grounded in an authoritative source.
- **Review the review.** Independently challenge candidate findings before publishing them.

## Hard rules

- **Read-only review.** Do not edit source files, change Git state, alter persistent application data, or perform externally visible actions, including publishing review comments, unless the user explicitly asks for those actions.
- Never include secret values, credentials, private keys, tokens, passwords, or unnecessary personal data in findings, evidence, prompts, logs, or review comments. Redact sensitive values and report only the type and location needed to act.
- Do not fix findings during review unless the user explicitly changes the task to implementation.
- Do not assume tests prove behavior merely because they pass.
- Never invent line numbers, commands, repository conventions, runtimes, package managers, container names, test scripts, or framework behavior.
- Every accepted finding must be independently checked by the coordinating reviewer before final output.
- If review coverage is materially limited, say so. Never present a partial review as complete.

## Reference routing

Read only the files required by the active step. Declared references are available on demand, not as mandatory reading.

| Condition | File |
|---|---|
| deep review checklists for the active target and risk depth (correctness and propagation, contracts and integrations, state/persistence/data flow, security and privacy, reliability and concurrency, reactivity, lifecycle and feedback loops, performance, architecture and maintainability, tests and verification) | `<skill_dir>/references/review-checklists.md` |
| workflow routing and skill-selection guard before this skill starts | `<skills_root>/_shared/references/skill-routing-policy.md` |
| repository reconnaissance, broad versus targeted reads, and scout lifecycle | `<skills_root>/_shared/references/repository-context-hybrid.md` |
| applicable-rules register semantics (source, scope, force, evidence, result) | `<skills_root>/_shared/references/rule-conformance-policy.md` |
| choosing, running and limiting verification commands | `<skills_root>/_shared/references/runtime-collaboration-guidelines.md` (section "QA Command Policy") |
| working-tree change inventory | `<skills_root>/_shared/scripts/change-inventory.mjs` |
| rendered UI change, or a change to the interactions of code running in the browser, and Playwright checkpoint | `<skills_root>/_shared/references/playwright-cli-verification.md` |
| the code or plan changes navigation, interaction, object selection, messages, or consequential actions for the user | `<skills_root>/_shared/references/user-facing-behavior-assessment.md` |
| plan target contract owned by `$task-plan` | `<skills_root>/task-plan/SKILL.md` |
| the target is `plan`: plan expected behavior, plan context, plan integrity, plan coverage and plan verdicts | `<skill_dir>/references/plan-review.md` |
| the target is `code` and the caller supplied a plan, or automatic lookup is allowed and `${CACHE_PATH:-var/agent/cache}/plan-execute/last-plan.txt` exists (see "Active-plan context for code") | `<skill_dir>/references/active-plan.md` |
| explicitly asked to re-review fixes | `<skill_dir>/references/re-review.md` |

## 1. Resolve review target and scope

Determine the narrowest correct review surface.

First classify the review target:

- `code` — an implementation change or supplied code whose behavior is being evaluated;
- `plan` — an existing task-plan Markdown document whose execution-readiness is being evaluated.

Creating a plan or revising a plan as its owner remains `$task-plan`. This skill's
`plan` target is a separate read-only phase performed by the current coordinating
agent, not a separate executor. It never takes ownership of the plan's Markdown,
status, questions, or validation lifecycle, and the phase separation is not a claim
of executor independence. `$task-plan` evaluates this skill's result after the
phase ends.

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

When the caller supplies a prepared snapshot (an inventory with its fingerprint,
separate staged and unstaged diffs, and untracked paths), review that snapshot
without rebuilding the inventory, and judge staged changes from the supplied
staged diff. The caller's constraints override conflicting steps of this
methodology: a check the caller forbids running becomes a `verification_gap`
that limits the verdict. When essential input is missing, end the review as
`INCOMPLETE` with a concrete request for that input.

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
- shared units with multiple consumers
- whether the change affects public contracts, persistent state, authorization/trust boundaries, asynchronous execution, concurrency, deployment/configuration, or other high-impact surfaces

Do not begin forming findings until scope and intended behavior are understood.

Treat staged, unstaged, and untracked files as separate parts of the inventory. Do not treat a tracked-file diff alone as a complete working-tree review. If a user explicitly excludes part of the inventory, or a tool cannot inspect it, record that limitation in coverage instead of presenting the review as complete.

For `plan`, record the canonical plan path, source artifact/reference, context
report/reference, and any available hashes before judging the plan. If a referenced
artifact is unavailable or stale, report the resulting coverage gap; do not silently
reconstruct or mutate the plan's identity.

### Active-plan context for code

For a `code` target, decide whether to load `<skill_dir>/references/active-plan.md`:

- when the caller supplied a plan, load the reference; a caller's ban on
  automatic lookup does not exclude a supplied plan;
- otherwise, unless the caller's constraints forbid it, check whether
  `${CACHE_PATH:-var/agent/cache}/plan-execute/last-plan.txt` exists.
  This is the only automatic plan lookup: do not search every plan in the
  repository. When the pointer exists, load the reference;
- when no plan was supplied and the pointer is missing or lookup is forbidden,
  skip the reference.

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

For a `code` target, the acceptance criteria of the work package mapped under
`<skill_dir>/references/active-plan.md` are a source of expected behavior; that
reference assesses the change against them. Do not accept implementation merely because it appears to follow
the plan.

If expected behavior cannot be determined and the concern is a product choice, classify it as `QUESTION`, not a defect.

An authoritative source settles what behavior is expected, not whether that
behavior serves the user's task. When a source-prescribed interaction
conflicts with the user's task under
`<skills_root>/_shared/references/user-facing-behavior-assessment.md`, report a
`QUESTION` with the concrete trade-off instead of a defect.

Map the other results of that reference as follows:

- a blocking question becomes an approval-affecting `QUESTION`;
- a product note becomes a `SUGGESTION` labeled as a product note and does not
  change the verdict;
- a concrete check becomes a `verification_gap` naming the check;
- a preference with no cost to the user produces no entry.

For a `plan` target, also apply "Plan expected behavior" in `<skill_dir>/references/plan-review.md`.

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

When a read of a rule, contract, or documentation section that applies to the reviewed behavior is truncated, complete the part that governs the behavior before relying on it. A cut-off excerpt does not cover the omitted text, and the verdict must not rest on an unread applicable section.

### Applicable rules

Before judging the artifact, determine which rules actually apply to the reviewed
scope, using `<skills_root>/_shared/references/rule-conformance-policy.md` for the
semantics of sources, scope, force, evidence and result.

- Derive the active sources for the touched paths from repository instructions,
  the `docs_map` documents, shared references, path-specific instructions and
  conditional profiles, respecting the repository's existing precedence and
  environment-level instructions.
- Select only the rules relevant to the reviewed scope; do not enumerate or number
  every rule in the repository.
- Record for each selected rule: source (file and section), force
  (`mandatory`/`recommendation`/`exception`), application to the change, evidence,
  and result (`SATISFIED`/`VIOLATED`/`NOT_APPLICABLE`/`NOT_VERIFIED`/`EXEMPTED`).
  Group identical applications of the same rule into one entry.
- An inactive conditional profile contributes no rule and no violation. An
  unresolved activation is `NOT_VERIFIED`, never assumed conformance.

For a `plan` target, also apply "Plan context" in `<skill_dir>/references/plan-review.md`.

## 4. Assess risk and choose review depth

Use one coordinating reviewer for every review. A small/local change with simple behavior needs only the directly relevant checks. A cross-system or high-risk change needs several bounded passes by the same coordinator, selected from the deep review checklists referenced in Section 5.

Increase review depth when the change spans subsystems or has material risk involving one or more of:

- authorization, privacy, or trust boundaries
- persistent state, migrations, or data integrity
- public or inter-component contracts
- asynchronous processing, retries, idempotency, ordering, or concurrency
- external effects or integrations
- framework/runtime lifecycle behavior (see "Reactivity, lifecycle and feedback
  loops" in the deep review checklists)
- performance-sensitive or high-volume paths
- broad refactors with many callers/consumers
- deployment, configuration, scheduled execution, or operational behavior
- changes whose correctness depends on several independent assumptions

Review depth means relevant lenses and verification. Do not add a pass that repeats an already covered question. The publication gate in Section 6 applies at every depth: more depth adds lenses and evidence, it does not remove the obligation to weigh the strongest counterargument and classify the candidate.

For a large change, order the review by risk, contracts and state before the
rest. An area that cannot be reviewed reliably gets `NOT_COVERED` instead of a
superficial `REVIEWED`, and recommending a split of the change is a valid next
step.

### Complexity/value gate

For every non-trivial change, challenge whether the added complexity buys durable value before the verdict.

Ask:

- What concrete, durable problem, invariant, contract, or operational need does the added complexity solve?
- Is the problem recurring, expected, and important enough to justify it, or is this a one-off niche case?
- What complexity was added: states and transitions, branches, flags, fallbacks, heuristics, abstractions, configuration, dependencies, caches, or special compatibility paths?
- Can the same effect be achieved by simplifying or removing an existing part of the solution instead of adding another layer?
- What concrete failure remains if the new mechanism is removed? Is that failure supported by a requirement, code path, test, or operational evidence?
- Does every new state, transition, heuristic, or special case map to an observable requirement or a meaningful invariant?

Treat local hole-patches, one-off tweaks, heuristics compensating for other heuristics, and state machines without a measurable behavioral gain as warning signals, not automatic findings. Do not use arbitrary line-count or state-count thresholds.

Record one gate outcome in the coverage/summary:

- `JUSTIFIED` — the added complexity protects a durable requirement and simpler alternatives are insufficient;
- `SIMPLIFY` — the same outcome is achievable with a materially simpler or smaller solution;
- `QUESTION` — the expected value or recurring need cannot be established;
- `NOT_RELEVANT` — the change is trivial or adds no meaningful complexity.

`SIMPLIFY` becomes a severity-rated finding only when the current complexity creates a concrete correctness, reliability, security, performance, or maintenance impact; otherwise report it as a `SUGGESTION` or keep it as a review note.

## 5. Deep review contract

Trace risk beyond edited lines as far as needed to evaluate behavior. Apply only
the checklists required by the active target and the depth chosen in Section 4;
they live in `<skill_dir>/references/review-checklists.md` (see "Reference
routing").

When Section 1 loaded `<skill_dir>/references/active-plan.md`, also assess the
change against the mapped work package as that reference describes.

For a `plan` target, also apply "Plan integrity and execution readiness" in `<skill_dir>/references/plan-review.md`.

## 6. Verify candidate findings

A candidate becomes a finding only if it has:

- a concrete affected behavior or contract
- a specific code/plan location or missing-verification surface
- a plausible execution path from input/event/state to failure, or from a plan assumption/WP to an execution risk
- an explanation of impact
- evidence strong enough for its severity
- provenance: what the reviewed change introduced, extended, or made reachable; a
  scenario already present in the baseline and independent of the change is a
  `SUGGESTION` or a rejected candidate

Before publication, every candidate must pass this ordered publication gate:

1. **observation** — the concrete behavior, artifact, or gap actually observed;
2. **authoritative source of expected behavior** — the requirement, contract, plan or work package, or repository convention that makes the observation a defect rather than a preference (see Section 2);
3. **demonstrated consequence or contract violation** — the concrete failure mode, violated invariant, or missing-verification surface, not merely a difference in approach;
4. **strongest counterargument considered** — the best available reason the observation may be expected, already prevented elsewhere, or out of scope;
5. **classification** — exactly one outcome: `finding`, `QUESTION`, `SUGGESTION`, or rejected candidate.

When a candidate depends on an evolving contract, establish which contract applies to the exact resource and the execution stage or supported path at issue. A historical implementation is not sufficient evidence that its assumptions still apply; check relevant superseding changes where needed. Conversely, a valid final state does not disprove a failure during a supported transition. Bound this verification to the candidate and apply the existing evidence and classification requirements.

The publication gate is not independent verification of interpretation. Re-reading
the same location, running a test that the candidate itself points to, or passing
the report's structural validation do not, by themselves, establish that the
interpretation is correct. Candidates supplied by auxiliary channels (another
agent, a subagent report, a tool, or a reviewer hand-off) never carry a verdict
with them; they enter this skill as unverified candidates and must pass the same
gate as any other candidate.
A plan or work package is a source of expected behavior only for the scope it actually maps to; it does not authorize
expectations for behavior outside that mapped scope.

For `BLOCKER`, require direct reproduction when practical, such as:

- a focused failing test
- a deterministic trace with concrete inputs/state
- a clear violated safety, security, data-integrity, or compatibility invariant

If a serious issue is plausible but not proven, lower confidence/severity or classify it as `QUESTION`.

### Rule violations

A violated mandatory contract is a finding on its own evidence. It does not need an
additional runtime failure, a contradiction with green tests, or a reproduction to
be reported:

- name the rule's source (file and section) and its force from the applicable-rules
  register, and state how it applies to the reviewed scope rather than to the
  repository in general;
- apply the provenance requirement from the candidate requirements above;
- if an authoritative, scoped exception exists, record `EXEMPTED` and do not raise
  a finding for that rule;
- if an unresolved conflict between active rules affects the decision, record
  `NOT_VERIFIED` and report the needed decision instead of picking the convenient
  side or declaring conformance;
- if the applicable rule cannot be evaluated, record `NOT_VERIFIED` with the
  missing evidence instead of downgrading the question to taste or promoting it to
  a violation.

### Mechanical verification

Passing lint/typecheck/build is hygiene evidence, not behavioral proof.

Commands stay within the read-only rule from "Hard rules". This skill may run
documented, safe, non-destructive commands when they directly answer a review
question. Keep every command proportional to the changed behavior or a
candidate finding, and record its command, result, and limitation.

Permitted mechanical evidence includes a focused test, a targeted lint or
typecheck, a build, a safe reproduction, or a narrowly scoped inspection tool.
Use documented project entrypoints; do not guess commands, create test data in a
shared environment, or run an action that can mutate production-like state.

Do not run a full test suite, repository-wide lint, or full QA matrix unless the
user explicitly requests it. `$qa-run` remains the normal workflow for full QA.
Do not expand a focused check into a broader run merely because it is available.

For a change affecting rendered UI, or a change to the interactions of code
running in the browser when Section 4 selected the reactivity lens, run a
proportional Playwright checkpoint following
`<skills_root>/_shared/references/playwright-cli-verification.md` when
`playwright-cli` and a safe application target are available.
`Access: BLOCKED` is a `verification_gap`.
The checkpoint should cover the changed state and relevant interaction, use a
stable snapshot/role/selector, and check new console or request errors. Add a
relevant viewport or accessibility/state check when the change's risk requires
it. Do not use Playwright interactions that persist application data.

If a relevant selected focused check is unavailable, report a
`verification_gap`. If a required UI checkpoint cannot run because
`playwright-cli` or a safe application target is unavailable, report the same
gap for that UI behavior. Do not treat missing mechanical verification as a
blocker unless the claim cannot be evaluated without it, and do not present the
unverified behavior as proven. A runtime gap described in Section 10 still
limits the verdict.

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

When an applicable-rules register was produced, also check that no relevant rule
was dropped: revisit the active sources and the reviewed scope, confirm that every
selected rule has a recorded result, and verify that a result invalidated by a
change of scope, rule or evidence was re-established instead of carried over.

For a non-trivial change, run a pre-mortem before the verdict: name the single
most likely way the change could break user-visible or operational behavior
after merge, and name the control (a test, a review observation, or runtime
verification) that would detect it. For a high-risk change, also name the most
severe plausible failure when it differs from the most likely one.
When no such control exists, record a `verification_gap` or `NOT_COVERED`. The
pre-mortem is not a finding by itself: every candidate it produces
passes the publication gate from Section 6 with its five elements unchanged.
Skip the pre-mortem without an entry for a trivial change.

For a non-trivial change, also ask what the change omits:

- Did removed code remove a guard, validation, or authorization check?
- Was a test skipped or removed, or an assertion weakened?
- Was a lint or static-analysis suppression added, a threshold lowered, or a CI
  step disabled?
- Does an analogous path (bulk operation, import, admin panel, background job)
  keep the old semantics?
- Does any requirement lack a counterpart in the implementation?
- Does the change description promise more than the diff delivers?
- Does each API, method, or option used exist in the installed dependency
  version?

Every candidate from these questions passes the Section 6 publication gate
unchanged.

For every surviving candidate, record the strongest counterargument you actually
considered and classify it through the Section 6 publication gate, or have it
explicitly discarded as a rejected candidate; unclassified candidates are not
published.

Deduplicate overlapping findings by failure mode, not by file.

When your interpretation of a rule or a finding is challenged, read the specific governing text and weigh the strongest counterargument before keeping or correcting the assessment. Agreement is not required, but a challenge is answered with the concrete rule, not with a restatement of the earlier position. An auxiliary check with a narrow scope does not prove coverage of an axis it never examined, so do not cite it as evidence for that axis. Correct the assessment in either direction when the governing text requires it.

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

For a `plan` target, also apply "Plan coverage" in `<skill_dir>/references/plan-review.md`.

When an applicable-rules register was produced, account separately for each
selected rule's result
(`SATISFIED`/`VIOLATED`/`NOT_APPLICABLE`/`NOT_VERIFIED`/`EXEMPTED`) next to the
per-file inventory outcomes. The register covers the reviewed artifact and its
scope; it is not a statement of repository-wide conformance.

## 9. Severity

Use exactly:

- **BLOCKER** — likely security/privacy breach, data loss/corruption, severe production failure, fundamentally broken primary behavior, unsafe compatibility/migration change, or an execution-blocking plan defect; merge or execution must stop
- **MAJOR** — real correctness/reliability/security/compatibility defect, or plan defect that should be fixed before merge or execution
- **MINOR** — real but limited defect or maintainability risk with concrete impact; merge may proceed with caveat
- **QUESTION** — unresolved behavior/product decision that materially affects confidence and needs clarification
- **SUGGESTION** — optional improvement; not counted as a defect and never blocks

A hard architectural boundary or invariant that the reviewed change violates or
extends outside an authoritative, scoped exception is at least **MAJOR**, even when
tests are green and no runtime failure is observed; `BLOCKER` still requires the
existing risk criteria above. Deviations from a `recommendation` and cosmetic
issues keep the proportional assessment and do not become a hard boundary merely
because they appear in a register.

Do not inflate severity to make a review look useful.

## 10. Verdict

For a working-tree `code` review, rebuild the inventory before choosing the
verdict:

```bash
node <skills_root>/_shared/scripts/change-inventory.mjs build --output <CACHE_PATH>/repository-context/change-inventory-final.json
```

Compare its `worktree_fingerprint` with the inventory from the start of the
review. When they differ, state which snapshot the report covers, then review the
delta or limit the verdict's validity; do not carry evidence across versions.
Skip this check for a snapshot supplied by the caller, who checks its stability.

For a `code` target, choose one:

- **BLOCK** — one or more BLOCKER findings
- **CHANGES REQUESTED** — no blocker, but one or more MAJOR findings
- **DISCUSS** — no blocker/major, but an approval-affecting QUESTION or high-risk NOT_COVERED area remains
- **PASS WITH CAVEAT** — only MINOR findings remain
- **PASS** — no unresolved defects and no material coverage gap

A significant applicable rule left `NOT_VERIFIED` excludes an unconditional
`PASS`; when that gap affects acceptance of the reviewed change, use `DISCUSS`.

A `verification_gap` or `NOT_COVERED` entry in any area that Section 4 marked as
high risk excludes an unconditional `PASS`. When it cannot be established
whether a material invariant holds and that affects acceptance of the reviewed
change, use `DISCUSS`. An unrun test alone does not force `DISCUSS` when source
analysis is sufficient.

For a `plan` target, also apply "Plan verdicts" in `<skill_dir>/references/plan-review.md`.

## 11. Output format

Lead with findings. Do not bury defects under a long summary.

If there are no findings, say `No findings.` explicitly before the review
details and repeat that status in the Summary. Still include the strongest
remaining blind spot.

For every finding:

`F<n> [SEVERITY] Short title — path/to/file.ext:line`

In a re-review, or whenever prior findings were supplied in the input, a kept or
recurring finding keeps its prior ID. A new finding gets the next number after
the highest prior ID. Never reuse an ID for a different failure mode.

Then include:

- **Behavior:** what happens
- **Impact:** why it matters
- **Evidence:** concrete path/contract/test/trace supporting the claim
- **Fix direction:** concise direction, not a full implementation unless requested
- **Confidence:** `high` — reproduced or traced deterministically; `medium` —
  execution path confirmed without running it; `low` — depends on an unverified
  assumption

For `QUESTION`, replace **Fix direction** with **Needs decision**.

Then provide:

### Target

`code` or `plan`, with the reviewed artifact and scope. For a supplied snapshot,
also state its fingerprint and whether the review is complete or `INCOMPLETE`
with the requested inputs.

### Coverage

A compact table/list of reviewed areas and any `NOT_COVERED` surfaces. For every
high-risk area, the entry names the risks and paths checked and the remaining
gap.
Include the applicable-rules results for the reviewed scope when a register was
produced, and the `Complexity/value gate` outcome when the gate was relevant.

### Finding resolutions

For a re-review, or whenever prior findings were supplied in the input, report one
explicit resolution per prior ID instead of silently dropping it:

- **resolved** — the prior finding no longer applies, with the evidence that
  proves it;
- **current** — it still applies, with its current severity and the evidence;
- **accepted** — it remains by explicit user decision, with the decision
  reference.

A missing resolution is an incomplete review, not an implicit acceptance. The
owner passes these resolutions to the `$task-plan` decision helper.

### Plan alignment

For a `code` review with an active plan, supplied by the caller or resolved from
the pointer, state the plan path, mapped work package, plan-alignment outcome,
and any unmapped acceptance criterion or scope/dependency concern. Otherwise say
that no active plan was available or applicable.

### Verification

List the mechanical checks actually run, their results, and any relevant limits.
Explicitly distinguish focused checks from full QA. If a relevant lint, test,
build, safe reproduction, or Playwright checkpoint was not run, state why and
report a `verification_gap`; do not turn an otherwise reviewable source area
into `NOT_COVERED`. Full verification is handled by `$qa-run` unless the user
explicitly requests otherwise.

### Verdict

`VERDICT — one-sentence reason`

For a `plan` target, describe changes to the plan as the next action and route
them to `$task-plan`; do not edit the plan from this skill.

### Summary and next step

State concisely:

- the review activities completed, including traces, source reads, and commands
  actually run;
- the general assessment and finding status (`No findings` when none were
  accepted);
- the strongest remaining blind spot or verification gap;
- the recommended next action, such as a focused check, `$qa-run`, plan
  correction through `$task-plan`, clarification, or no further action.

## 12. Re-review after fixes

When explicitly asked to re-review fixes, follow `<skill_dir>/references/re-review.md`.

## Examples

For a default working-tree review, regenerate the change inventory (see Section 1):

```bash
node <skills_root>/_shared/scripts/change-inventory.mjs build --output <CACHE_PATH>/repository-context/change-inventory.json
```

Prompt examples:

- `$code-review` — perform a full review of the current working tree;
- `$code-review` — review the existing plan `./docs/plans/example.md` as a read-only phase for execution readiness.
