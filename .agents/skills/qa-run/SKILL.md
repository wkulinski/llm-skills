---
name: qa-run
description: >-
  Deterministyczne uruchomienie QA (linty/testy + review-quick) na podstawie
  repo-konfigurowalnej macierzy komend JSON, snapshotow i sesji QA. Uzyj przy
  $qa-run.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
---

# $qa-run

## Reguly rozwiazywania sciezek
- Stosuj globalny kontrakt sciezek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie srodowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Biezacy `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Uruchomic QA w sposob deterministyczny:
- wykryc zmienione pliki na podstawie Git,
- przypisac je do jawnie skonfigurowanych sekcji QA przez patterny sciezek,
- uruchomic tylko komendy przypisane do aktywnych sekcji,
- wlaczyc `$review-quick` jako faze QA, a nie osobny krok commita,
- po poprawkach uruchamiac reruny delta wzgledem snapshotow,
- odkladac finalny pelny przebieg do konca sesji QA i wykonywac go najwyzej raz.

## Zasada minimalnej heurystyki
- Runner nie analizuje semantyki diffu (np. "to tylko komentarz", "to tylko PHPDoc").
- Decyzje o sekcjach wynikaja z jawnych patternow sciezek w `./.agents/qa-run.matrix.json`.
- Decyzje o finalnym pelnym przebiegu wynikaja z jawnego pola `requiresFinalFullPass` w konfiguracji sekcji.
- Agent nie dobiera komend "na wyczucie"; wykonuje komendy z matrixa i fazy opisane w tym skillu.

## Tryb domyslny
- Domyslnie `$qa-run` dziala w trybie `repair`.
- `repair` oznacza: matrix QA -> naprawa po FAIL -> delta rerun -> `$review-quick` -> naprawa po review -> delta rerun -> ewentualny final full pass.
- Tryb `report-only` uruchamiaj tylko, gdy uzytkownik wyraznie zaznaczy brak napraw (np. "tylko sprawdz", "bez poprawek", "check-only").
- `fail-fast` dotyczy pojedynczego uruchomienia `run-matrix.mjs`, nie calego skilla.

## CLI contract: `run-matrix.mjs`
Podstawowy runner:
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason initial`
- `node <skill_dir>/scripts/run-matrix.mjs --snapshot-only --snapshot-write <sciezka>`
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason post-fix-delta --delta-from-snapshot <sciezka>`
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason review-fix-delta --delta-from-snapshot <sciezka>`
- `node <skill_dir>/scripts/run-matrix.mjs --rerun-reason full-final-pass`

Opcjonalnie przekazuj sesje:
- `--session <sciezka>` zapisuje ledger QA: hash matrixa, ostatni przebieg, ostatni full pass i `pendingFinalFullPass`.

Dozwolone `--rerun-reason`:
- `initial`:
  - pierwszy pelny przebieg albo swiadomie rozpoczęty pelny przebieg,
  - bez `--delta-from-snapshot`.
- `post-fix-delta`:
  - rerun po naprawie bledu z matrix QA,
  - wymaga `--delta-from-snapshot`.
- `review-fix-delta`:
  - rerun po poprawce wynikajacej z `$review-quick`,
  - wymaga `--delta-from-snapshot`.
- `full-final-pass`:
  - pelny finalny przebieg uruchamiany na koncu sesji QA, jesli ledger albo wynik delta ma `pending_final_full_pass=1`,
  - bez `--delta-from-snapshot`.

Niepoprawna kombinacja flag jest bledem procedury.

## Konfiguracja repo (JSON)
Domyslna sciezka: `./.agents/qa-run.matrix.json`.

Jesli plik nie istnieje, `run-matrix.mjs` kopiuje template:
- `<skill_dir>/templates/qa-run.matrix.dist.json`

Brak template jest twardym bledem procedury. Runner nie ma zakodowanego defaultowego matrixa w JS.

Wymagany format:
```json
{
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
            "commands": ["..."],
            "runOn": ["full", "rerun"],
            "requiresFinalFullPass": false
        }
    }
}
```

Znaczenie pol:
- `sectionOrder`: jawna kolejnosc wykonywania wszystkich sekcji; musi zawierac kazda sekcje z `sections` dokladnie raz.
- `patterns`: jawne globy sciezek repo, ktore aktywuja sekcje.
- `commands`: pelne komendy do wykonania 1:1.
- `runOn`: `full`, `rerun` albo oba.
- `requiresFinalFullPass`: jesli `true`, udany rerun delta nie odpala od razu pelnej macierzy, tylko ustawia `pendingFinalFullPass`.

Kazda sekcja musi jawnie deklarowac `patterns`, `commands`, `runOn` i `requiresFinalFullPass`.

Sekcje specjalne:
- `ALWAYS_FULL`: uruchamia sie przy pelnym przebiegu.
- `ALWAYS_ON_RERUN`: uruchamia sie przy kazdym rerunie delta z niepusta delta.

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

