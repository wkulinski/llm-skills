# Kontrakt kontekstu między agentami

## Delegacja między klientami

Wybór mechanizmu delegacji i zastąpienie niedostępnej roli OpenCode niezależnym
subagentem opisuje `repository-context-hybrid.md`, sekcja
„Harness-independent delegation”. Nazwa narzędzia nie określa dostępności
workflow; granice roli, izolacja wejść i walidacja raportu pozostają obowiązkowe.

## Role

### Agent główny

Agent główny odpowiada za rozmowę z użytkownikiem oraz:

- odczyt issue i komentarzy,
- interpretację intencji i kryteriów akceptacji,
- decyzje dotyczące zakresu i architektury,
- rozpoczęcie lifecycle kontekstu projektu,
- weryfikację plików przed edycją.

Wspólna instalacja A określa narzędzia i instrukcje, a katalog pracy projektu B
określa źródła oraz prywatne dane workflow. Agent główny przekazuje absolutne
ścieżki wejść i wyjścia B oraz playbooka A. Położenie B wobec katalogu sesji nie
zastępuje izolacji danych i nie jest samodzielnym powodem blokady.

Przed udostępnieniem scoutowi Codebase Memory agent główny ustala z konfiguracji
klienta lub handoffu mechanizmu tworzącego środowisko:

- lokalizację własnego magazynu B, niewspółdzielonego z A/C;
- własność odrębnego runtime/demona B (nie tylko nazwę projektu w bazie);
- potwierdzenie gotowości konkretnych indeksów i jego źródło, np. zakończone
  przygotowanie indeksu albo istniejące metadane środowiska.

Wynik wraz z lokalizacją magazynu, własnością runtime i źródłem gotowości zapisz
w istniejących `constraints` handoffu, bez sekretów. Nie twórz rejestru ani
obowiązkowego narzędzia zarządzającego. Brak dowodu izolacji lub gotowości oznacza
jawną informację o pracy plikowej: scout nie odpytuje niepotwierdzonego połączenia.
Samo `list_projects` nie potwierdza prywatności magazynu ani runtime.

Primary przy potwierdzonym połączeniu wywołuje `list_projects` i wybiera pierwszy
alfabetycznie po nazwie gotowy projekt zgodny z absolutnym `root_path` i branchem
B z manifestu. Gotowość wynika z mechanizmu przygotowującego indeks, nie z pola
`status: ready` w tej odpowiedzi (sprawdzona wersja CMM 0.12.1 go nie zwraca).
Brak zgodnego gotowego indeksu lub błąd serwera oznacza narzędzia plikowe i
konkretną przyczynę w ryzykach. Scouci nie indeksują ani nie mutują CMM; każde
wykorzystane twierdzenie i tak wymaga odczytu źródła w B.

### `context-refresher`

`context-refresher` jest jedyną delegowaną rolą, która może wykonać pełną
procedurę `$context-refresh`. Używa się go jawnie przy inicjalizacji sesji lub
świadomym odświeżeniu kontekstu. Zwraca zwarty manifest, a nie kopię treści
dokumentacji.

### Reviewer w osobnej sesji

Sesja uruchomiona według `<skills_root>/_shared/references/review-session-contract.md`
jest delegowaną rolą, mimo że działa jako osobny proces agenta: nie wykonuje
procedury startowej agenta głównego, `$context-refresh` ani repository-context,
nie pyta użytkownika i nie deleguje dalej. Wejścia dostaje jako powiązane pliki
z promptu, a nie z rozmowy.

### `context-scout`

`context-scout` jest tylko do odczytu i wykonuje repozytoryjny rekonesans. Musi:

- nie pobierać ani nie interpretować issue/komentarzy GitHub,
- nie uruchamiać `$context-refresh`,
- nie edytować kodu ani innych danych poza JSON własnej próby; nie uruchamiać
  QA/review, nie commitować i nie diagnozować runtime,
