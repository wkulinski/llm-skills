---
name: skills-index-refresh
description: >-
  Aktualizacja indeksu lokalnych skills w dokumentacji wskazanej przez
  AGENTS.md. Intencje: odśwież listę skilli, zaktualizuj indeks SKILLS. Użyj
  przy $skills-index-refresh.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
---

# $skills-index-refresh

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Celem jest odświeżenie indeksu skilli tak, aby odzwierciedlał aktualny stan katalogu `../`. Dzięki temu dokumentacja skilli pozostaje kompletna i spójna.

## Mapa ścieżek dokumentacji (AGENTS-first)
1. Zawsze zaczynaj od `AGENTS.md`.
2. Odczytaj mapę ścieżek dokumentacji `docs_map`.
3. Wszystkie ścieżki z mapy traktuj jako repo-relative.
4. Nie zgaduj ścieżek po nazwie pliku.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `SKILLS_INDEX_DOC`: ścieżka pliku indeksu skilli.

## Kroki
1. Otwórz `AGENTS.md` i odczytaj mapę `docs_map`.
2. Odczytaj klucz `SKILLS_INDEX_DOC`.
   - Jeśli mapy lub klucza brakuje: zatrzymaj się i dopytaj użytkownika o ścieżkę indeksu skilli.
   - Jeśli plik nie istnieje: utwórz go razem z brakującymi katalogami nadrzędnymi.
3. Przejrzyj katalog `../` i zbierz wszystkie dostępne skille.
4. Zaktualizuj `SKILLS_INDEX_DOC`, aby lista skilli była kompletna i posortowana alfabetycznie po nazwie skilla.
5. Usuń odwołania do nieistniejących skilli i dodaj brakujące.
6. Upewnij się, że nazwy w indeksie mają prefiks `$`.

## Format odpowiedzi
- Wynik: krótka informacja, czy indeks został zaktualizowany lub czy nie było zmian.
- Użyte klucze dokumentacji:
  - `SKILLS_INDEX_DOC=<resolved-path>`
- Uwagi: opcjonalne (np. brakujące pliki).

## Przykłady wejścia
- "odśwież indeks skilli"
- "zaktualizuj listę skilli"
- "odśwież SKILLS.md"

## Przykłady wyjścia
- ```text
  Wynik: indeks zaktualizowany.
  Uwagi: dodano `$context-refresh`, `$docs-sync`, `$docs-todo`, `$git-commit`, `$handoff-refresh`, `$review-quick`, `$skills-index-refresh`, `$worklog-add`.
  ```
- ```text
  Wynik: indeks bez zmian.
  Uwagi: brak.
  ```

## Efekt
`SKILLS_INDEX_DOC` zawiera aktualną, alfabetyczną listę skilli z prefiksem `$` albo potwierdzenie braku zmian.

## Przypadki brzegowe
- Katalog skilla bez `SKILL.md` — zgłoś i pomiń.
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika o ścieżkę indeksu skilli.
- Brak klucza `SKILLS_INDEX_DOC` w `docs_map` — dopytaj użytkownika o ścieżkę indeksu skilli.
