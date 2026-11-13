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
`$task-plan` (routing instrukcji użycia: `<skills_root>/task-plan/SKILL.md`), zamiast
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
wymagają identyfikatora istniejącego dokładnie raz. Punkt obejmuje wiersz z
nazwą i wszystkie kolejne wiersze wcięte, więc `edit-bullet` i `remove-bullet`
zmieniają albo usuwają go w całości, także gdy ma kilka wierszy lub podpunkty.
Wartość może być wielowierszowa: pierwszy wiersz trafia po `: `, a kolejne
helper wcina o dwie spacje, zachowując ich względne wcięcie. Selektor sekcji i selektor WP
wzajemnie się wykluczają. Nie ma automatycznej numeracji: identyfikator nadaje
wywołujący, dzięki czemu punkty nazwane nie muszą być sztucznie numerowane. Pytania `Q<number>` są blokami z podpunktami
`Answer` i `Source`, więc obsługują je wyłącznie wrappery pytaniowe. `edit-question`
zmienia prompt, status i/lub odpowiedź (przejście do `answered` wymaga
odpowiedzi), a `remove-question` usuwa cały blok pytania. Prompt i odpowiedź
mogą być wielowierszowe: kontynuację promptu helper wcina o dwie spacje, a
kontynuację odpowiedzi o cztery, pod podpunktem `Answer`. Kontynuacja promptu
nie może zaczynać się od `- Answer:` ani `- Source:`.

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
## Execution
## Work package summaries
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
```

Sekcje zapisuj w tej kolejności. `Execution` i `Work package summaries` są na
początku, aby czytelnik od razu widział postęp i zakres każdego WP.

### Preambuła i zwijane szczegóły

Bezpośrednio pod tytułem planu zapisz preambułę liczącą 3–5 pełnych zdań:
wspólny cel, docelowy rezultat i związek między pakietami. Nie zastępuj jej
listą kroków ani historią powstawania planu.

W nowym planie każda sekcja poza `Work package summaries` ma dokładnie jeden
zamknięty blok `<details>` (bez atrybutu `open`). Nagłówek `##` pozostaje
na zewnątrz. `Work packages` ma jeden wspólny blok dla wszystkich WP, bez
zagnieżdżonych bloków. Po wierszu zamykającym `summary` występuje dokładnie
jedna pusta linia, aby Markdown renderował listy i nagłówki:

```md
## Execution

<details>
<summary>Postęp wykonania</summary>

- [ ] WP1

</details>
```

`Work package summaries` pozostaje widoczną listą, bez bloku `details`.
Sekcja bez wpisów, np. po usunięciu ostatniego pytania albo ryzyka, zachowuje
wrapper: po `</summary>` zostaje jedna pusta linia, a następny wiersz zawiera
`</details>`. Edycja pustej sekcji nadal umieszcza nowe wpisy przed znacznikiem
zamykającym, również w paczce operacji usunięcia i dodania wpisu.
Parser i edytor nadal odczytują dotychczasowy format bez bloków; nie migruj
masowo istniejących planów. Znaczniki sekcji nie należą do pełnej treści WP
przekazywanej wykonawcy. Cała preambuła i szczegóły poza `Execution` należą
do treści objętej review.

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

`Observed symptoms` opisuje objaw w brzmieniu zgłoszenia: co zgłaszający zrobił
i co zobaczył. Techniczna interpretacja, np. klucz błędu albo kod odpowiedzi,
może go uzupełniać, ale nie zastępuje opisu zgłaszającego. W planie naprawczym
`Claims verified in evidence` przedstawia drogę od zgłoszonej czynności do
potwierdzonej przyczyny, a `Claims corrected or still unverified` wskazuje, której
części tej drogi nie potwierdzono.

Dla punktów dotyczących interakcji użytkownika `Requested outcome` opisuje
potrzebę użytkownika, a `Suggested diagnosis or solution` proponowaną
interakcję; hipotezy o celu użytkownika trafiają do
`Claims corrected or still unverified`.

Wpisy w `Decisions and open questions` mają dokładnie te formaty; walidator
odrzuca wpis `D`, `N` albo `Q` w innej postaci:

```md
- D1: <decyzja>
- Q1 [open]: <pytanie>
- Q2 [answered]: <pytanie>
  - Answer: <odpowiedź użytkownika>
  - Source: current conversation
- N1 [note]: <interakcja>; koszt: <koszt dla użytkownika>; podstawa: <źródło | fakt kodowy | hipoteza>; kierunek: <kierunek albo pytanie>
```

Znane pytanie zależne pozostaje `[open]`; jego treść nazywa przesłankę, np.
„Rozstrzygnięcie po Q1”. Zależność nie tworzy nowego statusu ani pola schematu.
Pytania rozstrzygnięte podczas intake przed pierwszym zapisem planu trafiają
do niego jako `[answered]`, z dosłowną odpowiedzią i `Source: current conversation`.
Jeśli odpowiedź usuwa potrzebę pytania zależnego, pomiń tę nieaktualną gałąź w
bieżącym planie; zachowaj rozstrzygnięcie, z którego wynika jej pominięcie.
Nie oznaczaj niezadanego pytania jako `[answered]` ani nie używaj pominięcia
gałęzi do usunięcia wymagania źródła bez decyzji użytkownika.

Uwagi `N<number> [note]` nie są pytaniami i nie blokują `ready`. Konflikt
zmieniający kryteria akceptacji zapisuj jako pytanie `Q<number> [open]`.

