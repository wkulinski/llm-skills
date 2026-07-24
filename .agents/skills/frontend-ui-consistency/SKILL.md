---
name: frontend-ui-consistency
description: Konsultuje, audytuje, uspójnia, modyfikuje i tworzy elementy istniejącego interfejsu na podstawie jego wzorców. Używaj także do opiniowania widoków i proponowania zmian przed implementacją. Chroni kontrakty Twig, Symfony UX Live Components i Stimulus oraz wymaga proporcjonalnej weryfikacji przez Playwright CLI.
compatibility: opencode
metadata:
  version: "1.3.0"
  language: "pl"
  stack: "twig,symfony-live-components,stimulus,css,scss,playwright-cli"
---

# Spójność i rozwój interfejsu

## Cel i granice

Rozwijaj istniejący interfejs jako jeden spójny system wizualny, komponentowy i interakcyjny.

Skill obsługuje:

- konsultację zmian UI przed implementacją,
- audyt spójności,
- transfer wzorca między istniejącymi elementami,
- tworzenie nowych elementów na podstawie istniejących wzorców,
- konsolidację i doskonalenie komponentów,
- bezpieczne zmiany Twig, Live Components i Stimulus,
- weryfikację renderowanego wyniku przez Playwright CLI,
- kontekstowy polish estetyczny bez samowolnego redesignu.

Nie twórz nowego języka wizualnego ani nie przeprowadzaj redesignu, jeżeli użytkownik nie zleci tego wprost.

## Warunek wstępny: Playwright CLI

Dla każdego zadania dotyczącego renderowanego UI wykonaj preflight przed odkryciem,
audytem i edycją, zgodnie z `<skill_dir>/references/playwright-cli-verification.md`.
`playwright-cli` jest jedynym entrypointem CLI używanym przez ten skill.

Jeżeli CLI, browser albo połączenie CDP nie działają, przerwij zadanie przed
analizą i zmianami. Nie instaluj przeglądarki ani nie uruchamiaj produkcyjnego
profilu użytkownika automatycznie. Jeżeli aplikacja jest niedostępna, audyt
statyczny bez renderowania wykonuj tylko na jawne polecenie i oznacz go jako
nieweryfikowany wizualnie.

## Zasady nadrzędne

1. Najpierw odkryj istniejący wzorzec, potem go zastosuj lub rozszerz.
2. Spójność nie oznacza identyczności. Zachowuj różnice wymagane przez funkcję, semantykę, interakcję, gęstość i responsywność.
3. Nie kopiuj zachowania tylko dlatego, że kopiujesz wygląd.
4. Najpierw poprawność funkcjonalna, komponentowa i systemowa; dopiero potem polish estetyczny.
5. Kod i snapshot dostępności nie są dowodem poprawności wizualnej. Gdy wynik renderowany może się zmienić, wykonaj screenshot i odczytaj go jako obraz; sam snapshot DOM nie wystarcza.
6. Wybieraj najmniejszy zakres analizy i weryfikacji, który daje wiarygodny wynik.
7. Nie opisuj pełnego toku rozumowania. Raportuj decyzje, dowody i ryzyka.

`SKILL.md` jest źródłem prawdy dla trybów, zakresu, kryteriów ukończenia i blokad.
References są źródłem prawdy dla procedur operacyjnych, komend i checklist.
Prompt agenta określa tylko routing oraz nieprzekraczalne ograniczenia. Przy
powtórzeniu lub konflikcie obowiązuje ta kolejność.

## Klasyfikacja pracy

Klasyfikuj zadanie na dwóch niezależnych osiach.

### `execution_mode`

Ustal jedną wartość:

- `advisory` — opinia, audyt, rekomendacje, warianty lub plan bez implementacji,
- `implementation` — użytkownik jawnie zlecił wykonanie zmian.

Brak jawnego zlecenia implementacji zawsze oznacza `advisory`. Prośby typu
„zaopiniuj”, „co poprawić”, „zaproponuj zmiany”, „skonsultuj”, „oceń widok” i
„przed implementacją” nie są zgodą na edycję.

### `task_mode`

Ustal dokładnie jeden przedmiot pracy:

