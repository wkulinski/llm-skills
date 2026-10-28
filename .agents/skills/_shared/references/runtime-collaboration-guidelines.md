# Runtime Guidelines For Skills

Ten dokument zawiera **przenośne zasady współpracy i realizacji zadań** używane przez skille.
Nie jest to konfiguracja konkretnego projektu biznesowego.

## 1. Mapa źródeł prawdy
- Współpraca i sposób działania agenta: ten plik.
- Procedura jakości (kolejność kroków): `./runtime-quality-procedures.md`.
- Wybór profilu i aktywnych standardów (baseline/override): `./project-profiles.md`.
- Routing nadrzędnego workflow między skillami: `./skill-routing-policy.md`.
- Polityka wyboru nawigacji symbolicznej i zwykłego patcha, w tym preferencji `Serena-first` gdy Serena jest dostępna: `./symbolic-navigation-and-editing-policy.md`.
- Procedury operacyjne (QA/commit/commit-message/review): właściwe skille (`$qa-run`, `$git-commit`, `$commit-message-write`, `$review-quick`, ...).

## 1a. Reguły ścieżek i priorytetu dla skilli
Stosuj `./skill-structure-contract.md` — jedynego właściciela notacji ścieżek,
priorytetu zasad, semantyki `shared_files` i entrypointów.

## 2. Współpraca i komunikacja
- Najpierw doprecyzuj cel i kryteria akceptacji; nie zgaduj, gdy brakuje kluczowych danych.
- Odpowiadaj językiem użytkownika; kod i identyfikatory pozostają po angielsku.
- Komunikuj tylko twierdzenia oparte na dowodach (odczyt plików, wynik komend, diff).

## 2a. Triggery konsultacji

### Konflikt zakresu
- Opis: w trakcie realizacji zadania pojawia się rozjazd między bieżącym poleceniem a implikowanym rozszerzeniem zakresu.
- Trigger: sensowna kontynuacja wymagałaby dodania prac, których użytkownik nie zlecił wprost, albo zmiany celu zadania „po cichu”.
- Działanie: agent ma zatrzymać implementację i potwierdzić kierunek zamiast samodzielnie rozszerzać zakres.

### Czysty model vs kompatybilność kontraktu
- Opis: nowy, idiomatyczny albo framework-native model nie pasuje naturalnie do starego kontraktu wejścia.
- Trigger: wdrożenie nowego modelu wymaga dodatkowych adapterów, listenerów, normalizerów albo przepakowywania danych wyłącznie po to, aby zachować stary kontrakt wejścia.
- Trigger: więcej niż jedna warstwa kodu istnieje tylko po to, by pogodzić nowy model z niezmienionym payloadem, bez samodzielnej wartości biznesowej lub walidacyjnej.
- Działanie: agent ma zatrzymać implementację i przedstawić użytkownikowi wybór „czysty model z jawną zmianą kontraktu” vs „zachowanie kontraktu z warstwą adaptacyjną”.

### Refaktor zmienia publiczny kontrakt
- Opis: praca zaczęta jako refaktor techniczny przestaje być zmianą wyłącznie wewnętrzną i zaczyna modyfikować publiczny kontrakt używany przez inne warstwy, moduły albo klientów.
- Trigger: refaktor zmienia kształt requestu lub response, publiczne DTO, payload frontend-backend, publiczny interfejs z `Api/` albo inny jawny kontrakt współdzielony poza lokalną implementacją.
- Trigger: refaktor zmienia semantykę błędów, nazwy pól, strukturę danych albo reguły kompatybilności w miejscu, które jest częścią uzgodnionego lub testowanego kontraktu.
- Działanie: agent ma zatrzymać refaktor i skonsultować z użytkownikiem, czy priorytetem jest zachowanie kompatybilności, czy świadoma zmiana publicznego kontraktu.
- Ta zasada nie powinna odpalać konsultacji dla:
  - zwykłego refaktoru prywatnej metody,
  - zmian nazw klas lub metod niewystawionych poza lokalny moduł,
  - zmian wewnętrznego przepływu danych, jeśli publiczny shape wejścia i wyjścia pozostaje taki sam,
  - porządków architektonicznych bez wpływu na granice modułu.
