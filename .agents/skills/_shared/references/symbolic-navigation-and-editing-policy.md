# Symbolic Navigation And Editing Policy

Ten dokument opisuje **przenośną politykę wyboru narzędzi do nawigacji i edycji kodu**.
Nie jest to konfiguracja konkretnego repozytorium ani wymuszenie jednego narzędzia w każdym środowisku.
Jeśli środowisko udostępnia **Serenę**, traktuj ją jako preferowaną warstwę symboliczną, chyba że niższe sekcje wskazują tańszy albo bezpieczniejszy fallback.

## 1. Cel
- Ograniczać zużycie tokenów i kontekstu przez preferowanie narzędzi symbolicznych tam, gdzie realnie zawężają zakres odczytu.
- Unikać ręcznego przeszukiwania pełnych plików, jeśli aktywne środowisko udostępnia stabilną nawigację po symbolach dla danego języka.
- Jasno rozdzielać:
  - orientację i lokalne zmiany symboliczne,
  - zmiany tekstowe,
  - operacje runtime,
  - transformacje narzędziowe typu refactor/codemod.

## 2. Tool Availability Gate
- Najpierw ustal, czy bieżące środowisko ma **dostępne i działające** narzędzie symboliczne dla języka dotkniętego zadaniem.
- Jeśli tym narzędziem jest **Serena**, preferuj właśnie Serenę jako domyślną warstwę symboliczną.
- Jeśli tak:
  - preferuj je do orientacji w kodzie,
  - preferuj je także do lokalnych zmian symbolicznych, jeśli wspiera zapis zmian.
- Jeśli nie:
  - wróć do `rg`, odczytu plików i zwykłego patcha.
- Nie zakładaj obecności konkretnego narzędzia z nazwy; liczy się dostępność
  działającej warstwy, nie brand.

## 2a. Preflight Sereny
- Jeśli środowisko udostępnia Serenę, wykonaj krótki preflight przed szerokim odczytem kodu:
  - sprawdź, czy Serena jest dostępna w bieżącej sesji,
  - aktywuj projekt dla bieżącego repo, jeśli Serena tego wymaga,
  - potwierdź, że Serena potrafi odczytać symbole dla języka dotkniętego zadaniem.
- Jeśli którykolwiek krok preflightu Sereny nie powiedzie się:
  - zgłoś to krótko,
  - przejdź do fallbacku opisanego w tej polityce zamiast udawać pracę symboliczną.
- Nie powtarzaj preflightu Sereny bez potrzeby w każdej iteracji, jeśli aktywny
  projekt i działająca warstwa zostały już potwierdzone w tej samej sesji.

## 3. Bramka kosztowa
- Nie uruchamiaj warstwy symbolicznej dla banalnej zmiany tekstowej w pliku już wskazanym przez użytkownika, jeśli zwykły patch jest wyraźnie tańszy.
- Uruchom warstwę symboliczną, gdy zachodzi przynajmniej jedno:
  - trzeba znaleźć definicję, referencje, implementacje albo punkty wejścia,
  - istnieje ryzyko pomylenia symboli o tej samej nazwie,
  - zmiana dotyczy importów, namespace, eksportów, zależności między symbolami albo struktury klas/funkcji,
  - trzeba zawęzić odczyt do kilku symboli zamiast czytać całe pliki.

