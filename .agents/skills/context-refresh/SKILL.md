---
name: context-refresh
description: >-
  Inicjalizacja i odświeżenie kontekstu projektu. Intencje: załaduj/odśwież
  kontekst, wczytaj dokumenty startowe, sprawdź stan repo. Użyj, gdy proszą o
  załadowanie kontekstu lub gdy uruchamiany jest $context-refresh.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
  - _shared/references/symbolic-navigation-and-editing-policy.md
  - _shared/references/context-subagent-contract.md
  - _shared/scripts/context-manifest.mjs
  - _shared/scripts/secret-detector.mjs
  - _shared/scripts/change-inventory.mjs
---

# $context-refresh

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Celem jest załadowanie lub odświeżenie kontekstu projektu w sposób spójny i skalowalny, tak aby dalsze działania były oparte na:
- aktualnych zasadach/procedurach (źródła w skillach + dokumentacja projektu),
- bieżącym stanie repozytorium (zmiany tracked/untracked),
- dokumentacji domenowej/modułowej dotyczącej realnie dotkniętych obszarów.

## Role i lifecycle

Ten skill jest procedurą dla agenta głównego oraz jawnie delegowanego agenta
`context-refresher`. Przy rozpoczęciu
nowej sesji lub jawnym odświeżeniu agent główny standardowo deleguje pełny refresh
do `context-refresher` i korzysta z bezpośredniego wykonania skilla wyłącznie
jako fallbacku po niedostępności delegacji, statusie `BLOCKED`/`INCOMPLETE` albo
nieudanym `validate`/`verify` manifestu. Delegowane role repozytoryjne, w
szczególności `context-scout`, nie uruchamiają tego skilla automatycznie.
Otrzymują od agenta głównego manifest i wykonują wyłącznie zakres opisany w
kontrakcie `<skills_root>/_shared/references/context-subagent-contract.md`.

W tym repozytorium źródłem prawdy dla “procedury startowej” jest ten skill (root `AGENTS.md` jest tylko entrypointem).

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `MAIN_DOC`: główny dokument opisowy projektu.
- Opcjonalne:
  - `AGENT_RULES_DOC`: lokalne zasady pracy agenta.
  - `QUALITY_PROCEDURES_DOC`: lokalne procedury jakości.
  - `MODULE_INDEX_DOC`: indeks modułów.
  - `MODULE_DOCS_GLOB`: glob dla README dokumentacji modułów.
  - `TESTS_README`: README testów.
  - `SKILLS_INDEX_DOC`: indeks skilli.
  - `COMMIT_MESSAGE_DIR`: katalog artefaktu `commit-message.txt` używanego przez commit flow.
  - `HANDOFF_DOC`: plik handoffu.

## Tryb wykonania (Quick vs Full)
Ten skill ma dwa tryby wykonania. Domyślny jest **Quick**, a **Full** uruchamiaj tylko, gdy jest to uzasadnione.

### Tryb Quick (domyślny)
Cel: szybko uzyskać bezpieczny kontekst do pracy bez ładowania całej dokumentacji.
- Czyta “rdzeń” dokumentacji (procedury/zasady/indeksy) zawsze.
- Jeśli zdefiniowano `MODULE_INDEX_DOC`, czyta go jako lekki atlas modułów i ich ról.
- Dokumentację modułów (jeśli zdefiniowano `MODULE_DOCS_GLOB`) czyta tylko dla modułów dotkniętych zmianami lub wskazanych w prompt.
- README testów (jeśli zdefiniowano `TESTS_README`) czyta tylko, jeśli zmiany dotyczą testów lub ich uruchamiania.
- Analizę zmian w repo robi “skalowalnie” i **doczytuje szczegóły dopiero wtedy, gdy są potrzebne do zadania** (on-demand).

### Tryb Full (na żądanie lub gdy potrzebny)
Cel: pełniejszy obraz repo + dokumentacji, kosztem czasu i kontekstu.
- Czyta pełny baseline skilli oraz szeroki zestaw dokumentacji projektu (jeśli istnieje), w tym dokumentację modułów.
- Czyta README testów niezależnie od zmian (jeśli zdefiniowano `TESTS_README`).
- Może analizować zmiany szerzej niż Quick, ale nadal obowiązuje zasada skalowalności: pełne diffy czytaj wtedy, gdy są potrzebne do konkretnego zadania lub ryzyko tego wymaga.

