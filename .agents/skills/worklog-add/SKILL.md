---
name: worklog-add
description: >-
  Tworzenie lub uzupełnianie wpisu w worklogu na podstawie bieżących zmian i
  historii commitów. Intencje: dodaj wpis do worklogu, uzupełnij worklog,
  przygotuj wpis do commita. Użyj przy $worklog-add.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
---

# $worklog-add

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

Nie pomijaj żadnego kroku. Nie edytuj wpisów z ULID obecnym w `git log` bez wyraźnego polecenia użytkownika.

## Cel
Celem jest utworzenie lub uzupełnienie wpisu worklogu dla bieżących zmian zgodnie z procedurą i ULID. Dzięki temu historia zmian jest kompletna i gotowa do użycia w commicie.

## Mapa ścieżek dokumentacji (AGENTS-first)
1. Zawsze zaczynaj od `AGENTS.md`.
2. Odczytaj mapę ścieżek dokumentacji `docs_map`.
3. Wszystkie ścieżki z mapy traktuj jako repo-relative.
4. Nie zgaduj ścieżek po nazwie pliku.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `WORKLOG_DIR`: katalog z plikami worklogu per e-mail.

## Kroki
1. Otwórz `AGENTS.md` i odczytaj mapę `docs_map`.
2. Odczytaj klucz `WORKLOG_DIR`.
   - Jeśli mapy lub klucza brakuje: zatrzymaj się i dopytaj użytkownika o ścieżkę katalogu worklogu.
3. Pobierz e-mail z `git config user.email`. Jeśli brak, przerwij i zgłoś.
4. Ustal plik worklogu: `<WORKLOG_DIR>/<email>.md`. Jeśli nie istnieje, utwórz go.
5. Przeczytaj:
   - `../_shared/references/runtime-collaboration-guidelines.md`
   - `../_shared/references/runtime-quality-procedures.md`
   - `../_shared/references/php-symfony-postgres-standards.md`
   - jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1` w `.env` / `.env.local`: `../_shared/references/cqrs-monolith-standard-overrides.md`
   Jeśli procedura się zmieniła, stosuj nowszą.
6. Sprawdź aktualne zmiany: `git status`.
7. Zbierz komplet zmian, które wpis ma opisać (tracked i untracked) i upewnij się, że rozumiesz ich treść:
   - lista plików tracked: `git diff --name-only`
   - lista plików untracked: `git ls-files --others --exclude-standard`
   - szybki rozmiar zmian: `git diff --stat`
   - zasada jakości: nie twórz wpisu worklog “w ciemno” na podstawie samych nazw plików — wpis ma opisywać realne zmiany.
   - próg (threshold):
     - jeśli liczba plików zmienionych+untracked jest mała (np. ≤ 20): przejrzyj diff każdego pliku lub kluczowe fragmenty, aby napisać rzetelne punkty,
     - jeśli jest duża: przejrzyj pełne diffy przynajmniej dla plików “high-risk” (procedury, konfiguracje, security/migracje, core domena) oraz dla obszaru wskazanego przez użytkownika; resztę opisz na podstawie `--stat/--numstat` + krótkiej inspekcji pliku (np. nagłówek/kluczowe sekcje), a w razie braku pewności poproś o zawężenie lub wykonaj `$review-quick`.
8. Pobierz listę ostatnich 100 użytych ULID: `git --no-pager log -n 100 --pretty=oneline | grep -oP '(?<=\\[)[^]]+(?=\\])'`.
9. Sprawdź, czy najwyższy wpis w `<WORKLOG_DIR>/<email>.md` ma ULID obecny na liście z kroku 8:
   - Jeśli tak — utwórz nowy wpis u góry z nowym ULID (przejdź do kroku 10/11).
   - Jeśli nie — schodź w dół, aż trafisz na wpis z ULID obecnym na liście. Wszystkie wpisy bez ULID z listy traktuj jako bieżące i scal ich punkty pod jednym adekwatnym tytułem (przejdź do kroku 11).
10. Wygeneruj nowy ULID przez aktywny entrypoint konsoli projektu (proxy z `BIN_PATH` albo natywna komenda repo), np. `bin/console ulid:generate --format base58` (jeden ULID na wpis/commit).
11. Utwórz lub uzupełnij bieżący wpis w formacie `### [YYYY-MM-DD] Krótki tytuł [ULID]` (dzisiejsza data). Pod nagłówkiem wypunktuj komplet zmian: wszystkie bieżące, niecommitowane zmiany (śledzone i nieśledzone), bez duplikatów; zachowaj istniejące punkty, jeśli wpis już istniał.
    Zasady tworzenia `Krótki tytuł` (polski, bez daty i bez ULID — te są w szablonie nagłówka):
    - Tytuł musi nadawać się do użycia jako temat commita (bez zmian znaczenia) — `$git-commit` ma użyć go wprost.
    - Styl preferowany (wybierz jeden i trzymaj się konsekwentnie w obrębie wpisu):
      1) **Bezosobowo, w trybie oznajmującym, w czasie przeszłym dokonanym**: `Dodano ...`, `Zmieniono ...`, `Usunięto ...`, `Naprawiono ...`, `Ujednolicono ...`, `Zaktualizowano ...`, `Ustabilizowano ...`.
      2) **Rzeczownikowo** (często najbardziej naturalne): `Stabilizacja ...`, `Ujednolicenie ...`, `Aktualizacja ...`, `Naprawa ...`.
    - Zakazane są formy rozkazujące i “polecenia” w tytule (np. `Zrób ...`, `Dodaj ...`, `Ustaw ...`, `Ustabilnij ...`).
    - Unikaj kalek/rusycyzmów i sztucznych form czasownikowych; jeśli masz wątpliwość, wybierz wariant rzeczownikowy (`Stabilizacja ...`) albo jedną z form “Dodano/Zmieniono/Usunięto/Naprawiono/Zaktualizowano...`.
    Przykłady:
    - OK: `Stabilizacja Makefile i środowisk Docker (tools, Xdebug)`
    - OK: `Ustabilizowano Makefile i środowiska Docker (tools, Xdebug)`
    - ŹLE: `Ustabilnij Makefile i środowiska Docker (tools, Xdebug)`

12. Oceń, czy tytuł jest adekwatny do treści; jeśli nie — popraw go.
13. Nie modyfikuj historycznych wpisów z ULID obecnym na liście z kroku 8, chyba że użytkownik wyraźnie nakaże.

## Przykład nagłówka
`### [2025-01-31] Krótki tytuł [01JABCDE23456789XYZ]`

