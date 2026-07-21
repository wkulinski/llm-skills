---
name: frontend-ui-consistency
description: Audytuje, uspójnia, modyfikuje i tworzy elementy istniejącego interfejsu na podstawie jego wzorców. Chroni kontrakty Twig, Symfony UX Live Components i Stimulus oraz wymaga proporcjonalnej weryfikacji przez Playwright CLI.
compatibility: opencode
metadata:
  version: "1.1.0"
  language: "pl"
  stack: "twig,symfony-live-components,stimulus,css,scss,playwright-cli"
---

# Spójność i rozwój interfejsu

## Cel i granice

Rozwijaj istniejący interfejs jako jeden spójny system wizualny, komponentowy i interakcyjny.

Skill obsługuje:

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

## Tryby pracy

Rozpoznaj jeden tryb główny:

- **Audyt spójności** — diagnoza bez modyfikowania kodu.
- **Transfer wzorca** — dostosowanie celu do wskazanego wzorca.
- **Tworzenie na podstawie wzorca** — nowy element jako pochodna istniejącego systemu.
- **Konsolidacja komponentów** — wspólny komponent, shell, wariant albo warstwa bazowa.
- **Doskonalenie komponentu** — rozwój istniejącego API, struktury lub zachowania.
- **Doszlifowanie widoku** — jawnie zlecony polish istniejącego widoku bez zmiany jego języka wizualnego.

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

### Doszlifowanie widoku na żądanie

Uruchom ten tryb tylko wtedy, gdy użytkownik prosi o „doszlifowanie”, „polish”,
„wykończenie”, „podniesienie jakości wizualnej” albo podobny cel. Nie uruchamiaj
go automatycznie przy każdej zmianie UI.

Doszlifowanie ma poprawiać odczucie jakości bez wymyślania nowego designu:

1. Obejrzyj stabilny baseline i nazwij najwyżej 5 problemów o największym wpływie
   na odbiór widoku.
2. Wybierz maksymalnie 3 korekty do jednego spójnego przejścia. Priorytet mają:
   hierarchia pierwszego spojrzenia, rytm odstępów, wyrównanie optyczne,
   typografia, gęstość informacji, stany i jakość treści.
3. Zastosuj istniejące tokeny, komponenty i wzorce. Nowy token, wariant albo
   wyjątek wymaga uzasadnienia systemowego, nie tylko tego, że „wygląda lepiej”.
4. Sprawdź wynik na tym samym stanie i viewportach co baseline. Odrzuć zmianę,
   jeżeli dodaje dekorację bez funkcji, konkuruje z akcją główną albo poprawia
   jeden fragment kosztem spójności całego widoku.
5. W raporcie wskaż konkretne decyzje: co poprawiono, jaki problem rozwiązano,
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

W trybie doszlifowania stosuj dobry gust jako standard decyzji, nie jako konkretny
styl. Widok powinien być przede wszystkim:

- **intencjonalny** — każda dominanta, grupa, powierzchnia i akcent ma powód,
- **czytelny** — hierarchia wynika z funkcji, nie z równomiernego podbijania wszystkiego,
- **powściągliwy** — przed dodaniem elementu sprawdź, czy można coś usunąć, osłabić lub lepiej uporządkować,
- **proporcjonalny** — spacing, typografia i ciężar wizualny tworzą rytm właściwy dla produktu,
- **charakterystyczny** — wyróżnik wynika z domeny, treści lub istniejącego języka, nie z przypadkowego trendu,
- **dokończony** — stany, długie treści, focus, responsywność i mikrodetale nie są pozostawione jako przypadek.

Przed edycją sformułuj jedno zdanie intencji, np. „Widok powinien prowadzić
użytkownika od rozpoznania statusu do głównej akcji, zachowując zwartą gęstość
panelu”. Wskaż dominantę, akcję główną, element do osłabienia lub usunięcia
oraz istniejący sygnał produktu, który zachowujesz.

Po edycji bramka jakości jest spełniona tylko wtedy, gdy screenshot before/after
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
| transfer wzorca lub nowy element | `<skill_dir>/references/pattern-transfer.md` |
| Twig Component, macro lub partial | `<skill_dir>/references/twig-components.md` |
| Symfony UX Live Component | `<skill_dir>/references/symfony-live-components.md` |
| Stimulus lub zmiana interakcji/DOM | `<skill_dir>/references/stimulus-controllers.md` |
| większy audyt lub porównanie wizualne | `<skill_dir>/references/visual-consistency-checklist.md` |
| zmiana renderowanego UI | `<skill_dir>/references/playwright-cli-verification.md` |
| polish albo ocena profesjonalnego wykończenia | `<skill_dir>/references/aesthetic-quality-review.md` |
| raport końcowy | `<skill_dir>/references/report-format.md` |

Nie ładuj pełnej checklisty i modułu estetycznego przy oczywistej drobnej korekcie profilu minimalnego.

