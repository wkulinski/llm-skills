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
- Wyjątek ma konkretny zakres i uzasadnienie w kontrakcie/README; nie rozszerza automatycznie innych wyjątków. Decyzja o joinie nie uprawnia do zapisu cudzych danych, a dopuszczenie własnego `Api` w domenie nie dopuszcza własnego `Application`.
- Lokalizacja klasy nie dowodzi jej roli. Nie przenoś logiki między warstwami ani nie kopiuj DTO wyłącznie dla zazielenienia analizy zależności.
- Rozbudowę uzasadnia rzeczywisty invariant lub potrzeba integracji. Nie dodawaj nowych szyn, wspólnych wrapperów wyniku, mapperów, zdarzeń czy stanów procesu bez konkretnej korzyści.
- Typy i importy są tylko częścią kontraktu. Osobno oceń publiczność, semantykę, uprawnienia, spójność, błędy i obserwowalność wykonania.

## 1. Aktywacja i pierwszeństwo
Stosuj ten dokument tylko, gdy aktywne pliki env repo ustawiają końcową wartość:

`CQRS_MONOLITH_STANDARD_OVERRIDES=1`

Aktywne pliki env są ładowane w kolejności nadpisań zgodnej z `<skills_root>/_shared/scripts/env-load.sh`: `.env`, `.env.local` (poza `APP_ENV=test`), `.env.<APP_ENV>`, `.env.<APP_ENV>.local`. `.env.dist` jest szablonem/defaultem dokumentacyjnym, nie aktywnym źródłem runtime.

Każda inna wartość albo brak flagi oznacza, że dokument jest nieaktywny.
W razie konfliktu z baseline: ten dokument ma pierwszeństwo.

## 2. Architektura modułowa i warstwy

- Architektura: modularny monolit + hexagonal + CQRS, rozumiane według ich odpowiedzialności, a nie samego układu katalogów.
- Moduł utrzymuj w warstwach `Api`, `Application`, `Domain`, `Infrastructure`, `UI`. `Api` jest opcjonalna; powstaje dla kontraktów danych punktów rozszerzeń (pkt 2.1). Udostępnienie command/query i ich wyników nie wymaga `Api`.
- Nowy kod umieszczaj w istniejących modułach i warstwach; dodanie warstwy wymaga jawnej decyzji. Odpowiedzialność za model i dane pozostaje po stronie modułu właściciela.
- Porty aplikacji należą do `Application/Port/In/**` i `Application/Port/Out/**` (pkt 6). `Domain/Port/**` służy wyłącznie potrzebom samej domeny, np. repozytorium agregatu; implementuje je adapter właściciela. Nie jest to kontrakt udostępniany innym modułom.
- `Domain` nie zależy od własnego `Application`, `Infrastructure` lub `UI` ani wnętrza obcych modułów. Uzgodnione techniczne odstępstwa persystencji pozostają jawnie opisane w lokalnym profilu; nie dopuszczają użycia logiki infrastrukturalnej przez domenę. Dopuszczenie własnego `Api` określa pkt 2.1.

### 2.1 Warstwa `Api` — kontrakty danych punktów rozszerzeń

- `Api` zawiera opcjonalne, czyste typy danych mechanizmów rozszerzeń: np. pozycje Menu, definicje/query/wyniki Grid, deklaracje uprawnień Security i wynik renderera Email. Ich miejsce wynika z roli kontraktu, nie z liczby konsumentów lub warstw, które ich używają.
- Dane wejściowe i wyniki command/query należą do `Application/UseCase/**`, obok komunikatu. Typ wspólny kilku komunikatów umieszczaj w najbliższym wspólnym katalogu `UseCase`. Nie przenoś go do `Api` wyłącznie dlatego, że używa go inny moduł.
- Komunikaty pozostają w `Application/UseCase/**`; interfejsy punktów rozszerzeń — w `Application/Port/In/**`. `Api` nie jest miejscem na komunikaty, handlery ani interfejsy usług.
- `Api` zawiera enumy, finalne klasy danych `readonly` (w tym atrybuty danych) i wyjątki kontraktu. Fabryki, normalizacja i kontrola poprawności reprezentacji są dopuszczalne; nie wykonują I/O, decyzji biznesowych ani dostępu do wnętrza modułu.
- `Api` zależy tylko od własnego `Api`, uzgodnionych neutralnych kontraktów `Shared` i typów wbudowanych. Nie importuje `Domain`, `Application`, `Infrastructure` lub `UI`, własnych ani obcych. Nie przyjmuje ich modeli w konstruktorach lub fabrykach.
- Mapowanie wnętrza modułu na `Api` wykonuje kod właściciela lub adapter rozszerzenia, nie sam typ kontraktu.
- Obce `Api` jest dopuszczone w warstwach konsumenta poza `Domain`, w zakresie opublikowanego punktu rozszerzeń. Nie daje dostępu do usług ani prawa obchodzenia pkt 5.
- **Preferuj niezależność `Domain` od własnego `Api`, ale nie wprowadzaj twardego zakazu.** Czysty typ własnego `Api` może być używany przez Domain, gdy odpowiada pojęciom lub regułom jego modelu. Brak cyklu zależności jest warunkiem koniecznym, nie wystarczającym uzasadnieniem semantycznym.
- Nie twórz kopii typów ani nie przenoś klas wyłącznie dla usunięcia zależności Domain → własne Api. Nie uzasadniaj jednak użycia szczegółów prezentacji lub integracji w domenie samym dozwolonym importem. Nie przenoś modelu domenowego do `Api`, by go upublicznić.
- **Domain nie korzysta z obcego `Api`**, również wtedy, gdy typ jest czysty. Nie zastępuj tej zależności importem obcego `UseCase` ani przenosinami jednego modułowego typu do `Shared`.
- README właściciela wskazuje publikowane kontrakty rozszerzeń. Zmiany ich typów i semantyki wymagają sprawdzenia konsumentów; zmiany niekompatybilne koordynuj lub wersjonuj.

