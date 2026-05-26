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
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

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
  - baseline `<skills_root>/_shared/references/php-symfony-postgres-standards.md`,
  - override `<skills_root>/_shared/references/cqrs-monolith-standard-overrides.md` (gdy `CQRS_MONOLITH_STANDARD_OVERRIDES=1`),
  - dowodach z odczytów plików i komend uruchomionych w tej sesji.
- Jeśli uruchamiasz komendy pomocnicze podczas weryfikacji:
  - użyj helpera `env-load.sh` wskazanego w `shared_files` (`resolve_tool_cmd`),
  - komendy wyznaczaj wyłącznie przez `resolve_tool_cmd`,
  - nie wyprowadzaj ścieżek ręcznie z `BIN_PATH`; resolver ładuje aktywne pliki env repo automatycznie.
- Jeśli review dotyczy regresji runtime, logów, profilera albo DI:
  - możesz pomocniczo użyć `$dev-mate` (`<skills_root>/dev-mate/SKILL.md`),
  - ale findings nadal mają mapować się do kodu, konfiguracji lub zachowania aplikacji.

## Kontrakt wykonania (quick-check)
1. Zidentyfikuj zakres przeglądu na podstawie prompta i zmienionych plików.
2. Potwierdź zgodność zmian z promptem i/lub planem.
3. Zweryfikuj zgodność zmian z baseline:
   - `<skills_root>/_shared/references/php-symfony-postgres-standards.md`
4. Jeśli aktywne pliki env repo ustawiają końcowo `CQRS_MONOLITH_STANDARD_OVERRIDES=1`: zweryfikuj zgodność zmian z:
   - `<skills_root>/_shared/references/cqrs-monolith-standard-overrides.md`
5. Priorytetyzuj analizę:
   - najpierw pliki high-risk (security, persistence, entrypointy, config/tooling),
   - następnie obszar wskazany w prompt,
   - na końcu pozostałe pliki w zakresie quick-check.
6. Jeśli diff dotyka treści widocznych użytkownikowi, wykonaj check UTF-8/diakrytyków:
   - obejmuje to w szczególności migracje seedujące słowniki, klasy `*Dictionary*`, translacje `messages.*.yaml`, Twig, formularze, komunikaty walidacyjne oraz pola/wartości typu `name`, `label`, `title`, `description`, `placeholder`;
   - porównaj wartości user-facing z promptem, issue lub dokumentacją domenową;
   - zgłoś jako finding każdą nieuzasadnioną transliterację, np. `Spółka` -> `Spolka`, `działalność` -> `dzialalnosc`;
   - nie traktuj starszych danych ASCII jako automatycznego wzorca, jeśli bieżąca specyfikacja podaje tekst z polskimi znakami;
   - jeśli repo zawiera sprzeczne przykłady albo nie wiadomo, czy ASCII jest wymaganiem kontraktu, dodaj Open Question zamiast zakładać normalizację.
7. Każde istotne ustalenie musi mieć dowód:
   - referencję do pliku/sekcji, albo
   - wynik komendy użytej w tej sesji.
8. Nie uruchamiaj pełnego QA z automatu.
9. Jeśli quick-check ujawnia problemy przekraczające zakres szybkiej weryfikacji, zwróć rekomendację uruchomienia `$qa-run`.

## Zakres
- W zakresie: szybka weryfikacja zmian bez pełnej procedury commit.
- Poza zakresem: uruchamianie pełnych lintów/testów.

## Poziomy ustaleń
- `HIGH`: realny bug, regresja, naruszenie bezpieczeństwa, ryzyko danych.
- `MEDIUM`: ryzyko utrzymaniowe, brak ważnego testu, słabe pokrycie edge-case, nieuzasadniona utrata znaków diakrytycznych albo rozjazd user-facing label względem issue/specyfikacji.
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
