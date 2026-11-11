# Wznowienie i edycja planu

Czytaj przed wznowieniem istniejącego planu, obsługą starszego review,
zmianą wymagań ukończonego WP albo punktową edycją zapisanego planu.

## Wznowienie i ukończone WP

Plan bez zapisanych kluczy review (np. sprzed ich wprowadzenia) pozostaje
czytelny, ale jest `blocked` z `review_pending`, a `plan-execute` odrzuca go z
`PLAN_NOT_READY`. Naprawa: review planu w tym skillu i `record-review` dla
bieżącej rewizji.

Zmiana wymagań ukończonego WP: oceń podczas obowiązkowego review, czy nowe
wymagania unieważniają evidence ukończenia albo dodają niewykonaną pracę. Wtedy
otwórz ten WP i późniejsze ukończone WP przez `[ ]` w `## Execution`. Gdy zmiana
jest wyłącznie redakcyjna, a evidence pozostaje ważne, zachowaj `[x]`, ale
przeprowadź review zmienionej treści. Zapisz wynik oceny i uzasadnienie jako
`D<number>` w decyzjach planu. Magazyn nie porównuje treści WP i nie blokuje
takiego zapisu.

Do resume wystarczają:

- aktualny Markdown;
- source artifact;
- opcjonalna referencja do finalnego raportu contextu.

Przed powstaniem kompletnego planu wynik `INCOMPLETE` albo `BLOCKED`
repository-context pozostaje w canonical stanie helpera i jest komunikowany
użytkownikowi. Nie twórz wtedy sztucznego WP ani pustego Markdowna. Pełna
aktualizacja dokumentu jest atomowa i ponawialna. Brak artefaktu nie uruchamia
rekonstrukcji z danych v1.

## Edycja strukturalna

Składnia komend:

```text
<skill_dir>/scripts/edit.mjs add-bullet
  --file ./docs/plans/<plan>.md
  (--section <dokładna sekcja> | --work-package <WP<number>>)
  --id <nazwa>
  --value <wartość, także wielowierszowa>
  [--status <status>]

<skill_dir>/scripts/edit.mjs edit-bullet
  --file ./docs/plans/<plan>.md
  (--section <dokładna sekcja> | --work-package <WP<number>>)
  --id <nazwa>
  [--value <wartość, także wielowierszowa>]
  [--status <status>]

<skill_dir>/scripts/edit.mjs remove-bullet
  --file ./docs/plans/<plan>.md
  (--section <dokładna sekcja> | --work-package <WP<number>>)
  --id <nazwa>

<skill_dir>/scripts/edit.mjs answer-question
  --file ./docs/plans/<plan>.md
  --id Q<number>
  --answer <odpowiedź, także wielowierszowa>

<skill_dir>/scripts/edit.mjs add-question
  --file ./docs/plans/<plan>.md
  --id Q<number>
  --prompt <pytanie, także wielowierszowe>
  --status <open|answered>
  [--answer <odpowiedź, także wielowierszowa>]

<skill_dir>/scripts/edit.mjs edit-question
  --file ./docs/plans/<plan>.md
  --id Q<number>
  [--prompt <pytanie, także wielowierszowe>]
  [--status <open|answered>]
  [--answer <odpowiedź, także wielowierszowa>]

<skill_dir>/scripts/edit.mjs remove-question
  --file ./docs/plans/<plan>.md
  --id Q<number>

<skill_dir>/scripts/edit.mjs apply-operations
  --file ./docs/plans/<plan>.md
  --input ./plan-operations.json
```

Selektory `--section` i `--work-package` wzajemnie się wykluczają.
`edit-bullet` i `remove-bullet` obejmują cały punkt wraz z jego wciętymi
wierszami. Przy
`--dry-run` helper wykonuje tę samą walidację bez zapisu.
