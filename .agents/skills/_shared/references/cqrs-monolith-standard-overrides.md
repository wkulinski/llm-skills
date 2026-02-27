# CQRS Monolith Standard Overrides

Ten dokument opisuje **świadome odstępstwa** od baseline'u
`php-symfony-postgres-standards.md` dla profilu modularnego monolitu z CQRS.

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
- Gdy inna warstwa musi użyć command/query z innego modułu, preferuj dedykowany serwis aplikacyjny zamiast bezpośredniego łączenia warstw.
- Messages przyjmują proste argumenty (prymitywy/VO), bez przekazywania encji i ciężkich DTO.

## 4. Deptrac jako hard guard (override)
- Granice warstw/modułów są egzekwowane przez Deptrac.
- Naruszeń zależności nie „obchodzimy” zmianą reguł bez decyzji architektonicznej.
- Domyślna reakcja na naruszenie: poprawa kodu i granic odpowiedzialności.

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