W trybie doszlifowania zawsze załaduj moduł estetyczny i weryfikację Playwright.
Załaduj checklistę przy zmianie całego widoku lub kilku stanów, a transfer wzorca
przy wyborze elementu referencyjnego albo przenoszeniu reguł między komponentami.

## Odczyt kontekstu UI

Przed transferem, utworzeniem nowego elementu albo większą zmianą określ krótko:

- funkcję ekranu,
- gęstość: `zwarta`, `standardowa` lub `przestronna`,
- poziom zmiany: `zachowawczy`, `ewolucyjny` lub zlecony `redesign`,
- wzorzec dominujący,
- hierarchię działań,
- rolę ruchu: `brak`, `funkcjonalny` lub zlecony `rozbudowany`.

Odczytaj je z aplikacji i polecenia, nie z własnego gustu.

## Workflow

### 1. Odkrycie

1. Ustal tryb i profil.
2. Załaduj tylko właściwe references.
3. Znajdź wzorzec, cel, miejsca użycia i powiązane warstwy Twig/Live/Stimulus/CSS.
4. Gdy UI może się zmienić, odtwórz stabilny stan i wykonaj baseline przed edycją.
5. Przy transferze określ: **wzorzec**, **cel** i **komponent kanoniczny**.

W trybie doszlifowania zakończ odkrycie krótką listą kandydatów z dowodem,
priorytetem, ryzykiem i oczekiwanym efektem. Nie przechodź do edycji na podstawie
samego ogólnego wrażenia „to wygląda przeciętnie”.

### 2. Analiza i zakres

- W trybie implementacji wybierz maksymalnie 5 najważniejszych problemów należących do bieżącego zakresu.
- W trybie audytu wypisz wszystkie istotne problemy, pogrupuj je i nadaj priorytet: `krytyczny`, `ważny`, `drobny`, `obserwacja`. Wskaż maksymalnie 5 rekomendowanych jako pierwsze.
- Rozdziel reguły wspólne od różnic funkcjonalnych i interakcyjnych.
- Nie zgaduj konkretnych wartości, gdy można użyć computed styles.

### 3. Implementacja

Wprowadzaj jeden spójny zestaw zmian naraz. Możesz zmienić kilka właściwości, jeśli razem rozwiązują jeden problem; nie łącz niezależnych refaktorów.

Preferuj reużycie, tokeny i konsolidację. Nie zmieniaj zachowania przy zadaniu wyłącznie wizualnym. Zachowaj semantykę, dostępność oraz kontrakty Live i Stimulus.

### 4. Weryfikacja

1. Odtwórz ten sam stan, dane, viewport i środowisko.
2. Jeśli wykonano baseline, porównaj screenshoty before/after; screenshot wzorca
   porównaj, jeśli wzorzec został wybrany i dało się go wiarygodnie odtworzyć.
   Jeśli baseline lub wzorzec był niemożliwy, opisz przyczynę w raporcie.
3. Sprawdź stany wymagane przez profil weryfikacji.
4. Dla Live i Stimulus sprawdź lifecycle, focus, ARIA i ponowne renderowanie.
5. Sprawdź nowe błędy konsoli i requestów.
6. Wykonaj adekwatną weryfikację przez Playwright.
7. Obejrzyj końcowy screenshot po wszystkich korektach.

W trybie doszlifowania dodatkowo porównaj przed i po pod kątem pierwszego
spojrzenia, rytmu, osi optycznych, gęstości, stanów oraz tego, czy poprawa nie
stała się lokalnym wyjątkiem. Nie uznawaj samego zwiększenia dekoracyjności za
postęp jakościowy.

### 5. Review zmian

Przed zakończeniem sprawdź co najmniej:

```bash
git diff --check
git diff --stat
git status --short
```

Następnie obejrzyj diff zmienionych plików. Usuń debug code, przypadkowe formatowanie, nieśledzone sekrety i artefakty. Nie commituj ani nie aktualizuj baseline'ów tylko po to, by weryfikacja przeszła.

## Kryteria ukończenia

Zadanie jest ukończone, gdy:

- zmiana odpowiada funkcji ekranu i istniejącemu systemowi UI,
- nie powstał zbędny duplikat ani arbitralna wartość,
- kontrakty Twig/Live/Stimulus pozostały poprawne,
- wybrany profil weryfikacji został wykonany,
- nie ma nowych błędów konsoli ani oczywistych regresji,
- diff jest skupiony i wolny od przypadkowych artefaktów,
- obszary nieweryfikowane są jawnie opisane.

Jeżeli Playwright CLI jest niedostępny, zadanie jest zablokowane i nie wykonuj zmian. Jeżeli niedostępna jest aplikacja, stosuj regułę z sekcji „Warunek wstępny: Playwright CLI”.

## Wynik pracy

Użyj formatu z `<skill_dir>/references/report-format.md`. W profilu minimalnym stosuj raport skrócony; w standardowym i rozszerzonym — pełny tylko w zakresie istotnym dla zadania. Pomijaj nieistotne sekcje zamiast wpisywać serię „nie dotyczy”.
