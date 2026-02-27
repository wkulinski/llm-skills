---
name: gh-issue-start
description: "Start pracy nad issue: branch z domyślnej gałęzi repo, status In progress, assignee."
---

# $gh-issue-start

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Zautomatyzować start pracy nad issue: ustalenie numeru issue, utworzenie/checkout brancha z domyślnej gałęzi repo (lub z `--base`), ustawienie statusu w Projects v2 na **In progress** oraz przypisanie aktualnego użytkownika.

## Kroki
1. Sprawdź autoryzację i scope:
   - `gh auth status`
   - Jeśli używasz `GH_TOKEN`: upewnij się, że token ma scope `project` i `read:org` (Projects v2 w org); `gh auth refresh` nie zadziała przy ustawionym `GH_TOKEN`.
   - Jeśli nie używasz `GH_TOKEN` i brakuje `project` lub `read:org`: `gh auth refresh -h github.com -s project,read:org`
2. Uruchom skrypt startowy (automatyzuje wykrycie issue, tworzenie/checkout brancha oraz przypisanie aktualnego użytkownika do issue):
   - `./scripts/start.sh`
   - Opcje:
     - `--issue-number <NUMER>`
     - `--title "<Tytuł>"` (używane, gdy trzeba utworzyć nowe issue)
     - `--desc "<Opis>"` (krótki opis do utworzenia issue i nazwy brancha)
     - `--base <remote/branch|branch>` (opcjonalnie; domyślnie domyślna gałąź repo)
   - Skrypt przed utworzeniem nowego brancha wykonuje `git fetch` dla base ref, aby mieć aktualną bazę.
   - Skrypt zawsze tworzy lub checkoutuje branch dla wskazanego issue (jeśli branch nie istnieje, zostanie utworzony).
3. Po powodzeniu skryptu uruchom **osobno** `$gh-issue-status-set`, aby ustawić status **In progress**:
   - Preferuj przekazanie numeru issue:
     - jeśli użyto `--issue-number`, przekaż ten numer,
     - w przeciwnym razie użyj numeru z outputu skryptu (`Issue #<ID> ready on branch ...`).
   - Jeśli nie da się jednoznacznie ustalić numeru issue, pozwól `$gh-issue-status-set` użyć własnych heurystyk i ewentualnie dopytać.

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
- Slug: lowercase, spacje → myślniki, usuwa znaki spoza ASCII.

## Kody wyjścia skryptu
- `10` brak tytułu do utworzenia issue → dopytaj użytkownika o tytuł i uruchom ponownie z `--title`.
- `11` nie udało się utworzyć issue → sprawdź komunikat i spróbuj ponownie po korekcie danych.
- `13` issue o podanym numerze nie istnieje lub jest zamknięte → poinformuj użytkownika i poproś o poprawny `--issue-number` (sprawdź, czy issue nie zostało zamknięte).
- `21` wiele pasujących issue → poproś użytkownika o numer i uruchom ponownie z `--issue-number`.
- `12` brak base ref (`origin/<default>` albo wartość z `--base`) → sprawdź zdalne branche lub wskaż poprawne `--base`.
- Inne błędy → odczytaj komunikat skryptu i popraw dane wejściowe.

## Format odpowiedzi
- Wynik: issue + branch utworzone/przełączone, status ustawiony.
- Uwagi: brakujące dane lub konflikty (jeśli dotyczy).

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
