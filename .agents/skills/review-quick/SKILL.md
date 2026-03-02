---
name: review-quick
description: >-
  Szybka auto‑weryfikacja bieżących zmian bez pełnej procedury commit. Intencje:
  szybki review, sprawdź zmiany, szybka weryfikacja. Użyj przy $review-quick.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
  - _shared/scripts/env-load.sh
---

# $review-quick

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Celem jest szybka weryfikacja bieżących zmian pod kątem zgodności z promptem i zasadami projektu, bez uruchamiania pełnego QA. Ma to wychwycić oczywiste braki, ryzyka i potrzeby testów.

## Kroki
1. Potwierdź zgodność zmian z promptem i/lub planem.
2. Jeśli uruchamiasz komendy pomocnicze podczas weryfikacji:
   - użyj helpera `.agents/skills/_shared/scripts/env-load.sh` (`resolve_tool_cmd`),
   - komendy wyznaczaj wyłącznie przez `resolve_tool_cmd`,
   - nie wyprowadzaj ścieżek ręcznie z `BIN_PATH`; resolver ładuje `.env`/`.env.local` automatycznie.
3. Zweryfikuj zgodność zmian z baseline:
   - `../_shared/references/php-symfony-postgres-standards.md`
4. Jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1` w `.env` / `.env.local`: zweryfikuj zgodność zmian z:
   - `../_shared/references/cqrs-monolith-standard-overrides.md`
5. Wypunktuj potencjalne luki, ryzyka i testy do dodania.

## Zakres
- W zakresie: szybka weryfikacja zmian bez pełnej procedury commit.
- Poza zakresem: uruchamianie pełnych lintów/testów.

## Format odpowiedzi
- Wynik: krótka informacja o zgodności z promptem/planem.
- Ryzyka/Błędy: lista potencjalnych problemów.
- Testy: lista brakujących lub sugerowanych testów.
- Naruszenia zasad: jeśli są, wypunktuj (np. strict_types, warstwy, UTC).
- Jeśli nie ma uwag, napisz wprost: "Brak uwag."

## Przykłady wejścia
- "szybki review zmian"
- "quick review"
- "sprawdź zmiany"

## Przykłady wyjścia
- ```text
  Brak uwag.
  ```
- ```text
  Wynik: zgodne z planem.
  Ryzyka/Błędy:
  - Brak walidacji wejścia w nowym CLI (np. brak guardów na format danych)
  Testy:
  - Dodać test funkcjonalny w `tests/functional/<Module>/` dla nowego use-case'u
  Naruszenia zasad:
  - Brak `declare(strict_types=1);` w nowym pliku PHP
  - Klasa nie jest `final`, choć nie jest dziedziczona
  ```

## Efekt
Zwrócony jest krótki raport z ewentualnymi ryzykami, brakami i sugestiami testów albo informacja "Brak uwag."

## Przypadki brzegowe
- Brak zmian do oceny — "Brak uwag."