### Jak wybrać tryb
Tryb dotyczy przede wszystkim **zakresu ładowanej dokumentacji**, a nie automatycznego “czytania wszystkich diffów”.
1. Jeśli użytkownik wyraźnie prosi o pełny kontekst: użyj **Full**.
2. Jeśli zadanie jest przekrojowe (np. zmiany architektury, procesów, wielu modułów) i bez pełnej dokumentacji łatwo popełnić błąd: użyj **Full**.
3. W pozostałych przypadkach: użyj **Quick**, a brakujące informacje doczytuj **lazy/on-demand** (patrz krok 5).

## Kroki
### 0) Wybór trybu (zawsze)
Ustal, czy wykonujesz `$context-refresh` w trybie **Quick** czy **Full** (sekcja wyżej) i trzymaj się konsekwentnie wybranego trybu.

### 1) Snapshot repo (zawsze)
1. Sprawdź `git status -sb`.
2. Zbierz listy:
   - zmienione pliki tracked: `git diff --name-only`
   - pliki nieśledzone: `git ls-files --others --exclude-standard`
3. Zanotuj, czy zmiany dotykają:
   - dokumentacji wskazanej przez klucze `docs_map`,
   - konkretnego modułu (`src/<Module>/...`),
   - testów (`tests/`),
   - konfiguracji toolingu/CI (np. `composer.*`, `package.json`, `Makefile`, `./.github/`, wrappery narzędziowe wynikające z `BIN_PATH`).

### 2) Minimalny baseline (zawsze)
Przeczytaj w całości (to jest minimalny “rdzeń” reguł i konwencji):
1. `<skills_root>/_shared/references/runtime-collaboration-guidelines.md`
2. `<skills_root>/_shared/references/runtime-quality-procedures.md`
3. `<skills_root>/_shared/references/php-symfony-postgres-standards.md`
4. Ustal aktywność `CQRS_MONOLITH_STANDARD_OVERRIDES` na podstawie aktywnych plików env repo:
   - uwzględnij kolejność nadpisań zgodną z helperem `<skills_root>/_shared/scripts/env-load.sh`: `.env`, `.env.local` (poza `APP_ENV=test`), `.env.<APP_ENV>`, `.env.<APP_ENV>.local`,
   - jeśli `APP_ENV` nie wynika z aktywnego env, przyjmij `dev`,
   - `.env.dist` traktuj jako szablon/default dokumentacyjny, nie aktywne źródło runtime,
   - jeśli końcowa aktywna wartość to `1`: przeczytaj `<skills_root>/_shared/references/cqrs-monolith-standard-overrides.md`,
   - w podsumowaniu odnotuj aktywną wartość i plik, który ją ustawił, jeśli override został załadowany.
5. Odczytaj `MAIN_DOC`.
   - Jeśli mapy lub klucza `MAIN_DOC` brakuje: zatrzymaj się i dopytaj użytkownika.
6. Odczytaj `AGENT_RULES_DOC` — jeśli zdefiniowano.
7. Odczytaj `QUALITY_PROCEDURES_DOC` — jeśli zdefiniowano.
8. Odczytaj `MODULE_INDEX_DOC` — jeśli zdefiniowano.
9. Odczytaj `SKILLS_INDEX_DOC` — jeśli zdefiniowano.
10. Odczytaj `HANDOFF_DOC` — jeśli zdefiniowano.

### 3) Dokumentacja modułowa (lazy, ale bezpiecznie)
1. Jeśli zdefiniowano `MODULE_INDEX_DOC`, przeczytaj go jako mapę orientacyjną przed doczytywaniem szczegółów.
2. Jeśli zdefiniowano `MODULE_DOCS_GLOB` i `git diff --name-only` zawiera zmiany w modułach, przeczytaj README dokumentacji tylko dla dotkniętych modułów.
3. Jeśli aktualny moduł ma użyć funkcjonalności z innego modułu albo prompt wymaga decyzji między modułami, doczytaj też dokumentację tego drugiego modułu.
4. Jeśli tryb to **Full** i zdefiniowano `MODULE_DOCS_GLOB`, doczytuj szerzej, ale nadal zaczynaj od atlasu (`MODULE_INDEX_DOC`) i rozszerzaj zakres tylko wtedy, gdy jest to potrzebne do zadania.

