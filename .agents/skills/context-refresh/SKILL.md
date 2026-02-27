---
name: context-refresh
description: "Inicjalizacja i odświeżenie kontekstu projektu. Intencje: załaduj/odśwież kontekst, wczytaj dokumenty startowe, sprawdź stan repo. Użyj, gdy proszą o załadowanie kontekstu lub gdy uruchamiany jest $context-refresh."
---

# $context-refresh

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Celem jest załadowanie lub odświeżenie kontekstu projektu w sposób spójny i skalowalny, tak aby dalsze działania były oparte na:
- aktualnych zasadach/procedurach (źródła w skillach + dokumentacja projektu),
- bieżącym stanie repozytorium (zmiany tracked/untracked),
- dokumentacji domenowej/modułowej dotyczącej realnie dotkniętych obszarów.

W tym repozytorium źródłem prawdy dla “procedury startowej” jest ten skill (root `AGENTS.md` jest tylko entrypointem).

## Mapa ścieżek dokumentacji (AGENTS-first)
1. Zawsze zaczynaj od `AGENTS.md`.
2. Odczytaj mapę ścieżek dokumentacji `docs_map`.
3. Wszystkie ścieżki z mapy traktuj jako repo-relative.
4. Nie zgaduj ścieżek po nazwie pliku.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `MAIN_DOC`: główny dokument opisowy projektu.
- Opcjonalne:
  - `MODULE_INDEX_DOC`: indeks modułów.
  - `MODULE_DOCS_GLOB`: glob dla README dokumentacji modułów.
  - `TESTS_README`: README testów.
  - `SKILLS_INDEX_DOC`: indeks skilli.
  - `WORKLOG_DIR`: katalog workloga.
  - `HANDOFF_DOC`: plik handoffu.

## Tryb wykonania (Quick vs Full)
Ten skill ma dwa tryby wykonania. Domyślny jest **Quick**, a **Full** uruchamiaj tylko, gdy jest to uzasadnione.

### Tryb Quick (domyślny)
Cel: szybko uzyskać bezpieczny kontekst do pracy bez ładowania całej dokumentacji.
- Czyta “rdzeń” dokumentacji (procedury/zasady/indeksy) zawsze.
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
   - konfiguracji toolingu/CI (np. `composer.*`, `package.json`, `Makefile`, `.github/`, wrappery narzędziowe wynikające z `BIN_PATH`).

