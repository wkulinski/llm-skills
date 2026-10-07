# CQRS Monolith Standard Overrides

Ten dokument rozszerza baseline `php-symfony-postgres-standards.md` o reguły modularnego monolitu z modułami w architekturze heksagonalnej i CQRS. Większość reguł uzupełnia baseline; reguła, która go zmienia, nazywa w treści odstępstwo i wskazuje sekcję baseline.

## 1. Aktywacja i pierwszeństwo
Stosuj ten dokument tylko, gdy aktywne pliki env repo ustawiają końcową wartość:

`CQRS_MONOLITH_STANDARD_OVERRIDES=1`

Aktywne pliki env są ładowane w kolejności nadpisań zgodnej z `<skills_root>/_shared/scripts/env-load.sh`: `.env`, `.env.local` (poza `APP_ENV=test`), `.env.<APP_ENV>`, `.env.<APP_ENV>.local`. `.env.dist` jest szablonem/defaultem dokumentacyjnym, nie aktywnym źródłem runtime.

Każda inna wartość albo brak flagi oznacza, że dokument jest nieaktywny.
W razie konfliktu z baseline: ten dokument ma pierwszeństwo.

## 2. Architektura modułowa i warstwy
- Architektura: modularny monolit + hexagonal + CQRS.
- Moduł utrzymuj w warstwach: `Api`, `Application`, `Domain`, `Infrastructure`, `UI`. `Api` jest opcjonalna; powstaje, gdy moduł publikuje typy dla innych modułów (pkt 2.1).
- Cały nowy kod umieszczaj w istniejących modułach/warstwach; nie dodawaj nowych warstw bez jawnej decyzji.
- Porty umieszczaj w `Application/Port/In/**` i `Application/Port/Out/**` (pkt 6). `Domain/Port/**` służy wyłącznie zależnościom wychodzącym samej domeny (np. repozytorium agregatu, hasher), implementowanym w `Infrastructure`; nie jest kontraktem dla innych modułów.

### 2.1 Warstwa `Api` (opublikowany kontrakt modułu)
- `Api` zawiera typy danych publikowane innym modułom poza komunikatami busa: typy wyników query konsumowanych przez inne moduły, enumy i VO używane w komunikatach lub wynikach oraz definicje dostarczane do punktów rozszerzeń modułu (np. kolumny gridu, pozycje menu, uprawnienia).
- Komunikaty `Command` / `Query` zostają w `Application/UseCase/**` (pkt 5), a kontrakty pluginowe w `Application/Port/In/**` (pkt 6). `Api` nie jest drugim miejscem na żadne z nich.
- `Api` zawiera wyłącznie typy danych i wyjątki kontraktu: bez serwisów, handlerów, logiki biznesowej i interfejsów usług wywoływanych przez inne moduły.
- `Api` zależy tylko od własnego `Api`, kontraktów z `Shared` i typów wbudowanych; nie importuje `Domain`, `Application` ani `Infrastructure` własnego modułu.
- Klasy w `Api` nie znają wnętrza modułu: nie przyjmują encji, VO domenowych ani widoków modułu w konstruktorach ani fabrykach. Dane do typu `Api` przepisuje moduł właściciel, np. handler query w `Application`.
- `Api` innego modułu jest jego publicznym kontraktem: może z niego korzystać każda warstwa konsumenta poza `Domain`. `Domain` zależy wyłącznie od własnej domeny, własnego `Api` i `Shared`, więc nie zna kontraktów innych modułów.
- `Domain` może używać własnego `Api`, bo `Api` nie zależy od wnętrza modułu i kierunek zależności pozostaje jednostronny. Nie twórz w domenie kopii typów `Api` tylko po to, aby uniknąć tej zależności.
- Reguła dotyczy typów. To, gdzie wywołuje się inne moduły i tłumaczy ich dane, określa pkt 5.
- Zmiana typu w `Api` jest zmianą kontraktu: przed zmianą sprawdź konsumentów i dostosuj ich w tej samej zmianie.

## 3. Granica UI -> Application (reguła twarda)
- Warstwa UI (`Controller`, komendy CLI, `TwigComponent`, `LiveComponent`) wywołuje logikę modułu:
  - bezpośrednio przez `CommandBus` / `QueryBus`,
  - albo przez lokalny wrapper odczytu `UI/ReadFacade/*ReadFacade` zgodny z regułami z pkt 3.2.
