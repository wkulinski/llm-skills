---
name: dev-mate
description: >-
  Orkiestracja komend CLI AI Mate do diagnozy runtime i introspekcji aplikacji:
  analiza logów Monolog, profilera Symfony, listy serwisów DI oraz sanity
  checków środowiska przez entrypoint repo wyznaczony przez `resolve_tool_cmd`.
  Użyj, gdy trzeba zebrać ustrukturyzowane dowody przed implementacją, review
  albo analizą błędu.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/scripts/env-load.sh
---

# $dev-mate

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Użyć komend CLI AI Mate jako warstwy diagnostycznej do zbierania ustrukturyzowanych dowodów z logów, profilera, kontenera DI i środowiska uruchomieniowego. Skill ma pomóc przejść od potrzeby diagnostycznej do konkretnego zestawu komend, a potem do kolejnego kroku w repo.

## Intencje
Użyj tego skilla, gdy pojawia się potrzeba:
- zrozumienia ostatniego błędu runtime albo wyjątku bez ręcznego grep-owania wszystkich logów,
- powiązania problemu z konkretnym requestem, tokenem profilera, statusem HTTP albo route,
- sprawdzenia, czy serwis Symfony istnieje, jaki ma class albo czy kontener zbudował dany alias,
- potwierdzenia, czy problem wygląda na środowiskowy, a nie stricte kodowy,
- zebrania szybkich dowodów runtime przed wejściem w `$code-implement`, `$review-quick` albo zwykłe czytanie kodu.

## Źródło komend
1. Załaduj helper `env-load.sh` wskazany w `shared_files`.
2. Wyznacz `<MATE_CMD>` wyłącznie przez `resolve_tool_cmd mate`.
3. Jeśli potrzebujesz wrócić do standardowych entrypointów repo, wyznacz je tak samo przez `resolve_tool_cmd` zamiast ręcznie składać ścieżki z `BIN_PATH`.

## Zakres
Skill obejmuje:
- dobór właściwej komendy CLI AI Mate do potrzeby diagnostycznej,
- uruchomienie komendy z możliwie wąskim zakresem danych,
- interpretację wyniku w kontekście decyzji inżynierskiej,
- wskazanie następnego kroku w repo po zakończeniu diagnostyki.

## Minimalny workflow
1. Ustal, czy problem dotyczy runtime, a nie tylko statycznego kodu lub ścieżki pliku.
2. Jeśli nie znasz parametrów narzędzia, użyj `mcp:tools:inspect`.
3. Uruchom `mcp:tools:call` z możliwie wąskim zakresem danych.
4. Zawęź wynik i wróć do kodu, diffów lub dokumentacji z konkretnym tropem.

## Reguła wyboru narzędzi
- Jeśli pytanie dotyczy kodu statycznego, ścieżki pliku, symbolu, konfiguracji w repo albo diffu, najpierw użyj standardowych narzędzi repo.
- Jeśli pytanie dotyczy runtime, logów, requestu, profilera, skompilowanego kontenera albo środowiska wykonania, najpierw użyj komend AI Mate.
- Jeśli nie masz pewności, zacznij od najtańszego źródła prawdy i nie używaj AI Mate tylko „na wszelki wypadek”.

## Narzędzia bazowe
Jeśli nie znasz dostępnych narzędzi albo ich parametrów:
- użyj `<MATE_CMD> debug:extensions --show-all`, aby potwierdzić aktywne rozszerzenia,
- użyj `<MATE_CMD> mcp:tools:list`, aby zobaczyć listę narzędzi,
- użyj `<MATE_CMD> mcp:tools:inspect <tool-name>`, aby sprawdzić interfejs konkretnego narzędzia.

Preferuj wywołania:
- `<MATE_CMD> mcp:tools:call <tool-name> '<json>' --format=json`

Reguła wykonawcza:
- jeśli parametrów narzędzia nie da się bezpiecznie wywnioskować z prompta, najpierw użyj `mcp:tools:inspect`, a dopiero potem `mcp:tools:call`,
- jeśli wynik `mcp:tools:call` jest zbyt szeroki, nie powtarzaj tego samego wywołania bez zmian; zawęź parametry albo zmień scenariusz.

## Scenariusze

