---
name: code-implement
description: >-
  Orkiestrator implementacji zmian w kodzie: intake prompta,
  dopytania/stop-conditions, doczytanie kontekstu repo, zasady kodowania, lekkie
  checki na końcu (`$review-quick` + punktowy test/lint), bez pełnego `$qa-run`
  poza jednoznacznym poleceniem użytkownika, oraz standard
  raportowania. Użyj, gdy użytkownik zleca dodanie funkcjonalności, naprawę
  błędu lub refaktor bez istniejącego planu; gdy prompt wskazuje istniejący plan
  albo WP, pierwszym workflow jest `$plan-execute`, chyba że użytkownik jawnie
  zażąda bezpośredniej implementacji.
shared_files:
    - _shared/references/skill-routing-policy.md
    - _shared/references/runtime-collaboration-guidelines.md
    - _shared/references/runtime-quality-procedures.md
    - _shared/references/php-symfony-postgres-standards.md
    - _shared/references/cqrs-monolith-standard-overrides.md
    - _shared/references/symbolic-navigation-and-editing-policy.md
    - _shared/references/context-subagent-contract.md
    - _shared/references/repository-context-hybrid.md
    - _shared/references/repository-context-scout-playbook.md
    - _shared/references/context-scout-report-protocol.md
    - _shared/scripts/context-criteria.mjs
    - _shared/scripts/context-handoff.mjs
    - _shared/scripts/context-manifest.mjs
    - _shared/scripts/artifact-path.mjs
    - _shared/scripts/context-scout-hybrid-run.mjs
    - _shared/scripts/context-scout-report-builder.mjs
    - _shared/scripts/context-scout-report.mjs
    - _shared/scripts/read-purpose.mjs
    - _shared/scripts/secret-detector.mjs
    - _shared/scripts/env-load.sh
    - _shared/scripts/targeted-check-decision.mjs
---

# $code-implement

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Poprowadzić implementację zmian w kodzie end-to-end w sposób powtarzalny i bezpieczny:
- doprecyzować zlecenie (pytania, kryteria akceptacji),
- doczytać właściwy kontekst z repo (tylko to, co potrzebne),
- wdrożyć zmianę zgodnie z zasadami projektu,
- wykonać lekką weryfikację na końcu wyłącznie przez `review-quick` i punktowy test/lint bezpośrednio związany z ostatnim przyrostem,
- nie uruchamiać pełnego `$qa-run` poza wyraźnym, jednoznacznym poleceniem użytkownika,
- zaraportować wynik w stałym formacie.

### Guard routingu

Przed intake zastosuj
`<skills_root>/_shared/references/skill-routing-policy.md`. Jeśli prompt
wskazuje istniejący plan albo WP i nie zawiera jawnego polecenia bezpośredniej
implementacji przez `$code-implement`, ten skill nie przejmuje orkiestracji —
sterowanie należy przekazać do `$plan-execute`. Po handoffie z `$plan-execute`
implementuj wyłącznie wskazany jeden WP. W trybie handoff `$code-implement`
działa jako **wykonawca** dokładnie jednego WP, a nie jako orkiestrator —
orkiestracja pozostaje po stronie `$plan-execute`.

## Tryb domyślny i autonomia
- Domyślnie `$code-implement` działa w trybie `autonomous`.
- `autonomous` oznacza: agent samodzielnie implementuje i weryfikuje zmianę bez dopytywania, o ile nie zachodzi `stop-condition`.
- Dopytanie jest wymagane wyłącznie przy blockerach z listy `STOP_CODES`.

## Kontrakt iteracji (obowiązkowy)
- `Iteracja` = jedna zamknięta pętla: cel -> implementacja -> weryfikacja -> aktualizacja stanu.
- Dla każdej iteracji raportuj wewnętrznie (w `STATE_PATH`):
  - `Cel iteracji`,
  - `Kryterium gotowe`,
  - `Wynik`,
  - `Dowody` (pliki/komendy),
  - `Decyzja next`.
- Nie zamykaj iteracji bez aktualizacji statusów R#.

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

