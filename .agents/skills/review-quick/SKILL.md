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

## Reguły rozwiązywania ścieżek
- Ścieżki z prefiksem `./` są repo-relative (`./` = `git rev-parse --show-toplevel`), a nie względem katalogu procesu.
- Ścieżki w `shared_files` są względne względem katalogu z bieżącym `SKILL.md` (np. `_shared/...` oznacza `../_shared/...`).

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Celem jest szybka weryfikacja bieżących zmian pod kątem zgodności z promptem i zasadami projektu, bez uruchamiania pełnego QA. Ma to wychwycić oczywiste braki, ryzyka i potrzeby testów.

## Tryb domyślny i granice
- Domyślnie `$review-quick` działa w trybie `review-only`.
- `review-only` oznacza: identyfikacja ryzyk/błędów/luk testowych bez implementowania poprawek.
- Jeśli użytkownik chce poprawki, należy przejść do `$code-implement` (a nie rozszerzać `$review-quick`).

## Podstawa sprawdzeń i źródła dowodów
- Sprawdzenia opieraj na:
  - promptcie użytkownika i/lub planie zadania,
  - realnie zmienionych plikach w repo,
  - baseline `../_shared/references/php-symfony-postgres-standards.md`,
  - override `../_shared/references/cqrs-monolith-standard-overrides.md` (gdy `CQRS_MONOLITH_STANDARD_OVERRIDES=1`),
  - dowodach z odczytów plików i komend uruchomionych w tej sesji.
- Jeśli uruchamiasz komendy pomocnicze podczas weryfikacji:
  - użyj helpera `./.agents/skills/_shared/scripts/env-load.sh` (`resolve_tool_cmd`),
  - komendy wyznaczaj wyłącznie przez `resolve_tool_cmd`,
  - nie wyprowadzaj ścieżek ręcznie z `BIN_PATH`; resolver ładuje `.env`/`.env.local` automatycznie.
- Jeśli review dotyczy regresji runtime, logów, profilera albo DI:
  - możesz pomocniczo użyć `$dev-mate` (`../dev-mate/SKILL.md`),
  - ale findings nadal mają mapować się do kodu, konfiguracji lub zachowania aplikacji.

## Kontrakt wykonania (quick-check)
1. Zidentyfikuj zakres przeglądu na podstawie prompta i zmienionych plików.
2. Potwierdź zgodność zmian z promptem i/lub planem.
3. Zweryfikuj zgodność zmian z baseline:
   - `../_shared/references/php-symfony-postgres-standards.md`
4. Jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1` w `.env` / `.env.local`: zweryfikuj zgodność zmian z:
   - `../_shared/references/cqrs-monolith-standard-overrides.md`
5. Priorytetyzuj analizę:
   - najpierw pliki high-risk (security, persistence, entrypointy, config/tooling),
   - następnie obszar wskazany w prompt,
   - na końcu pozostałe pliki w zakresie quick-check.
6. Każde istotne ustalenie musi mieć dowód:
   - referencję do pliku/sekcji, albo
   - wynik komendy użytej w tej sesji.
7. Nie uruchamiaj pełnego QA z automatu.
8. Jeśli quick-check ujawnia problemy przekraczające zakres szybkiej weryfikacji, zwróć rekomendację uruchomienia `$qa-run`.

## Zakres
- W zakresie: szybka weryfikacja zmian bez pełnej procedury commit.
- Poza zakresem: uruchamianie pełnych lintów/testów.

## Poziomy ustaleń
- `HIGH`: realny bug, regresja, naruszenie bezpieczeństwa, ryzyko danych.
- `MEDIUM`: ryzyko utrzymaniowe, brak ważnego testu, słabe pokrycie edge-case.
- `LOW`: drobne niespójności, kosmetyka, sugestie usprawnień.

## Format odpowiedzi (findings-first)
- Findings:
  - każdy wpis: `[SEVERITY] <krótki tytuł> — <plik/lokalizacja> — <dlaczego to problem> — <zalecenie>`
- Open Questions/Assumptions:
  - tylko jeśli bez tej informacji nie da się rzetelnie ocenić ryzyka.
- Summary:
  - 1–3 zdania o zgodności zmian z promptem.
- Test Gaps:
  - konkretne brakujące testy (unit/functional/contract/integration), jeśli dotyczy.
- Jeśli brak ustaleń:
  - napisz wprost: `Brak uwag.`,
  - dopisz: `Ryzyka rezydualne:` i wskaż ewentualne obszary nieobjęte quick-check.

## Warunek zakończenia
- Skill kończy się po dostarczeniu raportu w formacie `findings-first`.
- Brak błędów w quick-check nie zastępuje pełnego QA przed commitem.
