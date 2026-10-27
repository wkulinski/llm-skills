# Kanały i komenda `find`

Ładuj ten plik, gdy zadanie dotyczy ustalenia ID kanału po nazwie albo
dodania kanału do konfiguracji.

## Wyszukiwanie kanału

```bash
node <skill_dir>/scripts/slack.mjs find "git-hub"
node <skill_dir>/scripts/slack.mjs find "#Git Hub"
node <skill_dir>/scripts/slack.mjs find "git" --include-archived
```

`find` jest read-only i przeszukuje kanały publiczne oraz prywatne dostępne dla
tokena:

- `conversations.list` z `types=public_channel,private_channel`,
- paginacja po `response_metadata.next_cursor`,
- domyślnie kanały archiwalne są pomijane; `--include-archived` je pokazuje,
- wynik zawiera `id`, `name`, `private`, `archived`, `member` i `match`.

Dopasowanie normalizuje `#`, wielkość liter, białe znaki i zamienia spacje na
myślniki. Wymagane jest dokładne dopasowanie do `name` lub `name_normalized`.
Dopasowania częściowe są zwracane jako kandydaci, ale nie wystarczają do
dodania kanału.

## Dodanie do konfiguracji

```bash
node <skill_dir>/scripts/slack.mjs find "git-hub" --add
node <skill_dir>/scripts/slack.mjs find "git-hub" --add --alias github
```

`--add`:

- wymaga dokładnie jednego dopasowania,
- odrzuca kanał archiwalny,
- dopisuje ID do `channels` w `<consumer>/.slack/config.json`,
- jest idempotentne: istniejące ID nie jest duplikowane.

`--alias <alias>` dodatkowo dopisuje mapowanie `alias -> ID` do `aliases`.
`--alias` wymaga `--add`; kolizja z innym aliasem lub aliasem DM kończy się
błędem i nie zmienia pliku.

## Usunięcie z konfiguracji

```bash
node <skill_dir>/scripts/slack.mjs find "git-hub" --remove
node <skill_dir>/scripts/slack.mjs find "git-hub" --remove --include-archived
```

`--remove`:

- wymaga dokładnie jednego dopasowania,
- usuwa ID z `channels`,
- usuwa wszystkie aliasy wskazujące na ten kanał,
- jest idempotentne: brak wpisu kończy się `removed: false` bez zapisu,
- może usunąć kanał archiwalny tylko wtedy, gdy zostanie wylistowany przez
  `--include-archived`.

`--add` i `--remove` wykluczają się. `--remove` nie wymaga `--confirm`, bo
zmienia wyłącznie lokalny config, nie Slacka.

Zapis konfiguracji jest atomowy: plik tymczasowy w `.slack/` jest zastępowany
przez `rename`, a wynik ma prawa `600`. Pozostałe pola konfiguracji i wcięcia są
zachowywane.

Po dodaniu można używać aliasu albo ID:

```bash
node <skill_dir>/scripts/slack.mjs info github
node <skill_dir>/scripts/slack.mjs history C0ABKTJ7ESV --limit 10
```

## Ograniczenia

- `find` dotyczy kanałów; do osób służy `people`.
- Prywatne kanały są widoczne tylko wtedy, gdy użytkownik jest ich członkiem.
- `find` nie dołącza do kanału i nie tworzy kanałów.
- Nazwy kanałów mogą się zmieniać; do powtarzalnych zadań używaj aliasu lub ID.
- Nie są potrzebne nowe scope'y: wystarczą `channels:read` i `groups:read`.
  `conversations.list` i `conversations.info` korzystają z już posiadanych
  uprawnień.
