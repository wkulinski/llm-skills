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

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Uruchomić QA w sposób w pełni deterministyczny:
- wykryć typy zmian w repo (`*_CHANGED`),
- uruchomić tylko komendy zdefiniowane przez repo dla aktywnych sekcji,
- działać iteracyjnie do skutku: pierwszy pełny przebieg -> naprawa -> delta rerun względem snapshotu.

## Tryb domyślny
- Domyślnie `$qa-run` działa w trybie `repair` (auto-iteracja naprawcza).
- Tryb `report-only` uruchamiaj tylko, gdy użytkownik wyraźnie zaznaczy brak napraw (np. „tylko sprawdź”, „bez poprawek”, „check-only”).
- `fail-fast` dotyczy pojedynczego uruchomienia `run-matrix.mjs`, nie zakończenia całego zadania przez agenta.
- `full final pass` jest obowiązkowy po udanym `delta rerun`, jeśli runner wypisze `full_final_pass_recommended=1`.

## Semantyka fail-fast (precyzyjnie)
- `fail-fast` oznacza: pojedyncze uruchomienie `run-matrix.mjs` kończy się na pierwszej błędnej komendzie.
- `fail-fast` nie oznacza: zakończenia całego wykonania skilla `$qa-run` w trybie `repair`.
- W trybie `repair` po każdym `FAIL` agent ma obowiązek wejść w krok naprawy i uruchomić kolejną iterację, o ile nie wystąpi hard blocker.

## Pętla wykonania (kontrakt)
- `MAX_ITERATIONS=20` (twardy limit).
- `Iteracja` = jedno uruchomienie `run-matrix.mjs` w trybie `full` albo `delta`.
- Algorytm:
  1. Iteracja `1` zawsze uruchamia pełny przebieg: `node <skill_dir>/scripts/run-matrix.mjs`.
  2. Jeśli wynik to `PASS`, zakończ skill statusem końcowym `PASS`.
  3. Jeśli wynik to `FAIL`, zapisz snapshot stanu dirty files przed naprawą:
     - `node <skill_dir>/scripts/run-matrix.mjs --snapshot-only --snapshot-write <ścieżka>`
  4. Wykonaj naprawy w dozwolonym zakresie (sekcja „Zakres automatycznych poprawek”).
  5. Uruchom iterację `n+1` w trybie delta względem snapshotu:
     - `node <skill_dir>/scripts/run-matrix.mjs --delta-from-snapshot <ścieżka>`
  6. Jeśli delta rerun przejdzie i runner wypisze `full_final_pass_recommended=1`, obowiązkowo uruchom pełny rerun:
     - `node <skill_dir>/scripts/run-matrix.mjs`
  7. Jeśli delta rerun przejdzie i `full_final_pass_recommended=0`, zakończ skill statusem końcowym `PASS`.
  8. Jeśli obowiązkowy pełny rerun przejdzie, zakończ skill statusem końcowym `PASS`.
  9. Powtarzaj do `PASS`, do wystąpienia hard blockera, albo do osiągnięcia `MAX_ITERATIONS`.
- Status po osiągnięciu limitu bez pełnego przejścia: `BLOCKED: iteration_limit_reached`.
- Odpowiedź finalną zwracaj dopiero po `PASS` albo `BLOCKED` (nie kończ po pierwszym `FAIL`).

## Snapshoty i reruny delta
- Snapshot jest lekkim JSON-em opisującym aktualny stan dirty files:
  - ścieżka pliku,
  - `exists`,
  - hash zawartości.
- Snapshot zapisuj przed każdą naprawą, jeśli poprzednia iteracja zakończyła się `FAIL`.
- Delta rerun uruchamia tylko sekcje wynikające z różnicy między:
  - snapshotem sprzed naprawy,
  - bieżącym stanem working tree po naprawie.
- Jeśli delta jest pusta:
  - runner nie uruchomi żadnej komendy sekcyjnej,
  - agent traktuje to jako sygnał, że naprawa nie wprowadziła realnych zmian i powinien ocenić, czy problem został faktycznie rozwiązany.
