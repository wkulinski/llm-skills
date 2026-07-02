# Serena + Codex — konfiguracja lokalna dla projektu

Instrukcja opisuje konfigurację Sereny jako MCP servera dla Codexa w pojedynczym projekcie.

Docelowa konfiguracja:

- konfiguracja Codexa znajduje się lokalnie w projekcie: `.codex/config.toml`,
- Serena jest zainstalowana globalnie w środowisku użytkownika,
- komenda `serena` jest dostępna w `PATH`,
- Codex jest uruchamiany z katalogu głównego projektu,
- backend PHP: `php_phpactor`,
- backend JS/TS: `typescript`,
- backend HTML: `html`,
- backend CSS/SCSS/Sass: `scss`,
- backend Bash: `bash`.

---

## 1. Zainstaluj zależności systemowe

Dla systemów opartych o Debiana/Ubuntu:

```bash
sudo apt update
sudo apt install -y \
  curl ca-certificates unzip git \
  php-cli php-mbstring php-xml php-curl php-zip php-tokenizer \
  composer \
  nodejs npm
```

Sprawdź, czy wymagane narzędzia są dostępne:

```bash
php -v
composer --version
node --version
npm --version
```

---

## 2. Zainstaluj `uv`

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"
```

Sprawdź:

```bash
uv --version
```

Dodaj środowisko `uv` do nowych sesji terminala:

```bash
grep -qxF '[ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env"' ~/.bashrc \
  || echo '[ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env"' >> ~/.bashrc
```

Po tej zmianie nowe sesje terminala powinny automatycznie widzieć narzędzia instalowane przez `uv`.

---

## 3. Zainstaluj Serenę

```bash
uv tool install -p 3.13 serena-agent
source "$HOME/.local/bin/env"
```

Sprawdź:

```bash
serena --version
```

Jeżeli komenda `serena` nie jest widoczna, odśwież środowisko:

```bash
source "$HOME/.local/bin/env"
```

---

## 4. Przygotuj zależności projektu PHP

Jeżeli projekt używa Composera, upewnij się, że zależności są zainstalowane i że w projekcie istnieje plik:

```text
vendor/autoload.php
```

Jeżeli zależności są instalowane lokalnie:

```bash
composer install
composer dump-autoload
```

Jeżeli zależności są instalowane w kontenerze, uruchom odpowiednie komendy Composera zgodnie z konfiguracją danego projektu.

---

## 5. Utwórz konfigurację projektu Sereny

W katalogu głównym projektu uruchom:

```bash
serena project create \
  --language php_phpactor \
  --language typescript \
  --language html \
  --language scss \
  --language bash \
  --index .
```

Znaczenie języków:

| Technologia | Język Sereny |
|---|---|
| PHP | `php_phpactor` |
| TypeScript | `typescript` |
| JavaScript | `typescript` |
| HTML | `html` |
| CSS | `scss` |
| SCSS / Sass | `scss` |
| Bash / shell scripts | `bash` |

Po poprawnym zakończeniu powinien pojawić się komunikat podobny do:

```text
Indexed files per language: php_phpactor=..., typescript=..., html=..., scss=..., bash=...
```

---

## 6. Sprawdź konfigurację Sereny

W projekcie powinien powstać plik:

```text
.serena/project.yml
```

Upewnij się, że lista języków zawiera:

```yaml
languages:
  - php_phpactor
  - typescript
  - html
  - scss
  - bash
