---
name: handoff-refresh
description: >-
  Przygotuj zrzut bieżącego stanu kontekstu dla kolejnego agenta LLM. Intencje:
  handoff, przekazanie kontekstu, podsumuj stan dla kolejnego agenta. Użyj przy
  $handoff-refresh.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
---

# $handoff-refresh

## Reguły rozwiązywania ścieżek
- Ścieżki z prefiksem `./` są repo-relative (`./` = `git rev-parse --show-toplevel`), a nie względem katalogu procesu.
- Ścieżki w `shared_files` są względne względem katalogu z bieżącym `SKILL.md` (np. `_shared/...` oznacza `../_shared/...`).

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Celem jest przygotowanie zwięzłego handoffu dla kolejnego agenta, zawierającego aktualny stan, ryzyka i kolejne kroki. Dzięki temu następna osoba może płynnie kontynuować pracę.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `HANDOFF_DOC`: ścieżka pliku handoffu.

## Kroki
1. Otwórz `AGENTS.md` i odczytaj mapę `docs_map`.
2. Odczytaj klucz `HANDOFF_DOC`.
   - Jeśli klucza brakuje: zatrzymaj się i dopytaj użytkownika o ścieżkę.
3. Jeśli plik z `HANDOFF_DOC` nie istnieje, utwórz go razem z brakującymi katalogami nadrzędnymi.
4. Zaktualizuj lub utwórz `HANDOFF_DOC`.
5. Wpisz krótki, konkretny stan: co działa, na co uważać, co dalej.
6. Uwzględnij bieżące ograniczenia, ryzyka i otwarte decyzje.
7. Pamiętaj, że plik jest lokalny, ignorowany przez git, i ma być czytelny dla kolejnego agenta.

## Format odpowiedzi
- Wynik: handoff utworzony / zaktualizowany.
- Użyte klucze dokumentacji:
  - `HANDOFF_DOC=<resolved-path>`
- Co działa
- Na co uważać
- Co dalej
- (Opcjonalnie) Blokery/Ryzyka
- Każda sekcja: 1–3 krótkie punkty.

## Przykłady wejścia
- "zrób handoff"
- "przygotuj przekazanie kontekstu"
- "handoff"

## Przykłady wyjścia
- ```text
  Co działa:
  - Skille w `../` uzupełnione o przykłady wejścia/wyjścia
  - Indeks skilli w dokumentacji jest aktualny
  Na co uważać:
  - Nie nadpisuj ręcznych zmian użytkownika w dokumentacji bez potwierdzenia
  Co dalej:
  - Zweryfikować spójność przykładów z kolejnymi zmianami w dokumentacji
  Blokery/Ryzyka:
  - Brak
  ```
- ```text
  Co działa:
  - Kontekst odświeżony
  Na co uważać:
  - Brak
  Co dalej:
  - Brak
  ```

## Efekt
`HANDOFF_DOC` zawiera aktualny, krótki zapis stanu z kluczowymi punktami i ewentualnymi ryzykami.

## Przypadki brzegowe
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika o ścieżkę handoffu.
- Brak klucza `HANDOFF_DOC` w `docs_map` — dopytaj użytkownika o ścieżkę handoffu.
