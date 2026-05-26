# CQRS Monolith Standard Overrides

Ten dokument opisuje **świadome odstępstwa** od baseline'u `php-symfony-postgres-standards.md` dla projektu opartego o architekturę modularnego monolitu z modułami w architekturze heksagonalnej i CQRS.

## 1. Aktywacja i pierwszeństwo
Stosuj ten dokument tylko, gdy aktywne pliki env repo ustawiają końcową wartość:

`CQRS_MONOLITH_STANDARD_OVERRIDES=1`

Aktywne pliki env są ładowane w kolejności nadpisań zgodnej z `<skills_root>/_shared/scripts/env-load.sh`: `.env`, `.env.local` (poza `APP_ENV=test`), `.env.<APP_ENV>`, `.env.<APP_ENV>.local`. `.env.dist` jest szablonem/defaultem dokumentacyjnym, nie aktywnym źródłem runtime.

Gdy flaga ma wartość `0`, traktuj ten dokument jako nieaktywny.
W razie konfliktu z baseline: ten dokument ma pierwszeństwo.

## 2. Architektura modułowa i warstwy (override)
- Architektura: modularny monolit + hexagonal + CQRS.
- Moduł utrzymuj w warstwach: `Api`, `Application`, `Domain`, `Infrastructure`, `UI`.
- Cały nowy kod umieszczaj w istniejących modułach/warstwach; nie dodawaj nowych warstw bez jawnej decyzji.
- Porty umieszczaj jawnie (`Application/Port/*`, `Domain/Port/*`) i trzymaj kontrakty po stronie domeny/aplikacji, implementacje po stronie infrastruktury.

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
- `ReadFacade` korzysta wyłącznie z `QueryBus`.
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
- Warstwa `Application` nie odwołuje się bezpośrednio do `Domain` ani `Infrastructure` obcego modułu.
- Wyjątek od reguły busowej: kontrakty pluginowe `Application/Port/In/**` modułu docelowego, jeśli moduł docelowy publikuje jawnie punkt rozszerzeń (np. provider/resolver), a moduł wywołujący dostarcza implementację tego kontraktu.
- Kontrakt pluginowy `Port/In` nie zastępuje `Command` / `Query` dla odczytu i zapisu danych biznesowych między modułami.
- Kompozycja, mapowanie i tłumaczenie danych cross-module dzieją się w lokalnych adapterach `Application/Adapter/**` modułu wywołującego.
- Inne warstwy korzystają z lokalnych adapterów/use-case modułu wywołującego, a nie z obcych kontraktów technicznych.
- Messages przekazywane przez bus przyjmują proste argumenty (`prymitywy` / `VO`), bez przekazywania encji i ciężkich DTO.

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
   - tak -> `View` / `RowView` / `ResultView` albo `DTO`.
6. Czy to jest logika operacyjna lub orkiestracyjna bez lepszego precyzyjnego sufiksu?
   - tak -> `Service`.
7. Czy to jest dostęp do danych?
   - tak -> `Repository` albo `RepositoryPort`.

## 8. Deptrac jako hard guard (override)
- Granice warstw/modułów są egzekwowane przez Deptrac.
- Naruszeń zależności nie „obchodzimy” zmianą reguł bez decyzji architektonicznej.
- Domyślna reakcja na naruszenie: poprawa kodu i granic odpowiedzialności.

### 8.1 Twarde reguły zależności cross-module
- Dozwolone cross-module:
  - zależność do `TargetModule/Application/UseCase/Command/**` oraz `TargetModule/Application/UseCase/Query/**` jako publicznych kontraktów messages w tym profilu,
  - zależność do `TargetModule/Application/Port/In/**` wyłącznie przy implementacji jawnie udokumentowanego kontraktu pluginowego modułu docelowego,
  - uzgodnione kontrakty współdzielone z `Shared`.
- Niedozwolone cross-module:
  - zależność do `TargetModule/Application/Port/In/**` jako alternatywy dla `CommandBus` / `QueryBus` w odczycie i zapisie danych biznesowych,
  - zależność do `TargetModule/Application/Port/Out/**`,
  - zależność do `TargetModule/Application/Port/*.php` (płaskie porty legacy poza wyjątkami technicznymi),
  - zależność do `TargetModule/Domain/**` i `TargetModule/Infrastructure/**` innego modułu.
- Niedozwolone obejścia:
  - bezpośredni odczyt tabel, encji Doctrine, repozytoriów lub innych szczegółów persystencji obcego modułu tylko po to, aby ominąć jego application layer,
  - „sprytne” odpowiedniki cross-module API budowane poza `CommandBus` / `QueryBus`.

