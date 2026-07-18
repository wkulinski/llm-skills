# Kontrakt kontekstu między agentami

## Role

### Agent główny

Agent główny odpowiada za rozmowę z użytkownikiem oraz:

- odczyt issue i komentarzy,
- interpretację intencji i kryteriów akceptacji,
- decyzje dotyczące zakresu i architektury,
- rozpoczęcie lifecycle kontekstu projektu,
- weryfikację plików przed edycją.

### `context-refresher`

`context-refresher` jest jedyną delegowaną rolą, która może wykonać pełną
procedurę `$context-refresh`. Używa się go jawnie przy inicjalizacji sesji lub
świadomym odświeżeniu kontekstu. Zwraca zwarty manifest, a nie kopię treści
dokumentacji.

### `context-scout`

`context-scout` jest tylko do odczytu i wykonuje repozytoryjny rekonesans. Musi:

- nie pobierać ani nie interpretować issue/komentarzy GitHub,
- nie uruchamiać `$context-refresh`,
- nie edytować plików, nie uruchamiać QA/review, nie commitować i nie diagnozować runtime,
- otrzymać znormalizowany brief oraz manifest od agenta głównego,
- analizować tylko pliki repozytorium potrzebne do zmapowania implementacji.

Powinien najpierw używać Sereny dla obsługiwanych języków, a następnie
punktowego wyszukiwania i odczytu. Może doczytać brakujący README modułu lub
lokalną konwencję, jeśli wymaga tego brief, ale nie powinien ponownie czytać
źródeł wymienionych w manifeście bez wyjaśnienia, dlaczego manifest jest
niewystarczający.

## Triggery routingu

Agent główny ma delegować repository-context automatycznie, gdy zadanie wymaga
rozpoznania kodu przed decyzją lub implementacją. Brak delegacji jest uzasadniony
tylko wtedy, gdy zakres jest oczywiście poza scoutingiem albo obejmuje jeden
znany plik/symbol i jedno proste wyszukanie.

### `context-scout-fast`

`context-scout-fast` jest primary hybrydy z CMM i może pracować w trybie
`targeted` albo `cross-layer`. Wybieraj go przez helper hybrydy, gdy główny agent
ma przygotowany handoff, manifest i criteria oraz akceptuje możliwość jednego
niezależnego fallbacku do `context-scout`.

W trybie standalone (poza helperem) zachowaj dawną granicę fast i wybierz go
wyłącznie, gdy wszystkie warunki są spełnione:

- cel jest konkretny i znany przed rozpoczęciem wyszukiwania,
- zakres dotyczy jednego symbolu, jednej klasy, jednego configu albo małego
  klastra maksymalnie kilku bezpośrednio powiązanych plików,
- nie trzeba łączyć więcej niż dwóch warstw ani wielu modułów,
- nie trzeba sporządzać pełnej listy call sites w całym repozytorium,
- wynik można zamknąć w maksymalnie kilku findings i około 1500 tokenów,
- brak rozstrzygającej niepewności co do modułu, grafu wywołań lub punktu wejścia.

Fast nie służy do pełnego mapowania modułu, cross-layer, security, DI/runtime,
dużego dirty diffu, migracji, wszystkich providerów/testów ani zadań, w których
zakres może się rozszerzyć po pierwszym wyszukaniu.

Ta granica dotyczy standalone fast; helper hybrydy może użyć fast jako primary
dla cross-layer, ponieważ validator i jeden fallback Luna zapewniają bezpieczne
domknięcie raportu.

### `context-scout`

Wybierz normalnego scouta, gdy zachodzi choć jeden warunek:

- zadanie obejmuje trzy lub więcej powiązanych plików/symboli,
- trzeba połączyć kod produkcyjny z testami, konfiguracją, frontendem lub API,
- trzeba prześledzić kilka call sites albo implementacji interfejsu,
- zadanie obejmuje wiele modułów lub warstw,
- moduł, graf wywołań albo pełny zakres nie są znane,
- dotyczy security, DI, runtime, danych, kontraktów lub dużego dirty diffu,
- spodziewane są więcej niż dwie rundy wyszukiwania.

Normalny scout może pracować w trybie `targeted` albo `cross-layer`; tryb musi
wynikać z briefu albo zostać jawnie wybrany i zwrócony w raporcie.

### Reguły wspólne

- Nie deleguj scouta do QA, review, commita, runtime diagnostics ani obsługi
  pliku stanu.
- Nie wybieraj fast tylko dlatego, że zadanie wygląda na tanie; jeśli zakres jest
  niepewny, wybierz normalnego scouta.
- Jeśli fast zwróci `INCOMPLETE`, nie zwiększaj mu samodzielnie zakresu: wznowić
  można brakujący targeted fragment albo eskalować zadanie do `context-scout`.
- Jeśli scout zwróci `INCOMPLETE`, agent główny wznawia tę samą sesję przez
  `task_id` i przekazuje wyłącznie brakujący zakres. Wznowienie nie powtarza
  wcześniejszych odczytów ani raportu.