- Powinna odpalać konsultację dopiero wtedy, gdy ruszamy coś w rodzaju:
  - payloadu runtime między frontendem i backendem,
  - klas z `src/*/Api/`,
  - kontraktu formularza lub endpointu używanego przez klienta,
  - shape błędów `400` / `403` / `422`, jeśli jest częścią kontraktu i testów,
  - publicznego interface/portu używanego poza lokalnym miejscem implementacji.

## 2b. Bezpieczne workflow bez dodatkowej zgody

Poniższe lokalne, nieinwazyjne czynności wykonuj bez pytania, o ile nie zachodzi
`STOP_CODE` ani bramka opisana niżej:

- odczyty stanu repozytorium w trybie read-only (`git status`, `git diff`,
  `git log`, odczyty plików, inspekcja konfiguracji) — bez zmian stanu;
- punktowe testy i reruny delta wyznaczone przez `targeted-check-decision`,
  wykonywane na fixture'ach bez dostępu produkcyjnego i ograniczone do
  `RUN_TARGETED_TEST` (jeden plik testowy albo 1–3 wskazane metody);
- preflight narzędzi oraz `--help`/`-h` lokalnych entrypointów ustalanych przez
  `resolve_tool_cmd` (`env-load.sh`), w tym sprawdzenie wersji bibliotek;
- odczyty plików potrzebne do `read-before-write`, gdy aktualny kontekst nie
  obejmuje jeszcze ich treści.

Ta lista nie luzuje żadnej bramki:

- nie zmienia ani nie usuwa `STOP_CODES`; blokery nadal wymagają decyzji
  użytkownika;
- nie zmienia bramek dla security, migracji i zmian zależności — te nadal
  wymagają świadomej zgody użytkownika;
- nie zmienia bramki commitów: `$git-commit` wykonuj wyłącznie po jednoznacznym
  poleceniu użytkownika;
- nie zmienia polityki pełnego QA: pełne `$qa-run` nadal wymaga wyraźnego
  polecenia użytkownika, a lista nie rozszerza punktowego checka do pełnego
  suite ani pełnej macierzy.

## 2c. Kontynuacja po niepełnym wykonaniu

- Niepełny wynik delegacji, limit kroków lub czasu wykonawcy ani brak odpowiedniej
  fixture nie stanowią samodzielnego blockera zadania. Agent główny odpowiada za
  kontynuację: wykorzystuje zweryfikowane dotychczasowe wyniki, przejmuje pozostałą
  pracę albo deleguje zawężony wycinek bez powtarzania ukończonego rozpoznania.
- Brak fixture lub bezpiecznej ścieżki weryfikacji najpierw oceń jako pracę do
  wykonania w ramach uzgodnionego zakresu i dozwolonej autonomii, nie jako
  automatyczny powód zakończenia zadania. Ocena nie nadpisuje wyniku
  `targeted-check-decision`: gdy helper zwraca `REVIEW_ONLY`, raportuj
  `verification_gap` zamiast rozszerzać weryfikację.
- Przed zatrzymaniem wskaż konkretną przeszkodę i dowód jej wystąpienia, wyjaśnij,
  dlaczego nie można jej bezpiecznie usunąć w ramach autonomii, oraz określ
  potrzebną decyzję lub dostęp użytkownika. Brak dowodu ukończenia nie jest
  sam w sobie dowodem blokady.
- Przeszkoda dotycząca jednej operacji blokuje tę operację, nie całe zadanie;
  wykonaj pozostałe niezależne i bezpieczne czynności, o ile nie narusza to
  warunków zatrzymania aktywnego workflow.
- Ta zasada nie rozszerza zakresu ani uprawnień, nie pozwala uznać niepełnej
  weryfikacji za ukończenie i nie omija `STOP_CODES`, bramek bezpieczeństwa,
  walidacji raportów ani limitów ponowień określonych przez właściwą procedurę.

