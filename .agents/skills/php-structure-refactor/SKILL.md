---
name: php-structure-refactor
description: >-
  Wykonawcze operacje strukturalne i refaktoryzacje kodu PHP z użyciem
  Phpactora, Rectora oraz opcjonalnego php-cs-fixer po transformacji. Użyj,
  gdy po zawężeniu zakresu potrzebne są operacje typu move/copy/new class,
  rename z aktualizacją referencji, transformacje klas/memberów, akcje
  edytorowe Phpactora albo powtarzalne transformacje AST przez Rectora.
shared_files:
  - _shared/scripts/env-load.sh
  - _shared/references/symbolic-navigation-and-editing-policy.md
---

# $php-structure-refactor

## Cel
Używaj tego skilla do pracy na strukturze kodu PHP wtedy, gdy potrzebna jest
**narzędziowa operacja wykonawcza**: referencje, przenoszenie klas, rename,
tworzenie/kopiowanie klas, powtarzalne transformacje AST i zwięzłe podsumowania
zmian narzędziowych.

Ten skill nie zastępuje procedur jakości. Nie opisuj zewnętrznych walidacji jako części tego workflow.
Nie jest też domyślnym read-path dla PHP, jeśli aktywne środowisko ma tańszą
warstwę symboliczną do orientacji w kodzie i lokalnych zmian. Jeśli dostępna
jest Serena, oznacza to w praktyce podejście `Serena-first`.

## Źródło komend
1. Załaduj `<skills_root>/_shared/scripts/env-load.sh`.
2. Wyznacz komendy wyłącznie przez `resolve_tool_cmd`:
   - `phpactor`
   - `rector`
   - `php-cs-fixer` tylko gdy potrzebne jest formatowanie po transformacji
3. Entry point narzędzia zwracającego JSON/RPC musi mieć czysty stdout. Diagnostyka typu `Running:` ma trafiać na stderr. Jeśli JSON nie parsuje się przez tekst na stdout, zgłoś błąd entrypointu zamiast filtrować śmieci.

## Szybki Wybór
- Użyj `rg`, gdy szukasz tekstu, konfiguracji, YAML, Twig, nazw plików, prostych literalnych wywołań albo chcesz tylko zawęzić zakres przed narzędziem strukturalnym.
- Jeśli aktywne środowisko ma Serenę dla PHP, użyj Sereny najpierw do orientacji w kodzie i lokalnych zmian symbolicznych zgodnie z `<skills_root>/_shared/references/symbolic-navigation-and-editing-policy.md`.
- Jeśli Serena nie jest dostępna, ale działa inna warstwa symboliczna dla PHP, użyj jej według tej samej logiki.
- Użyj Phpactora CLI, gdy potrzebna jest operacja wykonawcza zależna od symbolu PHP: FQN, namespace, importów, typu pod offsetem, referencji klasy/membera, przenoszenia, kopiowania, tworzenia lub transformacji klasy.
- Użyj Rectora, gdy zmiana jest powtarzalnym wzorcem AST, migracją API, zmianą sygnatur, atrybutów, typów albo namespace stosowaną do wielu plików według reguły.
- Użyj `php-cs-fixer` tylko po automatycznej transformacji, gdy trzeba sformatować dotknięte pliki lub importy. Nie traktuj tego jako walidacji jakości.
- Użyj `$dev-mate`, gdy potrzebujesz runtime: logi, profiler, kontener DI, autowiring, środowisko Symfony.

Nie używaj samego `rg` jako rozstrzygnięcia, gdy trzeba odróżnić symbole o tej samej nazwie, zrozumieć importy, znaleźć referencje PHP, przenieść klasę albo zmienić referencje. `rg` może wtedy jedynie wskazać kandydatów.