Deleguj `context-initialization` do `context-refresher` tylko wtedy, gdy agent
główny potrzebuje nowego/odświeżonego kontekstu i nie istnieje ważny manifest.

## Handoff od agenta głównego

Agent główny przekazuje zwarty, znormalizowany handoff, zwykle krótszy niż 1000
tokenów. Handoff ma zawierać wszystkie pola poniżej; brak pola wymaganego blokuje
scouta zamiast uruchamiać zgadywanie:

```yaml
repository: stabilny identyfikator repozytorium
branch: bieżący branch
task_brief: znormalizowany cel implementacji
acceptance_criteria: [krótkie, testowalne kryteria]
decisions: [decyzje użytkownika]
constraints: [ograniczenia architektoniczne, bezpieczeństwa i zależności]
context_manifest: ścieżka lub referencja do manifestu
already_read: [ścieżki repo-relative]
```

Handoff nie może zawierać pełnych komentarzy issue, pełnej dokumentacji,
sekretów ani pełnych treści plików. Jeśli brakuje wymaganego pola, scout zgłasza
blokadę zamiast zgadywać.

`task_brief` opisuje cel i zakres, a nie historię rozmowy. `acceptance_criteria`
muszą być krótkie i testowalne oraz mieć stabilne identyfikatory, np. `C1`, `C2`.
`already_read` zawiera tylko ścieżki, których ponowny odczyt jest domyślnie
zabroniony. Agent główny przekazuje nazwę trybu (`targeted`/`cross-layer`), gdy
wybór jest jednoznaczny; w przeciwnym razie scout wybiera go według routingu.

Scout waliduje wejście w tej kolejności:

1. sprawdza obecność pól handoffu,
2. uruchamia `context-manifest.mjs validate` na wskazanym manifeście,
3. sprawdza, czy brief i kryteria są spójne z trybem,
4. dopiero wtedy wykonuje odczyty repozytorium.

## Manifest kontekstu

Manifest jest zwięzłym indeksem kontekstu załadowanego przez agenta głównego
albo `context-refresher`. Zawiera ścieżki i krótkie role źródeł, nie ich treść:

```yaml
version: 1
role: primary | context-refresher
repository: stabilny identyfikator repozytorium
branch: bieżący branch
head: opcjonalny hash commita
rules: [ścieżki repo-relative]
documentation: [ścieżki repo-relative]
active_overrides: [krótkie nazwy i wartości]
constraints: [krótkie inwarianty]
already_read: [ścieżki repo-relative]
omitted: [znane, celowo niezaładowane źródła]
```

Manifest waliduj przez `<skills_root>/_shared/scripts/context-manifest.mjs`
przed przekazaniem go capability. Manifesty są lokalnymi artefaktami pod
`CACHE_PATH` i nigdy nie mogą zawierać sekretów.

## Polityka zbierania danych

Scout zbiera tylko dane potrzebne do spełnienia acceptance criteria:

- przekazuje dosłownie repo-relative ścieżki, nazwy symboli, nazwy testów,
  literalne kody konfiguracji i zakresy linii;
- streszcza treść dokumentów, klas, metod, diffów i logów zamiast je kopiować;
- kopiuje tylko krótki fragment konieczny do rozstrzygnięcia claimu, nigdy cały
  plik lub pełny dokument;
- nie zbiera issue, komentarzy, pełnych sekretów, wartości env, tokenów,
  credentiali, pełnych logów ani niepowiązanych danych osobowych;
- nie raportuje wartości sekretów nawet wtedy, gdy lokalny odczyt jest dozwolony;
- nie rozszerza wyszukiwania na cały repozytorium po znalezieniu wystarczających
  dowodów, chyba że kryterium wymaga kompletnej listy.

Każdy odczyt musi odpowiadać jednemu z kryteriów albo uzasadnieniu ryzyka.
Odczyty bez takiego powiązania są pomijane.

## Raport scouta

Raport ma stałą, domenowo neutralną kopertę i dynamiczną treść wynikającą z
briefu oraz kryteriów akceptacji. Scout zwraca maksymalnie dwanaście ustaleń,
zwykle do około 1500 tokenów:

```json
{
  "version": 1,
  "status": "COMPLETE | INCOMPLETE | BLOCKED",
  "mode": "targeted | cross-layer",
  "findings": [
    {
      "criterion_id": "opcjonalny identyfikator kryterium z handoffu",
      "claim": "jedno konkretne twierdzenie",
      "evidence": [
        {
          "path": "repo/relative/path",
          "line_start": 1,
          "line_end": 2,
          "locator": "opcjonalny symbol lub sekcja",
          "relation": "opcjonalna relacja, np. defines/uses/tests"
        }
      ]
    }
  ],
  "coverage": [
    {
      "criterion_id": "C1",
      "status": "covered | not_applicable | blocked",
      "evidence": [
        {
          "path": "repo/relative/path",
          "line_start": 1,
          "line_end": 2,
          "locator": "opcjonalny symbol lub sekcja",
          "relation": "opcjonalna relacja, np. defines/uses/tests"
        }
      ],
      "reason": "wymagane dla not_applicable/blocked"
    }
  ],
  "risks": ["... lub obiekt claim + evidence"],
  "omitted": ["..."],
  "next_step": "..."
}
```