### 3a) Jak interpretować `MODULE_INDEX_DOC`
Jeśli atlas modułów istnieje, traktuj go jako warstwę decyzyjną:
1. Z każdego wpisu wyciągnij tylko cztery rzeczy: rolę modułu, punkty wejścia, powiązania i sygnały `Czytać, gdy` / `Nie czytać, gdy`.
2. Na tej podstawie wybierz:
   - moduł główny, który jest bezpośrednio dotknięty zadaniem,
   - maksymalnie 0-2 moduły pomocnicze, jeśli atlas wskazuje zależność albo współużycie funkcjonalności.
3. Doczytaj pełne README tylko dla wybranych modułów, a nie dla całego atlasu.
4. Jeśli atlas mówi `Nie czytać, gdy`, nie ładuj pełnej dokumentacji danego modułu bez dodatkowego triggera z promptu, diffu albo decyzji architektonicznej.
5. Jeśli wpis atlasu jest zbyt ogólny albo sprzeczny z innymi źródłami, zanotuj to w uwagach i oprzyj decyzję na pełnej dokumentacji modułu oraz `MAIN_DOC`.

### 4) Testy (lazy)
Jeśli zdefiniowano `TESTS_README` i zmiany dotyczą testów lub sposobu ich uruchamiania (np. `tests/`, `codeception`, `make test.*`, wrapper `codecept` z `BIN_PATH`), przeczytaj README testów.
Jeśli tryb to **Full** i zdefiniowano `TESTS_README`, przeczytaj README testów niezależnie od zmian.

### 5) Analiza bieżących zmian (skalowalnie)
Cel: zrozumieć, “co jest zmienione w repo” bez konieczności wklejania dużych diffów do rozmowy.
1. Wygeneruj strukturalne inventory zmian:
   ```bash
   node <skills_root>/_shared/scripts/change-inventory.mjs build --output <CACHE_PATH>/repository-context/change-inventory.json
   ```
   - Inventory należy regenerować przy każdym refreshu; nie używaj wcześniej zapisanego pliku jako źródła aktualnego zakresu.
   - Inventory zawiera: pliki z powierzchniami zmian (staged/unstaged/untracked), stats śledzonych zmian i liczby plików, subsystemy oraz worktree fingerprint.
   - Doczytaj inventory jako dane wejściowe dla poniższych kroków zamiast powtarzać ad-hoc git commands.
2. Zrób szybki przegląd rozmiaru zmian na podstawie inventory (stats.total, stats.tracked_insertions/tracked_deletions/staged_files/unstaged_files/untracked_files).
3. Zastosuj próg dla "czytam od razu":
   - jeśli liczba zmienionych+nieśledzonych plików jest mała (np. ≤ 10): przejrzyj diff każdego pliku lub jego kluczowe fragmenty,
   - jeśli jest większa: ogranicz się do orientacji (stat/numstat) + pełne diffy tylko dla plików "high-risk" oraz dla obszaru wskazanego w prompt.
4. Trigger doczytania on-demand (kluczowe):
   Doczytywanie ma być uruchamiane wtedy, gdy “zadanie dotyka” pliku/obszaru, którego nie masz jeszcze wystarczająco dobrze w głowie. Triggerem jest zawsze potrzeba podjęcia decyzji lub wykonania zmiany w danym obszarze.

   To nie jest “ponowne uruchomienie `$context-refresh`”. To jest punktowe doczytanie tylko tego, co jest potrzebne w danym momencie. Sam status `dirty` albo `untracked` nie jest dowodem, że poprzedni odczyt jest nieaktualny.

   Uruchom doczytanie on-demand, jeśli zachodzi którekolwiek:
   - prompt wprost wymienia ścieżkę pliku (np. `src/.../Foo.php`) → przeczytaj ten plik i jego diff (jeśli ma),
   - prompt wprost wymienia symbol (klasa/metoda/komenda/route) → jeśli Serena dla języka jest dostępna, znajdź definicję przez Serenę; w przeciwnym razie użyj `rg`; następnie przeczytaj definicję + kontekst,
   - masz zmienić plik, który już jest zmieniony w repo (czyli “modyfikujesz cudze/bieżące zmiany”) i nie masz ważnego odczytu jego aktualnej wersji dla zakresu patcha → przeczytaj jego diff i aktualną treść przed edycją,
   - aktualny moduł ma użyć funkcjonalności z innego modułu → doczytaj dokumentację obu modułów, zaczynając od `MODULE_INDEX_DOC`, jeśli istnieje,
   - masz przygotować treść commita (`$commit-message-write`) → upewnij się, że rozumiesz “co” i “dlaczego” (diff/kluczowe fragmenty),
   - QA/testy zwróciły błąd w pliku, którego nie analizowałeś → doczytaj od razu ten plik i sąsiedni kontekst,
   - pojawia się decyzja architektoniczna/domenowa, a nie czytałeś dokumentacji modułu/domeny dotkniętej zmianą → doczytaj README modułu (z `MODULE_DOCS_GLOB`) i relewantny fragment `MAIN_DOC`.
   - zadanie dotyczy kodu w języku wspieranym przez Serenę → zawęź zakres przez Serenę zgodnie z `<skills_root>/_shared/references/symbolic-navigation-and-editing-policy.md` zamiast czytać pełne pliki bez potrzeby.
   - jeśli Serena nie jest dostępna, ale dostępna jest inna warstwa symboliczna dla języka → użyj jej według tej samej polityki.

