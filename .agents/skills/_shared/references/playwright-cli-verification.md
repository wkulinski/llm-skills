# Weryfikacja przez Playwright CLI

Wspólny kontrakt weryfikacji przeglądarkowej dla skilli: preflight, bezpieczna
sesja, dowody i artefakty. Nie zawiera reguł estetycznych, wzorców UI ani
polityki spójności wizualnej — te pozostają w skillach domenowych.

## Cel

Playwright CLI dostarcza trzy różne rodzaje dowodu:

- **snapshot** — struktura, role, nazwy, stany i stabilne refs,
- **screenshot** — rzeczywisty wygląd i ocena optyczna,
- **eval/run-code** — konkretne wartości i diagnostyka.

Żadne z nich nie zastępuje pozostałych.

## Routing dla skilli

Ta referencja jest jednym źródłem prawdy dla **każdego** skilla lub agenta,
który zdecyduje się na checkpoint renderowanego UI (implementacja, szybki lub
pełny review). Skill decyduje **czy** checkpoint jest potrzebny i jakie
interakcje wolno wykonać; nie tworzy własnej ścieżki uruchomienia Playwright.
Po ustaleniu bezpiecznego URL-a wykonaj tylko
`<skills_root>/_shared/scripts/playwright-access-prepare.sh` (z `--protected`
dla chronionej strony), a potem
otwórz osobną sesję aplikacji według sekcji „Kontrakt URL-a i chronionej
nawigacji”. `Access: ACTION_REQUIRED` przekazuje dodatkowe, niesekretne kroki
logowania agentowi; potem ten sam entrypoint przyjmuje `--stage --session`
oraz, po ponownej ocenie w świeżej sesji, `--promote --candidate --evidence`.
Przy `Access: BLOCKED` nie nawiguj; zgłoś blokadę lub lukę
weryfikacji zgodnie z aktywnym skillem. Brak URL-a nie uprawnia do zgadywania.
`<skills_root>/_shared/scripts/playwright-preflight.sh` i
`<skills_root>/_shared/scripts/playwright-auth-bootstrap.sh` są wewnętrznymi
krokami prepare, a nie alternatywnymi instrukcjami dla agenta. Nie przekazuj
credentiali do `fill` ani argumentów CLI; nie używaj własnego helpera,
bezpośredniego SDK lub innego entrypointu zamiast tego kontraktu.

## Źródło prawdy dla składni

Aktualność składni jest sprawdzana przez `--help` wykonane na resolved CLI w
obowiązkowym helperze poniżej. Nie używaj alternatywnego prefiksu ani
oficjalnego skilla Playwright i nie zakładaj opcji niewymienionej przez aktualne
`--help`.

## Preflight

Preflight jest obowiązkowy i wykonywalny. Przed odkryciem, audytem i edycją
renderowanego UI użyj jednego kroku przygotowania dostępu (przy znanym
chronionym URL-u dodaj `--protected`):

```bash
bash <skills_root>/_shared/scripts/playwright-access-prepare.sh
# Dla znanego chronionego URL-a zamiast powyższego:
bash <skills_root>/_shared/scripts/playwright-access-prepare.sh --protected
```

Krok przygotowania uruchamia
`<skills_root>/_shared/scripts/playwright-preflight.sh`, a tylko z
`--protected` przygotowuje prywatnego kandydata i w razie potrzeby wywołuje
`<skills_root>/_shared/scripts/playwright-auth-bootstrap.sh`. Dla publicznej
strony `Access: READY` oznacza gotową infrastrukturę. Przygotowanie chronionej
strony zawsze zwraca `Access: ACTION_REQUIRED`, nie potwierdzone uwierzytelnienie.
`Access: VERIFY_REQUIRED` oznacza zapis kandydata wymagający ponownej oceny
agenta. Dopiero promocja zwraca `Access: READY`: dowód agenta i techniczne
sprawdzenie odtworzonego stanu, nie checkpoint badanego widoku.
`Access: BLOCKED` zabrania dalszej nawigacji.
Gdy preflight działa przez CDP, ale nie ma lokalnej przeglądarki do bootstrapu,
raportuj `browser-unavailable` zamiast próbować ręcznego logowania.

