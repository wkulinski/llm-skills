---
name: gh-issue-status-set
description: >-
  Ustawia status issue w GitHub Projects v2 na podstawie brancha/issue i danych
  z GitHub. Dopytuje tylko, gdy brakuje kluczowych danych.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/scripts/env-load.sh
---

# $gh-issue-status-set

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Ustawić status issue w GitHub Projects v2 na podstawie bieżącego brancha, numeru issue i danych z GitHub. Najpierw próbujemy ustalić wszystko automatycznie; dopytujemy tylko, gdy brakuje danych lub jest konflikt.

## Kroki (domyślne)
1. Dobierz status na podstawie kontekstu (patrz: „Dobór statusu”).
2. Sprawdź autoryzację i uprawnienia:
   - `gh auth status`
   - Jeśli używasz `GH_TOKEN`: upewnij się, że token ma scope `project` i `read:org` (Projects v2 w org); `gh auth refresh` nie zadziała przy ustawionym `GH_TOKEN`.
   - Jeśli nie używasz `GH_TOKEN` i brakuje scope `project` lub `read:org`: `gh auth refresh -h github.com -s project,read:org`
3. Uruchom skrypt:
   - `./scripts/set-status.sh --status "<STATUS>"`
   - Opcjonalnie: `--issue <ID>`, `--project-number <NUM>`, `--field <NAZWA>`
4. Jeśli skrypt zwraca błąd, zinterpretuj kod wyjścia i **zawsze** uruchom skrypt ponownie z uzupełnionymi danymi (bez ręcznego “rzeźbienia”).

## Interpretacja kodów wyjścia i retry
- `3` brak numeru issue: spróbuj ustalić issue przez MCP (`mcp__github__search_issues` w repo, użyj słów z ostatniego subject). Jeśli 1 wynik → uruchom skrypt z `--issue`. Jeśli wiele/brak → dopytaj użytkownika.
- `4` issue nie jest w projekcie i brak `--project-number`: ustal projekt (MCP nie obsługuje Projects v2). Użyj `gh project list --owner <OWNER>` i jeśli jest jedna pozycja → wybierz ją, w przeciwnym razie dopytaj. Następnie uruchom skrypt z `--project-number`.
- `5` issue jest w wielu projektach: poproś użytkownika o numer projektu i uruchom skrypt z `--project-number`.
- `6` issue nie jest w wybranym projekcie i nie udało się dodać: dopytaj o właściwy numer projektu albo upewnij się, że issue istnieje w repo, po czym uruchom skrypt ponownie.
- `7` brak pola/opcji statusu: sprawdź pola `gh project field-list <OWNER>/<PROJECT_NUMBER>` i uruchom skrypt z `--field <NAZWA>` oraz poprawnym `--status`, jeśli potrzeba. Gdy nadal niejasne → dopytaj użytkownika.
- `8` brak statusu: ustal oczekiwany status z kontekstu rozmowy albo dopytaj użytkownika i uruchom skrypt z `--status`.

## Dobór statusu (proste mapowanie)
- Wystawiony PR / prośba o review → `In review`
- Start pracy / WIP / rozpoczęcie zadania → `In progress`
- Gotowe do podjęcia → `Ready`
- Zakończone → `Done`
- Jeśli niejednoznaczne → dopytaj użytkownika.

## Heurystyka ustalania issue (w skrypcie)
Skrypt próbuje kolejno:
1. Numer z nazwy brancha: `issue/<ID>-*` lub `issue-<ID>-*`.
2. Numer z tytułu ostatniego commita (np. `#123` w subject).
3. Wyszukanie po tytule: słowa kluczowe z subject (max 7 słów), `gh search issues ...`.
   - Gdy wynik jest jeden → używa go.
   - Gdy jest wiele → wypisuje listę i kończy działanie.

Skrypt sam próbuje ustalić owner/repo, numer issue i projekt. Jeśli danych brakuje lub jest konflikt, wypisze komunikat, na podstawie którego dopytasz użytkownika.

## Format odpowiedzi
- Wynik: status ustawiony / brak danych do ustalenia.
- Uwagi: czego brakuje lub co wymaga decyzji użytkownika.
