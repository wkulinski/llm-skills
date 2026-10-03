---
name: claude-review
description: >-
  Deleguje odczytowy review kodu working tree do Claude Code z Opusem przez
  Paseo, wiąże raport ze snapshotem zmian i ocenia kandydatów bramką
  `code-review`. Użyj, gdy jawnie chcesz zlecić review kodu Claude z OpenCode.
compatibility: Git-based projects with Paseo and Claude Code.
shared_files:
  - _shared/references/skill-structure-contract.md
  - _shared/references/skill-routing-policy.md
  - _shared/references/repository-context-hybrid.md
  - _shared/scripts/env-load.sh
  - _shared/scripts/artifact-path.mjs
  - _shared/scripts/change-inventory.mjs
  - _shared/scripts/secret-detector.mjs
  - code-review/SKILL.md
---

# $claude-review

## Kontrakt struktury skilla

Stosuj `<skills_root>/_shared/references/skill-structure-contract.md`: notacja
ścieżek, priorytet zasad i semantyka `shared_files`.

## Cel i granice

`$claude-review` uruchamia **jedną** próbę review kodu wykonywaną przez Claude
Code (Opus, abonament claude.ai) jako wykonawcę roli `execution_role: executor`
skilla `$code-review`. Agent wywołujący (OpenCode) pozostaje koordynatorem:
zbiera kontekst, uruchamia sesję, odbiera raport i sam decyduje o werdykcie.

- Uruchamiaj wyłącznie na jawne polecenie `$claude-review`. Zwykłe `$code-review`,
  `$review-quick` i review planów zachowują swój routing.
- Obsługiwany jest tylko target `code` obejmujący cały working tree (staged,
  unstaged, untracked). Commit, zakres commitów i PR są poza zakresem.
- Metodyka review należy do `$code-review`; ten skill nie powiela checklist ani
  bramki publikacji.
- Bez fallbacku API, zmiany modelu, retry ani naprawy kodu.
- Sesja używa wbudowanego providera `claude` w trybie `auto`, bez dodatkowych
  ograniczeń narzędzi (tak jak agent `build` w OpenCode). Granicę „tylko odczyt”
  wyznacza rola wykonawcy w `$code-review`; zmiana plików w trakcie review
  kończy się przy odbiorze wynikiem `STALE`.

Kontrakt danych, statusów i decyzji helpera opisuje
`<skill_dir>/references/execution-contract.md`.

## Wymagania wstępne (operator)

Brak któregokolwiek warunku kończy skill wynikiem `BLOCKED` bez uruchamiania
sesji:

1. Paseo CLI i daemon są dostępne; komendę ustal przez `resolve_tool_cmd paseo`
   z `<skills_root>/_shared/scripts/env-load.sh`.
2. Workspace badanego repo jest zaufany w Claude Code na tej maszynie. Ten
   skill nie zapisuje trust ani nie zatwierdza żądań uprawnień.
3. Claude jest zalogowany kontem claude.ai; proces nie dostaje aktywnego
   credential API.
4. Użytkownik podał jawnie: dokładny model Opus, poziom thinking i dodatnie
   `timeout_seconds`. Nie ma wartości domyślnych.

## Workflow

### 1. Kontekst

Ustal wymagania (polecenie użytkownika, zmapowany WP planu, reguły). Jeśli
brakuje niezbędnego kontekstu repozytorium, uzupełnij go istniejącą hybrydą z
`<skills_root>/_shared/references/repository-context-hybrid.md` albo zakończ ze
wskazaniem luki. Zapisz wymagania do pliku w `CACHE_PATH`.

### 2. Przygotowanie zlecenia

Wygeneruj UUID jako `job_id`, a następnie:

```bash
node <skill_dir>/scripts/review-job.mjs prepare \
  --job-id <uuid> --requirements <CACHE_PATH>/claude-review-requirements.md \
  --model claude-opus-5-5 --thinking low --timeout-seconds 60 \
  --context ./docs/plans/<plan-id>.md
```

