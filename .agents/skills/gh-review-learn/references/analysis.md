# Analiza uwag i aktualnych instrukcji

Przeczytaj tę referencję przed oceną historycznych źródeł lub ponowną oceną
ich zastosowania. Formaty zapisu określa kontrakt danych wskazany przez korzeń;
ta procedura dotyczy decyzji agenta, których skrypty nie podejmują.

## 1. Rozlicz materiał historyczny

Dla każdego źródła w wybranej partii odczytaj pełną treść, odpowiedzi i
powiązane review. Podsumowanie bez inline jest samodzielnym źródłem: wyodrębnij
z niego każdą uwagę i nadaj jej lokalne ID z cytatem albo dokładnym zakresem.
Jedno źródło może zawierać wiele uwag, a wspólny wniosek może wskazywać kilka
źródeł. Materiały strukturalne, np. pusty wątek, również wymagają jawnego
rozstrzygnięcia, choć nie muszą tworzyć nowej uwagi.

Dla uwagi ustal i zapisz w roboczym raporcie:

1. Konkretny błąd lub ryzyko oraz kontrakt obowiązujący w czasie review.
2. Odpowiedź autora, odrzucenie, świadomie zaakceptowany wyjątek albo brak
   rozstrzygnięcia. Brak odpowiedzi nie jest akceptacją uwagi ani wyjątku.
3. Wersję ocenianą przez review i oryginalną lokalizację. Odczytaj wskazane
   dokładne SHA i pliki, nie zastępuj ich nowszą wersją.
4. Dostępną rzeczywistą poprawkę oraz oddzielny stan włączony przez merge.
   Przy squash/rebase zachowaj pochodzenie obu wersji; sama podobna treść
   aktualnego pliku nie dowodzi, co zmieniono w odpowiedzi na review.
5. Zakres sprawdzenia poprawki: odczyt kodu, test obecny w diffie, wykonany
   test, obserwacja runtime. Zapisz odnośnik do dowodu i ograniczenia.

Odpowiedź autora nie zwalnia z odczytu stanu pierwotnego. „Poprawione” może
opisywać dopiero nowszy commit. Rozdziel cztery części `verification`: pierwotny
stan, relację odpowiedzi do wersji, poprawkę i obecne zastosowanie. Dla inline
punktem odniesienia jest `originalCommitSha` (gdy brak: `commitSha`), dla review
`commitSha`. W dyskusji bez SHA jawnie uzasadnij wybór historycznej wersji;
nie wyznaczaj jej z samej daty późniejszej odpowiedzi.

- `fixed`: odczytano pierwotny plik, rzeczywisty diff i plik po poprawce.
- `rejected`: pierwotny kod oraz obowiązujący wtedy kontrakt obalają uwagę;
  samo zaprzeczenie autora nie jest dowodem.
- `accepted`: potwierdzono pierwotne ryzyko, a jawna decyzja określa zakres jego
  świadomego pozostawienia. Nie oznacza „autor zaakceptował i poprawił”.
- `suggestion`: propozycja bez obowiązku wdrożenia; sprawdź kontekst pierwotny.
- `unresolved`: brakuje pierwotnego stanu, poprawki lub rozstrzygnięcia.

Nowszą decyzję biznesową opisz jako `later_decision`; nie zmienia ona wstecznie
kontraktu z czasu review. Brak obiektu Git nie pozwala oznaczyć historii jako
fixed/rejected/accepted ani zakończyć analizy. Obecne pokrycie może być mimo
to potwierdzone osobno. Wznowienie zachowuje każdą już wyodrębnioną uwagę i jej
ID; nie zastępuj jej `no_learning`, nawet jeśli odpowiedź brzmi przekonująco.
Dla merytorycznej dyskusji bez wniosku również zapisz sprawdzony snapshot i
uzasadnienie. Puste akceptacje i metadane nie wymagają takiej analizy kodu.

Traktuj merge, approve, rozwiązanie wątku, wycofanie review i test obecny w
patchu jako osobne obserwacje. Żadna z nich samodzielnie nie dowodzi usunięcia
błędu, wykonania testu ani obowiązywania zasady. Wycofane review zachowuje
źródło i historię; nie odrzucaj jego treści automatycznie.

