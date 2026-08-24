---
name: gh-issue-start
description: >-
  Start pracy nad issue: branch z domyślnej gałęzi repo, status In progress,
  assignee.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/scripts/env-load.sh
  - _shared/scripts/issue-branch.mjs
  - _shared/scripts/slugify-title.mjs
---

# $gh-issue-start

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Zautomatyzować start pracy nad issue: ustalenie numeru issue, utworzenie/checkout brancha z domyślnej gałęzi repo (lub z `--base`), ustawienie statusu w Projects v2 na **In progress** oraz przypisanie aktualnego użytkownika.

## Kroki
1. Sprawdź autoryzację i scope:
   - `gh auth status`
   - Jeśli używasz `GH_TOKEN`: upewnij się, że token ma scope `project` i `read:org` (Projects v2 w org); `gh auth refresh` nie zadziała przy ustawionym `GH_TOKEN`.
   - Jeśli nie używasz `GH_TOKEN` i brakuje `project` lub `read:org`: `gh auth refresh -h github.com -s project,read:org`
2. Uruchom skrypt startowy (automatyzuje wykrycie issue, tworzenie/checkout brancha oraz przypisanie aktualnego użytkownika do issue):
   - `<skill_dir>/scripts/start.mjs`
   - Opcje:
     - `--issue-number <NUMER>`
     - `--title "<Tytuł>"` (używane, gdy trzeba utworzyć nowe issue)
     - `--desc "<Opis>"` (krótki opis do utworzenia issue i nazwy brancha)
     - `--dirty-strategy <stash|commit-wip|move-to-new-branch|other>` (opcjonalnie; pomija interaktywny wybór)
     - `--dirty-instruction "<tekst>"` (wymagane dla `other` bez TTY)
     - `--base <remote/branch|branch>` (opcjonalnie; domyślnie domyślna gałąź repo)
   - Nazwa brancha jest wyprowadzana przez wspólny helper `node <skills_root>/_shared/scripts/issue-branch.mjs` i ma postać `issue/<ID>-<slug>`.
    - Skrypt zawsze wykonuje `git fetch` dla base ref przed utworzeniem lub checkoutem brancha, aby porównanie odbywało się ze świeżą bazą.
    - Skrypt zawsze tworzy lub checkoutuje branch dla wskazanego issue (jeśli branch nie istnieje, zostanie utworzony).
     - Po checkoutcie istniejącego brancha helper porównuje `ahead/behind` względem base ref: branch wyłącznie za bazą jest aktualizowany przez `git merge --ff-only <base>`, a branch rozjechany w obu kierunkach zatrzymuje procedurę.
    - Każdy checkout i ewentualna synchronizacja są sprawdzane przez helper `<skill_dir>/scripts/branch-preparation.mjs`; sukces jest raportowany dopiero po potwierdzeniu aktywnego i zgodnego brancha.
    - Przed checkoutem skrypt sprawdza `git status --porcelain=v1 -uall`. Przy dirty tree, w terminalu interaktywnym pokazuje wybór strzałkami: `stash`, `commit-wip`, `move-to-new-branch` albo `other`.
    - `stash` zachowuje zmiany w stashu i tworzy czysty branch z bazy; `commit-wip` tworzy jawnie wybrany commit WIP na bieżącym branchu; `move-to-new-branch` aplikuje zmiany na nowym branchu; `other` przekazuje instrukcję agentowi.
    - Bez TTY i bez `--dirty-strategy` skrypt kończy się błędem zamiast podejmować decyzję za użytkownika. Skrypt nie wykonuje automatycznie stashowania ani commita.
