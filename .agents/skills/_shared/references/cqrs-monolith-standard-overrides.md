# CQRS Monolith Standard Overrides

Ten dokument rozszerza baseline `php-symfony-postgres-standards.md` o reguły modularnego monolitu z modułami w architekturze heksagonalnej i CQRS. Większość reguł uzupełnia baseline; reguła, która go zmienia, nazywa w treści odstępstwo i wskazuje sekcję baseline.

### Trzy wzorce i lokalne decyzje profilu

| Wzorzec | Chroniona zasada | Czego sam wzorzec nie wymaga |
|---|---|---|
| CQRS | Rozdzielenie odpowiedzialności zapisu i odczytu; jawna semantyka command/query i ich modeli | Busa, event sourcingu, osobnych baz, określonych katalogów ani `void` dla każdej komendy |
| Modularny monolit | Własność odpowiedzialności i danych, ukrycie implementacji, współpraca przez uzgodnione kontrakty | Izolacji jak w mikroserwisach, zakazu wszystkich FK, joinów lub transakcji między modułami |
| Hexagonal | Niezależność wnętrza od mechanizmów integracji; porty opisujące potrzeby i adaptery dostosowujące mechanizmy | Jednego układu katalogów, busa ani identycznych DTO na każdej granicy |

Ścieżka busowa, lokalizacja portów, ograniczenie obcych komunikatów do adapterów i FCF są decyzjami tego profilu. Ich uzasadnieniem są spójne granice i gwarancje wykonania, nie twierdzenie, że wszystkie aplikacje CQRS/hexagonal muszą działać tak samo.

### Siła reguł i ochrona przed pozorną zgodnością

- Sformułowania „musi”, „wyłącznie”, „nie wolno” i „nie używaj” opisują wymagania; „preferuj”, „zalecane” i „domyślnie” opisują kierunek z dopuszczalnym, uzasadnionym odstępstwem.
- Odstępstwo od wymagania ustanawia wyłącznie polecenie użytkownika w bieżącym zadaniu, zmiana tego profilu albo jawne nadpisanie w lokalnych zasadach repo w rozumieniu `runtime-collaboration-guidelines.md` §8. Dla reguł zależności odstępstwem jest też zatwierdzony wyjątek w konfiguracji narzędzia egzekwującego te reguły (pkt 7).
- Wyjątek przewidziany w profilu lub odstępstwo od kierunku ma konkretny zakres i uzasadnienie w kontrakcie/README; nie rozszerza automatycznie innych wyjątków. Decyzja o joinie nie uprawnia do zapisu cudzych danych, a dopuszczenie własnego `Api` w domenie nie dopuszcza własnego `Application`.
- Lokalizacja klasy nie dowodzi jej roli. Nie przenoś logiki między warstwami ani nie kopiuj DTO wyłącznie dla zazielenienia analizy zależności.
- Rozbudowę uzasadnia rzeczywisty invariant lub potrzeba integracji. Nie dodawaj nowych szyn, wspólnych wrapperów wyniku, mapperów, zdarzeń czy stanów procesu bez konkretnej korzyści.
- Typy i importy są tylko częścią kontraktu. Osobno oceń publiczność, semantykę, uprawnienia, spójność, błędy i obserwowalność wykonania.

## 1. Aktywacja i pierwszeństwo
Stosuj ten dokument tylko, gdy aktywne pliki env repo ustawiają końcową wartość:

`CQRS_MONOLITH_STANDARD_OVERRIDES=1`

Aktywne pliki env są ładowane w kolejności nadpisań zgodnej z `<skills_root>/_shared/scripts/env-load.sh`: `.env`, `.env.local` (poza `APP_ENV=test`), `.env.<APP_ENV>`, `.env.<APP_ENV>.local`. `.env.dist` jest szablonem/defaultem dokumentacyjnym, nie aktywnym źródłem runtime.

Każda inna wartość albo brak flagi oznacza, że dokument jest nieaktywny.

- Miejsce tego dokumentu w kolejności reguł określa `runtime-collaboration-guidelines.md` §8: ma pierwszeństwo przed baseline i procedurami runtime, a ustępuje poleceniu użytkownika i lokalnym zasadom repo. Konflikt z tymi źródłami rozstrzygaj według tej kolejności, bez dopytywania.
- Jeśli aktywny dokument jest sprzeczny z instrukcją skilla w sprawie architektonicznej, której ta kolejność nie rozstrzyga, zgłoś rozbieżność użytkownikowi i nie zgaduj rozwiązania.

## 2. Architektura modułowa i warstwy

- Architektura: modularny monolit + hexagonal + CQRS, rozumiane według ich odpowiedzialności, a nie samego układu katalogów.
- Moduł utrzymuj w warstwach `Api`, `Application`, `Domain`, `Infrastructure`, `UI`. `Api` jest opcjonalna; powstaje dla kontraktów danych mechanizmów rozszerzeń (pkt 2.1). Udostępnienie command/query i ich wyników nie wymaga `Api`.
- Nowy kod umieszczaj w istniejących modułach i warstwach; dodanie warstwy wymaga jawnej decyzji. Odpowiedzialność za model i dane pozostaje po stronie modułu właściciela.
- Porty i pluginy opisuje pkt 5, a umiejscowienie klas — pkt 6.1. `Domain/Port/**` służy wyłącznie potrzebom samej domeny, np. repozytorium agregatu; implementuje je adapter właściciela. Nie jest to kontrakt udostępniany innym modułom.
- Zależności warstw określa pkt 7. Uzgodnione techniczne odstępstwa persystencji w `Domain` pozostają jawnie opisane w lokalnym profilu; nie dopuszczają użycia logiki infrastrukturalnej przez domenę.