- `consistency-audit` — diagnoza spójności i profesjonalnego wykończenia,
- `pattern-transfer` — dostosowanie celu do wskazanego wzorca,
- `pattern-based-creation` — nowy element jako pochodna istniejącego systemu,
- `component-consolidation` — wspólny komponent, shell, wariant albo warstwa bazowa,
- `component-improvement` — rozwój istniejącego API, struktury lub zachowania,
- `view-polish` — doszlifowanie istniejącego widoku bez zmiany jego języka wizualnego.

Osie obowiązują równocześnie. Przykładowo ocena transferu bez edycji to
`advisory + pattern-transfer`, a wykonanie polishu to
`implementation + view-polish`.

### Kontrakt `advisory`

W `execution_mode: advisory`:

- nie modyfikuj ani nie usuwaj plików repozytorium i nie twórz ich poza
  dozwoloną lokalizacją artefaktów,
- nie wykonuj operacji UI zmieniających dane lub stan aplikacji,
- zapisuj wyłącznie do potwierdzonego ignorowanego katalogu artefaktów albo
  katalogu tymczasowego poza repo, zgodnie z reference Playwright,
- oddziel obserwacje potwierdzone dowodami od hipotez i preferencji,
- nie przedstawiaj proponowanego kierunku jako zatwierdzonej decyzji,
- dla każdej rekomendacji podaj wpływ, pewność, ryzyko i oczekiwany efekt,
- przedstaw warianty, jeżeli wybór zależy od charakteru produktu lub preferencji
  użytkownika,
- plan implementacji jest opcjonalnym wynikiem konsultacji, a nie obowiązkowym
  zakończeniem.

## Profil weryfikacji

Wybierz najmniejszy wystarczający profil weryfikacji i krótko go uzasadnij.

### Minimalny profil weryfikacji

Dla drobnej, lokalnej zmiany bez wpływu na breakpointy ani kontrakty interakcyjne, np. ikona, pojedynczy token, focus albo mały overflow.

Wymaga zwykle:

- jednego reprezentatywnego viewportu,
- screenshotu przed i po albo jednoznacznego uzasadnienia braku baseline'u,
- sprawdzenia zmienionego stanu,
- konsoli odpowiedniej do zakresu.

### Standardowy profil weryfikacji

Dla zmiany komponentu, spacingu, formularza, nowego wariantu albo transferu wzorca bez złożonego lifecycle.

Wymaga zwykle:

- mobile i desktop,
- screenshotów before/after oraz wzorca, gdy istnieje,
- najważniejszych stanów i długiej treści,
- kontroli konsoli, screenshotów i diffu.

### Rozszerzony profil weryfikacji

Dla gridów, tabel, breakpointów, współdzielonych komponentów, Live Components, Stimulus, złożonego stanu lub dużej konsolidacji.

Wymaga pełnej macierzy adekwatnych viewportów i stanów, lifecycle, ponownego renderowania, visual regression lub trace, jeśli są potrzebne.

Nie obniżaj profilu weryfikacji, gdy zmiana wpływa na wiele miejsc użycia albo kontrakt zachowania.

### Profile w `advisory`

W `execution_mode: advisory` profil opisuje zakres dowodów, a nie
zakres weryfikacji zmiany:

- `minimalny` — jeden reprezentatywny viewport, screenshot, właściwy stan i
  konsola,
- `standardowy` — mobile i desktop, screenshoty, główne stany, realistyczna lub
  długa treść oraz konsola,
- `rozszerzony` — pełna adekwatna macierz viewportów, stanów, lifecycle i
  interakcji.

Nie wymagaj screenshotu `after`, diffu ani testów zmiany, jeśli nie edytowano
kodu. Nadal obowiązuje odczyt screenshotu jako obrazu; snapshot DOM sam nie
wystarcza do opinii wizualnej.

### Doszlifowanie widoku na żądanie

Ustaw `task_mode: view-polish` tylko wtedy, gdy użytkownik prosi o
„doszlifowanie”, „polish”, „wykończenie”, „podniesienie jakości wizualnej” albo
podobny cel. Nie ustawiaj go automatycznie przy każdej zmianie UI.

Doszlifowanie ma poprawiać odczucie jakości bez wymyślania nowego designu:

1. Obejrzyj stabilny stan i nazwij najwyżej 5 problemów o największym wpływie na
   odbiór widoku.
