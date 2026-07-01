---
name: review-quick
description: >-
  Szybka auto‑weryfikacja bieżących zmian bez pełnej procedury commit. Intencje:
  szybki review, sprawdź zmiany, szybka weryfikacja. Użyj przy $review-quick.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
  - _shared/references/symbolic-navigation-and-editing-policy.md
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
- Gdy `$review-quick` jest uruchamiany jako część pętli `$code-implement`, priorytetem jest ostatni przyrost i obszary bezpośrednio nim dotknięte.
- Nie rozszerzaj wtedy raportu na cały narosły dirty diff, chyba że użytkownik prosi o review całego zakresu albo ostatni przyrost zmienia kontrakt całego rozwiązania.

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
3. Wykonaj przegląd semantyczno-utrzymaniowy zmian:
   - szukaj rozwiązań trudniejszych niż problem wymaga,
   - kodu wprowadzonego „dla samej struktury”, bez realnej potrzeby,
   - nieintuicyjnych przejść między warstwami, helperami lub modelami,
   - duplikacji logiki, pól, konfiguracji lub kontraktów,
   - nakładania się odpowiedzialności między klasami/modułami,
   - rozwiązań równoległych do istniejącego mechanizmu, które powinny być zunifikowane,
   - miejsc, gdzie prostszy kontrakt lepiej oddaje semantykę domeny,
   - niejawnych konwersji lub mapowań między prawie tymi samymi strukturami danych,
   - placeholderów, ślepych ścieżek i domyślnych zachowań ukrywających brak implementacji,
   - warunków, flag lub parametrów sterujących, które sugerują zbyt szeroką odpowiedzialność jednej metody,
   - nowych nazw/typów/DTO, które nie niosą nowej semantyki względem istniejących pojęć,
   - rozjazdu między nazwą metody/klasy a faktyczną odpowiedzialnością,
   - obsługi błędów rozproszonej po kilku warstwach zamiast zamkniętej na właściwej granicy,
   - logiki domenowej ukrytej w warstwie technicznej, konfiguracji, mapperze albo helperze,
   - niezaplanowanych ścieżek kompatybilności wstecznej lub obsługi legacy danych, które nie wynikają z prompta, planu migracji ani istniejącego kontraktu,
   - cichego obchodzenia, naprawiania, normalizowania lub pomijania niespójnych danych zamiast potraktowania ich jako błędu,
   - fallbacków, wartości domyślnych, nullable/optional rozszerzeń albo `catch`/guardów, które ukrywają naruszenie inwariantu domenowego,
   - równoległej obsługi starego i nowego formatu/modelu bez jasnej decyzji o migracji, okresie przejściowym lub usunięciu starej ścieżki.

   Jeśli zmiana trafia na niespójne dane, brak wymaganej relacji, niepoprawny stan domenowy albo stary format danych, nie zakładaj automatycznie potrzeby kompatybilności wstecznej. Oceń, czy prompt lub istniejący kontrakt wymaga tolerowania takiego stanu. Jeśli nie, preferuj wykrycie błędu i jawne zgłoszenie ryzyka zamiast cichego fallbacku, naprawy w locie lub rozszerzania kontraktu.

   Raportuj tylko ustalenia, dla których da się wskazać konkretny koszt utrzymaniowy, ryzyko błędu, niejasność kontraktu albo istniejący wzorzec w repo, z którym zmiana powinna być spójna.
4. Zweryfikuj zgodność zmian z baseline:
   - `<skills_root>/_shared/references/php-symfony-postgres-standards.md`
5. Jeśli aktywne pliki env repo ustawiają końcowo `CQRS_MONOLITH_STANDARD_OVERRIDES=1`: zweryfikuj zgodność zmian z:
   - `<skills_root>/_shared/references/cqrs-monolith-standard-overrides.md`
6. Priorytetyzuj analizę:
   - najpierw pliki high-risk (security, persistence, entrypointy, config/tooling),
   - następnie obszar wskazany w prompt,
   - na końcu pozostałe pliki w zakresie quick-check.
7. Jeśli diff dotyka treści widocznych użytkownikowi, wykonaj check UTF-8/diakrytyków:
   - obejmuje to w szczególności migracje seedujące słowniki, klasy `*Dictionary*`, translacje `messages.*.yaml`, Twig, formularze, komunikaty walidacyjne oraz pola/wartości typu `name`, `label`, `title`, `description`, `placeholder`;
   - porównaj wartości user-facing z promptem, issue lub dokumentacją domenową;
   - zgłoś jako finding każdą nieuzasadnioną transliterację, np. `Spółka` -> `Spolka`, `działalność` -> `dzialalnosc`;
   - nie traktuj starszych danych ASCII jako automatycznego wzorca, jeśli bieżąca specyfikacja podaje tekst z polskimi znakami;
   - jeśli repo zawiera sprzeczne przykłady albo nie wiadomo, czy ASCII jest wymaganiem kontraktu, dodaj Open Question zamiast zakładać normalizację.
8. Każde istotne ustalenie musi mieć dowód:
   - referencję do pliku/sekcji, albo
   - wynik komendy użytej w tej sesji.
9. Nie uruchamiaj pełnego QA z automatu.
10. Jeśli quick-check ujawnia problemy przekraczające zakres szybkiej weryfikacji, zwróć rekomendację uruchomienia `$qa-run`.

## Zakres
- W zakresie: szybka weryfikacja zmian bez pełnej procedury commit.
- Poza zakresem: uruchamianie pełnych lintów/testów.

## Poziomy ustaleń
- `HIGH`: realny bug, regresja, naruszenie bezpieczeństwa, ryzyko danych, ciche zaakceptowanie lub modyfikacja niespójnych danych tam, gdzie powinien wystąpić błąd.
- `MEDIUM`: ryzyko utrzymaniowe, brak ważnego testu, słabe pokrycie edge-case, niepotrzebna komplikacja, dublowanie odpowiedzialności/logiki, niejasny lub niesemantyczny kontrakt, rozproszenie obsługi błędów między warstwami, niezaplanowana kompatybilność wsteczna lub fallback legacy bez decyzji projektowej.
- `LOW`: drobne niespójności, kosmetyka, sugestie usprawnień, lokalna niespójność z istniejącym wzorcem, możliwa unifikacja bez istotnego ryzyka.

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