Źródła prawdy:
- zasady współpracy/runtime: `<skills_root>/_shared/references/runtime-collaboration-guidelines.md`
- routing nadrzędnego workflow: `<skills_root>/_shared/references/skill-routing-policy.md`
- checklisty jakości: `<skills_root>/_shared/references/runtime-quality-procedures.md`
- baseline techniczny stacka: `<skills_root>/_shared/references/php-symfony-postgres-standards.md`
- override architektoniczny (warunkowy): `<skills_root>/_shared/references/cqrs-monolith-standard-overrides.md` — tylko gdy aktywne pliki env repo ustawiają końcowo `CQRS_MONOLITH_STANDARD_OVERRIDES=1`
- polityka wyboru nawigacji symbolicznej, zwykłego patcha i narzędzi refactor: `<skills_root>/_shared/references/symbolic-navigation-and-editing-policy.md`
- kontrakt kontekstu między agentami: `<skills_root>/_shared/references/context-subagent-contract.md`
- kontekst repo: `$context-refresh` (`<skills_root>/context-refresh/SKILL.md`)
- diagnostyka runtime/introspekcja: `$dev-mate` (`<skills_root>/dev-mate/SKILL.md`) — użyj, gdy problem dotyczy logów, profilera albo DI i potrzebujesz ustrukturyzowanych dowodów z AI Mate
- szybkie review: `$review-quick` (`<skills_root>/review-quick/SKILL.md`)
- pełne QA: `$qa-run` (`<skills_root>/qa-run/SKILL.md`)
- commit: wyłącznie `$git-commit` (`<skills_root>/git-commit/SKILL.md`)

## Delegacja do skilli specjalistycznych
Podczas implementacji nie wykonuj ręcznie operacji, które są już opisane przez
wyspecjalizowany skill, jeśli ten skill może wykonać je precyzyjniej, szybciej
albo z mniejszym ryzykiem pomyłki.

### Delegacja do specjalistycznych agentów i skryptów
Podczas implementacji nie wykonuj ręcznie operacji, które są już opisane przez
wyspecjalizowany skill, jeśli ten skill albo jego entrypoint może wykonać je
precyzyjniej, szybciej albo z mniejszym ryzykiem pomyłki.

Stosuj bezpośrednie trasy:
- repozytoryjny rekonesans wykonuj przez
  `<skills_root>/_shared/scripts/context-scout-hybrid-run.mjs` i jego lifecycle
  `prepare → claim → settle/abort`; po walidacji raportu możesz wykonywać
  punktowe odczyty,
- pełny `$context-refresh` wykonuj jako agent główny albo deleguj bezpośrednio
  `context-refresher`, gdy nie istnieje ważny manifest,
- problemy runtime, DI, logów i profilera deleguj bezpośrednio
  `runtime-diagnostician`, a jeśli agent jest niedostępny, użyj `$dev-mate`,
- dokładnie jedno aktywne wymaganie `R#` opisujące jeden obserwowalny rezultat
  behawioralny i jedną główną odpowiedzialność produkcyjną deleguj bezpośrednio
  `implementation-worker`; testy i konieczna aktualizacja kontraktu mogą
  wspierać ten sam rezultat, ale nie tworzą osobnych outcome. Worker zwraca
  `STATUS: COMPLETED` albo `STATUS: ESCALATE_TO_PRIMARY`.

Minimalny handoff do `implementation-worker`:

```text
Requirement: <dokładnie jedno aktywne R#>
Single outcome: <jeden obserwowalny rezultat behawioralny>
Primary responsibility: <jedna odpowiedzialność produkcyjna>
Allowed production scope: <dozwolone pliki, symbole, moduł lub wąski katalog>
Allowed supporting tests: <testy bezpośrednio potwierdzające ten sam outcome>
Constraints: <zachowanie i obszary, których nie wolno zmieniać>
Decisions: <decyzje projektowe już podjęte przez agenta głównego>
References: <istniejące implementacje, wzorce lub dokumentacja>
Non-goals: <sąsiednie zachowania jawnie poza zakresem>
Acceptance criterion: <jeden obserwowalny warunek sukcesu>
Verification: <jedna punktowa komenda lub check potwierdzający outcome>
```

Jeśli któregoś pola brakuje i nie można bezpiecznie uzupełnić go z lokalnych
konwencji, nie deleguj zadania — doprecyzuj je albo wykonaj eskalację.