## Mapa Operacji
| Zadanie                                              | Narzędzie                                                                                                                             |
|------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| sprawdzić dostępne komendy Phpactora                 | `<skill_dir>/scripts/phpactor-cli.mjs list --format=json`                                                                             |
| sprawdzić opcje komendy Phpactora                    | `<skill_dir>/scripts/phpactor-cli.mjs help <command> --format=json`                                                                   |
| znaleźć klasę/FQN po nazwie                          | `<skill_dir>/scripts/phpactor-cli.mjs class:search <name> --format=json`                                                              |
| sprawdzić strukturę klasy                            | `<skill_dir>/scripts/phpactor-cli.mjs class:reflect <class-or-path> --format=json`                                                    |
| sprawdzić typ/symbol pod offsetem                    | `<skill_dir>/scripts/phpactor-cli.mjs offset:info <path> <offset> --format=json`                                                      |
| znaleźć albo zmienić referencje klasy                | `<skill_dir>/scripts/phpactor-cli.mjs references:class <class-or-path> --format=json [--replace <FQN>]`                               |
| znaleźć albo zmienić referencje membera              | `<skill_dir>/scripts/phpactor-cli.mjs references:member <class> <member> --format=json [--replace <name>]`                            |
| przenieść klasę i referencje                         | `<skill_dir>/scripts/phpactor-cli.mjs class:move <src> <dest> --type=auto\|class\|file`                                               |
| utworzyć albo skopiować klasę                        | `<skill_dir>/scripts/phpactor-cli.mjs class:new ...` albo `<skill_dir>/scripts/phpactor-cli.mjs class:copy ...` po sprawdzeniu `help` |
| wykonać transformację klasy oferowaną przez Phpactor | `<skill_dir>/scripts/phpactor-cli.mjs class:transform ...`; najpierw sprawdź `help`                                                   |
| wykonać regułę na wielu plikach                      | `<skill_dir>/scripts/rector-json-summary.mjs <path> --config <config>`                                                                |
| użyć akcji edytorowej bez odpowiednika CLI           | `<skill_dir>/scripts/phpactor-rpc.mjs --action <rpc_action> --params-file <file>`                                                     |

## Workflow
1. Najpierw oceń przez `<skills_root>/_shared/references/symbolic-navigation-and-editing-policy.md`, czy orientację i lokalną zmianę taniej obsłuży Serena; jeśli Serena nie jest dostępna, oceń to samo dla innej dostępnej warstwy symbolicznej.
2. Jeśli potrzebna jest operacja wykonawcza tego skilla, zawęź zakres przez warstwę symboliczną albo `rg` tylko do ustalenia symbolu, pliku lub wzorca.
3. Skataloguj lokalne API CLI Phpactora przez `<skill_dir>/scripts/phpactor-cli.mjs list --format=json` albo `<skill_dir>/scripts/phpactor-cli.mjs help <command> --format=json`.
4. Jeśli zadanie pasuje do pozycji z mapy operacji, użyj wskazanego narzędzia. Nie twórz własnych aliasów operacji Phpactora.
5. Komendy Phpactora uruchamiaj zgodnie z lokalnym `help <command> --format=json`; wrapper nie blokuje operacji zapisujących pliki.
6. Użyj RPC przez `<skill_dir>/scripts/phpactor-rpc.mjs` dopiero wtedy, gdy CLI nie pokrywa operacji. RPC traktuj jako protokół edytorowy: może zwracać nawigację, dane albo akcje modyfikujące.
7. Jeśli RPC zwróci `input_callback`, oznacza to niedostarczone dane interaktywne; uzupełnij parametry żądania albo użyj równoważnego CLI.
8. Dla transformacji powtarzalnej najpierw uruchom Rectora w dry-run przez `<skill_dir>/scripts/rector-json-summary.mjs`.
9. Jeśli dry-run jest zgodny z intencją, dopiero wtedy uruchom właściwą transformację Rectora albo przygotuj minimalną regułę.
10. Po automatycznej transformacji możesz użyć `php-cs-fixer` wyłącznie do formatowania dotkniętych plików.
11. Na koniec raportuj, jakiego narzędzia użyto i dlaczego; nie rozszerzaj raportu o zewnętrzne procedury jakości.

