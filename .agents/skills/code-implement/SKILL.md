---
name: code-implement
description: "Orkiestrator implementacji zmian w kodzie: intake prompta, dopytania/stop-conditions, doczytanie kontekstu repo, zasady kodowania, lekkie checki na końcu (`$review-quick` + opcjonalnie `$qa-run`), oraz standard raportowania. Użyj, gdy użytkownik zleca dodanie funkcjonalności, naprawę błędu lub refaktor."
---

# $code-implement

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Poprowadzić implementację zmian w kodzie end-to-end w sposób powtarzalny i bezpieczny:
- doprecyzować zlecenie (pytania, kryteria akceptacji),
- doczytać właściwy kontekst z repo (tylko to, co potrzebne),
- wdrożyć zmianę zgodnie z zasadami projektu,
- wykonać lekką weryfikację na końcu (`$review-quick`, a `$qa-run` tylko gdy zmiana jest rozległa),
- zaraportować wynik w stałym formacie.

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
- zasady współpracy/runtime: `../_shared/references/runtime-collaboration-guidelines.md`
- checklisty jakości: `../_shared/references/runtime-quality-procedures.md`
- baseline techniczny stacka: `../_shared/references/php-symfony-postgres-standards.md`
- override architektoniczny (warunkowy): `../_shared/references/cqrs-monolith-standard-overrides.md` — tylko gdy `CQRS_MONOLITH_STANDARD_OVERRIDES=1` w `.env` / `.env.local`
- kontekst repo: `$context-refresh` (`../context-refresh/SKILL.md`)
- szybkie review: `$review-quick` (`../review-quick/SKILL.md`)
- pełne QA: `$qa-run` (`../qa-run/SKILL.md`)
- commit: wyłącznie `$git-commit` (`../git-commit/SKILL.md`)

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
  - wartość z `.env` / `.env.local`,
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
- **Dziennik odczytów**: dopisuj wyłącznie przez `./scripts/state-readlog.sh "<msg>"`.
  - Przykład: `- [2026-01-16T21:20:00+01:00] rg "EntityConnection" -n src; git diff --stat`
- **Dziennik iteracji**: dopisuj wyłącznie przez `./scripts/state-log.sh "<msg>"`.
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
     
     → uruchom `./scripts/state-clear.sh`,
  2) użytkownik jednoznacznie anuluje zadanie i chce wycofać zmiany:
     - przykładowe jednoznaczne polecenia:
       - “anuluj zadanie i wycofaj zmiany”
       - “odwróć zmiany z tego zadania i wyczyść stan code-implement”
     - najpierw dopytaj, czy chodzi o wycofanie **wszystkich** niecommitowanych zmian w repo, czy tylko zmian z tego zadania,
     - wycofaj zmiany **wyłącznie** na wyraźne polecenie użytkownika (zgodnie z `../_shared/references/runtime-collaboration-guidelines.md`),
     - dopiero po wycofaniu zmian uruchom `./scripts/state-clear.sh`.

Jeśli nie masz pewności, czy użytkownik chce czyszczenia stanu: dopytaj wprost “Czy mam wyczyścić stan code-implement?” i nie uruchamiaj `state-clear.sh` bez potwierdzenia.

### “Krytyczny plik”
Traktuj plik jako **krytyczny**, jeśli spełnia dowolny warunek:
1. Wpływa na globalne zachowanie aplikacji albo pipeline (config/tooling/CI), np.:
   - `composer.json`, `composer.lock`, `package.json`, `yarn.lock`
   - `config/**`, `.github/**`, `.docker/**`, `Makefile`
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

Jeśli plik jest już zmieniony w repo (tracked/untracked) i masz go edytować:
- przed edycją **obowiązkowo** przeczytaj diff i bieżącą treść (zakaz edycji “w ciemno”),
- staraj się robić minimalne patche, żeby nie nadpisać ręcznych zmian użytkownika.

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

### “Rozległa zmiana”
Traktuj zmianę jako rozległą, jeśli:
- liczba plików zmienionych + untracked jest duża (domyślnie: `>= 15`), lub
- użytkownik wprost mówi, że to duża zmiana, lub
- po implementacji widać, że zakres “uciekł” poza pierwotne założenia.