2. W `advisory` wybierz maksymalnie 3 rekomendacje do jednego spójnego kierunku,
   ale nie stosuj ich i nie wykonuj porównania `after`.
3. W `implementation` wybierz maksymalnie 3 korekty do jednego spójnego
   przejścia, zastosuj istniejące tokeny, komponenty i wzorce, a następnie
   sprawdź wynik na tym samym stanie i viewportach co baseline.
4. Nowy token, wariant albo wyjątek wymaga uzasadnienia systemowego, nie tylko
   tego, że „wygląda lepiej”. Odrzuć kierunek lub zmianę, jeżeli dodaje dekorację
   bez funkcji, konkuruje z akcją główną albo poprawia jeden fragment kosztem
   spójności całego widoku.
5. W raporcie wskaż konkretne decyzje lub rekomendacje: jaki problem rozwiązują,
   co świadomie zachowano oraz gdzie nadal istnieje ograniczenie.

Wyjątkowość nie polega na większej liczbie kart, cieni, gradientów ani animacji.
Powinna wynikać z klarownej hierarchii, konsekwentnego rytmu, spokojnej typografii,
dobrze dopracowanych stanów, optycznego wyrównania i jednego kontrolowanego
akcentu, jeśli uzasadnia go funkcja lub charakter istniejącego produktu.

#### Profile doszlifowania

Jeśli użytkownik nie określi profilu, użyj `dopracowany`:

- **zachowawczy** — naprawia hierarchię, rytm, alignment, typografię i stany;
  nie dodaje nowych akcentów ani wariantów,
- **dopracowany** — domyślny; dopuszcza mikrodetale i optyczne korekty oparte
  na istniejącym systemie, ale nie zmienia kierunku wizualnego,
- **charakterystyczny** — dopuszcza jeden świadomy akcent wynikający z domeny,
  treści lub marki; wymaga jawnego wskazania przez użytkownika.

Profil `charakterystyczny` nie oznacza redesignu. Nadal obowiązuje istniejący
język wizualny, ograniczony budżet zmian i bramka before/after.

### Standard dobrego gustu

W `task_mode: view-polish` stosuj dobry gust jako standard decyzji, nie jako konkretny
styl. Widok powinien być przede wszystkim:

- **intencjonalny** — każda dominanta, grupa, powierzchnia i akcent ma powód,
- **czytelny** — hierarchia wynika z funkcji, nie z równomiernego podbijania wszystkiego,
- **powściągliwy** — przed dodaniem elementu sprawdź, czy można coś usunąć, osłabić lub lepiej uporządkować,
- **proporcjonalny** — spacing, typografia i ciężar wizualny tworzą rytm właściwy dla produktu,
- **charakterystyczny** — wyróżnik wynika z domeny, treści lub istniejącego języka, nie z przypadkowego trendu,
- **dokończony** — stany, długie treści, focus, responsywność i mikrodetale nie są pozostawione jako przypadek.

W `advisory` sformułuj jedno zdanie intencji rekomendowanego kierunku i nie
przechodź do edycji. W `implementation` przed edycją sformułuj jedno zdanie
intencji, np. „Widok powinien prowadzić
użytkownika od rozpoznania statusu do głównej akcji, zachowując zwartą gęstość
panelu”. Wskaż dominantę, akcję główną, element do osłabienia lub usunięcia
oraz istniejący sygnał produktu, który zachowujesz.

W `implementation` po edycji bramka jakości jest spełniona tylko wtedy, gdy screenshot before/after
pokazuje wyraźną poprawę co najmniej jednego problemu bez regresji hierarchii,
czytelności, funkcji lub spójności. Jeżeli nie można krótko wyjaśnić, dlaczego
widok jest teraz bardziej intencjonalny i właściwy dla tej aplikacji, nie uznawaj
zmiany za polish.

#### Pakiet dowodów przed decyzją

Przed wyborem elementów do poprawy zbierz minimalny pakiet dowodów:

- **Cel**: URL lub ekran, funkcja widoku, główne zadanie użytkownika i najważniejsza akcja.
- **Render**: screenshot before, viewport, stabilny stan, rodzaj danych i istotne stany interakcji.
- **Struktura**: właściciel widoku w Twig/Live/Stimulus, użyty komponent, klasy lub tokeny odpowiedzialne za wygląd.
- **Wzorce sąsiednie**: maksymalnie trzy porównywalne elementy z tej samej aplikacji, najlepiej o tej samej funkcji, gęstości i typie danych.
- **Ograniczenia**: elementy, których nie wolno zmieniać, kontrakty zachowania oraz różnice wynikające z funkcji.

Jeżeli któregoś z tych dowodów nie można wiarygodnie uzyskać, oznacz to jako
niepewność. Nie kompensuj braku wzorca własnym gustem ani popularnym wzorcem
z innego produktu.

#### Ranking kandydatów do poprawy

Dla każdej obserwacji zapisz krótko:

| Kryterium | Pytanie |
|---|---|
| Wpływ | Czy problem zmienia pierwsze spojrzenie, zrozumienie lub wykonanie zadania? |
| Zasięg | Czy dotyczy całego widoku, komponentu, wielu wystąpień czy jednego detalu? |
| Pewność | Czy potwierdzają go screenshot, computed styles, wzorzec lub kontrakt? |
| Ryzyko | Czy korekta może naruszyć funkcję, dostępność, responsywność albo istniejący token? |

Najpierw wybieraj problemy o wysokim wpływie, szerokim zasięgu i wysokiej
pewności przy niskim ryzyku. Problem o wysokim wpływie, ale niskiej pewności
wymaga najpierw dodatkowego odczytu, nie natychmiastowej zmiany CSS. Korekta
1–2 px jest kandydatem dopiero wtedy, gdy screenshot pokazuje realne zaburzenie
osi lub baseline'u.

#### Wybór wzorca do doszlifowania

Wzorzec wybieraj w tej kolejności:

1. wzorzec wskazany przez użytkownika,
2. kanoniczny element o tej samej funkcji i podobnej gęstości,
3. dobrze utrzymany element o podobnej strukturze danych i stanach,
4. wspólna reguła tokenów, layoutu lub typografii widoczna w kilku miejscach.

Sam wygląd nie wystarcza do transferu. Porównaj osobno shell, spacing,
typografię, hierarchię akcji, stany, responsywność i kontrakt interakcji.
Przenieś tylko wspólną zasadę; zachowaj różnice wynikające z treści i funkcji.
Jeśli dwa wzorce są sprzeczne, nie uśredniaj ich. Wybierz kanoniczny i zgłoś
konflikt albo zatrzymaj polish do czasu decyzji.

#### Niepewność i decyzja użytkownika

Jeśli wybór zależy od nierozstrzygniętej preferencji marki, sprzecznych wzorców
albo zmiany o istotnym wpływie na charakter produktu, nie zgaduj. Zatrzymaj
edycję i zwróć głównemu agentowi:

```text
DECISION_REQUIRED
Pytanie: ...
Rekomendacja: ...
Opcja A: ...
Opcja B: ...
Dowody: ...
Ryzyko decyzji: ...
```

Główny agent zadaje pytanie użytkownikowi i wznawia subagenta z odpowiedzią.
Subagent nie prowadzi równoległego dialogu i nie omija kontekstu głównego agenta.

## Hierarchia źródeł prawdy

Sprawdź w tej kolejności:

1. element lub ekran wskazany przez użytkownika,
2. jego rzeczywiście wyrenderowany wygląd,
3. istniejące komponenty Twig i Live Components,
4. kontrolery Stimulus oraz ich publiczny kontrakt DOM,
5. makra, partiale i layouty,
6. tokeny oraz style CSS/SCSS,
7. najczęściej używany i najlepiej utrzymany wzorzec,
8. dopiero na końcu nowy wzorzec.

Nie kopiuj błędnej semantyki, dostępności ani zachowania elementu referencyjnego.

## Decyzja: reużycie, komponent czy lokalny markup

Preferuj kolejno:

1. istniejący komponent bez zmian,
2. istniejący wariant,
3. semantyczny wariant albo rozszerzenie API,
4. wspólny shell lub komponent bazowy,
5. nowy komponent albo lokalny markup — wybór zależy od granicy odpowiedzialności.

Nowy komponent jest uzasadniony także przy jednym użyciu, gdy ma stabilną odpowiedzialność, własne stany, interakcje, złożoną strukturę lub wartość testową. Lokalny markup jest lepszy, gdy abstrakcja utrudniłaby API bardziej niż uprościła kod.