### 2.1 Warstwa `Api` — kontrakty danych mechanizmów rozszerzeń

- `Api` zawiera opcjonalne, czyste typy danych mechanizmów rozszerzeń: np. pozycje Menu, definicje/query/wyniki Grid, deklaracje uprawnień Security i wynik renderera Email. Ich miejsce wynika z roli kontraktu, nie z liczby konsumentów lub warstw, które ich używają.
- `Api` nie jest miejscem na komunikaty, ich dane wejściowe i wyniki, handlery ani interfejsy usług lub pluginów (pkt 6.1). Typu danych komunikatu nie przenoś do `Api` wyłącznie dlatego, że używa go inny moduł.
- `Api` zawiera enumy, finalne klasy danych `readonly` (w tym atrybuty danych) i wyjątki kontraktu. Fabryki, normalizacja i kontrola poprawności reprezentacji są dopuszczalne; nie wykonują I/O, decyzji biznesowych ani dostępu do wnętrza modułu.
- Zależności `Api` i od `Api` określa pkt 7.1. Mapowanie wnętrza modułu na `Api` wykonuje kod właściciela lub adapter pluginu, nie sam typ kontraktu.
- Obce `Api` nie daje dostępu do usług ani prawa obchodzenia pkt 4.
- **Preferuj niezależność `Domain` od własnego `Api`, ale nie wprowadzaj twardego zakazu.** Czysty typ własnego `Api` może być używany przez Domain, gdy odpowiada pojęciom lub regułom jego modelu. Brak cyklu zależności jest warunkiem koniecznym, nie wystarczającym uzasadnieniem semantycznym.
- Nie twórz kopii typów ani nie przenoś klas wyłącznie dla usunięcia zależności Domain → własne Api. Nie uzasadniaj jednak użycia szczegółów prezentacji lub integracji w domenie samym dozwolonym importem. Nie przenoś modelu domenowego do `Api`, by go upublicznić.
- Zakazu obcego `Api` w `Domain` (pkt 7.1) nie obchodź importem obcego `UseCase` ani przenosinami jednego modułowego typu do `Shared`.
- README właściciela wskazuje publikowane kontrakty rozszerzeń. Zmiany ich typów i semantyki wymagają sprawdzenia konsumentów; zmiany niekompatybilne koordynuj lub wersjonuj.

## 3. Granica UI -> Application
- UI (kontrolery, komponenty, komendy CLI) wchodzi do własnej Application wyłącznie przez komunikaty `Application/UseCase/**` wysyłane przez `CommandBus` (zapis) lub `QueryBus` (odczyt).
- Poza tym UI zależy wyłącznie od tego, co dopuszcza dla niego zamknięta lista w pkt 7.1.
- Integracje z frameworkiem wykonywane przed lub poza busem (np. finalizacja logowania, voter, listener, ustalanie kontekstu) należą do Infrastructure (pkt 5.1), nie do UI.
- Ograniczenie walidacyjne, którego walidator korzysta z Application, deklaruj na komunikacie `UseCase`; walidator należy do Application. UI deklaruje wyłącznie ograniczenia niezależne od Application.
- UI sprawdza autoryzację wyłącznie przez mechanizm frameworka, na podstawie klucza uprawnienia; decyzję dotyczącą konkretnego zasobu otrzymuje z query.
- Dostęp UI do mechanizmu rozszerzeń określa pkt 5.2.
- Tworzenie komunikatów i czystych danych kontraktu oraz mapowanie reprezentacji nie są wywołaniem use case'a ani adaptera. Nie umieszczaj w tych czynnościach biznesowych odczytów lub decyzji domenowych.
- Interakcja z użytkownikiem odbywa się przed wysłaniem komendy. UI/CLI może iterować po wyniku query i wysyłać komendę dla każdej pozycji, jeżeli nie podejmuje przy tym decyzji biznesowych.

### 3.1 `ReadFacade`
- Lokalny `ReadFacade` może składać query dla UI. Korzysta wyłącznie z `QueryBus` i narzędzi prezentacji (np. translator, router), nie zawiera logiki biznesowej ani zapisu. Nie twórz go dla pojedynczego dispatch w jednym miejscu.
- Testy potwierdzają dispatch właściwych query, brak zapisu i obsługę braków danych.

## 4. Komunikacja między modułami i ochrona lokalnego modelu

- Operacje biznesowe innego modułu wywołuj przez `CommandBus` / `QueryBus` i komunikaty z jego `Application/UseCase/Command/**` lub `Query/**` zgodne z wymaganiami pkt 4.1. Wszystkie takie komunikaty są kontraktem modułu bez dodatkowego aktu publikacji.
- Lokalny `Port/Out`, gdy jest potrzebny, opisuje potrzeby konsumenta. Adapter realizuje go przez obcy kontrakt. Nie twórz portu dla każdego dispatch mechanicznie; oddzielenie stabilnej potrzeby od integracji ma dawać rzeczywistą wartość.
- Publicznym kontraktem jest komunikat z danymi i semantyką wykonania, nie handler. Nie wstrzykuj ani nie wywołuj handlerów poza busem, również własnych.
- Dopuszczalne zależności od innych modułów, w tym wysyłkę cudzych komunikatów wyłącznie z lokalnego `Application/Adapter/**`, określa pkt 7.1. Kontrolowany odczyt schematu SQL jest odrębnym wyjątkiem z pkt 7.2.
- **Mapuj obce wyniki UseCase na potrzeby lokalnego kontraktu; wykorzystuj prymitywy i istniejące lokalne typy, zamiast obowiązkowo tworzyć nowe DTO. Nie kopiuj uzgodnionych typów Shared ani kontraktów rozszerzeń Api tylko dla zmiany namespace'u.** Adapter tłumaczy obcy typ danych z `Application/UseCase/**` zanim przekaże wynik do lokalnych handlerów, serwisów, portów lub UI. Lokalny port nie zwraca obcego typu UseCase; brak potrzeby nowej klasy DTO nie oznacza zwolnienia z mapowania.
- Uzgodniony typ `Shared` albo celowo współdzielony typ kontraktu rozszerzenia `Api` może przejść bez tworzenia lokalnego odpowiednika, również gdy dotarł jako wynik query. Sama obecność typu w obcym `Api` nie uzasadnia jego użycia poza rolą rozszerzenia.
- `Shared` zawiera faktycznie wspólne, uzgodnione pojęcia/kontrakty, nie typy przeniesione tam dla obejścia granicy.
- Wyjątek komunikacji busowej stanowi rzeczywisty mechanizm pluginów (pkt 5.2).
- Reszta Application oraz dopuszczone integracje Infrastructure korzystają z lokalnych adapterów/portów. UI stosuje pkt 3.