## Kroki

### 0) Inicjalizacja stanu zadania (obowiązkowo)
1. Jeśli `STATE_PATH` nie istnieje: utwórz go z sekcją “Aktywne zadanie”.
2. Zapisz w nim:
   - krótkie streszczenie celu użytkownika,
   - wstępny Rejestr wymagań (R1..Rn),
   - założenia (jeśli są),
   - “ryzykowne obszary” (jeśli dotyczy: security/migracje/zależności).
 
Opcjonalnie (zalecane): do stworzenia szablonu użyj
`./scripts/state-init.sh`.

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
1. Uruchom `$context-refresh` w trybie **Quick**, jeśli:
   - to początek pracy w tej sesji, lub
   - zadanie dotyka obszaru, którego nie masz “w głowie”.
2. Ustal obszar zmian:
   - znajdź docelowe moduły/pliki (np. przez `rg` po symbolach),
   - doczytaj README dokumentacji dla dotkniętych modułów (zgodnie z `docs_map` z `AGENTS.md`).
   - jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1`: doczytaj `../_shared/references/cqrs-monolith-standard-overrides.md` przed decyzjami architektonicznymi (warstwy/CQRS/Doctrine/FCF).
3. Zrób preflight entrypointów narzędzi:
   - załaduj `.agents/skills/_shared/scripts/env-load.sh`,
   - ustal komendy narzędziowe dla repo (co najmniej `composer`, `console`, `yarn`, `codecept`) wyłącznie przez `resolve_tool_cmd`,
   - `resolve_tool_cmd` traktuj jako jedyne źródło prawdy; `.env`/`.env.local` są ładowane automatycznie w resolverze,
   - nie mieszaj wielu wariantów entrypointów w ramach jednego zadania.
4. Przed zmianą krytycznego pliku **lub** przed edycją pliku, który jest już zmieniony w repo (tracked/untracked):
   - przeczytaj diff (`git diff -- <plik>`) i aktualną treść (relewantne sekcje),
   - dopiero potem edytuj.
5. Po każdym realnym odczycie lub komendzie kontekstowej (np. `rg`, `sed`, `git diff`) dopisz wpis do Dziennika odczytów przez `./scripts/state-readlog.sh "<msg>"` (możesz grupować kilka odczytów w jeden wpis).
6. Jeśli w trakcie implementacji wychodzi, że trzeba zmodyfikować plik, który nie wynika wprost z zadania:
   - jeśli to **krytyczny plik**: zatrzymaj się i dopytaj użytkownika, czy taki scope jest akceptowalny,
   - jeśli to **nie jest krytyczny plik**: nie “zasypuj pytaniami” — spróbuj znaleźć rozwiązanie w obrębie ustalonego zakresu; jeśli to niemożliwe, wykonaj minimalną zmianę konieczną technicznie i jawnie zaraportuj to w podsumowaniu.

### 3) Plan pracy
1. Jeśli zadanie nie jest trywialne: zaproponuj krótki plan (3–6 kroków) i trzymaj się go.
2. Jeśli w trakcie okaże się, że zakres rośnie: zatrzymaj się, zaktualizuj plan i poproś o potwierdzenie.

### 4) Implementacja (zasady + bramki)
1. Implementuj zgodnie z `../_shared/references/runtime-collaboration-guidelines.md`, baseline `../_shared/references/php-symfony-postgres-standards.md` oraz aktywnym override (jeśli flaga włączona).
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
   - wykonaj `<COMPOSER_CMD> dump-autoload --no-scripts`, gdzie `<COMPOSER_CMD>` pochodzi z preflightu opartego o `resolve_tool_cmd` (zgodnie z `../_shared/references/runtime-quality-procedures.md`).

### 5) Stop-conditions (kiedy przerwać i dopytać)
Wstrzymaj implementację i zadaj pytania, jeśli pojawia się którykolwiek przypadek:
- brakuje danych wejściowych / kryteriów akceptacji, a bez nich łatwo zgadnąć źle,
- zmiana dotyka security/auth/capabilities/permissions i nie jest jasno opisana,
- zmiana wymaga migracji lub zmiany relacji danych,
- trzeba dodać/zmienić zależność (`composer.json`/`package.json`) bez zgody użytkownika,
- problem wygląda na środowiskowy (np. brak DB/containers) i blokuje QA/testy,
- implementacja zaczyna wymagać zmian poza zakresem w **krytycznym pliku** (tj. edycja nie wynika wprost z zadania),
- zakres znacząco przekracza pierwotne założenia.

### 5.1) Dyscyplina iteracji (feedback loop)
Gdy użytkownik zgłasza błąd/uwagę po Twojej implementacji:
1. Zapisz feedback w `STATE_PATH` (log iteracji).
2. W odpowiedzi użytkownikowi podaj zwięźle:
   - “Cel iteracji: …” (1 zdanie),
   - “Kryterium gotowe: …” (1 zdanie).
3. Poprawiaj tylko to, co wynika z celu iteracji + Rejestru wymagań; nie “uciekaj” w poboczne zmiany.
4. Jeśli nie zgadzasz się z feedbackiem: nie “upieraj się” — zweryfikuj w kodzie/komendą i dopiero wtedy argumentuj wynikiem.
5. Na koniec iteracji zaktualizuj statusy R# + Dowody, dopisz wpis do Dziennika odczytów (jeśli coś czytałeś/uruchamiałeś) oraz wpis do Dziennika iteracji używając odpowiednich skryptów.
6. Szybka checklista zamknięcia iteracji:
   - zaktualizowane statusy R# + Dowody,
   - uzupełnione Dotknięte obszary,
   - wpis w Dzienniku odczytów (jeśli dotyczy),
   - wpis w Dzienniku iteracji.
7. Jeśli z jakiegokolwiek powodu Rejestr wymagań nie został zaktualizowany w tej iteracji, musisz to jawnie zaznaczyć w odpowiedzi.

### 6) Końcowa weryfikacja (lekka)
1. Ustal, czy w ogóle jest co weryfikować:
   - jeśli brak zmian w repo: zakończ “Brak zmian”.
2. Jeśli zmiany obejmują którekolwiek z typów:
   - PHP (`.php`), Twig (`.twig`), JS/TS (`.js/.jsx/.ts/.tsx`), CSS/SCSS (`.css/.scss`), YAML (`.yml/.yaml`), tłumaczenia (`translations/**` lub `src/*/UI/Translation/**`)
   to wykonaj `$review-quick`.
3. `$qa-run` uruchom automatycznie **tylko**, gdy zmiana jest rozległa (definicja wyżej).
   - W przeciwnym razie: nie uruchamiaj `$qa-run` na koniec z automatu (i tak będzie wymagane przed commitem przez `$git-commit`).
4. Jeśli Rejestr wymagań lub Dziennik odczytów nie odzwierciedlają aktualnych zmian, uzupełnij je przed zakończeniem.

Opcjonalnie (zalecane): do szybkiej klasyfikacji zmian użyj
`./scripts/change-inspect.sh`.

### 7) Raport końcowy (format)
Zakończ odpowiedź w stałej strukturze:
- Wynik: co zostało zrobione (1–5 punktów).
- Pliki/obszary: gdzie dotknięto (moduły / kluczowe pliki).
- Weryfikacja:
  - `$review-quick` — wykonano / pominięto (dlaczego),
  - `$qa-run` — wykonano / pominięto (dlaczego).
- Ryzyka/Błędy: co wymaga uwagi (jeśli dotyczy).
- Testy: sugerowane scenariusze lub testy do dodania (jeśli dotyczy).
- Następny krok: czy robimy `$git-commit`, czy jeszcze poprawki.

## Przypadki brzegowe
- Jeśli użytkownik prosi “zakomituj” → użyj `$git-commit`, nie `$code-implement`.
- Jeśli zmiany są tylko w docs/skillach → pomiń `$review-quick` i `$qa-run`, chyba że użytkownik prosi inaczej.
- Jeśli użytkownik wyraźnie każe wyczyścić stan: uruchom `./scripts/state-clear.sh` i zakończ bez dalszych zmian.