## 3. Granica UI -> Application (reguła twarda)
- Domyślne wejście UI/CLI do własnych operacji biznesowych stanowi `CommandBus` dla zapisu i `QueryBus` dla odczytu. Wyjątek stanowi jawnie uzasadniony workflow z pkt 4, nie dowolny serwis aplikacyjny.
- UI nie wywołuje bezpośrednio repozytoriów, `Port/Out`, serwisów domenowych ani adapterów aplikacyjnych/infrastrukturalnych. Wrapper odczytu pod UI pozostaje zgodny z pkt 3.1–3.6.
- Odczyt dispatchuj bezpośrednio albo przez lokalny `UI/ReadFacade/*ReadFacade`, jeśli spełnia pkt 3.1–3.6. Poza workflow nie wywołuj bezpośrednio serwisów Application w celu odczytu/zapisu danych biznesowych.
- Tworzenie komunikatów i czystych danych kontraktu, mapowanie reprezentacji oraz rejestracja pluginu przez `::class` nie są wywołaniem use case'a ani adaptera. Nie umieszczaj w tych czynnościach biznesowych odczytów lub decyzji domenowych.

### 3.1 Tryb domyślny (bez wrappera)
- Domyślnie używaj bezpośredniego dispatch:
  - `QueryBus` dla odczytu,
  - `CommandBus` dla zapisu.
- Jeśli dany odczyt występuje lokalnie w jednym miejscu i nie ma potrzeby kompozycji, nie twórz dodatkowej warstwy.

### 3.2 Dopuszczony wrapper odczytu: `UI/ReadFacade/*ReadFacade`
- Wrapper odczytu jest dopuszczalny wyłącznie dla odczytu danych pod UI.
- Wrapper odczytu umieszczaj w warstwie UI modułu, w katalogu `UI/ReadFacade/`.
- Nazwa klasy wrappera odczytu musi kończyć się sufiksem `ReadFacade`.
- `ReadFacade` jest lokalnym helperem modułu UI:
  - nie jest publicznym kontraktem cross-module,
  - nie zastępuje `Application/UseCase/Query/**`,
  - nie zastępuje workflow `Application/Port/In/**` z pkt 4.

### 3.3 Twarde inwarianty `ReadFacade`
- Spośród zależności aplikacyjnych `ReadFacade` korzysta wyłącznie z `QueryBus`; narzędzia prezentacji (np. translator, router) są dozwolone.
- `ReadFacade` nie może korzystać z:
  - `CommandBus`,
  - `Application/Port/Out/**`,
  - repozytoriów,
  - `Domain/**`,
  - `Infrastructure/**`.
- `ReadFacade` nie zawiera logiki biznesowej:
  - dopuszczalne jest mapowanie i normalizacja danych pod potrzeby prezentacji,
  - niedopuszczalne są decyzje domenowe, reguły walidacyjne i zmiany stanu.

### 3.4 Kiedy warto użyć `ReadFacade`
- Ten sam read-flow jest współdzielony przez co najmniej dwa elementy UI.
- Potrzebujesz stabilnej kompozycji kilku query i jednego, przewidywalnego wyniku dla UI.
- Chcesz usunąć duplikację powtarzalnego kodu `dispatch + kontrola typu + fallback`.

### 3.5 Kiedy nie używać `ReadFacade`
- Odczyt jest pojedynczym dispatch w jednym miejscu.
- Wrapper byłby tylko cienkim "przekazaniem dalej" jednego query bez wartości.
- Wrapper miałby ukrywać zapis, logikę domenową lub dostęp do `Port/Out`.

### 3.6 Wymagania jakości `ReadFacade`
- Każdy `ReadFacade` powinien mieć testy potwierdzające:
  - poprawny dispatch właściwych query,
  - brak side-effectów zapisu,
  - stabilne zachowanie fallbacków/obsługi braków danych.
- W code review traktuj `ReadFacade` jako warstwę UI-read:
  - jeśli pojawia się logika domenowa albo zależność do `Port/Out`, to naruszenie.

## 4. Workflow operacyjny — kontrolowany wyjątek wejścia

- Domyślnie modeluj operację jako command/query. Jeden command może poprawnie koordynować kilka kroków; sama liczba kroków nie uzasadnia nowego entrypointu.
- Workflow operacyjny koordynuje rzeczywisty proces end-to-end: kolejność operacji, częściowe sukcesy, pominięcia, ponowienia lub podsumowanie. Może mieć dedykowany lokalny `Application/Port/In/**` wywoływany z UI/CLI, gdy zwykły kontrakt command/query nie oddaje potrzeb procesu.
- Taki port nie jest serwisowym API dla innych modułów. Inny moduł uruchamia proces przez komendę zgodną z kontraktem między modułami według pkt 5.
- Koordynator workflow nie wywołuje handlerów bezpośrednio; operacje modelowane jako command/query wysyła przez właściwe busy. Nie przenosi inwariantów zapisu z ich właścicieli do koordynatora.
- Bezpośrednie wejście w workflow nie dziedziczy automatycznie middleware busa. Właściciel zapewnia odpowiednią autoryzację, kontekst i kontrakt wykonania procesu; kroki wymagające middleware nadal przechodzą przez bus.
- Wynik wynika z potrzeb konsumenta: raport, identyfikator, status lub `void`. Raport jest częsty, nie obowiązkowy. Gdy kontynuacja wymaga potwierdzenia, obowiązuje pkt 5.2.
- Dla procesu wieloetapowego opisuj atomowość albo częściowy sukces, efekty zewnętrzne i bezpieczny sposób ponowienia (pkt 5.4).

### 4.1 Kryteria zastosowania

- Jest realna odpowiedzialność za koordynację procesu, a nie jedynie dodatkowa warstwa nad pojedynczym dispatch.
- Wskazano, dlaczego osobny entrypoint daje wartość względem jednej komendy albo kompozycji odczytów.
- Właściciel i gwarancje procesu są jawne; UI nie podejmuje za niego decyzji biznesowych.

### 4.2 Niedopuszczalne zastosowania

- Omijanie busa dla prostego CRUD/read, skracanie kodu UI lub maskowanie bezpośredniego dostępu do repozytoriów.
- Zastępowanie read-only `UI/ReadFacade` workflowem bez odpowiedzialności procesowej.
- Tworzenie sztucznych kroków i raportów tylko dla spełnienia checklisty.

### 4.3 Checklista wyjątku

- Czy potrzeba osobnego entrypointu i odpowiedzialność koordynatora są opisane w README?
- Czy zapewniono wymagane zabezpieczenia i wykonanie kroków przez właściwe kontrakty?
- Czy konsument zna wynik, błędy, atomowość/częściowy sukces i zasady ponowienia?
- Czy prostszy command/query lub read facade nie zapewnia tego samego?
- Jeśli nie można uzasadnić wyjątku, pozostaw standardową ścieżkę busową. Liczba kroków i kształt DTO nie zastępują tej oceny.

## 5. Komunikacja między modułami i ochrona lokalnego modelu