Helper preflightu ładuje `<skills_root>/_shared/scripts/env-load.sh`, raz rozwiązuje CLI
przez `resolve_tool_cmd playwright-cli playwright-cli` i wykonuje `--help` na
tym samym resolved command. Dopiero po poprawnej walidacji tworzy unikalną
sesję, wykonuje `open about:blank --browser=chromium` i `close` albo — gdy
ustawiono `PLAYWRIGHT_MCP_CDP_ENDPOINT` — `attach --cdp` i `detach`, oraz
raportuje wynik sprzątania. Nie instaluje przeglądarki, nie loguje się i nie
wypisuje wartości CDP, outputu CLI ani innych sekretów. Nie zapisuje artefaktów
w repozytorium.

Interpretacja wyniku (stdout):

```text
CLI: OK|MISSING|INVALID
Browser mode: local-chromium|cdp-attach
Browser launch: OK|FAIL
Browser cleanup: OK|FAIL|NOT_REQUIRED
```

`Browser mode`, `Browser launch` i `Browser cleanup` są raportowane po
poprawnym `--help`. Przy braku resolved CLI (`CLI: MISSING`) albo nieudanym
`--help` (`CLI: INVALID`) uruchomienie/attach nie następuje, a cleanup ma stan
`NOT_REQUIRED`.

Kody wyjścia rozróżniają etap niepowodzenia:

| Kod | Znaczenie | Blokada zadania |
|---|---|---|
| 0 | `--help`, launch/attach i cleanup zakończyły się sukcesem | brak |
| 2 | `CLI: MISSING` — nie udało się rozwiązać CLI, albo `CLI: INVALID` — resolved CLI odrzuciło `--help`; launch/attach nie wykonano, cleanup `NOT_REQUIRED` | zadanie zablokowane przed analizą i edycją |
| 3 | `Browser launch: FAIL` — CLI przeszło `--help`, ale uruchomienie lub `attach` nie powiodło się; kod zachowuje pierwszeństwo także przy `Browser cleanup: FAIL` | zadanie zablokowane przed analizą i edycją |
| 4 | launch/attach zakończył się sukcesem, ale `Browser cleanup: FAIL` | zadanie zablokowane przed analizą i edycją |

Jeżeli WSL nie ma lokalnej przeglądarki, użyj skonfigurowanego CDP albo przerwij
zadanie. Brak CLI, browsera lub działającego CDP blokuje zadanie przed analizą i
edycją. Dokładny komunikat blokady zgłoś w raporcie. Poza WSL błąd uruchomienia
browsera również blokuje zadanie.

## Kontrakt URL-a i chronionej nawigacji

Najpierw rozwiąż URL aplikacji bez zgadywania trasy: jawny URL z promptu lub
zadania ma pierwszeństwo, potem `PLAYWRIGHT_GUI_BASE_URL`, a przy braku obu
zapytaj użytkownika albo zgłoś blokadę. Nie używaj domyślnego `localhost`.
`PLAYWRIGHT_GUI_LOGIN_URL` nie jest fallbackiem URL-a aplikacji. Jest adresem
logowania używanym wyłącznie przez współdzielony helper bootstrapu razem z
`PLAYWRIGHT_GUI_USER_LOGIN` i `PLAYWRIGHT_GUI_USER_PASSWORD`.

Jeśli chroniony URL wymaga storage state, wykonaj przygotowanie z
`--protected`. Wewnątrz helpera obowiązuje kolejność:

1. **Istniejący stan** — kanoniczny plik pochodzi z `PLAYWRIGHT_GUI_STORAGE_STATE`
   albo `.playwright-cli/auth/storage-state.json`. Musi być regular file — zwykłym,
   ignorowanym plikiem pod `.playwright-cli/auth/`, bez symlinków pliku i katalogów,
   i przechodzić `git check-ignore`.
    Helper zawsze tworzy prywatną kopię `candidate-<uuid>.json` z uprawnieniami
    `0600`, zwraca `Authentication: ACTION_REQUIRED`, `Candidate state:` oraz
    `Access: ACTION_REQUIRED`. Nie uruchamia weryfikacji ani logowania dla
    istniejącego bezpiecznego stanu; same metadane nie dowodzą dostępu.
