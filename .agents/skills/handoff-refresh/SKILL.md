---
name: handoff-refresh
description: >-
  Przygotowuje zrzut bieżącego stanu kontekstu dla kolejnego agenta LLM.
  Użyj, gdy przekazujesz kontekst dalej, kończysz sesję lub wznawiasz pracę
  w nowej sesji.
shared_files:
  - _shared/references/skill-structure-contract.md
  - _shared/references/runtime-collaboration-guidelines.md
---

# $handoff-refresh

## Kontrakt struktury skilla
- Stosuj `<skills_root>/_shared/references/skill-structure-contract.md`: notacja
  ścieżek, priorytet zasad i semantyka `shared_files` (deklaracja dostępności
  i odczyt na żądanie).

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