- Operacje biznesowe innego modułu wywołuj przez `CommandBus` / `QueryBus` i komunikaty z jego `Application/UseCase/Command/**` lub `Query/**` zgodne z wymaganiami pkt 5.1. Wszystkie takie komunikaty są kontraktem modułu bez dodatkowego aktu publikacji. Wysyłka cudzego komunikatu należy do lokalnego `Application/Adapter/**`.
- Lokalny `Port/Out`, gdy jest potrzebny, opisuje potrzeby konsumenta. Adapter realizuje go przez obcy kontrakt. Nie twórz portu dla każdego dispatch mechanicznie; oddzielenie stabilnej potrzeby od integracji ma dawać rzeczywistą wartość.
- Publicznym kontraktem jest komunikat z danymi i semantyką wykonania, nie handler. Nie wstrzykuj ani nie wywołuj handlerów poza busem, również własnych.
- Nie odwołuj się do obcego `Domain`, `Infrastructure`, `UI`, `Port/Out` lub wewnętrznych DTO. Kontrolowany odczyt schematu SQL jest odrębnym wyjątkiem z pkt 8.1.
- **Mapuj obce wyniki UseCase na potrzeby lokalnego kontraktu; wykorzystuj prymitywy i istniejące lokalne typy, zamiast obowiązkowo tworzyć nowe DTO. Nie kopiuj uzgodnionych typów Shared ani kontraktów rozszerzeń Api tylko dla zmiany namespace'u.** Adapter tłumaczy obcy typ danych z `Application/UseCase/**` zanim przekaże wynik do lokalnych handlerów, serwisów, portów lub UI. Lokalny port nie zwraca obcego typu UseCase; brak potrzeby nowej klasy DTO nie oznacza zwolnienia z mapowania.
- Uzgodniony typ `Shared` albo celowo współdzielony typ kontraktu rozszerzenia `Api` może przejść bez tworzenia lokalnego odpowiednika, również gdy dotarł jako wynik query. Sama obecność typu w obcym `Api` nie uzasadnia jego użycia poza rolą rozszerzenia. Nie przenoś DTO z UseCase do Api ani Shared dla obejścia guardu i nie wprowadzaj obcego Api do Domain.
- `Shared` zawiera faktycznie wspólne, uzgodnione pojęcia/kontrakty, nie typy przeniesione tam dla obejścia granicy. Bazowy Shared nie zależy od modułów korzystających z niego.
- Wyjątek komunikacji busowej stanowi rzeczywisty mechanizm pluginów z pkt 6. Właściciel wywołuje zarejestrowane implementacje, a implementacja odpowiada za delegację do operacji i danych własnego modułu. Nie jest to uniwersalny serwis CRUD obcego modułu.
- Reszta Application oraz dopuszczone integracje Infrastructure korzystają z lokalnych adapterów/portów. UI stosuje pkt 3 i 4. Deklaracja `Provider::class` jest rejestracją, nie wywołaniem adaptera.

### 5.1 Wszystkie zgodne komunikaty są kontraktem modułu — bez rejestru

- Wszystkie command/query we wskazanych katalogach, zgodne z wymaganiami kontraktu między modułami, są dostępne dla innych modułów przez ścieżkę pkt 5. Nie potrzeba dodatkowego zgłoszenia, listy w README, oznaczenia publiczności, katalogu `Public`, wspólnej klasy bazowej ani nowej szyny.
- Źródłem budowy kontraktu jest kod: komunikat, typy wejścia/wyniku i zachowanie operacji. Nie utrzymuj równoległego spisu use case'ów ani kopii pól i sygnatur w dokumentacji. Sam katalog lub czysty payload nie dowodzi pełnej zgodności z wymaganiami wykonania i bezpieczeństwa.
- Właściciel zapewnia wymagane preconditions, autoryzację i inwarianty operacji. Zgodny use case nie może zakładać, że wywoła go wyłącznie konkretny lokalny workflow, a ten wcześniej wykona brakującą walidację. Użycie między modułami nie omija wymaganego kontekstu tenant/użytkownika.
- Opisuj tylko semantykę, której nie da się jednoznacznie odczytać z kodu/typów: istotne preconditions i kontekst, znaczenie braków i błędów/blokady, gwarancje sync/async, spójność, retry/idempotencję lub częściowy sukces. Umieszczaj ją przy kontrakcie albo w jednej referencji README/ADR, bez powielania schematu danych i tworzenia rejestru publiczności.
- Komunikaty dostępne między modułami i ich typy danych używają prymitywów, uzgodnionego `Shared`, czystych typów przy use case'ach lub własnego `Api`. Ochrona obejmuje również zagnieżdżone pola, kolekcje i interfejsy danych. Nie zależą od wnętrza właściciela: Domain, Infrastructure, UI ani wewnętrznych DTO.
- Pomocniczy typ danych nie otrzymuje sufiksu `Command`, `Query` ani `Handler`. Wąski interfejs wyniku jest dopuszczalny, jeśli cały rzeczywisty wynik spełnia kontrakt; sam interfejs nie może maskować zwracania encji.
- Komunikaty niespełniające tych wymagań mogą być używane wyłącznie wewnątrz właściciela, np. z lokalnymi VO; nie przekazują encji lub ciężkich modeli. Przed użyciem między modułami dostosuj kontrakt i gwarancje operacji. Nie tworzy to osobnego rejestru prywatnych komunikatów. Widok UI nie staje się kontraktem integracji; przygotuj minimalny model i osobne query, jeżeli zakres lub semantyka są inne.
- Niekompatybilną zmianę kontraktu koordynuj z konsumentami; brak rejestru nie zwalnia ze sprawdzenia użyć w kodzie. W jednym wdrożeniu monolitu można skoordynować zmianę; dla wiadomości już w kolejce lub trwałych payloadów trzeba dodatkowo zapewnić kompatybilność podczas przejścia.

### 5.2 Wynik busa, brak danych i niewykonanie

