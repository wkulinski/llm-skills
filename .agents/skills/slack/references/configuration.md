# Konfiguracja Slack

`<consumer>` oznacza root projektu konsumenta. Skill nie zawiera sekretów ani
identyfikatorów konkretnego workspace'u; poniższe wartości są syntetyczne.

## `config.json`

Plik `<consumer>/.slack/config.json` jest zwykłym JSON-em:

```json
{
    "team_id": "T00000000",
    "user_id": "U00000000",
    "workspace_url": "https://example.slack.com",
    "channels": ["C00000000", "C00000001"],
    "aliases": {
        "general": "C00000000",
        "engineering": "C00000001"
    }
}
```

- `team_id` — identyfikator workspace'u (`T...`).
- `user_id` — identyfikator konta użytkownika (`U...`).
- `workspace_url` — bazowy adres workspace'u używany w linkach do wiadomości.
- `channels` — lista dozwolonych identyfikatorów kanałów (`C...` albo `G...`).
- `aliases` — opcjonalne mapowanie nazw używanych w komendach na identyfikatory
  kanałów. W komendzie można podać alias z opcjonalnym `#`; identyfikator kanału
  musi być zgodny dokładnie z listą `channels`.

Każde uruchomienie odczytuje konfigurację z rootu ustalonego przez najbliższy
katalog nadrzędny z `.slack/config.json` albo przez `SLACK_PROJECT_ROOT`.
Nie kopiuj konfiguracji do katalogu skilla.

## `user-token`

Plik `<consumer>/.slack/user-token` zawiera wyłącznie token użytkownika
rozpoczynający się od `xoxp-`. Musi być zwykłym plikiem należącym do bieżącego
użytkownika, z prawami dokładnie `600`. Token nie może być dowiązaniem
symbolicznym.

Wyklucz `/.slack/user-token*`, `/var/cache/slack/` oraz `/slack-debug-*.log`
z kontroli wersji projektu konsumenta przed zapisaniem tokena. Cache i logi
traktuj jako dane prywatne. Skrypt nie szyfruje lokalnego pliku tokena.

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

## Cache

Domyślny cache to `<consumer>/var/cache/slack`. Skrypt tworzy w nim podkatalog
`cli` i przekazuje go do Slack CLI przez `--config-dir`. Katalog cache nie zawiera
tokena; token jest wyłącznie w pliku `user-token` i środowisku procesu dziecka.

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
`<skill_dir>/assets/app-manifest.example.json`. Aplikację tworzy się w panelu
Slacka, a po zmianie uprawnień trzeba ponownie zatwierdzić instalację.
Wymagane są uprawnienia użytkownika do wysyłania wiadomości, odczytu kanałów,
historii kanałów i grup oraz profili użytkowników. Instalacja może wymagać zgody
administratora workspace'u.