5. Procedura doczytania on-demand:
   - Ustal “target” doczytania: plik / moduł / symbol.
   - Jeśli target to plik:
     - jeśli plik jest zmieniony i nie ma ważnego odczytu jego aktualnej wersji dla zakresu patcha: przeczytaj `git diff -- <plik>` i aktualną treść pliku (przynajmniej relewantne sekcje),
     - jeśli plik nie jest zmieniony: przeczytaj aktualną treść pliku (relewantne sekcje),
     - oznacz odczyt jako `read-before-write`, jeśli chroni patch przed nadpisaniem zmian; jako `snapshot-refresh`, jeśli wynika z wykrytej zmiany snapshotu; w pozostałych przypadkach użyj `discovery`, `verification` albo `report-gap`.
   - Jeśli target to symbol:
     - jeśli Serena dla języka jest dostępna, użyj Sereny najpierw do znalezienia definicji, overview i referencji,
     - jeśli Serena nie jest dostępna, ale działa inna warstwa symboliczna dla języka, użyj jej; w przeciwnym razie użyj `rg`,
     - przeczytaj fragment definicji + najbliższy kontekst użycia,
     - jeśli symbol należy do modułu: doczytaj README modułu dla kontekstu domenowego.
   - Jeśli target to moduł:
     - przeczytaj README modułu i (jeśli istnieje) sprawdź, czy indeks modułów nie odsyła do dodatkowych konwencji.
   - Po doczytaniu: wróć do zadania i podejmij decyzję/wykonaj zmianę w oparciu o doczytane informacje.

6. Doczytanie on-demand (krótka zasada wykonawcza):
   - zanim zmodyfikujesz plik, którego zmian nie rozumiesz (bo np. był już zmieniony przed Twoją pracą albo zmienił się od ostatniego odczytu), doczytaj jego diff/treść w tym momencie; nie powtarzaj szerokiego discovery, jeśli aktualny raport wystarcza do decyzji,
   - analogicznie: zanim przygotujesz `commit-message.txt`, upewnij się, że rozumiesz „co” i “dlaczego” (w praktyce robi to też `$commit-message-write`).
   - jeśli zadanie jest wyraźnie runtime/debuggingowe i AI Mate jest dostępny, możesz pomocniczo użyć `$dev-mate` do zebrania logów/profilera/DI; nie zastępuje to odczytu kodu ani dokumentacji.
   - jeśli zadanie dotyczy kodu w języku wspieranym przez Serenę, preferuj zawężenie przez Serenę zamiast szerokiego odczytu całych plików; jeśli Serena nie jest dostępna, zastosuj tę samą zasadę do innej warstwy symbolicznej; dla Twig/YAML/docs zwykle pozostań przy `rg` i zwykłym odczycie, a dla SCSS użyj zwykłego patcha tylko wtedy, gdy zmiana jest banalna i lokalna.
7. Uwaga: jeśli kolejnym krokiem ma być `$commit-message-write`, to ten skill ma własną procedurę analizy zmian przed zapisaniem `commit-message.txt` — `$context-refresh` nie musi “wiedzieć wszystkiego” o każdej zmianie, ale musi wiedzieć, co jest zmienione i gdzie.