## Recepty
### Znalezienie Symbolu
1. Użyj `rg` tylko do znalezienia kandydatów nazw lub plików.
2. Potwierdź klasę przez `<skill_dir>/scripts/phpactor-cli.mjs class:search <short-name> --format=json`.
3. Jeśli potrzebujesz pozycji pod kursorem, policz offset i użyj `<skill_dir>/scripts/phpactor-cli.mjs offset:info <path> <offset> --format=json`.

### Referencje i Rename
1. Dla klasy użyj `<skill_dir>/scripts/phpactor-cli.mjs references:class <class-or-path> --format=json`.
2. Dla metody, property albo stałej użyj `<skill_dir>/scripts/phpactor-cli.mjs references:member <class> <member> --format=json`.
3. Jeśli zmieniasz referencje przez `--replace`, użyj dokładnie opcji pokazywanych przez lokalne `help`.
4. Nie zastępuj tego globalnym `rg -l | xargs sed`, jeśli zmiana dotyczy symbolu PHP.

### Przenoszenie lub Tworzenie Klas
1. Sprawdź opcje przez `<skill_dir>/scripts/phpactor-cli.mjs help class:move --format=json`, `<skill_dir>/scripts/phpactor-cli.mjs help class:new --format=json` albo `<skill_dir>/scripts/phpactor-cli.mjs help class:copy --format=json`.
2. Dla przeniesienia użyj `<skill_dir>/scripts/phpactor-cli.mjs class:move <src> <dest> --type=auto|class|file`.
3. Dla tworzenia lub kopiowania klasy użyj `class:new` albo `class:copy` zgodnie z lokalnym `help`.
4. Po wykonaniu obejrzyj diff dotkniętych plików i raportuj zakres zmian.

### Transformacje Wieloplikowe
1. Użyj Rectora, gdy zmiana ma regułę powtarzalną i nie jest prostym przeniesieniem albo referencją symbolu.
2. Najpierw uruchom `<skill_dir>/scripts/rector-json-summary.mjs` na zawężonym zakresie.
3. Jeśli dry-run pokazuje zbyt szeroki albo mieszany diff, zawęź zakres, zmień regułę albo wróć do Phpactora/ręcznego patcha.

### RPC Fallback
1. Najpierw sprawdź, czy CLI ma równoważną komendę przez `list/help`.
2. Użyj RPC tylko dla akcji edytorowych bez odpowiednika CLI.
3. Parametry przekazuj przez `--params-file`, jeśli zawierają źródło pliku lub są dłuższe niż krótki JSON.
4. Jeśli wynik ma `effects.hasInputCallback`, uzupełnij brakujące dane wejściowe albo użyj równoważnego CLI.

## Helpery
### `phpactor-cli.mjs`
Generyczny wrapper CLI Phpactora. Przyjmuje komendę i argumenty Phpactora bez odtwarzania ich API w skillu. Wrapper rozwiązuje `phpactor` przez `resolve_tool_cmd`, uruchamia go z repo root, dokłada `--no-interaction` i `--no-ansi`, parsuje JSON jeśli komenda go zwróci oraz streszcza output.

Przykłady:
```bash
node <skill_dir>/scripts/phpactor-cli.mjs list --format=json
node <skill_dir>/scripts/phpactor-cli.mjs help class:move --format=json
node <skill_dir>/scripts/phpactor-cli.mjs class:search Foo --format=json
node <skill_dir>/scripts/phpactor-cli.mjs offset:info ./src/Foo.php 123 --format=json
node <skill_dir>/scripts/phpactor-cli.mjs references:class 'App\Foo' --format=json
node <skill_dir>/scripts/phpactor-cli.mjs class:move ./src/Old.php ./src/New.php --type=file
```

Jeśli nie znasz opcji komendy, najpierw wywołaj `help <command> --format=json` przez ten sam wrapper. Sekcja `flags` streszcza dostępność `hasDryRun`, `hasFormat`, `hasFilesystem` i `hasNoInteraction`, ale wrapper nie wymusza trybu dry-run ani osobnego potwierdzenia apply.