Wynik kontroli domenowej używa istniejących sekcji: znaczenie potwierdzone w
obecnym systemie trafia do `Claims verified in evidence` ze wskazaniem dowodu,
a sprzeczne lub niepotwierdzone znaczenie do `Claims corrected or still unverified`.
Uzgodnione znaczenie docelowe zapisuj jako decyzję albo odpowiedź w
`Decisions and open questions`. Jego konsekwencje muszą być zgodne w `Scope`
i `Acceptance criteria` odpowiednich WP. Nie twórz obowiązkowej sekcji słownika
w każdym planie.

Jeśli ustalenie wymaga utrwalenia w dokumentacji projektu, w `Scope` właściwego
WP podaj docelową treść lub referencję do uzgodnionego ustalenia oraz ścieżkę
dokumentu, a w `Acceptance criteria` obserwowalny wynik aktualizacji. Nową
ścieżkę oznacz jako miejsce utworzenia dokumentu, nie jako potwierdzony
istniejący plik. Decyzję dostępną już w ADR wskazuj odnośnikiem; nie kopiuj
jej pełnego uzasadnienia do planu.

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

### Pole `Verification: v1`

W nowym WP zapisz `Verification` jako blok, który oddziela trwałe testy od
jednorazowych checków (dzieci wcięte dwiema spacjami):

```md
- Verification: v1
  - Durable tests: Zaktualizuj istniejący test listy spraw w `tests/Case/CaseListTest.php` (funkcjonalny), aby sprawdzał komplet rekordów spełniających filtr.
  - One-off checks: W przeglądarce otwórz `/cases` jako koordynator i sprawdź, że menu kontekstowe wiersza pozwala otworzyć sprawę w nowej karcie (snapshot).
```

- `Durable tests` wymienia każdy test pozostający w repozytorium: regułę
  docelowego systemu, ścieżkę istniejącego testu do aktualizacji albo miejsce
  nowego testu oraz poziom (jednostkowy, integracyjny, funkcjonalny, e2e).
  Każdy wpis przechodzi bramkę „Trwałe testy a jednorazowa weryfikacja zmiany”.
- `One-off checks` wymienia jednorazowe sprawdzenia wykonawcze: komendę albo
  kroki i oczekiwany wynik.
- Jedno z pól może mieć wartość `none`, oba — nie.
- Gdy wynik kryterium akceptacji widać tylko w wyrenderowanej aplikacji
  (układ, fokus, interakcja JavaScript, stan komponentu po akcji), `One-off
  checks` zawiera check w przeglądarce według
  `<skills_root>/_shared/references/playwright-cli-verification.md`: trasę lub
  URL, rolę, kroki i rodzaj dowodu (snapshot, screenshot albo eval). Trwały test
  e2e takiego zachowania trafia do `Durable tests` tylko po przejściu bramki
  trwałości.

Gdy choć jeden WP używa `Verification: v1`, walidacja wymaga go we wszystkich
WP. Plan z samymi polami jednowierszowymi pozostaje ważny; nie migruj go
masowo, ale każde nowe WP zapisuj już w formacie `v1`.

### Ocena trudności work package

W nowym planie uzupełnij każdy WP o jawną ocenę trudności według stałej rubryki.
Ocena jest planistycznym oszacowaniem zakresu poznania i koordynacji, a nie
miarą „inteligencji” wykonawcy ani rankingiem modeli. `Estimated size` nadal
opisuje ilość pracy i pozostaje parametrem odrębnym od poziomu trudności.

Rubryka ocenia cztery kategorie, każda w skali 0–2:

| Kategoria | 0 | 1 | 2 |
| --- | --- | --- | --- |
| `Dependencies` | jeden właściciel zmiany | kilka znanych elementów kontraktu | koordynacja wielu kontraktów |
| `Logic` | zmiana mechaniczna | kilka rozstrzygniętych gałęzi | współbieżność, retry, idempotencja |
| `Discovery` | brak rozpoznania | lokalny szczegół do potwierdzenia | śledzenie kilku znanych mechanizmów |
| `Verification` | bezpośredni check | test integracyjny | zachowanie czasowe lub rozproszone |

Suma punktów 0–2 oznacza proste (`simple`), 3–4 umiarkowane (`moderate`),
5–6 trudne (`hard`), 7–8 bardzo trudne (`very-hard`). Autor zapisuje oceny,
poziom i uzasadnienie. Poziom nie wyznacza profilu wykonawcy ani progu benchmarku.

Ryzyko (`Risk floor`) podnosi minimalny poziom, ale nigdy nie obniża poziomu
wynikającego z sumy:

- `none` — bez podwyższenia;
- `authorization` albo `irreversible-migration` — co najmniej `hard`;
- `concurrent-financial` — `very-hard`.

Autor i reviewer wybierają najwyższe właściwe minimum ryzyka na podstawie
zakresu WP. Walidator odczytuje jawny `Risk floor`, nie interpretuje prozy.
Nierozstrzygnięta decyzja albo nieznana przyczyna błędu nadal blokuje
`ready` i nie dodaje punktów trudności.

Ocenę bloku można sprawdzić poleceniem:

```bash
node <skills_root>/_shared/scripts/task-plan/difficulty.mjs assess --body - <<'WP'
<pełna treść WP z blokiem Difficulty: v1>
WP
```

Wynik zawiera tylko `score` i `level`. Dawna konfiguracja
`./.agents/config/task-plan-difficulty.json` nie jest odczytywana i nie wpływa
na ocenę ani walidację planu; nie wymaga migracji plików konsumenta.

Dokładny blok w WP (dzieci zapisuj wcięciem dwóch spacji; `Level` musi
odpowiadać wyliczonemu poziomowi, a każda kategoria i `Rationale` wymagają
konkretnego uzasadnienia):