3. Po powodzeniu skryptu uruchom **osobno** `$gh-issue-status-set`, aby ustawić status **In progress**:
   - Preferuj przekazanie numeru issue:
     - jeśli użyto `--issue-number`, przekaż ten numer,
     - w przeciwnym razie użyj numeru z outputu skryptu (`Issue #<ID> ready on branch ...`).
   - Jeśli nie da się jednoznacznie ustalić numeru issue, pozwól `$gh-issue-status-set` użyć własnych heurystyk i ewentualnie dopytać.
   - Jeśli ustawienie statusu się nie powiedzie: nie ukrywaj błędu, zwróć użytkownikowi jawny komunikat (status nieustawiony + przyczyna), ale pozostaw informację, że branch/issue start zostały wykonane.

4. Dopiero po sukcesie skryptu startowego **i** `$gh-issue-status-set` można
   przejść do kolejnego workflow, w tym `$task-plan`. Błąd dowolnego wcześniejszego
   kroku kończy start dla bieżącego uruchomienia: raportuj kod, miejsce i przyczynę
   oraz nie uruchamiaj task-plan na podstawie częściowego sukcesu.

   Przy standalone starcie, po obu sukcesach, pokaż dokładnie jedno pytanie:

   ```text
   Czy utworzyć plan wykonawczy?
   - Utwórz plan wykonawczy
   - Nie teraz
   ```

   `Utwórz plan wykonawczy` jest jedyną zgodą na uruchomienie `$task-plan` i
   przekazuje wyłącznie `owner`, `repo`, `issue_number`, `branch` oraz `base`.
   `Nie teraz` kończy bieżący workflow bez planu i bez ponownego pytania.

### Granica z `$task-plan`

- `start.mjs` ustala stabilną tożsamość issue (`owner`, `repo`, `issue_number`,
  `branch`, `base`) oraz przygotowuje branch; nie pobiera body ani komentarzy.
- Eksportowane `runIssueStart()` zwraca te pola także w sukcesie strukturalnym;
  tekstowy komunikat CLI pozostaje kompatybilny.
- Po przejściu obu bramek sukcesu `$task-plan` pobiera materiał źródłowy
  samodzielnie, korzystając ze swojego adaptera GitHub i istniejącego `gh`.
- Niepowodzenie startu albo ustawienia statusu jest jawnie raportowane i blokuje
  dalszy workflow. Nie wolno uruchamiać task-plan ani tworzyć planu z niepełnych
  danych.
- `start.mjs` pozostaje adapterem stabilnej tożsamości i brancha: nie pyta
  użytkownika, nie pobiera body ani komentarzy i nie uruchamia `$task-plan`.

### Następne działanie po sukcesie

Sukces `$gh-issue-start` nie oznacza automatycznego uruchomienia `$task-plan`.
Agent rozróżnia intencję rozpoczęcia pracy od intencji rozpoczęcia pracy **i**
przygotowania planu:

- jeśli pierwotne polecenie jednoznacznie obejmuje przygotowanie planu (np.
  „rozpocznij issue 123 i przygotuj plan realizacji”), po sukcesie `start.mjs`
  oraz `$gh-issue-status-set` uruchom `$task-plan`;
- jeśli użytkownik poprosił tylko o start issue, nie uruchamiaj `$task-plan`
  bez pytania. Po sukcesie statusu pokaż pytanie `Czy utworzyć plan
  wykonawczy?` z opcjami `Utwórz plan wykonawczy` i `Nie teraz`;
- sam tytuł lub opis issue nie jest wystarczającym dowodem intencji planowania.

W przypadku automatycznego przejścia przekaż do `$task-plan` stabilną tożsamość
z wyniku startu: `owner`, `repo`, `issue_number`, `branch` i `base`. Nie przenoś
do `start.mjs` pobierania body ani komentarzy issue.

## Źródła parametrów
- `--issue-number`: gdy użytkownik poda **numer** issue wprost (np. „start issue 46”, „zaczynamy pracę nad 46”).
- `--desc`: krótki opis zadania podany przez użytkownika (np. „rozpocznij zadanie: dodać skille start/finish”).
- `--title`: tytuł issue wyprowadzony z opisu użytkownika, gdy chcesz utworzyć issue i nie ma istniejącego ID. Preferuj `--desc`; `--title` jest fallbackiem, jeśli użytkownik podał tylko tytuł bez opisu.
- Priorytet: `--issue-number` > `--desc`/`--title`.