### `phpactor-rpc.mjs`
Generyczny wrapper RPC Phpactora. Nie kataloguje akcji RPC i nie mapuje własnych aliasów na akcje Phpactora. Używaj go tylko wtedy, gdy lokalne CLI nie pokrywa zadania.

Przykłady:
```bash
node <skill_dir>/scripts/phpactor-rpc.mjs --action offset_info --params-file <params-file>
node <skill_dir>/scripts/phpactor-rpc.mjs --action goto_definition --params-json '{"path":"./src/Foo.php","source":"<?php ...","offset":123}'
node <skill_dir>/scripts/phpactor-rpc.mjs --request-file <request-file>
```

Dokumentacja RPC Phpactora jest niespójna statusowo (`legacy`/`work-in-progress`), dlatego nie traktuj jej jako stabilniejszej od lokalnego CLI. Źródła pomocnicze: `https://phpactor.readthedocs.io/en/master/reference/rpc_command.html` i `https://phpactor.readthedocs.io/en/master/other/rpc.html`.

Nie wklejaj pełnych `replace_file_source` do rozmowy. Helper streszcza je długością i ścieżką oraz raportuje `effects.hasReplaceFileSource` i `effects.hasInputCallback`.
Rutynowy stderr proxy jest ukrywany. Ustaw `PHP_STRUCTURE_DEBUG=1`, jeśli potrzebujesz zobaczyć dokładną komendę narzędzia.

### `rector-json-summary.mjs`
Wymusza `--dry-run --output-format=json --no-progress-bar` i streszcza wynik.

Przykład:
```bash
node <skill_dir>/scripts/rector-json-summary.mjs ./src/Core --config ./rector.php
```

Jeśli potrzebujesz pełnego diffu, uruchom Rectora ręcznie na zawężonym zakresie po wcześniejszym podsumowaniu.
Nie zakładaj zakresu bazowego configu; oceniaj wynik dry-run. Dla konkretnej transformacji dodaj tymczasową regułę albo użyj zadaniowego configu.

### `php-cs-fixer`
Do inspekcji formatowania użyj helpera na zawężonej liście plików:
```bash
node <skill_dir>/scripts/php-cs-fixer-json-summary.mjs <path>
```
Helper wymusza `--dry-run --diff --format=json --show-progress=none` i streszcza wynik. Do właściwego formatowania uruchom komendę `php-cs-fixer` wyznaczoną przez `resolve_tool_cmd`, bez `--dry-run --diff`, nadal tylko dla dotkniętych plików.

## Kontrakty Projektowe
- `phpactor`, `rector` i `php-cs-fixer` mają być dostępne przez aktywny `BIN_PATH` oraz `resolve_tool_cmd`; skill nie zakłada konkretnej ścieżki instalacji narzędzi.
- Entry point narzędzia używanego przez helper JSON/RPC nie może pisać statusów na stdout.
- Phpactor może wymagać zaufania konfiguracji projektu (`phpactor config:trust --trust`). Jeśli config nie jest ładowany, wykonaj trust lokalnie przez `resolve_tool_cmd phpactor`; wynik powinien trafiać do cache projektu lub użytkownika obsłużonego przez entrypoint.

## Granice Runtime
- Ten skill nie czyta logów, profilera ani kontenera DI.
- Jeśli potrzeba wynika z błędu runtime, logów, profilera, konfiguracji usług Symfony albo autowiringu, najpierw użyj `$dev-mate`.
- Gdy `$dev-mate` wskaże konkretną klasę, symbol, zależność albo wzorzec do zmiany, wróć do tego skilla po refaktor strukturalny.

## Stop
Zatrzymaj się i wróć do zwykłej implementacji, jeśli:
- zmiana nie jest strukturalna i prosty patch jest tańszy,
- Rector dry-run pokazuje zbyt szeroki lub niejednoznaczny diff,
- phpactor nie potrafi rozstrzygnąć symbolu i wymagałby zgadywania.