### 1. Błąd runtime lub wyjątek w logach
Sygnały użycia:
- użytkownik mówi o błędzie 500, wyjątku, ostrzeżeniu, regresji po requestach albo problemie widocznym w logach,
- masz fragment komunikatu błędu, poziom logu, kanał albo identyfikator z kontekstu logów.

Przykładowe wejścia:
- „sprawdź ostatnie błędy w logach”
- „przeszukaj logi po `AccessDeniedException`”
- „pokaż warningi z dev logów”
- „znajdź logi dla `request_id=...`”
- „czy w logach widać, czemu ten request wywala 500?”

Potrzeba:
- szybko zawęzić źródło problemu i zebrać dowody zanim zaczniesz zmieniać kod.

Kolejność narzędzi:
1. `monolog-list-files`, jeśli nie wiesz jeszcze, jakie logi są dostępne.
2. `monolog-tail`, jeśli chcesz zobaczyć najnowsze wpisy z danego środowiska.
3. `monolog-by-level`, jeśli znasz poziom logu, np. `error` albo `warning`.
4. `monolog-search`, jeśli masz tekst błędu, nazwę wyjątku, fragment komunikatu albo route.
5. `monolog-search-regex`, jeśli wzorzec jest nieregularny i zwykły search daje zbyt dużo szumu.
6. `monolog-context-search`, jeśli masz `request_id`, `tenant_id`, `user_id` albo inny klucz kontekstowy.

Jak zawężać wynik:
- jeśli użytkownik podał `request_id`, `tenant_id`, `user_id` albo inny klucz kontekstowy, preferuj `monolog-context-search` przed pełnym search tekstowym,
- ustaw `environment`, gdy wiesz, którego środowiska dotyczy problem,
- ustaw `channel`, `level` i `limit`, żeby nie zalewać kontekstu,
- preferuj najpierw wąskie zapytanie, a dopiero potem poszerzaj zakres.

Co zrobić z wynikiem:
- wyłuskaj stabilne fakty: typ błędu, miejsce wystąpienia, request/context identifiers, powtarzalność,
- jeśli wynik wskazuje konkretny request lub token profilera, przejdź do scenariusza „Profiler Symfony”,
- jeśli wynik wskazuje konkretną klasę, handler, komendę albo serwis, wróć do kodu i potwierdź to przez `rg`, diff lub odczyt pliku.
- jeśli wynik jest pusty, sprawdź najpierw środowisko logów (`environment`, `channel`, `level`) zamiast od razu zakładać, że problem nie wystąpił.

### 2. Analiza requestu i danych z profilera
Sygnały użycia:
- problem dotyczy konkretnego requestu HTTP, statusu odpowiedzi, route, czasu wykonania albo wyjątków z web profilu,
- chcesz potwierdzić zachowanie aplikacji po realnym wywołaniu zamiast wnioskować tylko z kodu.

Przykładowe wejścia:
- „sprawdź ostatni request w profilerze”
- „znajdź w profilerze requesty do `/login` z 500”
- „przeanalizuj profil dla tego tokena”
- „zobacz, co profiler pokazuje dla ostatniego błędu”
- „sprawdź ostatnie profile dla POST-a na ten endpoint”

Potrzeba:
- zobaczyć, co faktycznie wydarzyło się w request/response cycle i czy profiler ma już ślad problemu.

Kolejność narzędzi:
1. `symfony-profiler-latest`, gdy chcesz ostatni request.
2. `symfony-profiler-search`, gdy znasz route, metodę, status albo zakres czasu.
3. `symfony-profiler-list`, gdy chcesz szybko przejrzeć kilka ostatnich profili i wybrać właściwy.
4. `symfony-profiler-get`, gdy masz token i chcesz dane jednego konkretnego profilu.

Jak zawężać wynik:
- użyj `route`, `method`, `statusCode`, `from`, `to` i `limit`,
- jeśli masz token z wcześniejszej analizy, przejdź od razu do `symfony-profiler-get`.

Co zrobić z wynikiem:
- ustal, czy problem jest odtwarzalny i który profil jest właściwym punktem odniesienia,
- potraktuj `resource_uri` jako wskaźnik do dalszej analizy, ale decyzje nadal opieraj na danych zwróconych przez tool i kodzie repo,
- jeśli profiler pokazuje wyjątek, request metadata albo kolektor prowadzący do konkretnego obszaru, wróć do kodu i dokumentacji tego obszaru.
- jeśli profiler nic nie zwraca, potraktuj to jako sygnał do sprawdzenia, czy problem był faktycznie odtworzony w środowisku z aktywnym profilerem.