## 9. Doctrine i model relacji (override)
- Preferuj model relacji przez VO ID + jawne kolumny/indeksy.
- Nie używaj bezpośrednich relacji encji jako domyślnego mechanizmu komunikacji między modułami/agregatami.
- W tym profilu preferowane jest podejście bez twardych FK między modułami; wyjątki wymagają jawnej decyzji.
- Typy Doctrine deklaruj przez `Types::*` lub stałe custom type.
- Daty/timestampy trzymaj jako immutable i UTC.

### 9.1 Dodatkowe zasady danych (profil rozszerzony)
- Unikaj `float/decimal` w modelu domenowym i trwałości dla wartości pieniężnych; preferuj liczby całkowite (np. grosze).
- W kluczach relacyjnych używaj spójnego nazewnictwa snake_case oraz jawnych indeksów.
- Nazwy kluczy obcych i tabel łączących utrzymuj spójnie i przewidywalnie (konwencja projektu).

## 10. Wielobazowość / per-entity connection (override, gdy dotyczy)
- Dopuszczalny jest model wielu connection/EntityManagerów (np. `core`/`tenant`) wybieranych per encja.
- Repozytoria i konfiguracja EM powinny jednoznacznie wskazywać kontekst bazy.
- Jeśli moduł wymaga tego modelu, dokumentuj konsekwencje w README modułu i migracjach.

## 11. FCF (Form-Command-First) (override)
- Formularze Symfony mapuj domyślnie bezpośrednio na command (`data_class = command`).
- DTO formularzowe są wyjątkiem i wymagają krótkiego uzasadnienia.
- Dla `Create` i `Update` preferuj osobne formularze z bazą wspólnych pól.
- Prefill w update realizuj przez `fromView(...)` po stronie komendy update (nie ręczne mapowanie w kontrolerze).
- Dla submitów preferuj jednolity schemat dispatchu oparty o zweryfikowane dane formularza.
- Endpointy bez formularza nie podlegają regułom FCF.

## 12. Frontend (override, gdy repo używa Twig/LiveComponent)

### TwigComponents i LiveComponents
- Trzymaj komponenty w warstwie UI modułu i stosuj jedną, spójną konwencję katalogów w całym repo.
- Jeśli repo ma warstwę komponentów współdzielonych (`Shared`/`Common`/równoważną), używaj jej dla elementów wielokrotnego użycia między modułami.
- Komponent ma jedną odpowiedzialność UI; logika biznesowa pozostaje w `Application`/use-case (CQRS), a komponent orkiestruje tylko prezentację i akcje UI.
- Publiczne pola komponentu (`props`) traktuj jako stabilne API: minimalny zakres danych, jawne typy, czytelne nazwy.
- Dla `LiveComponent` utrzymuj pojedynczy root element w zwracanym HTML.
- Jeżeli repo i używana wersja narzędzi wspierają domyślny pojedynczy slot treści, można pomijać jawne bloki szablonu; w przeciwnym razie trzymaj się jawnej składni wymaganej przez projekt.
- Powtarzalny markup i styl wyciągaj do komponentów współdzielonych zamiast duplikować je w modułach.
- Assety komponentu (SCSS/TS/JS) trzymaj współlokalnie z komponentem albo w module, zgodnie z przyjętą konwencją repo.
- Style komponentów importuj do wejścia stylów modułu/layeru, a globalny entrypoint stylów zostaw wyłącznie na style globalne aplikacji.

### Checklista komponentu (Definition of Done)
- Struktura: komponent jest umieszczony we właściwym module/layerze i ma spójne nazewnictwo klasy/template.
- API: `props` są minimalne, jawnie typowane i nie przenoszą logiki biznesowej.
- Markup: w `LiveComponent` jest dokładnie jeden root element; użycie slotów/bloków jest zgodne z konwencją i wersją narzędzi repo.
- Reuse: powtarzalne fragmenty UI zostały wyciągnięte do komponentu współdzielonego zamiast duplikacji.
- Assets: style/TS/JS są współlokalne i podpięte do właściwego entrypointu modułu/layeru; brak stylu komponentowego w entrypoincie globalnym.
- Cleanup i weryfikacja: usunięto martwe klasy/selektory po refaktorze; wykonano adekwatny lint (co najmniej Twig, a dla zmian assetów także SCSS/TS/JS).

## 13. Zakres stosowania
Dokument jest wspólną referencją dla skilli:
- `$code-implement`
- `$context-refresh`
- `$review-quick`
- `$docs-sync`

Jeśli wykryjesz sprzeczność między aktywnym override a treścią skilla/procedury:
1. Potwierdź, że flaga override jest aktywna.
2. Zgłoś rozbieżność użytkownikowi.
3. Nie zgaduj rozwiązania architektonicznego bez decyzji.
