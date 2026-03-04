---
name: git-commit
description: >-
  Pełna procedura testów, walidacji, przygotowania commit message i commita.
  Intencje: zrób commit, przygotuj commit, pełna procedura QA+commit-message+commit.
  Użyj przy $git-commit.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
---

# $git-commit

## Reguły rozwiązywania ścieżek
- Ścieżki z prefiksem `./` są repo-relative (`./` = `git rev-parse --show-toplevel`), a nie względem katalogu procesu.
- Ścieżki w `shared_files` są względne względem katalogu z bieżącym `SKILL.md` (np. `_shared/...` oznacza `../_shared/...`).

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Celem jest przeprowadzenie kompletnej procedury QA, przygotowania commit message i commita zgodnie z lokalnymi zasadami. Chodzi o to, by commit był spójny z dokumentacją, procedurami i stanem repozytorium.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `COMMIT_MESSAGE_DIR`: katalog z plikiem `commit-message.txt`.
- Opcjonalne:
  - `HANDOFF_DOC`: plik handoffu (lokalny, niecommitowany).

## Reguła aktywacji
Uruchom ten skill zawsze, gdy użytkownik wyraża intencję wykonania commita
(np. `zrób commit`, `commit`, `skomituj`, `zakomituj`, `przygotuj commit`).
Literalne `$git-commit` jest aliasem, nie jedynym poprawnym triggerem.

## Reguła wygaszania intencji
Po zakończeniu tej procedury intencja wykonywania commita jest uznana za zrealizowaną i wygasa.
Nie wolno zakładać „ciągłej” intencji na kolejne commity.
Każdy następny commit wymaga ponownego spełnienia kryteriów aktywacji z sekcji „Reguła aktywacji”.

## Kroki
1. Upewnij się, że użytkownik wyraził intencję wykonania commita
   (polecenie `$git-commit` lub równoważne polecenie językowe). Jeśli nie — przerwij (bez `git add`/`git commit`).
   - Domyślny zakres commita: jeśli użytkownik nie ograniczył zakresu, commit obejmuje wszystkie zmiany w repo zgodnie z krokiem 11 (`git add .`).
   - Selektywny commit wolno wykonać tylko przy jednoznacznym poleceniu użytkownika (np. „commit tylko te pliki: ...”).
2. Wykonaj snapshot bazowy (punkt odniesienia do kroku akceptacji), zanim zaczniesz wprowadzać poprawki w repo:
   - Utwórz katalog snapshotu unikalny dla tego uruchomienia (np. `/tmp/agent-git-commit-snapshot-<timestamp>-<ulid>/`) i zapamiętaj jego ścieżkę.
   - Preferowana ścieżka deterministyczna: uruchom `scripts/snapshot-create.sh` i zapamiętaj ścieżkę z stdout.
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
   - odczytaj `docs_map` i klucz `COMMIT_MESSAGE_DIR`; jeśli mapy lub klucza brakuje — przerwij i dopytaj użytkownika
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
   - Preferowane obliczenie delty: `scripts/snapshot-delta-list.sh --current` (generuje `delta-all.txt` i zwraca kod 0 gdy pusta, 1 gdy niepusta).
   - Jeśli “delta od snapshotu” jest pusta: napisz wprost “Brak zmian delta od snapshotu (krok 2)” i przejdź do kroku 10.
   - Jeśli “delta od snapshotu” nie jest pusta:
     - wypisz listę plików, których treść zmieniła się względem snapshotu (oraz pliki dodane/usunięte od snapshotu),
     - dla każdego pliku: “Co”, “Dlaczego” i (jeśli zmiany nie są rozległe) pokaż konkretny diff “snapshot → teraz”.
       - Preferowane pokazywanie diffów: `scripts/snapshot-delta-show.sh --current <path>` (lub `--all`).
     - baseline diffu:
       - jeśli plik istniał i był zmieniony/nieśledzony w momencie snapshotu: porównaj z kopią w katalogu snapshotu,
       - jeśli plik był czysty w momencie snapshotu: porównaj z wersją z `HEAD` (hash zapisany w snapshotie).
     - dla plików binarnych lub nieczytelnych diffem (np. `.gz`) pokaż metadane: rozmiar i hash (bez próby prezentowania pełnego diffu).
     - STOP: kontynuuj dopiero po zatwierdzeniu przez użytkownika; w razie poprawek wróć do kroku 3.