```md
- Difficulty: v1
  - Dependencies: 0 — Jeden właściciel zmiany.
  - Logic: 1 — Kilka rozstrzygniętych gałęzi.
  - Discovery: 2 — Śledzenie kilku znanych mechanizmów.
  - Verification: 1 — Test integracyjny kontraktu.
  - Risk floor: none
  - Level: moderate
  - Rationale: Suma 4 wynika z integracji znanych mechanizmów i gałęzi.
```

Przykłady minimalnego poziomu wymuszonego przez ryzyko:

```md
- Difficulty: v1
  - Dependencies: 1 — Zmiana uprawnień dotyka znanego kontraktu.
  - Logic: 0 — Zmiana mechaniczna.
  - Discovery: 0 — Brak rozpoznania.
  - Verification: 1 — Test integracyjny uprawnień.
  - Risk floor: authorization
  - Level: hard
  - Rationale: Suma 2 wymaga podniesienia do hard przez ryzyko uprawnień.
```

```md
- Difficulty: v1
  - Dependencies: 1 — Przepływ płatności ma znane elementy kontraktu.
  - Logic: 2 — Współbieżne obciążenia konta wymagają idempotencji.
  - Discovery: 0 — Brak rozpoznania.
  - Verification: 2 — Test przeplotu równoczesnych obciążeń konta.
  - Risk floor: concurrent-financial
  - Level: very-hard
  - Rationale: Suma 5 wymaga podniesienia do very-hard przez współbieżne operacje finansowe.
```

Gdy choć jeden WP deklaruje `Difficulty:`, walidacja wymaga poprawnego bloku `v1`
we wszystkich WP. Plan bez żadnego bloku pozostaje ważny w starym formacie;
nie migruj istniejących planów masowo, ale każde nowe WP zapisuj już z oceną.

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
  weryfikacja zmiany” i format „Pole `Verification: v1`”.
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
ją na weryfikację i szukaj rzeczywistej przyczyny symptomu. Mechanizm realizuje
wymagane zachowanie dopiero wtedy, gdy usuwa objaw w brzmieniu zgłoszenia, a
dowody planu nie pokazują stanu, który zgłaszający uznał za błędny. Jeżeli nie da
się tego rozstrzygnąć, zastosuj test wpływu discovery debt opisany w critical
review.

### Dobór profilu wykonania

`Estimated size` jest szacunkiem planistycznym przekazywanym wykonawcy. Nie
steruje batchingiem ani trwałym stanem wykonania.

Wybierz najniższy wciąż w pełni wystarczający profil z
`./.agents/config/model-hierarchy.json`. Para model i reasoning jest jednym
profilem; kolejność `strongest-to-weakest` określa możliwości według projektu,
nie ceny. Nie przestawiaj jej na podstawie benchmarków.

Decyzję podejmuje agent planujący, nie punktowy selektor:

1. Oceń rozumowanie pozostawione wykonawcy po uwzględnieniu planu i potwierdzonego
   kontekstu: odtwarzanie wzorca albo projektowanie, współzależność kontraktów,
   pułapki stanu i czasu oraz błędy niewidoczne w bezpośrednim teście. Wystarczalność
   obejmuje całe `Scope`, kryteria akceptacji i weryfikację, bez przejmowania
   trudnych fragmentów przez agenta głównego.
2. Rozpatruj profile od dołu hierarchii. Wybierz pierwszy, po którym można
   rozsądnie oczekiwać samodzielnego wykonania bez rażących błędów, na podstawie
   wymagań WP i dostępnych danych o możliwościach modeli. `Difficulty.Level`,
   `Estimated size` i wynik benchmarku są sygnałami, nie progami dopuszczenia.
3. Uzasadnij granicę wyboru: dlaczego profil wystarczy i dlaczego bezpośrednio
   niższy kandydat jest zbyt ryzykowny. Gdy wybierasz najniższy, wyjaśnij, dlaczego
   obejmuje wymagania całego WP. Nie uzasadniaj wyboru samą nazwą modelu,
   przekroczeniem wyniku punktowego ani założeniem, że review naprawi błędy.
4. Przy istotnej niepewności co do konkretnego wymagania wybierz wyższy profil
   i nazwij powód. Gdy żadnego dostępnego profilu nie można uzasadnić, zapytaj
   użytkownika o świadomy wybór albo zmianę zakresu; nie uznawaj automatycznie
   najwyższego za wystarczający.

#### Evidence dotyczące profili

Dla nowego doboru odczytaj aktualne dane AICodingDaily przez wspólną granicę:

```bash
node <skills_root>/_shared/scripts/model-leaderboard.mjs entries
```

Etykieta wiersza ma postać `Model (Reasoning) — Harness`: ten sam model jest
oceniany osobno w każdym harnessie, więc porównuj wiersze harnessu, w którym WP
będzie wykonany. Wiersze i HTML pozostają wyłącznie w pamięci, bez cache, sidecara, pliku
tymczasowego ani fixture prawdziwej strony. Nie używaj do tego odczytu narzędzia
automatycznie zapisującego odpowiedź. Testy odczytu używają danych syntetycznych.
Jeden odczyt może wspierać dobór kilku WP w tej samej fazie planowania;
nie wykorzystuj historycznego uzasadnienia jako świeżego odczytu przy nowym doborze.

Gdy danych brakuje, są sprzeczne albo ogólny wynik nie rozstrzyga istotnej
kompetencji, doczytaj adekwatne źródło, nie wszystkie rankingi dla każdego WP:

- AICodingDaily: https://aicodingdaily.com/leaderboard — wyniki zadań kodowych;
- Artificial Analysis: https://artificialanalysis.ai/leaderboards/models — wyniki rozumowania i programowania; interpretuj je według https://artificialanalysis.ai/methodology/intelligence-benchmarking, nie tylko ogólnego indeksu;
- SWE-bench: https://www.swebench.com/ — zmiany i naprawy w istniejących repozytoriach;
- Terminal-Bench: https://www.tbench.ai/ — wieloetapowa praca agentowa z narzędziami.

Porównuj tę samą wersję modelu i reasoning; uwzględnij wersję benchmarku,
agenta, narzędzia oraz pojedynczą próbę versus wielokrotne próby. DeepSWE jest
modelem/agentem, nie benchmarkiem. Brak dopasowanego wyniku albo niedostępność
źródła to ograniczenie evidence, nie automatyczna dyskwalifikacja profilu ani
dowód jego wystarczalności. Nie wymyślaj wyników i nie agreguj różnych skal
w nowy wynik punktowy; zastosuj ocenę niepewności z procedury wyboru powyżej.

Zapisz raz w `Execution environment` pole `Profile evidence`: użyte źródła
i daty odczytu, istotne ustalenia dla porównywanych profili oraz ograniczenia,
albo jawny brak dostępnych danych. To krótki opis podstaw decyzji, nie kopia
rankingu ani tabela wszystkich modeli. Odpowiedź użytkownika odnotuj przez
referencję do decyzji planu.

#### Krótkie uzasadnienie WP

Bezpośrednio po `Difficulty: v1` zapisz `Profile rationale` jako 1–3 zdania
uzasadniające granicę wyboru. Nie powtarzaj modelu, reasoning, URL-i, dat,
punktów i list nieocenionych profili; konkretne pary należą do środowiska,
a źródła do wspólnego `Profile evidence`. Odsyłaj do źródła tylko gdy rozstrzyga
wybór tego WP. Przykład dla najniższego profilu:

```md
- Profile rationale: Najniższy profil wystarcza, ponieważ zmiana odtwarza istniejący wzorzec prezentacji i nie wymaga projektowania ani koordynacji niezależnych kontraktów.
```

Walidator nie ocenia semantyki tego pola; jego obecność, wystarczalność wyboru
i zgodność z przypisaniem w `Execution environment` ocenia review planu.
W `Execution environment` ustaw jako default najniższy z wybranych profili,
a dla wszystkich WP z innym wyborem zapisz override z dokładnym modelem
i reasoning. Każdy WP musi dostać swój wybrany profil, nie przypadkowo default.

Brak konfiguracji, duplikat albo profil przypisany w `Execution environment`
spoza hierarchii blokuje walidację;
nie zgaduj ani nie dopisuj profilu. Konfigurację hierarchii opisuje
`<skills_root>/plan-execute/SKILL.md`. Dotychczasowe plany, także z rozbudowanym
uzasadnieniem punktowym, pozostają czytelne bez migracji ani ponownego doboru;
nowy lub materialnie zmieniony wybór uzasadniaj już według tej procedury.

## Kolejność i pokrycie źródła

Kolejność WP w dokumencie jest kolejnością wykonania. Sekcja
`Order` może krótko uzasadnić kolejność wykonania, ale nie jest wejściem do
osobnego grafu ani mechanizmu batchowania.

`Source coverage` mapuje każdy punkt źródła do WP. Po odpowiedzi użytkownika
punkt może zamiast tego otrzymać krótkie, uzasadnione `excluded`. Nie twórz WP
dla samej ceremonii procesu. Format punktu:

```md
- S1: <punkt źródła> → WP1, WP2
- S2: <punkt źródła> → excluded: <uzasadnienie>
```

## Streszczenia WP

`Work package summaries` zawiera dokładnie jeden wpis na WP, w kolejności
dokumentu, z tytułem identycznym z nagłówkiem WP:

```md
## Work package summaries

- WP1 — <tytuł WP>: <streszczenie prostym językiem>
```

Ta sekcja jest przeglądem dla człowieka, nie instrukcją wykonania. Wykonawca
realizuje pełny WP z `Work packages`, z jego granicami, kryteriami akceptacji
i weryfikacją; streszczenie nie zastępuje tego WP.

Streszczenie mówi wyłącznie, co WP zmienia i jaki daje rezultat. Jest wierne
`Goal` i `Scope`, nie przeczy `Out of scope` i nie opisuje wyłączeń ani nie dodaje wymagań,
których WP nie zawiera. Wiersz może być kontynuowany wcięciem. Streszczenie
należy do treści objętej review: jego zmiana, jak każda zmiana poza
`## Execution`, wycofuje potwierdzenie `ready`. Po zmianie WP zaktualizuj jego
streszczenie w tej samej rewizji.

Streszczenie WP, który naprawia zgłoszony błąd, nazywa ten błąd tak, jak widzi go
zgłaszający, i krótko wyjaśnia jego przyczynę, jeżeli bez niej czytelnik nie
zrozumie, dlaczego zmiana usuwa problem. Przykład: „Dodanie kilku pól naraz
kończyło się błędem, bo klawisz Backspace usuwał pole używane przez sprawy”.

Odbiorcą streszczenia jest człowiek, który zna cel projektu, ale nie zna kodu
ani rozmowy, z której powstał plan. Ma on z samego streszczenia zrozumieć, co
się zmieni i jaki będzie rezultat. Granice pozostają w pełnym WP. Zasady pisania:

- Pisz prostym, naturalnym językiem, tak jak opowiadasz o pracy osobie spoza
  zespołu. Opisuj rezultat widoczny dla użytkownika lub zespołu, a nie kroki
  implementacji.
- Długość dopasuj do treści WP. Nie skracaj opisu do haseł i nie upychaj kilku
  myśli w jednym zdaniu tylko po to, aby był krótszy. Prosty WP może mieć jedno
  zdanie, złożony — akapit. Nie powtarzaj natomiast szczegółów z `Scope`, które
  nie pomagają zrozumieć zakresu.