2. **Bootstrap/odnowienie** — gdy stanu brakuje lub agent
   jawnie używa `--protected --refresh`, prepare uruchamia wewnętrznie
   `<skills_root>/_shared/scripts/playwright-auth-bootstrap.sh`; helper wykonuje
   najwyżej jedną próbę podania credentiali. Wymaga kompletnych ustawień loginu
   i hosta loopback
   (`localhost`, `127.0.0.1`, `::1`); sprawdza rzeczywisty cel formularza przed
   wypełnieniem. Brak przeglądarki nie jest interpretowany jako wygasła sesja.
   Ukrycie pola hasła kończy tylko etap credentiali. Helper zapisuje unikalny
    plik `candidate-*.json` z uprawnieniami `0600`, zwraca `Candidate state:`
   i `Access: ACTION_REQUIRED`, nigdy nie nadpisuje wtedy kanonicznego pliku.
   `Continuation URL:` wskazuje stronę po wysłaniu formularza, bez query i
   fragmentu mogących zawierać tokeny. Nie zgaduj brakujących tokenów; przepływ
   wymagający ich do kontynuacji wymaga jawnego adaptera lub decyzji użytkownika.
3. **Interakcja agenta** — w osobnej sesji załaduj wskazany candidate state
   i otwórz jawny `Continuation URL:`; przy kopii istniejącego stanu bez tego
   adresu otwórz rozwiązany URL aplikacji. Agent może oglądać DOM i dokończyć
   niesekretne kroki wymagane przez aplikację, np. wybór właściwego kontekstu
   pracy. Wybór pochodzi wyłącznie z zadania; przy niejednoznaczności zapytaj
   użytkownika — nigdy nie wybieraj arbitralnie. Nie zatwierdzaj nieznanych
   zgód, aktywacji lub zmian uprawnień. Brak dodatkowego kroku również prowadzi
    do zapisu i ponownej oceny. Agent zawsze ocenia rzeczywisty widok aplikacji,
    nie sam brak pola hasła. Po ponownym użyciu stanu potwierdź, że kontekst odpowiada
   zadaniu, zanim odczytasz dane lub wykonasz działania. `Access: READY`
    po promocji nie zastępuje tej decyzji domenowej.
   Przy niezgodnym kontekście nie używaj stanu do pracy w aplikacji: odnowienie
   przez `--protected --refresh` pozwala dokończyć właściwy wybór.
4. **Zapis kandydata** — po ocenie dostępu i właściwego kontekstu uruchom
    ten sam entrypoint na nadal otwartej sesji agenta:

   ```bash
    bash <skills_root>/_shared/scripts/playwright-access-prepare.sh --stage --session "$APP_SESSION"
   ```

    `--stage` zapisuje stan sesji przez resolved CLI do nowego, ignorowanego
    `candidate-<uuid>.json` z uprawnieniami `0600`. Zwraca
    `Authentication: ACTION_REQUIRED`, `Candidate state:` i `Access: VERIFY_REQUIRED`.
    Nie sprawdza dostępu i nie promuje pliku; kanoniczny stan pozostaje nietknięty.