Helper zapisuje pod `<CACHE_PATH>/claude-review/<job_id>/` inventory, odrębne
diffy staged i unstaged, listę untracked, wymagania, prompt i `job.json` z
parą `HEAD` + `combined_sha256` oraz hashami wejść. Diffy wyglądające na
zawierające sekrety są pomijane i wypisane w `omitted_sensitive` — to
ograniczenie coverage, które musi trafić do raportu końcowego.

### 3. Uruchomienie

```bash
source <skills_root>/_shared/scripts/env-load.sh
PASEO="$(resolve_tool_cmd paseo)"
"$PASEO" run --background --provider claude --model <model> \
  --thinking <thinking> --mode auto --cwd <repo> --title "claude-review <job_id>" \
  --env ANTHROPIC_API_KEY= --env ANTHROPIC_AUTH_TOKEN= --env ANTHROPIC_BASE_URL= \
  --json "$(cat <prompt_path>)"
"$PASEO" inspect <session-id> --json > <job_dir>/inspect-launch.json
node <skill_dir>/scripts/review-job.mjs bind-session \
  --job <job_path> --inspect <job_dir>/inspect-launch.json --parent-id "$PASEO_AGENT_ID"
```

Niezgodna sesja (`SESSION_MISMATCH`) oznacza `BLOCKED`: zatrzymaj i zarchiwizuj
własną sesję, nie uruchamiaj kolejnej.

### 4. Odbiór

```bash
"$PASEO" wait <session-id> --timeout <timeout_seconds> --json
"$PASEO" inspect <session-id> --json > <job_dir>/inspect-final.json
"$PASEO" logs <session-id> --filter text --tail 1 > <job_dir>/envelope.txt
node <skill_dir>/scripts/review-job.mjs accept \
  --job <job_path> --envelope <job_dir>/envelope.txt --inspect <job_dir>/inspect-final.json
```

Gdy `wait` przekroczy limit, wykonaj `paseo stop <session-id>` i sprawdź przez
`inspect`, czy sesja nie pracuje. Następnie zapisz wynik:
`review-job.mjs record-timeout --job <job_path> --stop-confirmed yes|no`.
Potwierdzone przerwanie daje `INCOMPLETE`; niepotwierdzone raportuj jawnie —
helper blokuje wtedy kolejne zlecenia do czasu wyjaśnienia przez operatora.

### 5. Ocena

- `ACCEPTED` oznacza tylko, że raport należy do tego joba, sesji i snapshotu.
  Nie jest werdyktem. Każdego kandydata z `report_markdown` zweryfikuj bramką
  publikacji z sekcji „Verify candidate findings”
  `<skills_root>/code-review/SKILL.md` punktowymi odczytami,
  bez nowego pełnego discovery, i sam wydaj werdykt.
- `REJECTED` — nie publikuj werdyktu; podaj powód helpera.
- `STALE` — snapshot zmienił się w trakcie review; raport nie jest aktualny.
- `BLOCKED` — oczekujące żądanie uprawnienia (np. niezaufany workspace) albo
  nieprzygotowane środowisko.

Sprawdź coverage raportu: niewykonane checki (`verification_gap`) i pominięte
dane wrażliwe ograniczają werdykt, a komendy weryfikacyjne, o które prosi
wykonawca, uruchamia koordynator.

### 6. Zakończenie

Zarchiwizuj wyłącznie własną sesję (`paseo archive <session-id>`). Zachowaj
`job.json` i `result.json` jako bezpieczną diagnostykę; nie kopiuj treści
diffów do logów.

## Punktowa weryfikacja skilla

```bash
node <skill_dir>/scripts/review-job.mjs --help
npm run test:unit -- tests/skills/claude-review/review-job.test.mjs tests/skills/claude-review/skill-contract.test.mjs
```