- Rozróżniaj wynik biznesowy, brak zasobu, odrzucenie/blokadę wykonania i awarię techniczną. Kontrakt mówi, które sytuacje konsument może traktować identycznie.
- Adapter sprawdza rzeczywisty wynik busa (`instanceof`, `is_*`, również elementy kolekcji). Niezgodny typ jest błędem integracji, nie pustym wynikiem; adnotacja `@var` nie jest walidacją.
- `null`/pusta lista mogą być poprawnym wynikiem biznesowym. Nie oznaczają automatycznie niedostępności modułu ani sukcesu zapisu.
- Middleware pomijające handler musi zapewniać obserwowalny sygnał niewykonania, gdy konsument potrzebuje rozróżnienia: np. dedykowany wyjątek lub wynik middleware. Wynik samego handlera nie rozwiąże problemu, jeśli handler nie zostanie uruchomiony. Profil nie narzuca wspólnego `Result<T>` ani jednej implementacji tego sygnału.
- Obecne zwracanie `null` przez middleware opisuj jako ograniczenie do usunięcia dla operacji wymagających potwierdzenia, a nie dowód zgodności. Można je zachować dla konkretnego opcjonalnego odczytu, jeśli brak zasobu i blokada mają świadomie tę samą semantykę, bez ukrywania wymaganej funkcji.
- Komenda synchroniczna `void` może być poprawna, gdy normalny powrót oznacza wykonanie, a blokada/odrzucenie są sygnalizowane inaczej. Jeżeli middleware może bezgłośnie pominąć wykonanie, normalny powrót tego nie dowodzi. Dalszy proces nie może zakładać wykonania bez odpowiedniej gwarancji.
- Wysłanie do kolejki lub potwierdzenie przyjęcia nie oznacza wykonania komendy. Nie przedstawiaj go jako sukcesu zakończenia; opisz, jak konsument poznaje wynik, jeśli jest mu potrzebny.
- Dla wymaganych danych/operacji adapter zgłasza lokalny błąd albo jawny stan niepowodzenia. Dla odczytu opcjonalnego może zwrócić brak wyniku. Przy autoryzacji brak dowodu uprawnienia nie daje dostępu; awarii nie maskuj jako zwykłego braku danych.
- Nie zamieniaj dowolnego wyjątku na `null`, pustą listę lub „nie znaleziono”. Testy obejmują poprawny wynik, brak zasobu, niewykonanie, awarię oraz niezgodny typ w zakresie danego kontraktu.

### 5.3 Semantyka CQRS i spójność odczytu

- Query nie wykonuje biznesowej zmiany stanu ani nie uruchamia komend jako ukrytego efektu odczytu. Techniczne logowanie/cache może być dopuszczalne, jeśli nie zmienia wyniku biznesowego, uprawnień lub poprawności i ma jawny cykl życia.
- Command może odczytywać dane potrzebne do wykonania. CQRS nie oznacza write-only handlera ani zakazu odczytu agregatu przed zmianą.
- Inwariant zapisu weryfikuje właściciel operacji na danych i przy zabezpieczeniach zapewniających wymaganą spójność. Potencjalnie opóźniona projekcja nie wystarcza jako jedyna podstawa twardego inwariantu. Sam odczyt, również aktualny, nie usuwa race condition; potrzebne są odpowiednie constraints, blokady lub kontrola wersji.
- Read-side może używać SQL/projekcji bez odtwarzania agregatów. Wspólna baza i model persystencji są dopuszczalne; wymagane jest rozdzielenie odpowiedzialności, nie automatyczne powielenie tabel.
- Wynik komendy może być minimalnym identyfikatorem, potwierdzeniem lub statusem. Nie publikuj encji ani bogatego modelu UI jako wyniku integracyjnego. Wynik bogatszy, używany tylko wewnątrz właściciela, nie staje się API innych modułów.
- Jeśli konsument potrzebuje odczytu po zapisie, kontrakt określa jego gwarancję: np. odczyt stanu zatwierdzonego lub eventual consistency. Nie obiecuj read-your-writes tylko dlatego, że obie operacje przechodzą przez busy.

### 5.4 Transakcje, wiele kroków i efekty zewnętrzne

- Właściciel komendy/procesu określa granicę transakcji i moment, w którym wynik oznacza trwały sukces. Bus i jego nazwa nie dowodzą istnienia ani zasięgu transakcji.
- Dla zagnieżdżonych synchronicznych dispatchów ustal, czy kroki uczestniczą w tej samej transakcji i co oznacza błąd kroku. Nie zakładaj niezależnego commitu lub pełnego rollbacku bez weryfikacji konfiguracji i połączeń.
- Transakcja obejmująca kilka modułów w jednej bazie jest dopuszczalną decyzją monolitu, gdy wymaga tego biznesowa atomowość, używa odpowiedniego wspólnego połączenia, respektuje właścicieli operacji i ma znany koszt blokad. Nie daje prawa zapisu cudzych tabel z pominięciem kontraktów.
- Nie utrzymuj transakcji bazodanowej przez długie operacje sieciowe bez uzasadnienia i analizy ryzyka. Zewnętrzny efekt nie cofa się automatycznie wraz z rollbackiem bazy.
- Proces obejmujący różne połączenia, async lub efekty zewnętrzne musi określić granice atomowości i zachowanie przy częściowym sukcesie. Nie zakładaj globalnej transakcji tylko dlatego, że kod działa w jednym procesie.
- Retry/idempotencję, deduplikację, kompensację lub outbox stosuj tam, gdzie chronią konkretny wymagany invariant. Nie są obowiązkowymi elementami każdego workflow; nie obiecuj „exactly once” bez mechanizmu zapewniającego deklarowaną gwarancję.
- Testuj istotne scenariusze: błąd późniejszego kroku, ponowienie i efekt przed/po commicie. Niesprawdzone właściwości konfiguracji są luką weryfikacji, nie gwarancją architektury.

### 5.5 Zdarzenia i alternatywy integracji

- Zdarzenia integracyjne nie są obowiązkowe dla CQRS ani modularnego monolitu. Synchroniczna komunikacja przez zgodne kontrakty command/query może być poprawna.
- Zdarzenie domenowe opisuje fakt wewnątrz modelu właściciela i nie staje się automatycznie kontraktem między modułami. Jeżeli jest potrzebna integracja zdarzeniowa, Application właściciela publikuje osobny, czysty kontrakt danych; inni nie importują jego Domain.
- Kontrakt zdarzenia umieszczaj według jawnie przyjętej konwencji projektu, np. `Application/IntegrationEvent/**`. Nie wkładaj go do `Api` wyłącznie dlatego, że jest publiczny; rola `Api` z pkt 2.1 pozostaje wąska. Dodanie takiej ścieżki wymaga objęcia jej guardem, nie nowej warstwy lub szyny z automatu.
- Integrację zdarzeniową wybieraj dla konkretnej potrzeby, np. niezależnych reakcji kilku modułów lub retry. Przed jej użyciem opisz producenta/konsumentów, publikację względem commitu, dostarczenie, kolejność, duplikaty, idempotencję i błędy w zakresie wymaganym przez proces.
- Skonfiguruj kanał i lokalne adaptery odbioru jako jawne rozszerzenie tego profilu. To osobny wyjątek od żądanie–odpowiedź z pkt 5, nie przyzwolenie na dowolne wywołania serwisów poza busami. Bez takiej decyzji nie dodawaj kanału „na zapas”.

