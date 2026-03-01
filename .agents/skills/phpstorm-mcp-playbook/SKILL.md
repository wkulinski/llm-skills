---
name: phpstorm-mcp-playbook
description: >-
  Playbook pracy MCP-first w PhpStorm z trybami quick-check (read-only),
  implement i refactor: discovery po indeksach IDE, symbolika
  (definicje/usages), bezpieczne refactory (rename), formatowanie i inspekcje.
  Użyj, gdy zadanie wymaga nawigacji semantycznej lub zmian wieloplikowych;
  rg/grep traktuj jako fallback lub ścieżkę awaryjną przy wysokiej latencji MCP.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
---

# Skill: PhpStorm MCP Playbook

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel

Ustandaryzować pracę agenta tak, aby:
- discovery i analiza semantyczna były robione przez narzędzia PhpStorm MCP,
- refactory (szczególnie rename) były wykonywane bezpiecznie przez IDE,
- walidacja zmian obejmowała inspekcje IDE oraz checki repo (entrypointy projektu, z uwzględnieniem `BIN_PATH`, jeśli repo używa proxy).

---

## Założenia środowiskowe

- Masz skonfigurowany MCP server o nazwie **`phpstorm`** w konfiguracji klienta agenta (np. `~/.agents/config.toml`).
- PhpStorm jest uruchomiony i ma włączony **Settings → Tools → MCP Server → Enable MCP Server**.
- Repo jest otwarte w PhpStorm.

---

## Trigger (kiedy używać)

Używaj tego playbooka zawsze, gdy zadanie wymaga przynajmniej jednego z poniższych:

- „Jak to jest zrobione u nas?” (precedensy, architektura, warstwy, moduły)
- nawigacja po symbolach (go-to-definition, usages, typy)
- refactor (rename, move, zmiany w wielu miejscach)
- sprawdzenie błędów/ostrzeżeń z inspekcji IDE
- szybkie znalezienie plików po indeksach (lepsze niż grep)

---

## Zakres

- W zakresie:
  - workflow MCP-first dla discovery/symboliki/refactorów/inspekcji,
  - bezpieczna nawigacja i edycja wieloplikowa z użyciem narzędzi PhpStorm MCP,
  - fallback do `rg`, gdy MCP jest niedostępny lub nie daje wyników.
- Poza zakresem:
  - pełna orkiestracja implementacji end-to-end (od tego jest `$code-implement`),
  - pełna procedura QA i commit (`$qa-run`, `$git-commit`),
  - aktualizacja dokumentacji domenowej/proceduralnej (`$docs-sync`).

---

## Integracja z innymi skillami

Używaj tego skilla jako “nakładki narzędziowej” podczas pracy nad kodem:
- start/odświeżenie kontekstu repo: `$context-refresh`,
- implementacja zmian: `$code-implement`,
- szybka walidacja po zmianach: `$review-quick`,
- pełne QA: `$qa-run`,
- commit/worklog: `$git-commit`.

---

## Zasada nadrzędna

1) **Preferuj PhpStorm MCP** dla wszystkiego, co ma semantykę lub ryzyko (refactor).
2) **`rg` jest fallbackiem** — używaj gdy MCP jest niedostępny, ma wysoką latencję lub nie zwraca sensownych wyników.
3) Jeśli narzędzie PhpStorm MCP przyjmuje `projectPath`, **zawsze** przekazuj go jawnie (gdy jest znany).
4) O wyborze ścieżki decyduje przede wszystkim **ryzyko utraty informacji**, nie sama liczba trafień.

---

## Routing: probe-first + information-risk gate

Stosuj routing dwufazowy zamiast „MCP zawsze” albo „rg zawsze”:

1) **Probe (tani start)**:
   - przy pytaniach read-only możesz zacząć od szybkiego `rg`/MCP-search z limitem wyników, aby oszacować zakres i znaleźć kandydatów.
2) **Gate informacyjny**:
   - jeśli pytanie jest leksykalne (np. „czy string X występuje?”, „gdzie jest tekst Y?”), możesz zakończyć na `rg`,
   - jeśli pytanie jest semantyczne (np. „co to robi?”, „jaki jest kontekst `this`?”, „czy refactor/rename jest bezpieczny?”), wykonaj **co najmniej jedno potwierdzenie MCP**.
3) **Potwierdzenie MCP (minimum 1 krok)**:
   - użyj jednego z: `get_symbol_info`, `get_file_text_by_path`, `find_files_by_name_keyword` (dla właściwego symbolu/pliku),
   - odpowiedź semantyczną oprzyj na tym potwierdzeniu, nawet jeśli probe był zrobiony przez `rg`.

Zasada praktyczna:
- `rg` daje szybkość.
- MCP daje semantykę i bezpieczeństwo decyzji.
- W odpowiedziach semantycznych używaj hybrydy: `rg-first` + `MCP confirmation`.

---

## Tryby pracy (wybór na starcie)