- Zmianę stanu realizuj wyłącznie przez `CommandBus` i klasy z `Application/UseCase/Command/**` tego samego modułu.
- Odczyt danych realizuj przez `QueryBus` i klasy z `Application/UseCase/Query/**` tego samego modułu:
  - bezpośrednio w komponencie/kontrolerze/komendzie CLI,
  - albo pośrednio przez `UI/ReadFacade/*ReadFacade`, jeśli spełnione są kryteria z pkt 3.4.
- UI nie wywołuje bezpośrednio `Application Service`, `Port/Out`, repozytoriów, serwisów domenowych ani adapterów infrastruktury.
- UI nie tworzy własnych ścieżek odczytu/zapisu danych poza regułami z pkt 3.1-3.6.

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

## 4. Workflow operacyjny (jedyny wyjątek od reguły z pkt 3)
- Workflow operacyjny to wyjątek dla operacji wieloetapowych, które orkiestrują kilka use case i zwracają raport procesu.
- Workflow operacyjny może być wywołany z UI przez dedykowany `Application/Port/In/**` zamiast pojedynczego `Command` / `Query`.
- Workflow operacyjny nie może być pretekstem do omijania busa dla CRUD i prostych odczytów.
- Workflow operacyjny nie jest substytutem `UI/ReadFacade/*ReadFacade`: facady służą tylko do odczytu pod UI, a workflow do orkiestracji procesu end-to-end.

### 4.1 Co jest workflow operacyjnym
- Operacja uruchamia co najmniej dwa kroki use case i koordynuje ich kolejność.
- Operacja zawiera logikę przekrojową (np. synchronizacja katalogu + aktualizacja tieru + aktualizacja grup uprawnień).
- Operacja zwraca raport procesu (statusy kroków, pominięcia, podsumowanie).

### 4.2 Co nie jest workflow operacyjnym
- Pojedynczy CRUD (`create`, `update`, `delete`, `get`, `list`).
- Jedna komenda lub jedno zapytanie opakowane w serwis "dla wygody".
- Ominięcie busa wyłącznie po to, aby skrócić kod UI.
- Bezpośredni dostęp UI do `Port/Out` lub repozytorium pod pretekstem "szybszego odczytu".

### 4.3 Checklista wyjątku workflow
- Czy operacja składa się z co najmniej dwóch kroków use case?
- Czy operacja koordynuje proces end-to-end, a nie pojedyncze wywołanie?
- Czy wynik operacji jest raportem procesu, a nie zwykłym DTO CRUD?
- Czy modelowanie jako pojedynczy `Command` / `Query` byłoby sztuczne?
- Czy wyjątek został jawnie opisany w README modułu?
- Jeśli którekolwiek pytanie ma odpowiedź "nie", wróć do reguły z pkt 3.