### Twarda bramka delegacji do `implementation-worker`

Przed każdym wywołaniem workera agent główny **MUSI** potwierdzić wszystkie
warunki:

1. delegacja realizuje dokładnie jedno wymaganie `R#` ze statusem `IN_PROGRESS`;
2. ma dokładnie jeden obserwowalny rezultat behawioralny;
3. dotyczy jednej głównej odpowiedzialności produkcyjnej;
4. wszystkie decyzje projektowe zostały już podjęte;
5. testy, fixtures i zmiany kontraktu dotyczą bezpośrednio tego samego rezultatu;
6. handoff zawiera jawne `Non-goals`;
7. istnieje jedna punktowa komenda albo check weryfikujący ukończenie;
8. ukończenie wycinka nie zależy od implementacji drugiej niezależnej funkcji.

Jeśli dowolny warunek nie jest spełniony, **NIE wywołuj**
`implementation-worker`. Podziel pracę na osobne wymagania lub iteracje i wybierz
jedno `R#` jako aktualnie `IN_PROGRESS`. Wyliczenie kilku niezależnych czasowników
w `Single outcome`, np. „naprawić, dodać, przebudować i udokumentować”, jest
sygnałem obowiązkowego podziału, chyba że wszystkie opisują nierozłączne części
jednego obserwowalnego zachowania.

Przed delegacją zapisz decyzję bramki w `STATE_PATH` przez `state-log.mjs`:

```text
Delegation gate: PASS
Requirement: R#
Single outcome: ...
Primary responsibility: ...
Non-goals: ...
Verification: ...
```

Nie zapisuj `PASS`, jeśli nie potrafisz wypełnić każdego pola bez ogólników.

### Bramka kosztowa delegacji
Nie deleguj do `implementation-worker`, jeśli:
- zmiana jest trywialna i lokalna, bez potrzeby testu lub dodatkowej weryfikacji,
- agent główny musiałby dopiero odkrywać zakres albo wybierać podejście,
- worker prawdopodobnie będzie musiał zadawać pytania lub wracać po decyzję.

Deleguj, gdy worker może samodzielnie wykonać pełny cykl `odczyt → implementacja
→ weryfikacja`, a koszt przygotowania handoffu i końcowego review jest mniejszy
niż wykonanie tych kroków przez agenta głównego. Nie stosuj sztywnego limitu
plików; oceniaj zamknięcie zakresu i liczbę wymaganych interakcji.

Po `STATUS: COMPLETED` agent główny powinien tylko:
1. obejrzeć scoped diff i listę zmienionych plików,
2. uruchomić wskazany punktowy check,
3. zaktualizować własny stan bez ponownego szerokiego discovery.

Po `STATUS: ESCALATE_TO_PRIMARY` agent główny przejmuje wskazaną decyzję lub
brakujący kontekst; nie deleguje ponownie tego samego pakietu bez zmiany
kontraktu.

Jeśli wskazany agent lub entrypoint jest niedostępny, wykonaj właściwy skill
bezpośrednio albo użyj opisanego fallbacku. Nie deleguj automatycznie
`$review-quick` ani `$qa-run`; ich procedury już ograniczają output i stanowią
część głównego workflow jakości.

Wybór narzędzia do odczytu i edycji kodu prowadź według
`<skills_root>/_shared/references/symbolic-navigation-and-editing-policy.md`.

Reguła praktyczna:
- jeśli środowisko udostępnia **Serenę** dla języka dotkniętego zadaniem,
  użyj Sereny najpierw do zawężenia zakresu,
- jeśli Serena wspiera stabilny zapis lokalnej zmiany symbolicznej,
  preferuj Serenę także do wykonania zmiany,
- jeśli Serena nie jest dostępna, ale działa inna warstwa symboliczna dla
  języka, użyj jej według tej samej logiki,
- jeśli zadanie dotyczy runtime, autowiringu, DI, logów albo profilera,
  najpierw deleguj `runtime-diagnostician`, gdy jest dostępny; w przeciwnym
  razie użyj `$dev-mate`,
- jeśli zadanie jest czysto tekstowe albo banalnie lokalne, użyj zwykłego patcha.

