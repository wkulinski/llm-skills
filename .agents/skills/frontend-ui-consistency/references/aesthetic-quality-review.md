# Kontrola jakości estetycznej

## Cel i granice

Wykrywaj mechaniczne, przypadkowe lub niedopracowane rezultaty po osiągnięciu poprawności funkcjonalnej i systemowej.

To moduł audytowy i instrukcja dla jawnie zleconego doszlifowania. Nie zmieniaj fontu, palety, systemu ikon, gęstości, radiusów, dekoracji ani kierunku stylistycznego bez jawnej zgody.

Zakaz zmiany gęstości dotyczy globalnego systemu, tokenów i zasad layoutu. Lokalna
korekta spacingu, rytmu lub wyrównania jest dopuszczalna, jeśli wynika z dowodu,
nie tworzy nowego wariantu i nie zmienia ilości informacji ani charakteru całego
produktu. Zmiana layoutu lub modelu informacji wymaga rozszerzenia zakresu.

## Doszlifowanie na żądanie

Tryb doszlifowania uruchamiaj wyłącznie po prośbie użytkownika o polish,
wykończenie, dopracowanie lub podniesienie jakości widoku. Jego celem jest
usunięcie wrażenia mechanicznego szablonu, nie zastąpienie istniejącego designu.

Pracuj w krótkiej pętli:

1. Obejrzyj baseline w docelowym stanie i zapisz maksymalnie 5 obserwacji.
2. Wybierz maksymalnie 3 korekty o wysokim wpływie i wspólnej przyczynie.
3. Wprowadź je bez nowych lokalnych wyjątków, jeżeli istniejący system wystarcza.
4. Obejrzyj before/after w tych samych viewportach i odrzuć korekty czysto dekoracyjne.

Za oznakę dobrego wykończenia uznaj przede wszystkim:

- oczywistą hierarchię pierwszego spojrzenia i spokojną akcję główną,
- rytm, w którym odstępy pokazują relacje zamiast wypełniać puste miejsce,
- optyczne wyrównanie osi, baseline'ów i ikon,
- typografię, która rozróżnia role i dobrze znosi realistyczną treść,
- kompletne stany: loading, empty, error, success, disabled i focus, gdy dotyczą widoku,
- kontrolowaną powierzchnię bez kumulowania kart, borderów, cieni i dekoracji,
- jeden uzasadniony akcent lub detal charakterystyczny dla produktu, a nie zestaw ozdobników.

Nie poprawiaj widoku przez automatyczne dodawanie gradientów, glassmorphismu,
większych nagłówków, zaokrągleń, animacji, badge'y ani kolejnych kart. Każdy taki
element musi mieć funkcję, istniejący wzorzec lub jasno uzasadnioną rolę.

## Pakiet dowodów i selekcja

Przed zmianą zapisz w notatkach roboczych:

- ekran, funkcję, główną akcję, viewport i stabilny stan,
- screenshot before oraz dane użyte do renderowania,
- komponent Twig/Live/Stimulus i tokeny lub klasy odpowiedzialne za wynik,
- do trzech wzorców z tej samej aplikacji, dobranych po funkcji, gęstości,
  danych i stanach, a nie po samym podobieństwie wizualnym.

Każdą obserwację opisz jako `problem -> dowód -> oczekiwany efekt -> ryzyko`.
Wybierz najpierw problemy o wysokim wpływie na pierwsze spojrzenie lub zadanie,
powtarzalne w wielu miejscach i potwierdzone screenshotem, computed styles albo
kanonicznym wzorcem. Niska pewność oznacza potrzebę dalszej obserwacji, nie zgodę
na zgadywanie.

Wzorzec jest użyteczny tylko wtedy, gdy można rozdzielić jego reguły wspólne od
różnic funkcjonalnych. Porównaj shell, spacing, typografię, hierarchię akcji,
stany, responsywność i interakcję. Nie przenoś mechanizmu Live/Stimulus ani
układu tylko dlatego, że element wygląda podobnie.

## Bramka dobrego gustu

„Dobry gust” nie oznacza jednego stylu, minimalizmu ani większej dekoracyjności.
Oznacza właściwy poziom intencji, proporcji, powściągliwości i charakteru dla
konkretnego produktu.

### Przed edycją

Zapisz krótką tezę kompozycyjną:

```text
Widok powinien [prowadzić / uspokajać / porządkować / eksponować] użytkownika
od [informacja lub stan] do [główna akcja], zachowując [istniejący sygnał produktu].
```

Następnie wskaż:

- dominantę pierwszego spojrzenia,
- główną akcję i elementy pomocnicze,
- rzecz, którą można osłabić, usunąć albo odsunąć,
- jeden istniejący sygnał charakteru produktu, którego nie wolno zgubić.

Jeżeli nie da się tego określić z funkcji ekranu, treści i wzorców, zatrzymaj się
na odkryciu zamiast generować ogólną „estetykę”.

### Po edycji

Oceń screenshot before/after bez patrzenia najpierw na kod:

- Czy w pierwszych sekundach wiadomo, czym jest ekran i co jest główną akcją?
- Czy elementy mają różny ciężar, czy wszystko zostało jednakowo podkreślone?
- Czy rytm i proporcje wyglądają na zamierzone, także przy realistycznej treści?
- Czy detal charakterystyczny wynika z produktu, czy jest wymiennym wzorcem AI?
- Czy poprawa jest widoczna bez powiększania screenshotu i bez tłumaczenia jej kodem?

Nie przechodź bramki, gdy zmiana:

- dodaje „dashboard soup”, czyli wiele równorzędnych kart, badge'y i akcji bez hierarchii,
- tworzy „component collage”, czyli zbiór poprawnych, ale niepowiązanych wzorców,
- dodaje „token soup”, czyli lokalne wartości, radiusy, kolory lub cienie bez systemu,
- zastępuje charakter produktu trendem, np. dekoracyjnym gradientem lub glassmorphismem,
- poprawia desktop kosztem mobile, treści, stanów albo czytelności,
- wygląda efektownie wyłącznie w pustym stanie testowym.

Jeżeli screenshot nie pokazuje jednoznacznej poprawy albo poprawa wymaga długiego
uzasadnienia, cofnij korektę lub oznacz ją jako nierozstrzygniętą.

## Odczyt kontekstu

Oceń wynik względem funkcji ekranu, ustalonej gęstości, hierarchii działań i istniejącego wzorca. Nie oceniaj aplikacji produktowej jak landing page'a.

## Hierarchia

Sprawdź:

- czy pierwsza informacja i akcja główna są oczywiste,
- czy elementy pomocnicze nie konkurują z głównymi,
- czy wizualna dominacja odpowiada kolejności użytkowej,
- czy komponent nie jest równomiernie „głośny” w każdym miejscu.

## Rytm i semantyka odstępów

Odstęp ma komunikować relację. Elementy jednej grupy powinny być bliżej niż odrębne grupy.

Sprawdź rytm tytuł–opis, treść–akcje, padding shellu i odstęp między komponentami. Nie zwiększaj whitespace mechanicznie; zachowaj gęstość właściwą zadaniu.

## Typografia

Zachowaj istniejącą rodzinę i skalę. Oceń czy tytuł, wartość, opis, etykieta i metadane mają odrębne role, czy nie pojawiają się prawie identyczne rozmiary oraz czy długie i krótkie treści zachowują rytm.

Dla porównywalnych danych rozważ istniejący wzorzec `tabular-nums`, ale nie wprowadzaj go globalnie bez potrzeby.

## Neutralne kolory i akcenty

Sprawdź jedną rodzinę neutralnych kolorów, brak nowych prawie identycznych szarości, spójny kontrast borderów oraz jednoznaczne role kolorów interaktywnych i semantycznych.

## Powierzchnie i głębia

Oceń funkcję panelu, borderu, tła i cienia. Unikaj zbędnego kumulowania tych środków oraz wielokrotnego zagnieżdżenia niemal identycznych powierzchni. Nie usuwaj kart mechanicznie.

## Optyczne wyrównanie

Screenshot ma pierwszeństwo przed samymi liczbami CSS. Sprawdź baseline'y, osie nagłówków i akcji, wycentrowanie ikon, rytm formularzy i położenie akcji w powtarzalnych elementach.

Drobna korekta 1–2 px jest dopuszczalna tylko dla widocznego problemu i po sprawdzeniu innych viewportów; nie twórz serii niekontrolowanych wyjątków.

## Ikony i kontrolki

Sprawdź istniejącą rodzinę ikon, stroke, pole optyczne, rozmiar, odstęp ikona–tekst, hit area i nazwę dostępną. Nie wprowadzaj drugiej biblioteki, ręcznie rysowanego SVG ani emoji bez uzasadnienia.

## Generyczne wzorce jako pytania

Nie zakazuj kart, badge'y, modali ani równych kolumn. Sprawdź, czy:

- równe elementy rzeczywiście mają równą wagę,
- badge ma znaczenie,
- modal jest właściwym miejscem działania,
- każdy panel ma funkcję,
- struktura wynika z danych, a nie domyślnego szablonu modelu,
- nowy element wygląda jak część tej aplikacji.

Jeżeli wzorzec jest poprawny i kanoniczny dla projektu, zachowaj go.

## Treści

Nie zmieniaj biznesowej treści bez potrzeby. Do testów używaj realistycznych, nieprodukcyjnych danych, w tym krótkich i skrajnie długich wartości. Komunikaty błędu mają mówić, co się stało i co można zrobić; sukces ma być spokojny i konkretny.

## Motion

Każda animacja musi wspierać feedback, zmianę stanu, orientację lub relację. Nie dodawaj ruchu jako dekoracyjnego polishu. Zachowaj istniejące czasy i easing oraz uwzględnij reduced motion.

## Estetyczny pre-flight

Przed zakończeniem odpowiedz konkretnie:

- Czy hierarchia jest oczywista?
- Czy spacing odzwierciedla grupowanie?
- Czy sąsiednie elementy mają spójne osie i baseline'y?
- Czy akcja główna nie konkuruje z pomocniczymi?
- Czy neutralne kolory, powierzchnie i ikony należą do jednego systemu?
- Czy nowy element wygląda jak część aplikacji?
- Czy zachowano właściwą gęstość?
- Czy ruch ma funkcję?

W trybie doszlifowania odpowiedz także:

- Jaki konkretny problem sprawiał, że widok wyglądał mechanicznie lub przeciętnie?
- Które maksymalnie trzy korekty dały największą poprawę?
- Jaki istniejący wzorzec, token lub zasada uzasadnia każdą korektę?
- Czy po korekcie widok jest bardziej charakterystyczny dzięki klarowności i rytmowi,
  a nie dzięki większej liczbie dekoracji?

Ocena musi opierać się na odczytanym jako obraz screenshotcie końcowym, nie tylko
na snapshotcie DOM lub kodzie. Gdy korekta zmienia kod, wykonaj ponowną weryfikację
adekwatną do profilu.
