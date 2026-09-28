# Tryb `standard-gap`

## Kiedy stosować

Zgłoś `standard-gap`, gdy audyt nie może rozstrzygnąć zgodności na podstawie
`skill-authoring-standard.md`, checklisty właściwej dla targetu oraz właścicieli
reguł MUST (`skill-structure-contract.md`, testy repozytorium). Typowe przypadki:

- wymiar jakości nie jest opisany w standardzie, a artefakt go narusza;
- checklista i standard dają sprzeczne oczekiwania;
- artefakt obiecuje zachowanie, którego żaden test ani właściciel reguły nie
  egzekwuje;
- reguła MUST jest niespójna z praktyką repo, ale jej zmiana należy do
  użytkownika i planu, nie do audytu;
- standard wymaga rozstrzygnięcia, którego nie da się wyprowadzić z istniejących
  źródeł.

Nie zgłaszaj `standard-gap` dla zwykłego findingu, który standard opisuje —
wtedy publikuj finding. Nie używaj trybu do obejścia braku evidence.

## Format propozycji

Każdy `standard-gap` raportuj w stałej strukturze:

```text
G<n> [SEVERITY] Krótki tytuł — path/to/standard.md:line (albo "brak właściciela")
- Observed: co w artefakcie lub repo ujawniło lukę
- Gap: czego standard lub checklista nie rozstrzygają
- Impact: dlaczego luka wpływa na ocenę albo utrzymanie
- Proposal: zwięzły kierunek zmiany standardu (bez edycji pliku)
- Owner: kto decyduje (użytkownik, `$task-plan` + `$code-implement`, właściciel reguły MUST)
- Confidence: high / medium / low
```

Severity stosuj jak dla findings: `BLOCKER`, `MAJOR`, `MINOR`, `QUESTION`,
`SUGGESTION`. Luka blokująca ocenę artefaktu jest co najmniej `MAJOR`; brak
pokrycia, który nie wpływa na werdykt, może być `MINOR` albo `SUGGESTION`.

## Granice

- `$skill-review` nie edytuje standardu, checklist ani artefaktu; propozycja jest
  wynikiem, nie zmianą.
- Nie ustanawiaj nowych progów MUST, limitów liczbowych ani kodów błędów —
  właścicielami są testy i `skill-structure-contract.md`.
- Nie rozstrzygaj sprzeczności samodzielnie przez wybór jednej interpretacji;
  pokaż sprzeczność i wskaż decydenta.
- Decyzja o zmianie standardu należy do użytkownika i planu; po decyzji zmianę
  realizuje `$task-plan` + `$code-implement`.
- Propozycje standard-gap nie zmieniają werdyktu `PASS` dla artefaktu, chyba że
  luka uniemożliwia ocenę — wtedy werdykt to `DISCUSS`.

## Przykłady

- Artefakt opisuje rolę modelu, ale standard nie mówi, jak oceniać przypięcie
  modelu w tekście normatywnym → `standard-gap` na wymiarze przenośności.
- Test pinuje frazę, której właściciel reguły już nie istnieje → `standard-gap`
  z właścicielem `$task-plan` + `$code-implement`.
- Standard nie definiuje, czy opis agenta ma limit długości → `standard-gap`
  `MINOR`; raport nadal podaje długość jako metrykę.