Stary format z plaskimi tablicami nie jest obslugiwany. Runner ma przerwac wykonanie na niezgodnym formacie zamiast stosowac fallbacki.

## Snapshoty i reruny delta
- Snapshot jest lekkim JSON-em opisujacym aktualny stan dirty files:
  - sciezka pliku,
  - `exists`,
  - hash zawartosci.
- Snapshot zapisuj przed kazda naprawa po `FAIL` oraz przed kazda poprawka wynikajaca z `$review-quick`.
- Delta rerun uruchamia tylko sekcje wynikajace z roznicy miedzy snapshotem a biezacym working tree.
- Jesli delta jest pusta, runner nie uruchomi zadnej sekcji zmianowej; agent musi ocenic, czy naprawa faktycznie wprowadzila zmiane.

## Final full pass
- `pending_final_full_pass=1` nie oznacza natychmiastowego pelnego rerunu.
- Agent kumuluje ten stan w sesji QA.
- Pelny finalny przebieg wolno uruchomic najwyzej raz na koncu sesji, po:
  - udanych rerunach delta,
  - wykonaniu `$review-quick`,
  - poprawkach wynikajacych z `$review-quick` i ich rerunach delta.
- Jesli finalny pelny przebieg przejdzie, status koncowy QA to `PASS`.
- Jesli finalny pelny przebieg nie jest wymagany, status koncowy QA mozna zwrocic po udanych sekcjach i `$review-quick`.

## Petla wykonania (kontrakt)
- `MAX_ITERATIONS=20`.
- Iteracja = jedno uruchomienie matrix runnera (`full` albo `delta`) albo faza `$review-quick` zakonczona poprawka wymagajaca rerunu.

Algorytm:
1. Utworz sciezke sesji, np. `/tmp/qa-run-session-<timestamp>.json`.
2. Uruchom pelny przebieg:
   - `node <skill_dir>/scripts/run-matrix.mjs --session <session> --rerun-reason initial`
3. Jesli matrix zwroci `FAIL`:
   - zapisz snapshot,
   - wykonaj dozwolona naprawe,
   - uruchom `post-fix-delta` z tym snapshotem i ta sama sesja.
4. Powtarzaj snapshot -> naprawa -> delta do `PASS`, hard blockera albo limitu.
5. Po udanym matrix QA uruchom `$review-quick`.
6. Jesli `$review-quick` nie ma uwag: przejdz do finalizacji.
7. Jesli `$review-quick` wykryje problem do poprawy w zakresie zadania:
   - zapisz snapshot przed poprawka,
   - popraw minimalnie,
   - uruchom `review-fix-delta` z tym snapshotem i ta sama sesja,
   - wroc do oceny, czy `$review-quick` trzeba ponowic dla poprawionego zakresu.
8. Jesli sesja albo ostatni rerun raportuje `pending_final_full_pass=1`, uruchom raz:
   - `node <skill_dir>/scripts/run-matrix.mjs --session <session> --rerun-reason full-final-pass`
9. Zakoncz `PASS` albo `BLOCKED`.

## Zakres automatycznych poprawek
Dozwolone bez dodatkowej zgody:
- poprawki w plikach wskazanych bezposrednio przez blad QA,
- poprawki w plikach scisle powiazanych z bledem,
- deterministyczne autofixy narzedzi QA z matrixa,
- minimalne poprawki wynikajace z `$review-quick`, jesli mieszcza sie w biezacym zakresie zadania.

Niedozwolone bez decyzji uzytkownika:
- szerokie refaktory poza obszarem bledu,
- zmiany architektoniczne lub domenowe wykraczajace poza naprawe QA,
- zmiany security,
- migracje danych,
- dodawanie/usuwanie zaleznosci.

## Raport
Raport koncowy zawiera:
- wykonane komendy i sekcje,
- sekcje pominiete z powodem,
- przebieg iteracji (`full`, `post-fix-delta`, `review-fix-delta`, `$review-quick`, `full-final-pass`),
- informacje o sesji: `pending_final_full_pass` i powody,
- `Wykonano iteracji: X/20`,
- status: `PASS` albo `BLOCKED`,
- blokery, jesli wystapily.

## Warunki przerwania
- Niepoprawny JSON w konfiguracji.
- Brak dostepu do repo Git.
- Twardy blad srodowiskowy lub uprawnien.
- Koniecznosc zmiany wykraczajacej poza dozwolony zakres automatycznych poprawek.
- Legacy debt poza biezacym zakresem wymagajacy szerokiego refaktoru.
- Osiagniecie `MAX_ITERATIONS=20`.

## Przyklady wejscia
- "$qa-run"
- "uruchom QA"
- "sprawdz linty i testy"

## Efekt
QA jest wykonywane wedlug jawnych sekcji i stanu sesji. `$review-quick` jest czescia przeplywu QA, a pelny finalny przebieg jest odkladany do konca i uruchamiany najwyzej raz, tylko gdy wymaga tego skonfigurowana polityka.