Każdy materiał przygotowany przez helper rozlicz jako wykorzystany,
niedostępny albo świadomie niepotrzebny, z uzasadnieniem. Brak obiektu Git lub
ucięty diff pozostaje jawną luką. Gdy bez niego nie da się rozstrzygnąć uwagi,
zachowaj nierozstrzygnięcie; nie uzupełniaj historii domysłem.

## 2. Oceń zastosowanie obecne

Dla każdego wniosku odczytaj aktualny kod, odpowiednią sekcję dokumentacji,
wersje zależności i dostępne dowody konfiguracji z jawnego snapshotu projektu.
Porównaj je z problemem historycznym. Zmiana fingerprintu kontekstu jest
faktem wymagającym oceny; nawet jeśli uznasz ją za nieistotną, zapisz przyczynę.
Wykorzystaj poprzedni wynik techniczny i jego referencje. Zachowaj historyczne
fakty tylko w zakresie popartym dostępnymi dowodami.

| Obserwowany stan | Wynik aktualności i dalsze działanie |
| --- | --- |
| Problem ma obecnie zastosowanie i jest luka w instrukcji | wskaż zastosowanie obecne i przygotuj diff właściwego dokumentu |
| Zasada jest już opisana | oceń jej jednoznaczność i ścieżkę dotarcia według kroku 3; wskaż wystarczające pokrycie albo konkretną lukę |
| Kod lub narzędzie już zapobiega problemowi | wskaż istniejące zabezpieczenie i sprawdź, czy jest rzeczywista luka dokumentacji |
| Dawna konstrukcja lub zależność nie jest już używana | oznacz przypadek historyczny; nie ustanawiaj z niego aktualnej reguły |
| Nowsza jawna decyzja zmienia dawną zasadę | wskaż nowszą decyzję i jej źródło zamiast przywracać starszą |
| Brakuje istotnego dowodu lub decyzje są sprzeczne | zachowaj brak dowodów lub nierozstrzygnięcie oraz nazwij brakujący krok |

Dowód runtime musi wskazywać środowisko, czas, czynność i wynik. Nie deklaruj
sprawdzenia środowiska na podstawie samej konfiguracji ani kodu testu. Jeśli
wniosek zależy od runtime, którego nie sprawdzono, opisz tę lukę i nie ogłaszaj
pełnego potwierdzenia. Nie uruchamiaj dodatkowych operacji runtime poza
uprawnieniami zlecenia.

## 3. Wybierz zakres reguły i miejsce zmiany

Przed wyborem dokumentu rozważ dla każdej uwagi, czy mechanizm błędu jest
lokalny dla danego modułu, czy dotyczy wspólnej zasady projektu. Uzasadnij ten
wybór także wtedy, gdy nie proponujesz zmiany. Nazwa modułu w komentarzu nie
wyznacza zakresu reguły. Wspólna zasada może wynikać z jednej dobrze
udokumentowanej granicy architektury; powtórzenia w różnych modułach pomagają
potwierdzić jej zakres, ale sama liczba podobnych uwag nie ustanawia zasady.

Porównaj mechanizmy między PR-ami w partii oraz z powiązanymi ocenami z locka.
Sprawdź ich źródła przed połączeniem; nie łącz uwag tylko po słowach lub autorze.
Jeśli potrzebny materiał z innych przebiegów jest niedostępny, nazwij zakres,
którego synteza nie obejmuje. Zachowaj referencje wszystkich połączonych uwag.

Odczytaj `docs_map`, instrukcje ogólne i właściwe dokumenty modułów w B. Dla
istniejącej zasady sprawdź osobno jej treść i ścieżkę dotarcia: czy określa
warunek, granicę odpowiedzialności, wymagany dowód oraz istotne wyjątki i czy
prowadzą do niej instrukcje wejściowe używane przy tym rodzaju zadania.
Nie zamykaj oceny samym „już opisane”. Rozważ, czy zapis pomija rozróżnienie
widoczne w review, odsyłacz jest niewidoczny, czy błąd był niewykonaniem jasnej
instrukcji. Sam fakt popełnienia błędu nie dowodzi wady dokumentacji ani tego,
że wykonawca ją przeczytał; przy braku dowodu nie przypisuj mu przyczyny.
Poprawka kodu nie zastępuje tej oceny instrukcji.

