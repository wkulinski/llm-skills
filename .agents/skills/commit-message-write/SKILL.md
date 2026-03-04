---
name: commit-message-write
description: >-
  Generowanie treści commita na podstawie bieżących zmian i zapis do pliku
  `COMMIT_MESSAGE_DIR/commit-message.txt`. Intencje: przygotuj treść commita,
  zapisz commit message do pliku. Użyj przy $commit-message-write.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
---

# $commit-message-write

## Reguły rozwiązywania ścieżek
- Ścieżki z prefiksem `./` są repo-relative (`./` = `git rev-parse --show-toplevel`), a nie względem katalogu procesu.
- Ścieżki w `shared_files` są względne względem katalogu z bieżącym `SKILL.md` (np. `_shared/...` oznacza `../_shared/...`).

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Celem jest przygotowanie kompletnej treści commita (subject + body) na podstawie bieżących zmian i zapisanie jej do jednego pliku roboczego:
`<COMMIT_MESSAGE_DIR>/commit-message.txt`.

## Model tworzenia treści (draft -> prune)
Ten skill działa dwuetapowo:
1. `Draft` (szeroki kontekst):
   - można użyć pełnego kontekstu sesji (odczyty, diffy, wcześniejsze decyzje), aby dobrze uchwycić sens zmian.
   - draft może być bogatszy opisowo niż finalna lista commitowalnych plików.
2. `Prune` (twarde przycięcie do commitowalności):
   - przed zapisem finalnego pliku treść musi zostać przycięta wyłącznie do zmian commitowalnych w repo,
   - commitowalne = `tracked` + `staged` + `untracked` nieignorowane przez git,
   - elementy, których nie da się powiązać z commitowalnym zakresem plików, nie mogą trafić do finalnego `commit-message.txt`.

## Mapa ścieżek dokumentacji (AGENTS-first)
1. Zawsze zaczynaj od `AGENTS.md`.
2. Odczytaj mapę ścieżek dokumentacji `docs_map`.
3. Ścieżki względne traktuj jako repo-relative; ścieżki absolutne używaj 1:1 (bez prefiksu repo).
4. Nie zgaduj ścieżek po nazwie pliku.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `COMMIT_MESSAGE_DIR`: katalog dla pliku `commit-message.txt`.

## Kroki
1. Otwórz `AGENTS.md` i odczytaj mapę `docs_map`.
2. Odczytaj klucz `COMMIT_MESSAGE_DIR`.
   - Jeśli mapy lub klucza brakuje: zatrzymaj się i dopytaj użytkownika o ścieżkę katalogu.
3. Ustal plik wyjściowy: `<COMMIT_MESSAGE_DIR>/commit-message.txt`.
4. Upewnij się, że katalog `COMMIT_MESSAGE_DIR` istnieje (`mkdir -p`).
   - Jeśli nie da się utworzyć katalogu: przerwij z błędem.
5. Zbierz zakres commitowalnych zmian i upewnij się, że rozumiesz ich treść:
   - `git status -sb`
   - lista plików tracked (unstaged): `git diff --name-only`
   - lista plików tracked (staged): `git diff --cached --name-only`
   - lista plików untracked nieignorowanych: `git ls-files --others --exclude-standard`
   - zbuduj `COMMIT_SCOPE` jako sumę trzech list powyżej (bez duplikatów).
   - szybki rozmiar zmian:
     - `git diff --stat`
     - `git diff --cached --stat`
   - zasada jakości: nie twórz treści commita “w ciemno” na podstawie samych nazw plików.
   - jeśli `COMMIT_SCOPE` jest pusty: przerwij z komunikatem, że brak commitowalnych zmian do opisania.
   - próg (threshold):
     - jeśli liczba plików w `COMMIT_SCOPE` jest mała (np. <= 20): przejrzyj diff każdego pliku lub kluczowe fragmenty,
     - jeśli jest duża: przejrzyj pełne diffy przynajmniej dla plików high-risk (procedury, konfiguracje, security/migracje, core domena) oraz dla obszaru wskazanego przez użytkownika; resztę opisz na podstawie `--stat/--numstat` + krótkiej inspekcji plików.
