# Kontrakt planu wykonawczego

Ten plik jest kanonicznym właścicielem kontraktu dokumentu planu: języka planu,
wymaganych sekcji, inwariantów treści, schematu i zasad pól work package,
bramki trwałych testów, zasad czytelności, kontraktu środowiska i wykonania
oraz kontraktu narzędzi planu. Korzeń `$task-plan` prowadzi workflow i bramki;
ten plik czytaj tylko wtedy, gdy aktywna faza wymaga kontraktu dokumentu.

## Język planu

- Stosuj język dokumentacji wskazany w `AGENTS.md` repozytorium konsumenta. Jeśli
  nie określono tam języka, domyślnie pisz poprawną, naturalną polszczyzną
  techniczną — bez stylizacji literackiej i bez telegraficznych mieszanek.
- Jeśli użytkownik jawnie wybierze ASD-STE100 i zasady repozytorium na to
  pozwalają, cały opis planu ma być jednolicie napisany w tym standardzie. Nie
  przełączaj języka na podstawie języka źródła ani między sekcjami lub WP.
- Wymagane nazwy sekcji i klucze pól, np. `## Source and objective` i
  `- Goal:`, pozostają dokładnie w postaci wymaganej przez kontrakt planu. Treść
  po kluczu pisz w wybranym języku.
- Zachowuj dokładną pisownię nazw klas, metod, symboli, plików, ścieżek, komend,
  pól API i słów kluczowych języka programowania; zapisuj je w zapisie kodowym
  Markdownu.
  Objaśnij pojęcie w wybranym języku przy pierwszym użyciu, np. „klasa
  (`class`)”. Nie używaj angielskiego identyfikatora jako zamiennika zwykłego
  słowa w zdaniu.
- Używaj polskiego odpowiednika dla zwykłych pojęć technicznych, jeśli jest
  jednoznaczny. Jeśli trzeba zachować angielski termin lub skrót, wyjaśnij go
  przy pierwszym użyciu; nie twórz własnego rozwinięcia niepotwierdzonego
  dowodami.
- Nie zapisuj treści opisowej jako mieszanki polskiej składni i angielskich
  haseł. Unikaj urwanych równoważników, nieobjaśnionych skrótów oraz list
  połączonych ukośnikami, strzałkami lub średnikami, gdy zastępują opis relacji
  między krokami.

## Deterministyczna edycja istniejącego planu

Do punktowej aktualizacji już zapisanego planu używaj helpera `edit.mjs` skilla
`$task-plan` (składnia komend: `<skills_root>/task-plan/SKILL.md`), zamiast
tworzyć doraźne skrypty oparte na zamianie tekstu. Każdy punkt w sekcji planu musi
mieć nazwę przed `: `:

```md
- <nazwa-oraz-id>: <wartość>
- R3 [medium]: <wartość>
```

Nazwa może być identyfikatorem (`R3`, `A2`, `Q5`) albo nazwą pola
(`Dependencies`, `Evidence gate`). Helper operuje wyłącznie na tej strukturze.
Operacje to `add-bullet`, `edit-bullet`, `remove-bullet`, `answer-question`,
`add-question`, `edit-question`, `remove-question` i `apply-operations`; ta
ostatnia przyjmuje paczkę w formacie:

```json
{
  "operations": [
    {"type": "edit-bullet", "work_package": "WP1", "id": "Goal", "value": "..."},
    {"type": "add-bullet", "section": "Risks and discovery debt", "id": "R7", "status": "low", "value": "..."}
  ]
}
```

`add-bullet` wymaga nowego identyfikatora, a `edit-bullet` i `remove-bullet`
wymagają identyfikatora istniejącego dokładnie raz. Selektor sekcji i selektor WP
wzajemnie się wykluczają. Nie ma automatycznej numeracji: identyfikator nadaje
wywołujący, dzięki czemu punkty nazwane nie muszą być sztucznie numerowane. Pytania `Q<number>` są blokami z podpunktami
`Answer` i `Source`, więc obsługują je wyłącznie wrappery pytaniowe. `edit-question`
zmienia prompt, status i/lub odpowiedź (przejście do `answered` wymaga
odpowiedzi), a `remove-question` usuwa cały blok pytania.

