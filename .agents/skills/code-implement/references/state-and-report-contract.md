# Kontrakt stanu i raportu

Ten plik jest częścią `$code-implement` i ładujesz go warunkowo, zgodnie z tabelą
routingu w `<skill_dir>/SKILL.md`. Zawiera szczegóły stanu zadania, rejestru
wymagań, blockerów i formatu raportu; brzmienie oraz numeracja sekcji odpowiadają
stanowi sprzed wyniesienia z korzenia `SKILL.md`.

## Problem, który ten skill ma rozwiązać (v2/v3)
Ten skill ma minimalizować typowe problemy w pracy iteracyjnej:
- “uciekanie” wymagań z prompta,
- gubienie wątku w pętli feedback → poprawka → feedback,
- deklaracje bez weryfikacji (“sprawdziłem X”, gdy nie było odczytu/komendy),
- nadpisywanie ręcznych zmian użytkownika.

Mechanizmy:
- **Rejestr wymagań** (lista wymagań + statusy),
- **pliki stanu** w `STATE_PATH` (lokalne, ignorowane przez git),
- **evidence-based claims** (twierdzenia tylko z dowodem),
- **dyscyplina iteracji** (1 iteracja = 1 cel + 1 kryterium “gotowe”).

## Definicje

### Stałe ścieżek (z env)
- `CACHE_PATH`:
  - wartość z aktywnych plików env repo ładowanych przez `<skills_root>/_shared/scripts/env-load.sh`,
  - domyślnie `var/agent/cache`.
- `STATE_PATH`:
  - `${CACHE_PATH:-var/agent/cache}/code-implement/state.md`
  - to jest jedyna ścieżka stanu używana przez ten skill.

### Plik stanu (wymagany)
Utrzymuj trwały stan zadania w pliku:
- `STATE_PATH` (`${CACHE_PATH:-var/agent/cache}/code-implement/state.md`) — **lokalny** i **ignorowany przez git**; nie commitujemy go.

Plik ma umożliwić “powrót do sedna” między iteracjami bez zasypywania użytkownika:
- Rejestr wymagań (wymagania R1..Rn + status),
- główne założenia/ustalenia,
- lista dotkniętych plików/modułów,
- log iteracji (co użytkownik zgłosił → co zmieniono → jaki wynik),
- dziennik odczytów: jakie pliki/komendy zostały faktycznie odczytane/uruchomione (dowód dla “twierdzeń opartych na dowodach”).

Minimalny format (utrzymuj spójnie):
- **Aktywne zadanie**: Cel + Założenia/Decyzje + Dotknięte obszary.
- **Rejestr wymagań**: każdy wpis ma formę
  - `- R1 (STATUS): <jednozdaniowe wymaganie>`
  - `  - Kryteria: <1–3 kryteria akceptacji>`
  - `  - Dowody: <pliki/komendy/obserwacje>` (wymagane przy `DONE`)
  - `  - Notatki: <blokery/uzgodnienia>` (jeśli dotyczy)
- **Przykład (skrót)**:
  - `- R3 (DONE): Zmiana e-maila profilu działa w Core`
  - `  - Kryteria: Formularz zapisuje e-mail; flash sukcesu; użytkownik pozostaje zalogowany`
  - `  - Dowody: src/Core/UI/Controller/Profile/EmailController.php; sprawdzenie manualne`
- **Dziennik odczytów**: dopisuj wyłącznie przez `<skill_dir>/scripts/state-readlog.mjs`; dla odczytów objętych obserwowalnością użyj strukturalnych flag `--purpose`, `--event`, `--source`, `--read-mode` oraz `--path`/`--scope` jako pierwszych argumentów, a zwykły komunikat pozostaje opcjonalny. Legacy free-text zachowuje dowolne późniejsze argumenty.
  - Przykład: `- [2026-01-16T21:20:00+01:00] rg "EntityConnection" -n src; git diff --stat`
- **Dziennik iteracji**: dopisuj wyłącznie przez `<skill_dir>/scripts/state-log.mjs "<msg>"`.
  - Timestamp zawsze z systemu (`date --iso-8601=seconds`); zero wpisów ręcznych.
  - Trzymaj "### Dziennik iteracji" jako ostatnią sekcję, aby skrypt dopisywał w poprawnym miejscu.

Zasady:
- nie pokazuj treści `STATE_PATH` w odpowiedziach, chyba że użytkownik poprosi,
- przy konflikcie “pamięć vs repo” zawsze wygrywa repo + aktualny diff.

Uwaga: dokument handoff wskazany przez `docs_map` w `AGENTS.md` jest zarezerwowany dla `$handoff-refresh` (przekazanie kontekstu do kolejnego agenta) — nie używaj go jako stanu zadania implementacyjnego.