- otrzymać znormalizowany brief oraz manifest od agenta głównego,
- analizować tylko pliki repozytorium potrzebne do zmapowania implementacji.

Używa wyłącznie narzędzi i punktowego wyszukiwania/odczytu dostępnych w swojej
roli. Może doczytać brakujący README modułu lub lokalną konwencję, jeśli wymaga
tego brief, ale nie powinien ponownie czytać źródeł wymienionych w manifeście
bez wyjaśnienia, dlaczego manifest jest niewystarczający.

## Triggery routingu

Cały routing primary/fallback, warunki delegacji i lifecycle kontrolera definiuje
wyłącznie `<skills_root>/_shared/references/repository-context-hybrid.md`. Ten
kontrakt nie powiela algorytmu. Brak delegacji jest uzasadniony tylko wtedy, gdy
zakres jest oczywiście poza `repository-context` i nie wymaga scoutingu.

### `context-scout-fast`

`context-scout-fast` jest primary hybrydy z CMM i pracuje w trybie `targeted`
albo `cross-layer`. Nie ma trybu standalone.

### `context-scout`

`context-scout` jest niezależnym fallbackiem o tym samym zakresie `targeted` lub
`cross-layer`, bez CMM i bez danych primary.

### Reguły wspólne

- Oba scouty przed rekonesansem czytają wspólny playbook z absolutnej ścieżki
  instalacji A przekazanej przez dispatch;
  adaptery zachowują lokalnie role, strategię narzędziową i krytyczne zakazy.
- Nie deleguj scouta do QA, review, commita, runtime diagnostics ani obsługi
  pliku stanu.
- Żaden scout nie uruchamia helpera ani nie deleguje innego agenta. Naruszenie
  tej granicy jest błędem procedury, nie sygnałem do retry.

Deleguj `context-initialization` do `context-refresher` tylko wtedy, gdy agent
główny potrzebuje nowego/odświeżonego kontekstu i nie istnieje ważny manifest.

## Handoff od agenta głównego

Agent główny przekazuje zwarty, znormalizowany handoff, zwykle krótszy niż 1000
tokenów. Handoff ma zawierać wszystkie pola poniżej; brak pola wymaganego blokuje
scouta zamiast uruchamiać zgadywanie:

```yaml
mode: targeted | cross-layer
task_brief: znormalizowany cel implementacji
decisions: [decyzje użytkownika]
constraints: [ograniczenia architektoniczne, bezpieczeństwa i zależności]
```

Handoff nie może zawierać pełnych komentarzy issue, pełnej dokumentacji,
sekretów ani pełnych treści plików. Jeśli brakuje wymaganego pola, scout zgłasza
blokadę zamiast zgadywać.

`task_brief` opisuje cel i zakres, a nie historię rozmowy. Repozytorium, branch,
HEAD i `already_read` pochodzą wyłącznie z manifestu. Kryteria pochodzą wyłącznie
z osobnego, walidowanego `criteria.json` i mają stabilne identyfikatory, np.
`C1`, `C2`.

Kryterium może opcjonalnie zawierać deterministyczną bramkę evidence:

```json
{
  "id": "C1",
  "description": "Map the primary agent definition.",
  "forbid_negative_claims": true,
  "required_symbols": 1,
  "required_tests": 0,
  "required_evidence": [
    {
      "path": ".opencode/agents/context-scout-fast.md",
      "relation": "defines",
      "anchors": ["permission:"]
    }
  ]
}
```

Każdy wpis `required_evidence` wymaga dokładnie jednego bezpiecznego `path` albo
`path_prefix`; opcjonalne `relation` i wszystkie `anchors` muszą pasować do
evidence findingu z tym samym `criterion_id`. `forbid_negative_claims` odrzuca
w raporcie `COMPLETE` absolutne twierdzenia o braku lub wyłączności. Pola te
stosuj tylko wtedy, gdy wynikający z zadania target albo rola evidence są znane;
nie zgaduj ścieżek tylko po to, aby utworzyć bramkę.

