---
name: qa-run
description: >-
  Deterministyczne uruchomienie QA (linty/testy) na podstawie
  repo-konfigurowalnej macierzy komend JSON i wykrytych zmian. Użyj przy
  $qa-run.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
---

# $qa-run

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Uruchomić QA w sposób w pełni deterministyczny:
- wykryć typy zmian w repo (`*_CHANGED`),
- uruchomić tylko komendy zdefiniowane przez repo dla aktywnych sekcji,
- działać iteracyjnie do skutku: błąd -> naprawa -> ponowne uruchomienie QA.

## Tryb domyślny
- Domyślnie `$qa-run` działa w trybie `repair` (auto-iteracja naprawcza).
- Tryb `report-only` uruchamiaj tylko, gdy użytkownik wyraźnie zaznaczy brak napraw (np. „tylko sprawdź”, „bez poprawek”, „check-only”).
- `fail-fast` dotyczy pojedynczego uruchomienia `run-matrix.mjs`, nie zakończenia całego zadania przez agenta.

## Semantyka fail-fast (precyzyjnie)
- `fail-fast` oznacza: pojedyncze uruchomienie `run-matrix.mjs` kończy się na pierwszej błędnej komendzie.
- `fail-fast` nie oznacza: zakończenia całego wykonania skilla `$qa-run` w trybie `repair`.
- W trybie `repair` po każdym `FAIL` agent ma obowiązek wejść w krok naprawy i uruchomić kolejną iterację, o ile nie wystąpi hard blocker.

## Pętla wykonania (kontrakt)
- `MAX_ITERATIONS=20` (twardy limit).
- `Iteracja` = jeden pełny przebieg `run-matrix.mjs` (od startu do `PASS` albo pierwszego `FAIL`).
- Algorytm:
  1. Uruchom iterację `n`.
  2. Jeśli wynik to `PASS`, zakończ skill statusem końcowym `PASS`.
  3. Jeśli wynik to `FAIL`, wykonaj naprawy w dozwolonym zakresie (sekcja „Zakres automatycznych poprawek”).
  4. Uruchom iterację `n+1`.
  5. Powtarzaj do `PASS`, do wystąpienia hard blockera, albo do osiągnięcia `MAX_ITERATIONS`.
- Status po osiągnięciu limitu bez pełnego przejścia: `BLOCKED: iteration_limit_reached`.
- Odpowiedź finalną zwracaj dopiero po `PASS` albo `BLOCKED` (nie kończ po pierwszym `FAIL`).

## Zakres automatycznych poprawek
- Dozwolone bez dodatkowej zgody:
  - poprawki w plikach wskazanych bezpośrednio przez błąd QA,
  - poprawki w plikach ściśle powiązanych z błędem (np. lokalna konfiguracja lint/test dla danej komendy),
  - deterministyczne autofixy narzędzi QA uruchamianych przez repo.
- Niedozwolone bez świadomej decyzji użytkownika:
  - szerokie refaktory poza obszarem błędu,
  - zmiany architektoniczne lub domenowe wykraczające poza naprawę QA,
  - zmiany bezpieczeństwa, migracje danych, dodawanie/usuwanie zależności.
- Jeśli błąd wynika z legacy debt poza bieżącym zakresem i naprawa wymaga szerokiej ingerencji, zakończ jako `BLOCKED` z jasnym uzasadnieniem.

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
3. Iteracja naprawcza (wymagana, tryb `repair`):
   - wykonuj pętlę dokładnie według sekcji „Pętla wykonania (kontrakt)”,
   - po każdym `FAIL` przejdź do naprawy i uruchom kolejną iterację (chyba że wystąpi hard blocker),
   - nie kończ wykonania skilla po pierwszym nieudanym przebiegu.
4. Raport:
   - skrypt wypisuje wykryte flagi, sekcje uruchomione i pominięte,
   - raport końcowy zawsze zawiera: `Wykonano iteracji: X/20`,
   - raport końcowy zawiera też status: `PASS` albo `BLOCKED`,
   - dla `BLOCKED` raport końcowy zawiera kod blokera i jego przyczynę.

## Zakres
- W zakresie: deterministyczne uruchomienie repo-zdefiniowanych komend QA dla bieżących zmian.
- Poza zakresem: automatyczne zgadywanie komend QA, fallbacki oparte o discovery skryptów.

## Format odpowiedzi
- Wynik: lista uruchomionych komend i status (OK/naprawiono/FAIL).
- Pominięte: sekcje pominięte z powodem:
  - brak zmian dla sekcji albo
  - brak komend/sekcji w konfiguracji.
- Przebieg iteracji:
  - dla każdej iteracji: numer iteracji + komenda kończąca + wynik (`PASS`/`FAIL`) + krótka informacja o wykonanej naprawie (jeśli była).
- Wykonano iteracji: `X/20`.
- Status końcowy: `PASS` albo `BLOCKED`.
- Blokery:
  - jeśli status to `PASS`: `brak`,
  - jeśli status to `BLOCKED`: podaj kod blokera + przyczynę + ostatni błąd + listę podjętych prób.

## Warunki przerwania
- Niepoprawny JSON w pliku konfiguracyjnym.
- Brak dostępu do repo Git (np. uruchomienie poza repo).
- Twardy błąd środowiskowy lub uprawnień, którego nie da się naprawić w bieżącym kroku.
- Konieczność zmiany wykraczającej poza dozwolony zakres automatycznych poprawek (np. decyzja architektoniczna/domenowa/security/migracje/dependency).
- Legacy debt poza bieżącym zakresem, którego naprawa wymaga szerokiego refaktoru.
- Osiągnięcie `MAX_ITERATIONS=20` bez pełnego przejścia QA (`BLOCKED: iteration_limit_reached`).

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
  Wykonano iteracji: 1/20
  Status końcowy: PASS
  Blokery: brak
  ```
- ```text
  Wynik:
  - [COMPOSER_CHANGED] ./bin/proxy/composer lint:composer:security — FAIL
  - naprawiono problem i ponowiono uruchomienie
  - [COMPOSER_CHANGED] ./bin/proxy/composer lint:composer:security — OK
  - [COMPOSER_CHANGED] ./bin/proxy/composer lint:composer:dependency — OK
  Pominięte:
  - [TWIG_CHANGED] brak zmian
  Wykonano iteracji: 2/20
  Status końcowy: PASS
  Blokery: brak
  ```

## Efekt
QA wykonuje wyłącznie komendy zadeklarowane przez repo w JSON configu, w stałej kolejności, a agent prowadzi iterację naprawczą aż do pełnego przejścia.
