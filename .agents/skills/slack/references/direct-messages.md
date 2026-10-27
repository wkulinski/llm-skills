# Osoby i DM-y

Ładuj ten plik, gdy zadanie dotyczy wyszukiwania osoby, wysyłki DM albo polityki
`dm_policy`.

## Wyszukiwanie osób

Slack nie udostępnia wyszukiwania użytkowników po nazwisku. Skrypt pobiera
katalog przez `users.list` (`users:read`) z paginacją i filtruje lokalnie:

```bash
node <skill_dir>/scripts/slack.mjs people "Jan Kowalski"
```

- Dopasowanie normalizuje Unicode, wielkość liter i białe znaki.
- Automatyczna wysyłka wymaga dokładnego dopasowania w `real_name`,
  `profile.real_name` lub `real_name_normalized`.
- `display_name` i `name` służą do podpowiedzi; ich dopasowanie wymaga jawnego
  `U...`.
- Wynik zawiera tylko `id`, `username`, `real_name`, `display_name`, `title`,
  `match` i flagi konta. E-mail, telefon i awatar nie są zwracane.
- Domyślnie pomijane są boty, aplikacje, konta usunięte i bieżący użytkownik.
- Katalog nie jest zapisywany w trwałym cache; kolejne uruchomienie pobiera go
  ponownie.

## Wysyłka do osoby

`--to` przyjmuje:

- `U...` — jednoznaczny identyfikator użytkownika;
- alias z `direct_messages`;
- pełne imię i nazwisko.

```bash
node <skill_dir>/scripts/slack.mjs send --to "Jan Kowalski" --confirm
node <skill_dir>/scripts/slack.mjs send --to U00000002 --confirm
```

Zasady:

- `send --to` wymaga `--confirm`.
- Imię i nazwisko musi mieć co najmniej dwa tokeny.
- Wysyłka następuje od razu tylko przy dokładnie jednym dopasowaniu pełnego
  imienia i nazwiska.
- Przy zerowym dopasowaniu, dopasowaniu częściowym lub kilku dokładnych
  dopasowaniach skrypt kończy się błędem z listą kandydatów i nic nie wysyła.
- `U...` jest weryfikowany przez `users.info`; konto musi być aktywne, nie może
  być botem, aplikacją ani bieżącym użytkownikiem.
- `allow_external=false` blokuje użytkowników spoza workspace'u.

## Rozwiązywanie rozmowy

1. `users.info` weryfikuje osobę.
2. `conversations.open` z `users=<U...>` zwraca `D...`.
3. `conversations.info` potwierdza `is_im === true` i `channel.user === U...`.
4. Dopiero potem wykonywana jest operacja.

Odczyt (`history`, `thread`, `files`, `download`) zawsze używa
`prevent_creation=true` i nie tworzy nowej rozmowy. Zapis może utworzyć DM tylko
przy `dm_policy.allow_create=true`; w przeciwnym razie wymaga istniejącej
rozmowy.

## Polityka i audit

- `dm_policy.mode=confirm` — domyślny; lookup dozwolony, zapis z `--confirm`.
- `dm_policy.mode=allowlist` — tylko aliasy lub user ID z `direct_messages`.
- `dm_policy.mode=disabled` — DM-y i `people` są wyłączone.
- `dm_policy.audit=true` zapisuje do `<consumer>/var/slack/audit.log` czas,
  akcję (odczyt lub zapis), `user_id`, kanał i `ts`/`file_id`. Nie zapisuje treści
  wiadomości ani tokena. Zapis jest best-effort; błąd trafia do wyniku jako
  `audit_error`.
