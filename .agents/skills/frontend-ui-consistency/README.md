# frontend-ui-consistency

Skill dla OpenCode do bezpiecznego rozwoju istniejącego interfejsu. Łączy pracę
na wzorcach, Twig, Symfony UX Live Components, Stimulus, CSS/SCSS, jakość
estetyczną i proporcjonalną weryfikację przez Playwright CLI.

## Instalacja

Skopiuj katalog do `.agents/skills/frontend-ui-consistency/`.

## Playwright CLI

Zainstaluj CLI i browser używany przez skill:

```bash
npm install -g @playwright/cli@0.1.17
playwright-cli install-browser chrome-for-testing
playwright-cli --help
```

Skill wymaga globalnej komendy `playwright-cli` dostępnej w `PATH`.

Po instalacji sprawdź działanie browsera:

```bash
SESSION="frontend-ui-check-$(date +%s)-$$"
playwright-cli -s="$SESSION" open about:blank --browser=chromium
playwright-cli -s="$SESSION" close
```

W WSL można użyć dedykowanej przeglądarki uruchomionej po stronie Windows
przez CDP. Ustaw `PLAYWRIGHT_MCP_CDP_ENDPOINT` na endpoint instancji z
włączonym remote debugging.

Przy CDP pomiń `open --browser=chromium` i dołącz do istniejącej sesji:

```bash
SESSION="frontend-ui-cdp-$(date +%s)-$$"
playwright-cli -s="$SESSION" attach --cdp="$PLAYWRIGHT_MCP_CDP_ENDPOINT"
```

## Artefakty i dane

Artefakty Playwright zapisuj w ignorowanym przez Git katalogu:

```text
.playwright-cli/ui-review/<zadanie>/
```

Utwórz katalog zadania przed zapisaniem screenshotów:

```bash
mkdir -p .playwright-cli/ui-review/<zadanie>
```

Nie zapisuj sekretów, danych produkcyjnych ani PII w screenshotach, trace,
logach i raporcie.
