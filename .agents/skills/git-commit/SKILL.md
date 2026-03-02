---
name: git-commit
description: >-
  Pełna procedura testów, walidacji, workloga i commita. Intencje: zrób commit,
  przygotuj commit, pełna procedura QA+worklog+commit. Użyj przy $git-commit.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
---

# $git-commit

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Celem jest przeprowadzenie kompletnej procedury QA, worklogu i commita zgodnie z lokalnymi zasadami. Chodzi o to, by commit był spójny z dokumentacją, procedurami i stanem repozytorium.

## Mapa ścieżek dokumentacji (AGENTS-first)
1. Zawsze zaczynaj od `AGENTS.md`.
2. Odczytaj mapę ścieżek dokumentacji `docs_map`.
3. Wszystkie ścieżki z mapy traktuj jako repo-relative.
4. Nie zgaduj ścieżek po nazwie pliku.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `WORKLOG_DIR`: katalog z plikami worklogu per e-mail.
- Opcjonalne:
  - `HANDOFF_DOC`: plik handoffu (lokalny, niecommitowany).

## Kroki
1. Upewnij się, że użytkownik wyraźnie wydał polecenie `$git-commit`. Jeśli nie — przerwij (bez `git add`/`git commit`).
2. Wykonaj snapshot bazowy (punkt odniesienia do kroku akceptacji), zanim zaczniesz wprowadzać poprawki w repo:
   - Utwórz katalog snapshotu unikalny dla tego uruchomienia (np. `/tmp/agent-git-commit-snapshot-<timestamp>-<ulid>/`) i zapamiętaj jego ścieżkę.
   - Preferowana ścieżka deterministyczna: uruchom `./scripts/snapshot-create.sh` i zapamiętaj ścieżkę z stdout.
   - Zasada: nie polegaj na „pamięci” ścieżki snapshotu:
     - `snapshot-create.sh` zapisuje pointer do snapshotu w `/tmp/agent-git-commit-snapshot-pointer.txt`,
     - kolejne kroki używają wariantu `--current`, aby nie przenosić `snapshot_dir` ręcznie (odporne na wznowienia sesji).
   - Zapisz do snapshotu:
     - `git status -sb`
     - hash bazowy `HEAD` (np. z `git rev-parse HEAD`) jako punkt odniesienia dla plików, które w momencie snapshotu są czyste
     - listę plików zmienionych (`git diff --name-only`)
     - listę plików nieśledzonych (`git ls-files --others --exclude-standard`)
   - Skopiuj do katalogu snapshotu bieżące wersje plików, które w momencie snapshotu są zmienione lub nieśledzone (z zachowaniem ścieżek).
   - Snapshot służy wyłącznie do raportowania zmian “delta od snapshotu” w kroku akceptacji — nie trafia do commita.
