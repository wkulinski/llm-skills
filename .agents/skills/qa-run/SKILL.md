---
name: qa-run
description: >-
  Deterministyczne uruchomienie QA (linty/testy + review-quick) na podstawie
  repo-konfigurowalnej macierzy komend JSON, snapshotów i sesji QA. Użyj przy
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
Uruchomić QA w sposób deterministyczny:
- wykryć zmienione pliki na podstawie Git,
- przypisać je do jawnie skonfigurowanych sekcji QA przez patterny ścieżek,
- uruchomić tylko komendy przypisane do aktywnych sekcji,
- zapisywać pełny stdout/stderr komend jako artefakty na dysku,
- raportować do kontekstu tylko statusy komend oraz konkretne skróty błędów,
- włączyć `$review-quick` jako fazę QA, a nie osobny krok commita,
- po poprawkach uruchamiać reruny delta względem snapshotów,
- odkładać finalny pełny przebieg do końca sesji QA i wykonywać go najwyżej raz.

## Zasada minimalnej heurystyki
- Runner nie analizuje semantyki diffu (np. "to tylko komentarz", "to tylko PHPDoc").
- Decyzje o sekcjach wynikają z jawnych patternów ścieżek w `./.agents/qa-run.matrix.json`.
- Decyzje o finalnym pełnym przebiegu wynikają z jawnego pola `requiresFinalFullPass` w konfiguracji sekcji.
- Agent nie dobiera komend "na wyczucie"; wykonuje komendy z matrixa i fazy opisane w tym skillu.

## Tryb domyślny
- Domyślnie `$qa-run` działa w trybie `repair`.
- `repair` oznacza: matrix QA -> naprawa po FAIL -> delta rerun -> `$review-quick` -> naprawa po review -> delta rerun -> ewentualny final full pass.
- Tryb `report-only` uruchamiaj tylko, gdy użytkownik wyraźnie zaznaczy brak napraw (np. "tylko sprawdź", "bez poprawek", "check-only").
- `fail-fast` dotyczy pojedynczego uruchomienia `run-matrix.mjs`, nie całego skilla.

## CLI contract: `run-matrix.mjs`
Podstawowy runner:
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason initial`
- `node <skill_dir>/scripts/run-matrix.mjs --snapshot-only --snapshot-write <ścieżka>`
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason post-fix-delta --delta-from-snapshot <ścieżka>`
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason review-fix-delta --delta-from-snapshot <ścieżka>`
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason full-final-pass`

Opcjonalnie przekazuj sesję:
- `--session <ścieżka>` zapisuje ledger QA: hash matrixa, ostatni przebieg, ostatni full pass i `pendingFinalFullPass`.

Każdy przebieg zapisuje artefakty w `CACHE_PATH/qa-run/<run-id>/` (domyślnie `var/agent/cache/qa-run/<run-id>/`):
- `summary.json`: maszynowy wynik przebiegu, status komend, ścieżki logów i skróty błędów,
- `summary.txt`: zwięzłe streszczenie dla człowieka,
- `commands/*.stdout.log` i `commands/*.stderr.log`: pełne logi komend.

Pełne stdout/stderr komend QA jest artefaktem diagnostycznym, nie treścią raportu dla użytkownika. Agent otwiera pełny log tylko wtedy, gdy `summary.json` lub skrót błędu nie wystarcza do diagnozy.

Dozwolone `--rerun-reason`:
- `initial`:
  - pierwszy pełny przebieg albo świadomie rozpoczęty pełny przebieg,
  - bez `--delta-from-snapshot`.
- `post-fix-delta`:
  - rerun po naprawie błędu z matrix QA,
  - wymaga `--delta-from-snapshot`.
- `review-fix-delta`:
  - rerun po poprawce wynikającej z `$review-quick`,
  - wymaga `--delta-from-snapshot`.
- `full-final-pass`:
  - pełny finalny przebieg uruchamiany na końcu sesji QA, jeśli ledger albo wynik delta ma `pending_final_full_pass=1`,
  - bez `--delta-from-snapshot`.

Niepoprawna kombinacja flag jest błędem procedury.

## Konfiguracja repo (JSON)
Domyślna ścieżka: `./.agents/qa-run.matrix.json`.

Jeśli plik nie istnieje, `run-matrix.mjs` kopiuje template:
- `<skill_dir>/templates/qa-run.matrix.dist.json`

Brak template jest twardym błędem procedury. Runner nie ma zakodowanego defaultowego matrixa w JS.