## 6. Reguły `Port/In` i `Port/Out`
### 6.1 Porty aplikacji i konwencja punktów rozszerzeń

Reguły interpretuj z perspektywy modułu właściciela kontraktu, według kierunku zależności i wywołania, nie tylko nazwy katalogu.

- `Application/Port/In` zawiera lokalne workflow entrypointy z pkt 4 oraz interfejsy jawnych punktów rozszerzeń. Typy danych rozszerzeń należą do `Api`.
- Lokalizacja pluginów w `Port/In` jest konwencją projektu, nie twierdzeniem, że ich każde wywołanie jest wejściem do use case'a. Gdy właściciel wywołuje provider, jest to wychodząca zależność w sensie hexagonal, a provider jest dostarczonym adapterem. Kontrakt należy do właściciela punktu rozszerzeń; nie wymaga to drugiego, identycznego interfejsu `Port/Out`.
- `Application/Port/Out` opisuje potrzeby use case'ów wobec I/O, read modelu i integracji. Application używa go, a implementuje Infrastructure lub lokalny adapter. Nie jest wywoływany bezpośrednio przez UI.
- Własna Infrastructure może używać `Port/Out` przy składaniu/dekorowaniu implementacji. Delegacja już zleconego zapisu do innego lokalnego portu nie wymaga kolejnej komendy. Nie tworzy to nowego wejścia biznesowego poza Application.
- Integracja frameworkowa przed/poza busem (np. voter, middleware, ustalanie kontekstu) może użyć własnego portu odczytu, jeśli wejście przez use case wywołałoby rekursję lub udokumentowany, niedopuszczalny koszt. Odczyt respektuje kontekst i bezpieczeństwo, nie wykonuje zapisu biznesowego i nie przenosi decyzji domenowych do Infrastructure.
- Samo „szybciej” lub „mniej klas” nie uzasadnia wyjątku frameworkowego. README opisuje przyczynę, zakres odczytu i gwarancje pomijanej ścieżki. Nie powstaje automatycznie nowa szyna bez transakcji.
- Infrastructure nie używa obcego `Port/Out`. Nie twórz drugiego interfejsu nad tą samą implementacją wyłącznie dla uniknięcia zależności od własnego portu. Węższy interfejs wymaga odrębnej potrzeby lub segregacji odpowiedzialności.
- Interfejs używany wyłącznie przez UI/Infrastructure nie jest portem aplikacji; umieść go przy właścicielu jego roli. Sufiks `Port` nie określa warstwy.
- Płaski `Application/Port` jest legacy. Nie dodawaj tam nowych portów, poza uzgodnionymi technicznymi kontraktami Shared, gdy podział In/Out nie wnosi wartości.

### 6.2 Wybór kontraktu wejścia lub rozszerzenia

- Domyślnie używaj command/query przez bus. Workflow `Port/In` wymaga uzasadnienia z pkt 4.
- Pluginowy port twórz, gdy właściciel potrzebuje rozszerzeń/providerów/strategii dostarczanych przez inne moduły, nie nowego serwisowego API do ich danych.
- Kontrakt i sposób rejestracji publikuje właściciel. Implementacja w lokalnym `Application/Adapter/**` dostosowuje potrzeby rozszerzenia do możliwości własnego modułu.
- Samo opakowanie jednego command/query nie jest ani workflowem, ani mechanizmem rozszerzeń.

### 6.3 Checklista pluginu

- Czy właściciel opisuje rzeczywisty punkt rozszerzeń i jego kontrakt?
- Czy obce moduły dostarczają adaptery, a właściciel zbiera/wywołuje je w tym mechanizmie, np. przez tag DI?
- Czy dane kontraktu są czyste, a implementacja nie ujawnia encji lub szczegółów persystencji?
- Czy provider deleguje operacje biznesowe do własnych use case'ów/portów, zamiast pobierać cudze repozytoria?
- Czy mechanizm nie udaje uniwersalnego CRUD/read API? Zwracanie danych przez rzeczywisty provider, np. Grid, jest dopuszczalne; sam fakt zwracania danych nie dyskwalifikuje pluginu.
- Jeśli odpowiedź jest negatywna, popraw granicę albo użyj standardowego use case'a zgodnego z pkt 5.1.

## 7. Nazewnictwo klas, sufiksy i ścieżka decyzyjna
Poniższe reguły służą do spójnego nazywania klas i katalogów w modularnym monolicie CQRS/hexagonal:
- nazwa klasy odpowiada przede wszystkim jej roli,
- katalog odpowiada przede wszystkim jej pozycji architektonicznej,
- nazwa klasy i nazwa katalogu nie muszą używać tego samego słowa.

### 7.1 Rozdzielenie roli klasy od warstwy
- `Application/Adapter/...` opisuje pozycję architektoniczną:
  - klasa integruje moduł z cudzym kontraktem,
  - implementuje port innego modułu albo tłumaczy jeden kontrakt na drugi.
- sufiks klasy opisuje jej rolę operacyjną:
  - `Adapter`, `Provider`, `Resolver`, `Repository`, `Service`, `Criteria` itp.
- dlatego poniższe połączenia są poprawne:
  - `Application/Adapter/<Context>/<Something>Adapter`,
  - `Application/Adapter/<Context>/<Something>Provider`.
- reguła praktyczna:
  - katalog odpowiada na pytanie: "gdzie ta klasa siedzi w architekturze?",
  - nazwa klasy odpowiada na pytanie: "co ta klasa robi?".

### 7.2 Klasyfikacja najczęstszych sufiksów
- `Port`
  - kontrakt graniczny, zwykle interfejs,
  - nie jest implementacją,
  - przykłady: `SomeUseCasePort`, `SomeResolverPort`, `SomeReadRepositoryPort`.
- `Adapter`
  - implementacja cudzego portu albo translator między kontraktami,
  - zwykle cienka warstwa integracyjna delegująca do domeny, read-side albo infrastruktury,
  - dobry sygnał: klasa istnieje głównie po to, by dopasować model modułu `M` do wymagań modułu `N`.