## 3. Zasady bezpiecznej edycji
- Nie nadpisuj cudzych zmian i nie edytuj plików „w ciemno”.
- Przed modyfikacją pliku już zmienionego w repo przeczytaj jego aktualną treść i diff,
  chyba że ważny odczyt obejmuje bieżącą wersję i zakres patcha, a od tego odczytu nie
  wykryto zmiany.
- `dirty`/`untracked` opisuje stan repozytorium, a nie samodzielnie nieaktualność wiedzy agenta.
- Cel odczytu rozróżniaj jako: `discovery`, `read-before-write`, `verification`, `snapshot-refresh` albo `report-gap`.
- `read-before-write` jest guardem bezpieczeństwa, a nie szerokim krokiem discovery. Jeśli aktualny kontekst obejmuje plik i nie wykryto zmiany od ostatniego odczytu, nie powtarzaj szerokiego odczytu tylko z powodu statusu `dirty`.
- Etykieta celu odczytu jest deklarowaną telemetrią workflow; nie jest dowodem aktualności treści ani braku redundancji.
- Nie używaj destrukcyjnych komend git bez wyraźnego polecenia użytkownika.
- Commity wykonuj tylko po jednoznacznym poleceniu użytkownika i przez dedykowaną procedurę `$git-commit`.

## 3a. Historia git
- Historia jest liniowa: bez merge commitów. Zmiany z gałęzi bazowej wciągaj przez rebase albo `--ff-only`.
- Stan gałęzi porównuj z `origin/<gałąź bazowa>`; lokalna gałąź bazowa bywa nieaktualna.
- W commitach i opisach PR nie dodawaj `Co-Authored-By` ani stopki o generowaniu przez narzędzie.
- Repozytorium konsumenta może to nadpisać w `AGENTS.md` (zob. „Priorytet zasad” w `./skill-structure-contract.md`).

## 4. Wykonanie techniczne
- Przed implementacją sprawdź wersje bibliotek i kontekst środowiska.
- Korzystaj z lokalnych entrypointów narzędzi projektu ustalonych wyłącznie przez `.agents/skills/_shared/scripts/env-load.sh` (`resolve_tool_cmd`).
- `resolve_tool_cmd` jest jedynym źródłem prawdy dla ścieżek narzędzi; nie wyprowadzaj ich ręcznie z `BIN_PATH` (env ładowany automatycznie).
- Nie dodawaj zależności, migracji ani zmian bezpieczeństwa bez świadomej decyzji użytkownika.
- Unikaj lokalnych supresji lintów/testów jako sposobu „naprawy” problemu jakości.

## 5. QA Command Policy (single source of truth)
- Źródłem prawdy dla komend QA jest wyłącznie repozytorium: `.agents/qa-run.matrix.json`.
- Decyzję o końcowym checku punktowym wyznaczaj deterministycznie przez `.agents/skills/_shared/scripts/targeted-check-decision.mjs`. Helper zwraca wyłącznie `RUN_TARGETED_TEST`, `RUN_MATRIX_CHECK`, `REVIEW_ONLY` albo `ENV_BLOCKER`.
- Agent nie uruchamia komend QA „z sufitu” (np. bezpośrednio `stylelint`, `eslint`, `phpstan`, `codecept`), jeśli nie występują one 1:1 w macierzy QA, z jednym kontrolowanym wyjątkiem `RUN_TARGETED_TEST`.
- `RUN_TARGETED_TEST` pozwala uruchomić test wskazany przez kryterium akceptacji albo konkretny feedback użytkownika, jeżeli zakres obejmuje dokładnie jeden plik testowy lub 1–3 wskazane metody. Wykonaj go przez `$qa-run` w zakresie `point` z runnerem `targetedTests` z macierzy; runner rozwiązuje entrypoint przez `resolve_tool_cmd`. Brak takiego runnera jest `verification_gap` z zaleceniem konfiguracji, nie zgodą na ręczną komendę ani pełne QA.
- Wyjątek `RUN_TARGETED_TEST` dotyczy testów, nie lintów. Nie pozwala uruchamiać całego suite ani pełnego QA.
- Dopuszczalny jest ad-hoc quick-check, ale tylko:
  - komendami obecnymi 1:1 w `.agents/qa-run.matrix.json`,
  - dla sekcji odpowiadającej rzeczywiście wykrytym zmianom (`*_CHANGED`),
  - jako lekki zakres (1-2 komendy), bez rozszerzania na pełny zestaw.