Dla PHP użyj `$php-structure-refactor` dopiero wtedy, gdy po zawężeniu zakresu
wychodzi, że potrzebna jest operacja narzędziowa lepiej obsłużona przez
Phpactora albo Rectora, np.:
- `class:move`, `class:copy`, `class:new`,
- rename albo aktualizacja wielu referencji,
- transformacja klasy lub AST na wielu plikach,
- fallback, gdy warstwa symboliczna nie ma stabilnej operacji wykonawczej.

Nie używaj `$php-structure-refactor` jako domyślnego read-path dla PHP, jeśli
Serena potrafi taniej znaleźć definicje, referencje i punkty wejścia. Jeśli
Serena nie jest dostępna, zastosuj ten sam warunek do innej aktywnej warstwy
symbolicznej.

## Kiedy użyć
Użyj, gdy użytkownik prosi o zmianę w kodzie (feature/bugfix/refactor), np.:
- “dodaj funkcjonalność…”
- “napraw błąd…”
- “zrefaktoruj…”
- “dodaj testy…”
- “zoptymalizuj…”

Nie używaj zamiast:
- `$git-commit` (gdy użytkownik prosi o commit),
- `$review-quick` (gdy użytkownik prosi tylko o szybki review bez implementacji),
- `$docs-sync` (gdy zadanie jest stricte dokumentacyjne).

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

### “Krytyczny plik”
Traktuj plik jako **krytyczny**, jeśli spełnia dowolny warunek:
1. Wpływa na globalne zachowanie aplikacji albo pipeline (config/tooling/CI), np.:
   - `composer.json`, `composer.lock`, `package.json`, `yarn.lock`
   - `config/**`, `./.github/**`, `./.docker/**`, `Makefile`
   - `bin/**` (w tym wrappery narzędziowe)
2. Jest “entrypointem” (zmienia publiczne wejścia do systemu), np.:
   - `src/*/UI/Controller/**`, `src/*/UI/Command/**`, `src/*/Api/**`
   - `config/routes*`, `config/packages/security.yaml` (oraz pliki security/routing)
3. Dotyka trwałości danych i/lub migracji:
   - `migrations/**`, `src/Migration/**`
   - `src/*/Infrastructure/**`
4. Dotyka rdzenia domeny:
   - `src/*/Domain/**`

### “Plik już zmieniony w repo” (guard: read-before-write)
To nie jest “krytyczność” sama w sobie. To guard przeciw nadpisaniu cudzych/ręcznych zmian.

Jeśli plik jest już zmieniony w repo (tracked/untracked) i nie masz wiarygodnego
odczytu jego aktualnej wersji dla zakresu patcha:
- przed edycją **obowiązkowo** przeczytaj diff i bieżącą treść (zakaz edycji “w ciemno”),
- staraj się robić minimalne patche, żeby nie nadpisać ręcznych zmian użytkownika.
Jeśli aktualny raport lub wcześniejszy odczyt obejmuje potrzebny zakres i nie
wykryto zmiany od tego odczytu, reuse kontekstu jest dozwolony; status dirty sam
w sobie nie wymusza pełnego odczytu.

Status `dirty`/`untracked` nie oznacza automatycznie, że cały plik trzeba ponownie
odkrywać. Rozróżniaj cel odczytu:

- `discovery` — szerokie rozpoznanie struktury lub zależności;
- `read-before-write` — punktowy guard przed patchem chroniący cudzą/ręczną zmianę;
- `verification` — sprawdzenie wyniku albo konkretnego kontraktu;
- `snapshot-refresh` — odczyt po wykryciu zmiany stanu repozytorium;
- `report-gap` — uzupełnienie luki w zwalidowanym raporcie.

Jeśli zwalidowany raport obejmuje plik, a od jego odczytu nie wykryto zmiany,
reuse raportu zastępuje szerokie `discovery`. Przed edycją nadal wykonaj tylko
guard wymagany przez aktualność pliku, zakres patcha lub jawne wymaganie użytkownika.
Cel i zakres odczytu loguj strukturalnie przez `state-readlog.mjs` obok zwykłego
Dziennika odczytów; etykieta jest telemetrią, nie dowodem aktualności treści.