- `Provider`
  - klasa dostarcza definicję, konfigurację, strategię albo zestaw danych dla określonego kontraktu,
  - `Provider` opisuje rolę, nie warstwę,
  - może legalnie żyć w katalogu `Adapter`, jeśli implementuje obcy port jako punkt rozszerzenia.
- `Resolver`
  - klasa rozstrzyga wybór, dopasowanie albo regułę na podstawie wejścia,
  - często występuje jako adapter do portu typu resolver.
- `Repository`
  - klasa odpowiada za odczyt/zapis danych,
  - kontrakt: `...RepositoryPort`,
  - implementacja: `...Repository`,
  - dla read-side dopuszczalne i zalecane są nazwy doprecyzowane, np. `...GridReadRepository`.
- `Service`
  - nazwa zapasowa dla logiki operacyjnej/orkiestracyjnej, gdy brak lepszego, precyzyjniejszego sufiksu,
  - nie używaj `Service` domyślnie, jeśli realnie lepiej pasują `Resolver`, `Provider`, `Factory`, `Builder`, `Mapper` itp.
- `DTO`
  - neutralny obiekt transferu danych,
  - używaj, gdy repo nie potrzebuje mocniejszego rozróżnienia,
  - jeśli projekt jawnie rozdziela read-side, można preferować `View`, `RowView`, `ResultView`, `QueryModel`.
- `View` / `RowView` / `ResultView`
  - model odczytu dla UI lub read-side,
  - preferowany tam, gdzie nazwa ma ujawniać, że obiekt reprezentuje wynik odczytu, a nie input use case'a.

### 7.3 Kiedy `Adapter` jest trafny
Słowo `Adapter` jest trafne, gdy klasa spełnia większość poniższych warunków:
- implementuje port z innego modułu albo kontrakt frameworkowy,
- tłumaczy jeden model wejścia/wyjścia na drugi,
- sama nie jest głównym miejscem logiki domenowej,
- deleguje do domeny, read-side, repozytorium lub innego serwisu,
- istnieje głównie po to, by połączyć dwa konteksty.

Przykłady trafnego użycia:
- `Application/Adapter/<Context>/<Something>Adapter`,
- `Application/Adapter/<Context>/<Something>ResolverAdapter`.

Przykład dopuszczalny, choć bardziej graniczny:
- `Application/Adapter/<Context>/<Something>Provider`,
  - katalog `Adapter` jest poprawny, bo klasa integruje moduł biznesowy z cudzym punktem rozszerzenia lub portem,
  - nazwa `Provider` jest poprawna, bo opisuje rolę klasy w tym kontrakcie.

### 7.4 Czego nie wkładać do `Adapter`
Do katalogu `Adapter` nie wkładaj modeli, które nie pełnią funkcji integracyjnej:
- `FilterInput`,
- `SortInput`,
- `QueryModel`,
- prostych `DTO`,
- lokalnych modeli read-side, jeśli nie implementują obcego kontraktu.

Jeśli taka klasa jest tylko modelem danych dla read-side lub wyszukiwania, preferuj lokalizacje:
- `Application/QueryModel/...`,
- `Application/View/...`,
- `Application/Grid/...`,
- albo inny katalog opisujący model, nie integrację.

### 7.5 Ścieżka decyzyjna
Przy dodawaniu nowej klasy przejdź przez poniższe pytania w kolejności:
1. Czy to jest kontrakt graniczny?
   - tak -> jeśli to interfejs potrzeb/operacji, wybierz właściwy port według pkt 6; jeśli to komunikat lub typ danych kontraktu, stosuj pkt 2.1 i 5. Samo słowo „kontrakt” nie oznacza sufiksu `Port`.
2. Czy to implementuje cudzy port albo tłumaczy kontrakt modułu `A` na kontrakt modułu `B`?
   - tak -> katalog `Application/Adapter/...`.
3. Jeśli to adapter: jaka jest jego rzeczywista rola?
   - dostarcza definicję / zestaw możliwości -> `Provider`,
   - rozstrzyga dopasowanie / wybór -> `Resolver`,
   - po prostu cienko translatuje kontrakt -> `Adapter`.
4. Czy to jest tylko model wejścia do wyszukiwania, filtrowania, sortowania lub paginacji?
   - tak -> `Criteria` / `QueryModel` / `FilterInput`, ale nie `Adapter`.
5. Czy to jest model odczytu dla UI lub read-side?
   - tak -> `View` / `RowView` / `ResultView` albo `DTO`. Dane kontraktu command/query umieszczaj przy komunikacie w `Application/UseCase/**`; dane mechanizmu rozszerzeń — w `Api`. Widok własnego UI nie staje się automatycznie żadnym z tych kontraktów. Publiczność określa pkt 5.1, nie sam katalog.
6. Czy to jest dostęp do danych?
   - tak -> `Repository` albo `RepositoryPort`.
7. Czy to jest logika operacyjna lub orkiestracyjna bez lepszego precyzyjnego sufiksu?
   - tak -> `Service`.

## 8. Deptrac jako hard guard
- Granice warstw/modułów są egzekwowane przez Deptrac.
- Naruszeń zależności nie „obchodzimy” zmianą reguł bez decyzji architektonicznej.
- Domyślna reakcja na naruszenie: poprawa kodu i granic odpowiedzialności.
- Konfiguracja Deptrac obejmuje każdą warstwę z pkt 2, w tym `Api`. Klasa spoza warstw (uncovered) nie jest pilnowana, więc nowy katalog warstwy wymaga aktualizacji konfiguracji.
- Wyjątek (skip) w Deptracu to decyzja architektoniczna z uzasadnieniem, właścicielem i warunkiem usunięcia, a nie sposób na przepuszczenie zmiany. Powtarzające się wyjątki między tą samą parą modułów są sygnałem do przeglądu granicy (zdarzenia, odwrócenie zależności przez `Port/In`, przesunięcie odpowiedzialności).
- Gdy repo nie ma Deptraca, stosuj pkt 8.1 w review i zgłoś brak automatycznej egzekucji.

### 8.1 Zależności między modułami i kontrolowany kontrakt SQL

- Dozwolone zależności PHP:
  - z lokalnego `Application/Adapter/**` do komunikatów i czystych danych use case'ów właściciela zgodnych z pkt 5.1, bez handlerów;
  - z lokalnego `Application/Adapter/**` do obcego `Application/Port/In/**` przy implementacji opublikowanego pluginu, nie wywoływaniu cudzego workflow;
  - do opublikowanego obcego `Api` z warstw poza Domain w zakresie rozszerzenia;
  - do uzgodnionych kontraktów Shared, bez odwrotnej zależności bazowego Shared;
  - do kontraktów integracji zdarzeniowej wyłącznie przez jawnie skonfigurowane adaptery i kanał według pkt 5.5.
