# CQRS Monolith Standard Overrides

Ten dokument opisuje **świadome odstępstwa** od baseline'u `php-symfony-postgres-standards.md` dla projektu opartego o architekturę modularnego monolitu z modułami w architekturze heksagonalnej i CQRS.

## 1. Aktywacja i pierwszeństwo
Stosuj ten dokument tylko, gdy w `.env` / `.env.local` ustawiono:

`CQRS_MONOLITH_STANDARD_OVERRIDES=1`

Gdy flaga ma wartość `0`, traktuj ten dokument jako nieaktywny.
W razie konfliktu z baseline: ten dokument ma pierwszeństwo.

## 2. Architektura modułowa i warstwy (override)
- Architektura: modularny monolit + hexagonal + CQRS.
- Moduł utrzymuj w warstwach: `Api`, `Application`, `Domain`, `Infrastructure`, `UI`.
- Cały nowy kod umieszczaj w istniejących modułach/warstwach; nie dodawaj nowych warstw bez jawnej decyzji.
- Porty umieszczaj jawnie (`Application/Port/*`, `Domain/Port/*`) i trzymaj kontrakty po stronie domeny/aplikacji, implementacje po stronie infrastruktury.

## 3. CQRS i przepływ odpowiedzialności (override)
- Kontrolery HTTP i komendy CLI pozostają cienkie: walidacja + dispatch command/query.
- Logika biznesowa żyje w handlerach/use-case (`Application`).
- Nie mieszaj mapowania wejścia i logiki domenowej w jednej klasie.
- Gdy inna warstwa musi użyć command/query z innego modułu, twórz dedykowany serwis aplikacyjny zamiast bezpośredniego 
  łączenia warstw.
- Messages przyjmują proste argumenty (prymitywy/VO), bez przekazywania encji i ciężkich DTO.

### 3.1 Jednoznaczna definicja `Port/In` i `Port/Out`
Reguły poniżej zawsze interpretuj z perspektywy jednego modułu `M`:
- `Application/Port/In`:
  - to publiczny kontrakt wejścia do modułu `M`,
  - służy do interakcji z `M` z zewnątrz (cross-module API) albo jako punkt rozszerzenia implementowany przez inne moduły,
  - jest częścią stabilnego API modułu.
- `Application/Port/Out`:
  - to kontrakt zależności wychodzącej z modułu `M`,
  - opisuje, czego use case modułu `M` potrzebuje od świata zewnętrznego (I/O, repozytoria read-model, adaptery infrastruktury),
  - nie jest publicznym API modułu dla innych modułów.
- `Application/Port` bez podfolderu:
  - traktuj jako legacy i nie dodawaj nowych portów w tej lokalizacji,
  - wyjątek: porty techniczne w module współdzielonym (np. `Shared`), gdy klasyfikacja In/Out nie wnosi wartości domenowej.

### 3.2 Nazewnictwo klas, sufiksy i ścieżka decyzyjna
Poniższe reguły służą do spójnego nazywania klas i katalogów w modularnym monolicie CQRS/hexagonal:
- nazwa klasy odpowiada przede wszystkim jej roli,
- katalog odpowiada przede wszystkim jej pozycji architektonicznej,
- nazwa klasy i nazwa katalogu nie muszą używać tego samego słowa.

#### 3.2.1 Rozdzielenie roli klasy od warstwy
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

#### 3.2.2 Klasyfikacja najczęstszych sufiksów
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

#### 3.2.3 Kiedy `Adapter` jest trafny
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

#### 3.2.4 Czego nie wkładać do `Adapter`
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

#### 3.2.5 Ścieżka decyzyjna
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

## 4. Deptrac jako hard guard (override)
- Granice warstw/modułów są egzekwowane przez Deptrac.
- Naruszeń zależności nie „obchodzimy” zmianą reguł bez decyzji architektonicznej.
- Domyślna reakcja na naruszenie: poprawa kodu i granic odpowiedzialności.

### 4.1 Twarde reguły zależności cross-module
- Dozwolone cross-module:
  - zależność do `TargetModule/Application/Port/In/**` (publiczne API modułu),
  - uzgodnione kontrakty współdzielone z `Shared`.
- Niedozwolone cross-module:
  - zależność do `TargetModule/Application/Port/Out/**`,
  - zależność do `TargetModule/Application/Port/*.php` (płaskie porty legacy poza wyjątkami technicznymi),
  - zależność do `TargetModule/Domain/**` i `TargetModule/Infrastructure/**` innego modułu.

## 5. Doctrine i model relacji (override)
- Preferuj model relacji przez VO ID + jawne kolumny/indeksy.
- Nie używaj bezpośrednich relacji encji jako domyślnego mechanizmu komunikacji między modułami/agregatami.
- W tym profilu preferowane jest podejście bez twardych FK między modułami; wyjątki wymagają jawnej decyzji.
- Typy Doctrine deklaruj przez `Types::*` lub stałe custom type.
- Daty/timestampy trzymaj jako immutable i UTC.

### 5.1 Dodatkowe zasady danych (profil rozszerzony)
- Unikaj `float/decimal` w modelu domenowym i trwałości dla wartości pieniężnych; preferuj liczby całkowite (np. grosze).
- W kluczach relacyjnych używaj spójnego nazewnictwa snake_case oraz jawnych indeksów.
- Nazwy kluczy obcych i tabel łączących utrzymuj spójnie i przewidywalnie (konwencja projektu).

## 6. Wielobazowość / per-entity connection (override, gdy dotyczy)
- Dopuszczalny jest model wielu connection/EntityManagerów (np. `core`/`tenant`) wybieranych per encja.
- Repozytoria i konfiguracja EM powinny jednoznacznie wskazywać kontekst bazy.
- Jeśli moduł wymaga tego modelu, dokumentuj konsekwencje w README modułu i migracjach.

## 7. FCF (Form-Command-First) (override)
- Formularze Symfony mapuj domyślnie bezpośrednio na command (`data_class = command`).
- DTO formularzowe są wyjątkiem i wymagają krótkiego uzasadnienia.
- Dla `Create` i `Update` preferuj osobne formularze z bazą wspólnych pól.
- Prefill w update realizuj przez `fromView(...)` po stronie komendy update (nie ręczne mapowanie w kontrolerze).
- Dla submitów preferuj jednolity schemat dispatchu oparty o zweryfikowane dane formularza.
- Endpointy bez formularza nie podlegają regułom FCF.

## 8. Frontend (override, gdy repo używa Twig/LiveComponent)

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

## 9. Zakres stosowania
Dokument jest wspólną referencją dla skilli:
- `$code-implement`
- `$context-refresh`
- `$review-quick`
- `$docs-sync`

Jeśli wykryjesz sprzeczność między aktywnym override a treścią skilla/procedury:
1. Potwierdź, że flaga override jest aktywna.
2. Zgłoś rozbieżność użytkownikowi.
3. Nie zgaduj rozwiązania architektonicznego bez decyzji.