### 2) Minimalny baseline (zawsze)
Przeczytaj w całości (to jest minimalny “rdzeń” reguł i konwencji):
1. `../_shared/references/runtime-collaboration-guidelines.md`
2. `../_shared/references/runtime-quality-procedures.md`
3. `../_shared/references/php-symfony-postgres-standards.md`
4. Jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1` w `.env` / `.env.local`: `../_shared/references/cqrs-monolith-standard-overrides.md`

Następnie:
5. Odczytaj `MAIN_DOC`.
   - Jeśli mapy lub klucza `MAIN_DOC` brakuje: zatrzymaj się i dopytaj użytkownika.
6. Odczytaj `MODULE_INDEX_DOC` — jeśli zdefiniowano.
7. Odczytaj `SKILLS_INDEX_DOC` — jeśli zdefiniowano.
8. Odczytaj dokumenty worklogu z `WORKLOG_DIR` — jeśli zdefiniowano.
9. Odczytaj `HANDOFF_DOC` — jeśli zdefiniowano.

### 3) Dokumentacja modułowa (lazy, ale bezpiecznie)
1. Jeśli zdefiniowano `MODULE_DOCS_GLOB` i `git diff --name-only` zawiera zmiany w modułach, przeczytaj README dokumentacji dla każdego dotkniętego modułu.
2. Jeśli tryb to **Full** i zdefiniowano `MODULE_DOCS_GLOB`, przeczytaj README dokumentacji dla wszystkich modułów; jeśli zdefiniowano `MODULE_INDEX_DOC`, użyj go jako indeksu.

### 4) Testy (lazy)
Jeśli zdefiniowano `TESTS_README` i zmiany dotyczą testów lub sposobu ich uruchamiania (np. `tests/`, `codeception`, `make test.*`, wrapper `codecept` z `BIN_PATH`), przeczytaj README testów.
Jeśli tryb to **Full** i zdefiniowano `TESTS_README`, przeczytaj README testów niezależnie od zmian.

### 5) Analiza bieżących zmian (skalowalnie)
Cel: zrozumieć, “co jest zmienione w repo” bez konieczności wklejania dużych diffów do rozmowy.
1. Zrób szybki przegląd rozmiaru zmian: `git diff --stat`.
2. Zastosuj próg dla “czytam od razu”:
   - jeśli liczba zmienionych+nieśledzonych plików jest mała (np. ≤ 10): przejrzyj diff każdego pliku lub jego kluczowe fragmenty,
   - jeśli jest większa: ogranicz się do orientacji (stat/numstat) + pełne diffy tylko dla plików “high-risk” oraz dla obszaru wskazanego w prompt.
3. Trigger doczytania on-demand (kluczowe):
   Doczytywanie ma być uruchamiane wtedy, gdy “zadanie dotyka” pliku/obszaru, którego nie masz jeszcze wystarczająco dobrze w głowie. Triggerem jest zawsze potrzeba podjęcia decyzji lub wykonania zmiany w danym obszarze.
   
   To nie jest “ponowne uruchomienie `$context-refresh`”. To jest punktowe doczytanie tylko tego, co jest potrzebne w danym momencie.

   Uruchom doczytanie on-demand, jeśli zachodzi którekolwiek:
   - prompt wprost wymienia ścieżkę pliku (np. `src/.../Foo.php`) → przeczytaj ten plik i jego diff (jeśli ma),
   - prompt wprost wymienia symbol (klasa/metoda/komenda/route) → znajdź definicję (`rg`) i przeczytaj definicję + kontekst,
   - masz zmienić plik, który już jest zmieniony w repo (czyli “modyfikujesz cudze/bieżące zmiany”) → przeczytaj jego diff i aktualną treść przed edycją,
   - masz opisać zmianę w worklogu (`$worklog-add`) → upewnij się, że rozumiesz “co” i “dlaczego” (diff/kluczowe fragmenty),
   - QA/testy zwróciły błąd w pliku, którego nie analizowałeś → doczytaj od razu ten plik i sąsiedni kontekst,
   - pojawia się decyzja architektoniczna/domenowa, a nie czytałeś dokumentacji modułu/domeny dotkniętej zmianą → doczytaj README modułu (z `MODULE_DOCS_GLOB`) i relewantny fragment `MAIN_DOC`.

4. Procedura doczytania on-demand:
   - Ustal “target” doczytania: plik / moduł / symbol.
   - Jeśli target to plik:
     - jeśli plik jest zmieniony: przeczytaj `git diff -- <plik>` i aktualną treść pliku (przynajmniej relewantne sekcje),
     - jeśli plik nie jest zmieniony: przeczytaj aktualną treść pliku (relewantne sekcje).
   - Jeśli target to symbol:
     - wyszukaj definicję (`rg`) i przeczytaj fragment definicji + najbliższy kontekst użycia,
     - jeśli symbol należy do modułu: doczytaj README modułu dla kontekstu domenowego.
   - Jeśli target to moduł:
     - przeczytaj README modułu i (jeśli istnieje) sprawdź, czy indeks modułów nie odsyła do dodatkowych konwencji.
   - Po doczytaniu: wróć do zadania i podejmij decyzję/wykonaj zmianę w oparciu o doczytane informacje.

5. Doczytanie on-demand (krótka zasada wykonawcza):
   - zanim zmodyfikujesz plik, którego zmian nie rozumiesz (bo np. był już zmieniony przed Twoją pracą), doczytaj jego diff/treść w tym momencie,
   - analogicznie: zanim napiszesz o nim w worklogu, upewnij się, że rozumiesz „co” i “dlaczego” (w praktyce robi to też `$worklog-add`).
6. Uwaga: jeśli kolejnym krokiem ma być `$worklog-add`, to ten skill ma własną procedurę analizy zmian przed napisaniem wpisu — `$context-refresh` nie musi “wiedzieć wszystkiego” o każdej zmianie, ale musi wiedzieć, co jest zmienione i gdzie.

### 6) Weryfikacja spójności procedur (jeśli dotyczy)
Jeśli zmiany dotyczą procedur (pliki w `../_shared/references/runtime-collaboration-guidelines.md`, `../_shared/references/runtime-quality-procedures.md`, `../*`):
1. Traktuj skille jako źródło prawdy dla procedur operacyjnych (QA/commit/worklog/review).
2. Jeśli widzisz rozbieżności, zanotuj je i zaproponuj korektę w skillu (nie dopisuj procedury “na boku” w docs).

### 7) Potwierdzenie gotowości
Podsumuj krótko:
- jakie dokumenty zostały wczytane (rdzeń + moduły dotknięte zmianami),
- jakie obszary kodu są zmienione,
- czy widzisz potencjalne rozbieżności/duplikaty w dokumentacji lub procedurach.

## Format odpowiedzi
- Wynik: “Kontekst załadowany/odświeżony”.
- Tryb: `Quick` lub `Full`.
- Użyte klucze dokumentacji: lista tylko tych kluczy `docs_map`, które były użyte w tym uruchomieniu (np. `MAIN_DOC=...`, `MODULE_DOCS_GLOB=...`).
- Wczytane: lista kluczowych dokumentów (rdzeń + moduły dotknięte).
- Zmiany w repo: krótki opis zakresu (moduły/obszary) + liczba plików zmienionych/untracked.
- Uwagi: braki, sprzeczności, duplikaty, rzeczy do doczytania “on-demand”.

## Przykłady wejścia
- "odśwież kontekst"
- "załaduj kontekst projektu"
- "wczytaj kontekst"

## Przykłady wyjścia
- ```text
  Wynik: Kontekst załadowany/odświeżony.
  Tryb: Quick
  Wczytane: `../_shared/references/runtime-collaboration-guidelines.md`, `../_shared/references/runtime-quality-procedures.md`, `../_shared/references/php-symfony-postgres-standards.md`, `MAIN_DOC` z `docs_map`.
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
- Brak jednego z kluczowych plików baseline skilli (`../_shared/references/runtime-collaboration-guidelines.md`, `../_shared/references/runtime-quality-procedures.md`, `../_shared/references/php-symfony-postgres-standards.md`).
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika o wymagane klucze i wstrzymaj wykonanie.
- Brak klucza `MAIN_DOC` w `docs_map` — dopytaj użytkownika i wstrzymaj wykonanie.