### “Rejestr wymagań”
To krótka, numerowana lista wymagań z prompta (R1..Rn), utrzymywana w `STATE_PATH`.

Reguły (format + kiedy + użycie):
- wymagania mają być konkretne i testowalne (“po kliknięciu X dzieje się Y”),
- statusy: `TODO` / `IN_PROGRESS` / `DONE` / `BLOCKED` / `OUT-OF-SCOPE`,
- `DONE` tylko gdy **wszystkie** Kryteria są spełnione i masz wpisane Dowody,
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

## Kroki

### 0) Inicjalizacja stanu zadania (obowiązkowo)
1. Jeśli `STATE_PATH` nie istnieje: utwórz go z sekcją “Aktywne zadanie”.
2. Zapisz w nim:
   - krótkie streszczenie celu użytkownika,
   - wstępny Rejestr wymagań (R1..Rn),
   - założenia (jeśli są),
   - “ryzykowne obszary” (jeśli dotyczy: security/migracje/zależności).
 
Opcjonalnie (zalecane): do stworzenia szablonu użyj
`<skill_dir>/scripts/state-init.mjs`.

### 1) Intake (zanim dotkniesz kodu)
1. Zreasumuj zadanie w 1–3 zdaniach (“Rozumiem, że mam…”).
2. Zbierz minimalne kryteria akceptacji:
   - “co ma działać” (scenariusze),
   - “co nie może się zmienić” (inwarianty),
   - “jak to przetestujemy” (manualnie/testami).
3. Wyprowadź Rejestr wymagań (R1..Rn) i zapisz w `STATE_PATH`.
4. Kompromis “ocena prompta 1–10”:
   - wykonaj ocenę **tylko jeśli** zadanie jest niejednoznaczne, przekrojowe albo wchodzi w obszary ryzykowne (patrz Stop-conditions),
   - jeśli ocena <10: zaproponuj doprecyzowania (lista pytań) + opcja “zostaw bez zmian” i wstrzymaj implementację do decyzji.

### 2) Kontekst repo (skalowalnie)
1. Dla zadania przekrojowego, nieznanego modułu albo dużego dirty diffu użyj
   `<skills_root>/_shared/scripts/context-scout-hybrid-run.mjs`. Zwalidowany
   raport z repozytoryjnego rekonesansu zastępuje bezpośredni szeroki odczyt.
2. Jeśli nie istnieje ważny manifest kontekstu dla bieżącej sesji, uruchom
   `$context-refresh` bezpośrednio jako agent główny albo deleguj bezpośrednio
   `context-refresher`. Nie uruchamiaj pełnego refreshu z `context-scout`.
3. Dla każdego zadania wymagającego repozytoryjnego rekonesansu przygotuj zwięzły brief,
   handoff, manifest i criteria, a następnie uruchom helper hybrydy zgodnie z
   `<skills_root>/_shared/references/context-subagent-contract.md`. Nie
   przekazuj pełnej treści issue, komentarzy, dokumentów ani plików i nie omijaj
   primary bezpośrednim wywołaniem scouta.
