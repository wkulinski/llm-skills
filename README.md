# Curated LLM Skills

Reusable agent workflows for taking a repository task from **context and plan**
to **implementation, review, QA and a deliberately requested commit**. This is a
source catalog of instructions and small helpers, not an application framework
or an autonomous one-click coding service.

> **Compatibility:** the author aims to keep the skills compatible with the
> **Claude Code, Codex and OpenCode** harnesses. Subagents (`.opencode/agents/`)
> are dedicated to OpenCode.

The core is portable across project stacks. An **optional PHP/Symfony/PostgreSQL
profile** retains the more specific conventions for those applications, with an
independent CQRS/modular-monolith override; see the
[project-profile contract](.agents/skills/_shared/references/project-profiles.md).

## What you get

- Workflows with explicit scope, stopping conditions and evidence rather than
  ad-hoc prompts or an unconditional “done”.
- Separate planning, implementation and read-only review; QA uses the consumer's
  configured commands. Implementation does not silently become a commit request.
- Shared runtime rules, dependency-aware delivery and context handoffs.
- Optional specialist workflows for UI consistency, Symfony runtime diagnosis,
  PHP structural changes, GitHub and other tasks.

Choose a workflow in the [skills index](docs/SKILLS.md).

## Requirements

Git, Bash, Node.js 22+, an authenticated model provider and the MCP tools
`codebase-memory`, `serena` and `context7`. PHP, Playwright and other specialist
tools are needed only by the workflows that declare them; see
[configuration](docs/CONFIGURATION.md).

Start on a disposable copy or recoverable snapshot, and read
[Security and trust boundaries](SECURITY.md) before granting tool or account access.

## First result

1. Install with the recommended [LLM Skills Manager (LSM)](https://github.com/wkulinski/lsm),
   or use the [reference procedure](docs/INSTALLATION.md).
2. Merge the [minimal consumer configuration](docs/CONFIGURATION.md#ownership-and-skill-paths),
   configure the OpenCode roles/MCP access, and restart the harness.
3. Follow [First safe result](docs/FIRST-USE.md) and send this prompt to the agent
   from the **consumer root**:

```text
$context-refresh Quick. Load this project's context and report the manifest path
and any missing configuration. Do not edit application code, run full QA, or commit.
```

Expect a context summary, the documentation paths used and a validated local
manifest — or a concrete missing dependency. Failures are covered in
[troubleshooting](docs/TROUBLESHOOTING.md).

## Documentation and contributing

- [Documentation map](docs/README.md)
- [First use](docs/FIRST-USE.md) · [Configuration](docs/CONFIGURATION.md) · [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Installation, update and rollback](docs/INSTALLATION.md)
- [Developing this catalog](docs/DEVELOPMENT.md)

## License

Original material is released under the [MIT License](LICENSE). Referenced
third-party projects (including OpenCode, LSM and Paseo) keep their own licenses.