`apply-operations` stosuje całą paczkę w pamięci na jednym odczycie, przerywa
całość przy pierwszym błędzie i zapisuje dokument raz — jedna logiczna poprawka
odpowiada jednej rewizji. Wynik domyślnie nie zawiera pełnego Markdowna.

`edit.mjs` wymaga kanonicznego pliku planu, jednoznacznego selektora i
zwalidowanego dokumentu. Brak albo duplikat sekcji, WP, punktu lub pytania kończy
operację bez zapisu. Po udanej transformacji zapis i frontmatter przechodzą
przez wspólny `store.mjs` (`<skills_root>/_shared/scripts/task-plan/store.mjs`);
tryb `--dry-run` wykonuje tę samą walidację bez zapisu. Helper nie interpretuje dowolnego Markdowna i nie stosuje heurystycznego
wyszukiwania fragmentów tekstu.

## Wymagane sekcje

```text
## Source and objective
## Source assessment
## Scope
## Direction, simplicity and consistency
## Source coverage
## Work packages
## Order
## Decisions and open questions
## Risks and discovery debt
## Acceptance and verification
## Execution environment
## Execution
```

## Inwarianty treści

- Plan opisuje stan obecny i docelowy, nie przebieg własnego powstawania.
- Decyzję zapisuj jako wynik z krótkim uzasadnieniem, bez chronologii, wersji
  roboczych i opisu kolejnych zmian.
- Jeśli decyzja zmienia WP, nadpisz WP do stanu docelowego zamiast opisywać deltę.
- Nie przepisuj reguł globalnych z innych skilli lub dokumentacji. Zapisz tylko
  wynik decyzji dotyczącej konkretnego WP, np. przypisane mu ryzyko.
- Krytyczny review aktualizuje plan; nie tworzy osobnego lifecycle findings.

`Source assessment` zapisuje krytyczną interpretację materiału wejściowego:

```text
- Requested outcome:
- Observed symptoms:
- Explicit constraints:
- Suggested diagnosis or solution:
- Claims verified in evidence:
- Claims corrected or still unverified:
```

Oczekiwany rezultat, symptom i sugerowane rozwiązanie opisuj zgodnie z wynikiem
oceny z intake. Przykład nie staje się pełnym wymaganiem bez potwierdzenia.

Dla punktów dotyczących interakcji użytkownika `Requested outcome` opisuje
potrzebę użytkownika, a `Suggested diagnosis or solution` proponowaną
interakcję; hipotezy o celu użytkownika trafiają do
`Claims corrected or still unverified`.

Uwagi produktowe w `Decisions and open questions` zapisuj w formacie:

```md
- N1 [note]: <interakcja>; koszt: <koszt dla użytkownika>; podstawa: <źródło | fakt kodowy | hipoteza>; kierunek: <kierunek albo pytanie>
```

Uwagi `N<number> [note]` nie są pytaniami i nie blokują `ready`. Konflikt
zmieniający kryteria akceptacji zapisuj jako pytanie `Q<number> [open]`.

`Direction, simplicity and consistency` jest zwięzłym, widocznym wynikiem
critical review. Zawiera dokładnie informacje potrzebne do obrony kierunku:

```text
- Existing mechanism reused:
- Simpler alternative considered:
- Why the selected approach is minimal:
- Duplicate or parallel responsibilities:
- Cross-WP consistency and ownership:
```

Nie używaj ogólników typu „brak” bez krótkiego uzasadnienia. Jeśli plan tworzy
nowy mechanizm, wskaż istniejące alternatywy i powód, dla którego nie wystarczą.

## Schemat i zasady pól work package

Każdy pakiet używa nagłówka `### WP<number> — <tytuł>` i zawiera:

```text
- Source:
- Goal:
- Scope:
- Out of scope:
- Confirmed paths:
- Candidate paths:
- Discovery required:
- Estimated size: `small`, `medium` albo `large`
- Acceptance criteria:
- Verification:
```

### Trwałe testy a jednorazowa weryfikacja zmiany