Nie twórz propsów opisujących arbitralny CSS. API powinno opisywać znaczenie, gęstość, hierarchię, układ lub zachowanie.

## Routing do plików referencyjnych

Odczytaj tylko pliki wymagane przez zadanie:

| Warunek | Plik |
|---|---|
| transfer wzorca, nowy element lub konsultacja dotycząca transferu | `<skill_dir>/references/pattern-transfer.md` |
| Twig Component, macro lub partial | `<skill_dir>/references/twig-components.md` |
| Symfony UX Live Component | `<skill_dir>/references/symfony-live-components.md` |
| Stimulus lub zmiana interakcji/DOM | `<skill_dir>/references/stimulus-controllers.md` |
| każde zadanie dotyczące renderowanego UI, niezależnie od `execution_mode` | `<skill_dir>/references/playwright-cli-verification.md` |
| większy audyt, konsultacja całego widoku lub porównanie wizualne | `<skill_dir>/references/visual-consistency-checklist.md` |
| polish albo konsultacja dotycząca profesjonalnego wykończenia | `<skill_dir>/references/aesthetic-quality-review.md` |
| raport końcowy | `<skill_dir>/references/report-format.md` |

Nie ładuj pełnej checklisty i modułu estetycznego przy oczywistej drobnej korekcie profilu minimalnego.

W `task_mode: view-polish` zawsze załaduj moduł estetyczny i weryfikację Playwright.
Załaduj checklistę przy zmianie całego widoku lub kilku stanów, a transfer wzorca
przy wyborze elementu referencyjnego albo przenoszeniu reguł między komponentami.
W `advisory + view-polish` kończysz na ocenie i rekomendacjach, bez zmian oraz
bez screenshotu `after`.

## Odczyt kontekstu UI

Przed konsultacją, audytem, transferem, utworzeniem nowego elementu albo większą
zmianą określ krótko:

- funkcję ekranu,
- gęstość: `zwarta`, `standardowa` lub `przestronna`,
- poziom zmiany: `zachowawczy`, `ewolucyjny` lub zlecony `redesign`,
- wzorzec dominujący,
- hierarchię działań,
- rolę ruchu: `brak`, `funkcjonalny` lub zlecony `rozbudowany`.

Odczytaj je z aplikacji i polecenia, nie z własnego gustu.

## Workflow

### 1. Odkrycie

1. Ustal `execution_mode`, `task_mode` i profil. W `advisory` zapisz początkowy
   `git status --short` jako punkt odniesienia, bez analizowania zastanego diffu.
2. Załaduj tylko właściwe references.
3. Znajdź wzorzec, cel, miejsca użycia i powiązane warstwy Twig/Live/Stimulus/CSS.
4. Odtwórz stabilny stan. Dla `advisory` wykonaj screenshot dowodowy; dla
   `implementation` wykonaj baseline przed edycją.
5. Dla `task_mode: pattern-transfer` określ: **wzorzec**, **cel** i
   **komponent kanoniczny**.

W `task_mode: view-polish` zakończ odkrycie krótką listą kandydatów z dowodem,
priorytetem, ryzykiem i oczekiwanym efektem. Nie przechodź do edycji na podstawie
samego ogólnego wrażenia „to wygląda przeciętnie”.

### 2. Analiza i zakres

- W `implementation` wybierz maksymalnie 5 najważniejszych problemów należących do bieżącego zakresu.
- Dla `task_mode: consistency-audit` wypisz wszystkie istotne problemy, pogrupuj je i nadaj priorytet: `krytyczny`, `ważny`, `drobny`, `obserwacja`. Wskaż maksymalnie 5 rekomendowanych jako pierwsze.
- W `advisory` wskaż maksymalnie 5 obserwacji o największym znaczeniu.
  Dla każdej podaj dowód, wpływ, pewność, ryzyko, oczekiwany efekt i proponowany
  kierunek. Jeżeli istnieje kilka zasadnych kierunków, przedstaw warianty zamiast
  arbitralnego wyboru.
- Rozdziel reguły wspólne od różnic funkcjonalnych i interakcyjnych.
- Nie zgaduj konkretnych wartości, gdy można użyć computed styles.