- Nie używaj ścieżek, nazw klas, metod, komend ani zapisu kodowego. Nie odsyłaj
  do identyfikatorów planu, np. `S1`, `Q3`, `AC2`, `C1`. Ten zakaz jest
  wyjątkiem od zasady zapisu kodowego z sekcji „Język planu”.
- Pojęcie techniczne stosuj tylko wtedy, gdy bez niego nie da się opisać
  rezultatu, i objaśnij je kilkoma słowami przy pierwszym użyciu.
- Pisz pełnymi zdaniami, jedna myśl na zdanie. Nie używaj ukośników zamiast
  spójników ani nawiasów z dopowiedzeniami.

Przykład dla tego samego WP. Antywzorzec służy wyłącznie do pokazania formy
odrzucanej; nie kopiuj go do planu.

**Antywzorzec — forma odrzucana (nie kopiować):**

> WP2 — Uprawnienia sesji: mapowanie `permission` → `tools`/`disallowedTools`
> w `.claude/settings.json` + sandbox (Q4), bez zmian w `opencode.jsonc`.

**Wzorzec docelowy:**

> WP2 — Uprawnienia sesji: Claude Code dostaje własne, proste reguły tego, co
> agent może robić bez pytania użytkownika, na przykład czytać pliki i
> uruchamiać testy. Ryzykowne operacje wymagają potwierdzenia.

## Kontrakt środowiska i wykonania

Każdy plan gotowy do implementacji zawiera rekomendowane środowisko oraz prosty,
binarny kontrakt wykonania. Nie zapisuje stanów sesji, batchy ani przejść
pośrednich.

Minimalny format (`## Execution` otwiera dokument, `## Execution environment`
go zamyka):