```

Po ręcznej zmianie konfiguracji przeindeksuj projekt:

```bash
serena project index
```

---

## 7. Utwórz lokalną konfigurację Codexa

W katalogu głównym projektu utwórz plik:

```text
.codex/config.toml
```

Dodaj konfigurację MCP dla Sereny:

```toml
[mcp_servers.serena]
startup_timeout_sec = 30
tool_timeout_sec = 120
command = "serena"
args = ["start-mcp-server", "--project-from-cwd", "--context=codex"]
```

Ta konfiguracja zakłada, że `serena` jest dostępna w `PATH` w tej samej sesji terminala, z której uruchamiany jest Codex.

---

## 8. Przetestuj MCP server Sereny

W katalogu głównym projektu uruchom:

```bash
serena start-mcp-server --project-from-cwd --context=codex
```

Jeżeli proces startuje i czeka na wejście, MCP server działa poprawnie.

Przerwij test przez `Ctrl+C`.

---

## 9. Sprawdź Serenę w Codexie

Uruchom Codexa z katalogu głównego projektu.

W Codexie wpisz:

```text
/mcp
```

Na liście powinien być widoczny serwer:

```text
serena
```

Następnie można użyć polecenia testowego:

```text
Aktywuj bieżący katalog jako projekt Sereny. Do nawigacji po kodzie używaj narzędzi symbolicznych Sereny.
```

Jeżeli Serena działa poprawnie, Codex powinien móc używać jej narzędzi do analizy symboli, klas, metod i referencji w projekcie.

---

# Najczęstsze problemy

## Codex nie widzi Sereny

Objaw:

```text
MCP client for `serena` failed to start: MCP startup failed: No such file or directory (os error 2)
```

Najczęstsza przyczyna: komenda `serena` nie jest widoczna w `PATH` dla sesji, z której uruchamiany jest Codex.

Sprawdź:

```bash
command -v serena
```

Jeżeli nie zwraca ścieżki, odśwież środowisko:

```bash
source "$HOME/.local/bin/env"
```

Jeżeli problem wraca w nowych terminalach, dodaj środowisko `uv` do `~/.bashrc`:

```bash
grep -qxF '[ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env"' ~/.bashrc \
  || echo '[ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env"' >> ~/.bashrc
```

---

## Serena zgłasza brak PHP

Backend `php_phpactor` wymaga lokalnie dostępnej komendy `php`.

Dla Debiana/Ubuntu zainstaluj minimalne PHP CLI:

```bash
sudo apt update
sudo apt install -y php-cli php-mbstring php-xml php-curl php-zip php-tokenizer composer unzip
```

Sprawdź:

```bash
php -v
composer --version
```

---

## Brak `vendor/autoload.php`

Jeżeli projekt używa Composera, a plik `vendor/autoload.php` nie istnieje, zainstaluj zależności projektu.

Lokalnie:

```bash
composer install
composer dump-autoload
```

W kontenerze: użyj komend właściwych dla danego projektu.

---

## `Unknown language 'php_phpantom'`

Użyj `php_phpactor`.

Poprawna konfiguracja PHP w tej instrukcji:

```bash
serena project create \
  --language php_phpactor \
  --language typescript \
  --language html \
  --language scss \
  --language bash \
  --index .
```

---

## Ostrzeżenie `Unhandled method 'window/showMessage'`

Przykład:

```text
WARNING ... Unhandled method 'window/showMessage'
```

Jeżeli indeksacja kończy się komunikatem typu:

```text
Indexed files per language: ...
```

ostrzeżenie można zwykle zignorować.

---

# Aktualizacja Sereny

```bash
uv tool upgrade serena-agent
source "$HOME/.local/bin/env"
serena --version
```

Po aktualizacji można przeindeksować projekt:

```bash
serena project index
```

---

# Skrót komend

W katalogu głównym projektu:

```bash
sudo apt update
sudo apt install -y \
  curl ca-certificates unzip git \
  php-cli php-mbstring php-xml php-curl php-zip php-tokenizer \
  composer \
  nodejs npm

curl -LsSf https://astral.sh/uv/install.sh | sh
source "$HOME/.local/bin/env"

uv tool install -p 3.13 serena-agent
source "$HOME/.local/bin/env"

grep -qxF '[ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env"' ~/.bashrc \
  || echo '[ -f "$HOME/.local/bin/env" ] && source "$HOME/.local/bin/env"' >> ~/.bashrc

serena project create \
  --language php_phpactor \
  --language typescript \
  --language html \
  --language scss \
  --language bash \
  --index .
```

Utwórz `.codex/config.toml`:

```toml
[mcp_servers.serena]
startup_timeout_sec = 30
tool_timeout_sec = 120
command = "serena"
args = ["start-mcp-server", "--project-from-cwd", "--context=codex"]
```

Po uruchomieniu Codexa z katalogu projektu sprawdź:

```text
/mcp
```