## 5. Komunikacja `Application` -> inne moduły i udostępnianie danych
- Warstwa `Application` odpytuje inne moduły wyłącznie przez `CommandBus` / `QueryBus` i publiczne klasy `Application/UseCase/Command/**` oraz `Application/UseCase/Query/**` modułu docelowego.
- Publicznym kontraktem use case'a jest komunikat (`Command` / `Query`), a nie jego handler. Handler jest wewnętrznym szczegółem modułu: nie wstrzykuj go ani nie wywołuj poza busem, także gdy leży w tym samym katalogu co komunikat, bo pominięcie busa pomija jego middleware (transakcje, async, autoryzację).
- Komunikat wysyłany przez inny moduł i wynik query, który ten moduł odbiera, są częścią kontraktu: pola komunikatu i wynik używają wyłącznie prymitywów, typów z `Shared` albo `Api` modułu właściciela (pkt 2.1). Zanim inny moduł zacznie wysyłać istniejący komunikat, doprowadź go do tej postaci.
- Widok budowany pod własne UI modułu nie staje się przez to kontraktem dla innych modułów. Gdy inny moduł potrzebuje tych danych, udostępnij mu osobny, minimalny typ w `Api` (i osobne query, gdy zakres danych się różni), zamiast publikować widok UI.
- `Shared` przechowuje wyłącznie kontrakty faktycznie wspólne (np. identyfikatory, kwoty), a nie typy jednego modułu przeniesione tam, by ominąć granicę.
- Warstwa `Application` nie odwołuje się bezpośrednio do `Domain` ani `Infrastructure` obcego modułu.
- Wyjątek od reguły busowej: kontrakty pluginowe `Application/Port/In/**` modułu docelowego, jeśli moduł docelowy publikuje jawnie punkt rozszerzeń (np. provider/resolver), a moduł wywołujący dostarcza implementację tego kontraktu.
- Kontrakt pluginowy `Port/In` nie zastępuje `Command` / `Query` dla odczytu i zapisu danych biznesowych między modułami.
- Kompozycja, mapowanie i tłumaczenie danych cross-module dzieją się w lokalnych adapterach `Application/Adapter/**` modułu wywołującego.
- Pozostałe warstwy modułu wywołującego (`UI`, `Infrastructure`, reszta `Application`) nie wywołują innych modułów samodzielnie, tylko korzystają z jego lokalnych adapterów i use case'ów. Mogą przy tym używać typów z cudzego `Api` (pkt 2.1), np. jako parametrów i wyników metod.
- Messages przekazywane przez bus przyjmują proste argumenty (`prymitywy` / `VO`), bez przekazywania encji i ciężkich DTO. VO domenowe są dozwolone tylko w komunikatach wewnątrz modułu; komunikat wysyłany przez inny moduł używa typów wskazanych wyżej (prymitywy, `Shared`, `Api` właściciela).

## 6. Reguły `Port/In` i `Port/Out`
### 6.1 Jednoznaczna definicja `Port/In` i `Port/Out`
Reguły poniżej zawsze interpretuj z perspektywy jednego modułu `M`:
- `Application/Port/In`:
  - to publiczny kontrakt wejścia do modułu `M`,
  - występuje w dwóch dopuszczalnych wariantach:
    - `workflow entrypoint`: kontrakt uruchamiania workflow operacyjnego (pkt 4) z UI lub innej warstwy zewnętrznej wobec use case,
    - `plugin extension point`: kontrakt rozszerzeń implementowany przez inne moduły i konsumowany przez moduł właściciela (np. provider/resolver),
  - nie zastępuje standardowej ścieżki `CommandBus` / `QueryBus` dla CRUD i zwykłych odczytów.
- `Application/Port/Out`:
  - to kontrakt zależności wychodzącej z modułu `M`,
  - opisuje, czego use case modułu `M` potrzebuje od świata zewnętrznego (I/O, repozytoria read-model, adaptery infrastruktury),
  - jest używany wyłącznie przez warstwę `Application`, nigdy bezpośrednio przez UI.
- `Application/Port` bez podfolderu:
  - traktuj jako legacy i nie dodawaj nowych portów w tej lokalizacji,
  - wyjątek: porty techniczne w module współdzielonym (np. `Shared`), gdy klasyfikacja In/Out nie wnosi wartości domenowej.
- Interfejs używany i implementowany wyłącznie w warstwach adapterów (`UI`, `Infrastructure`) nie jest portem aplikacji: umieść go w warstwie, która go używa, zamiast w `Application/Port/**`.

### 6.2 Reguła decyzyjna tworzenia kontraktu wejścia
- Domyślnie twórz `Command` / `Query` i wywołuj je przez bus.
- `Port/In` typu `workflow entrypoint` twórz tylko wtedy, gdy operacja spełnia checklistę workflow z pkt 4.3.
- `Port/In` typu `plugin extension point` twórz tylko wtedy, gdy moduł właściciel potrzebuje rejestru rozszerzeń dostarczanych przez inne moduły (provider/resolver/strategy), a nie wywołania CRUD/read use case.
- `Port/In` nie służy do "opakowania jednego query/command", jeśli nie ma realnej orkiestracji albo realnego mechanizmu rozszerzeń.