3. Przeczytaj aktualne:
   - `../_shared/references/runtime-collaboration-guidelines.md`
   - `../_shared/references/runtime-quality-procedures.md`
   - `../_shared/references/php-symfony-postgres-standards.md`
   - jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1` w `.env` / `.env.local`: `../_shared/references/cqrs-monolith-standard-overrides.md`
   oraz:
   - sprawdź `git status -sb`
   - sprawdź `git config user.email` (wymagane do `$worklog-add`); jeśli brak — przerwij
   - odczytaj `docs_map` i klucz `WORKLOG_DIR`; jeśli mapy lub klucza brakuje — przerwij i dopytaj użytkownika
   - odczytaj `HANDOFF_DOC`, jeśli klucz jest zdefiniowany
4. Autonomiczne poprawki przygotowawcze (pre-QA) — dozwolone, ale w ograniczonym zakresie celu:
   - Cel: wykonać minimalne, sensowne poprawki, które są konieczne lub bardzo prawdopodobne do przejścia QA/lintów i utrzymania spójności kodu, bez wprowadzania nowej funkcjonalności.
   - Dozwolone: poprawki wynikające z zasad projektu lub spodziewanych błędów QA (typy/importy/formatowanie, refaktory redukujące complexity, porządki w configach narzędzi, adaptacja stubów testowych do zmian kontraktów).
   - Niedozwolone: nowe funkcjonalności i zmiany domenowe, migracje/zmiany schematu, zmiany bezpieczeństwa/autoryzacji zmieniające zachowanie w sposób nieoczywisty, dodawanie nowych zależności lub zmiany `composer.json`/`package.json` bez wyraźnego polecenia użytkownika.
   - Dopuszczalne wyjątki: zmiany w lockfile (`composer.lock`, `yarn.lock`) wynikające z uruchomionych narzędzi QA są akceptowalne, ale muszą zostać pokazane jako “delta od snapshotu” w kroku akceptacji.
   - Zasada “ostatniego słowa użytkownika”: wszystkie zmiany z tego kroku muszą trafić do raportu w kroku akceptacji jako „delta od snapshotu” (krok 2).
5. Wykonaj skill `$qa-run`. Po ukończeniu skilla, jeżeli w trakcie jego wykonania dokonywałeś poprawek, wróć do kroku 3 i kontynuuj od tego punktu włącznie.
   - Zasada: nie uruchamiaj „na boku” pojedynczych lintów/testów poza `$qa-run` tylko po to, aby „coś się uruchomiło”.
   - Jeśli `$qa-run` zdecyduje, że nie ma relewantnych zmian (wszystkie kategorie pominięte), to jest poprawny wynik — przejdź dalej w procedurze.
6. Wykonaj skill `$review-quick`. Jeśli coś poprawiasz, wróć do kroku 3 i kontynuuj od tego punktu włącznie.
7. Wykonaj skill `$docs-sync`.
8. Wykonaj skill `$skills-index-refresh`.
9. Krok akceptacji: jeśli od momentu snapshotu (krok 2) zaszły jakiekolwiek zmiany w repo, zaraportuj je do akceptacji (wyłącznie „delta od snapshotu”, niepełna lista wszystkich zmian w repo):
   - Preferowane obliczenie delty: `./scripts/snapshot-delta-list.sh --current` (generuje `delta-all.txt` i zwraca kod 0 gdy pusta, 1 gdy niepusta).
   - Jeśli “delta od snapshotu” jest pusta: napisz wprost “Brak zmian delta od snapshotu (krok 2)” i przejdź do kroku 10.
   - Jeśli “delta od snapshotu” nie jest pusta:
     - wypisz listę plików, których treść zmieniła się względem snapshotu (oraz pliki dodane/usunięte od snapshotu),
     - dla każdego pliku: “Co”, “Dlaczego” i (jeśli zmiany nie są rozległe) pokaż konkretny diff “snapshot → teraz”.
       - Preferowane pokazywanie diffów: `./scripts/snapshot-delta-show.sh --current <path>` (lub `--all`).
     - baseline diffu:
       - jeśli plik istniał i był zmieniony/nieśledzony w momencie snapshotu: porównaj z kopią w katalogu snapshotu,
       - jeśli plik był czysty w momencie snapshotu: porównaj z wersją z `HEAD` (hash zapisany w snapshotie).
     - dla plików binarnych lub nieczytelnych diffem (np. `.gz`) pokaż metadane: rozmiar i hash (bez próby prezentowania pełnego diffu).
     - STOP: kontynuuj dopiero po zatwierdzeniu przez użytkownika; w razie poprawek wróć do kroku 3.
10. Wykonaj skill `$worklog-add` i przeczytaj zaktualizowany plik worklogu `<WORKLOG_DIR>/<email>.md` (gdzie `WORKLOG_DIR` pochodzi z `docs_map`, plik wyznaczony przez `git config user.email`).
11. `git add .` (wszystkie pliki, w tym nowe/nieśledzone oraz zmiany z fixerów).
12. Sprawdź staging (`git diff --cached --name-only`) i upewnij się, że nie ma plików śmieciowych/tymczasowych (np. `.env.local`, logi, cache); jeśli są — usuń je ze stagingu i wróć do kroku 3.
    - Preferowana sanity-check: `./scripts/staging-sanity.sh` (exit 0 = OK; exit 1 = wykryto podejrzane pliki).
13. `git commit` w formacie Conventional Commits po polsku, bez kropki; treść commita **musi pochodzić z właśnie utworzonego/uzupełnionego wpisu workloga** (krok 10).

    Zasada: nie wymyślaj tytułu commita “od zera” i nie tłumacz go — bierzesz go z workloga, aby uniknąć błędów językowych i rozjazdów.

    Jak zbudować commit message:
    - Ustal plik workloga na podstawie `git config user.email` i klucza `WORKLOG_DIR` z `docs_map`: `<WORKLOG_DIR>/<email>.md`.
    - Znajdź bieżący wpis (ten, który `$worklog-add` właśnie utworzył/uzupełnił): pierwsza linia nagłówka w formacie `### [YYYY-MM-DD] Krótki tytuł [ULID]` liczona od góry pliku.
    - Z nagłówka wyciągnij:
      - `Krótki tytuł` (bez daty i bez `[ULID]`) → to jest **subject** commita,
      - `[ULID]` → musi być identyczny w worklogu i commicie.
    - Subject commita ma postać: `<type>: <Krótki tytuł> [ULID]`
      - `<type>` dobierz zgodnie z Conventional Commits (`feat`, `fix`, `chore`, `refactor`, `docs`, …).
      - Nie dodawaj daty do subjectu (data jest tylko w worklogu).
    - Body commita ma być 1:1 z listą punktów spod nagłówka workloga (bez zmiany znaczenia; zachowaj kolejność i treść).
    - Zapisz commit message do pliku `${CACHE_PATH:-var/agent/cache}/git-commit/commit-message-<ULID>.txt` (utwórz katalog, jeśli nie istnieje) i użyj `git commit -F <plik>`, aby uniknąć ucięcia/escaping w powłoce.