Czyszczenie stanu (ważne):
- Dopóki nie ma commita i użytkownik nie zrezygnował z zadania: **nie usuwaj** pliku stanu (ma umożliwić wznowienie po przerwaniu/utracie sesji).
- Nie traktuj ogólnych słów typu “stop”, “poczekaj”, “wróćmy”, “zmieńmy podejście” jako polecenia czyszczenia stanu.
- Wyczyść stan **tylko** w jednym z przypadków:
  1) użytkownik wprost poleca czyszczenie stanu i używa jednoznacznego sformułowania (trigger phrase):
     - “wyczyść stan code-implement”
     - “odpal czyszczenie stanu code-implement”
     - “uruchom state-clear”
     - “clear code-implement state”
     
     → uruchom `<skill_dir>/scripts/state-clear.mjs`,
  2) użytkownik jednoznacznie anuluje zadanie i chce wycofać zmiany:
     - przykładowe jednoznaczne polecenia:
       - “anuluj zadanie i wycofaj zmiany”
       - “odwróć zmiany z tego zadania i wyczyść stan code-implement”
     - najpierw dopytaj, czy chodzi o wycofanie **wszystkich** niecommitowanych zmian w repo, czy tylko zmian z tego zadania,
     - wycofaj zmiany **wyłącznie** na wyraźne polecenie użytkownika (zgodnie z `<skills_root>/_shared/references/runtime-collaboration-guidelines.md`),
     - dopiero po wycofaniu zmian uruchom `<skill_dir>/scripts/state-clear.mjs`.

Jeśli nie masz pewności, czy użytkownik chce czyszczenia stanu: dopytaj wprost “Czy mam wyczyścić stan code-implement?” i nie uruchamiaj `state-clear.mjs` bez potwierdzenia.

### “Rejestr wymagań”
To krótka, numerowana lista wymagań z prompta (R1..Rn), utrzymywana w `STATE_PATH`.

Reguły (format + kiedy + użycie):
- wymagania mają być konkretne i testowalne (“po kliknięciu X dzieje się Y”),
- statusy: `TODO` / `IN_PROGRESS` / `DONE` / `BLOCKED` / `OUT-OF-SCOPE`,
- dla wymagania wskaż istotne reguły/ograniczenia i ich wynik zgodności; semantykę wyników definiuje `<skills_root>/_shared/references/rule-conformance-policy.md`,
- `DONE` tylko gdy **wszystkie** Kryteria są spełnione, masz wpisane Dowody, a dla istotnych reguł dotkniętych wymaganiem nie pozostaje nierozwiązane twarde naruszenie ani luka uniemożliwiająca ocenę zgodności,
- brak punktowego testu, gdy zgodność potwierdza wystarczający odczyt kodu, to `verification_gap`, a nie blokada `DONE`,
- aktualizuj Ledger przy każdym: nowym wymaganiu od użytkownika, zmianie zakresu, ukończeniu części prac, końcu iteracji,
- na start iteracji wybierz R# jako cel i odwołuj się do niego w odpowiedzi,
- w pytaniach zawsze wskazuj, które R# blokuje brak informacji,
- na koniec zadania raportuj statusy (zwięźle, bez wklejania całej listy).
Jeśli masz wątpliwości co do kompletności Kryteriów lub Dowodów, ustaw `IN_PROGRESS` i dodaj Notatki.

Twarde reguły statusów:
- `TODO` -> `IN_PROGRESS`: gdy rozpoczęto implementację wymagań R#.
- `IN_PROGRESS` -> `DONE`: tylko jeśli wszystkie kryteria R# są spełnione i wpisano dowody.
- `IN_PROGRESS` -> `BLOCKED`: tylko z kodem blokera i uzasadnieniem.
- `DONE` -> `IN_PROGRESS`: jeśli nowy feedback obala kryterium „gotowe”.
- `OUT-OF-SCOPE`: tylko po jawnym potwierdzeniu użytkownika.

### `STOP_CODES` (zamknięta lista blockerów)
- `missing_acceptance_criteria`
- `security_scope_unclear`
- `migration_requires_decision`
- `dependency_change_requires_approval`
- `critical_scope_expansion`
- `env_blocker`
- `qa_iteration_limit_reached`

Sam poziom `HIGH` z `$review-quick` nie jest kodem blokera ani powodem `BLOCKED`.
Gdy potrzebna jest decyzja albo wyjście poza zakres, użyj wyłącznie istniejącego,
rzeczywiście pasującego `STOP_CODE`; lista pozostaje zamknięta.