### 3. Implementacja

Pomiń ten etap w `execution_mode: advisory`.

Wprowadzaj jeden spójny zestaw zmian naraz. Możesz zmienić kilka właściwości, jeśli razem rozwiązują jeden problem; nie łącz niezależnych refaktorów.

Preferuj reużycie, tokeny i konsolidację. Nie zmieniaj zachowania przy zadaniu wyłącznie wizualnym. Zachowaj semantykę, dostępność oraz kontrakty Live i Stimulus.

### 4. Weryfikacja

W obu trybach odtwórz właściwy stan, dane, viewport i środowisko, sprawdź stany
wymagane przez profil oraz konsolę i requesty adekwatnie do scenariusza.

#### `execution_mode: advisory`

1. Obejrzyj screenshot stabilnego stanu jako obraz.
2. Porównaj wzorzec, jeśli został wybrany i dało się go wiarygodnie odtworzyć.
3. Nie wymagaj screenshotu `after`, testów zmiany ani visual diffu.
4. Nie wykonuj mutujących interakcji tylko po to, aby zebrać więcej stanów.

#### `execution_mode: implementation`

1. Odtwórz ten sam stan co baseline.
2. Porównaj screenshoty before/after oraz screenshot wzorca, jeśli istnieje.
3. Dla Live i Stimulus sprawdź lifecycle, focus, ARIA i ponowne renderowanie.
4. Obejrzyj końcowy screenshot po wszystkich korektach.

W `implementation + view-polish` dodatkowo porównaj przed i po pod kątem pierwszego
spojrzenia, rytmu, osi optycznych, gęstości, stanów oraz tego, czy poprawa nie
stała się lokalnym wyjątkiem. Nie uznawaj samego zwiększenia dekoracyjności za
postęp jakościowy.

### 5. Zamknięcie

#### `execution_mode: advisory`

- porównaj stan repo sprzed i po zadaniu tylko po to, aby potwierdzić brak
  własnych zmian,
- nie przeglądaj ani nie oceniaj zastanego, niezwiązanego diffu,
- usuń własne artefakty spoza dozwolonych lokalizacji,
- zakończ raportem advisory niezależnie od profilu weryfikacji.

#### `execution_mode: implementation`

Przed zakończeniem sprawdź co najmniej:

```bash
git diff --check
git diff --stat
git status --short
```

Następnie obejrzyj diff własnych zmienionych plików. Usuń debug code,
przypadkowe formatowanie, nieśledzone sekrety i artefakty. Nie commituj ani nie
aktualizuj baseline'ów tylko po to, by weryfikacja przeszła.

## Kryteria ukończenia

Zadanie jest ukończone, gdy:

- zmiana odpowiada funkcji ekranu i istniejącemu systemowi UI,
- nie powstał zbędny duplikat ani arbitralna wartość,
- kontrakty Twig/Live/Stimulus pozostały poprawne,
- wybrany profil weryfikacji został wykonany,
- nie ma nowych błędów konsoli ani oczywistych regresji,
- diff jest skupiony i wolny od przypadkowych artefaktów,
- obszary nieweryfikowane są jawnie opisane.

Dla `execution_mode: advisory` zamiast kryteriów dotyczących zmiany wymagaj, aby:

- wskazany widok i istotne stany zostały rzeczywiście obejrzane,
- screenshot został odczytany jako obraz,
- rekomendacje wynikały z dowodów i istniejącego systemu UI,
- obserwacje, preferencje i niepewności były rozdzielone,
- nie zmodyfikowano plików repozytorium ani danych aplikacji.

Jeżeli Playwright CLI jest niedostępny, zadanie jest zablokowane i nie wykonuj zmian. Jeżeli niedostępna jest aplikacja, stosuj regułę z sekcji „Warunek wstępny: Playwright CLI”.

## Wynik pracy

Użyj formatu z `<skill_dir>/references/report-format.md`. `execution_mode`
wyznacza typ raportu przed profilem: dla `advisory` zawsze użyj raportu
konsultacyjnego, a dla `implementation` raportu skróconego przy profilu
minimalnym lub pełnego przy standardowym i rozszerzonym. Pomijaj nieistotne
sekcje zamiast wpisywać serię „nie dotyczy”.