## 4. Macierz narzędzi
| Sytuacja                                                                                 | Domyślne narzędzie                                                       | Kiedy eskalować                                                 | Uwagi                                                 |
|------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|-----------------------------------------------------------------|-------------------------------------------------------|
| PHP: znaleźć kontroler, serwis, handler, port, definicję, referencje                     | Serena, jeśli dostępna; w przeciwnym razie inna warstwa symboliczna      | `rg` tylko do wstępnego zawężenia lub fallbacku                 | Domyślny read-path                                    |
| PHP: lokalnie zmienić metodę, klasę, rename symbolu, usunąć symbol                       | Serena, jeśli wspiera zapis; w przeciwnym razie inna warstwa symboliczna | zwykły patch, gdy zmiana jest banalna i jednoznaczna            | Domyślny write-path dla zmian symbolicznych           |
| PHP: move/copy class, rename z aktualizacją wielu referencji, transformacja wieloplikowa | wyspecjalizowany skill/narzędzie refactor                                | jeśli warstwa symboliczna nie ma stabilnej operacji wykonawczej | Dla PHP to zwykle operacje Phpactor/Rector            |
| TypeScript/JavaScript: znaleźć komponent, hook, util, referencje symbolu                 | Serena, jeśli dostępna; w przeciwnym razie inna warstwa symboliczna      | `rg` tylko pomocniczo                                           | Domyślny read-path                                    |
| TypeScript/JavaScript: lokalnie zmienić funkcję, klasę, import/eksport, metodę           | Serena, jeśli wspiera zapis; w przeciwnym razie inna warstwa symboliczna | zwykły patch przy prostej zmianie                               | Domyślny write-path dla zmian symbolicznych           |
| TypeScript/JavaScript: masowy rename, framework migration, codemod                       | dedykowany codemod / zwykły patch                                        | warstwa symboliczna tylko do zawężenia i weryfikacji            | Nie zakładaj, że symboliczna warstwa zastąpi codemod  |
| SCSS: znaleźć klasę, zmienną, mixin, partial, import, powiązany styl komponentu         | Serena, jeśli dostępna; w przeciwnym razie inna warstwa symboliczna      | `rg` tylko jako fallback albo szybkie zawężenie                 | Domyślny read-path dla niebanalnej orientacji         |
| SCSS: lokalna zmiana stylu, zmiennej, selektora                                          | Serena, jeśli trzeba dopiero zawęzić zakres; zwykły patch dla banalnej zmiany w już wskazanym miejscu | brak | Patch wygrywa tylko przy trywialnej, lokalnej zmianie |
| HTML/Twig: znaleźć template, block, include, użycie komponentu                           | `rg` + zwykły odczyt                                                     | warstwa symboliczna opcjonalnie                                 | Szukanie po ścieżkach i literalach jest zwykle tańsze |
| YAML/config/env/docs/tłumaczenia                                                         | `rg` + zwykły patch                                                      | brak                                                            | Warstwa symboliczna zwykle nie daje przewagi          |
| Runtime, DI, autowiring, logi, profiler                                                  | skill runtime/introspection                                              | po diagnozie wróć do symboli lub patcha                         | Najpierw dowód runtime, potem zmiana                  |

## 5. Relacja: warstwa symboliczna vs skill specjalistyczny
- Jeśli Serena jest dostępna, czytaj sekcję „warstwa symboliczna” jako „Serena”, chyba że konkretne środowisko ma inny, lepszy backend dla danego języka.
- Warstwa symboliczna służy przede wszystkim do:
  - zawężenia zakresu,
  - znalezienia definicji i referencji,
  - lokalnych zmian symbolicznych.
- Skill specjalistyczny albo dedykowane narzędzie służy przede wszystkim do:
  - operacji narzędziowych bezpieczniejszych niż ręczny patch,
  - zmian wieloplikowych,
  - transformacji AST/codemodów,
  - fallbacku, gdy warstwa symboliczna nie daje stabilnej operacji wykonawczej.

## 6. Fallback i raportowanie
- Jeśli warstwa symboliczna jest niedostępna albo niestabilna, powiedz to krótko
  i użyj fallbacku zamiast udawać pracę symboliczną.
- Jeśli wybierasz zwykły patch mimo dostępności warstwy symbolicznej, kieruj się kosztem: prostsza i bezpieczniejsza ścieżka wygrywa.
- W raporcie końcowym wystarczy krótko wskazać, dlaczego użyto:
  - warstwy symbolicznej,
  - zwykłego patcha,
  - narzędzia transformacyjnego,
  - albo diagnostyki runtime.