Nie zamieniaj listy zmian w listę trwałych testów. Dowód, że wykonano zmianę,
nie jest automatycznie trwałą specyfikacją systemu. W `Verification` rozdziel
testy pozostające w repozytorium od jednorazowych checków wykonawczych.

Dla każdego proponowanego trwałego testu wskaż regułę docelowego systemu,
a następnie odpowiedz: **Czy ten osobny scenariusz zaplanowalibyśmy również
dla systemu zbudowanego od początku według docelowego kontraktu, bez znajomości
usuwanego kodu, starego ograniczenia i historii zadania?** Oceń potrzebę
scenariusza, jego szczególne wartości wejściowe i asercje, nie tylko nazwę
albo deklarowane uzasadnienie.

- Jeżeli po odjęciu historii znika powód istnienia osobnego scenariusza,
  nie wpisuj go do zakresu trwałych testów. Potrzebne potwierdzenie wykonania
  zmiany zaplanuj jako jednorazowy check.
- Jeżeli istniejący test pokrywa docelową regułę, zaplanuj jego aktualizację
  zamiast osobnego testu upamiętniającego usunięte zachowanie. Nowy trwały
  scenariusz wymaga odrębnego przypadku wynikającego z docelowego kontraktu.
- Sam fakt, że test nie przechodziłby przed zmianą, nie uzasadnia jego trwałości.
  To dowód różnicy zachowania, a nie samodzielne wymaganie testowe.

Przykład: po usunięciu limitu 10 rekordów osobny test „wyświetla 11 rekordów”,
uzasadniony wyłącznie dawnym limitem, należy zastąpić jednorazową weryfikacją.
Test kompletności oczekiwanego zbioru rekordów spełniających warunki może
specyfikować docelowy kontrakt, jeżeli takie jest wymaganie; najpierw sprawdź,
czy nie jest to już odpowiedzialność istniejącego testu listy. Sama liczba 11
w fixture nie dyskwalifikuje testu. Zmiana nazwy albo zastąpienie 11 liczbą 17
nie naprawia braku uzasadnienia dla osobnego scenariusza. Analogicznie asercja
braku jest poprawna, gdy wynika z niezależnego wymagania docelowego kontraktu,
a nie wyłącznie z historii usunięcia.

### Pozostałe zasady work package

Puste kategorie zapisuj jako `none`. `Candidate paths` są hipotezami i nie mogą
być przedstawione w handoffie jako potwierdzone. Jeśli ścieżka nie została
potwierdzona, użyj konkretnego `Discovery required` zamiast zgadywania.

### Czytelność i wykonalność pakietu roboczego

Każdy pakiet roboczy (WP) ma być zrozumiały dla człowieka oraz wykonalny przez
agenta o niskim poziomie rozumowania bez odgadywania intencji autora. Oceniaj
cały opisowy tekst planu, nie tylko WP. Zachowaj wymagane klucze schematu, ale
ich wartości zapisuj pełnymi zdaniami w wybranym języku.

- `Goal` zaczyna od oczekiwanego zachowania lub rezultatu, a nie od skrótu
  implementacyjnego. Najpierw opisz, co ma się zmienić dla użytkownika lub
  systemu, a potem — jeśli jest to potwierdzone — jaką odpowiedzialność
  techniczną należy zmienić.
- W `Scope` opisz działania w kolejności wykonania. Każde zdanie ma wskazywać
  konkretny obiekt lub zachowanie oraz rezultat działania. Nie łącz kilku
  niezależnych kroków w hasłową listę; użyj jasnych łączników, np. „najpierw”,
  „następnie” i „po tym”.
- Gdy działanie zależy od zdarzenia, stanu lub wyniku diagnozy, nazwij warunek i
  opisz skutek. Dla każdej istotnej gałęzi podaj: jakie dowody ją potwierdzają,
  co wtedy zrobić oraz kiedy zakończyć WP albo przekazać problem do rozstrzygnięcia.
  Nie zostawiaj wykonawcy wyboru między różnymi naprawami.
