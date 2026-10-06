# Deep review checklists

This file is the conditional reference of `$code-review`. It holds the domain
checklists of the "Deep review contract"; load only the sections required by the
active target and the review depth chosen in Section 4 of the skill root
(`<skill_dir>/SKILL.md`).

### Correctness and propagation

Check where relevant:

- requirements/spec alignment
- branch, state-machine, and lifecycle logic
- boundary, empty, invalid, and exceptional inputs
- error propagation and recovery paths
- callers, alternate entry points, and consumers; when the changed unit is shared
  (module, controller, component, base class, template), enumerate its consumers
  by searching for the registration mechanism the project uses (import,
  reference from a template, configuration, attribute), and record their count
  and the consumers whose use differs from the change's scenario. Consumers of a
  shared unit that were not enumerated are a `NOT_COVERED` entry
- stale assumptions in tests, fixtures, configuration, or documentation that are behaviorally significant
- twin components: when a component has a twin or predecessor performing a
  related operation (create and edit, create and update), compare their handling
  of domain errors and exceptions; for every exception the handler or a lower
  layer can throw, point to the place that turns it into a response for the
  user. An unjustified asymmetry is a candidate finding
- dependent values: when the parent value of a field, form, or state changes,
  check what happens to a stored value that depends on it (cleared, filtered,
  rejected with a message, or left inconsistent)

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

For a change that is deployed rather than switched atomically, check rollout
safety: old and new versions running side by side, old messages in queues and
old cache entries, the order of schema, application, and backfill, an
interrupted migration, rollback after data was written in the new format, and a
safe default for a feature flag.

### State, persistence, and data flow

When stateful behavior changes, inspect where relevant:

- creation and consumption of identifiers/values being matched
- deduplication, early-return, skip, cache, and guard logic
- migrations and existing-data implications
- transactional/atomicity boundaries
- partial failure and retry behavior
- data loss, duplication, stale state, or inconsistent state transitions,
  including dependent values in the interface and in forms
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

For authorization, name the actor, resource, operation, trust boundary, and the
place where permission is enforced, and check it for a concrete object as well
as for list, bulk, export, and background-job paths.

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

For a stateful or asynchronous change, describe a concrete run instead of naming
the risk: initial state, triggering event, order of operations, failure point,
state after the failure, behavior on retry or restart, and the invariant at
stake. For concurrency, describe a concrete interleaving of two operations
instead of a general claim of a race.

### Reactivity, lifecycle and feedback loops

Check where relevant:

- whether a new observer, listener, watcher, or subscription can react to changes
  made by the mechanism itself or by its own dependencies, and where the stop
  condition is
- whether the code manually synchronizes two sources of truth instead of using a
  lifecycle event of their owner
- whether a listener on a global target (document, window, history) narrows the
  target, phase, and event type, and what other consumers of the same event
  (router, framework) do with it
- whether the code writes to shared environment state that something else also
  interprets
- whether an event sequence has several steps while the code assumes one

For each question, record the result as justified, not justified, or not
verified. A not-verified question is a `NOT_VERIFIED` coverage entry, not a
silent assumption.

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
- dependency changes: additions that duplicate established capabilities, lockfile
  changes, new packages, major-version jumps, and licenses
- changes that make future correctness materially harder to reason about

When a change modifies or removes a mechanism, check whether the artifacts that
describe the target state now match it: the instructions an agent follows, the
documentation, the scope of new plans, and the tests. A named exception that only
preserves the old implementation is removed or replaced by the general target rule.
An exception that carries necessary provenance or a concrete migration contract
stays. This is an assessment of relevance, not a blacklist of a name.

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
- do not replace the source of risk with a test double: when the mechanism's
  risk lies in the behavior of an external dependency (library, framework,
  browser, service), a test that fully replaces that dependency with a double is
  not evidence for that risk. Identify whether any test actually exercises the
  risky behavior; if none does, record a `verification_gap` naming the missing
  scenario instead of counting those tests as coverage. A double remains
  legitimate for behavior that is not the source of risk, such as isolating
  I/O, time, or randomness

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
- History alone is not a defect. A scenario that verifies an actual migration
  contract, a compatibility guarantee, or a target invariant that the system must
  hold independently of the removed implementation keeps its permanent place.
  Distinguish that case from a scenario whose only reason to exist is the removed
  implementation, and decide each planned test separately rather than replacing the
  whole question with a general coverage statement.

Example: after removing a limit of 10 records, a separate “displays 11 records”
test justified only by the old limit is change verification, not a permanent
scenario. A test that the list contains the complete expected set of eligible
records can specify the target contract, if that is the requirement; first check
whether the existing list test already owns it. The number 11 in a fixture is
not itself a defect. Renaming the test or replacing 11 with 17 does not repair a
scenario whose only reason to exist is the removed limit. Likewise, a negative
assertion is legitimate when the target contract independently requires an
absence; removal history alone does not establish that requirement.
