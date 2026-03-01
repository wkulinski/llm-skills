---
name: gh-issue-review
description: >-
  Zlecenie review: push brancha, PR do domyślnej gałęzi repo, status In review,
  opcjonalny reviewer.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/scripts/env-load.sh
---

# $gh-issue-review

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Zautomatyzować zlecenie review: push brancha na origin, utworzenie PR do domyślnej gałęzi repo (lub `--base`), ustawienie statusu w Projects v2 na **In review** oraz (opcjonalnie) request review.

## Kroki
1. Sprawdź autoryzację i scope:
   - `gh auth status`
   - Jeśli używasz `GH_TOKEN`: upewnij się, że token ma scope `project` i `read:org` (Projects v2 w org); `gh auth refresh` nie zadziała przy ustawionym `GH_TOKEN`.
   - Jeśli nie używasz `GH_TOKEN` i brakuje `project` lub `read:org`: `gh auth refresh -h github.com -s project,read:org`
2. Uruchom skrypt:
   - `./scripts/finish.sh`
   - Opcje:
     - `--issue-number <NUMER>` (numer issue w repo)
     - `--reviewer <login>`
     - `--template <ścieżka>` (gdy istnieje wiele templatek PR)
     - `--base <branch>` (opcjonalnie; domyślnie domyślna gałąź repo)
3. Skrypt:
   - fetchuje `origin/<base>`, robi rebase (konflikty → przerwij i dopytaj),
   - wypycha branch komendą `git push origin HEAD --force`,
   - jeśli istnieje **otwarty** PR dla brancha → używa go i tylko dopycha reviewera,
   - jeśli PR nie istnieje lub jest zamknięty/merge → tworzy nowy PR do wybranej gałęzi bazowej,
   - jeśli dodanie reviewera do istniejącego PR się nie uda, tylko to odnotowuje i kontynuuje.
4. Po powodzeniu skryptu uruchom **osobno** `$gh-issue-status-set`, aby ustawić status **In review**:
   - Preferuj przekazanie numeru issue:
     - jeśli użyto `--issue-number`, przekaż ten numer,
     - w przeciwnym razie użyj numeru ustalonego przez skrypt (heurystyka branch/subject).
   - Jeśli nie da się jednoznacznie ustalić numeru issue, pozwól `$gh-issue-status-set` użyć własnych heurystyk i ewentualnie dopytać.

## Algorytm doboru reviewera
1. Jeśli podano `--reviewer` → użyj.
2. W przeciwnym razie: pobierz assignees z issue i pomiń aktualnego użytkownika.
   - Jeśli zostaje dokładnie 1 osoba → użyj.
   - Jeśli zostaje >1 → dopytaj o wybór.
3. Jeśli lista domyślnych reviewerów jest zdefiniowana, użyj pierwszego.
   - Plik: `./default-reviewers.txt` (1 login na linię).
4. Jeśli nadal brak → dopytaj użytkownika.

## Algorytm templatek PR
1. Jeśli istnieje `.github/PULL_REQUEST_TEMPLATE.md` lub `.github/pull_request_template.md` → użyj go.
2. Jeśli istnieje `.github/PULL_REQUEST_TEMPLATE/` z wieloma plikami → dopytaj o wybór i uruchom ponownie z `--template`.
3. Jeśli brak templatek → użyj standardu zdefiniowanego w tym skillu (poniżej). Sekcje wypełnij automatycznie; gdy brak danych, zostaw krótką notę.

## Standardowa templatka PR (gdy brak plików w repo)
```md
## Goal
<krótki cel lub numer issue + tytuł>

## Changes
- <lista zmian lub krótka nota, jeśli brak danych>

## QA
- <co uruchomiono / Not run>

## Checklist
- [ ] Docs updated
- [ ] Migrations
- [ ] New env vars
- [ ] Breaking changes
```

## Kody wyjścia skryptu i retry
Po błędzie zawsze: odczytaj komunikat skryptu, spróbuj samodzielnie ustalić brakujące dane (z repo/GitHub), a następnie **uruchom skrypt ponownie** z uzupełnionymi parametrami. Jeśli nie da się tego ustalić, dopytaj użytkownika i po otrzymaniu danych ponownie uruchom skrypt.

- `3` nie można ustalić numeru issue → spróbuj ustalić numer na podstawie kontekstu rozmowy/brancha; jeśli nie działa, dopytaj i uruchom ponownie z `--issue-number`.
- `13` issue o podanym numerze nie istnieje lub jest zamknięte → poinformuj użytkownika i poproś o poprawny `--issue-number` (sprawdź, czy issue nie zostało zamknięte).
- `21` wielu assignees → wybierz reviewera tylko jeśli użytkownik podał preferencję; w przeciwnym razie dopytaj i uruchom ponownie z `--reviewer`.
- `22` brak reviewera → jeśli istnieje lista domyślnych reviewerów, użyj pierwszego; w przeciwnym razie dopytaj i uruchom ponownie z `--reviewer`.
- `31` wiele templatek PR → poproś o wybór, następnie uruchom ponownie z `--template`.
- `32` wskazana templatka nie istnieje → popraw ścieżkę i uruchom ponownie z `--template`.
- `12` brak `origin/<base>` → sprawdź zdalne branche lub wskaż poprawne `--base`.
- `42` konflikt podczas rebase → poproś o ręczne rozwiązanie konfliktów i uruchom ponownie po `git rebase --continue`.
- `41` nie udało się utworzyć PR → sprawdź komunikat i spróbuj ponownie po korekcie danych.
- Inne błędy → odczytaj komunikat i uzupełnij parametry, po czym uruchom skrypt ponownie.

## Format odpowiedzi
- Wynik: branch wypchnięty, PR utworzony, status ustawiony.
- Uwagi: brakujące dane lub konflikty (jeśli dotyczy).

## Przyklady wejscia
- "$gh-issue-review"
- "gh-issue-review --issue-number 46"
- "zleć review 46"
- "gh-issue-review --reviewer jan"
- "zleć review"
- "daj to do review"
- "niech to jan przejrzy"

## Przyklady wyjscia
- ```text
  Wynik: PR utworzony do gałęzi bazowej repo, status In review ustawiony.
  Uwagi: brak.
  ```