- Każdą istotną gałąź zapisz osobno, np. „Jeśli dowody potwierdzą [warunek],
  wykonaj [działanie] i sprawdź [wynik]. Jeśli potwierdzą [inny warunek],
  wykonaj [inne działanie]. Jeśli nie da się zebrać dowodów, [jawny krok
  kończący lub eskalujący WP]”. Nie łącz gałęzi w skrótową frazę z ukośnikami.
- `Out of scope` określa zachowania lub obszary, których nie zmieniać. Zapisuj
  granicę konkretnie; samo „bez zmian pobocznych” nie wystarcza.
- Każde `Acceptance criteria` ma wskazywać warunek początkowy lub dane wejściowe
  (jeśli mają znaczenie), działanie albo sytuację oraz obserwowalny wynik, który
  rozstrzyga zaliczenie. Stosuj wzór: „Gdy [warunek], po [działaniu] następuje
  [obserwowalny wynik]”. Unikaj ocen typu „działa poprawnie” bez opisu tego, co
  dokładnie ma się wydarzyć.
- `Verification` wskazuje trwały test albo jednorazowe sprawdzenie oraz oczekiwany
  wynik. Zachowaj rozróżnienie opisane w bramce „Trwałe testy a jednorazowa
  weryfikacja zmiany”.
- Opis nie może wymagać znajomości wcześniejszej rozmowy ani niejawnego
  dopowiadania brakującego wymagania. Jeśli odpowiedź może zmienić zachowanie
  publiczne, model danych, podział odpowiedzialności, granice WP lub kryteria
  akceptacji, rozstrzygnij ją przed `ready` na podstawie dowodów albo pytania
  użytkownika; nierozstrzygnięta blokada oznacza `blocked`, a nie swobodę
  wykonawcy.
- Przed zamknięciem WP sprawdź, czy na podstawie jego tekstu i wskazanych źródeł
  można odpowiedzieć: jaki jest warunek wejścia, co zrobić i w jakiej
  kolejności, jaki wynik uznać za poprawny, czego nie zmieniać, jak wynik
  zweryfikować oraz co zrobić dla każdej opisanej gałęzi. Jeśli odpowiedź wymaga
  odgadywania, doprecyzuj plan albo pozostaw go `blocked`.

Przykład przeredagowania zakresu. Fragment oznaczony jako antywzorzec służy
wyłącznie do pokazania formy odrzucanej; nie kopiuj go do planu.

**Antywzorzec — forma odrzucana (nie kopiować):**

> AC1: wiersz exposes native anchor z tym samym permitted URL; AC2: lewy click
> zostaje w bieżącej karcie, native context menu otwiera nową.

**Wzorzec docelowy — tak formułuj zakres:**

> Wiersz sprawy ma zawierać zwykły link HTML prowadzący do tego samego adresu co
> dotychczas, z zachowaniem obecnych uprawnień. Zwykłe kliknięcie nadal otwiera
> sprawę w bieżącej karcie. Menu kontekstowe przeglądarki ma umożliwiać otwarcie
> linku w nowej karcie. Nie dodawaj własnego menu kontekstowego ani kodu
> JavaScript otwierającego kartę po kliknięciu prawym przyciskiem myszy.

Przed wpisaniem do `Scope` operacji „dodać”, „zmienić”, „zaimplementować” albo
równoważnej sprawdź punktowo obecnego właściciela mechanizmu. Proponowana zmiana
pozostaje w `Scope` tylko wtedy, gdy evidence potwierdza brak albo konkretną lukę.
Jeżeli mechanizm już realizuje wymagane zachowanie, usuń zmianę lub przeformułuj
ją na weryfikację i szukaj rzeczywistej przyczyny symptomu. Jeżeli nie da się tego
rozstrzygnąć, zastosuj test wpływu discovery debt opisany w critical review.

### Dobór profilu wykonania

`Estimated size` jest szacunkiem planistycznym przekazywanym wykonawcy. Nie
steruje batchingiem ani trwałym stanem wykonania.