### 4.1 Wszystkie zgodne komunikaty są kontraktem modułu — bez rejestru

- Wszystkie command/query we wskazanych katalogach, zgodne z wymaganiami kontraktu między modułami, są dostępne dla innych modułów przez ścieżkę pkt 4. Nie potrzeba dodatkowego zgłoszenia, listy w README, oznaczenia publiczności, katalogu `Public`, wspólnej klasy bazowej ani nowej szyny.
- Źródłem budowy kontraktu jest kod: komunikat, typy wejścia/wyniku i zachowanie operacji. Nie utrzymuj równoległego spisu use case'ów ani kopii pól i sygnatur w dokumentacji. Sam katalog lub czysty payload nie dowodzi pełnej zgodności z wymaganiami wykonania i bezpieczeństwa.
- Właściciel zapewnia wymagane preconditions, autoryzację i inwarianty operacji przy jej wykonaniu, w aktualnym stanie. Kontrola wykonana wcześniej lub w innym miejscu, np. w kontrolerze, formularzu, filtrze opcji albo query, jest dopuszczalna, ale jej nie zastępuje: komunikat może przyjść z innego wejścia, a stan mógł się zmienić. Zgodny use case nie może zakładać, że wywoła go wyłącznie konkretny lokalny proces, a ten wcześniej wykona brakującą walidację. Użycie między modułami nie omija wymaganego kontekstu tenant/użytkownika.
- Opisuj tylko semantykę, której nie da się jednoznacznie odczytać z kodu/typów: istotne preconditions i kontekst, znaczenie braków i błędów/blokady, gwarancje sync/async, spójność, retry/idempotencję lub częściowy sukces. Umieszczaj ją przy kontrakcie albo w jednej referencji README/ADR, bez powielania schematu danych i tworzenia rejestru publiczności.
- Komunikaty dostępne między modułami i ich typy danych, również zagnieżdżone pola, kolekcje i interfejsy danych, używają prymitywów, uzgodnionego `Shared`, czystych typów przy use case'ach lub własnego `Api`. Nie zależą od wnętrza właściciela: Domain, Infrastructure, UI ani wewnętrznych DTO. Nie przekazują encji ani bogatego modelu UI; wąski interfejs wyniku jest dopuszczalny tylko wtedy, gdy cały rzeczywisty wynik spełnia kontrakt.
- Komunikaty niespełniające tych wymagań, w tym z bogatszym wynikiem, mogą być używane wyłącznie wewnątrz właściciela, np. z lokalnymi VO; również one nie przekazują encji ani ciężkich modeli. Przed użyciem między modułami dostosuj kontrakt i gwarancje operacji; nie tworzy to osobnego rejestru prywatnych komunikatów. Gdy integracja potrzebuje innego zakresu lub semantyki niż widok UI, przygotuj minimalny model i osobne query.
- Niekompatybilną zmianę kontraktu koordynuj z konsumentami; brak rejestru nie zwalnia ze sprawdzenia użyć w kodzie. W jednym wdrożeniu monolitu można skoordynować zmianę; dla wiadomości już w kolejce lub trwałych payloadów trzeba dodatkowo zapewnić kompatybilność podczas przejścia.

### 4.2 Wynik busa, brak danych i niewykonanie

- Rozróżniaj wynik biznesowy, brak zasobu, odrzucenie/blokadę wykonania i awarię techniczną. Kontrakt mówi, które sytuacje konsument może traktować identycznie.
- Adapter sprawdza rzeczywisty wynik busa (`instanceof`, `is_*`, również elementy kolekcji). Niezgodny typ jest błędem integracji, nie pustym wynikiem; adnotacja `@var` nie jest walidacją.
- `null`/pusta lista mogą być poprawnym wynikiem biznesowym. Nie oznaczają automatycznie niedostępności modułu ani sukcesu zapisu.
- Middleware pomijające handler musi zapewniać obserwowalny sygnał niewykonania, gdy konsument potrzebuje rozróżnienia: np. dedykowany wyjątek lub wynik middleware. Wynik samego handlera nie rozwiąże problemu, jeśli handler nie zostanie uruchomiony. Profil nie narzuca wspólnego `Result<T>` ani jednej implementacji tego sygnału.
- Komenda synchroniczna `void` może być poprawna, gdy normalny powrót oznacza wykonanie, a blokada/odrzucenie są sygnalizowane inaczej. Jeżeli middleware może bezgłośnie pominąć wykonanie, normalny powrót tego nie dowodzi. Dalszy proces nie może zakładać wykonania bez odpowiedniej gwarancji.
- Wysłanie do kolejki lub potwierdzenie przyjęcia nie oznacza wykonania komendy. Nie przedstawiaj go jako sukcesu zakończenia; opisz, jak konsument poznaje wynik, jeśli jest mu potrzebny.
- Dla wymaganych danych/operacji adapter zgłasza lokalny błąd albo jawny stan niepowodzenia. Dla odczytu opcjonalnego może zwrócić brak wyniku. Przy autoryzacji brak dowodu uprawnienia nie daje dostępu; awarii nie maskuj jako zwykłego braku danych.
- Nie zamieniaj dowolnego wyjątku na `null`, pustą listę lub „nie znaleziono”. Testy obejmują poprawny wynik, brak zasobu, niewykonanie, awarię oraz niezgodny typ w zakresie danego kontraktu.