### 6.3 Checklista kontraktu pluginowego `Port/In`
- Czy kontrakt reprezentuje punkt rozszerzeń modułu właściciela (a nie standardowy use case CRUD/read)?
- Czy implementacje mają być dostarczane przez inne moduły jako adaptery `Application/Adapter/**`?
- Czy moduł właściciel konsumuje implementacje jako rejestr/iterację (np. tag DI), a nie przez UI dispatch?
- Czy kontrakt nie służy do bezpośredniego pobierania lub modyfikacji danych biznesowych obcego modułu?
- Jeśli którekolwiek pytanie ma odpowiedź "nie", nie twórz `Port/In` pluginowego.

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
   - tak -> `Port`.
2. Czy to implementuje cudzy port albo tłumaczy kontrakt modułu `A` na kontrakt modułu `B`?
   - tak -> katalog `Application/Adapter/...`.
3. Jeśli to adapter: jaka jest jego rzeczywista rola?
   - dostarcza definicję / zestaw możliwości -> `Provider`,
   - rozstrzyga dopasowanie / wybór -> `Resolver`,
   - po prostu cienko translatuje kontrakt -> `Adapter`.
4. Czy to jest tylko model wejścia do wyszukiwania, filtrowania, sortowania lub paginacji?
   - tak -> `Criteria` / `QueryModel` / `FilterInput`, ale nie `Adapter`.
5. Czy to jest model odczytu dla UI lub read-side?
   - tak -> `View` / `RowView` / `ResultView` albo `DTO`; jeśli konsumuje go inny moduł -> `Api` (pkt 2.1).
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

### 8.1 Twarde reguły zależności cross-module
- Dozwolone cross-module:
  - zależność do komunikatów z `TargetModule/Application/UseCase/Command/**` oraz `TargetModule/Application/UseCase/Query/**` jako publicznych kontraktów messages w tym profilu (bez handlerów),
  - zależność do `TargetModule/Application/Port/In/**` wyłącznie przy implementacji jawnie udokumentowanego kontraktu pluginowego modułu docelowego,
  - zależność do `TargetModule/Api/**` z każdej warstwy poza `Domain` (pkt 2.1); `Domain` korzysta wyłącznie z własnego `Api`,
  - uzgodnione kontrakty współdzielone z `Shared`,
  - kontrolowany, wyłącznie odczytowy read model SQL (`SELECT`, w tym `JOIN` / `UNION` / CTE) łączący tabele należące do kilku modułów, jeśli wszystkie poniższe warunki są spełnione:
    - zapytanie działa na jednym połączeniu i w tej samej bazie danych; nie emuluje joinów między połączeniami,
    - implementacja pozostaje w `Infrastructure/Repository/**` modułu będącego właścicielem przekrojowego use case'a i implementuje jego lokalny port z `Application/Port/Out/**` zakończony sufiksem `ReadRepositoryPort`,
    - kod PHP nie importuje encji, repozytoriów, portów `Out`, klas `Domain` ani `Infrastructure` obcych modułów; zależność od obcych modułów istnieje wyłącznie na poziomie jawnie nazwanych tabel i kolumn SQL,
    - zapytanie nie zapisuje, nie naprawia i nie usuwa danych w tabelach obcych modułów,
    - read model respektuje tenant scope, soft-delete, uprawnienia do każdego źródła, stabilną paginację oraz semantykę danych właściciela tabeli,
    - zależność od tabel obcych modułów jest jawnie opisana w dokumentacji modułu/read modelu i pokryta testami integracyjnymi wykrywającymi zmianę kontraktu tabel,
    - wyjątek służy agregacji/reportingowi read-side, a nie obchodzeniu publicznego API modułu dla zwykłego odczytu CRUD.
- Niedozwolone cross-module:
  - zależność do `TargetModule/Application/Port/In/**` jako alternatywy dla `CommandBus` / `QueryBus` w odczycie i zapisie danych biznesowych,
  - zależność do handlerów use case'ów modułu docelowego (np. `*Handler` w `TargetModule/Application/UseCase/**`); konfiguracja Deptrac wydziela je z publicznej warstwy use case'ów (osobna warstwa albo wykluczenie po roli klasy), żeby dozwolona zależność od komunikatów nie obejmowała handlerów,
  - zależność do `TargetModule/Application/Port/Out/**`,
  - zależność do `TargetModule/Application/Port/*.php` (płaskie porty legacy poza wyjątkami technicznymi),
  - zależność do `TargetModule/Domain/**` i `TargetModule/Infrastructure/**` innego modułu,
  - zależność `Domain` od `Api` innego modułu,
  - typowanie wyniku cudzego query klasami spoza jego publicznego kontraktu (np. `TargetModule/Application/DTO/**`).
