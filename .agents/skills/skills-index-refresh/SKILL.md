---
name: skills-index-refresh
description: >-
  Aktualizuje indeks lokalnych skilli w dokumentacji wskazanej przez
  `AGENTS.md`. Użyj, gdy lista skilli, ich opisy lub tabela triggerów wymagają
  odświeżenia.
shared_files:
  - _shared/references/skill-structure-contract.md
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/skill-routing-policy.md
---

# $skills-index-refresh

## Kontrakt struktury skilla
- Stosuj `<skills_root>/_shared/references/skill-structure-contract.md`: notacja
  ścieżek, priorytet zasad i semantyka `shared_files` (deklaracja dostępności
  i odczyt na żądanie).

## Cel
Celem jest odświeżenie indeksu skilli tak, aby odzwierciedlał aktualny stan katalogu `<skills_root>` i pozwalał wybrać skill po intencji. Indeks zawiera alfabetyczną listę wszystkich skilli oraz tabelę triggerów (intencja → skill → następny krok); odświeżenie aktualizuje lub zachowuje oba elementy i nie zastępuje tabeli gołą listą. Routing głównego workflow pozostaje własnością `<skills_root>/_shared/references/skill-routing-policy.md`.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `SKILLS_INDEX_DOC`: ścieżka pliku indeksu skilli.

## Kroki
1. Otwórz `AGENTS.md` i odczytaj mapę `docs_map`.
2. Odczytaj klucz `SKILLS_INDEX_DOC`.
   - Jeśli mapy lub klucza brakuje: zatrzymaj się i dopytaj użytkownika o ścieżkę indeksu skilli.
   - Jeśli plik nie istnieje: utwórz go razem z brakującymi katalogami nadrzędnymi.
3. Przejrzyj katalog `<skills_root>` i zbierz wszystkie dostępne skille oraz ich triggery z pól `description` (`Użyj, gdy …`).
4. Zaktualizuj `SKILLS_INDEX_DOC`, zachowując oba elementy formatu:
   - alfabetyczną listę wszystkich skilli z prefiksem `$`;
   - tabelę triggerów w kolumnach `Intencja | Skill | Następny krok`, pogrupowaną na planowanie, implementację, review kodu i planu, review instrukcji, QA i commit, dokumentację, obsługę issue oraz diagnostykę, pokrywającą wszystkie skille z listy.
5. Dla wierszy głównego workflow użyj tabeli routingu z `<skills_root>/_shared/references/skill-routing-policy.md` jako źródła; nie zmieniaj tej polityki lokalnie i nie kopiuj z niej reguł, których indeks nie potrzebuje.
6. Usuń odwołania do nieistniejących skilli, dodaj brakujące i uzupełnij brakujące triggery na podstawie opisu skilla.
7. Upewnij się, że nazwy w indeksie mają prefiks `$`.

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
  Uwagi: dodano `$context-refresh`, `$docs-sync`, `$docs-todo`, `$git-commit`, `$handoff-refresh`, `$review-quick`, `$skills-index-refresh`, `$commit-message-write`.
  ```
- ```text
  Wynik: indeks bez zmian.
  Uwagi: brak.
  ```

## Efekt
`SKILLS_INDEX_DOC` zawiera aktualną, alfabetyczną listę skilli z prefiksem `$` oraz tabelę triggerów pokrywającą wszystkie skille, albo potwierdzenie braku zmian.

## Przypadki brzegowe
- Katalog skilla bez `SKILL.md` — zgłoś i pomiń.
- Istniejący indeks bez tabeli triggerów — dodaj tabelę zamiast poprzestawać na liście.
- Skill bez czytelnego triggera w `description` — zbuduj intencję z opisu i zgłoś to w Uwagach.
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika o ścieżkę indeksu skilli.
- Brak klucza `SKILLS_INDEX_DOC` w `docs_map` — dopytaj użytkownika o ścieżkę indeksu skilli.