### 4.3 Semantyka CQRS i spójność odczytu

- Query nie wykonuje biznesowej zmiany stanu ani nie uruchamia komend jako ukrytego efektu odczytu. Techniczne logowanie/cache może być dopuszczalne, jeśli nie zmienia wyniku biznesowego, uprawnień lub poprawności i ma jawny cykl życia.
- Command może odczytywać dane potrzebne do wykonania. CQRS nie oznacza write-only handlera ani zakazu odczytu agregatu przed zmianą.
- Inwariant zapisu weryfikuje właściciel operacji na danych i przy zabezpieczeniach zapewniających wymaganą spójność. Potencjalnie opóźniona projekcja nie wystarcza jako jedyna podstawa twardego inwariantu. Sam odczyt, również aktualny, nie usuwa race condition; potrzebne są odpowiednie constraints, blokady lub kontrola wersji.
- Read-side może używać SQL/projekcji bez odtwarzania agregatów. Wspólna baza i model persystencji są dopuszczalne; wymagane jest rozdzielenie odpowiedzialności, nie automatyczne powielenie tabel.
- Wynik komendy może być minimalnym identyfikatorem, potwierdzeniem lub statusem; ograniczenia typów wyniku między modułami określa pkt 4.1.
- Jeśli konsument potrzebuje odczytu po zapisie, kontrakt określa jego gwarancję: np. odczyt stanu zatwierdzonego lub eventual consistency. Nie obiecuj read-your-writes tylko dlatego, że obie operacje przechodzą przez busy.

### 4.4 Transakcje, wiele kroków i efekty zewnętrzne

- Właściciel komendy/procesu określa granicę transakcji i moment, w którym wynik oznacza trwały sukces. Bus i jego nazwa nie dowodzą istnienia ani zasięgu transakcji.
- Dla zagnieżdżonych synchronicznych dispatchów ustal, czy kroki uczestniczą w tej samej transakcji i co oznacza błąd kroku. Nie zakładaj niezależnego commitu lub pełnego rollbacku bez weryfikacji konfiguracji i połączeń.
- Gdy kroki mają być zatwierdzane niezależnie, komenda koordynująca nie działa w transakcji obejmującej kroki; sposób wykonania poza transakcją ustala konfiguracja repo.
- Transakcja obejmująca kilka modułów w jednej bazie jest dopuszczalną decyzją monolitu, gdy wymaga tego biznesowa atomowość, używa odpowiedniego wspólnego połączenia, respektuje właścicieli operacji i ma znany koszt blokad. Nie daje prawa zapisu cudzych tabel z pominięciem kontraktów.
- Nie utrzymuj transakcji bazodanowej przez długie operacje sieciowe bez uzasadnienia i analizy ryzyka. Zewnętrzny efekt nie cofa się automatycznie wraz z rollbackiem bazy.
- Proces obejmujący różne połączenia, async lub efekty zewnętrzne musi określić granice atomowości i zachowanie przy częściowym sukcesie. Nie zakładaj globalnej transakcji tylko dlatego, że kod działa w jednym procesie.
- Retry/idempotencję, deduplikację, kompensację lub outbox stosuj tam, gdzie chronią konkretny wymagany invariant. Nie są obowiązkowymi elementami każdego procesu; nie obiecuj „exactly once” bez mechanizmu zapewniającego deklarowaną gwarancję.
- Testuj istotne scenariusze: błąd późniejszego kroku, ponowienie i efekt przed/po commicie. Niesprawdzone właściwości konfiguracji są luką weryfikacji, nie gwarancją architektury.

### 4.5 Zdarzenia i alternatywy integracji

- Zdarzenia integracyjne nie są obowiązkowe dla CQRS ani modularnego monolitu. Synchroniczna komunikacja przez zgodne kontrakty command/query może być poprawna.
- Zdarzenie domenowe opisuje fakt wewnątrz modelu właściciela i nie staje się automatycznie kontraktem między modułami. Jeżeli jest potrzebna integracja zdarzeniowa, Application właściciela publikuje osobny, czysty kontrakt danych; inni nie importują jego Domain.
- Kontrakt zdarzenia umieszczaj według jawnie przyjętej konwencji projektu, np. `Application/IntegrationEvent/**`. Nie wkładaj go do `Api` wyłącznie dlatego, że jest publiczny; rola `Api` z pkt 2.1 pozostaje wąska. Taka ścieżka podlega regułom zależności (pkt 7) i nie tworzy automatycznie nowej warstwy ani szyny.
- Integrację zdarzeniową wybieraj dla konkretnej potrzeby, np. niezależnych reakcji kilku modułów lub retry. Przed jej użyciem opisz producenta/konsumentów, publikację względem commitu, dostarczenie, kolejność, duplikaty, idempotencję i błędy w zakresie wymaganym przez proces.
- Skonfiguruj kanał i lokalne adaptery odbioru jako jawne rozszerzenie tego profilu. To osobny wyjątek od żądanie–odpowiedź z pkt 4, nie przyzwolenie na dowolne wywołania serwisów poza busami. Bez takiej decyzji nie dodawaj kanału „na zapas”.