Wybierz tryb przed pierwszym wywołaniem narzędzi:

| Tryb | Kiedy użyć | Zakres | Walidacja |
|---|---|---|---|
| `quick-check` | Krótkie pytania read-only: „czy da się”, „gdzie to jest”, „jak to działa” | Discovery + odczyt 1-3 kluczowych plików/symboli | Domyślnie **bez** `get_file_problems` |
| `implement` | Zmiany funkcjonalne bez ciężkiego refactoru symboli | Discovery + plan + edycje + format | `get_file_problems` tylko dla zmodyfikowanych plików |
| `refactor` | Zmiany wieloplikowe i ryzykowne operacje (rename/move/API) | Discovery + plan + refactor IDE + format | `get_file_problems` dla zmodyfikowanych plików i kluczowych miejsc użycia |

Domyślnie:
- Gdy zadanie jest read-only i nie wymaga edycji, wybierz `quick-check`.
- Gdy występuje rename lub zmiana kontraktu, wybierz `refactor`.
- W pozostałych przypadkach wybierz `implement`.

Dla `quick-check`:
- dopuszczalny jest `rg-first` jako probe,
- ale przy odpowiedzi semantycznej wymagane jest minimum jedno potwierdzenie MCP.

---

## Bootstrap: `projectPath` + szybka diagnostyka

### 1) Ustal `projectPath`

`projectPath` powinien wskazywać projekt tak, jak widzi go PhpStorm (Windows/UNC). Najstabilniej w WSL:

```bash
mkdir -p .agents
wslpath -w "$(git rev-parse --show-toplevel)" > .agents/project_path.txt
cat .agents/project_path.txt
```

Od tego momentu:
- `PROJECT_PATH="$(cat .agents/project_path.txt)"`

Jeśli `wslpath` jest niedostępny (np. poza WSL), użyj ścieżki projektu zwróconej przez `get_repositories` albo natywnej ścieżki projektu z IDE.

### 2) Minimalny check MCP

Wykonaj lekkie wywołanie narzędzia PhpStorm MCP, np.:
- `get_repositories` lub
- `find_files_by_name_keyword` (np. `composer`).

Jeśli to działa, kontynuuj workflow MCP-first.
Jeśli nie działa, przejdź do sekcji fallback.

### 3) Mapa ról → narzędzia (preferowane)

- FIND_FILES: `find_files_by_name_keyword`, `find_files_by_glob`
- READ_FILE: `get_file_text_by_path`
- SEARCH_TEXT/REGEX: `search_in_files_by_text`, `search_in_files_by_regex`
- SYMBOL_INFO: `get_symbol_info`
- REPLACE: `replace_text_in_file`
- RENAME: `rename_refactoring`
- FORMAT: `reformat_file`
- PROBLEMS: `get_file_problems`
- RUN_CONFIG: `get_run_configurations`, `execute_run_configuration`

Uwaga: w niektórych środowiskach TUI komenda `/mcp` może być dostępna, ale **nie jest wymagana** do działania tego skilla.

---

## Soft budget i checkpointy (bez hard-timeoutu)

Nie przerywaj zadania sztywnym limitem czasu. Zamiast tego stosuj miękki budżet:

- `quick-check`: cel 3-6 wywołań narzędzi i 20-30s discovery.
- `implement`: cel 6-15 wywołań discovery/analizy przed edycją.
- `refactor`: budżet wyższy, ale z checkpointem po każdym etapie (discovery, plan, refactor, walidacja).

Po przekroczeniu budżetu:
1) Nie kończ zadania automatycznie.
2) Zrób krótki checkpoint: co już ustalono i czego jeszcze brakuje.
3) Zaproponuj dalszy tryb pracy:
   - kontynuować MCP,
   - przejść na lżejszy fallback (`rg`) dla discovery read-only,
   - zawęzić zakres.

---

## Standardowy workflow (dobierz do trybu)

### Krok A — Discovery (znajdź właściwe miejsca)

1) Jeśli znasz nazwę pliku/fragmentu:
   - użyj FIND_FILES (po indeksie IDE) → szybciej i trafniej niż grep.

2) Jeśli nie znasz pliku:
   - zacznij od FIND_FILES po keywordach (np. nazwa modułu, bounded context, feature),
   - potem READ_FILE wybranych trafień.

3) Jeśli szukasz symbolu (klasa/metoda/serwis):
   - użyj SYMBOL_INFO (najlepiej na konkretnym pliku/linie/kolumnie),
   - do szukania wywołań/referencji użyj SEARCH_TEXT/REGEX lub wyszukiwania po indeksach.

4) Jeśli discovery zaczęto przez `rg` (probe), a wynik ma posłużyć do decyzji semantycznej:
   - wykonaj minimum 1 potwierdzenie MCP przed sformułowaniem odpowiedzi końcowej.

**Nie czytaj całych dużych plików na raz.** Pobieraj tylko potrzebne fragmenty (MCP READ_FILE) i streszczaj.

