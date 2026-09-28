# Checklista trybu `catalog`

Tryb `catalog` ocenia cały katalog instrukcji i relacje między artefaktami na
podstawie deterministycznego raportu kolektora. Checklista zbiorcza zastępuje
checklisty pojedynczych targetów: każdy obszar raportu oceniaj właściwą sekcją
`conformance-checklist.md`, a relacje i triangulację poniżej.

## Dane wejściowe

- Raport kolektora: `${CACHE_PATH:-var/agent/cache}/skill-review/catalog-report.json`
  oraz czytelniczy `catalog-report.md`.
- Tryb uruchomienia zapisany w polu `run_mode`:
  - `collector-only` — raport deterministyczny bez findings; nie publikuj
    werdyktu i nie interpretuj sygnałów jako ustaleń;
  - `full` — pełny review: potwierdź sygnały, uzupełnij sekcję `review`
    (`findings`, `standard_gaps`, `verdict`) i wskaż wybór trybu w raporcie.
- Delta: `--previous <poprzedni catalog-report.json>` liczy `changed`, `added`,
  `removed` i `unchanged`; zmienione i dodane pliki są priorytetem przebiegu,
  a `unchanged` może być deklarowane jako pokryte hashem bez ponownego odczytu.

## Zasady interpretacji

1. **Bramka evidence.** Sygnały kolektora to kandydaci, nie findings. Każdy
   finding potwierdź punktowym odczytem dokładnego pliku i linii (`file:line`).
   Odczyt służy wyłącznie weryfikacji kandydata; nie powtarzaj szerokiego
   discovery i nie rozszerzaj zakresu.
2. **Zakaz sztucznych limitów liczbowych.** Nie zamieniaj metryk (długość opisu,
   liczba pinów, liczba krawędzi grafu) na progi, kwoty ani limity liczby
   findings. Ocena wynika z wpływu i evidence, a nie z arbitralnego progu.
3. **Deklaracja pokrycia.** Przepisz obszary `covered`, `partial` i
   `not_covered` z raportu. Obszar niepokryty raportuj jawnie z powodem; gdy
   luka wpływa na werdykt, werdykt to `DISCUSS`.
4. **Klasyfikacja standard-gap.** Gdy `skill-authoring-standard.md` ani
   checklista nie rozstrzygają przypadku, zgłoś `standard-gap` w formacie z
   `standard-gap.md`; nie rozstrzygaj luki samodzielnie i nie zmieniaj standardu.
5. **Read-only.** Audyt nie edytuje repozytorium; raport i sekcja `review` żyją
   wyłącznie w `CACHE_PATH`. Poprawki wymagają decyzji użytkownika i planu.

## Obszary raportu

| Obszar | Co ocenić |
|---|---|
| `metrics.skills` | kompletność indeksu, triggery opisów, budżet opisów (metryka bez progu), duplikaty bloków, deklaracje `shared_files`, pin testowy |
| `metrics.shared_files_graph` | brakujące i między-skillowe deklaracje; plik współdzielony bez odwołania; zależności `.mjs` bez deklaracji (`metrics.mjs_dependencies`) |
| `metrics.agents` + `metrics.agent_config` | plik bez wpisu w `opencode.jsonc`, wpis bez pliku (osierocony klucz), brak delegującego skilla, pin testowy, frontmatter bez `model`/`variant`/`thinking` |
| `metrics.rules` | duplikaty bloków i nagłówków, spójność `docs_map` ze ścieżkami, reguły runtime poza `.agents/skills/**`, nieaktualne lub bezwarunkowe zdania |
| `metrics.index` + `metrics.routing_policy` | triangulacja: polityka routingu ↔ opisy/triggery ↔ `docs/SKILLS.md` ↔ katalog na dysku |
| `metrics.language` | języki artefaktów; opis agenta jest metryką monitorowaną bez twardego progu |
| `metrics.model_names` | nazwy modeli w tekście normatywnym; odróżnij przypięcie od przykładu porównania i oceń intencję na podstawie kontekstu |

### Interpretacja metryk i luk pokrycia

- Listy duplikatów zawierają wszystkie wykryte, niezależne bloki; podbloki
  zawarte w dłuższym duplikacie są scalane, nie ograniczane kwotą wyników.
- `test_pins` skilla wskazuje literalne odwołania do jego kwalifikowanej ścieżki.
  Sam napis `SKILL.md` nie wiąże testu ze skillem. Pusta lista nie dowodzi braku
  testów: testy ogólnokatalogowe i ścieżki składane dynamicznie wymagają osobnej
  oceny, nie są automatycznie przypisywane do każdego skilla.
- Każdy wpis `metrics.rules.files` ma `coverage.status` i `coverage.reason`.
  `document-not-found` oznacza brak pliku, a `instruction-span-not-located` —
  nierozpoznany zakres instrukcji README, nie brak instrukcji. Obszar `rules`
  jest `covered` tylko po sprawdzeniu obu dokumentów, `partial` po sprawdzeniu
  jednego, a `not_covered`, gdy żadnego nie sprawdzono. Nie rozszerzaj automatycznie
  oceny na całe README, by zastąpić brak rozpoznanego bloku.
- `metrics.shared_files_graph.files` to pełny inwentarz regularnych plików
  `_shared`, także innych niż Markdown. `unreferenced_by_shared_files` zawiera
  pliki z tego inwentarza bez deklaracji `shared_files`. Obie listy mają ścieżki
  względem `skills_root`, tak jak `referenced_by`. Są to kandydaci do oceny,
  nie dowód nieużywania pliku ani automatyczne findings. Hashe tych plików są
  uwzględnione w `input.files` i delcie; ścieżki w `input.files` pozostają
  repo-relative. Brak katalogu `_shared` oznacza `not_covered` z powodem.

## Format wyniku

Findings i standard-gaps stosują format z `SKILL.md` i `standard-gap.md`
(severity, evidence `file:line`, rekomendacja, confidence). Po findings podaj:

- **Coverage** — obszary sprawdzone oraz `not_covered` z powodami;
- **Delta** — co zmienił się względem poprzedniego hasha i co pozostaje poza
  zakresem zmiany;
- **Verdict** — `PASS`, `PASS WITH CAVEAT`, `CHANGES REQUESTED` albo `DISCUSS`.

## Granice

- Kod, zmiany i plany → `$code-review`; dokumentacja domenowa → `$docs-sync`.
- Synchronizacja i edycja reguł lokalnych → `$rules-sync`; indeks skilli →
  `$skills-index-refresh`; tworzenie i zmiana artefaktów → `$task-plan` +
  `$code-implement`.
- Scope `consumer`, wartości `model`/`reasoning` i runtime behavior agentów
  pozostają poza oceną.
