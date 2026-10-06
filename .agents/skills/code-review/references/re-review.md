# Re-review after fixes

Load this reference when explicitly asked to re-review fixes.

- review the fix delta first, starting from the changed sections/work packages and
  their direct dependencies supplied in the delta input;
- resolve every prior finding ID as described in `### Finding resolutions` in
  `SKILL.md`;
- for a recurring finding, state whether it is the same failure mode and whether
  new evidence exists; keep the prior ID;
- for a new finding, state whether it originates from the fix or a direct
  dependency, and name the changed section/work package or dependency that makes
  it reachable;
- for `code`, trace newly affected execution paths;
- for `plan`, trace newly affected source mappings, ownership, dependencies, and acceptance criteria;
- do not automatically reopen unrelated areas from the original review, and treat
  observations from unchanged, independent scope as `SUGGESTION` or rejected
  candidates;
- a new `BLOCKER`, `MAJOR`, or actionable `MINOR` outside the changed lines needs
  concrete provenance evidence from the fix or a direct dependency; document hashes
  identify document versions, not finding identity;
- report regressions introduced by the fixes;
- do not edit a plan; route plan corrections through `$task-plan`;
- do not continue into an automatic fix/re-review loop unless explicitly requested.
