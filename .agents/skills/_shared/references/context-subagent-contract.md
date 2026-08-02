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

- Oba scouty przed rekonesansem czytają wspólny playbook
  `./.agents/skills/_shared/references/repository-context-scout-playbook.md`;
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
  "required_evidence": [
    {
      "path": ".opencode/agent/context-scout-fast.md",
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

Scout waliduje wejście w tej kolejności:

1. sprawdza obecność pól handoffu,
2. waliduje osobny plik criteria,
3. uruchamia `context-manifest.mjs validate` i `verify` na manifeście,
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
rules: [ścieżki repo-relative]
documentation: [ścieżki repo-relative]
active_overrides: [krótkie nazwy i wartości]
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
      {"path": "repo/file", "line_start": 1, "line_end": 2, "locator": "Symbol", "relation": "defines"}
    ],
    "follow_up": [
      {"path": "repo/other-file", "reason": "konkretny powód punktowego odczytu przez rodzica"}
    ]
  }
}
```

`covered` ma maksymalnie 10 ścieżek, a `follow_up` maksymalnie 8. Rodzic nie
powinien ponownie czytać ścieżki z `covered`, poza read-before-write, zmianą
snapshotu, luką w raporcie albo jawnym wymaganiem użytkownika.

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
`findings`.

Przed statusem `COMPLETE` scout musi wykonać preflight wszystkich ścieżek z
`findings` i `coverage`: skopiować repo-relative path dokładnie z wyniku
narzędzia, potwierdzić istnienie pliku oraz sprawdzić, że zakres linii mieści
się w aktualnym snapshotcie. Nie wolno konstruować ścieżek przez zgadywanie,
skracanie ani zmianę prefiksu. Niepotwierdzony dowód oznacza `INCOMPLETE`, a
nie `COMPLETE`.

Mechaniczne składanie raportu, dozwolone ścieżki artefaktów i dokładną składnię
ledger buildera definiuje wyłącznie
`<skills_root>/_shared/references/context-scout-report-protocol.md`. Scout nie
składa końcowego JSON ręcznie. Jeśli agent nie zdąży wykonać `render`, helper
może odzyskać raport z poprawnego ledgeru wskazanego w promptcie; brak końcowego
renderu nie powinien sam w sobie uruchamiać fallbacku.

`risks` może zawierać krótkie teksty albo obiekty z `claim` i `evidence`; obiekty
ryzyka podlegają tym samym regułom dowodowym co `findings`. `omitted` pozostaje
listą krótkich tekstów.

Każdy dowód musi zawierać ścieżkę repo-relative bez `...` i bez ścieżki
absolutnej. Agent główny waliduje raport względem `manifest.head` przez:

```text
node .agents/skills/_shared/scripts/context-scout-report.mjs validate <report.json> --head <manifest.head> [--criteria <criteria.json>]
```

Plik `criteria.json` jest obowiązkowy. Walidator sprawdza referencje
`criterion_id` w `findings` i `coverage` oraz wymaga wpisu `covered` albo
`not_applicable` dla każdego kryterium w raporcie `COMPLETE`. Status `blocked`
nie może wystąpić w `COMPLETE`. Opcjonalne `required_evidence` i
`forbid_negative_claims` są egzekwowane deterministycznie, ale nadal nie stanowią
pełnej semantycznej oceny prawdziwości claimów.
Agent główny nie powtarza szerokiego rekonesansu, chyba że raport jest
niekompletny albo sprzeczny z repo.
