---
name: skill-review
description: >-
  Audytuje artefakty instrukcji — pojedynczy skill, reguły lokalne, agenta albo
  cały katalog — względem standardu autorskiego i zwraca findings lub propozycje
  zmian standardu, bez edycji plików. Użyj, gdy chcesz zaudytować skill,
  instrukcje, agenta lub cały katalog.
metadata:
  mode: read-only
shared_files:
  - skill-review/references/conformance-checklist.md
  - skill-review/references/catalog-checklist.md
  - skill-review/references/standard-gap.md
  - skill-review/scripts/inventory.mjs
  - _shared/references/skill-authoring-standard.md
  - _shared/references/skill-structure-contract.md
  - _shared/references/skill-routing-policy.md
  - _shared/scripts/is-main-module.mjs
---

# $skill-review

## Cel i granice

`$skill-review` ocenia dokładnie jeden artefakt instrukcji względem
`<skills_root>/_shared/references/skill-authoring-standard.md` i zwraca
findings albo propozycje zmian standardu. Jest w pełni read-only.

- Nie edytuje plików, nie poprawia artefaktu, nie zmienia standardu i nie
  publikuje komentarzy ani commitów.
- Nie uruchamia implementacji i nie deleguje poprawek.
- Nie ocenia kodu, planów, dokumentacji domenowej ani runtime behavior agentów
  — właścicieli wskazuje sekcja „Not for”.
- Brak rozstrzygnięcia w standardzie zgłasza jako `standard-gap`, zamiast
  rozstrzygać go samodzielnie.
- Nie ustanawia nowych progów MUST ani nie zastępuje testów repozytorium.

## Targety

| Target | Artefakt | Dane wejściowe |
|---|---|---|
| `skill` | `.agents/skills/*/SKILL.md` | kolektor w trybie `skill` + odczyt korzenia i deklarowanych referencji |
| `rules` | `AGENTS.md` oraz bloki instrukcji dla konsumentów w `README.md` | odczyt punktowy + checklista reguł |
| `agents` | `.opencode/agents/*.md` | kolektor w trybie `agent` + odczyt body |
| `catalog` | cały katalog instrukcji i relacje między artefaktami | kolektor w trybie `catalog` + checklista katalogu |

Jeden przebieg targetu `skill`, `rules` albo `agents` dotyczy jednego
artefaktu. Target `catalog` obejmuje cały katalog oraz relacje między skillami,
agentami, regułami, konfiguracją i indeksem; nie rozszerzaj pojedynczego audytu
poza ten zakres i nie zawężaj `catalog` do jednego pliku.

## Tryby

- `conformance` — artefakt oceniany względem standardu i właściwej checklisty;
  wynik to findings z severity, evidence `file:line` i rekomendacją.
- `standard-gap` — standard albo checklista nie rozstrzygają przypadku, są
  sprzeczne z regułą MUST lub nie mają pokrycia; wynik to propozycje zmiany
  standardu z uzasadnieniem, bez edycji plików i bez podejmowania decyzji.

Tryb domyślny to `conformance`. Gdy audyt wykryje lukę standardu, raportuj
`standard-gap` obok findings zamiast zgadywać oczekiwane zachowanie.

Dla targetu `catalog` wybierz dodatkowo tryb uruchomienia i zapisz go w polu
`run_mode` raportu:

- `collector-only` — kolektor zapisuje deterministyczny raport z metrykami,
  pokryciem i sygnałami; nie publikuj wtedy findings ani werdyktu;
- `full` — pełny review: potwierdź sygnały bramką evidence, uzupełnij sekcję
  `review` (findings, standard-gaps, werdykt) i wskaż wybór w raporcie.

Do samego zebrania metryk użyj `collector-only`, a do audytu końcowego `full`.

## Not for

| Intencja | Właściwy właściciel |
|---|---|
| kod, zmiany, plany | `$code-review` |
| dokumentacja domenowa i spójność `docs/**` | `$docs-sync` |
| synchronizacja i edycja reguł lokalnych | `$rules-sync` |
| ocena instrukcji w regułach | target `rules` tego skilla |
| odświeżenie indeksu skilli | `$skills-index-refresh` |
| runtime behavior agentów i efekty ich pracy | `$opencode-workflow-economics`, `$runtime-diagnostician`, `$code-review`, `$qa-run` |
| utworzenie albo zmiana skilla lub agenta | `$task-plan` + `$code-implement` |

## Routing referencji

Czytaj tylko pliki wymagane przez aktywny krok; deklaracje w `shared_files` są
dostępne na żądanie, nie obowiązkowe do pełnego odczytu.

| Warunek | Plik |
|---|---|
| standard i wymiary jakości (każdy audyt) | `<skills_root>/_shared/references/skill-authoring-standard.md` |
| właściciele reguł strukturalnych MUST | `<skills_root>/_shared/references/skill-structure-contract.md` |
| routing nadrzędnego workflow i reguła „not for” | `<skills_root>/_shared/references/skill-routing-policy.md` |
| checklisty dla targetu `skill`, `rules` lub `agents` | `<skill_dir>/references/conformance-checklist.md` |
| checklista i zasady interpretacji dla targetu `catalog` | `<skill_dir>/references/catalog-checklist.md` |
| brak rozstrzygnięcia w standardzie (tryb `standard-gap`) | `<skill_dir>/references/standard-gap.md` |
| metryki artefaktu dla targetu `skill` lub `agents` | `<skill_dir>/scripts/inventory.mjs` |
| raport katalogu, tryb uruchomienia i delta po hashu | kolektor w trybie `catalog`: `--report-dir`, `--run-mode`, `--previous`, `--review-file` |

