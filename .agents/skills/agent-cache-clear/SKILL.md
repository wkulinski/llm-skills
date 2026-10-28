---
name: agent-cache-clear
description: >-
  Czyści cache agenta w `CACHE_PATH` (domyślnie `var/agent/cache`, podkatalogi
  per skill). Użyj wyłącznie na wyraźne życzenie użytkownika przy zatrzymanych
  workflow; nie usuwa trwałych danych pracy.
shared_files:
  - _shared/references/skill-structure-contract.md
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/scripts/env-load.sh
  - _shared/scripts/is-main-module.mjs
  - _shared/scripts/artifact-path.mjs
---

# $agent-cache-clear

## Kontrakt struktury skilla
- Stosuj `<skills_root>/_shared/references/skill-structure-contract.md`: notacja
  ścieżek, priorytet zasad i semantyka `shared_files` (deklaracja dostępności
  i odczyt na żądanie).

## Cel
Wyczyścić pliki tymczasowe agenta z `CACHE_PATH` (domyślnie `var/agent/cache/`;
w tym podkatalogi per skill) wyłącznie na jawne polecenie użytkownika.

## Zasady
- Kasujemy wyłącznie zawartość katalogu wskazanego przez `CACHE_PATH` (domyślnie `var/agent/cache/`).
- Nie uruchamiaj, jeśli potrzebujesz zachować stan do debugowania.
- Wszystkie workflow zapisujące do cache muszą być zatrzymane. Commit ani
  ukończenie WP nie uruchamiają pełnego czyszczenia.
- Przed zmianą plików skrypt odmawia dla cache poza repo, równego jego korzeniowi,
  nachodzącego w dowolną stronę na `./docs/plans`, `./var/agent/task-plan`,
  `./var/agent/plan-execute` lub `./var/agent/code-implement` oraz dla ścieżek
  przechodzących przez dowiązania (również istniejących przodków brakującego katalogu).
- Trwałe źródła i dowody planów, pointer oraz stan pracy nie są zmieniane.
- Jeśli bezpieczny katalog nie istnieje, utwórz go dopiero po kontroli i zakończ.

## Kroki
1. Ustal root repo (`git rev-parse --show-toplevel`).
2. Uruchom `node <skill_dir>/scripts/clear.mjs`; skrypt wyznacza korzeń jako
   najbliższy katalog nadrzędny z `.git`, kontroluje lokalizację i usuwa
   zawartość cache bez usuwania katalogu.
   Pomoc bez kasowania: `node <skill_dir>/scripts/clear.mjs --help`.
3. Potwierdź, że cache jest pusty.

## Format odpowiedzi
- Wynik: czy cache wyczyszczony / brak do czyszczenia.
- Uwagi: opcjonalnie.

## Efekt
Katalog cache (`CACHE_PATH`, domyślnie `var/agent/cache/`) jest pusty i gotowy na nowe pliki tymczasowe.