```md
## Execution

<details>
<summary>Postęp wykonania</summary>

- [ ] WP1
- [ ] WP2

</details>

## Execution environment

<details>
<summary>Środowisko wykonania</summary>

- Default model: provider/model
- Default reasoning: concrete-level
- WP overrides: none
- Profile evidence: <źródła i daty odczytu, istotne ustalenia oraz ograniczenia doboru>

</details>
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

## Publikacja do czytania

Kanoniczny plik `docs/plans/<plan-id>.md` pozostaje lokalnym wejściem wykonania.
`docs/plans/issue-<number>/plan.md` jest jednokierunkową kopią merytoryczną,
oznaczoną stabilnym nagłówkiem z pełnym URL issue i ID oryginału. Nie jest nowym
review, potwierdzeniem świeżo wykonanych testów ani wejściem `plan-execute`.
Daty i Execution pochodzą z oryginału; kolejne wersje przechowuje Git.

Task-plan udostępnia cienką fasadę `publish.mjs`; jedyna implementacja jest w
`_shared/scripts/task-plan/publication.mjs`. Przykład dla syntetycznego issue,
uruchamiany z root repo (zastąp `<plan-id>` ID istniejącego kanonicznego planu):

```bash
node <skills_root>/task-plan/scripts/publish.mjs bind --path docs/plans/<plan-id>.md --issue https://github.com/owner/repo/issues/123
node <skills_root>/task-plan/scripts/publish.mjs assess --path docs/plans/<plan-id>.md --input - <<'JSON'
{"confirm_current_inputs":true,"sources":[],"summaries":[],"replacements":[],"materials":[]}
JSON
node <skills_root>/task-plan/scripts/publish.mjs check --path docs/plans/<plan-id>.md
node <skills_root>/task-plan/scripts/publish.mjs publish --path docs/plans/<plan-id>.md
```

Wszystkie operacje przyjmują opcjonalne `--root <repo>`; `--input -` to JSON na
stdin, a `--input <file>` odczytuje plik. `check` sprawdza komplet wejść,
renderowanie i rzeczywiste wyniki bez zapisu. Pusta ocena powyżej jest właściwa
tylko wtedy, gdy plan nie ma raportów wymagających oceny ani nierozstrzygniętych
lokalnych odniesień. Nie uruchamia modelu ani nie fabrykuje treści z hashy.
`bind` jest jawne także dla GitHub; inne repo/issue niż źródło GitHub to konflikt.
Źródła file/user zachowują `source_identity` przy jawnym wyborze issue.

### Wejście oceny

Owner ocenia wyłącznie bezpośrednie raporty odbioru i lokalne referencje planu,
bez rekurencyjnego zbierania ich zależności. Wynik jest gotowym tekstem, a nie
poleceniem dla kolejnego modelu. Wszystkie cztery tablice są wymagane:

- `sources`: `{path, disposition, status, reason}`. `disposition` to `omitted`,
  `summary` albo `material`; nawet pominięty duplikat ma hash aktualnych bajtów.
- `summaries`: `{text, status, source_paths, wp_id?}`. Gotowe unikalne ustalenia
  trafiają do odpowiedniego WP, a ustalenia ogólne do planu; nie powielaj ADR.
- `replacements`: `{reference, text, status, source_paths, wp_id?}`. `reference`
  wskazuje dosłowny lokalny odnośnik lub jego repo-relative ścieżkę, `text`
  zawiera gotowy wynik lub znany odnośnik do wersjonowanego upstreamu. Nie
  zgaduj upstreamu ignorowanych synchronizowanych profili. Nierozstrzygnięte
  odnośniki blokują renderowanie zamiast usuwać zdanie z uzasadnieniem.
- `materials`: `{name, source_path, kind:"report", text, status, source_paths,
  wp_id?, duplicate:false, available_in_project:false, technical:false,
  justification:{essential, unique, summary_insufficient}}`. Wszystkie trzy
  uzasadnienia są niepustym tekstem: istotność dla rozumienia, brak duplikacji w
  planie/projekcie/upstreamie oraz niewystarczalność krótkiego streszczenia.
  Materiał źródłowy musi występować w `sources` jako `material`.

`status` każdego ustalenia i źródła to `current`, `historical` albo
`requires-reassessment`. `source_paths` wskazują wpisy z `sources`. Dokumenty
dodatkowe mają płaskie nazwy Markdown inne niż `plan.md`, `README.md` i
`plan.original.md`; zduplikowane nazwy są błędem. Normy, skille, kod, techniczne
manifesty, stan sesji i surowe QA nie są materiałami do kopiowania. Istotne
uzasadnienie raportu można streścić bez kopiowania raportu. Przykłady fenced
code są zachowywane jako przykłady, nie jako zamówienie pobrania plików.

### Jeden lokalny rekord i aktualność

`var/agent/task-plan/<plan-id>/publication.json` jest jedynym lokalnym stanem
publikacji (nie w cache). Zawiera `schema_version`, `rules_version`, `plan`,
`issue`, `assessment` (hash całego planu, reguł, selekcję/gotowe teksty i hashe
ocenionych źródeł), `outputs` (ostatnie hashe zarządzanych wyników) i `intent`
(stare/oczekiwane hashe przerwanego zapisu albo `null`). Nie zawiera kopii planu,
raportów, historii rund ani inwentarza cache. `bind`/`assess` zachowują wyniki i
zamiar publishera; ponowna ocena nie legalizuje ręcznej edycji publikacji.

`confirm_current_inputs:true` jawnie potwierdza aktualny plan, reguły, wybór i
źródła. Każda zmiana tych wejść unieważnia ocenę, również zmiana front matter,
wspólnej decyzji i raportu przy nadal zaznaczonym WP. Owner może zachować ten
sam tekst, potwierdzając nowe hashe. Oceniaj końcowe bajty po review i
`complete-wp`; błąd oceny nie cofa poprawnego odbioru. Przy otwarciu WP dawne
ustalenia oznacz historycznie, a po ponownym zamknięciu potwierdź/skoryguj je dla
nowych kryteriów. Niezmienione wejścia nie wymagają ponownej selekcji.

### Odświeżanie i konflikty

Publish nie zmienia oryginału, pointerów, issue ani brancha, niczego nie usuwa,
nie stage'uje i nie commituje. Nie wymaga `ready` i dostępności technicznych
artefaktów walidatora, ale wymaga merytorycznych źródeł objętych oceną. Brak
źródeł po checkoutcie pozostawia snapshot czytelny i nietknięty. Brak rekordu
przy istniejącej publikacji, inne issue/plan lub ręczna zmiana zarządzanych
bajtów wymaga jawnego uzgodnienia użytkownika — bez automatycznej adopcji,
rekonstrukcji i `force`. Publikacja nie staje się drugim planem do edycji.

Kontrola obejmuje rzeczywiste bajty, ścieżki bez symlinków/traversal, reguły Git
i wspólny heurystyczny detektor sekretów (nie jest on dowodem braku wszystkich
sekretów). Identyczne pliki nie są zapisywane. Materiały powstają przed atomową
podmianą `plan.md`. Po błędzie ponowienie kończy tylko zapis zgodny ze starymi
lub oczekiwanymi hashami `intent`; obce bajty blokują wznowienie. Po twardym
przerwaniu pozostawiona blokada wymaga potwierdzenia, że writer już nie działa,
i osobnego uzgodnienia — nie jest automatycznie przejmowana. Materiały, które
wypadły z selekcji, pozostają na dysku, ale nowy plan ich nie linkuje.

Git konsumenta powinien ignorować `/docs/plans/*` z wyjątkiem
`!/docs/plans/issue-*/`, zachowując lokalne drafty i `var/agent/`. Ignorowany
wynik kończy publish błędem z poleceniem korekty `.gitignore`, nie `git add -f`.

Przygotowanie commita używa `refresh-for-commit [--path <plan>]`: jawna ścieżka
z bieżącego zlecenia ma pierwszeństwo, inaczej odczytywany jest istniejący
pointer plan-execute. Bez pointera lub jego jawnego powiązania publikacja jest
pomijana; inne plany nie są szukane. Błędy zatrzymują commit przed stagingiem,
a nieaktualna ocena wraca do ownera, bez streszczania przez commit. Wygenerowane
zmiany obejmuje istniejąca akceptacja delty. Kolejność i staging pozostają
własnością [git-commit](../../git-commit/SKILL.md), a odbiór WP —
[plan-execute](../../plan-execute/SKILL.md).

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
| `full_review_count` | zawsze | Liczba pełnych review, co najmniej `1`. Pierwsza runda jest pełna; kolejne pełne review zwiększa ten licznik. |
| `delta_review_count` | zawsze | Liczba delta-review, co najmniej `0`. Suma `full_review_count + delta_review_count` to numer rundy i nie może przekroczyć `4`. Zakres nie resetuje budżetu. |
| `review_scope` | nowe żądania | `full` albo `delta`: zakres bieżącego review. Pierwsza runda wymaga `full`; kolejne pełne review wymaga co najmniej dwóch w `full_review_count`, delta wymaga co najmniej jednego w `delta_review_count`. Starsze wejście bez pola oznacza `delta`, gdy `delta_review_count > 0`, inaczej `full`. |
| `review_scope_reason` | nowe żądania review | Krótkie uzasadnienie zakresu zapisane przez ownera w powiązanym żądaniu; helper nie ocenia jego treści. Zmiana kierunku, ownership, modelu danych, zachowania publicznego, kryteriów akceptacji lub granic, zależności czy kolejności WP wymaga `full`; lokalna korekta wymaga `delta`. |
| `plan` | pierwsza runda (suma liczników `1`) | Obiekt `plan_id`, `revision`, `content_sha256` przeglądanej rewizji; brak albo `null` w pierwszej rundzie jest błędem `MISSING_PLAN_REFERENCE`. W kolejnych rundach opcjonalny, ale jeśli jest, musi zgadzać się z `plan_id`, `current_revision` i `current_sha256` z `delta_review` (`PLAN_REFERENCE_CONFLICT`); bez niego helper bierze te wartości z `delta_review`. |
| `findings` | zawsze (może być pusta) | Findings bieżącego review. Każdy ma unikalne `id` w formacie `F<number>`, `classification` (`finding`, `QUESTION` albo `SUGGESTION`), jawne `actionable` (boolean) oraz `repair_attempts` (liczba całkowita ≥ 0). |
| `findings[].severity` | `finding` | `BLOCKER`, `MAJOR` albo `MINOR` dla `classification: finding`; dla `QUESTION` i `SUGGESTION` brak albo `null`. `BLOCKER` i `MAJOR` nie mogą być nieactionable bez `accepted_decision_ref`. |
| `findings[].approval_affecting` | `QUESTION` | Boolean. Pytanie nie jest `actionable`; approval-affecting `QUESTION` blokuje nawet przy `PLAN READY`. `SUGGESTION` nigdy nie jest actionable. |
| `findings[].accepted_decision_ref`, `requires_user_decision`, `requires_external_evidence` | opcjonalne | Niepusty string z odwołaniem do decyzji użytkownika albo booleany. Odwołanie wyłącza finding z listy actionable; flagi blokują naprawę. |
| `findings[].previous_id`, `recurrence` | gdy finding wiąże się z wcześniejszym ID | `previous_id` wskazuje ID z `previous_findings`. Towarzyszy mu `recurrence`: `same_failure_mode` i `new_evidence` (booleany); `new_evidence: true` wymaga niepustego `evidence`. Ten sam failure mode zachowuje poprzednie ID, inny failure mode dostaje nowe. |
| `findings[].provenance` | nowy actionable finding w delta-review | `kind` (`changed_section`, `changed_work_package` albo `direct_dependency`), `target` z zadeklarowanego zakresu delta oraz niepusty `evidence`. Hashe dokumentów nie zastępują pochodzenia. |
| `previous_findings` | zawsze (może być pusta) | Wcześniejsze findings: `{id, severity}` albo, dla pytania, `{id, classification: "QUESTION"}` bez severity. W pierwszej rundzie pusta. Review otwierające nowy cykl po decyzji końcowej przenosi nierozwiązane findings i pytania albo ma pustą listę po `finish-ready`; używa licznika `1+1` dla delta albo `2+0` dla full, licząc zapisaną bazę jako pierwszą rundę. Od trzeciej rundy lista musi być niepusta (`EMPTY_PREVIOUS_FINDINGS`). |
| `previous_resolutions` | zawsze (może być pusta) | Dokładnie jedno rozstrzygnięcie na każde wcześniejsze ID; brak to `MISSING_PREVIOUS_RESOLUTION`. Statusy: `resolved`; `current` z `current_severity` zgodnym z bieżącym findingiem; `accepted` z `decision_ref`. Wcześniejsze pytanie można rozstrzygnąć wyłącznie jako `accepted` z `decision_ref: Q<number>`. |
| `coverage` | niezależne zewnętrzne pełne review; opcjonalne w pozostałych wejściach | Tablica wpisów według sekcji poniżej; pochodzi wyłącznie z payloadu reviewera i jest zachowana w decyzji. |
| `reviewer` | opcjonalne | Kto wykonał review: `{mode: "self"}` albo reviewer z wyniku `review-session-job.mjs accept` (`mode: "external"`, `attempt`, `provider`, `model`, `thinking`). Brak oznacza `self`. Decyzja z `ok=true` zwraca je w polu `reviewer`. |
| `delta_review` | suma liczników ≥ 2 | Obiekt z `delta-input --file` także przy ponownym pełnym review; w pierwszej rundzie jest błędem. Pełne review używa go do powiązania rewizji i wcześniejszych ID, bez ograniczenia zakresu. Zawiera `plan_id`, `base_revision`, `current_revision`, `base_sha256`, `current_sha256`, `changed_sections`, `changed_work_packages`, `previous_finding_ids` i `allowed_direct_dependencies`. Wymaga co najmniej jednej zmienionej sekcji lub WP, różnych hashy i `previous_finding_ids` zgodnych z `previous_findings`. |

Na czwartej rundzie bez actionable findings wolno zakończyć `finish-ready`.
Actionable findings na czwartej rundzie dają `blocked` z
`review-budget-exhausted`, bez automatycznej piątej rundy. Ocena postępu,
nawrotów i pogorszenia wcześniejszych findings dotyczy każdego kolejnego review,
także pełnego. Tylko `delta` ogranicza nowe findings do poprawki i jej zależności;
pełne review może zgłosić niezależny defekt bez provenance z poprawki.

Po review w osobnej sesji wejście buduje `review-cycle.mjs ingest --result
<result.json> --request <review-request.json>`. Żądanie musi być powiązanym
wejściem sesji z niezmienionym hashem (`EXTERNAL_REQUEST_UNBOUND`); z raportu
reviewera pochodzą `verdict`, `findings` i podane `coverage`, a w delta-review także
`previous_resolutions`. Po niezależnym pełnym review rozstrzygnięcia wcześniejszych
ID i mapowanie tożsamości dostarcza owner przez `--reconciliation`, bez zmiany
ocen reviewera. Kontrakt i przykład zawiera
`<skills_root>/task-plan/references/external-plan-review.md`. Pozostałe pola
i `reviewer` pochodzą z żądania i wyniku `accept`. Procedurę opisuje
`<skills_root>/task-plan/SKILL.md`.

### Pokrycie niezależnego pełnego review

`coverage` zawiera co najmniej jeden wpis dla każdego obszaru:

- `source_coverage`: wymagania i ograniczenia odtworzone ze źródła, ich pokrycie;
- `scope_justification`: zasadność działań i kontroli planu;
- `critical_assumptions`: założenia mogące zmienić zakres, granice lub odbiór,
  sprawdzone w rzeczywistym mechanizmie i jego istotnych wejściach/odbiorcach;
- `wp_dependencies`: zależności, kolejność i poprawność stanów pomiędzy WP;
- `execution_verification`: wykonalność oraz związek kryteriów z kontrolami.

Każdy wpis ma `area`, niepusty `subject`, `outcome` i tablicę `evidence`
(referencje do konkretnego źródła, fragmentu, symbolu lub wyniku kontroli).
`outcome` to `REVIEWED`, `FINDING`, `NOT_RELEVANT` albo `NOT_COVERED`:

- `REVIEWED` i `FINDING` wymagają niepustego `scenario` oraz co najmniej jednej
  niepustej referencji w `evidence`;
- `NOT_RELEVANT` wymaga niepustego `reason` uzasadniającego pominięcie;
- `NOT_COVERED` wymaga niepustego `gap` oraz boolean `material`: czy luka wpływa
  na gotowość. Istotna luka wyklucza `PLAN READY` i `PLAN READY WITH CAVEAT`;
- w pozostałych wynikach `gap` jest pominięte albo `null`.

```json
{
  "area": "critical_assumptions",
  "subject": "Wspólna walidacja obejmuje import",
  "outcome": "REVIEWED",
  "scenario": "Import ujemnej kwoty dochodzi do wspólnej walidacji przed zapisem",
  "evidence": ["src/Import/Handler.php:42", "src/Order/Validator.php:18"],
  "gap": null
}
```

Wpisów może być wiele na obszar. Oddziel wymagania, krytyczne założenia lub WP,
gdy różnią się scenariuszem albo wynikiem. Markdown korzysta z tych samych wpisów;
nie twórz drugiej niezależnej ewidencji. Helper sprawdza kompletność i spójność
deklaracji przy `accept-session` i ponownie przy `ingest`, nie prawdziwość dowodów
ani semantyczną kompletność tematów. To pozostaje obowiązkiem ownera.
W starszych wynikach bez `independent_full_review: true`, delta-review i self-review
pole jest opcjonalne; niepuste pole jest walidowane również w `decide`, a pusta
tablica lub `null` oznacza brak pola. Niezależne pełne review wymaga niepustego
`coverage` zawsze.

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

Źródło jest przechowywane pod `var/agent/task-plan/<plan-id>/source.json` względem
repozytorium konsumenta. Jawny `context` zwykłego zapisu promuje raport i kryteria
do `var/agent/task-plan/<plan-id>/evidence/<set-id>/report.json` oraz `criteria.json`.
`set-id` jest SHA-256 pary pełnych hashy plików z jawnym znacznikiem nieobecności.
Magazyn sprawdza ścieżki i oczekiwane hashe, zapisuje identyczne bajty atomowo bez
nadpisywania istniejących kopii i weryfikuje komplet przed publikacją dokumentu
pod istniejącą blokadą i tokenem bazy. Identyczna kopia jest używana ponownie;
sprzeczna kończy zapis błędem. Wszystkie te katalogi są niezależne od `CACHE_PATH`.

`COMPLETE` wymaga obu plików. `INCOMPLETE` i `BLOCKED` zachowują status i wszystkie
dostarczone referencje. `NOT_REQUIRED` nie ma referencji i nie tworzy zestawu.
Bez nowego `context` zapis zachowuje dotychczasowe referencje i ich walidację;
nie wyszukuje ani nie naprawia artefaktów. Istnienie oraz hashe referencjonowanych
kopii pozostają obowiązkowe. Starszych zestawów nie usuwa commit ani ukończenie WP.
Błąd kopiowania lub publikacji pozostawia poprzedni dokument; nieprzywołana kopia
może pozostać i jest sprawdzana przy ponowieniu. Trwałość lokalna nie jest backupem.

`store.mjs` jest właścicielem front matter. Poza polami źródła i kontekstu zapisuje:

| Pole | Wartość |
| --- | --- |
| `previous_sha256` | SHA-256 bajtów poprzedniej rewizji; `null` dla rewizji 1. Zwracane też jako `previous_sha256` w wyniku `save`, `edit` i `complete-wp`. |
| `reviewed_revision` | Rewizja, dla której zapisano decyzję `finish-ready`; `null` przed review. |
| `reviewed_body_sha256` | SHA-256 treści planu bez sekcji `## Execution` w chwili review; `null` przed review. |
| `review_base_revision` | Rewizja objęta ostatnią zapisaną decyzją review (dowolne `action`); baza następnego delta-review; `null` przed review. |
| `review_base_sha256` | SHA-256 bajtów dokumentu, który oceniło ostatnie zapisane review; `null` przed review. |
| `review_reviewer` | Kto wykonał ostatnie zapisane review: `self` albo `external:<attempt>:<provider>/<model>/<thinking>`; `null` przed review. Przechodzi do kolejnych rewizji razem z `review_base_*`. |

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