- Niedozwolone są zależności do obcego Domain, Infrastructure, UI, repozytoriów, `Port/Out`, wewnętrznych DTO, handlerów i komunikatów niespełniających wymagań pkt 5.1. Nie używaj serwisowego `Port/In` jako zamiennika busa.
- Bezpośredni odczyt schematu obcego modułu to świadome sprzężenie danymi, nawet bez importów PHP. Dopuszczalny read model SQL (`SELECT`, także `JOIN` / `UNION` / CTE) musi spełniać wszystkie warunki:
  - działa na jednym połączeniu i w tej samej bazie; nie emuluje joinów między połączeniami;
  - należy do właściciela przekrojowego use case'a, pozostaje w `Infrastructure/Repository/**` i implementuje jego lokalny `Application/Port/Out/**` zakończony `ReadRepositoryPort`;
  - nie importuje obcych encji, repozytoriów, Domain, Infrastructure lub portów Out i nie zapisuje/naprawia/usuwa cudzych danych; użycie `SELECT` nie usprawiedliwia funkcji wykonującej ukryty zapis biznesowy;
  - służy agregacji/reportingowi, nie obejściu zwykłego kontraktu CRUD/read;
  - właściciele źródeł akceptują zakres odczytu jako kontrakt read-side: tabele/kolumny lub widoki/projekcje, ich semantykę i istotne gwarancje świeżości;
  - konsument respektuje tenant scope, soft-delete, uprawnienia do każdego źródła, stabilną paginację i semantykę właścicieli;
  - właściciele komunikują niekompatybilne zmiany schematu i koordynują aktualizację konsumentów; zależność jest opisana i pokryta testami integracyjnymi.
- Test nie czyni prywatnej tabeli publicznym kontraktem. Dokumentacja konsumenta sama nie zastępuje akceptacji właściciela. Stabilny widok/projekcja jest opcją ograniczenia sprzężenia, nie obowiązkiem dla każdego joinu.
- Kod przekrojowego odczytu nie staje się właścicielem cudzych danych. Model odczytu nie może zastąpić wymaganej spójności walidacji zapisu (pkt 5.3).
- Deptrac obejmuje `Api`, adaptery, kontrakty use case'ów, handlery i porty. Guard ogranicza użycia obcych komunikatów/typów UseCase do adapterów oraz dopuszcza obce Api zgodnie z pkt 2.1. Zgodność z pkt 5.1 oceniają reguły czystości typów, review i testy semantyki; samo objęcie całego katalogu warstwą nie dowodzi zgodności każdego komunikatu. Nie twórz dodatkowego rejestru publiczności na potrzeby guardu.
- Domain może zależeć od własnego Api zgodnie z pkt 2.1; guard nie wprowadza zakazu tej zależności. Zależność Domain do obcego Api pozostaje zabroniona.
- Guard zależności nie dowodzi semantyki pluginu, braku side effectów, autoryzacji, atomowości, publikacji kontraktu SQL ani znaczenia wyniku busa. Review i testy oceniają te właściwości osobno. Klasy uncovered, konfiguracja bez Api oraz supresje nie są dowodem zgodności.

## 9. Relacje, własność danych i FK
- Preferuj identyfikatory/VO ID zamiast referencji do obcych agregatów. Nie używaj mapowanych relacji encji Doctrine jako domyślnego powiązania między modułami/agregatami; granica modułu nie jest granicą ładowania całego obcego modelu.
- Relacja obiektowa ORM i FK w bazie są osobnymi decyzjami. FK do jawnej tabeli/kolumny w tej samej bazie nie wymaga importu obcej encji i może poprawnie chronić integralność modularnego monolitu.
- **FK stosuj dla referencji, których semantyka wymaga istnienia rekordu docelowego.** Nie każdy identyfikator jest taką referencją: ślad audytowy, historyczny snapshot lub identyfikator zewnętrzny mogą celowo przetrwać usunięcie celu. Opisz tę semantykę i ochronę danych, zamiast dopasowywać domenę do wymuszonego FK.
- Dla referencji wymagającej integralności w tej samej bazie granica modułu sama nie uzasadnia rezygnacji z FK. Ustal właścicieli, zakres tenantowy i cykl życia danych; sam FK po ID nie dowodzi zgodności tenantów ani uprawnienia do użycia zasobu.
- Polityka usuwania jest jawna. Domyślnie `RESTRICT`; `CASCADE` / `SET NULL` między modułami wymagają uzgodnienia właścicieli i ochrony historii. Nie mogą bezgłośnie omijać wymaganej logiki biznesowej właściciela, np. usuwania zasobów zewnętrznych lub emisji istotnych zdarzeń.
- FK nie zastępuje wywołania opublikowanego kontraktu ani autoryzacji. Jest świadomym sprzężeniem schematem i cyklem życia danych, a nie przekazaniem odpowiedzialności biznesowej bazie.
- Wykorzystaj istniejący mechanizm projektu, który utrzymuje deklarowany schemat i migracje w zgodzie. Profil nie wymaga jednego hooka/atrybutu ORM ani wyłącznie jednego sposobu generowania migracji; jest to polityka narzędziowa projektu, nie wymóg CQRS/hexagonal.
- Przed dodaniem FK ustal w lokalnych regułach i kodzie: źródło deklaracji, sposób generowania/utrzymania migracji, walidację/drift schematu, jawny cel i deterministyczną nazwę FK. Nie twórz drugiego konkurencyjnego mechanizmu.
- Gdy projekt deklaruje schemat przez ORM, użyj mechanizmu widocznego dla jego porównania albo jawnie uzgodnionego sposobu utrzymania ograniczeń zarządzanych poza ORM. Nie dopisuj ukrytego FK, który następny diff schematu usuwa. Brak mechanizmu jest decyzją do rozstrzygnięcia przed wdrożeniem ograniczenia.
- Zweryfikuj wygenerowaną lub utrzymywaną migrację i rzeczywistą obecność FK. Indeks sprawdzaj według baseline §4 i potrzeb zapytań/usuwania; nie wymagaj dodatkowego identycznego indeksu, gdy istniejący zapewnia potrzebną obsługę. FK nie zabezpiecza referencji między bazami; ochronę takiej referencji opisuje właściciel.