Dobierz miejsce do zakresu i rodzaju potwierdzonej luki:

| Wynik oceny | Działanie |
| --- | --- |
| Szczegół zachowania lub wyjątek jednego modułu | uzupełnij dokumentację tego modułu |
| Brak lub niejednoznaczność zasady wspólnej | doprecyzuj jej kanoniczny dokument ogólny; lokalne przykłady mogą odsyłać do niego |
| Zasada jest jasna, ale brakuje właściwej ścieżki dotarcia | dodaj odsyłacz w istniejącym punkcie wejścia, bez kopiowania zasady |
| Treść i ścieżka dotarcia są wystarczające | wskaż sekcję oraz powód braku zmiany; nie dopisuj reguły za każde naruszenie |

Dopiero po wyborze poziomu reguły przygotuj najmniejszą wystarczającą zmianę.
Wspólnej zasady nie zastępuj serią lokalnych dopisków. Nie twórz obowiązku
ogólnego z niepotwierdzonego wyjątku. Propozycja określa warunek zastosowania,
czynność, wymagany dowód i potwierdzone wyjątki; przy konflikcie decyzji pokaż
konsekwencje i referencje zamiast ustanawiać regułę. W `rationale` ocen zachowaj
wybrany zakres, ocenę treści i dostępności istniejącej instrukcji oraz powód
wyboru właściciela lub braku zmiany, aby decyzja przetrwała utratę raportu cache.

Do cache zapisz dokładny diff oraz raport: problem → obecne zastosowanie →
miejsce docelowe → uzasadnienie → źródła. Pochodzenie pozostaje w locku i raporcie. Nie dodawaj ogólnej etykiety
„z nauki” do instrukcji: jej znaczenie wynika z treści i zakresu. Odnośnik do
PR dodaj w dokumencie tylko wtedy, gdy wyjaśnia decyzję albo wyjątek; nie
powielaj w nim całej historii review.
Nie twórz osobnej bazy tekstów zasad obok dokumentacji.

Jeżeli wniosek dotyczy wspólnego workflow lub helpera dostarczanego przez A,
wskaż repo właściciela, właściwy skill i zakres propozycji. Zlecenie pracy w B
nie upoważnia do automatycznej edycji wspólnej instalacji. Unikaj lokalnego
nadpisania procedury w dokumentacji B, gdy właścicielem jest katalog skilli.

## 4. Rozlicz wynik i przekazanie

Zbuduj jawne rozstrzygnięcia wszystkich źródeł i materiałów według kontraktu
danych. Wynik historyczny, aktualność i dostarczenie propozycji są oddzielnymi
ocenami. Sugestia lub świadomy wyjątek nie musi prowadzić do nowej instrukcji.
Brak istotnego dowodu pozostaje nierozstrzygnięciem także wtedy, gdy PR jest
zmergowany. Raportuj wówczas potrzebną decyzję lub dowód i zakres, którego
nie potwierdzono.

Przy propozycji oczekującej na zastosowanie zachowaj w locku stan oraz ścieżki
i hashe pozwalające ją odbudować po utracie cache. Po poleceniu zastosowania
porównaj propozycję z aktualnymi dokumentami; zmienione wejścia wymagają
ponownej oceny. Sprawdzenie całego końcowego zestawu dokumentów obejmuje
spójność nowych instrukcji, odsyłacze i potwierdzone wyjątki. Manifest opisuje
rzeczywiste bajty, a nie oczekiwany efekt patcha.

Nie oznaczaj odmowy bez referencji jawnej decyzji użytkownika. Nie utożsamiaj
zapisania analizy z zastosowaniem instrukcji. Ostateczne stany w raporcie
wyprowadź z odczytu zapisanego locka; błąd zapisu oznacza, że roboczy wynik
nie stał się trwałym postępem.
