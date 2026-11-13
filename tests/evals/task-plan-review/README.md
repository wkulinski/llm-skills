# External plan-review evaluation

This is a manual model evaluation, separate from ordinary unit tests and CI
quality gates. It compares substantive plan review, using six miniature legacy
plans and their small Node.js repositories. It does not measure canonical plan
format validation, browser investigation, production-scale discovery or the
entire task-plan lifecycle.

| Case | Probe |
| --- | --- |
| missing-requirement | A requested output is absent from the plan |
| wrong-diagnosis | A persuasive diagnosis contradicts the actual mechanism |
| missed-consumer | Another entrypoint bypasses the planned guard |
| dependency-order | WP order breaks an explicitly required intermediate state |
| unverifiable-acceptance | Verification never exercises the required failure mode |
| valid-control | Correct plan for the supplied requirements and repository |

`cases.json` contains the oracle. Never send it, this README, the evaluator or
score annotations to a reviewer. `prepare` copies only each case's source, plan,
repository files and a supplied skills snapshot into a separate Git repository.
Session instructions prohibit parent/sibling access; this is context isolation,
not a filesystem sandbox. Start a fresh session for every case and repetition.

## Freeze and prepare both arms

Before editing review instructions, copy the current skills to a baseline under
the cache root returned by `artifact-path.mjs cache-root`. Keep snapshots and all
evaluation results outside source control. For example, from the catalog root:

```bash
mkdir -p var/agent/cache/task-plan-review-eval/baseline/skills
cp -R .agents/skills/. var/agent/cache/task-plan-review-eval/baseline/skills/
```

Create an explicit profile JSON file with `harness`, `model`, `thinking` and
`mode`, using the same installed profile in both arms. Preparation records it;
it does not configure or invoke a model. Then prepare fresh output directories:

```bash
node tests/evals/task-plan-review/evaluate.mjs prepare \
  --output var/agent/cache/task-plan-review-eval/baseline-run-1 \
  --skills-root var/agent/cache/task-plan-review-eval/baseline/skills \
  --label baseline --profile var/agent/cache/task-plan-review-eval/profile.json

node tests/evals/task-plan-review/evaluate.mjs prepare \
  --output var/agent/cache/task-plan-review-eval/candidate-run-1 \
  --skills-root .agents/skills \
  --label candidate --profile var/agent/cache/task-plan-review-eval/profile.json
```

Use the consumer's configured cache root instead of `var/agent/cache` when it
differs. `prepare` refuses to overwrite a run. `run.json` records the exact prompt,
source, plan and plan-review method hashes. Pair arms only when case IDs, source
and plan hashes, runtime and actual profile match. Record actual model identity
from the runner, not only requested settings. Keep all reports, including failed
or incomplete sessions; report completion rate separately rather than silently
removing failures from the comparison.

## Run reviews

For each case, run its `prompt.md` in a fresh session rooted at that case's
directory. Use the existing direct review runner from the supplied skills, with
one configured profile and equal time budgets in both arms. Do not enable
cross-profile fallback for this comparison. The session must return the review's
`report_markdown` and `payload` with findings. Preserve the raw result JSON.

To use the normal runner, prepare a generic evaluation job from the case root:

```bash
node .agents/skills/_shared/scripts/review-session-job.mjs prepare \
  --root . --prefix PLAN_REVIEW --kind plan-review-evaluation \
  --job-id <unique-id> --task prompt.md \
  --context review-plan.md --context review-scope.json --context source.md
node .agents/skills/_shared/scripts/review-session-run.mjs --job <job.json>
```

Follow the runner's returned accept paths and next action using the normal
review-session procedure. The generic evaluation kind deliberately avoids
enforcing the candidate's new coverage schema on the baseline arm. This evaluates
finding quality with the same transport; unit tests separately cover acceptance
gates. Do not turn a failed session into an empty findings report.

Run all six cases per arm, preferably at least three repetitions with alternating
arm order. The clean control is mandatory. Repeated results are observations,
not a deterministic regression threshold or proof that one prompt always wins.

## Adjudicate and compare

After completion, an owner reads the oracle and each raw report. Annotate every
reported finding once by failure mode and evidence, without keyword matching:

```json
[
  {
    "case_id": "missing-requirement",
    "report_path": "/absolute/path/to/raw-result.json",
    "report_sha256": "<sha256 of raw result bytes>",
    "prompt_sha256": "<from run.json for this case>",
    "elapsed_seconds": 45.2,
    "cost_usd": null,
    "findings": [
      {
        "report_id": "F1",
        "classification": "expected",
        "expected_ids": ["archive-omission"],
        "reason": "The finding traces the archived filter to the omitted requirement."
      }
    ]
  }
]
```

The full annotation file needs one entry per case, including the clean control.
Use `false_positive` for an unsupported reported concern, or `other_valid` for a
real issue outside the oracle; both use `expected_ids: []` and require reasons.
Do not count an unexpected real defect as a false positive. Revise the oracle
explicitly before another experiment if adjudication exposes a fixture defect.
Record measured duration and cost; use `null` when unavailable, never invented
zeros. The report JSON must have `payload.findings` (the normal runner result or
raw envelope does). Hashes bind annotations to that exact report and prompt.

```bash
node tests/evals/task-plan-review/evaluate.mjs score \
  --run var/agent/cache/task-plan-review-eval/candidate-run-1/run.json \
  --annotations var/agent/cache/task-plan-review-eval/candidate-annotations.json
```

Compare detection/recall of the five seeded defects, false positives (especially
on the clean control), other valid concerns, completion rate, elapsed time and
cost by case and repetition. Missing cost makes the aggregate cost unknown.
Unit-test smoke reports validate the evaluator only; they are not model results.