## 5. Porty i pluginy
### 5.1 Porty aplikacji i pluginy

Reguły interpretuj z perspektywy modułu właściciela kontraktu, według kierunku zależności i wywołania.

- Portem wejściowym modułu są komunikaty `Application/UseCase/**`: komunikat jest kontraktem wejścia, handler jego implementacją, a bus sposobem wywołania (pkt 3, 4). Moduł nie definiuje interfejsów portów wejściowych.
- `Application/Port/Out` opisuje potrzeby use case'ów wobec I/O, read modelu i integracji. Application używa go, a implementuje Infrastructure lub lokalny adapter. Poza `Port/Out/Plugin` jest prywatny dla modułu.
- Mechanizm rozszerzeń to funkcja właściciela, która zbiera implementacje dostarczane przez moduły (np. Grid, Menu). Plugin to interfejs mechanizmu w `Port/Out/Plugin` i jego implementacja. Wywołuje go wyłącznie Application właściciela; implementują go adaptery, także innych modułów.
- Własna Infrastructure może używać `Port/Out` przy składaniu/dekorowaniu implementacji. Delegacja już zleconego zapisu do innego lokalnego portu nie wymaga kolejnej komendy. Nie tworzy to nowego wejścia biznesowego poza Application.
- Integracja frameworkowa przed/poza busem (np. voter, middleware, ustalanie kontekstu) może użyć własnego portu odczytu, jeśli wejście przez use case wywołałoby rekursję lub udokumentowany, niedopuszczalny koszt. Odczyt respektuje kontekst i bezpieczeństwo, nie wykonuje zapisu biznesowego i nie przenosi decyzji domenowych do Infrastructure.
- Samo „szybciej” lub „mniej klas” nie uzasadnia wyjątku frameworkowego. README opisuje przyczynę, zakres odczytu i gwarancje pomijanej ścieżki. Nie powstaje automatycznie nowa szyna bez transakcji.
- Nie twórz drugiego interfejsu nad tą samą implementacją wyłącznie dla uniknięcia zależności od własnego portu. Węższy interfejs wymaga odrębnej potrzeby lub segregacji odpowiedzialności.
- Interfejs używany wyłącznie przez UI/Infrastructure nie jest portem aplikacji; umieść go przy właścicielu jego roli.

### 5.2 Wybór i kontrakt pluginu

- Operacje udostępniaj jako command/query przez bus. Plugin twórz, gdy właściciel potrzebuje rozszerzeń/providerów/strategii dostarczanych przez inne moduły. Plugin nie jest serwisowym API do ich danych, uniwersalnym CRUD/read API ani opakowaniem jednego command/query; zwracanie danych przez rzeczywisty provider, np. Grid, jest dopuszczalne.
- Właściciel publikuje kontrakt i sposób rejestracji, a zarejestrowane implementacje zbiera i wywołuje wewnątrz swojej Application, np. przez tag DI. Handler właściciela egzekwuje wymagania dostępu zadeklarowane przez provider.
- Implementacja pluginu dostosowuje potrzeby mechanizmu do możliwości własnego modułu: deleguje operacje biznesowe do własnych use case'ów/portów, nie pobiera cudzych repozytoriów i nie ujawnia encji ani szczegółów persystencji.
- Własne UI właściciela korzysta z mechanizmu wyłącznie przez jego komunikaty `UseCase`; UI innych modułów — wyłącznie przez publiczne UI właściciela w `UI/Public/**`. Publiczne UI czyta dane wyłącznie przez query właściciela.
- Gdy konsument (również własne UI dostawcy) wskazuje źródło danych mechanizmu, robi to wartością enuma z `Api` dostawcy, nie klasą implementacji pluginu.
- Gdy mechanizm nie spełnia tych warunków, popraw granicę albo użyj standardowego use case'a zgodnego z pkt 4.1.

## 6. Umiejscowienie i nazewnictwo klas
Ten punkt jest jedynym źródłem reguł, w którym katalogu leży klasa i jaki ma sufiks. Pozostałe punkty określają semantykę i zależności. Katalog wynika z pozycji architektonicznej klasy, a sufiks z jej roli; nie muszą używać tego samego słowa.

### 6.1 Umiejscowienie

| Klasa | Miejsce |
|---|---|
| Komunikat command/query i jego handler | `Application/UseCase/Command/**` lub `Application/UseCase/Query/**` |
| Dane wejściowe i wynik komunikatu | Obok komunikatu; typ wspólny kilku komunikatów — w najbliższym wspólnym katalogu `UseCase` |
| Interfejs portu wyjściowego | `Application/Port/Out/**` |
| Dane wejściowe i wynik portu wyjściowego | Obok portu w `Application/Port/Out/**` |
| Interfejs pluginu | `Application/Port/Out/Plugin/**` właściciela mechanizmu |
| Implementacja pluginu, realizacja lokalnego `Port/Out` przez cudzy kontrakt, translacja między kontraktami | `Application/Adapter/<Context>/**`; katalog nie przyjmuje modeli danych bez funkcji integracyjnej |
| Typ danych mechanizmu rozszerzeń, enum źródła danych pluginu, wyjątek kontraktu rozszerzenia | `Api` (pkt 2.1) |
| Model domeny: encja, value object, enum, zdarzenie domenowe | `Domain/**` |
| Port służący potrzebom samej domeny | `Domain/Port/**` |
| Implementacja `Port/Out` lub `Domain/Port` | `Infrastructure/**`; implementacja przez cudzy kontrakt — `Application/Adapter/**` |
| Model prezentacji, DTO i typ formularza | `UI/**` modułu |
| `ReadFacade` | `UI/ReadFacade/` |
| Uzgodniony kontrakt wspólny | `Shared`; techniczne kontrakty kontekstu wykonania i transakcji — `Shared/Application/Port/**` |