---

### Krok B — Plan

Po discovery:
- W trybie `quick-check`: przedstaw krótką odpowiedź i wskaż pliki/symbole, bez pełnego planu implementacji.
- W trybach `implement`/`refactor`:
  - wypisz listę plików do zmiany,
  - opisz plan w 3-8 krokach,
  - wskaż ryzyka (np. Deptrac/warstwy, BC boundaries),
  - wskaż jak zweryfikujesz zmianę (inspekcje + testy).

---

### Krok C — Implementacja (preferuj narzędzia IDE)

Ten krok wykonuj tylko w trybach `implement` i `refactor`.

#### Zanim edytujesz plik
- jeśli plik jest już zmieniony w repo (tracked/untracked), najpierw przeczytaj jego diff i bieżącą treść (read-before-write).

#### Zmiany „małe i precyzyjne”
- użyj REPLACE (MCP), zamiast przepisywać plik od zera.

#### Refactor / rename (wysokie ryzyko)
- użyj RENAME (MCP) zamiast search&replace.

#### Po każdej istotnej zmianie pliku
- FORMAT (MCP) na zmodyfikowanym pliku.

---

### Krok D — Walidacja (warunkowo)

1) Jeśli nie było edycji plików (typowe `quick-check`), pomiń `get_file_problems` domyślnie.
2) Jeśli były edycje:
   - uruchom PROBLEMS (MCP) dla wszystkich zmodyfikowanych plików,
   - napraw błędy/ostrzeżenia, które są związane z zadaniem.
3) W trybie `refactor` dołóż PROBLEMS dla kluczowych miejsc użycia po zmianie symboli.
4) Opcjonalnie (gdy ma sens): uruchom smoke przez `execute_run_configuration`.
5) Dalszą walidację jakości i testów wykonuj zgodnie z procedurami repo:
   - `$review-quick` (minimum przy zmianach w kodzie),
   - `$qa-run` (dla większego zakresu zmian lub gdy wymagane).

---

## Fallback: gdy MCP nie działa

Jeżeli `phpstorm` MCP jest niedostępny lub zwraca błąd:

1) odnotuj krótko: „MCP niedostępny — używam fallback”.
2) użyj `rg` do znalezienia plików i precedensów.
3) unikaj ryzykownych refactorów (rename) bez IDE:
   - jeśli rename konieczny → poproś o uruchomienie PhpStorm i powrót do MCP.
4) przy read-only `quick-check` możesz zakończyć bez walidacji IDE.
5) przy edycjach kodu wykonaj dalszą walidację zgodnie z procedurami repo (`$review-quick`, `$qa-run`).

---

## Format odpowiedzi

- Użyte narzędzia: lista kluczowych wywołań MCP (lub informacja o fallbacku).
- Znalezione miejsca: pliki/symbole, które były podstawą decyzji lub zmian.
- Walidacja: wynik `get_file_problems` oraz informacja, czy odpalono `$review-quick` / `$qa-run`.
- Uwagi: ryzyka, ograniczenia lub brakujące warunki środowiskowe.

---

## „Gotowe komendy” (do użycia jako checklist)

### Ustal projectPath
```bash
mkdir -p .agents
wslpath -w "$(git rev-parse --show-toplevel)" > .agents/project_path.txt
```

### Minimalny test (manual)
- Wywołaj `find_files_by_name_keyword` dla `composer`.
- Odczytaj fragment `composer.json` przez `get_file_text_by_path`.
- Sprawdź `get_file_problems` tylko gdy test obejmuje edycję pliku.

---

## Przypadki brzegowe

- Brak `wslpath`: ustal `projectPath` przez `get_repositories` lub natywną ścieżkę projektu w IDE.
- Wiele repozytoriów/VCS roots: wybierz właściwy `projectPath` dla aktualnego zadania przed pierwszym wywołaniem edycji/refactoru.
- MCP działa, ale wyniki są niepełne (np. nieaktualne indeksy IDE): poproś o dokończenie indeksowania i ponów krok discovery; jeśli nadal nie działa, użyj fallbacku.
- Brak narzędzi refactor (`rename_refactoring`): nie wykonuj ryzykownego rename przez search&replace; poproś o uruchomienie IDE MCP i wróć do ścieżki MCP-first.
- Narzędzie `get_file_text_by_path` odrzuca parametry truncation: powtórz wywołanie bez `truncateMode` i zastosuj domyślne ustawienia.

---

## Zasady jakości i bezpieczeństwa

- Nie otwieraj i nie indeksuj sekretów (`.env`, klucze, hasła).
- Nie wklejaj do rozmowy dużych plików w całości.
- Zawsze cytuj ścieżki plików, a jeśli MCP zwraca lokalizacje (line/col) — podawaj je.
- Dla zmian wymagających QA/commit stosuj obowiązujące procedury repo (`$review-quick`, `$qa-run`, `$git-commit`).
