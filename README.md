# Curated LLM Skills

Reusable agent workflows for taking a repository task from **context and plan**
to **implementation, review, QA and a deliberately requested commit**. This is a
source catalog of instructions and small helpers, not an application framework
or an autonomous one-click coding service.

The core is portable across project stacks. An **optional PHP/Symfony/PostgreSQL
profile** retains the more specific conventions for those applications, with an
independent CQRS/modular-monolith override. Generic projects do not inherit PHP
rules just because the catalog ships them.

## What you get

- Workflows with explicit scope, stopping conditions and evidence rather than
  ad-hoc prompts or an unconditional “done”.
- Separate planning, implementation and read-only review; QA uses the consumer's
  configured commands. Implementation does not silently become a commit request.
- Shared runtime rules, dependency-aware delivery and context handoffs.
- Optional specialist workflows for UI consistency, Symfony runtime diagnosis,
  PHP structural changes, GitHub and other tasks.

The [skills index](docs/SKILLS.md) is the single human catalog: choose by intent,
then check stack, harness, tools/configuration, effects and dependencies. Do not
install seven entrypoint directories and assume they form a standalone starter.

## Requirements

The reference environment is **Linux with OpenCode**. Expect to prepare Git,
Bash, Node.js 22+, an authenticated model provider, native context-role adapters
and the required MCP tools (`codebase-memory`, `serena`, `context7`). Copying
skills alone does not configure the agent runtime. Model use can incur provider
charges. PHP, Playwright and other specialist tools are needed only by the
workflows that declare them; see [configuration](docs/CONFIGURATION.md).

This is for users who already work with a coding agent and can review local
configuration and changes. Start on a disposable copy or recoverable snapshot,
not a production checkout with unprotected changes or credentials.

Before granting tool/account access, read [Security and trust boundaries](SECURITY.md):
read-only review is not a sandbox, snapshot checks detect rather than prevent
changes, and external writes or delegated model sessions can have real effects
and costs. The same page explains safe security reporting without public secrets.

## First result

1. Install with the recommended [LLM Skills Manager (LSM)](https://github.com/wkulinski/lsm),
   or use the independent [pinned-source reference procedure](docs/INSTALLATION.md).
2. Merge the [minimal consumer configuration](docs/CONFIGURATION.md#ownership-and-skill-paths),
   configure the OpenCode roles/MCP access, and restart the harness.
3. Follow [First safe result](docs/FIRST-USE.md) for the local generic-profile
   check and send this prompt from the **consumer root**:

```text
$context-refresh Quick. Load this project's context and report the manifest path
and any missing configuration. Do not edit application code, run full QA, or commit.
```

Expect a context summary, the actual documentation paths used and a validated
local manifest/change inventory — or a concrete missing dependency, not a guessed
success. Ignored cache/state may be written; application code should not change.
This prompt is for the agent, **not Bash**. The walkthrough explains prerequisites
and expected results; [troubleshooting](docs/TROUBLESHOOTING.md) explains failures.

## Installation and ownership

LSM is the recommended installation/update workflow. This catalog defines
[the delivery contract](docs/INSTALLATION.md#delivery-and-ownership); LSM is
responsible for implementing it correctly. Installer release testing and
certification belong to LSM, not this repository.

The [versioned manifest](distribution/linux-opencode/manifest.json) covers the
starter closure, shared files, role adapters, session plugin and configuration
templates. The [reference procedure](docs/INSTALLATION.md) includes preview,
preflight, update and rollback. Consumer rules, active env/secrets, model hierarchy,
QA matrix and harness/MCP configuration remain consumer-owned. Use regular files,
not symlinks into the author's checkout.

### What to paste into project `AGENTS.md`

Use the [minimal map and canonical path-contract reference](docs/CONFIGURATION.md#ownership-and-skill-paths).
Add keys only for the workflows you use. Documentation paths are normally
repository-relative; **`COMMIT_MESSAGE_DIR` explicitly permits an absolute
directory such as `/tmp/`**. Do not copy this catalog's `AGENTS.md` into your app.

### OpenCode agent runtime (model + thinking)

Configure models/reasoning and MCP access in consumer OpenCode config, not `.env`
or role Markdown. Follow the [runtime/session-plugin guide](docs/CONFIGURATION.md#opencode-agent-runtime-model--thinking)
and restart the OpenCode process after configuration changes. The
[hybrid policy](.agents/skills/_shared/references/repository-context-hybrid.md)
owns context discovery; the guides do not create a second delegation procedure.

## Supported environment and verification status

The first public release targets **OpenCode on Linux**. This is a release target,
not a claim that every workflow has passed a consumer run. Other agent
environments (Claude Code, Codex) and operating systems have no runtime guarantee
from file availability alone. Statuses describe skill workflows, not installers.

| Status | Meaning |
| --- | --- |
| Verified | Documented contract, passing deterministic checks and a recorded consumer run for a named environment |
| Experimental | Contract available, but behavior may change or evidence is incomplete |
| Unverified | No consumer run has been performed |

Until recorded evidence says otherwise, treat a skill as **Unverified**. See the
[per-skill requirements and evidence](docs/SKILLS.md#support-metrics); a passing
file-copy test does not promote a workflow's support status.

## Language and sources of truth

Public user documentation is **English**. Skill descriptions and `SKILL.md`
instructions remain **Polish**; there is no second full language edition. The
agent can still be asked to report in your preferred language.

Skills own operational procedures. Shared references own common runtime rules;
consumer `AGENTS.md` owns local project rules and documentation paths. Guides
explain setup and expected outcomes, not replacement QA/commit/review algorithms.
For PHP activation and migration, use the
[project-profile contract](.agents/skills/_shared/references/project-profiles.md).

## Documentation and contributing

- [Documentation map](docs/README.md)
- [First use](docs/FIRST-USE.md) · [Configuration](docs/CONFIGURATION.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Installation, update and rollback](docs/INSTALLATION.md)
- [Developing this catalog](docs/DEVELOPMENT.md) — tests, authoring and catalog-local extensions

## License

Original material is released under the [MIT License](LICENSE). Referenced
third-party projects (including OpenCode, LSM and Paseo) keep their own licenses.