### 6) Weryfikacja spójności procedur (jeśli dotyczy)
Jeśli zmiany dotyczą procedur (pliki w `<skills_root>/_shared/references/runtime-collaboration-guidelines.md`, `<skills_root>/_shared/references/runtime-quality-procedures.md`, `<skills_root>/*`):
1. Traktuj skille jako źródło prawdy dla procedur operacyjnych (QA/commit/commit-message/review).
2. Jeśli widzisz rozbieżności, zanotuj je i zaproponuj korektę w skillu (nie dopisuj procedury “na boku” w docs).

### 7) Potwierdzenie gotowości
Podsumuj krótko:
- jakie dokumenty zostały wczytane (rdzeń + moduły dotknięte zmianami),
- jakie obszary kodu są zmienione (na podstawie inventory: stats, subsystemy),
- czy zapisano `change-inventory.json` do `<CACHE_PATH>/repository-context/` (ścieżka, worktree fingerprint),
- czy widzisz potencjalne rozbieżności/duplikaty w dokumentacji lub procedurach.

Po zakończeniu refreshu agent główny lub `context-refresher` powinien przygotować
zwarty manifest kontekstu zawierający wyłącznie ścieżki, role dokumentów,
override'y, ograniczenia i listę już przeczytanych źródeł. Manifest waliduj przez
`<skills_root>/_shared/scripts/context-manifest.mjs`; nie umieszczaj w nim treści
issue, komentarzy, pełnych dokumentów ani sekretów.

## Format odpowiedzi
- Wynik: “Kontekst załadowany/odświeżony”.
- Tryb: `Quick` lub `Full`.
- Użyte klucze dokumentacji: lista tylko tych kluczy `docs_map`, które były użyte w tym uruchomieniu (np. `MAIN_DOC=...`, `MODULE_DOCS_GLOB=...`).
- Wczytane: lista kluczowych dokumentów (rdzeń + moduły dotknięte).
- Zmiany w repo: krótki opis zakresu (moduły/obszary) + liczba plików zmienionych/untracked (z inventory).
- Uwagi: braki, sprzeczności, duplikaty, rzeczy do doczytania “on-demand”.

## Przykłady wejścia
- "odśwież kontekst"
- "załaduj kontekst projektu"
- "wczytaj kontekst"

## Przykłady wyjścia
- ```text
  Wynik: Kontekst załadowany/odświeżony.
  Tryb: Quick
  Wczytane: `<skills_root>/_shared/references/runtime-collaboration-guidelines.md`, `<skills_root>/_shared/references/runtime-quality-procedures.md`, `<skills_root>/_shared/references/php-symfony-postgres-standards.md`, `MAIN_DOC` z `docs_map`.
  Zmiany w repo: dotknięte moduły: Core, Migration (12 plików zmienionych, 1 untracked).
  Uwagi: brak.
  ```
- ```text
  Wynik: Kontekst załadowany/odświeżony.
  Tryb: Quick
  Wczytane: rdzeń dokumentacji + README dotkniętych modułów.
  Zmiany w repo: 34 pliki zmienione (duży zakres) — orientacja stat/numstat; pełne diffy tylko dla high-risk i obszaru zadania; reszta on-demand.
  Uwagi: brak dokumentu handoff (plik opcjonalny).
  ```
- ```text
  Wynik: Kontekst załadowany/odświeżony.
  Tryb: Full
  Wczytane: baseline skilli + komplet dokumentacji wynikający z `docs_map` (`MAIN_DOC`, dokumentacja modułowa z `MODULE_DOCS_GLOB`, `TESTS_README` jeśli zdefiniowany).
  Zmiany w repo: przekrojowe zmiany w wielu modułach; przyjęto full context dla bezpieczeństwa.
  Uwagi: brak.
  ```

## Efekt
Kontekst projektu jest wczytany, a ewentualne braki lub niejasności zostały jasno odnotowane; agent wie też, jakie obszary są zmienione w repo.

## Przypadki brzegowe
- Brak jednego z kluczowych plików baseline skilli (`<skills_root>/_shared/references/runtime-collaboration-guidelines.md`, `<skills_root>/_shared/references/runtime-quality-procedures.md`, `<skills_root>/_shared/references/php-symfony-postgres-standards.md`).
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika o wymagane klucze i wstrzymaj wykonanie.
- Brak klucza `MAIN_DOC` w `docs_map` — dopytaj użytkownika i wstrzymaj wykonanie.
