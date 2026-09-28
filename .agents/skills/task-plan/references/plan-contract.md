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

Do punktowej aktualizacji już zapisanego planu używaj
`<skill_dir>/scripts/edit.mjs`, zamiast tworzyć doraźne skrypty oparte na
zamianie tekstu. Każdy punkt w sekcji planu musi mieć nazwę przed `: `:

```md
- <nazwa-oraz-id>: <wartość>
- R3 [medium]: <wartość>
```

Nazwa może być identyfikatorem (`R3`, `A2`, `Q5`) albo nazwą pola
(`Dependencies`, `Evidence gate`). Helper operuje wyłącznie na tej strukturze:

```text
<skill_dir>/scripts/edit.mjs add-bullet
  --file ./docs/plan/<plan>.md
  (--section <dokładna sekcja> | --work-package <WP<number>>)
  --id <nazwa>
  --value <jednoliniowa wartość>
  [--status <status>]

<skill_dir>/scripts/edit.mjs edit-bullet
  --file ./docs/plan/<plan>.md
  (--section <dokładna sekcja> | --work-package <WP<number>>)
  --id <nazwa>
  [--value <jednoliniowa wartość>]
  [--status <status>]

<skill_dir>/scripts/edit.mjs remove-bullet
  --file ./docs/plan/<plan>.md
  (--section <dokładna sekcja> | --work-package <WP<number>>)
  --id <nazwa>

<skill_dir>/scripts/edit.mjs answer-question
  --file ./docs/plan/<plan>.md
  --id Q<number>
  --answer <jednoliniowa odpowiedź>

<skill_dir>/scripts/edit.mjs add-question
  --file ./docs/plan/<plan>.md
  --id Q<number>
  --prompt <jednoliniowe pytanie>
  --status <open|answered>
  [--answer <jednoliniowa odpowiedź>]

<skill_dir>/scripts/edit.mjs edit-question
  --file ./docs/plan/<plan>.md
  --id Q<number>
  [--prompt <jednoliniowe pytanie>]
  [--status <open|answered>]
  [--answer <jednoliniowa odpowiedź>]

<skill_dir>/scripts/edit.mjs remove-question
  --file ./docs/plan/<plan>.md
  --id Q<number>

<skill_dir>/scripts/edit.mjs apply-operations
  --file ./docs/plan/<plan>.md
  --input ./plan-operations.json

# plan-operations.json
{
  "operations": [
    {"type": "edit-bullet", "work_package": "WP1", "id": "Goal", "value": "..."},
    {"type": "add-bullet", "section": "Risks and discovery debt", "id": "R7", "status": "low", "value": "..."}
  ]
}
```

`add-bullet` wymaga nowego identyfikatora, a `edit-bullet` i `remove-bullet`
wymagają identyfikatora istniejącego dokładnie raz. `--section` i
`--work-package` są wzajemnie wykluczające. Automatyczna flaga `--next` nie jest
obsługiwana: identyfikator nadaje wywołujący, dzięki czemu punkty nazwane nie
muszą być sztucznie numerowane. Pytania `Q<number>` są blokami z podpunktami
`Answer` i `Source`, więc obsługują je wyłącznie wrappery pytaniowe. `edit-question`
zmienia prompt, status i/lub odpowiedź (przejście do `answered` wymaga
odpowiedzi), a `remove-question` usuwa cały blok pytania.

`apply-operations` stosuje całą paczkę w pamięci na jednym odczycie, przerywa
całość przy pierwszym błędzie i zapisuje dokument raz — jedna logiczna poprawka
odpowiada jednej rewizji. Wynik domyślnie nie zawiera pełnego Markdowna.

`edit.mjs` wymaga kanonicznego pliku planu, jednoznacznego selektora i
zwalidowanego dokumentu. Brak albo duplikat sekcji, WP, punktu lub pytania kończy
operację bez zapisu. Po udanej transformacji zapis i frontmatter przechodzą
przez `<skill_dir>/scripts/store.mjs`; `--dry-run` wykonuje tę samą walidację bez
zapisu. Helper nie interpretuje dowolnego Markdowna i nie stosuje heurystycznego
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

`Direction, simplicity and consistency` jest zwięzłym, widocznym wynikiem
critical review. Zawiera dokładnie informacje potrzebne do obrony kierunku:

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

`review-cycle.mjs` przyjmuje przez JSON wyłącznie jawne dane ownera: werdykt,
liczniki, findings ze stabilnym ID/klasyfikacją/severity i liczbą prób naprawy,
rozstrzygnięcia wcześniejszych ID oraz artefakt delta. Wynik `delta-input` służy
jako wejście delta-review do ponownego `decide`. Brak albo sprzeczność
niezbędnych danych blokuje kolejną rundę; delta opisuje dokładnie jedną następną
rewizję i musi mieć różne hashe dokumentu bazowego i bieżącego. Helper nie ocenia
prawdziwości danych semantycznych.