Po oszacowaniu WP wybierz z `.agents/config/model-hierarchy.json` najsłabszy
profil, który wystarczy do realizacji planu. Profile są uporządkowane od
najsilniejszego do najsłabszego. Użyj override tylko dla WP wymagającego
silniejszego profilu. Model porównuj bez prefiksu dostawcy: profil
`commandcode/deepseek/model` i `deepseek/model` to ten sam model, a reasoning
musi zgadzać się dokładnie. Brak konfiguracji, duplikat albo rekomendacja spoza
hierarchii blokuje walidację; nie zgaduj ani nie dopisuj profilu. Szablon znajduje
się w `<skills_root>/plan-execute/model-hierarchy.json.dist`.

## Kolejność i pokrycie źródła

Kolejność WP w dokumencie jest kolejnością wykonania. Sekcja
`Order` może krótko uzasadnić kolejność wykonania, ale nie jest wejściem do
osobnego grafu ani mechanizmu batchowania.

`Source coverage` mapuje każdy punkt źródła do WP. Po odpowiedzi użytkownika
punkt może zamiast tego otrzymać krótkie, uzasadnione `excluded`. Nie twórz WP
dla samej ceremonii procesu.

## Kontrakt środowiska i wykonania

Każdy plan gotowy do implementacji zawiera rekomendowane środowisko oraz prosty,
binarny kontrakt wykonania. Nie zapisuje stanów sesji, batchy ani przejść
pośrednich.

Minimalny format:

```md
## Execution environment

- Default model: provider/model
- Default reasoning: concrete-level
- WP overrides: none

## Execution

- [ ] WP1
- [ ] WP2
```

Kolejność wpisów jest kolejnością wykonania. Ukończenie zapisuje wyłącznie
task-plan przez zmianę `[ ]` na `[x]` wraz z datą i krótkim evidence:

```md
- [x] WP1 — 2026-08-27 — focused test passed
```

Niezakończony lub zablokowany WP pozostaje `[ ]`.

Zmiana wymagań ukończonego WP: owner ocenia ją podczas obowiązkowego review, a
magazyn nie porównuje treści WP i nie dodaje automatycznej bramki zapisu.

- Jeśli nowe wymagania unieważniają evidence ukończenia albo dodają niewykonaną
  pracę, owner otwiera ten WP i późniejsze ukończone WP przez zmianę `[x]` na
  `[ ]` w sekcji `## Execution`.
- Jeśli zmiana jest wyłącznie redakcyjna (np. literówka) i evidence pozostaje
  ważne, checklista zachowuje `[x]`, ale zmieniona treść przechodzi review i
  `record-review`.
- W obu przypadkach owner zapisuje wynik oceny i jej uzasadnienie w sekcji
  `Decisions and open questions` jako wpis `D<number>`.

`WP overrides: none` można zastąpić uzasadnioną listą:

```md
- WP overrides:
  - WP2: model=provider/model; reasoning=concrete-level; justification=why this WP needs it
```

## Kontrakt narzędzi planu

Kontrakt danych wejściowych `store.mjs`, tokenu aktualizacji, paczki operacji
`edit.mjs` oraz danych `review-cycle.mjs`:

```json
{
  "repo_root": "/repo",
  "source_identity": "owner/repository#123",
  "markdown_body": "# Pełny plan...",
  "context": null
}
```

Aktualizacja istniejącego planu wymaga tokenu rzeczywistej bazy odczytanej do
przygotowania treści; autorem tokenu jest wywołujący, a `savePlan` nie odświeża go
sam z najnowszego pliku:

```json
{
  "repo_root": "/repo",
  "source_identity": "owner/repository#123",
  "markdown_body": "# Pełny plan...",
  "expected_revision": 3,
  "base_sha256": "<sha256 bajtów odczytanego dokumentu>"
}
```

`edit.mjs` i `complete-wp` biorą token z własnego pojedynczego odczytu faktycznie
transformowanego dokumentu, więc nie wymagają tokenu wyboru WP. Punktowe zmiany
zbieraj w jednej paczce operacji, aby jedna logiczna poprawka odpowiadała jednej
rewizji:

```json
{
  "operations": [
    {"type": "edit-bullet", "work_package": "WP1", "id": "Goal", "value": "Poprawiony cel."},
    {"type": "add-bullet", "section": "Risks and discovery debt", "id": "R7", "status": "low", "value": "Nowe ryzyko."}
  ]
}
```

`context`, jeśli istnieje, zawiera finalny `status`, ścieżki raportu i kryteriów
oraz ich SHA-256. `save --input -` przyjmuje ten JSON przez stdin.

### Wejście `review-cycle.mjs decide`

`review-cycle.mjs` przyjmuje przez JSON wyłącznie jawne dane ownera. Helper
sprawdza ich kompletność i spójność, nie prawdziwość ocen semantycznych. Brak albo
sprzeczność niezbędnych danych blokuje decyzję (`ok: false`, działanie `blocked`).
Poprawna decyzja zwraca pole `plan`; bez niego `record-review` jej nie przyjmie.

| Pole | Wymagane | Zasady |
| --- | --- | --- |
| `verdict` | zawsze | Jeden z: `PLAN READY`, `PLAN READY WITH CAVEAT`, `PLAN DISCUSS`, `PLAN CHANGES REQUESTED`, `PLAN BLOCKED`. |
| `full_review_count` | zawsze | Liczba całkowita równa `1`: jedno pełne review poprzedza każdą decyzję cyklu. |
| `delta_review_count` | zawsze | Liczba całkowita od `0` do `3`. `0` oznacza pełne review; `1`–`3` oznacza kolejne delta-review. Review otwierające nowy cykl po decyzji końcowej ma `1`. |
| `plan` | pełne review (`delta_review_count: 0`) | Obiekt `plan_id`, `revision`, `content_sha256` przeglądanej rewizji; brak albo `null` przy pełnym review jest błędem `MISSING_PLAN_REFERENCE`. Przy delta-review opcjonalny, ale jeśli jest, musi zgadzać się z `plan_id`, `current_revision` i `current_sha256` z `delta_review` (`PLAN_REFERENCE_CONFLICT`); bez niego helper bierze te wartości z `delta_review`. |
| `findings` | zawsze (może być pusta) | Findings bieżącego review. Każdy ma unikalne `id` w formacie `F<number>`, `classification` (`finding`, `QUESTION` albo `SUGGESTION`), jawne `actionable` (boolean) oraz `repair_attempts` (liczba całkowita ≥ 0). |
| `findings[].severity` | `finding` | `BLOCKER`, `MAJOR` albo `MINOR` dla `classification: finding`; dla `QUESTION` i `SUGGESTION` brak albo `null`. `BLOCKER` i `MAJOR` nie mogą być nieactionable bez `accepted_decision_ref`. |
| `findings[].approval_affecting` | `QUESTION` | Boolean. Pytanie nie jest `actionable`; approval-affecting `QUESTION` blokuje nawet przy `PLAN READY`. `SUGGESTION` nigdy nie jest actionable. |
| `findings[].accepted_decision_ref`, `requires_user_decision`, `requires_external_evidence` | opcjonalne | Niepusty string z odwołaniem do decyzji użytkownika albo booleany. Odwołanie wyłącza finding z listy actionable; flagi blokują naprawę. |
| `findings[].previous_id`, `recurrence` | gdy finding wiąże się z wcześniejszym ID | `previous_id` wskazuje ID z `previous_findings`. Towarzyszy mu `recurrence`: `same_failure_mode` i `new_evidence` (booleany); `new_evidence: true` wymaga niepustego `evidence`. Ten sam failure mode zachowuje poprzednie ID, inny failure mode dostaje nowe. |
| `findings[].provenance` | nowy actionable finding w delta-review | `kind` (`changed_section`, `changed_work_package` albo `direct_dependency`), `target` z zadeklarowanego zakresu delta oraz niepusty `evidence`. Hashe dokumentów nie zastępują pochodzenia. |
| `previous_findings` | zawsze (może być pusta) | Wcześniejsze findings: `{id, severity}` albo, dla pytania, `{id, classification: "QUESTION"}` bez severity. Przy pełnym review pusta. Review otwierające nowy cykl (`delta_review_count: 1`) przenosi nierozwiązane findings i pytania z poprzedniego review albo ma pustą listę po `finish-ready`; przy `delta_review_count` ≥ 2 lista musi być niepusta (`EMPTY_PREVIOUS_FINDINGS`). |
| `previous_resolutions` | zawsze (może być pusta) | Dokładnie jedno rozstrzygnięcie na każde wcześniejsze ID; brak to `MISSING_PREVIOUS_RESOLUTION`. Statusy: `resolved`; `current` z `current_severity` zgodnym z bieżącym findingiem; `accepted` z `decision_ref`. Wcześniejsze pytanie można rozstrzygnąć wyłącznie jako `accepted` z `decision_ref: Q<number>`. |
| `delta_review` | `delta_review_count` ≥ 1 | Obiekt z `delta-input --file`; przy `delta_review_count: 0` jest błędem. Zawiera `plan_id`, `base_revision`, `current_revision`, `base_sha256`, `current_sha256`, `changed_sections`, `changed_work_packages`, `previous_finding_ids` i `allowed_direct_dependencies`. Wymaga co najmniej jednej zmienionej sekcji lub WP, różnych hashy i `previous_finding_ids` zgodnych z `previous_findings`. |

