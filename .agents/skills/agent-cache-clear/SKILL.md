---
name: agent-cache-clear
description: >-
  Czyści cache agenta w CACHE_PATH (domyślnie var/agent/cache; podkatalogi per
  skill). Użyj po udanym $git-commit lub na zadanie użytkownika.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/scripts/env-load.sh
---

# $agent-cache-clear

## Reguły rozwiązywania ścieżek
- Ścieżki z prefiksem `./` są repo-relative (`./` = `git rev-parse --show-toplevel`), a nie względem katalogu procesu.
- Ścieżki w `shared_files` są względne względem katalogu z bieżącym `SKILL.md` (np. `_shared/...` oznacza `../_shared/...`).

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Wyczyścić pliki tymczasowe agenta z `CACHE_PATH` (domyślnie `var/agent/cache/`; w tym podkatalogi per skill) po udanym commicie lub na zadanie użytkownika.

## Zasady
- Kasujemy wyłącznie zawartość katalogu wskazanego przez `CACHE_PATH` (domyślnie `var/agent/cache/`).
- Nie uruchamiaj, jeśli potrzebujesz zachować stan do debugowania.
- Jeśli katalog nie istnieje, utwórz go i zakończ.

## Kroki
1. Ustal root repo (`git rev-parse --show-toplevel`).
2. Usuń zawartość katalogu cache bez usuwania samego katalogu (preferowany skrypt `scripts/clear.sh`).
3. Potwierdź, że cache jest pusty.

## Format odpowiedzi
- Wynik: czy cache wyczyszczony / brak do czyszczenia.
- Uwagi: opcjonalnie.

## Efekt
Katalog cache (`CACHE_PATH`, domyślnie `var/agent/cache/`) jest pusty i gotowy na nowe pliki tymczasowe.