- Niedozwolone obejścia:
  - bezpośredni odczyt encji Doctrine, repozytoriów lub innych szczegółów persystencji obcego modułu; bezpośredni odczyt tabel jest dozwolony wyłącznie w kontrolowanym wyjątku read-side SQL opisanym powyżej,
  - „sprytne” odpowiedniki cross-module API budowane poza `CommandBus` / `QueryBus`.

## 9. Doctrine i model relacji
- Preferuj model relacji przez VO ID + jawne kolumny/indeksy.
- Nie używaj bezpośrednich relacji encji Doctrine (np. `ManyToOne`, `OneToMany`, `ManyToMany`) jako domyślnego mechanizmu powiązań między modułami/agregatami; przechowuj identyfikatory zamiast referencji do obcych encji.
- Rozdzielaj relacje obiektowe ORM od kluczy obcych w bazie: referencję przechowuj jako jawną kolumnę z identyfikatorem i zabezpieczaj ją FK w bazie, bez mapowania relacji encji Doctrine i bez importu klasy obcej encji. Sama granica modułów nie jest powodem do rezygnacji z FK w tej samej bazie danych.
- Doctrine generuje FK tylko z mapowanych relacji, dlatego FK na zwykłej kolumnie deklaruj mechanizmem projektu, który dodaje go do schematu generowanego przez Doctrine. Przed dodaniem FK ustal ten mechanizm w lokalnych regułach (`AGENT_RULES_DOC`) i w kodzie (np. atrybut na property obsługiwany przez listener `postGenerateSchema`, wywołania `addForeignKeyConstraint`) i użyj go zamiast własnego rozwiązania.
- Mechanizm FK (istniejący lub proponowany) spełnia warunki:
  - deklaracja przy mapowaniu kolumny jest jedynym źródłem FK; migracja powstaje z porównania schematu, a nie z ręcznie dopisanego SQL,
  - porównanie i walidacja schematu widzą FK i nie proponują jego usunięcia,
  - cel FK wynika z nazwy tabeli i kolumny lub z jawnej konfiguracji, a nie z klasy obcej encji,
  - zachowanie przy usuwaniu jest jawne; domyślnie `RESTRICT`, a `CASCADE` / `SET NULL` między modułami tylko po jawnej decyzji, zgodnie z wymaganiami domenowymi i ochroną danych historycznych,
  - nazwa FK jest deterministyczna, zgodna z konwencją projektu i limitem długości identyfikatora bazy.
- Po wygenerowaniu migracji sprawdź, że FK rzeczywiście się w niej znalazł i że kolumna ma indeks. Mechanizm może pominąć FK bez błędu, np. gdy tabela docelowa należy do innego połączenia (pkt 10). Referencji między bazami FK nie zabezpieczy; w README modułu opisz, co ją chroni.
- Gdy projekt nie ma takiego mechanizmu, nie dopisuj FK wyłącznie ręcznie w migracji, bo Doctrine uzna go za rozbieżność schematu. Zgłoś lukę i zaproponuj mechanizm spełniający powyższe warunki jako decyzję użytkownika.
- FK nie zastępuje komunikacji przez publiczne kontrakty modułów ani reguł z pkt 5 i 8.1.

### 9.1 Dodatkowe zasady danych (profil rozszerzony)
- Unikaj `float/decimal` w modelu domenowym i trwałości dla wartości pieniężnych; preferuj liczby całkowite (np. grosze).
- W kluczach relacyjnych używaj spójnego nazewnictwa snake_case oraz jawnych indeksów.
- Nazwy kluczy obcych i tabel łączących utrzymuj spójnie i przewidywalnie (konwencja projektu).

## 10. Wielobazowość / per-entity connection (gdy dotyczy)
- Dopuszczalny jest model wielu connection/EntityManagerów (np. `core`/`tenant`) wybieranych per encja.
- Repozytoria i konfiguracja EM powinny jednoznacznie wskazywać kontekst bazy.
- Jeśli moduł wymaga tego modelu, dokumentuj konsekwencje w README modułu i migracjach.