5. **Ponowna ocena i promocja** — zamknij lub odłącz pierwszą sesję. Obowiązkowo
    otwórz świeżą, izolowaną sesję agenta z unikalną nazwą, bez odziedziczonych
    cookies i profilu pierwszej sesji. Załaduj dokładny plik z ostatniego
    `Candidate state:` przed nawigacją do rozwiązanego URL-a aplikacji, zgodnie
    z lifecycle poniżej. Sam nowy identyfikator sesji nie dowodzi izolacji;
    nie używaj współdzielonego kontekstu CDP. Jeśli środowisko nie zapewnia
    izolacji, zgłoś blokadę zamiast promować.
    Agent ponownie ocenia rzeczywisty dostęp oraz zgodność kontekstu z zadaniem
    na podstawie widoku, snapshotu i stosownych dowodów. Nie zastępuj oceny
    oświadczeniem „kliknięte” ani samym brakiem pola hasła. Zapisz niepusty,
    niesekretny opis obserwacji z tej drugiej sesji w `ACCESS_EVIDENCE`, np.
    „Świeża izolowana sesja odtwarza widok zadania w wymaganym kontekście”.
    Dopiero po pozytywnej ocenie wykonaj:

    ```bash
    bash <skills_root>/_shared/scripts/playwright-access-prepare.sh --promote --candidate "$STATE_FILE" --evidence "$ACCESS_EVIDENCE" --url "$RESOLVED_APPLICATION_URL"
    ```

    `STATE_FILE` jest tutaj kandydatem zwróconym przez `--stage`, nigdy plikiem
    kanonicznym. Helper odrzuca również alias ścieżki i hardlink do celu.
    Brak niepustego dowodu zwraca `Reason: evidence-missing`. Dowód nie może
    zawierać sekretów ani danych wrażliwych, również w argumentach; redakcja
    znanych credentiali w output nie uprawnia do przekazywania ich w dowodzie.
    Helper wykonuje `verifyStateAccess` w kolejnym świeżym kontekście i odrzuca
    HTTP 4xx/5xx, inny origin, widoczne pole hasła oraz powrót na login rozpoznany
    po origin i pathname (nie query/fragment). Nie ocenia pozytywnie treści
    widoku — ta odpowiedzialność należy do agenta. Po sukcesie atomowo
    zastępuje plik kanoniczny i zwraca `Authentication: OK`, `Storage state:`,
    zredagowane `Evidence:` i `Access: READY`; zużyty kandydat zostaje usunięty.
    Nieudane sprawdzenie zachowuje dotychczasowy plik kanoniczny i usuwa
    odrębnego kandydata promocji; wynik to `Access: BLOCKED`. Odmowa podania
    pliku kanonicznego jako kandydata nie zmienia go ani nie usuwa.
6. **Brak dostępu** — jeśli agent zobaczy ponownie login, zamknij jego sesję
   i wykonaj jeden `--protected --refresh` przez ten sam entrypoint. Nie twórz
   pętli ponowień. Kolejny brak dostępu, wygaśnięcie kroku pośredniego lub brak
    credentiali to jawna blokada. Po zamknięciu sesji usuwaj własne, odrębne
    pliki `candidate-*.json` pozostałe po zakończonym lub porzuconym przepływie;
    nie usuwaj stanów kanonicznych ani plików innych równoległych zadań.

Wartości credentiali przechodzą wyłącznie przez helper bootstrapu w pamięci
procesu. Helper nie zapisuje credentiali w plikach tymczasowych, nie wypisuje wartości
credentiali i nie zapisuje stanu poza `.playwright-cli/auth/`. Agentowi nie wolno
odczytywać zawartości state, credentiali ani sekretów, wypisywać ich, commitować ani
umieszczać w ogólnych argumentach CLI. Po walidacji metadanych przekaż CLI
wyłącznie bezpieczną nazwę pliku do `state-load <filename>`.
Wyłącznie helper może wewnętrznie kopiować stan i przekazywać go bibliotece
Playwright do odtworzenia; nie przekazuje jego zawartości agentowi ani do logów.
Ukrycie pola hasła jest sygnałem zakończenia formularza, a nie niezależnym
potwierdzeniem uwierzytelnienia; nie raportuj sukcesu aplikacji przed
checkpointem na chronionym URL-u.

Po `Access: READY`, `Access: ACTION_REQUIRED` albo `Access: VERIFY_REQUIRED` użyj oddzielnej, unikalnej
sesji aplikacji. Przygotowanie
dostępu działa w osobnych procesach, więc sesja aplikacji ponownie rozwiązuje
CLI przez **ten sam resolver** `env-load.sh`/`resolve_tool_cmd`. Nigdy nie
wywołuj bezpośrednio `playwright-cli`, bo konfiguracja `BIN_PATH`-only przeszłaby
preflight, a checkpoint aplikacji nie uruchomiłby się:

```bash
. <skills_root>/_shared/scripts/env-load.sh
ensure_repo_env_loaded
PW_CLI="$(resolve_tool_cmd playwright-cli playwright-cli)" || { printf 'CLI: MISSING\n'; exit 2; }
```

Samo `source` definiuje funkcje, ale nie ładuje env. Resolver wywołany wewnątrz
`$(...)` ładuje env tylko w podpowłoce, więc nie dostarcza URL-i do powłoki
agenta. `ensure_repo_env_loaded` przed sprawdzeniem URL-a jest obowiązkowe.
Jawny URL zadania przekaż także helperowi jako `--url "$RESOLVED_APPLICATION_URL"`;
ta opcja ma pierwszeństwo przed URL-em z env przy prepare i promocji.

Otwórz bezpieczny pusty kontekst, a dla chronionego URL-a wykonaj kolejno
walidację, `state-load` i dopiero nawigację. `STATE_FILE` ustaw na dokładną,
repo-relative ścieżkę z `Storage state:` lub ostatniego `Candidate state:` wypisaną
przez prepare albo stage; dla publicznej
strony pomiń wiersz `state-load`. Poniższy schemat pokazuje chronioną nawigację
(placeholdery nie są wartościami domyślnymi):

```bash
APP_SESSION="ui-review-<task>-application"
if [[ -n "${PLAYWRIGHT_MCP_CDP_ENDPOINT:-}" ]]; then
    "$PW_CLI" -s="$APP_SESSION" attach --cdp="$PLAYWRIGHT_MCP_CDP_ENDPOINT"
else
    "$PW_CLI" -s="$APP_SESSION" open about:blank --browser=chromium
fi
# Po walidacji metadanych state, bez odczytywania jego zawartości:
"$PW_CLI" -s="$APP_SESSION" state-load "$STATE_FILE"
# Tylko po udanym state-load; URL został wcześniej jawnie rozwiązany.
# Dla ACTION_REQUIRED bootstrapu wznów jawny Continuation URL zamiast URL aplikacji.
if [[ "${ACCESS_STATUS:-}" == ACTION_REQUIRED && -n "${CONTINUATION_URL:-}" ]]; then
    "$PW_CLI" -s="$APP_SESSION" goto "$CONTINUATION_URL"
else
    "$PW_CLI" -s="$APP_SESSION" goto "$RESOLVED_APPLICATION_URL"
fi
# Przy ACTION_REQUIRED: oceń widok, wykonaj dozwolone kroki i --stage
# PRZED close/detach. Potem powtórz lifecycle w świeżej izolowanej sesji
# z kandydatem stage: ponowna ocena i --promote z dowodem, bez kroków logowania.
# Przy VERIFY_REQUIRED nie używaj współdzielonego CDP; potwierdź izolację.
# Checkpoint badanego widoku dopiero po Access: READY.
# Wykonaj także po błędzie walidacji, ładowania lub nawigacji.
if [[ -n "${PLAYWRIGHT_MCP_CDP_ENDPOINT:-}" ]]; then
    "$PW_CLI" -s="$APP_SESSION" detach
else
    "$PW_CLI" -s="$APP_SESSION" close
fi
```

Błąd `state-load` klasyfikuj jako `authentication unavailable`. Agent nie
wykonuje ręcznego `fill` z wartościami credentiali ani innego automatycznego
logowania. Sesja preflightu jest własnością helpera i helper ją sprząta; sesję
aplikacji właściciel checkpointu zawsze kończy przez `close` albo `detach`.

## Profile weryfikacji

Zakres wynika z profilu zadania przyjętego przez skill konsumujący:

- **minimalny** — jeden viewport i zmieniony stan,
- **standardowy** — mobile + desktop, before/after i najważniejsze stany,
- **rozszerzony** — pełna adekwatna macierz, lifecycle, re-render, visual regression lub trace.

## Sesja

Wszystkie komendy sesji wykonuj przez `"$PW_CLI"` rozwiązane w kontrakcie
powyżej; bezpośrednie `playwright-cli` jest niedozwolone. Używaj unikalnej nazwy
dla sesji checkpointu aplikacji. Sekwencja otwarcia pustego kontekstu, opcjonalnego
`state-load`, nawigacji i sprzątania jest opisana wyłącznie w sekcji „Kontrakt
URL-a i chronionej nawigacji”; nie otwieraj URL-a aplikacji jako pierwszej
komendy sesji. Do dalszych przykładów przypisz tę samą nazwę:

```bash
SESSION="$APP_SESSION"
```

`RESOLVED_APPLICATION_URL` musi pochodzić z jawnego URL-a zadania albo z
`PLAYWRIGHT_GUI_BASE_URL` zgodnie z kontraktem powyżej; nie zastępuj go zgadywaną
trasą.

Po zmianie DOM pobierz nowy snapshot; refs mogą być nieaktualne. Sesję zakończ
przez `close` lub `detach` zgodnie z trybem preflightu i sekwencją powyżej.

Nie używaj wspólnej sesji, gdy inne procesy mogą pracować równolegle.

## Artefakty i bezpieczeństwo

Preferuj istniejący katalog projektu. Jeśli go nie ma, użyj:

```text
.playwright-cli/ui-review/<zadanie>/
```

Przed zapisem sprawdź, czy katalog jest ignorowany przez Git. Screenshoty, trace i video nie powinny trafiać do repozytorium, chyba że są świadomie utrzymywanym baseline'em.

Jeżeli katalog artefaktów w repozytorium nie jest potwierdzony jako ignorowany,
nie zmieniaj automatycznie `.gitignore`. Użyj zatwierdzonego katalogu
tymczasowego poza repozytorium, np.
`${TMPDIR:-/tmp}/opencode/playwright/<zadanie>/`, po uprzednim sprawdzeniu jego
rodzica. Uruchamiaj całą sesję `playwright-cli` z tym katalogiem jako katalogiem
roboczym, aby także automatyczne snapshoty i logi konsoli pozostały poza repo.
Nie pozostawiaj artefaktów jako nieśledzonych plików repo.

Storage state i profile przechowuj pod ignorowanym `.playwright-cli/auth/`. Nie zapisuj sekretów, danych produkcyjnych ani PII w artefaktach.

W `execution_mode: advisory` wolno wykonać bootstrap logowania opisany
w „Kontrakcie URL-a i chronionej nawigacji” i zapisać storage state w
ignorowanym `.playwright-cli/auth/`; logowanie i stan sesji są przygotowaniem
dostępu, a nie zmianą danych. Nie wykonuj operacji zmieniających dane biznesowe
lub konfigurację aplikacji. Dopuszczalne są niemutujące interakcje potrzebne do
obejrzenia widoku, np. przełączenie zakładki, rozwinięcie panelu lub zmiana
viewportu, o ile nie zapisują danych.

## Stabilny stan porównawczy

Przed screenshotem zapewnij w miarę możliwości:

- te same dane, URL i stan interakcji,
- ten sam viewport, DPR, zoom, motyw i pozycję scrolla,
- tę samą lokalizację/strefę czasową, jeśli wpływa na UI,
- zakończone ładowanie, Live update i animacje,
- załadowane fonty,
- zamknięte przypadkowe tooltipy i dropdowny,
- jednakowe ustawienie reduced motion.

Możesz sprawdzić środowisko:

```bash
"$PW_CLI" -s="$SESSION" eval "() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY, dark: matchMedia('(prefers-color-scheme: dark)').matches, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })"
```

Przed screenshotem wymagającym stabilnych fontów użyj:

```bash
"$PW_CLI" -s="$SESSION" eval "async () => { await document.fonts.ready; return true; }"
```

## Snapshot

```bash
"$PW_CLI" -s="$SESSION" snapshot --depth=5
```

Używaj refs, ról lub stabilnych selektorów. Nie używaj starych refs po nawigacji lub re-renderze.

## Screenshot

Viewport lub element:

```bash
"$PW_CLI" -s="$SESSION" screenshot --filename=.playwright-cli/ui-review/zadanie/cel-przed.png
"$PW_CLI" -s="$SESSION" screenshot e42 --filename=.playwright-cli/ui-review/zadanie/komponent-po.png
```

Pełna strona jest wyjątkiem. Użyj aktualnej opcji CLI:

```bash
"$PW_CLI" -s="$SESSION" screenshot --full-page --filename=.playwright-cli/ui-review/zadanie/strona-po.png
```

Dla analizy komponentu preferuj element i viewport; pełna strona pomaga tylko wtedy, gdy ważny jest kontekst layoutu.

## Computed styles

Odczytuj tylko właściwości istotne dla problemu:

```bash
"$PW_CLI" -s="$SESSION" eval "(el) => { const s = getComputedStyle(el); return { padding: s.padding, gap: s.gap, border: s.border, borderRadius: s.borderRadius, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, color: s.color, backgroundColor: s.backgroundColor, alignItems: s.alignItems, justifyContent: s.justifyContent }; }" e42
```

Screenshot odpowiada „jak wygląda”, computed styles pomagają odpowiedzieć „dlaczego”.

## Baseline przed zmianą

Wykonaj przed edycją, gdy stan można uruchomić. Nazwa powinna wskazywać zadanie, stan i viewport. Jeśli baseline jest niemożliwy, zanotuj przyczynę; nie rekonstruuj go po fakcie.

## Viewporty

Dobieraj zgodnie z profilem i projektem. Typowa macierz rozszerzona:

```bash
"$PW_CLI" -s="$SESSION" resize 390 844
"$PW_CLI" -s="$SESSION" resize 1024 768
"$PW_CLI" -s="$SESSION" resize 1440 900
```

Dla zgłoszonej regresji sprawdź szerokość zgłoszenia oraz przynajmniej jeden sąsiedni zakres.

## Konsola i requesty

Aktualne CLI nie musi posiadać komendy czyszczącej historię konsoli. Nie używaj nieudokumentowanego `console --clear`.

Zamiast tego:

1. użyj unikalnej sesji,
2. zapisz błędy zastane przed scenariuszem,
3. wykonaj scenariusz,
4. ponownie odczytaj konsolę i requesty,
5. raportuj nowe błędy oraz istotne błędy zastane oddzielnie.

```bash
"$PW_CLI" -s="$SESSION" console error
"$PW_CLI" -s="$SESSION" requests
```

Przy trudnym błędzie użyj tracingu zgodnie z aktualnym `--help`.

## Workflow before/after

### Przed

1. Otwórz stronę i stabilny stan.
2. Ustaw viewport i środowisko.
3. Zapisz stan konsoli.
4. Wykonaj snapshot i screenshot before.
5. Dla transferu wykonaj screenshot wzorca.
6. Odczytaj tylko potrzebne styles.

### Po

1. Odtwórz identyczny stan.
2. Pobierz nowy snapshot.
3. Wykonaj screenshot after.
4. Porównaj before/after; porównaj wzorzec, jeśli został wybrany i odtworzony.
5. Sprawdź stany i interakcje właściwe dla profilu.
6. Porównaj konsolę i requesty.
7. Zakończ adekwatną weryfikację Playwright zgodnie z profilem.

## Live Components i Stimulus

Po re-renderze pobierz nowy snapshot. Sprawdź focus, ARIA, loading/pending, ponowne działanie kontrolera i brak duplikacji efektów ubocznych. Dla interakcji dobierz mysz, klawiaturę, Escape, kliknięcie poza elementem i szybkie akcje tylko wtedy, gdy wynikają z funkcji komponentu.

## Visual regression

Nie aktualizuj baseline'u tylko po to, by weryfikacja przeszła. Najpierw obejrzyj różnicę i ustal, czy jest zamierzona. Baseline utrzymuj w repozytorium tylko wtedy, gdy projekt świadomie traktuje go jako test.

## Human review

Jeżeli decyzja estetyczna jest niejednoznaczna, można opcjonalnie użyć wizualnego dashboardu lub anotacji udostępnianej przez aktualną wersję CLI. Nie uruchamiaj tego automatycznie przy zwykłej poprawce i nie zgaduj preferencji użytkownika.

## Review repozytorium

Po zakończeniu:

```bash
git diff --check
git diff --stat
git status --short
```

Sprawdź, czy artefakty, storage state, debug code, niepowiązane formatowanie i sekrety nie trafiły do zmian.