4. Ustal obszar zmian:
   - znajdź docelowe moduły/pliki (np. przez `rg` po symbolach),
   - doczytaj README dokumentacji dla dotkniętych modułów (zgodnie z `docs_map` z `AGENTS.md`).
   - jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1`: doczytaj `<skills_root>/_shared/references/cqrs-monolith-standard-overrides.md` przed decyzjami architektonicznymi (warstwy/CQRS/Doctrine/FCF).
5. Zrób preflight entrypointów narzędzi:
   - załaduj helper `env-load.sh` wskazany w `shared_files`,
   - ustal komendy narzędziowe dla repo (co najmniej `composer`, `console`, `yarn`, `codecept`) wyłącznie przez `resolve_tool_cmd`,
   - `resolve_tool_cmd` traktuj jako jedyne źródło prawdy; aktywne pliki env repo są ładowane automatycznie w resolverze,
   - nie mieszaj wielu wariantów entrypointów w ramach jednego zadania.
6. Przed zmianą krytycznego pliku **lub** przed edycją pliku, którego aktualnej wersji
   dla zakresu patcha nie obejmuje ważny odczyt:
   - przeczytaj diff (`git diff -- <plik>`) i aktualną treść (relewantne sekcje),
   - dopiero potem edytuj. Status tracked/untracked sam nie unieważnia odczytu,
     jeśli nie wykryto zmiany od jego wykonania.
7. Po każdym realnym odczycie lub komendzie kontekstowej (np. `rg`, `sed`, `git diff`) albo po otrzymaniu raportu helpera lub subagenta dopisz wpis do Dziennika odczytów przez `<skill_dir>/scripts/state-readlog.mjs` (możesz grupować kilka odczytów w jeden wpis). Jeśli wpis ma być analizowany przez OWE, dodaj zamknięty cel odczytu; `report-reuse` rejestruj jako osobne zdarzenie bez udawania odczytu pliku.
8. Jeśli w trakcie implementacji wychodzi, że trzeba zmodyfikować plik, który nie wynika wprost z zadania:
   - jeśli to **krytyczny plik**: zatrzymaj się i dopytaj użytkownika, czy taki scope jest akceptowalny,
   - jeśli to **nie jest krytyczny plik**: nie “zasypuj pytaniami” — spróbuj znaleźć rozwiązanie w obrębie ustalonego zakresu; jeśli to niemożliwe, wykonaj minimalną zmianę konieczną technicznie i jawnie zaraportuj to w podsumowaniu.

Kontrakt lokalnych CLI poznawaj w kolejności: dokumentacja skilla → `--help`/`-h`
wywołanego entrypointu → punktowy odczyt źródła tylko przy braku lub sprzeczności
kontraktu. Nie czytaj całego skryptu, jeśli dokumentacja albo help opisują
argumenty i skutki wywołania. Wybór między rekonesansem szerokim a odczytem
punktowym rozstrzyga macierz w
`<skills_root>/_shared/references/repository-context-hybrid.md`; ten skill nie
kopiuje macierzy ani nie powtarza zakazów broad rediscovery i read-before-write.

### 3) Plan pracy
1. Jeśli zadanie nie jest trywialne: zaproponuj krótki plan (3–6 kroków) i trzymaj się go.
2. Jeśli w trakcie okaże się, że zakres rośnie: zatrzymaj się, zaktualizuj plan i poproś o potwierdzenie.

### 4) Implementacja (zasady + bramki)
1. Implementuj zgodnie z `<skills_root>/_shared/references/runtime-collaboration-guidelines.md`, baseline `<skills_root>/_shared/references/php-symfony-postgres-standards.md` oraz aktywnym override (jeśli flaga włączona).
2. Twierdzenia oparte na dowodach (anty-“kłamstwo”):
   - nie pisz “sprawdziłem/zweryfikowałem/przeczytałem”, jeśli nie wykonałeś realnego odczytu pliku lub komendy w tej sesji,
   - jeśli nie wiesz (albo nie sprawdziłeś): powiedz wprost i sprawdź,
   - jeśli odwołujesz się do wersji bibliotek: weryfikuj w `composer.lock`/`yarn.lock` lub komendą ustaloną przez `resolve_tool_cmd`.
3. Recovery po błędzie środowiskowym:
   - jeśli komenda diagnostyczna/QA zwraca błąd typu `php: command not found`, `/usr/bin/env: 'php': No such file or directory` albo analogiczny brak globalnej binarki, nie kończ na tym błędzie,
   - wróć do preflightu i ponów krok przez komendę ustaloną przez `resolve_tool_cmd`.
4. “Bezpieczne granice”:
   - nie dodawaj nowych zależności bez zgody użytkownika,
   - nie rób migracji/zmian schematu bez wyraźnego polecenia,
   - nie zmieniaj zachowania security/permissions bez jednoznacznego potwierdzenia.
5. Po dodaniu nowych plików PHP:
   - wykonaj `<COMPOSER_CMD> dump-autoload --no-scripts`, gdzie `<COMPOSER_CMD>` pochodzi z preflightu opartego o `resolve_tool_cmd` (zgodnie z `<skills_root>/_shared/references/runtime-quality-procedures.md`).

### 5) Stop-conditions (kiedy przerwać i dopytać)
Wstrzymaj implementację i zadaj pytania, jeśli pojawia się którykolwiek przypadek:
- brakuje danych wejściowych / kryteriów akceptacji, a bez nich łatwo zgadnąć źle,
- zmiana dotyka security/auth/access permissions i nie jest jasno opisana,
- zmiana wymaga migracji lub zmiany relacji danych,
- trzeba dodać/zmienić zależność (`composer.json`/`package.json`) bez zgody użytkownika,
- problem wygląda na środowiskowy (np. brak DB/containers) i blokuje QA/testy,
- implementacja zaczyna wymagać zmian poza zakresem w **krytycznym pliku** (tj. edycja nie wynika wprost z zadania),
- zakres znacząco przekracza pierwotne założenia.

Mapowanie przypadków na `STOP_CODES`:
- brak danych wejściowych / kryteriów akceptacji -> `missing_acceptance_criteria`
- niejasny zakres security/auth/access permissions -> `security_scope_unclear`
- wymagana migracja lub zmiana relacji danych -> `migration_requires_decision`
- wymagana zmiana zależności (`composer.json`/`package.json`) bez zgody -> `dependency_change_requires_approval`
- wymagane wyjście poza zakres w krytycznym pliku / znaczące przekroczenie zakresu -> `critical_scope_expansion`
- twardy problem środowiskowy blokujący dalsze kroki -> `env_blocker`
- limit iteracji `$qa-run` osiągnięty bez `PASS` -> `qa_iteration_limit_reached`

### 5.1) Dyscyplina iteracji (feedback loop)
Gdy użytkownik zgłasza błąd/uwagę po Twojej implementacji:
1. Zapisz feedback w `STATE_PATH` (log iteracji).
2. W odpowiedzi użytkownikowi podaj zwięźle:
   - “Cel iteracji: …” (1 zdanie),
   - “Kryterium gotowe: …” (1 zdanie).
3. Poprawiaj tylko to, co wynika z celu iteracji + Rejestru wymagań; nie “uciekaj” w poboczne zmiany.
4. Jeśli po poprawce trzeba ponownie sprawdzić wynik, wywołaj `<skills_root>/_shared/scripts/targeted-check-decision.mjs` z `--target-origin feedback`; gdy helper zwróci `RUN_TARGETED_TEST`, wolno powtórzyć wyłącznie pojedynczy plik testowy albo 1–3 wskazane metody. Ponowne uruchamianie lintów w ramach `$code-implement` jest zabronione.
5. Jeśli nie zgadzasz się z feedbackiem: nie “upieraj się” — zweryfikuj w kodzie/komendą i dopiero wtedy argumentuj wynikiem.
6. Na koniec iteracji zaktualizuj statusy R# + Dowody, dopisz wpis do Dziennika odczytów (jeśli coś czytałeś/uruchamiałeś) oraz wpis do Dziennika iteracji używając odpowiednich skryptów.
7. Szybka checklista zamknięcia iteracji:
   - zaktualizowane statusy R# + Dowody,
   - uzupełnione Dotknięte obszary,
   - wpis w Dzienniku odczytów (jeśli dotyczy),
   - wpis w Dzienniku iteracji.
8. Jeśli z jakiegokolwiek powodu Rejestr wymagań nie został zaktualizowany w tej iteracji, musisz to jawnie zaznaczyć w odpowiedzi.

### 6) Końcowa weryfikacja (lekka)
1. Ustal, czy w ogóle jest co weryfikować:
   - jeśli brak zmian w repo: zakończ “Brak zmian”.
2. Po pojedynczym kroku implementacji stosuj weryfikację przyrostową:
   - sprawdzaj ostatni przyrost, nie cały narosły dirty diff,
   - zawężaj punktowe checki do plików, funkcji, sekcji matrixa albo błędu zmienionych w ostatnim kroku,
   - nie rozszerzaj automatycznie zakresu na całe rozwiązanie tylko dlatego, że repo ma wiele niecommitowanych zmian.
3. Jeśli zmiany obejmują którekolwiek z typów:
   - PHP (`.php`), Twig (`.twig`), JS/TS (`.js/.jsx/.ts/.tsx`), CSS/SCSS (`.css/.scss`), YAML (`.yml/.yaml`), tłumaczenia (`translations/**` lub `src/*/UI/Translation/**`)
   to wykonaj `$review-quick`.
4. Jeśli trzeba wykonać test/lint, najpierw uruchom `node <skills_root>/_shared/scripts/targeted-check-decision.mjs` z jawnymi danymi o źródle celu, zakresie i dostępnej komendzie matrixa. Zastosuj wynik bez reinterpretacji:
   - `RUN_TARGETED_TEST`: uruchom bezpośrednio test wskazany przez kryterium akceptacji albo feedback, ograniczony do jednego pliku lub 1–3 metod; entrypoint (`codecept`, `phpunit`, `yarn` itp.) zawsze wyznacz przez `resolve_tool_cmd`,
   - `RUN_MATRIX_CHECK`: uruchom punktową komendę 1:1 z matrixa, bezpośrednio powiązaną z ostatnim przyrostem,
   - `REVIEW_ONLY`: zakończ na `$review-quick` i zaraportuj `verification_gap`, nie blocker,
   - `ENV_BLOCKER`: użyj STOP_CODE dopiero po rzeczywistej próbie wykonania dozwolonej komendy i potwierdzonym błędzie środowiska.
   Ograniczenia:
   - bezpośredni wyjątek dotyczy testów, nie lintów,
   - nie uruchamiaj pełnego `$qa-run` ani jako kroku końcowego, ani jako fallbacku,
   - nie zastępuj punktowego checka szerszym runem "na wszelki wypadek",
   - pełny suite w matrixie nie jest punktowym fallbackiem i wymaga jawnego workflow użytkownika.
5. Po poprawce konkretnego błędu:
   - wolno powtórzyć test tylko przy decyzji `RUN_TARGETED_TEST`,
   - nie wolno ponownie uruchamiać lintów w ramach `$code-implement`.
6. Pełne `$qa-run` uruchamiaj tylko wtedy, gdy użytkownik wyraźnie i jednoznacznie o to poprosi.
7. Jeśli użytkownik nie zażądał pełnego QA, finalne sprawdzenie kończy się na `review-quick` i punktowym checku albo na samym `review-quick`, jeśli checku punktowego nie ma.
8. Jeśli Rejestr wymagań lub Dziennik odczytów nie odzwierciedlają aktualnych zmian, uzupełnij je przed zakończeniem.

Opcjonalnie (zalecane): do szybkiej klasyfikacji zmian użyj
`node <skill_dir>/scripts/change-inspect.mjs`.

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
- Ryzyka/Błędy: co wymaga uwagi (jeśli dotyczy).
- Testy: sugerowane scenariusze lub testy do dodania (jeśli dotyczy).
- Blokery: jeśli wystąpiły, podaj `STOP_CODE` + przyczynę.
- Następny krok: czy robimy `$git-commit`, czy jeszcze poprawki.

## Zakres automatycznych poprawek
- Dozwolone:
  - zmiany wynikające bezpośrednio z R#,
  - minimalne techniczne poprawki konieczne do domknięcia kryterium.
- Niedozwolone bez zgody użytkownika:
  - nowe zależności,
  - migracje danych/schematu,
  - zmiany security/permissions,
  - szerokie refaktory poza celem iteracji.

## Warunek zakończenia skilla
- Skill kończy się wyłącznie, gdy:
  - wszystkie R# są `DONE`, albo
  - istnieją `BLOCKED` z kodami `STOP_CODES` i jasnym uzasadnieniem.
- Odpowiedź finalna musi zawierać:
  - status każdego R# (skrót),
  - dowody dla `DONE`,
  - listę blockerów (jeśli są),
  - informację czy wykonano `$review-quick`, punktowy test/lint i/lub `$qa-run`.

## Przypadki brzegowe
- Jeśli użytkownik prosi “zakomituj” → użyj `$git-commit`, nie `$code-implement`.
- Jeśli zmiany są tylko w docs/skillach → pomiń `$review-quick`, punktowy test/lint i `$qa-run`, chyba że użytkownik prosi inaczej.
- Jeśli użytkownik wyraźnie każe wyczyścić stan: uruchom `<skill_dir>/scripts/state-clear.mjs` i zakończ bez dalszych zmian.