Wymagany format:
```json
{
    "outputDefaults": {
        "outputMode": "quiet-on-pass",
        "failTailLines": 120,
        "maxOutputBytes": 20000,
        "stripAnsi": true,
        "parserInputBytes": 5242880,
        "parser": "generic-tail"
    },
    "sectionOrder": [
        "ALWAYS_FULL",
        "ALWAYS_ON_RERUN",
        "PHP_CHANGED"
    ],
    "sections": {
        "ALWAYS_FULL": {
            "patterns": [],
            "commands": ["..."],
            "runOn": ["full"],
            "requiresFinalFullPass": false
        },
        "ALWAYS_ON_RERUN": {
            "patterns": [],
            "commands": ["..."],
            "runOn": ["rerun"],
            "requiresFinalFullPass": false
        },
        "PHP_CHANGED": {
            "patterns": ["**/*.php"],
            "output": {
                "failTailLines": 160
            },
            "commands": [
                "...",
                {
                    "cmd": "...",
                    "parser": "phpstan-json",
                    "failTailLines": 80
                }
            ],
            "runOn": ["full", "rerun"],
            "requiresFinalFullPass": false
        }
    }
}
```

Znaczenie pól:
- `sectionOrder`: jawna kolejność wykonywania wszystkich sekcji; musi zawierać każdą sekcję z `sections` dokładnie raz.
- `patterns`: jawne globy ścieżek repo, które aktywują sekcje.
- `commands`: pełne komendy do wykonania 1:1; wpis może być stringiem albo obiektem z polem `cmd`.
- `runOn`: `full`, `rerun` albo oba.
- `requiresFinalFullPass`: jeśli `true`, udany rerun delta nie odpala od razu pełnej macierzy, tylko ustawia `pendingFinalFullPass`.
- `outputDefaults`: opcjonalne domyślne ustawienia raportowania outputu dla wszystkich komend.
- `output`: opcjonalne ustawienia outputu dla sekcji.

Każda sekcja musi jawnie deklarować `patterns`, `commands`, `runOn` i `requiresFinalFullPass`.

### Kontrakt outputu komend
Domyślny tryb outputu to `quiet-on-pass`:
- pełny stdout/stderr zawsze trafia do plików logów w artefaktach QA,
- udana komenda wypisuje tylko status, czas trwania i ścieżki logów,
- błędna komenda wypisuje status, exit code, ścieżki logów i ograniczony skrót błędu,
- pełnego outputu udanych komend nie wklejaj do odpowiedzi użytkownikowi.

Priorytet ustawień outputu:
1. ustawienia bezpośrednio przy komendzie,
2. `section.output`,
3. `outputDefaults`,
4. domyślne wartości runnera.

Obsługiwane pola outputu:
- `outputMode`: `quiet-on-pass` albo `silent`;
- `failTailLines`: ile końcowych linii może trafić do skrótu błędu;
- `maxOutputBytes`: maksymalny rozmiar skrótu błędu;
- `parserInputBytes`: maksymalny rozmiar wejścia przechowywanego dla parsera maszynowego;
- `stripAnsi`: czy usuwać kody ANSI ze skrótu;
- `parser`: `generic-tail`, `phpstan-json` albo `eslint-json`.

Parsery maszynowe są preferowane tam, gdzie narzędzie stabilnie je wspiera:
- PHPStan: preferuj `--error-format=json` i `parser: "phpstan-json"`;
- ESLint: preferuj `--format json` i `parser: "eslint-json"`;
- pozostałe narzędzia zaczynają od `parser: "generic-tail"`.

Komendy w matrixie konfiguruj pod output dla agenta:
- preferuj flagi `--no-progress`, `--no-interaction`, `--ansi=never`, `--colors=never` albo odpowiedniki, jeśli narzędzie je obsługuje;
- nie stosuj `--quiet`, jeśli narzędzie ukrywa wtedy przyczynę błędu;
- nie dodawaj flag automatycznie w runnerze, bo obsługa flag jest zależna od narzędzia.

Sekcje specjalne:
- `ALWAYS_FULL`: uruchamia się przy pełnym przebiegu.
- `ALWAYS_ON_RERUN`: uruchamia się przy każdym rerunie delta z niepustą delta.

Rekomendowane sekcje zmianowe:
- `DEPENDENCIES_CHANGED`
- `PHP_CHANGED`
- `TWIG_CHANGED`
- `JS_TS_CHANGED`
- `CSS_SCSS_CHANGED`
- `TRANSLATIONS_CHANGED`
- `YAML_CHANGED`
- `MAKEFILE_CHANGED`
- `DOCS_CHANGED`
- `QA_CONFIG_CHANGED`
- `AGENT_SKILLS_CHANGED`

Stary format z płaskimi tablicami nie jest obsługiwany. Runner ma przerwać wykonanie na niezgodnym formacie zamiast stosować fallbacki.

## Snapshoty i reruny delta
- Snapshot jest lekkim JSON-em opisującym aktualny stan dirty files:
  - ścieżka pliku,
  - `exists`,
  - hash zawartości.