6. Przygotuj draft treści commit message (etap `Draft`) w formacie:
   - linia 1: subject w konwencji Conventional Commits, bez kropki na końcu,
   - linia 2: pusta,
   - kolejne linie: lista punktów (`- ...`) opisująca pełen zakres bieżących zmian.
   - język subjectu i body:
     - Treść commita twórz w języku wymaganym przez dokumentację projektu (źródło prawdy: `AGENTS.md` oraz dokument wskazany przez `docs_map.AGENT_RULES_DOC`).
     - Jeśli brak jawnej reguły językowej, użyj języka bieżącej komunikacji z użytkownikiem.
7. Wykonaj etap `Prune` (obowiązkowy) i przytnij draft wyłącznie do `COMMIT_SCOPE`:
   - każdy punkt body musi mapować się do co najmniej jednego pliku z `COMMIT_SCOPE`,
   - punkty niemapowalne usuń albo przepisz tak, aby odzwierciedlały wyłącznie zmiany commitowalne,
   - subject zbuduj po przycięciu, na podstawie punktów które przeszły filtr `COMMIT_SCOPE`,
   - nie zostawiaj w finalnym tekście wzmianek o zmianach wyłącznie kontekstowych (np. z plików ignorowanych), jeśli nie mają pokrycia w `COMMIT_SCOPE`.
8. Zasady tworzenia subjectu (linia 1):
   - format: `<type>: <Krótki tytuł>`
   - `<type>` dobierz zgodnie z Conventional Commits (`feat`, `fix`, `chore`, `refactor`, `docs`, `test`, `build`, `ci`, `style`, `perf`, `revert`),
   - `Krótki tytuł` adekwatny do zmian,
   - zakazane są formy rozkazujące (np. `Dodaj`, `Ustaw`, `Zrób`) i kalka językowa.
9. Zasady tworzenia body:
   - body ma odzwierciedlać realnie wykryte i zrozumiane zmiany,
   - body ma opisywać wyłącznie zmiany z `COMMIT_SCOPE`,
   - każdy punkt ma być krótki, konkretny i bez duplikatów,
   - kolejność punktów powinna iść od zmian najbardziej istotnych do pomocniczych.
10. Zapisz treść do `<COMMIT_MESSAGE_DIR>/commit-message.txt`.
   - Zapis traktuj jako obowiązkowy.
   - Jeśli zapis się nie powiedzie (brak uprawnień, brak miejsca, błąd I/O): przerwij z błędem i nie stosuj obejść/fallbacków.
11. Po zapisie zweryfikuj, że plik istnieje, jest czytelny i nie jest pusty.
    - Jeśli walidacja nie przejdzie: przerwij z błędem.

## Zakres
- W zakresie: przygotowanie treści commita i zapis do `commit-message.txt`.
- Poza zakresem: staging i `git commit`.

## Format odpowiedzi
- Wynik: potwierdź, że plik został utworzony lub nadpisany.
- Użyte klucze dokumentacji:
  - `COMMIT_MESSAGE_DIR=<resolved-path>`
- Uwagi: podaj ścieżkę pliku i krótko potwierdź, że treść jest gotowa do `git commit -F`.

## Przykłady wejścia
- "$commit-message-write"
- "przygotuj commit message"
- "zapisz treść commita do commit-message.txt"
- "przygotuj worklog"
- "zrzuć rejestr zmian"

## Przykłady wyjścia
- ```text
  Wynik: plik commit message utworzony.
  Użyte klucze dokumentacji: COMMIT_MESSAGE_DIR=/tmp/
  Uwagi: `/tmp/commit-message.txt` gotowy do `git commit -F`.
  ```
- ```text
  Wynik: plik commit message nadpisany.
  Użyte klucze dokumentacji: COMMIT_MESSAGE_DIR=/tmp/
  Uwagi: `/tmp/commit-message.txt` gotowy do `git commit -F`.
  ```

## Efekt
`<COMMIT_MESSAGE_DIR>/commit-message.txt` zawiera kompletną treść commita (subject + body) dla bieżących zmian.

## Przypadki brzegowe
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika o ścieżkę katalogu.
- Brak klucza `COMMIT_MESSAGE_DIR` w `docs_map` — dopytaj użytkownika o ścieżkę katalogu.
- `COMMIT_SCOPE` pusty (brak tracked/staged/untracked nieignorowanych) — przerwij z informacją, że brak commitowalnych zmian do opisania.
- Brak możliwości zapisu do `COMMIT_MESSAGE_DIR` lub do `commit-message.txt` — przerwij z błędem.
