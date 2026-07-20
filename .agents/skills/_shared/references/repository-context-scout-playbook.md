# Repository-context scout playbook

Ten playbook jest wspólnym kontraktem wykonawczym dla `context-scout-fast` i
`context-scout`. Adapter agenta określa rolę, dozwolone narzędzia i strategię
nawigacji; ten dokument określa niezmienną procedurę rekonesansu i raportowania.

## Twarde granice

- Pracuj wyłącznie read-only. Nie implementuj, nie edytuj kodu, nie uruchamiaj
  QA/review, nie commituj i nie diagnozuj runtime.
- Nie uruchamiaj `./.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs`.
- Nie deleguj agentów, scoutów ani fallbacków i nie uruchamiaj `task`.
- Nie wykonuj `$context-refresh`, nie pobieraj ani nie interpretuj issue lub
  komentarzy GitHub.
- Nie kopiuj pełnych plików, dokumentów, diffów, logów ani sekretów. Raportuj
  tylko minimalne ścieżki, symbole, identyfikatory, zakresy linii i streszczenia.
- Nie czytaj raportu, błędów ani metadanych innej próby.

Naruszenie którejkolwiek granicy kończy próbę statusem `BLOCKED`; nie próbuj
naprawiać orkiestracji ani uruchamiać kolejnej próby.

## Walidacja wejścia

Oczekuj dokładnych ścieżek do oryginalnego prompta, manifestu, handoffu,
criteria oraz docelowego raportu. Handoff zawiera wyłącznie `mode`, `task_brief`,
`decisions` i `constraints`. Repozytorium, branch, HEAD i `already_read` pochodzą
z manifestu, a kryteria wyłącznie z `criteria.json`.

Przed rekonesansem uruchom:

```text
node ./.agents/skills/_shared/scripts/context-handoff.mjs validate <handoff>
node ./.agents/skills/_shared/scripts/context-criteria.mjs validate <criteria>
node ./.agents/skills/_shared/scripts/context-manifest.mjs validate <manifest>
node ./.agents/skills/_shared/scripts/context-manifest.mjs verify <manifest>
```

Brak pliku, pola albo nieaktualny manifest oznacza `BLOCKED`, nie zgadywanie.
Nie czytaj ponownie źródeł z `already_read` bez konkretnego uzasadnienia
powiązanego z kryterium lub ryzykiem.

## Procedura rekonesansu

1. Ustal z handoffu tryb `targeted` albo `cross-layer` i utwórz checklistę
   wszystkich identyfikatorów criteria.
2. Nawiguj strategią opisaną w adapterze agenta. Grupuj niezależne odczyty i nie
   skanuj szerzej, niż wymagają criteria.
3. Dla każdego kryterium zbierz minimalne evidence: dokładną repo-relative
   ścieżkę, liczbowe `line_start`/`line_end`, opcjonalny locator oraz relację,
   np. `defines`, `uses`, `implements`, `tests` albo `configures`.
4. Każdą ścieżkę skopiuj bezpośrednio z wyniku narzędzia. Potwierdź istnienie
   pliku i zakres linii w aktualnym snapshotcie; nie zgaduj prefiksów i nie używaj
   skrótów `...` ani ścieżek absolutnych.
5. Zakres claimu nie może być szerszy niż evidence. Zbiory potwierdzaj
   wyczerpująco albo oznaczaj twierdzenie jako częściowe.
6. Po uzyskaniu minimalnego coverage dla wszystkich criteria zakończ discovery.
   Nie zużywaj pozostałych kroków na ulepszanie już wystarczającego raportu.

Przy wznowieniu przez `task_id` odczytaj wyłącznie zakres wskazany przez agenta
głównego i nie powtarzaj ukończonego rekonesansu.

## Budowanie raportu

Przed tworzeniem raportu przeczytaj:

```text
./.agents/skills/_shared/references/context-scout-report-protocol.md
```

Użyj wyłącznie buildera:

```text
node ./.agents/skills/_shared/scripts/context-scout-report-builder.mjs
```

Nie składaj końcowego JSON ręcznie. Zarezerwuj co najmniej 40% kroków na ledger,
preflight, coverage, `check` i `render`. Wynik `render` zapisz dokładnie pod
ścieżką raportu przekazaną przez agenta głównego.

Jeśli builder, preflight albo walidacja odrzuci dowód, popraw punktowy odczyt lub
zwróć `INCOMPLETE`; nie obchodź walidatora. Raport `COMPLETE` wymaga coverage
każdego criterion jako `covered` albo uzasadnione `not_applicable`. Status
`blocked` nie może wystąpić w raporcie `COMPLETE`.

## Odpowiedź

Po zapisaniu raportu zwróć dokładnie ten sam JSON jako jedyną odpowiedź, bez
markdownu i komentarza. Obowiązuje koperta oraz limity z
`./.agents/skills/_shared/references/context-subagent-contract.md`, w tym
maksymalnie 12 findings i około 1500 tokenów.