- Sekcja `ALWAYS`:
  - w trybie `full` uruchamia się zawsze,
  - w trybie `delta` uruchamia się tylko wtedy, gdy delta zawiera jakiekolwiek zmiany.

## Triggery obowiązkowego full final pass
- `run-matrix.mjs` w trybie `delta` raportuje sekcję `Risk evaluation`.
- `full_final_pass_recommended=1` oznacza obowiązek uruchomienia pełnego rerunu przez agenta wykonującego skill.
- Aktualne triggery ustawiające obowiązkowy pełny rerun:
  - delta obejmuje `COMPOSER_CHANGED`,
  - delta obejmuje `PHP_CHANGED`,
  - delta obejmuje `YAML_CHANGED`,
  - delta obejmuje więcej niż jedną sekcję `*_CHANGED`.
- Jeśli trigger wystąpi:
  - agent nie kończy na `PASS` po samym delta rerunie,
  - agent obowiązkowo uruchamia pełny rerun całej macierzy,
  - `PASS` wolno zwrócić dopiero po udanym pełnym rerunie.

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
- domyślna ścieżka: `./.agents/qa-run.matrix.json`
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
   - uruchom: `node <skill_dir>/scripts/run-matrix.mjs`
   - opcjonalnie: `node <skill_dir>/scripts/run-matrix.mjs --config <ścieżka>`
   - zapis snapshotu bez QA: `node <skill_dir>/scripts/run-matrix.mjs --snapshot-only --snapshot-write <ścieżka>`
   - delta rerun: `node <skill_dir>/scripts/run-matrix.mjs --delta-from-snapshot <ścieżka>`
2. Skrypt:
   - wykrywa zmiany: tracked (staged + unstaged) oraz untracked,
   - wyznacza flagi `*_CHANGED`,
   - ładuje JSON config,
   - opcjonalnie zapisuje snapshot dirty files do JSON,
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
   - po pierwszym `FAIL` zapisz snapshot, wykonaj naprawę i uruchom delta rerun względem snapshotu,
   - po kolejnych `FAIL` powtarzaj ten sam schemat: snapshot -> naprawa -> delta rerun,
   - jeśli delta rerun wypisze `full_final_pass_recommended=1`, uruchom pełny rerun przed zakończeniem skilla,
   - nie kończ wykonania skilla po pierwszym nieudanym przebiegu.
4. Raport:
   - skrypt wypisuje wykryte flagi, sekcje uruchomione i pominięte,
   - w trybie `delta` skrypt wypisuje też `Risk evaluation`,
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
  - dla każdej iteracji: numer iteracji + tryb (`full`/`delta`) + komenda kończąca + wynik (`PASS`/`FAIL`) + krótka informacja o wykonanej naprawie (jeśli była).
  - dla iteracji `delta`: wskaż także, z jakiego snapshotu liczono deltę oraz czy runner wymusił `full final pass`.
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
  - zapisano snapshot `/tmp/qa-run-iter-1.json`
  - naprawiono problem i uruchomiono delta rerun względem snapshotu
  - [COMPOSER_CHANGED] ./bin/proxy/composer lint:composer:security — OK
  - [COMPOSER_CHANGED] ./bin/proxy/composer lint:composer:dependency — OK
  - Risk evaluation: full_final_pass_recommended=1 (`high_risk_section:COMPOSER_CHANGED`)
  - uruchomiono obowiązkowy pełny rerun całej macierzy
  Pominięte:
  - [TWIG_CHANGED] brak zmian
  Wykonano iteracji: 3/20
  Status końcowy: PASS
  Blokery: brak
  ```

## Efekt
QA wykonuje wyłącznie komendy zadeklarowane przez repo w JSON configu, w stałej kolejności, a agent prowadzi iterację naprawczą przez snapshoty i reruny delta, przy czym `full_final_pass_recommended=1` automatycznie eskaluje wykonanie do obowiązkowego pełnego rerunu całej macierzy.