Umiejscowienie integracji frameworka i walidatorów określa pkt 3, rejestru providerów i publicznego UI mechanizmu rozszerzeń — pkt 5.2, kontraktu zdarzenia integracyjnego — pkt 4.5, read modelu SQL — pkt 7.2, a komponentów UI — pkt 11.

### 6.2 Sufiksy

| Sufiks | Rola | Nie używaj, gdy |
|---|---|---|
| `Command`, `Query` | Komunikat zapisu lub odczytu | Klasa nie jest komunikatem, np. jest typem danych komunikatu |
| `Handler` | Handler komunikatu | Klasa nie obsługuje komunikatu z busa |
| `Port` | Interfejs portu wyjściowego lub portu domeny | To komunikat, typ `Api` albo interfejs używany wyłącznie przez UI/Infrastructure (pkt 5.1); sam sufiks nie określa warstwy |
| `Repository`, `RepositoryPort` | Implementacja i kontrakt dostępu do danych; dla read-side `ReadRepository` i `ReadRepositoryPort` | Klasa nie odczytuje ani nie zapisuje danych |
| `Adapter` | Cienka translacja jednego kontraktu na drugi | Pasuje precyzyjniejsza rola (`Provider`, `Resolver`) albo klasa jest głównym miejscem logiki domenowej |
| `Provider` | Dostarcza definicję, konfigurację, strategię lub zestaw danych dla kontraktu, np. jako implementacja pluginu | Klasa tylko tłumaczy wywołanie |
| `Resolver` | Rozstrzyga wybór lub dopasowanie na podstawie wejścia | — |
| `Factory`, `Builder`, `Mapper` | Tworzy obiekt; składa obiekt etapami; przekształca jedną reprezentację w drugą | — |
| `Service` | Logika operacyjna lub orkiestracyjna | Pasuje którykolwiek precyzyjniejszy sufiks |
| `ReadFacade` | Kompozycja query dla UI (pkt 3.1) | — |
| `View`, `RowView`, `ResultView` | Model odczytu: wynik query albo model prezentacji | To dane wejściowe |
| `Criteria` | Dane wejściowe filtrowania, sortowania lub paginacji | To wynik odczytu |
| `DTO` | Neutralny transfer danych | Pasuje `View` lub `Criteria` |

## 7. Zależności warstw i modułów oraz kontrolowany kontrakt SQL
- Reguły zależności obejmują każdą warstwę z pkt 2, w tym `Api`, i egzekwuje je narzędzie skonfigurowane w repo (np. Deptrac). Jego konfiguracja obejmuje wszystkie te warstwy: kod poza nimi nie jest pilnowany, choć nie jest zwolniony z granic, więc nowy katalog warstwy wymaga aktualizacji konfiguracji. Gdy repo nie ma takiego narzędzia, stosuj reguły tego punktu w review i zgłoś brak automatycznej egzekucji.
- Naruszenie poprawiaj w kodzie i granicach odpowiedzialności, nie zmianą reguł ani konfiguracji narzędzia. Wyjątek od reguły zależności to decyzja architektoniczna użytkownika lub właściciela granicy, zapisana w konfiguracji narzędzia z uzasadnieniem, właścicielem i warunkiem usunięcia. Wpis dodany w ramach zmiany bez takiej decyzji nie jest wyjątkiem ani sposobem na przepuszczenie zmiany. Powtarzające się wyjątki między tą samą parą modułów są sygnałem do przeglądu granicy (zdarzenia, odwrócenie zależności przez plugin, przesunięcie odpowiedzialności).
- Zgodność zależności nie dowodzi zgodności komunikatu z pkt 4.1, semantyki pluginu, braku efektów ubocznych, autoryzacji, atomowości, publikacji kontraktu SQL ani znaczenia wyniku busa; te właściwości oceniają czystość typów, review i testy semantyki. Supresje i kod poza warstwami nie są dowodem zgodności.

### 7.1 Macierz zależności

| Warstwa | Własny moduł | Obcy moduł |
|---|---|---|
| `Domain` | Bez `Application`, `Infrastructure` i `UI`; własne `Api` zgodnie z preferencją z pkt 2.1 | Żadna warstwa, również czyste `Api` |
| `Api` | Wyłącznie własne `Api`, neutralne kontrakty `Shared` i typy wbudowane | Żadna warstwa |
| `Application/Adapter` | — | Komunikaty i czyste dane `UseCase` zgodne z pkt 4.1, bez handlerów; `Port/Out/Plugin` wyłącznie przy implementacji pluginu, nie przy jego wywoływaniu; `Api` w zakresie rozszerzenia; kontrakty zdarzeń przez jawnie skonfigurowany kanał (pkt 4.5) |
| Pozostała `Application` | — | `Api` w zakresie rozszerzenia; resztę przez lokalne adaptery i porty (pkt 4) |
| `Infrastructure` | Własne `Port/Out` zgodnie z pkt 5.1 | `Api` w zakresie rozszerzenia; bez obcego `Port/Out`; schemat SQL wyłącznie jako read model z pkt 7.2 |
| `UI` | Wyłącznie: komunikaty i czyste dane `UseCase`, bez handlerów; `Api`; kontrakty kontekstu wykonania `Shared` (odczyt bieżącego tenanta/użytkownika, uruchomienie w kontekście tenanta); value objecty, enumy, wyjątki i niemapowane modele `Domain`, bez innych typów `Domain`; UI i czyste typy `Shared`; zależności zewnętrzne, w tym mechanizm autoryzacji frameworka | `UI/Public/**` właściciela mechanizmu rozszerzeń (pkt 5.2); `Api` w zakresie rozszerzenia |
| Bazowy `Shared` | — | Żaden moduł korzystający z `Shared` |

