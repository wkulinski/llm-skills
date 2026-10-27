# Konfiguracja Slack

`<consumer>` oznacza root projektu konsumenta. Skill nie zawiera sekretów ani
identyfikatorów konkretnego workspace'u; poniższe wartości są syntetyczne.

## `config.json`

Plik `<consumer>/.slack/config.json` jest zwykłym JSON-em. Wszystkie pola poza
`user-token` są opcjonalne; minimalny plik to `{}`:

```json
{
    "team_id": "T00000000",
    "user_id": "U00000000",
    "workspace_url": "https://example.slack.com",
    "channels": ["C00000000", "C00000001"],
    "aliases": {
        "general": "C00000000",
        "engineering": "C00000001"
    },
    "direct_messages": {
        "anna": "U00000002"
    },
    "dm_policy": {
        "mode": "confirm",
        "allow_create": true,
        "allow_external": false,
        "audit": true
    },
    "files": {
        "max_bytes": 104857600,
        "allowed_hosts": ["files.slack.com", "slack-files.com"]
    }
}
```

- `team_id`, `user_id`, `workspace_url` — opcjonalne. Gdy są podane, są
  weryfikowane względem `auth.test`; `workspace_url` jest używany w linkach.
  Bez nich tożsamość i URL pochodzą z `auth.test`.
- `channels` — lista dozwolonych kanałów publicznych i prywatnych (`C...` albo
  `G...`). Bez tego pola komendy kanałowe są wyłączone, a DM-y nadal działają.
- `aliases` — opcjonalne mapowanie nazw kanałów na identyfikatory z `channels`.
- `direct_messages` — opcjonalne aliasy DM (`alias` → `U...`). Nie jest wymagane
  do wyszukiwania osób po imieniu i nazwisku; służy jako skrót lub allowlista.
- `dm_policy.mode` — `confirm` (domyślnie), `allowlist` albo `disabled`.
  - `confirm`: dowolna osoba znaleziona w katalogu, ale zapis wymaga `--confirm`;
  - `allowlist`: tylko osoby z `direct_messages`;
  - `disabled`: DM-y wyłączone.
- `dm_policy.allow_create` — domyślnie `true`; pozwala `conversations.open`
  utworzyć nowy DM. Przy `false` odczyt i zapis korzystają wyłącznie z
  istniejącej rozmowy.
- `dm_policy.allow_external` — domyślnie `false`; blokuje użytkowników spoza
  workspace'u (np. Slack Connect).
- `dm_policy.audit` — domyślnie `true`; zapisuje metadane operacji DM i pobrań
  do `<consumer>/var/slack/audit.log` bez treści wiadomości; obejmuje odczyt
  i zapis DM oraz pobrania. Zapis jest best-effort: błąd jest raportowany jako
  `audit_error`, ale operacja mogła już zostać wykonana.
- `files.max_bytes` — limit pobieranego pliku, domyślnie 100 MiB.
- `files.allowed_hosts` — dokładne nazwy hostów, z których wolno pobierać pliki.
  Token jest wysyłany wyłącznie do tych hostów.

Każde uruchomienie odczytuje konfigurację z rootu ustalonego przez najbliższy
katalog nadrzędny z `.slack/config.json` albo przez `SLACK_PROJECT_ROOT`.
Nie kopiuj konfiguracji do katalogu skilla.

## `user-token`

Plik `<consumer>/.slack/user-token` zawiera wyłącznie token użytkownika
rozpoczynający się od `xoxp-`. Musi być zwykłym plikiem należącym do bieżącego
użytkownika, z prawami dokładnie `600`. Token nie może być dowiązaniem
symbolicznym.

Wyklucz `/.slack/user-token*`, `/var/cache/slack/`, `/var/slack/` oraz
`/slack-debug-*.log` z kontroli wersji projektu konsumenta. Cache, audit log
i pobrane pliki traktuj jako dane prywatne. Skrypt nie szyfruje lokalnego pliku
tokena.

Bezpieczny zapis bez ujawniania tokena w historii poleceń:

```bash
(
  umask 077
  read -r -s -p 'User OAuth Token: ' token
  printf '\n'
  if [[ "$token" == xoxp-* ]]; then
    printf '%s' "$token" > .slack/user-token
    chmod 600 .slack/user-token
    printf 'Token zapisany.\n'
  else
    printf 'Nie zapisano: wymagany token użytkownika xoxp-.\n'
  fi
)
```

## Dodawanie kanału po nazwie

Zamiast ręcznie szukać ID możesz użyć `find`:

```bash
node <skill_dir>/scripts/slack.mjs find "git-hub"
node <skill_dir>/scripts/slack.mjs find "git-hub" --add
node <skill_dir>/scripts/slack.mjs find "git-hub" --add --alias github
```

`find --add` dopisuje ID do `channels`, a `--alias` dodatkowo mapowanie do
`aliases`. `find --remove` usuwa ID i wszystkie aliasy wskazujące na ten kanał.
Wymagane jest jedno dokładne dopasowanie; kanały archiwalne i niejednoznaczne
nazwy nie są zapisywane przy `--add`. Zapis jest atomowy i zachowuje pozostałe
pola konfiguracji. `find` nie potrzebuje nowych scope'ów.

## Cache, audit i pobrane pliki

- `<consumer>/var/cache/slack/` — cache i katalog konfiguracji Slack CLI; nie
  zawiera tokena.
- `<consumer>/var/slack/audit.log` — metadane odczytu/zapisu DM i pobrań, prawa `600`.
- `<consumer>/var/slack/files/` — domyślne miejsce pobranych plików, prawa `600`.
  `--output` pozwala wskazać inną ścieżkę wewnątrz projektu.

## Root i `SLACK_PROJECT_ROOT`

Bez zmiennej środowiskowej root jest ustalany od bieżącego katalogu w górę, aż
do katalogu z `.slack/config.json`. Ustawienie `SLACK_PROJECT_ROOT` wskazuje
konkretny root, ale nie wyłącza ochrony katalogu: komendę nadal uruchamiaj
z tego projektu lub jego podkatalogu:

```bash
SLACK_PROJECT_ROOT=/home/user/project node <skill_dir>/scripts/slack.mjs status
```

Wartość jest kanonikalizowana i musi wskazywać katalog z `.slack/config.json`.
Bieżący katalog po rozwiązaniu dowiązań musi znajdować się w tym projekcie.
Brak konfiguracji w rootcie lub w jego katalogach nadrzędnych jest błędem; nie
ma fallbacku do katalogu skilla.

## Uprawnienia aplikacji

Przykładowy manifest znajduje się w
`<skill_dir>/assets/app-manifest.example.json`, a pełna tabela scope'ów i
ograniczeń w `<skill_dir>/README.md`. Aplikację tworzy się w panelu Slacka, a po
zmianie uprawnień trzeba ponownie zatwierdzić instalację. Wymagane są
uprawnienia użytkownika do wysyłania wiadomości, odczytu kanałów, historii
kanałów i grup, DM-ów, profili użytkowników oraz plików. `files:write` nie jest
obecnie wymagany, ponieważ upload plików nie jest zaimplementowany. Instalacja
może wymagać zgody administratora workspace'u.
