# Project profiles

This file is the single owner of stack-profile selection and the activation of
its rules. A profile selects rules, not workflows or the set of tools to run.

## Resolve before work

Before reading stack standards, implementing, reviewing, running QA or writing
project files, source the existing `<skills_root>/_shared/scripts/env-load.sh`
and call `resolve_stack_profile` in the consumer repository root. Do not continue
after an error:

```bash
source .agents/skills/_shared/scripts/env-load.sh
ensure_repo_env_loaded || exit $?
STACK_PROFILE="$(resolve_stack_profile)" || exit $?
```

A read-only snapshot and local workflow artifacts (cache, state, commit snapshot)
may be created earlier; they do not permit project changes before validation.

The example assumes installation in `.agents/skills`; otherwise use the actual
`skills_root`. The function relies on the existing active-env loading in
`ensure_repo_env_loaded`; do not parse env again in a skill. The order is
`.env`, `.env.local` (except with `APP_ENV=test`), `.env.<APP_ENV>`,
`.env.<APP_ENV>.local`; the default `APP_ENV` is `dev`. `.env.dist` is a
template, not an active runtime file.

| Final `SKILLS_STACK_PROFILE` | Active standards |
|---|---|
| unset, empty or `generic` | portable collaboration and quality rules; no PHP baseline |
| `php-symfony-postgres` | `php-symfony-postgres-standards.md` is mandatory |
| any other value | `SKILLS_STACK_PROFILE_INVALID`, exit 2; stop the procedure before any change |

`CQRS_MONOLITH_STANDARD_OVERRIDES` is a separate configuration axis. The value
`1` adds `cqrs-monolith-standard-overrides.md` only in the PHP profile. In the
`generic` profile, `1` yields `CQRS_OVERRIDE_REQUIRES_PHP_PROFILE`, exit 2 — it
never selects PHP automatically. Any other value leaves the override inactive.

Do not infer the profile from file extensions, the presence of `composer.json`,
the workflow name or the CQRS flag alone. Record the resolved profile and override
state in the existing manifest/state/report without copying the whole env. After
a configuration change, resolve the profile again in a fresh shell and refresh
the context.

When active standards conflict, precedence is (highest first): the CQRS override,
the stack baseline, the runtime rules (`runtime-collaboration-guidelines.md`,
`runtime-quality-procedures.md`). The position of standards relative to the
user's command, repository rules and `SKILL.md` is defined by
`./skill-structure-contract.md`.

## Consumption and tools

Read and apply only the standards activated above. `shared_files` remains a
declaration of availability: keep the baseline, the override, this reference and
`env-load.sh` in the distribution of the skills that use them; being listed does
not activate a standard.

Preflight covers only the tools needed in the current step, through the existing
`resolve_tool_cmd`. The PHP profile alone does not require running every PHP
tool, and `generic` does not exclude a tool a specific task needs. QA matrix
commands and workflow order stay with their skills.

## Migrating existing consumers

The default profile is `generic`. An existing PHP consumer, **before updating
the skills**, sets `SKILLS_STACK_PROFILE=php-symfony-postgres` in the active
repository env (for example `.env.local` outside `APP_ENV=test`, or an active
test env file for tests) and keeps its existing CQRS flag. After the update,
resolve the profile in a fresh shell and refresh the context manifest.

To leave the PHP rules: first disable the CQRS override, then select `generic`
and refresh the context. `$rules-sync` does not remove local stack rules in place
of this decision.