- Ad-hoc quick-check nie może być pełnym test suite ani pełną macierzą QA „dla pewności”; taki zakres wymaga `$qa-run`, `$git-commit` albo wyraźnego polecenia użytkownika.
- Ad-hoc quick-check w pętli implementacyjnej jest przyrostowy: po kolejnym kroku sprawdza ostatni przyrost (pliki/funkcje/sekcję/błąd zmienione w tym kroku), nie cały narosły dirty diff ani całe rozwiązanie.
- Jeśli repo ma wiele bieżących zmian, nie rozszerzaj przez to zakresu punktowego checka; pełniejsza walidacja całego rozwiązania należy do `$qa-run`, `$git-commit` albo jawnej decyzji użytkownika.
- W ad-hoc quick-check domyślnie używaj komend niemutujących (bez `:fix`).
- Komendy mutujące (`*:fix`) uruchamiaj wyłącznie:
  - na wyraźne polecenie użytkownika, albo
  - w ramach pełnej procedury `$qa-run`.
- Pełne QA (pełna sekwencja komend i iteracje naprawcze) uruchamiaj wyłącznie przez `$qa-run`.
- Pełne QA wymaga wyraźnego polecenia użytkownika albo workflow, który sam go wymaga (np. `$git-commit`). Rozległa lub high-risk zmiana uzasadnia rekomendację pełnego QA, nie jego samoczynne uruchomienie.
- `RUN_MATRIX_CHECK` oznacza lekki check 1:1 z macierzy, wykonywany przez `$qa-run` w zakresie `point` (albo `partial` dla 1–2 komend tej samej decyzji). `REVIEW_ONLY` oznacza jawny `verification_gap`, a nie blocker techniczny; pełny suite nie jest fallbackiem. `ENV_BLOCKER` wolno zgłosić wyłącznie po rzeczywistej próbie wykonania dozwolonej komendy zakończonej błędem środowiska.

### 5.1 Rytm sprawdzeń

- Rozpoznanie i read-before-write są odczytami, nie kontrolą QA. Przed zmianą kontraktu (publicznego wyniku, sygnatury, komunikatu, konfiguracji DI) rozpoznaj jego rzeczywistych konsumentów; nie zastępuj tego późniejszym szerokim testem.
- Testy w toku pracy służą diagnozie lub postępowi bieżącego kroku i podlegają tej samej bramce. Odbiór dotyczy gotowego przyrostu: przed oddaniem nazwij spójny przyrost, wykonaj dla niego jedno `$review-quick` i kontrole wybrane bramką.
- Kontrole wykonuj przez `$qa-run` w zakresie `point` lub `partial`. Wynik ograniczonego zakresu nigdy nie jest pełnym QA. `partial` szerszy niż lekki zakres powyżej wymaga jawnego żądania użytkownika albo uprawnienia nadrzędnego workflow.
- Ponowienie wymaga konkretnej przyczyny. Poprawka unieważnia tylko dowody obejmujące zmienione pliki lub kontrolę; nie powtarzaj bezwarunkowo kontroli, których poprawka nie dotyczy (np. lintu kontenera DI po zmianie bez wpływu na usługi i konfigurację).
- Aktualny dowód (ten sam zakres, snapshot i `evidence=current`) można wykorzystać ponownie w obecnej sesji; nie uruchamiaj niezależnej rundy, która go powtarza. Wynik `evidence=stale` nie potwierdza bieżącej wersji.
- Bramka pełnego QA (np. przed commitem) wymaga pełnego `$qa-run`; PASS `point`, `partial` albo nieaktualny jej nie spełnia.

## 6. Dokumentacja i spójność
- Aktualizuj dokumentację tylko tam, gdzie zmiana faktycznie wpływa na opis działania.
- Dla procedur operacyjnych trzymaj zasadę skills-first: kroki są w skillach, w docs zostają skróty/intencje.
- Nie duplikuj tej samej procedury w wielu miejscach; zamiast tego linkuj do źródła prawdy.