- Snapshot zapisuj przed każdą naprawą po `FAIL` oraz przed każdą poprawką wynikającą z `$review-quick`.
- Delta rerun uruchamia tylko sekcje wynikające z różnicy między snapshotem a bieżącym working tree.
- Jeśli delta jest pusta, runner nie uruchomi żadnej sekcji zmianowej; agent musi ocenić, czy naprawa faktycznie wprowadziła zmianę.

## Final full pass
- `pending_final_full_pass=1` nie oznacza natychmiastowego pełnego rerunu.
- Agent kumuluje ten stan w sesji QA.
- Pełny finalny przebieg wolno uruchomić najwyżej raz na końcu sesji, po:
  - udanych rerunach delta,
  - wykonaniu `$review-quick`,
  - poprawkach wynikających z `$review-quick` i ich rerunach delta.
- Jeśli finalny pełny przebieg przejdzie, status końcowy QA to `PASS`.
- Jeśli finalny pełny przebieg nie jest wymagany, status końcowy QA można zwrócić po udanych sekcjach i `$review-quick`.

## Pętla wykonania (kontrakt)
- `MAX_ITERATIONS=20`.
- Iteracja = jedno uruchomienie matrix runnera (`full` albo `delta`) albo faza `$review-quick` zakończona poprawką wymagającą rerunu.

Algorytm:
1. Utwórz ścieżkę sesji, np. `/tmp/qa-run-session-<timestamp>.json`.
2. Uruchom pełny przebieg:
   - `node <skill_dir>/scripts/run-matrix.mjs --session <session> --rerun-reason initial`
3. Jeśli matrix zwróci `FAIL`:
   - zapisz snapshot,
   - wykonaj dozwoloną naprawę,
   - uruchom `post-fix-delta` z tym snapshotem i tą samą sesją.
4. Powtarzaj snapshot -> naprawa -> delta do `PASS`, hard blockera albo limitu.
5. Po udanym matrix QA uruchom `$review-quick`.
6. Jeśli `$review-quick` nie ma uwag: przejdź do finalizacji.
7. Jeśli `$review-quick` wykryje problem do poprawy w zakresie zadania:
   - zapisz snapshot przed poprawką,
   - popraw minimalnie,
   - uruchom `review-fix-delta` z tym snapshotem i tą samą sesją,
   - wróć do oceny, czy `$review-quick` trzeba ponowić dla poprawionego zakresu.
8. Jeśli sesja albo ostatni rerun raportuje `pending_final_full_pass=1`, uruchom raz:
   - `node <skill_dir>/scripts/run-matrix.mjs --session <session> --rerun-reason full-final-pass`
9. Zakończ `PASS` albo `BLOCKED`.

## Zakres automatycznych poprawek
Dozwolone bez dodatkowej zgody:
- poprawki w plikach wskazanych bezpośrednio przez błąd QA,
- poprawki w plikach ściśle powiązanych z błędem,
- deterministyczne autofixy narzędzi QA z matrixa,
- minimalne poprawki wynikające z `$review-quick`, jeśli mieszczą się w bieżącym zakresie zadania.

Niedozwolone bez decyzji użytkownika:
- szerokie refaktory poza obszarem błędu,
- zmiany architektoniczne lub domenowe wykraczające poza naprawę QA,
- zmiany security,
- migracje danych,
- dodawanie/usuwanie zależności.

## Raport
Raport końcowy zawiera:
- status `PASS` albo `BLOCKED`/`FAIL`,
- liczbę wykonanych komend i aktywnych sekcji,
- ścieżkę do katalogu artefaktów i `summary.json`,
- sekcje pominięte z powodem w formie zwięzłej,
- przebieg iteracji (`full`, `post-fix-delta`, `review-fix-delta`, `$review-quick`, `full-final-pass`),
- informacje o sesji: `pending_final_full_pass` i powody,
- `Wykonano iteracji: X/20`,
- konkretne błędy z `summary.json`, jeśli wystąpiły,
- blokery, jeśli wystąpiły.

Udane komendy raportuj zbiorczo. Nie wklejaj outputu udanych lintów/testów. Przy błędzie pokaż tylko skrót błędu i ścieżki do logów; pełne logi otwieraj selektywnie dopiero do diagnozy.

## Warunki przerwania
- Niepoprawny JSON w konfiguracji.
- Brak dostępu do repo Git.
- Twardy błąd środowiskowy lub uprawnień.
- Konieczność zmiany wykraczającej poza dozwolony zakres automatycznych poprawek.
- Legacy debt poza bieżącym zakresem wymagający szerokiego refaktoru.
- Osiągnięcie `MAX_ITERATIONS=20`.

## Przykłady wejścia
- "$qa-run"
- "uruchom QA"
- "sprawdź linty i testy"

## Efekt
QA jest wykonywane według jawnych sekcji i stanu sesji. `$review-quick` jest częścią przepływu QA, a pełny finalny przebieg jest odkładany do końca i uruchamiany najwyżej raz, tylko gdy wymaga tego skonfigurowana polityka.