Pochodzenie hashy: `plan.content_sha256` pełnego review to `content_sha256` z
ostatniego wyniku `validate`, `save` albo `edit` dla przeglądanej rewizji. Po
`record-review` plik ma nowe bajty (zmieniony front matter), więc przy następnym
review odczytaj aktualny `content_sha256` ponownie przez `validate`; nie używaj
wartości sprzed zapisu decyzji. W delta-review hashe wylicza `delta-input --file`
z planu.

Wynik `delta-input` służy jako wejście delta-review do ponownego `decide`. Delta
opisuje zmiany od ostatniej przejrzanej rewizji do bieżącej (może obejmować kilka
rewizji).

#### Przykłady wejścia `decide`

Przykłady są ilustracyjne (hashe i identyfikatory są wymyślone) i sprawdza je
trwały test helpera. Pełne review z findings (działanie `apply-repair`):

```json
{
  "verdict": "PLAN CHANGES REQUESTED",
  "full_review_count": 1,
  "delta_review_count": 0,
  "plan": {
    "plan_id": "v2-example-1111aaaa-2222bbbb",
    "revision": 1,
    "content_sha256": "1111111111111111111111111111111111111111111111111111111111111111"
  },
  "findings": [
    {"id": "F1", "classification": "finding", "severity": "MAJOR", "actionable": true, "repair_attempts": 0}
  ],
  "previous_findings": [],
  "previous_resolutions": []
}
```

Delta-review naprawy (działanie `apply-repair`, severity wcześniejszego findingu
spadło):

```json
{
  "verdict": "PLAN CHANGES REQUESTED",
  "full_review_count": 1,
  "delta_review_count": 1,
  "findings": [
    {"id": "F1", "classification": "finding", "severity": "MINOR", "actionable": true, "repair_attempts": 1}
  ],
  "previous_findings": [{"id": "F1", "severity": "MAJOR"}],
  "previous_resolutions": [{"id": "F1", "status": "current", "current_severity": "MINOR"}],
  "delta_review": {
    "plan_id": "v2-example-1111aaaa-2222bbbb",
    "base_revision": 1,
    "current_revision": 2,
    "base_sha256": "1111111111111111111111111111111111111111111111111111111111111111",
    "current_sha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "changed_sections": ["Work packages"],
    "changed_work_packages": ["WP1"],
    "previous_finding_ids": ["F1"],
    "allowed_direct_dependencies": ["Acceptance and verification"]
  }
}
```

Otwarcie nowego cyklu po pytaniu, odpowiedzi użytkownika i zmianie planu
(działanie `finish-ready`):

