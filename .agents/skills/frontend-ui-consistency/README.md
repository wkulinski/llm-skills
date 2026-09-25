# frontend-ui-consistency

Skill dla OpenCode do bezpiecznego rozwoju istniejącego interfejsu. Łączy pracę
na wzorcach, Twig, Symfony UX Live Components, Stimulus, CSS/SCSS, jakość
estetyczną i proporcjonalną weryfikację przez Playwright CLI.

## Instalacja

Skopiuj katalog do `.agents/skills/frontend-ui-consistency/` oraz katalog
`_shared` do `.agents/skills/_shared/`. Skill korzysta ze współdzielonego
preflightu i kontraktu Playwright wskazanych w `shared_files`.

## Playwright CLI

Zainstaluj CLI i browser używany przez skill:

```bash
npm install -g @playwright/cli@0.1.17
playwright-cli install-browser chrome-for-testing
bash <skills_root>/_shared/scripts/playwright-access-prepare.sh
```

Współdzielony helper przygotowania wywołuje preflight, który rozwiązuje `playwright-cli`
przez `resolve_tool_cmd playwright-cli playwright-cli`: najpierw sprawdza
`BIN_PATH`, a następnie używa `PATH` jako fallbacku. Globalna komenda w `PATH` nie
jest więc wymagana, jeśli `BIN_PATH` wskazuje wykonywalny CLI.

Po instalacji zweryfikuj działanie jednym krokiem przygotowania dostępu (nie
składaj preflightu ręcznie):

```bash
bash <skills_root>/_shared/scripts/playwright-access-prepare.sh
```

Helper waliduje resolved CLI przez `--help`, a następnie otwiera `about:blank` w
Chromium i zamyka sesję. W WSL można użyć dedykowanej przeglądarki uruchomionej
po stronie Windows przez CDP: ustaw `PLAYWRIGHT_MCP_CDP_ENDPOINT` na endpoint
instancji z włączonym remote debugging, a helper sam wykona `attach --cdp` i
`detach`. Znaczenie wyniku i kodów wyjścia opisuje
`<skills_root>/_shared/references/playwright-cli-verification.md`.

## Dostęp do aplikacji

URL wybieraj w kolejności: jawny URL z promptu/zadania, następnie
`PLAYWRIGHT_GUI_BASE_URL`, a przy braku obu — zapytaj użytkownika lub zgłoś
blokadę. Nie zgaduj trasy i nie używaj domyślnego `localhost`.

Sesja aplikacji ponownie rozwiązuje CLI przez ten sam `resolve_tool_cmd` co
preflight (`PW_CLI`); bezpośrednie `playwright-cli` nie działa w konfiguracji
`BIN_PATH`-only.

Opcjonalny `PLAYWRIGHT_GUI_STORAGE_STATE` musi być repo-relative, rozwiązywać się
do regular file pod `.playwright-cli/auth/` i być ignorowany przez Git. Przed
chronioną nawigacją osobna, unikalna sesja aplikacji otwiera pusty kontekst,
waliduje state i wykonuje `state-load <filename>`; dopiero potem nawiguje.
Dla chronionego URL-a uruchom
`bash <skills_root>/_shared/scripts/playwright-access-prepare.sh --protected`;
helper sam użyje istniejącego state albo uruchomi `playwright-auth-bootstrap.sh`
tylko gdy brakuje state i dostępne są dane logowania loopback. Po
`Authentication: OK` użyj wypisanej ścieżki stanu i dopiero wtedy wykonaj
`state-load`. W pozostałych przypadkach raportuj `authentication unavailable`.
Sesję zawsze zamykaj. Szczegółowy kontrakt i blokady są w `SKILL.md`.

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