Opcjonalne `required_symbols` i `required_tests` przyjmują nieujemną liczbę albo
listę nazw. Stosuj je wyłącznie wtedy, gdy symbol albo test jest twardą bramką
criterion. Minimalny file budget wynika z konkretnych `required_evidence.path`;
pozostałe evidence scout dobiera sam w stałym budżecie.

Scout waliduje wejście w tej kolejności:

1. sprawdza obecność pól handoffu,
2. odczytuje osobny plik criteria zwalidowany przez kontroler,
3. odczytuje manifest zwalidowany i sprawdzony przez kontroler przed delegacją,
4. sprawdza, czy brief i kryteria są spójne z trybem,
5. dopiero wtedy wykonuje odczyty repozytorium.

## Manifest kontekstu

Manifest jest zwięzłym indeksem kontekstu załadowanego przez agenta głównego
albo `context-refresher`. Zawiera ścieżki i krótkie role źródeł, nie ich treść:

```yaml
version: 1
role: primary | context-refresher
repository: stabilny identyfikator repozytorium
branch: bieżący branch
head: opcjonalny hash commita
stack_profile: generic | php-symfony-postgres (wynik resolve_stack_profile)
rules: [ścieżki repo-relative]
documentation: [ścieżki repo-relative]
active_overrides: [krótkie nazwy i wartości, np. aktywny override CQRS]
constraints: [krótkie inwarianty]
already_read: [ścieżki repo-relative]
omitted: [znane, celowo niezaładowane źródła]
```

Manifest waliduj przez `<skills_root>/_shared/scripts/context-manifest.mjs`
przed przekazaniem go scoutowi lub innemu delegowanemu subagentowi. Manifesty są lokalnymi artefaktami pod
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
      "claim_type": "observed | structural | inferred",
      "confidence": "high | medium | low",
      "anchors": ["literal term present in cited evidence"],
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

Opcjonalne `read_coverage` opisuje read-set przekazywany rodzicowi:

```json
{
  "read_coverage": {
    "covered": [
      {"path": "repo/file", "line_start": 1, "line_end": 2, "locator": "Symbol", "relation": "defines", "event": "read", "purpose": "discovery", "source": "scout", "read_mode": "range"}
    ],
    "follow_up": [
      {"path": "repo/other-file", "reason": "konkretny powód punktowego odczytu przez rodzica"}
    ]
  }
}
```

`covered` ma maksymalnie 10 ścieżek, a `follow_up` maksymalnie 8. Rodzic nie
powinien ponownie czytać ścieżki z `covered`, poza punktowym guardem
`read-before-write`, gdy raport nie obejmuje bieżącej wersji lub zakresu patcha,
zmianą snapshotu, luką w raporcie albo jawnym wymaganiem użytkownika. Sam status
`dirty`/`untracked` nie unieważnia ważnego odczytu.

`purpose` jest opcjonalną, deklarowaną etykietą celu odczytu. Jeśli pojawia się
którekolwiek pole strukturalnego kontekstu, evidence musi zawierać komplet
`event`, `purpose`, `source` i `read_mode`. Dozwolone wartości `purpose` to
`discovery`, `read-before-write`, `verification`, `snapshot-refresh` oraz
`report-gap`. `source` może wskazywać `main`, `parent`, `scout`, `system` albo
`unknown`, a `read_mode` — `full`, `range` albo `report`. Te pola opisują intencję
workflow; nie są dowodem aktualności treści pliku ani dowodem braku redundancji.

