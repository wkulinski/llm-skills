# Weryfikacja przez Playwright CLI

## Cel

Playwright CLI dostarcza trzy różne rodzaje dowodu:

- **snapshot** — struktura, role, nazwy, stany i stabilne refs,
- **screenshot** — rzeczywisty wygląd i ocena optyczna,
- **eval/run-code** — konkretne wartości i diagnostyka.

Żadne z nich nie zastępuje pozostałych.

## Źródło prawdy dla składni

Przed użyciem sprawdź aktualne polecenia:

```bash
playwright-cli --help
```

Nie używaj alternatywnego prefiksu ani oficjalnego skilla Playwright. Jeżeli `playwright-cli` nie jest dostępne w `PATH`, zastosuj blokadę opisaną w `<skill_dir>/SKILL.md`. Nie zakładaj opcji niewymienionej przez aktualne `--help`.

## Preflight

Przed odkryciem, audytem i edycją renderowanego UI:

1. Uruchom `playwright-cli --help`.
2. Ustaw unikalną sesję, np. `SESSION="frontend-ui-preflight-$(date +%s)-$$"`.
3. Standardowo otwórz `about:blank` przez `--browser=chromium`, a po sukcesie
   zamknij sesję.
4. Jeżeli ustawiono `PLAYWRIGHT_MCP_CDP_ENDPOINT`, zamiast tego wykonaj `attach
   --cdp` i po sukcesie `detach`.
5. Jeżeli WSL nie ma lokalnej przeglądarki, użyj skonfigurowanego CDP albo przerwij
   zadanie. Nie instaluj browsera automatycznie.

Brak CLI, browsera lub działającego CDP blokuje zadanie przed analizą i edycją.
Dokładny komunikat blokady zgłoś w raporcie. Poza WSL błąd uruchomienia browsera
również blokuje zadanie.

## Profile weryfikacji

Zakres wynika z profilu skilla:

- **minimalny** — jeden viewport i zmieniony stan,
- **standardowy** — mobile + desktop, before/after i najważniejsze stany,
- **rozszerzony** — pełna adekwatna macierz, lifecycle, re-render, visual regression lub trace.

## Sesja

Używaj unikalnej nazwy, np.:

```bash
SESSION="ui-review-grid-header"
mkdir -p .playwright-cli/ui-review/zadanie
playwright-cli -s="$SESSION" open http://localhost --headed --browser=chromium
```

Po zmianie DOM pobierz nowy snapshot; refs mogą być nieaktualne.

Na końcu:

```bash
playwright-cli -s="$SESSION" close
```

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
`${TMPDIR:-/tmp}/opencode/frontend-ui/<zadanie>/`, po uprzednim sprawdzeniu jego
rodzica. Uruchamiaj całą sesję `playwright-cli` z tym katalogiem jako katalogiem
roboczym, aby także automatyczne snapshoty i logi konsoli pozostały poza repo.
Nie pozostawiaj artefaktów jako nieśledzonych plików repo.

Storage state i profile przechowuj pod ignorowanym `.playwright-cli/auth/`. Nie zapisuj sekretów, danych produkcyjnych ani PII w artefaktach.

W `execution_mode: advisory` nie zapisuj storage state w repozytorium i nie
wykonuj operacji zmieniających dane lub stan aplikacji. Dopuszczalne są
niemutujące interakcje potrzebne do obejrzenia widoku, np. przełączenie zakładki,
rozwinięcie panelu lub zmiana viewportu, o ile nie zapisują danych.

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
playwright-cli -s="$SESSION" eval "() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY, dark: matchMedia('(prefers-color-scheme: dark)').matches, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches })"
```

Przed screenshotem wymagającym stabilnych fontów użyj:

```bash
playwright-cli -s="$SESSION" eval "async () => { await document.fonts.ready; return true; }"
```

## Snapshot

```bash
playwright-cli -s="$SESSION" snapshot --depth=5
```

Używaj refs, ról lub stabilnych selektorów. Nie używaj starych refs po nawigacji lub re-renderze.

## Screenshot

Viewport lub element:

```bash
playwright-cli -s="$SESSION" screenshot --filename=.playwright-cli/ui-review/zadanie/cel-przed.png
playwright-cli -s="$SESSION" screenshot e42 --filename=.playwright-cli/ui-review/zadanie/komponent-po.png
```

Pełna strona jest wyjątkiem. Użyj aktualnej opcji CLI:

```bash
playwright-cli -s="$SESSION" screenshot --full-page --filename=.playwright-cli/ui-review/zadanie/strona-po.png
```

Dla analizy komponentu preferuj element i viewport; pełna strona pomaga tylko wtedy, gdy ważny jest kontekst layoutu.

## Computed styles

Odczytuj tylko właściwości istotne dla problemu:

```bash
playwright-cli -s="$SESSION" eval "(el) => { const s = getComputedStyle(el); return { padding: s.padding, gap: s.gap, border: s.border, borderRadius: s.borderRadius, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, color: s.color, backgroundColor: s.backgroundColor, alignItems: s.alignItems, justifyContent: s.justifyContent }; }" e42
```

Screenshot odpowiada „jak wygląda”, computed styles pomagają odpowiedzieć „dlaczego”.

## Baseline przed zmianą

Wykonaj przed edycją, gdy stan można uruchomić. Nazwa powinna wskazywać zadanie, stan i viewport. Jeśli baseline jest niemożliwy, zanotuj przyczynę; nie rekonstruuj go po fakcie.

## Viewporty

Dobieraj zgodnie z profilem i projektem. Typowa macierz rozszerzona:

```bash
playwright-cli -s="$SESSION" resize 390 844
playwright-cli -s="$SESSION" resize 1024 768
playwright-cli -s="$SESSION" resize 1440 900
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
playwright-cli -s="$SESSION" console error
playwright-cli -s="$SESSION" requests
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