- Uzgodnione kontrakty `Shared` są dostępne dla warstw modułu; `Api` korzysta tylko z neutralnych.
- Lista dla `UI` jest zamknięta; nowa kategoria wymaga zmiany profilu.
- Zależność od obcego modułu, której tabela nie dopuszcza, jest zabroniona, w tym od obcych repozytoriów, handlerów, wewnętrznych DTO i komunikatów niespełniających pkt 4.1. Nie publikuj interfejsu usługi jako pluginu w zastępstwie busa.

### 7.2 Kontrolowany kontrakt SQL
- Bezpośredni odczyt schematu obcego modułu to świadome sprzężenie danymi, nawet bez importów PHP. Dopuszczalny read model SQL (`SELECT`, także `JOIN` / `UNION` / CTE) musi spełniać wszystkie warunki:
  - działa na jednym połączeniu i w tej samej bazie; nie emuluje joinów między połączeniami;
  - należy do właściciela przekrojowego use case'a, pozostaje w `Infrastructure/Repository/**` i implementuje jego lokalny `Application/Port/Out/**` zakończony `ReadRepositoryPort`;
  - nie importuje obcych encji, repozytoriów, Domain, Infrastructure lub portów Out i nie zapisuje/naprawia/usuwa cudzych danych; użycie `SELECT` nie usprawiedliwia funkcji wykonującej ukryty zapis biznesowy;
  - służy agregacji/reportingowi, nie obejściu zwykłego kontraktu CRUD/read;
  - właściciele źródeł akceptują zakres odczytu jako kontrakt read-side: tabele/kolumny lub widoki/projekcje, ich semantykę i istotne gwarancje świeżości;
  - konsument respektuje tenant scope, soft-delete, uprawnienia do każdego źródła, stabilną paginację i semantykę właścicieli;
  - właściciele komunikują niekompatybilne zmiany schematu i koordynują aktualizację konsumentów; zależność jest opisana i pokryta testami integracyjnymi.
- Test nie czyni prywatnej tabeli publicznym kontraktem. Dokumentacja konsumenta sama nie zastępuje akceptacji właściciela. Stabilny widok/projekcja jest opcją ograniczenia sprzężenia, nie obowiązkiem dla każdego joinu.
- Kod przekrojowego odczytu nie staje się właścicielem cudzych danych. Model odczytu nie może zastąpić wymaganej spójności walidacji zapisu (pkt 4.3).

## 8. Relacje, własność danych i FK
- Preferuj identyfikatory/VO ID zamiast referencji do obcych agregatów. Nie używaj mapowanych relacji encji Doctrine jako domyślnego powiązania między modułami/agregatami; granica modułu nie jest granicą ładowania całego obcego modelu.
- Relacja obiektowa ORM i FK w bazie są osobnymi decyzjami. FK do jawnej tabeli/kolumny w tej samej bazie nie wymaga importu obcej encji i może poprawnie chronić integralność modularnego monolitu.
- **FK stosuj dla referencji, których semantyka wymaga istnienia rekordu docelowego.** Nie każdy identyfikator jest taką referencją: ślad audytowy, historyczny snapshot lub identyfikator zewnętrzny mogą celowo przetrwać usunięcie celu. Opisz tę semantykę i ochronę danych, zamiast dopasowywać domenę do wymuszonego FK.
- Dla referencji wymagającej integralności w tej samej bazie granica modułu sama nie uzasadnia rezygnacji z FK. Ustal właścicieli, zakres tenantowy i cykl życia danych; sam FK po ID nie dowodzi zgodności tenantów ani uprawnienia do użycia zasobu.
- Polityka usuwania jest jawna. Domyślnie `RESTRICT`; `CASCADE` / `SET NULL` między modułami wymagają uzgodnienia właścicieli i ochrony historii. Nie mogą bezgłośnie omijać wymaganej logiki biznesowej właściciela, np. usuwania zasobów zewnętrznych lub emisji istotnych zdarzeń.
- FK nie zastępuje wywołania opublikowanego kontraktu ani autoryzacji. Jest świadomym sprzężeniem schematem i cyklem życia danych, a nie przekazaniem odpowiedzialności biznesowej bazie.
- Wykorzystaj istniejący mechanizm projektu, który utrzymuje deklarowany schemat i migracje w zgodzie. Profil nie wymaga jednego hooka/atrybutu ORM ani wyłącznie jednego sposobu generowania migracji; jest to polityka narzędziowa projektu, nie wymóg CQRS/hexagonal.
- Przed dodaniem FK ustal w lokalnych regułach i kodzie: źródło deklaracji, sposób generowania/utrzymania migracji, walidację/drift schematu, jawny cel i deterministyczną nazwę FK. Nie twórz drugiego konkurencyjnego mechanizmu.
- Kolumny kluczy relacyjnych nazywaj w snake_case, a nazwy FK i tabel łączących utrzymuj spójnie i przewidywalnie według konwencji projektu.
- Gdy projekt deklaruje schemat przez ORM, użyj mechanizmu widocznego dla jego porównania albo jawnie uzgodnionego sposobu utrzymania ograniczeń zarządzanych poza ORM. Nie dopisuj ukrytego FK, który następny diff schematu usuwa. Brak mechanizmu jest decyzją do rozstrzygnięcia przed wdrożeniem ograniczenia.
- Zweryfikuj wygenerowaną lub utrzymywaną migrację i rzeczywistą obecność FK. Indeks sprawdzaj według baseline §4 i potrzeb zapytań/usuwania; nie wymagaj dodatkowego identycznego indeksu, gdy istniejący zapewnia potrzebną obsługę. FK nie zabezpiecza referencji między bazami; ochronę takiej referencji opisuje właściciel.

