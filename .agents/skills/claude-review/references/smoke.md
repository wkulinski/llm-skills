# Smoke `$claude-review`

Próba uruchamia prawdziwą sesję Claude Code z abonamentu, więc wymaga jawnej
zgody operatora. Domyślne `npm test` jej nie uruchamia.

## Warunki

- Paseo działa, a workspace repozytorium jest zaufany w Claude Code.
- Komenda jest uruchamiana z sesji agenta Paseo (`PASEO_AGENT_ID` wskazuje
  koordynatora, który zostanie rodzicem sesji review).
- `CACHE_PATH` jest ignorowany przez git.

## Lokalnie (llm-skills, skille przez symlink)

```bash
CLAUDE_REVIEW_SMOKE=1 \
CLAUDE_REVIEW_MODEL=claude-opus-5-5 \
CLAUDE_REVIEW_THINKING=medium \
CLAUDE_REVIEW_TIMEOUT_SECONDS=900 \
npm run test:integration -- tests/skills/claude-review/claude-review.integration.test.mjs
```

Test tworzy tymczasowy plik z jednoznacznym błędem wobec wymagania, zleca
review, odbiera kopertę przez helper i sprawdza: natywne `[Skill] code-review`
w timeline, decyzję `ACCEPTED` oraz finding wskazujący błąd. Artefakty
(`job.json`, `inspect-*.json`, `timeline.txt`, `result.json`) zostają w
`var/agent/cache/claude-review/<job_id>/`. Po teście plik fixture i sesja są
usuwane lub archiwizowane.

`timeline.txt` służy też do obserwacji, czy wykonawca użył edycji, Bash albo
delegacji. Takie użycie jest ustaleniem do oceny, nie testem blokady (sesja
działa bez natywnych ograniczeń narzędzi).

## Downstream (kopie z LSM)

1. Udostępnij zatwierdzony ref źródła z `claude-review` (push wymaga zgody).
2. W projekcie konsumenta dodaj `claude-review` do `skills.json` i uruchom
   `lsm sync --update`.
3. Sprawdź kopie: `find .claude/skills -type l` nie zwraca nic, wpisy
   `shared_files` skilla istnieją w `.claude/skills/_shared`, a `scripts/*.sh`
   zachowują bit `+x`. `git status` nie pokazuje zmian w `.claude/settings.json`,
   `CLAUDE.md` ani `AGENTS.md` wywołanych przez LSM.
4. Zaufaj workspace w Claude Code i powtórz przebieg skilla według
   `<skill_dir>/SKILL.md` z małą syntetyczną zmianą.

Ręczne `cp` nie zastępuje instalacji przez LSM.