## 11. FCF (Form-Command-First)
- Formularze Symfony mapuj domyślnie bezpośrednio na command (`data_class = command`).
- DTO formularzowe są wyjątkiem i wymagają krótkiego uzasadnienia.
- Dla `Create` i `Update` preferuj osobne formularze z bazą wspólnych pól.
- Prefill w update realizuj przez `fromView(...)` po stronie komendy update (nie ręczne mapowanie w kontrolerze).
- Komenda mapowana przez formularz (`data_class`) ma publiczne, zapisywalne właściwości i jest tworzona przez `empty_data` albo przekazywana do formularza jako dane początkowe; to uzasadnione odstępstwo od preferencji `readonly` z baseline §2. Komendy niezwiązane z formularzem pozostają `final readonly`.
- `fromView(...)` jest fabryką prefillu wewnątrz modułu: widok jest jej argumentem, a nie polem komendy, więc przez bus komenda przenosi wyłącznie dane zgodne z pkt 5.
- Dla submitów preferuj jednolity schemat dispatchu oparty o zweryfikowane dane formularza.
- Endpointy bez formularza nie podlegają regułom FCF.

### 11.1 Odczyt danych dla pól formularza
- Typy pól, opcje, callbacki etykiet i transformery identyfikatorów nie wykonują biznesowych odczytów — bezpośrednio ani przez `CommandBus`/`QueryBus`.
- Dane dla pól i etykiet dostarcza jawny use case wywołany z dopuszczalnego entrypointu zgodnie z pkt 3; warstwa formularza tylko prezentuje i mapuje otrzymane dane.
- Zbiór aktywnych, historycznych i administracyjnych wartości wyboru oraz dopuszczone wyjątki ustala `Application`/`Domain`, nie UI.
- Filtr UI zawęża prezentację, ale nie zastępuje walidacji zapisu; brakującej wartości nie maskuj dokładaniem opcji w warstwie formularza.
- Wyjątek historyczny dopuszcza wyłącznie konkretny, jawnie wskazany identyfikator albo zakres, nigdy dowolne niedozwolone ID.
- Reguła dotyczy pól formularza; nie zakazuje odczytów w jawnych akcjach wyszukiwania inicjowanych przez użytkownika ani nie nakazuje przenoszenia do use case każdej istniejącej ścieżki odczytu UI.

## 12. Komponenty UI w strukturze modułów (gdy repo używa Twig/LiveComponent)
- Komponenty Twig i Live Components trzymaj w warstwie `UI` modułu, który jest właścicielem ich danych, i stosuj jedną konwencję katalogów w całym repo.
- Komponent używany przez kilka modułów umieszczaj w warstwie komponentów współdzielonych (`Shared` albo równoważnej). Decyzję o wydzieleniu komponentu podejmuj według kryteriów z `<skills_root>/_shared/references/symfony-ux-twig-components.md`, a nie według samej liczby powtórzeń markupu.
- Komponent nie zawiera logiki biznesowej; dane i akcje realizuje przez use case'y modułu zgodnie z pkt 3.
- Assety komponentu (SCSS/TS/JS) trzymaj przy komponencie albo w module, zgodnie z konwencją repo. Style komponentów importuj do entrypointu stylów modułu, a globalny entrypoint zostaw wyłącznie na style globalne aplikacji.
- Reguły projektowania, markupu i weryfikacji komponentów określają referencje wskazane w baseline `php-symfony-postgres-standards.md` (sekcja o komponentach Twig i Live Components).

## 13. Pierwszeństwo i konflikty
- Miejsce tego dokumentu w kolejności reguł określa `runtime-collaboration-guidelines.md` §8: ma pierwszeństwo przed baseline i procedurami runtime, a ustępuje poleceniu użytkownika i lokalnym zasadom repo. Konflikt z tymi źródłami rozstrzygaj według tej kolejności, bez dopytywania.
- Jeśli aktywny dokument jest sprzeczny z instrukcją skilla w sprawie architektonicznej, której ta kolejność nie rozstrzyga, zgłoś rozbieżność użytkownikowi i nie zgaduj rozwiązania.