### 8.1 Wartości pieniężne
- Unikaj `float/decimal` w modelu domenowym i trwałości dla wartości pieniężnych; preferuj liczby całkowite (np. grosze).

## 9. Wiele połączeń i EntityManagerów
- Model wielu connection/EntityManagerów, np. core/tenant, jest dopuszczalny. Repozytoria i konfiguracja jednoznacznie wskazują kontekst bazy.
- Jedna operacja na kilku połączeniach nie ma automatycznie jednej transakcji. Opisz gwarancje, częściowy sukces i retry według pkt 4.4; uwzględnij kontekst tenantowy.
- Nie ukrywaj przenoszenia danych między bazami pod wyjątkiem SQL z pkt 7.2 ani pod FK z pkt 8. Read model SQL z pkt 7.2 wymaga jednego połączenia; FK z pkt 8 chroni relacje w obrębie tej samej bazy, niezależnie od liczby połączeń aplikacyjnych lub EntityManagerów.
- README i migracje opisują konsekwencje wyboru połączeń. Testy weryfikują właściwe routowanie operacji i istotne scenariusze błędów.

## 10. FCF jako preferencja integracji formularza
- FCF (`Form-Command-First`) jest lokalną preferencją dla prostych formularzy, nie wymaganiem CQRS. Można mapować formularz bezpośrednio na command, gdy model edycji i żądanie operacji mają tę samą semantykę.
- DTO formularza jest równoprawnym rozwiązaniem, gdy obsługuje stany częściowe, pola prezentacyjne, różne wejścia do tego samego use case'a lub stabilny kontrakt integracyjny/async. Właściciel podaje krótkie uzasadnienie wyboru, nie musi dowodzić, że DTO narusza preferowany wzorzec.
- Dla create/update preferuj osobne formularze z bazą wspólnych pól. Nie wymuszaj ich połączenia kosztem różnych inwariantów operacji.
- Prefill mapuj jawnie po stronie kodu właściciela, nie rozproszonym ręcznym mapowaniem w kontrolerach. Dla komendy używanej wyłącznie wewnętrznie `fromView(...)` może pozostać fabryką; argument nie staje się polem wiadomości. Komunikat dostępny między modułami nie ma takiej fabryki (pkt 4.1); użyj mappera/fabryki poza typem kontraktu lub DTO formularza.
- Command używany jako `data_class` może mieć publiczne zapisywalne właściwości i być tworzony przez `empty_data` lub przekazany jako dane początkowe. To uzasadnione odstępstwo od preferencji readonly z baseline §2. Komendy niezwiązane z formularzem pozostają `final readonly` według konwencji profilu.
- Dispatch następuje po poprawnej obsłudze i walidacji formularza. Błędne lub częściowe dane nie mogą przypadkiem uruchomić komendy.
- Dla async zapewnij stabilny, serializowalny kontrakt, który nie zależy od cyklu życia formularza ani mutacji po dispatch. Endpointy bez formularzy nie podlegają FCF.

### 10.1 Odczyt danych dla pól formularza
- Typy pól, opcje, callbacki etykiet i transformery identyfikatorów nie wykonują biznesowych odczytów — bezpośrednio ani przez `CommandBus`/`QueryBus`. Dane dla pól i etykiet dostarcza jawny use case wywołany z dopuszczalnego entrypointu zgodnie z pkt 3; warstwa formularza tylko prezentuje i mapuje otrzymane dane.
- Zbiór aktywnych, historycznych i administracyjnych wartości wyboru oraz dopuszczone wyjątki ustala `Application`/`Domain`, nie UI. Wyjątek historyczny dopuszcza wyłącznie konkretny, jawnie wskazany identyfikator albo zakres, nigdy dowolne niedozwolone ID.
- Filtr UI zawęża prezentację, a query dostarczające opcje ustala dopuszczalny model odczytu; żadne z nich nie zatwierdza przyszłego zapisu (pkt 4.1). Brakującej wartości ani niezgodności z kontraktem zapisu nie maskuj dokładaniem opcji lub wyjątków w warstwie formularza.
- Reguła dotyczy pól formularza; nie zakazuje odczytów w jawnych akcjach wyszukiwania inicjowanych przez użytkownika ani nie nakazuje przenoszenia do use case każdej istniejącej ścieżki odczytu UI.

## 11. Komponenty UI w strukturze modułów (gdy repo używa Twig/LiveComponent)
- Komponenty Twig i Live Components trzymaj w warstwie `UI` modułu, który jest właścicielem ich danych, i stosuj jedną konwencję katalogów w całym repo.
- Komponent używany przez kilka modułów umieszczaj w warstwie komponentów współdzielonych (`Shared` albo równoważnej). Komponent i typ formularza mechanizmu rozszerzeń należą do publicznego UI właściciela mechanizmu (pkt 5.2); typ formularza tylko osadza komponent i przekazuje mu konfigurację oraz wartość pola (pkt 10.1). Decyzję o wydzieleniu komponentu podejmuj według kryteriów z `<skills_root>/_shared/references/symfony-ux-twig-components.md`, a nie według samej liczby powtórzeń markupu.
- Komponent nie zawiera logiki biznesowej; dane i akcje realizuje przez use case'y modułu zgodnie z pkt 3.
- Assety komponentu (SCSS/TS/JS) trzymaj przy komponencie albo w module, zgodnie z konwencją repo. Style komponentów importuj do entrypointu stylów modułu, a globalny entrypoint zostaw wyłącznie na style globalne aplikacji.
- Reguły projektowania, markupu i weryfikacji komponentów określają referencje wskazane w baseline `php-symfony-postgres-standards.md` (sekcja o komponentach Twig i Live Components).