```json
{
  "verdict": "PLAN READY",
  "full_review_count": 1,
  "delta_review_count": 1,
  "findings": [],
  "previous_findings": [{"id": "F1", "classification": "QUESTION"}],
  "previous_resolutions": [{"id": "F1", "status": "accepted", "decision_ref": "Q1"}],
  "delta_review": {
    "plan_id": "v2-example-1111aaaa-2222bbbb",
    "base_revision": 2,
    "current_revision": 3,
    "base_sha256": "2222222222222222222222222222222222222222222222222222222222222222",
    "current_sha256": "3333333333333333333333333333333333333333333333333333333333333333",
    "changed_sections": ["Decisions and open questions"],
    "changed_work_packages": [],
    "previous_finding_ids": ["F1"],
    "allowed_direct_dependencies": []
  }
}
```

### Front matter planu i potwierdzenie review

`store.mjs` jest właścicielem front matter. Poza polami źródła i kontekstu zapisuje:

| Pole | Wartość |
| --- | --- |
| `previous_sha256` | SHA-256 bajtów poprzedniej rewizji; `null` dla rewizji 1. Zwracane też jako `previous_sha256` w wyniku `save`, `edit` i `complete-wp`. |
| `reviewed_revision` | Rewizja, dla której zapisano decyzję `finish-ready`; `null` przed review. |
| `reviewed_body_sha256` | SHA-256 treści planu bez sekcji `## Execution` w chwili review; `null` przed review. |
| `review_base_revision` | Rewizja objęta ostatnią zapisaną decyzją review (dowolne `action`); baza następnego delta-review; `null` przed review. |
| `review_base_sha256` | SHA-256 bajtów dokumentu, który oceniło ostatnie zapisane review; `null` przed review. |

Zasady:

- `record-review --file <plan> --input <decision.json>` przyjmuje wynik
  `review-cycle.mjs decide` tylko z `ok=true` i polem `plan` zgodnym z bieżącym
  `plan_id`, rewizją i hashem dokumentu (`REVIEW_DECISION_UNBOUND`,
  `REVIEW_DECISION_STALE`). Każda taka decyzja ustawia `review_base_*`; decyzja
  `finish-ready` dodatkowo ustawia `reviewed_*`. Rewizja nie rośnie, a ponowny
  zapis tej samej decyzji niczego nie zmienia.
- Każdy zapis zmieniający treść (`save`, `edit`) zeruje oba pola `reviewed_*`;
  `review_base_*` przechodzą bez zmian do kolejnej rewizji.
  Zapis identycznej treści nie zmienia pliku, rewizji ani potwierdzenia.
- `complete-wp` zmienia tylko `## Execution`, więc zachowuje potwierdzenie
  (`reviewed_revision` wskazuje nową rewizję, hash treści jest ten sam).
- `validate.mjs` zwraca `blocked` z `blocked_reason: review_pending` i pustą listą
  `errors`, gdy plan nie ma otwartych pytań ani błędów, a pola review są `null`,
  nie zgadzają się z bieżącą rewizją lub hashem treści albo w ogóle ich brakuje.
- Plan zapisany przed wprowadzeniem tych pól pozostaje czytelny i poprawny, ale
  przed wykonaniem wymaga review: do czasu `record-review` jest `review_pending`,
  a `plan-execute` odrzuca go z `PLAN_NOT_READY` i wskazówką naprawy. Nie ma
  tolerancji wykonania planów bez potwierdzenia review.

`delta-input --file <plan> [--root <repo>] --input <json>` wyprowadza z planu
`plan_id`, `base_revision` (`review_base_revision`), `current_revision`,
`base_sha256` (`review_base_sha256`) i `current_sha256` (hash bajtów pliku).
`--input` zawiera tylko `changed_sections`, `changed_work_packages`,
`previous_finding_ids` i `allowed_direct_dependencies`. Brak zapisanego review
(`DELTA_BASE_UNAVAILABLE`), brak hasha bazy (`DELTA_BASE_HASH_MISSING`) lub brak
zmian od ostatniego review (`DELTA_NOTHING_TO_REVIEW`) to twardy błąd bez wyniku;
`plan_id` lub
rewizje sprzeczne z planem to `DELTA_INPUT_CONFLICT`. `base_sha256` i
`current_sha256` w `--input` pozostają jawnym nadpisaniem, oznaczonym w wyniku
w `sources` jako `input-override`.