### 3. Introspekcja kontenera i zależności DI
Sygnały użycia:
- problem dotyczy braku serwisu, aliasu, autowiringu, dekoratora, tagów albo podejrzanego wiring-u kontenera,
- użytkownik pyta, czy dany serwis istnieje albo jaka klasa stoi za danym service id.

Przykładowe wejścia:
- „czy serwis `foo.bar` istnieje w kontenerze?”
- „jaką klasę ma ten service id?”
- „sprawdź, czy kontener zbudował alias dla tej usługi”
- „czy ten handler jest widoczny w DI?”
- „pokaż, czy autowiring ma tu z czego skorzystać”

Potrzeba:
- potwierdzić stan skompilowanego kontenera bez zgadywania na podstawie samych plików konfiguracyjnych.

Narzędzie:
1. `symfony-services`

Jak używać:
- używaj tego narzędzia tylko wtedy, gdy pytanie dotyczy faktycznie skompilowanego kontenera, a nie samego znalezienia definicji w repo,
- preferuj format JSON, bo narzędzie może zwrócić bardzo szeroką listę,
- po otrzymaniu wyniku filtruj po stronie agenta do konkretnego service id, namespace albo klasy i do rozmowy wnoś tylko zawężony fragment,
- gdy pytanie dotyczy wyłącznie znalezienia definicji usługi, rozważ najpierw zwykły odczyt repo, a `symfony-services` użyj jako potwierdzenia runtime.

Co zrobić z wynikiem:
- ustal, czy serwis istnieje i jaką ma klasę,
- potraktuj wynik jako dowód stanu kontenera, a nie jako zamiennik definicji w repo,
- po znalezieniu serwisu wróć do `config/`, `services.yaml`, atrybutów albo definicji klas i potwierdź przyczynę problemu.

### 4. Szybki sanity check środowiska Mate
Sygnały użycia:
- problem wygląda na środowiskowy,
- chcesz potwierdzić wersję PHP, dostępność rozszerzeń albo podstawowe informacje o runtime przed dalszą diagnozą.

Przykładowe wejścia:
- „sprawdź wersję PHP w runtime”
- „czy to środowisko ma potrzebne extensiony?”
- „jaki to system i na czym to chodzi?”
- „potwierdź, czy problem nie wynika z runtime”

Potrzeba:
- odróżnić problem aplikacyjny od problemu środowiskowego możliwie małym kosztem.

Kolejność narzędzi:
1. `php-version`
2. `php-extensions`
3. `operating-system`
4. `operating-system-family`

Co zrobić z wynikiem:
- jeśli wynik potwierdza podejrzenie środowiskowe, wróć do entrypointów repo, kontenerów i konfiguracji,
- jeśli środowisko wygląda poprawnie, zawęź diagnozę do logów, profilera albo kodu.

## Zasady interpretacji
- Komendy AI Mate dostarczają dowody runtime i introspekcji, ale nie zastępują czytania kodu, diffów i dokumentacji.
- Każdy wniosek mapuj do konkretnego problemu: log/error, request/profile, serwis/DI albo środowisko.
- Gdy wynik jest pusty, zbyt szeroki albo nie rozstrzyga problemu, zawęź parametry albo wróć do standardowego workflow repo.

## Następny krok po użyciu skilla
Po zebraniu danych z komend AI Mate zawsze wybierz jedno z działań:
- wróć do kodu i dokumentacji, jeśli masz już konkretny obszar do zbadania,
- przejdź do `$code-implement`, jeśli diagnoza wskazała potrzebną zmianę,
- przejdź do `$review-quick`, jeśli diagnoza dotyczy oceny ryzyka lub regresji,
- wróć do zwykłych entrypointów repo wyznaczonych przez `resolve_tool_cmd`, jeśli problem wymaga dalszej pracy poza AI Mate.

## Format odpowiedzi
- Wynik: co udało się ustalić.
- Dowody: jakie narzędzia i parametry zostały użyte.
- Następny krok: co zrobić dalej na podstawie otrzymanych danych.