`claim_type`, `confidence` i co najmniej jeden literalny `anchor` są wymagane w każdym findingu. `observed` oznacza
bezpośredni fakt z evidence, `structural` relację lub definicję widoczną w kodzie,
a `inferred` interpretację, która musi jawnie zachować niepewność. Każdy anchor musi występować w zakresie co najmniej jednego cytowanego evidence. `criterion_id`, `locator` i `relation` są opcjonalne w `findings`, ponieważ ich
znaczenie zależy od zadania. `coverage` jest obowiązkową, domenowo neutralną
mapą kompletności kryteriów. Status `covered` wymaga evidence bezpośrednio w
`coverage` albo evidence w findingu z tym samym `criterion_id`, a
`not_applicable` i `blocked` wymagają niepustego `reason`. Nie wolno dodawać pól domenowych do koperty raportu. Pojedynczy zakres evidence nie może przekraczać 80 linii. Zakres
każdego twierdzenia musi być równy zakresowi dowodów. Uogólnienie dotyczące
zbioru wymaga dowodów obejmujących cały zbiór; w przeciwnym razie elementy
trzeba wymienić osobno albo oznaczyć twierdzenie jako częściowe.

Jeśli `coverage.evidence` nie jest puste, każdy jego element musi mieć ten sam
obiektowy format co `findings.evidence`: `path`, liczbowe `line_start` i
`line_end`, opcjonalnie `locator` oraz `relation`. Skrócone stringi typu
`path:line-line` są niedozwolone. Puste `coverage.evidence` jest dozwolone dla
`covered` wyłącznie wtedy, gdy to samo kryterium ma poprawne evidence w
`findings`, a findings podpierające to kryterium nie ograniczają się do
claimów `inferred`; wymagany jest finding `observed`/`structural` albo jawne
`coverage.evidence`.

Przed statusem `COMPLETE` scout musi wykonać preflight wszystkich ścieżek z
`findings` i `coverage`: skopiować repo-relative path dokładnie z wyniku
narzędzia, potwierdzić istnienie pliku oraz sprawdzić, że zakres linii mieści
się w aktualnym snapshotcie. Nie wolno konstruować ścieżek przez zgadywanie,
skracanie ani zmianę prefiksu. Niepotwierdzony dowód oznacza `INCOMPLETE`, a
nie `COMPLETE`.

Zapis JSON scouta i mechaniczne budowanie raportu po stronie kontrolera definiuje
wyłącznie
`<skills_root>/_shared/references/context-scout-report-protocol.md`. Scout nie
uruchamia powłoki ani buildera. Zapisuje kompletny JSON natywnym narzędziem
`write` albo `apply_patch`, dostępnym w profilu, do pliku
własnej próby i zwraca krótkie potwierdzenie bez treści raportu. Kontroler buduje
i waliduje raport wyłącznie z tego pliku w projekcie konsumenta.

`risks` może zawierać krótkie teksty albo obiekty z `claim` i `evidence`; obiekty
ryzyka podlegają tym samym regułom dowodowym co `findings`. `omitted` pozostaje
listą krótkich tekstów.

Każdy dowód musi zawierać ścieżkę repo-relative bez `...` i bez ścieżki
absolutnej. Agent główny waliduje raport względem `manifest.head` przez:

```text
node <skills_root>/_shared/scripts/context-scout-report.mjs validate <report.json> --head <manifest.head> [--criteria <criteria.json>]
```

Plik `criteria.json` jest obowiązkowy. Walidator sprawdza referencje
`criterion_id` w `findings` i `coverage` oraz wymaga wpisu `covered` albo
`not_applicable` dla każdego kryterium w raporcie `COMPLETE`. Status `blocked`
nie może wystąpić w `COMPLETE`. Opcjonalne `required_evidence` i
`forbid_negative_claims` są egzekwowane deterministycznie, ale nadal nie stanowią
pełnej semantycznej oceny prawdziwości claimów.
Agent główny nie powtarza szerokiego rekonesansu, chyba że raport jest
niekompletny albo sprzeczny z repo.

Schema-valid `INCOMPLETE` albo `BLOCKED` pozostaje niezaakceptowanym wynikiem,
ale helper zachowuje go jako `partialReportPath`. Brak raportu pozostaje jawną
klasą `REPORT_MISSING` w state i final metadata; helper nie tworzy wtedy
sztucznego evidence artifact. `partialReportPath` nie jest równoważny
`reportPath` raportu `COMPLETE` i nie ustawia `hybrid_final`.
