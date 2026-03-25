# Runtime Guidelines For Skills

Ten dokument zawiera **przenośne zasady współpracy i realizacji zadań** używane przez skille.
Nie jest to konfiguracja konkretnego projektu biznesowego.

## 1. Mapa źródeł prawdy
- Współpraca i sposób działania agenta: ten plik.
- Procedura jakości (kolejność kroków): `./runtime-quality-procedures.md`.
- Baseline techniczny stacka: `./php-symfony-postgres-standards.md`.
- Odstępstwa architektoniczne (warunkowe): `./cqrs-monolith-standard-overrides.md`.
- Procedury operacyjne (QA/commit/commit-message/review): właściwe skille (`$qa-run`, `$git-commit`, `$commit-message-write`, `$review-quick`, ...).

## 1a. Reguły ścieżek i priorytetu dla skilli
- Po wybraniu skilla agent zna pełną ścieżkę do aktywnego `SKILL.md`.
- Definicje kontraktowe:
  - `skill_dir` = katalog aktywnego `SKILL.md`
  - `skills_root` = katalog nadrzędny wobec `skill_dir`
- W treści `SKILL.md` używaj wyłącznie jawnej notacji:
  - `./...` dla ścieżek repo-relative (`./` = root repo),
  - `<skill_dir>/...` dla plików aktywnego skilla,
  - `<skills_root>/_shared/...` dla plików współdzielonych,
  - `<skills_root>/<nazwa-skilla>/SKILL.md` dla odwołań do innych skilli.
- Nie używaj w treści `SKILL.md` gołych ścieżek względnych typu `scripts/...`, `references/...`, `assets/...`, `templates/...`, `_shared/...` ani `../...`.
- W `shared_files` ścieżki pozostają relative względem `skills_root` z powodów kompatybilności z toolingiem repo.
- Zalecany porządek priorytetu reguł w skillach:
  1. Instrukcje systemowe/developerskie środowiska
  2. `./AGENTS.md` i dokumenty z `docs_map`
  3. Bieżący `SKILL.md`
  4. Pliki wskazane w `shared_files`

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

## 3. Zasady bezpiecznej edycji
- Nie nadpisuj cudzych zmian i nie edytuj plików „w ciemno”.
- Przed modyfikacją pliku już zmienionego w repo przeczytaj jego aktualną treść i diff.
- Nie używaj destrukcyjnych komend git bez wyraźnego polecenia użytkownika.
- Commity wykonuj tylko po jednoznacznym poleceniu użytkownika i przez dedykowaną procedurę `$git-commit`.

## 4. Wykonanie techniczne
- Przed implementacją sprawdź wersje bibliotek i kontekst środowiska.
- Korzystaj z lokalnych entrypointów narzędzi projektu ustalonych wyłącznie przez `.agents/skills/_shared/scripts/env-load.sh` (`resolve_tool_cmd`).
- `resolve_tool_cmd` jest jedynym źródłem prawdy dla ścieżek narzędzi; nie wyprowadzaj ich ręcznie z `BIN_PATH` (env ładowany automatycznie).
- Nie dodawaj zależności, migracji ani zmian bezpieczeństwa bez świadomej decyzji użytkownika.
- Unikaj lokalnych supresji lintów/testów jako sposobu „naprawy” problemu jakości.

## 5. QA Command Policy (single source of truth)
- Źródłem prawdy dla komend QA jest wyłącznie repozytorium: `.agents/qa-run.matrix.json`.
- Agent nie uruchamia komend QA „z sufitu” (np. bezpośrednio `stylelint`, `eslint`, `phpstan`, `codecept`), jeśli nie występują one 1:1 w macierzy QA.
- Dopuszczalny jest ad-hoc quick-check, ale tylko:
  - komendami obecnymi 1:1 w `.agents/qa-run.matrix.json`,
  - dla sekcji odpowiadającej rzeczywiście wykrytym zmianom (`*_CHANGED`),
  - jako lekki zakres (1-2 komendy), bez rozszerzania na pełny zestaw.
- W ad-hoc quick-check domyślnie używaj komend niemutujących (bez `:fix`).
- Komendy mutujące (`*:fix`) uruchamiaj wyłącznie:
  - na wyraźne polecenie użytkownika, albo
  - w ramach pełnej procedury `$qa-run`.
- Pełne QA (pełna sekwencja komend i iteracje naprawcze) uruchamiaj wyłącznie przez `$qa-run`.
- Jeśli potrzebna komenda QA nie ma odpowiednika w macierzy, agent zgłasza brak i nie uruchamia alternatywnej komendy ad-hoc.

## 6. Dokumentacja i spójność
- Aktualizuj dokumentację tylko tam, gdzie zmiana faktycznie wpływa na opis działania.
- Dla procedur operacyjnych trzymaj zasadę skills-first: kroki są w skillach, w docs zostają skróty/intencje.
- Nie duplikuj tej samej procedury w wielu miejscach; zamiast tego linkuj do źródła prawdy.

## 7. Baseline vs override
- Zawsze stosuj baseline z `php-symfony-postgres-standards.md`.
- Jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1`, dołącz reguły z `cqrs-monolith-standard-overrides.md`.
- Przy sprzeczności baseline/override: override ma pierwszeństwo.

## 8. Priorytet reguł (rozstrzyganie konfliktów)
Stosuj zasady w tej kolejności (od najwyższego priorytetu):
1. Polecenie użytkownika z bieżącego zadania.
2. Lokalne zasady repo z `AGENTS.md` i dokumentów przez niego wskazanych.
3. Aktywny profil architektoniczny z `cqrs-monolith-standard-overrides.md` (tylko gdy `CQRS_MONOLITH_STANDARD_OVERRIDES=1`).
4. Baseline stacka z `php-symfony-postgres-standards.md`.
5. Runtime współpracy i jakości: ten plik + `runtime-quality-procedures.md`.

Reguła: poziom niższy jest fallbackiem i nie nadpisuje poziomu wyższego.
Wyjątek: twarde guardraile bezpieczeństwa (np. zakaz destrukcyjnych komend git bez wyraźnej zgody) pozostają obowiązujące.
