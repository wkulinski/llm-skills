# Documentation

This repository is a source catalog of reusable agent workflows. Start with the
[catalog README](../README.md) for value, requirements and support boundaries.

## Use the skills in your project

| Need | Guide |
| --- | --- |
| Reach a first safe context result | [First use](FIRST-USE.md) |
| Deliver the complete starter, update or roll back | [Reference installation](INSTALLATION.md) |
| Set documentation paths, profiles, roles, tools and MCP access | [Consumer configuration](CONFIGURATION.md) |
| Diagnose a missing dependency or blocked workflow | [Troubleshooting](TROUBLESHOOTING.md) |
| Choose a skill and inspect its effects/dependencies | [Single skills index](SKILLS.md) |
| Understand permissions, secrets and safe security reporting | [Security and trust boundaries](../SECURITY.md) |
Public guides are English; skill instructions remain Polish. The guides route to
the skill/shared owner rather than duplicating operational procedures.

## Scope
- Skill instructions live in `.agents/skills/<skill-name>/SKILL.md`.
- Optional helper scripts live in `.agents/skills/<skill-name>/scripts/`.
- Project-local OpenCode extensions live in `.opencode/`; [configuration](CONFIGURATION.md) explains consumer runtime setup and [development](DEVELOPMENT.md) explains catalog-local extensions.
- The core profile is generic; PHP/Symfony/PostgreSQL and architecture overrides activate only through the [profile contract](../.agents/skills/_shared/references/project-profiles.md).
- Tests for repository tooling and reference delivery live under `tests/`.
- Ready execution plans live in `docs/plans/`; working drafts remain in `docs/drafts/`.

## Documentation Map
- [Developing the catalog](DEVELOPMENT.md) — authoring, tests and local extensions
- [Workflow routing policy](../.agents/skills/_shared/references/skill-routing-policy.md) — canonical owner for selecting the top-level workflow
- [Module index](./modules/README.md)
- [Context scout benchmark](./benchmark/context-scout-fast-vs-inline.md)
- [Repository-context hybrid protocol](../.agents/skills/_shared/references/repository-context-hybrid.md)

## Notes
- This repo does not define application modules like a business monolith.
- The module index is kept for compatibility with shared documentation skills.