### 9.1 Dodatkowe zasady danych (profil rozszerzony)
- Unikaj `float/decimal` w modelu domenowym i trwałości dla wartości pieniężnych; preferuj liczby całkowite (np. grosze).
- W kluczach relacyjnych używaj spójnego nazewnictwa snake_case oraz jawnych indeksów.
- Nazwy kluczy obcych i tabel łączących utrzymuj spójnie i przewidywalnie (konwencja projektu).

## 10. Wiele połączeń i EntityManagerów
- Model wielu connection/EntityManagerów, np. core/tenant, jest dopuszczalny. Repozytoria i konfiguracja jednoznacznie wskazują kontekst bazy.
- Jedna operacja na kilku połączeniach nie ma automatycznie jednej transakcji. Opisz gwarancje, częściowy sukces i retry według pkt 5.4; uwzględnij kontekst tenantowy.
- FK i przekrojowy join wymagają wspierającego je kontekstu bazy; w tym profilu wyjątek SQL wymaga jednego połączenia. Nie ukrywaj przenoszenia danych między bazami pod tym wyjątkiem.
- README i migracje opisują konsekwencje wyboru połączeń. Testy weryfikują właściwe routowanie operacji i istotne scenariusze błędów.

## 11. FCF jako preferencja integracji formularza
- FCF (`Form-Command-First`) jest lokalną preferencją dla prostych formularzy, nie wymaganiem CQRS. Można mapować formularz bezpośrednio na command, gdy model edycji i żądanie operacji mają tę samą semantykę.
- DTO formularza jest równoprawnym rozwiązaniem, gdy obsługuje stany częściowe, pola prezentacyjne, różne wejścia do tego samego use case'a lub stabilny kontrakt integracyjny/async. Właściciel podaje krótkie uzasadnienie wyboru, nie musi dowodzić, że DTO narusza preferowany wzorzec.
- Dla create/update preferuj osobne formularze z bazą wspólnych pól. Nie wymuszaj ich połączenia kosztem różnych inwariantów operacji.
- Prefill mapuj jawnie po stronie kodu właściciela, nie rozproszonym ręcznym mapowaniem w kontrolerach. Dla komendy używanej wyłącznie wewnętrznie `fromView(...)` może pozostać fabryką; argument nie staje się polem wiadomości. **Komunikat dostępny między modułami według pkt 5.1 nie zależy od wewnętrznego widoku przez taką fabrykę** — użyj mappera/fabryki poza typem kontraktu lub DTO formularza.
- Command używany jako `data_class` może mieć publiczne zapisywalne właściwości i być tworzony przez `empty_data` lub przekazany jako dane początkowe. To uzasadnione odstępstwo od preferencji readonly z baseline §2. Komendy niezwiązane z formularzem pozostają `final readonly` według konwencji profilu.
- Dispatch następuje po poprawnej obsłudze i walidacji formularza. Błędne lub częściowe dane nie mogą przypadkiem uruchomić komendy. Walidacja formularza nie zastępuje autoryzacji i inwariantów zapisu w Application/Domain.
- Dla async zapewnij stabilny, serializowalny kontrakt, który nie zależy od cyklu życia formularza ani mutacji po dispatch. Endpointy bez formularzy nie podlegają FCF.

### 11.1 Odczyt danych dla pól formularza
- Typy pól, opcje, callbacki etykiet i transformery identyfikatorów nie wykonują biznesowych odczytów — bezpośrednio ani przez `CommandBus`/`QueryBus`.
- Dane dla pól i etykiet dostarcza jawny use case wywołany z dopuszczalnego entrypointu zgodnie z pkt 3; warstwa formularza tylko prezentuje i mapuje otrzymane dane.
- Zbiór aktywnych, historycznych i administracyjnych wartości wyboru oraz dopuszczone wyjątki ustala `Application`/`Domain`, nie UI.
- Filtr UI zawęża prezentację, ale nie zastępuje walidacji zapisu; brakującej wartości nie maskuj dokładaniem opcji w warstwie formularza.
- Wyjątek historyczny dopuszcza wyłącznie konkretny, jawnie wskazany identyfikator albo zakres, nigdy dowolne niedozwolone ID.
- Reguła dotyczy pól formularza; nie zakazuje odczytów w jawnych akcjach wyszukiwania inicjowanych przez użytkownika ani nie nakazuje przenoszenia do use case każdej istniejącej ścieżki odczytu UI.
- Query dostarczające opcje ustala dopuszczalny model odczytu, nie zatwierdza przyszłego zapisu. Command ponownie sprawdza istotne uprawnienia i inwarianty w aktualnym stanie.
- Obsługa historycznych identyfikatorów pozostaje jawna i ograniczona. Nie rozszerzaj listy opcji ani wyjątków UI, aby ukryć brak zgodności z kontraktem zapisu.

## 12. Komponenty UI w strukturze modułów (gdy repo używa Twig/LiveComponent)
- Komponenty Twig i Live Components trzymaj w warstwie `UI` modułu, który jest właścicielem ich danych, i stosuj jedną konwencję katalogów w całym repo.
- Komponent używany przez kilka modułów umieszczaj w warstwie komponentów współdzielonych (`Shared` albo równoważnej). Decyzję o wydzieleniu komponentu podejmuj według kryteriów z `<skills_root>/_shared/references/symfony-ux-twig-components.md`, a nie według samej liczby powtórzeń markupu.
- Komponent nie zawiera logiki biznesowej; dane i akcje realizuje przez use case'y modułu zgodnie z pkt 3.
- Assety komponentu (SCSS/TS/JS) trzymaj przy komponencie albo w module, zgodnie z konwencją repo. Style komponentów importuj do entrypointu stylów modułu, a globalny entrypoint zostaw wyłącznie na style globalne aplikacji.
- Reguły projektowania, markupu i weryfikacji komponentów określają referencje wskazane w baseline `php-symfony-postgres-standards.md` (sekcja o komponentach Twig i Live Components).

## 13. Pierwszeństwo i konflikty
- Miejsce tego dokumentu w kolejności reguł określa `runtime-collaboration-guidelines.md` §8: ma pierwszeństwo przed baseline i procedurami runtime, a ustępuje poleceniu użytkownika i lokalnym zasadom repo. Konflikt z tymi źródłami rozstrzygaj według tej kolejności, bez dopytywania.
- Jeśli aktywny dokument jest sprzeczny z instrukcją skilla w sprawie architektonicznej, której ta kolejność nie rozstrzyga, zgłoś rozbieżność użytkownikowi i nie zgaduj rozwiązania.