## Zakres
- W zakresie: utworzenie lub uzupełnienie wpisu worklogu dla bieżących zmian.
- Poza zakresem: staging i commit.

## Format odpowiedzi
- Wynik: potwierdź, czy wpis został utworzony czy uzupełniony.
- Użyte klucze dokumentacji:
  - `WORKLOG_DIR=<resolved-path>`
- Uwagi: podaj ścieżkę pliku worklogu.
- Jeśli nie da się rzetelnie opisać zmian (np. ogromny zakres bez wskazania priorytetów): wstrzymaj się i poproś o doprecyzowanie zakresu lub o zgodę na wykonanie `$review-quick` przed wpisem.

## Przykłady wejścia
- "$worklog-add"
- "dodaj wpis do worklogu"
- "uzupełnij worklog"

## Przykłady wyjścia
- ```text
  Wynik: wpis utworzony.
  Uwagi: `<WORKLOG_DIR>/<email>.md`.
  ```
- ```text
  Wynik: wpis uzupełniony.
  Uwagi: `<WORKLOG_DIR>/<email>.md`.
  ```

## Efekt
Właściwy plik `<WORKLOG_DIR>/<email>.md` ma najnowszy wpis z poprawnym ULID, który obejmuje wszystkie bieżące zmiany.

## Przypadki brzegowe
- Brak `git config user.email` — przerwij.
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika o ścieżkę katalogu worklogu.
- Brak klucza `WORKLOG_DIR` w `docs_map` — dopytaj użytkownika o ścieżkę katalogu worklogu.