14. Potwierdź czystość `git status`, sprawdź poprawność commit message/body.
15. Jeśli zdefiniowano klucz `HANDOFF_DOC`: usuń plik handoffu wskazany przez ten klucz (jeżeli istnieje). Plik jest lokalny i nie powinien trafiać do commita.
16. Usuń katalog snapshotu z kroku 2 (sprzątanie obowiązkowe; snapshot jest tymczasowy i nie powinien zostawać po procedurze).
    - Preferowane sprzątanie bezpieczne: `./scripts/snapshot-clean.sh --current` (usuwa też `/tmp/agent-git-commit-snapshot-pointer.txt`).
17. Po udanym commicie uruchom `$agent-cache-clear` (czyszczenie `CACHE_PATH`, domyślnie `var/agent/cache/`).
18. Po wykonaniu procedury nie uruchamiaj jej ponownie ani `git commit` bez wyraźnego polecenia `$git-commit`.

## Zakres
- W zakresie: pełna procedura QA, worklog i commit dla bieżących zmian.
- Poza zakresem: nowe, nieuzgodnione zmiany funkcjonalne.

## Format odpowiedzi
- Wynik: czy procedura zakończona, czy wstrzymana.
- Użyte klucze dokumentacji:
  - `WORKLOG_DIR=<resolved-path>`
  - `HANDOFF_DOC=<resolved-path>` (jeśli klucz był zdefiniowany)
- Uwagi: jeśli wstrzymana, podaj powód i krok powrotu.

## Format akceptacji zmian (krok 9)
Cel: użytkownik ma zobaczyć i zaakceptować wyłącznie zmiany powstałe „delta od snapshotu” (krok 2), niepełną listę plików, które finalnie trafią do commita.

Podsumowanie zmian do akceptacji (delta od snapshotu):
- `ścieżka/pliku.ext` — Co: krótki opis zmiany. Dlaczego: krótki powód.
  - Zmiana (snapshot → teraz): pokaż diff, jeśli nie jest rozległy.
- `ścieżka/innego.ext` — Co: … Dlaczego: …
  - Zmiana (snapshot → teraz): …

Reguły pokazywania diffów:
- Lista plików w delcie jest zawsze kompletna.
- Jeśli diff jest niewielki, pokaż go w całości.
- Jeśli diff jest bardzo duży (np. lockfile), pokaż skrót + kluczowe fragmenty; pełny diff pokaż na żądanie.
- Jeśli plik jest binarny lub nieczytelny diffem, pokaż metadane (rozmiar/hash) zamiast diffu.
- Jeśli potrzebujesz zachować snapshot do debugowania, skopiuj go w inne miejsce przed krokiem 16 (sprzątanie snapshotu jest obowiązkowe).

Pytanie: Akceptujesz te zmiany? Jeśli tak, kontynuuję kolejne kroki. Jeśli nie, napisz poprawki.

## Warunki przerwania
- Brak wyraźnego polecenia `$git-commit`.
- Brak akceptacji zmian w kroku 9 — wstrzymaj procedurę przed `$worklog-add` i `git commit`.
- Błędy w lintach lub testach — napraw i wróć do kroku 3.

## Przykłady wejścia
- "$git-commit"
- "commit"
- "zrób commit"
- "skomituj mi te zmiany"
- "zakomituj to"

## Przykłady wyjścia
- ```text
  Wynik: Procedura zakończona.
  Uwagi: commit utworzony z ULID z `<WORKLOG_DIR>/<email>.md`, `git status` czysty.
  ```
- ```text
  Wynik: Procedura wstrzymana.
  Uwagi: błąd `<CONSOLE_CMD> app:deptrac-config:generate` (np. brak połączenia z DB), wróć do kroku 5 po usunięciu blokady.
  ```
- ```text
  Wynik: Procedura wstrzymana.
  Uwagi: `<COMPOSER_CMD> lint:phpstan:fresh` zakończył się błędem, popraw i wróć do kroku 3.
  ```

## Efekt
Commit został utworzony poprawnie z ULID z worklogu, a repo jest w czystym stanie.

## Przypadki brzegowe
- Brak wyraźnego polecenia użytkownika.
- Brak mapy `docs_map` w `AGENTS.md` lub brak klucza `WORKLOG_DIR` — przerwij i dopytaj użytkownika.