10. Wykonaj skill `$commit-message-write` i odczytaj plik `<COMMIT_MESSAGE_DIR>/commit-message.txt` (gdzie `COMMIT_MESSAGE_DIR` pochodzi z `docs_map`).
    - Jeśli plik nie istnieje, nie jest czytelny albo jest pusty: przerwij i wróć do kroku 10.
11. `git add .` (wszystkie pliki, w tym nowe/nieśledzone oraz zmiany z fixerów).
12. Sprawdź staging (`git diff --cached --name-only`) i upewnij się, że nie ma plików śmieciowych/tymczasowych (np. `.env.local`, logi, cache); jeśli są — usuń je ze stagingu i wróć do kroku 3.
    - Preferowana sanity-check: `scripts/staging-sanity.sh` (exit 0 = OK; exit 1 = wykryto podejrzane pliki).
13. Wykonaj `git commit -F <COMMIT_MESSAGE_DIR>/commit-message.txt`.
    - Treść commita ma pochodzić 1:1 z pliku wygenerowanego przez `$commit-message-write` (krok 10), bez dopisywania lub przepisywania przez `$git-commit`.
    - Jeśli odczyt pliku się nie powiedzie: przerwij i wróć do kroku 10.
14. Potwierdź czystość `git status`, sprawdź poprawność commit message/body.
15. Jeśli zdefiniowano klucz `HANDOFF_DOC`: usuń plik handoffu wskazany przez ten klucz (jeżeli istnieje). Plik jest lokalny i nie powinien trafiać do commita.
16. Usuń katalog snapshotu z kroku 2 (sprzątanie obowiązkowe; snapshot jest tymczasowy i nie powinien zostawać po procedurze).
    - Preferowane sprzątanie bezpieczne: `scripts/snapshot-clean.sh --current` (usuwa też `/tmp/agent-git-commit-snapshot-pointer.txt`).
17. Po udanym commicie uruchom `$agent-cache-clear` (czyszczenie `CACHE_PATH`, domyślnie `var/agent/cache/`).
18. Po wykonaniu procedury nie uruchamiaj jej ponownie ani `git commit` bez nowej, wyraźnej intencji commita od użytkownika.

## Zakres
- W zakresie: pełna procedura QA, commit message i commit dla bieżących zmian.
- Poza zakresem: nowe, nieuzgodnione zmiany funkcjonalne.

## Niedozwolone skróty
- Nie zastępuj tego skilla ręcznym flow (`git commit -m`, selektywny commit), jeśli trigger intencji commita został spełniony.
- Obowiązkowo wykonaj krok 10 (`$commit-message-write`) i commit z `-F`.
- Wykonanie commita z całkowitym pominięciem tego skilla jest kategorycznie zabronione.

## Format odpowiedzi
- Wynik: czy procedura zakończona, czy wstrzymana.
- Użyte klucze dokumentacji:
  - `COMMIT_MESSAGE_DIR=<resolved-path>`
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
- Brak intencji wykonania commita (komenda `$git-commit` lub równoważne polecenie językowe).
- Brak akceptacji zmian w kroku 9 — wstrzymaj procedurę przed `$commit-message-write` i `git commit`.
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
  Uwagi: commit utworzony z `<COMMIT_MESSAGE_DIR>/commit-message.txt`, `git status` czysty.
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
Commit został utworzony poprawnie z `<COMMIT_MESSAGE_DIR>/commit-message.txt`, a repo jest w czystym stanie.

## Przypadki brzegowe
- Brak intencji wykonania commita po stronie użytkownika.
- Brak mapy `docs_map` w `AGENTS.md` lub brak klucza `COMMIT_MESSAGE_DIR` — przerwij i dopytaj użytkownika.
