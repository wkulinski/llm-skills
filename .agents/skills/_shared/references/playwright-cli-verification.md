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
`playwright-access-prepare.sh` (z `--protected` dla chronionej strony), a potem
otwórz osobną sesję aplikacji według sekcji „Kontrakt URL-a i chronionej
nawigacji”. Przy `Access: BLOCKED` nie nawiguj; zgłoś blokadę lub lukę
weryfikacji zgodnie z aktywnym skillem. Brak URL-a nie uprawnia do zgadywania.
`playwright-preflight.sh` i `playwright-auth-bootstrap.sh` są wewnętrznymi
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

Krok przygotowania uruchamia `playwright-preflight.sh`, a tylko z
`--protected` sprawdza istniejący state i w razie potrzeby wywołuje
`playwright-auth-bootstrap.sh`. `Access: READY` oznacza gotowość infrastruktury
i pliku state, **nie** dowód dostępu do chronionej strony: wynik sprawdź dopiero
po `state-load` i nawigacji. `Access: BLOCKED` oznacza, że nie należy nawigować.
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

1. **Stan istnieje** — gdy `PLAYWRIGHT_GUI_STORAGE_STATE` jest ważny albo pod
   domyślną ścieżką `.playwright-cli/auth/storage-state.json` istnieje ważny,
   ignorowany plik stanu, użyj go przez `state-load <filename>`. Waliduj samą
   ścieżkę, bez czytania zawartości: musi być repo-relative, po rozwiązaniu
   pozostać pod `.playwright-cli/auth/`, wskazywać `regular file` i przejść
   `git check-ignore`.
2. **Bootstrap** — gdy stanu brakuje, `PLAYWRIGHT_GUI_LOGIN_URL`,
   `PLAYWRIGHT_GUI_USER_LOGIN` i `PLAYWRIGHT_GUI_USER_PASSWORD` są kompletne, a
   host logowania jest loopback (`localhost`, `127.0.0.1`, `::1`), prepare
   uruchamia wewnętrznie `_shared/scripts/playwright-auth-bootstrap.sh`.
   Po `Authentication: OK` użyj zwróconej ścieżki stanu i dopiero wtedy wykonaj
   `state-load <filename>`. Bootstrap wymaga widocznego pola loginu, hasła i
   submittera, a przed podaniem credentiali sprawdza końcowy host strony oraz
   rzeczywisty cel wysyłki formularza (`formaction`/`action` z base URL);
   nierozpoznany formularz kończy się `Reason: form-not-recognized`. Odrzuca
   także symlinki katalogów state.
3. **Brak możliwości uwierzytelnienia** — w pozostałych przypadkach zgłoś
   `authentication unavailable`; nie przechodź do chronionego URL-a.

Wartości credentiali przechodzą wyłącznie przez helper bootstrapu w pamięci
procesu. Helper nie tworzy plików tymczasowych, nie wypisuje wartości
credentiali i nie zapisuje stanu poza `.playwright-cli/auth/`. Zawartości state,
credentiali ani sekretów nie wolno odczytywać, wypisywać, commitować ani
umieszczać w ogólnych argumentach CLI. Po pozytywnej walidacji przekaż CLI
wyłącznie zweryfikowaną nazwę pliku do `state-load <filename>`.
Ukrycie pola hasła jest sygnałem zakończenia formularza, a nie niezależnym
potwierdzeniem uwierzytelnienia; nie raportuj sukcesu aplikacji przed
checkpointem na chronionym URL-u.

Po `Access: READY` użyj oddzielnej, unikalnej sesji aplikacji. Przygotowanie
dostępu działa w osobnych procesach, więc sesja aplikacji ponownie rozwiązuje
CLI przez **ten sam resolver** `env-load.sh`/`resolve_tool_cmd`. Nigdy nie
wywołuj bezpośrednio `playwright-cli`, bo konfiguracja `BIN_PATH`-only przeszłaby
preflight, a checkpoint aplikacji nie uruchomiłby się:

```bash
. <skills_root>/_shared/scripts/env-load.sh
PW_CLI="$(resolve_tool_cmd playwright-cli playwright-cli)" || { printf 'CLI: MISSING\n'; exit 2; }
```

Otwórz bezpieczny pusty kontekst, a dla chronionego URL-a wykonaj kolejno
walidację, `state-load` i dopiero nawigację. `STATE_FILE` ustaw na dokładną,
repo-relative ścieżkę z `Storage state:` wypisaną przez prepare; dla publicznej
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
"$PW_CLI" -s="$APP_SESSION" goto "$RESOLVED_APPLICATION_URL"
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