## Heurystyka ustalania issue (w skrypcie)
1. Jeśli podano `--issue-number`, używamy go bez dalszych heurystyk.
2. Jeśli podano `--desc` lub `--title`, wyszukujemy po tytule (słowa kluczowe z opisu/tytułu).
3. Szukamy wyłącznie w otwartych issue.
4. Jeśli issue nie istnieje: tworzy je (tytuł z `--title` lub `--desc`).
5. Nie używamy numerów issue z commitów ani ID z nazwy brancha.

## Gdy brakuje danych
Jeśli nie da się ustalić numeru issue ani tytułu/opisu do utworzenia nowego issue, **zatrzymaj się i dopytaj użytkownika**, opisując czego brakuje (np. „nie mam numeru issue ani opisu/tytułu do utworzenia nowego”).

Jeśli użytkownik podał `--issue-number`, a issue nie istnieje lub jest zamknięte, **nie twórz nowego** — poproś o poprawny numer.

## Branch naming
- Schemat: `issue/<ID>-<slug>`.
- Slug: lowercase, transliteracja znaków diakrytycznych, spacje → myślniki,
  usunięcie znaków niebezpiecznych; implementację współdzieli
  `_shared/scripts/slugify-title.mjs`.
- Źródłem prawdy dla generowania nazwy brancha jest `node <skills_root>/_shared/scripts/issue-branch.mjs`.

## Kody wyjścia skryptu
- `10` brak tytułu do utworzenia issue → dopytaj użytkownika o tytuł i uruchom ponownie z `--title`.
- `11` nie udało się utworzyć issue → sprawdź komunikat i spróbuj ponownie po korekcie danych.
- `13` issue o podanym numerze nie istnieje lub jest zamknięte → poinformuj użytkownika i poproś o poprawny `--issue-number` (sprawdź, czy issue nie zostało zamknięte).
- `21` wiele pasujących issue → poproś użytkownika o numer i uruchom ponownie z `--issue-number`.
- `12` brak base ref (`origin/<default>` albo wartość z `--base`) → sprawdź zdalne branche lub wskaż poprawne `--base`.
- `17` branch ma rozbieżną historię względem base (`ahead > 0` i `behind > 0`) → zatrzymaj się i uzgodnij rebase albo merge.
- Inne błędy → odczytaj komunikat skryptu i popraw dane wejściowe.

## Dodatkowe kody wyjścia dirty tree
- `14` dirty tree bez jawnej strategii albo brak instrukcji dla `other` → wybierz strategię interaktywnie lub podaj parametr.
- `15` nieudany checkout, stash, commit WIP albo brak potwierdzenia aktywnego brancha → skrypt raportuje komendę i błąd.
- `16` wybrano `other` → agent otrzymuje instrukcję użytkownika bez automatycznej operacji.

## Format odpowiedzi
- Wynik: issue + branch utworzone/przełączone, status ustawiony.
- Następny krok: po obu sukcesach pokaż `Czy utworzyć plan wykonawczy?` z
  opcjami `Utwórz plan wykonawczy` i `Nie teraz`; tylko pierwsza uruchamia
  `$task-plan`, a druga kończy workflow bez planu.
- Uwagi: brakujące dane, konflikty oraz ewentualny błąd ustawienia statusu (jeśli dotyczy).

## Przykłady wejścia
- "$gh-issue-start"
- "start issue 46"
- "rozpocznij zadanie"
- "zaczynamy pracę nad 46"
- "startujemy z zadaniem numer 46"
- "start: krótkim opisem zadania"
- "uruchom gh-issue-start z tytułem"

## Przykłady wyjścia
- ```text
  Wynik: issue #46 aktywowane, branch issue/46-skill-start utworzony i checkout.
  Uwagi: brak.
  ```