### Słownik `STOP_CODES` (znaczenie + kiedy użyć)
#### `missing_acceptance_criteria`
- Znaczenie: brak minimalnych kryteriów akceptacji uniemożliwia bezpieczną implementację.
- Kiedy zwracać: nie da się określić `done/not done` dla R#.
- Kiedy nie zwracać: kryteria są niepełne, ale wystarczają do wykonania minimalnej, odwracalnej iteracji.

#### `security_scope_unclear`
- Znaczenie: zmiana dotyka auth/security/permissions bez jednoznacznego wymagania.
- Kiedy zwracać: implementacja wymaga decyzji o modelu uprawnień lub ścieżce autoryzacji.
- Kiedy nie zwracać: zmiana jest czysto techniczna i nie zmienia zachowania security.

#### `migration_requires_decision`
- Znaczenie: potrzebna migracja lub zmiana relacji danych bez zgody użytkownika.
- Kiedy zwracać: modyfikacja schematu jest niezbędna do realizacji R#.
- Kiedy nie zwracać: można spełnić R# bez migracji.

#### `dependency_change_requires_approval`
- Znaczenie: potrzebna zmiana zależności (`composer`/`yarn`) bez akceptacji.
- Kiedy zwracać: brak możliwej implementacji w istniejącym stacku.
- Kiedy nie zwracać: istnieje rozwiązanie bez nowych zależności.

#### `critical_scope_expansion`
- Znaczenie: realizacja wymaga wejścia w krytyczne pliki poza uzgodnionym zakresem.
- Kiedy zwracać: bez tej zmiany implementacja byłaby błędna lub niekompletna.
- Kiedy nie zwracać: da się zrobić minimalny fix w aktualnym zakresie.

#### `env_blocker`
- Znaczenie: środowisko blokuje weryfikację/implementację (narzędzia, kontenery, DB, uprawnienia).
- Kiedy zwracać: dozwolona komenda została rzeczywiście uruchomiona, błąd środowiska jest reprodukowalny i nieusuwalny w bieżącej sesji, a `<skills_root>/_shared/scripts/targeted-check-decision.mjs` zwrócił `ENV_BLOCKER`.
- Kiedy nie zwracać: komendy jeszcze nie próbowano uruchomić, brakuje punktowego wpisu w matrixie albo problem znika po poprawnym użyciu lokalnych entrypointów (`resolve_tool_cmd`) lub prostym retry. Brak punktowej komendy to `verification_gap`, nie `env_blocker`.

#### `qa_iteration_limit_reached`
- Znaczenie: `$qa-run` nie osiągnął `PASS` w limicie iteracji.
- Kiedy zwracać: wyczerpany limit iteracji i nadal `FAIL`.
- Kiedy nie zwracać: limit nie został osiągnięty albo QA zakończone `PASS`.

## Zakres automatycznych poprawek
- Dozwolone:
  - zmiany wynikające bezpośrednio z R#,
  - minimalne techniczne poprawki konieczne do domknięcia kryterium.
- Niedozwolone bez zgody użytkownika:
  - nowe zależności,
  - migracje danych/schematu,
  - zmiany security/permissions,
  - szerokie refaktory poza celem iteracji.

### 7) Raport końcowy (format)
Zakończ odpowiedź w stałej strukturze:
- Wynik: co zostało zrobione (1–5 punktów).
- Status wymagań: skrót statusów każdego R# (`DONE` / `IN_PROGRESS` / `BLOCKED` / `OUT-OF-SCOPE`).
- Dowody dla `DONE`: pliki/komendy potwierdzające zamknięcie każdego ukończonego R#.
- Pliki/obszary: gdzie dotknięto (moduły / kluczowe pliki).
- Weryfikacja:
  - `$review-quick` — wykonano / pominięto (dlaczego),
  - punktowy test/lint — wykonano / pominięto (dlaczego),
  - `$qa-run` — wykonano tylko na wyraźne polecenie użytkownika / pominięto (dlaczego).
- Iteracje QA: jeśli użytkownik wyraźnie zlecił `$qa-run`, podaj `Wykonano iteracji: X/20` i `Status końcowy: PASS | BLOCKED`.
- Zgodność reguł: naruszenia, wyjątki i luki istotnych reguł dla zrealizowanego zakresu (jeśli dotyczy).
- Ryzyka/Błędy: co wymaga uwagi (jeśli dotyczy).
- Testy: sugerowane scenariusze lub testy do dodania (jeśli dotyczy).
- Blokery: jeśli wystąpiły, podaj `STOP_CODE` + przyczynę.
- Następny krok: czy robimy `$git-commit`, czy jeszcze poprawki.