`criterion_id`, `locator` i `relation` są opcjonalne w `findings`, ponieważ ich
znaczenie zależy od zadania. `coverage` jest obowiązkową, domenowo neutralną
mapą kompletności kryteriów. Status `covered` wymaga evidence bezpośrednio w
`coverage` albo evidence w findingu z tym samym `criterion_id`, a
`not_applicable` i `blocked` wymagają niepustego `reason`. Nie wolno dodawać pól domenowych do koperty raportu. Zakres
każdego twierdzenia musi być równy zakresowi dowodów. Uogólnienie dotyczące
zbioru wymaga dowodów obejmujących cały zbiór; w przeciwnym razie elementy
trzeba wymienić osobno albo oznaczyć twierdzenie jako częściowe.

Jeśli `coverage.evidence` nie jest puste, każdy jego element musi mieć ten sam
obiektowy format co `findings.evidence`: `path`, liczbowe `line_start` i
`line_end`, opcjonalnie `locator` oraz `relation`. Skrócone stringi typu
`path:line-line` są niedozwolone. Puste `coverage.evidence` jest dozwolone dla
`covered` wyłącznie wtedy, gdy to samo kryterium ma poprawne evidence w
`findings`.

Przed statusem `COMPLETE` scout musi wykonać preflight wszystkich ścieżek z
`findings` i `coverage`: skopiować repo-relative path dokładnie z wyniku
narzędzia, potwierdzić istnienie pliku oraz sprawdzić, że zakres linii mieści
się w aktualnym snapshotcie. Nie wolno konstruować ścieżek przez zgadywanie,
skracanie ani zmianę prefiksu. Niepotwierdzony dowód oznacza `INCOMPLETE`, a
nie `COMPLETE`.

Do mechanicznego składania raportu scout używa ledger buildera:

```text
node .agents/skills/_shared/scripts/context-scout-report-builder.mjs
```

Ledger jest lokalnym artefaktem pod `/tmp` albo w cache agenta, nigdy zmianą w
repozytorium. Typowy przebieg:

```text
node .agents/skills/_shared/scripts/context-scout-report-builder.mjs init "$LEDGER" --head "$HEAD" \
  --criteria-ids C1,C2,C3 --mode cross-layer
E1=$(node .agents/skills/_shared/scripts/context-scout-report-builder.mjs add-evidence "$LEDGER" \
  --path src/Example.php --line-start 10 --line-end 20)
node .agents/skills/_shared/scripts/context-scout-report-builder.mjs add-finding "$LEDGER" \
  --criterion C1 --claim "..." --evidence "$E1"
node .agents/skills/_shared/scripts/context-scout-report-builder.mjs set-coverage "$LEDGER" \
  --criterion C1 --status covered --evidence "$E1"
node .agents/skills/_shared/scripts/context-scout-report-builder.mjs render "$LEDGER" \
  --status COMPLETE --output "$REPORT"
```

`add-evidence` sprawdza dowód względem `HEAD` i zwraca stabilne ID. Findings i
coverage wskazują ID, a builder rozwija je do identycznych obiektów evidence,
eliminując ręczne kopiowanie ścieżek. `render` uruchamia również istniejące
reguły walidatora; po jego wykonaniu scout zwraca dokładną treść wygenerowanego
JSON. Jeśli builder lub walidacja zawiedzie, scout nie składa raportu ręcznie:
zwraca `INCOMPLETE` albo `BLOCKED` z przyczyną.

`risks` może zawierać krótkie teksty albo obiekty z `claim` i `evidence`; obiekty
ryzyka podlegają tym samym regułom dowodowym co `findings`. `omitted` pozostaje
listą krótkich tekstów.

Każdy dowód musi zawierać ścieżkę repo-relative bez `...` i bez ścieżki
absolutnej. Agent główny waliduje raport względem `manifest.head` przez:

```text
node .agents/skills/_shared/scripts/context-scout-report.mjs validate <report.json> --head <manifest.head> [--criteria <criteria.json>]
```

Jeśli agent główny przekaże kryteria w pliku `criteria.json`, walidator sprawdza
 również referencje `criterion_id` w `findings` i `coverage` oraz wymaga wpisu
 `covered` albo `not_applicable` dla każdego kryterium w raporcie `COMPLETE`.
 Status `blocked` nie może wystąpić w `COMPLETE`. Bez pliku kryteriów walidator sprawdza ścieżki, zakresy linii,
format koperty i obecność dowodów, ale nie udaje semantycznej oceny kompletności.
Agent główny nie powtarza szerokiego rekonesansu, chyba że raport jest
niekompletny albo sprzeczny z repo.