## Workflow

### 1. Rozwiąż target i tryb

Ustal target (`skill`, `rules`, `agents`), dokładną ścieżkę artefaktu i tryb
(`conformance` jako domyślny albo `standard-gap`). Gdy intencja należy do
tabeli „Not for”, nie wykonuj audytu — wskaż właściciela.

### 2. Zbierz metryki

Dla targetu `skill` albo `agents` uruchom kolektor:

```bash
node <skill_dir>/scripts/inventory.mjs --mode skill --file .agents/skills/<name>/SKILL.md
node <skill_dir>/scripts/inventory.mjs --mode agent --file .opencode/agents/<name>.md
```

Traktuj wynik jako dane wejściowe: `source_sha256`, `coverage`, `metrics`
i `signals`. Sygnały heurystyczne nie są findings — potwierdź je w kroku 4.

Dla targetu `rules` kolektor nie jest wymagany; odczytaj wskazany plik i jego
bloki instrukcji.

Dla targetu `catalog` uruchom kolektor i zapisz raport w `CACHE_PATH`:

```bash
node <skill_dir>/scripts/inventory.mjs --mode catalog --root . \
  --report-dir "${CACHE_PATH:-var/agent/cache}/skill-review" --run-mode full
```

Raport `catalog-report.json` i `catalog-report.md` powstaje wyłącznie w
`CACHE_PATH` i nie zmienia repozytorium. Pełny review dopełnij przez
`--review-file <cache>/review.json` z polami `findings`, `standard_gaps`
i `verdict`, a deltę audytu licz przez `--previous <poprzedni catalog-report.json>`.

### 3. Zastosuj checklistę

Zastosuj sekcję checklisty właściwą dla targetu. Dla każdego wymiaru ustal
status: `OK`, `FINDING`, `STANDARD_GAP` albo `NOT_APPLICABLE`. Opisy agentów
traktuj jako metrykę (długość, język, trigger) — bez twardego progu długości.

Dla targetu `catalog` zastosuj `<skill_dir>/references/catalog-checklist.md`, oceń każdy
obszar raportu i potwierdź sygnały jako findings dopiero po bramce evidence.
Nie zamieniaj metryk na sztuczne limity liczbowe i deklaruj pokrycie obszarów
`covered`, `partial` oraz `not_covered` z powodami.

### 4. Bramka evidence

- Każdy kandydat na finding musi zostać potwierdzony punktowym odczytem
  dokładnego pliku i linii (`file:line`).
- Odczyt służy wyłącznie weryfikacji kandydata; nie powtarzaj szerokiego
  discovery, nie czytaj całego katalogu i nie rozszerzaj zakresu.
- Finding bez evidence nie jest publikowany; sprzeczne evidence odrzuca
  kandydata.
- Ograniczenia pokrycia raportuj jawnie jako `NOT_COVERED` wraz z powodem.

### 5. Format wyniku

Dla każdego findingu:

```text
F<n> [SEVERITY] Krótki tytuł — path/to/file.md:line
- Behavior: co jest nie tak
- Impact: dlaczego to ma znaczenie
- Evidence: konkretny plik, linia, test lub kontrakt
- Recommendation: zwięzły kierunek zmiany (dla QUESTION: Needs decision)
- Confidence: high / medium / low
```

Severity: `BLOCKER`, `MAJOR`, `MINOR`, `QUESTION`, `SUGGESTION` — skala jak
w `$code-review`. `SUGGESTION` nie blokuje i nie zmienia werdyktu.

Następnie podaj:

- **Target** — `skill` / `rules` / `agents`, artefakt i zakres;
- **Coverage** — obszary sprawdzone, `NOT_COVERED` i wynik checklisty;
- **Standard gaps** — propozycje zmian standardu z uzasadnieniem; bez edycji
  plików i bez decyzji po stronie tego skilla;
- **Verdict** — `PASS` (brak findings), `PASS WITH CAVEAT` (tylko `MINOR`),
  `CHANGES REQUESTED` (co najmniej `MAJOR`), `DISCUSS` (otwarte `QUESTION`
  albo luka pokrycia wpływająca na ocenę).

Gdy nie ma findings, napisz jawnie `No findings.` przed szczegółami i wskaż
najsilniejszą pozostałą lukę pokrycia.

Dla targetu `catalog` zapisz wynik w sekcji `review` raportu w `CACHE_PATH`
i podaj w odpowiedzi Coverage, Delta oraz Verdict. Nie zmieniaj plików
repozytorium.

## Przykłady

- `$skill-review` — zaudytuj `.agents/skills/code-implement/SKILL.md` w trybie `conformance`.
- `$skill-review` — zaudytuj `.opencode/agents/implementation-worker.md` pod kątem frontmattera, opisu i relacji z konfiguracją.
- `$skill-review` — sprawdź `AGENTS.md` i bloki instrukcji w `README.md` (target `rules`).
- `$skill-review` — zaudytuj cały katalog (target `catalog`, `--run-mode full`) i oceń relacje oraz triangulację.
- `$skill-review` — zgłoś `standard-gap` dla wymiaru, którego standard nie opisuje.
