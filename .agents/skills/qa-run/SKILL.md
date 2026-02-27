---
name: qa-run
description: "Deterministyczne uruchomienie QA (linty/testy) na podstawie repo-konfigurowalnej macierzy komend JSON i wykrytych zmian. Użyj przy $qa-run."
---

# $qa-run

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Uruchomić QA w sposób w pełni deterministyczny:
- wykryć typy zmian w repo (`*_CHANGED`),
- uruchomić tylko komendy zdefiniowane przez repo dla aktywnych sekcji,
- przerwać na pierwszym błędzie (fail-fast), aby agent mógł od razu przejść do naprawy.

## Konfiguracja repo (JSON)
Skrypt używa repo-konfigurowalnej macierzy:
- domyślna ścieżka: `.agents/qa-run.matrix.json`
- jeśli plik nie istnieje: skrypt utworzy go automatycznie z pustym szablonem.

Sekcje wspierane:
- `ALWAYS` (opcjonalnie)
- `COMPOSER_CHANGED`
- `PHP_CHANGED`
- `TWIG_CHANGED`
- `JS_TS_CHANGED`
- `CSS_SCSS_CHANGED`
- `TRANSLATIONS_CHANGED`
- `YAML_CHANGED`

Wartość każdej sekcji:
- tablica stringów, gdzie każdy wpis to pełna komenda do wykonania 1:1 (bez discovery ścieżek).

Brak sekcji albo pusta tablica:
- to nie jest błąd,
- sekcja zostaje pominięta z informacją w logu.

## Kroki
1. Uruchom skrypt:
   - najpierw ustal katalog skilla `qa-run` na podstawie ścieżki wskazanej w `AGENTS.md` (nie zakładaj stałej struktury katalogów),
   - uruchom: `node <QA_RUN_SKILL_DIR>/scripts/run-matrix.mjs`
   - opcjonalnie: `node <QA_RUN_SKILL_DIR>/scripts/run-matrix.mjs --config <ścieżka>`
2. Skrypt:
   - wykrywa zmiany: tracked (staged + unstaged) oraz untracked,
   - wyznacza flagi `*_CHANGED`,
   - ładuje JSON config,
   - uruchamia sekcje w stałej kolejności:
     - `ALWAYS`,
     - `COMPOSER_CHANGED`,
     - `PHP_CHANGED`,
     - `TWIG_CHANGED`,
     - `JS_TS_CHANGED`,
     - `CSS_SCSS_CHANGED`,
     - `TRANSLATIONS_CHANGED`,
     - `YAML_CHANGED`.
3. Fail-fast:
   - jeśli dowolna komenda zakończy się błędem, skrypt kończy działanie natychmiast na tej komendzie.
4. Raport:
   - skrypt wypisuje wykryte flagi, sekcje uruchomione i pominięte oraz wynik końcowy.

## Zakres
- W zakresie: deterministyczne uruchomienie repo-zdefiniowanych komend QA dla bieżących zmian.
- Poza zakresem: automatyczne zgadywanie komend QA, fallbacki oparte o discovery skryptów.

## Format odpowiedzi
- Wynik: lista uruchomionych komend i status (OK/FAIL).
- Pominięte: sekcje pominięte z powodem:
  - brak zmian dla sekcji albo
  - brak komend/sekcji w konfiguracji.
- Blokery: jeśli wystąpi błąd komendy lub błąd konfiguracji.

## Warunki przerwania
- Pierwsza komenda QA z niezerowym exit code (fail-fast).
- Niepoprawny JSON w pliku konfiguracyjnym.
- Brak dostępu do repo Git (np. uruchomienie poza repo).

## Przykłady wejścia
- "$qa-run"
- "uruchom QA"
- "sprawdź linty i testy"

## Przykłady wyjścia
- ```text
  Wynik:
  - [PHP_CHANGED] ./bin/proxy/composer lint:phpstan:fresh — OK
  - [PHP_CHANGED] ./bin/proxy/composer test — OK
  Pominięte:
  - [TWIG_CHANGED] brak zmian
  - [JS_TS_CHANGED] brak komend w konfiguracji
  Blokery: brak
  ```
- ```text
  Wynik:
  - [COMPOSER_CHANGED] ./bin/proxy/composer lint:composer:security — FAIL
  Pominięte:
  - brak (przerwano na pierwszym błędzie)
  Blokery:
  - fail-fast na komendzie: ./bin/proxy/composer lint:composer:security
  ```

## Efekt
QA wykonuje wyłącznie komendy zadeklarowane przez repo w JSON configu, w stałej kolejności i z fail-fast na pierwszym błędzie.
