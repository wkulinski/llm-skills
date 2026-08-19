# Benchmark: `context-scout-fast` vs inline discovery

## Status i konkluzja

> **Audyt statusu (2026-08-03):** historyczne liczby poniżej nie są dowodem
> wydajności canonical hybrid. Zostały zachowane jako artefakty audytu, ale ich
> klasa i ograniczenia muszą pozostać jawne.

| Cohort / artefakt | Status | `harness_class` | Powód klasyfikacji |
|---|---|---|---|
| controlled fast v4 | `INVALID` dla canonical flow | `legacy-experimental` | Używał `opencode run`, tymczasowych adapterów `mode: primary` i współdzielonego `report.json` dla primary/fallback. |
| controlled inline v1 | `VERIFIED_EXPERIMENTAL` | `inline-discovery` | Poprawny eksperyment porównawczy, ale nie implementuje helperowego native-task hybrid. |
| `.owe/benchmarks/baseline.json` | `VERIFIED_EXPERIMENTAL` wyłącznie dla fixture/local CLI | `fixture-only` | Artefakt nie zawiera sesji OpenCode, canonical lifecycle ani kompletnego snapshot contract; nie służy do porównania hybrid. |

`protocol_version` dla wymienionych historycznych artefaktów: `unknown/legacy`.
Brak pełnego `snapshot.json`, `runner_commit`, jawnej dostępności CMM i dowodu
izolacji oznacza, że nie wolno przedstawiać ich jako `VERIFIED_CANONICAL`.

### Minimalny smoke canonical equivalence (2026-08-03)

Na trzech fixture (`a,b,c`, po jednej próbie) uruchomiono ten sam task envelope
przez canonical `prepare → claim → native task → settle → fallback → settle`
oraz przez inline. Workspace pozostał niezmieniony (`220` plików, ten sam hash).

| Gate | Wynik |
|---|---:|
| Hybrid final valid | `3/3` |
| Hybrid primary valid | `0/3` |
| Hybrid fallback used | `3/3` |
| Inline valid | `2/3` |
| Criteria coverage dla raportów | `3/3` |
| OWE cost, canonical | `$0.5015972` |
| OWE cost, inline | `$0.2890048` |
| Średnia latencja canonical | `274.2 s` |
| Średnia latencja inline | `133.2 s` |

Smoke nie przeszedł bramki równoważności jako całość: inline fixture `b` miała
raport `COMPLETE`, ale validator odrzucił go za brak wymaganego evidence.
Dla `a` i `c` criteria były kompletne po obu stronach. Wynik tego smoke nie
potwierdza oszczędności obecnego canonical hybrid; w tym środowisku fallback
uruchomił się w każdej próbie i kosztował więcej niż inline. To mały wynik
diagnostyczny, nie stabilny benchmark wydajności.
Smoke sprawdzał równoważność kryteriów i evidence contract, nie pełne
podstawienie raportu w dalszym workflow parenta; ten drugi test pozostaje poza
minimalnym zakresem.
Brak outputu primary jest osobnym hard gate (`PRIMARY_OUTPUT_MISSING`); fallback
może zapewnić dostępność usługi, ale nie może zamaskować awarii uruchomienia
primary w ocenie oszczędności.

### Rerun po włączeniu hostingu China (2026-08-03)

Po włączeniu przez użytkownika opcji `Enable models hosted in China` powtórzono
ten sam smoke (`a,b,c`, po jednej próbie) bez zmiany task envelope.

| Gate / metryka | Canonical hybrid | Inline |
|---|---:|---:|
| Valid final reports | `3/3` | `3/3` |
| Primary valid | `3/3` | — |
| Fallback used | `0/3` | — |
| Criteria-level equivalence | `PASS` | `PASS` |
| OWE cost | `$0.123907411` | `$0.346243400` |
| Średnia latencja | `197.3 s` | `177.1 s` |

Po usunięciu błędu regionalnego hybrid był około `64.2%` tańszy przy cenach ze
snapshotu OWE z 2026-07-28, ale średnio `11.4%` wolniejszy. To potwierdzało
oszczędność kosztową dla małego cohortu, ale nie było jeszcze stabilnym
benchmarkiem statystycznym ani pełnym testem downstream substitution.

### Rerun po aktualizacji cen OpenAI (2026-08-03)

Ten sam cohort (`a,b,c`, po jednej próbie) policzono ponownie z aktualnym
`.owe/pricing.json` po obniżce cen Luna/Terra. Oba ramiona przeszły criteria,
primary wykonał się `3/3`, a fallback nie został użyty.

| Metryka | Canonical hybrid | Inline |
|---|---:|---:|
| OWE cost | `$0.039599431` | `$0.056545360` |
| Średnia latencja | `156.8 s` | `126.6 s` |

Po korekcie cen przewaga kosztowa wynosi około `30.0%`, a hybrid jest około
`23.9%` wolniejszy. Stare wyniki pozostają porównywalne wyłącznie z użyciem
snapshotu `.owe/pricing-history/2026-07-28-openai-gpt-5.6-luna-terra.json`.

### Cohort 5×3 po aktualizacji OWE (2026-08-03)

Uruchomiono `a,b,c` po pięć powtórzeń. Wszystkie 15 prób hybrid zakończyło się
primary success bez fallbacku; wszystkie 15 prób inline przeszły validator.
OWE zakończył analizę obu ramion (`15` rootów canonical + `15` child sessions,
`15` rootów inline).

| Metryka | Canonical hybrid | Inline |
|---|---:|---:|
| Valid reports | `15/15` | `15/15` |
| Fallbacks | `0/15` | — |
| OWE cost | `$0.206727970` | `$0.291401520` |
| Średnia latencja | `160.5 s` | `109.6 s` |

Hybrid był około `29.1%` tańszy, ale średnio `46.4%` wolniejszy. Cohort został
dokończony po timeoutcie procesu nadrzędnego: część inline uruchomiono w
kontynuacji z concurrency `2`, więc latency traktujemy jako wynik orientacyjny;
koszt i poprawność raportów są pełne.

Benchmark porównywał koszt uzyskania finalnego, zwalidowanego raportu kontekstu
repozytorium. Nie mierzył późniejszego wykorzystania raportu przez głównego
agenta; raport był traktowany jako finalny produkt tego zadania.

W kontrolowanym cohort A/B/C × 3 `context-scout-fast`:

- dostarczył 9/9 poprawnych raportów końcowych;
- użył fallbacku w 1/9 przypadków;
- zachował niezmieniony snapshot i nie delegował dalej;
- był około 6,17× tańszy od inline według wycenionego OWE;
- był około 21% szybszy end-to-end średnio;
- wygenerował krótsze raporty, które w zakresie jawnie zdefiniowanych kryteriów
  były merytorycznie równoważne raportom inline.

Wynik kosztowy fast ma niższą pewność niż inline, ponieważ OWE oznaczył jego
raport jako `incomplete`, mimo że wycenił wszystkie 275 kroków. Jest to jednak
silny wynik kierunkowy na rzecz używania fast dla zadań targeted.

## Pytanie badawcze

Początkowe pytanie brzmiało, czy tani subagent rzeczywiście zmniejsza zużycie
drogich tokenów głównego agenta, czy tylko przenosi koszt do późniejszego
follow-upu.

W toku analizy doprecyzowano granicę pomiaru:

> Follow-up parenta nie jest automatycznie kosztem „obróbki raportu”. Pomiar
> oparty wyłącznie na tym, że kroki parenta wystąpiły po zakończeniu childa,
> jest diagnostyczny, ale nie dowodzi związku przyczynowego.

Dlatego benchmark porównuje ten sam bounded task: uzyskanie kompletnego raportu
evidence. Nie porównuje restricted parent-tool, który tylko przekazuje wynik,
z pełnym inline taskiem.

## Historia eksperymentu

### 1. Scout-lite

Pierwszy prototyp `scout-lite` zwracał minimalny evidence plan, a hostowy
compiler tworzył finalny raport. Był tani, ale raporty nie były parent-ready:

- findings często tylko powtarzały kryterium;
- compiler generował neutralne `Repository evidence located...`;
- modelowe claims były w praktyce odrzucane.

Wnioskiem nie było „DeepSeek nie potrafi tworzyć syntezy”, tylko „kontrakt lite
zabraniał syntezy”. Po udanym benchmarku fast cały eksperymentalny bundle lite
usunięto, aby nie utrzymywać równoległej, uboższej ścieżki.

### 2. Porównanie wcześniejszego hybrid z inline

Przejrzano 15 raportów hybrid i 15 raportów inline z wcześniejszego cohortu.
Hybrid był w 13/15 przypadków równoważny albo bogatszy, ale dwa raporty zawierały
fałszywe twierdzenia negatywne, m.in. o braku testu lub pliku.

Sam status `COMPLETE` nie wystarczał, ponieważ wcześniejszy validator sprawdzał
głównie strukturę raportu, ścieżki i kryteria.

### 3. Deterministyczna bramka evidence

Dodano do `criteria.json` opcjonalne pola:

```json
{
  "id": "C1",
  "description": "Map the primary agent definition.",
  "forbid_negative_claims": true,
  "required_evidence": [
    {
      "path": ".opencode/agent/context-scout-fast.md",
      "anchors": ["permission:"]
    }
  ]
}
```

`required_evidence` wymaga dokładnego `path` albo `path_prefix`, opcjonalnej
relacji i literalnych anchors w evidence tego samego criterion. Validator
odrzuca raport `COMPLETE`, jeśli wymaganie nie jest spełnione.

`forbid_negative_claims` odrzuca w raporcie `COMPLETE` twierdzenia typu:
`does not exist`, `is missing`, `no test`, `brak`, `nie istnieje`, `jedyny`.

To nie jest pełna ocena semantyczna, ale eliminuje znaną klasę błędów przy
minimalnym koszcie i bez kolejnego modelowego verifiera.

## Kontrolowane parametry

### Wspólny snapshot

Oba ramiona użyły tego samego snapshotu:

- SHA-256: `96315f7bd3302921469058ad0b1319dc9c7b1ec2e3d08a7a2bd1d0d33b6d6eeb`;
- 219 plików źródłowych;
- snapshot fast pozostał niezmieniony po wszystkich uruchomieniach;
- każdy przypadek był świeżą root session OpenCode;
- concurrency: `1`;
- warianty: A, B, C;
- repetitions: `3` na wariant.

Artefakty:

- fast: `/tmp/opencode/context-scout-live/controlled-fast-v4/`;
- inline: `/tmp/opencode/context-scout-live/controlled-inline-v1/`;
- OWE fast: `/tmp/opencode/context-scout-live/owe-controlled-fast-v4/report.json`;
- OWE inline: `/tmp/opencode/context-scout-live/owe-controlled-inline-v1/report.json`.

### Reprodukcja krok po kroku

Fixture użyty w benchmarku jest przechowywany w repozytorium pod:

`docs/benchmark/fixtures/context-scout-live/`

Zawiera `manifest.json` oraz dla każdego wariantu `prompt.txt`, `handoff.json`
i wzbogacone `criteria.json`. Katalogi output muszą być nowe albo wcześniej
usunięte; runner nie nadpisuje istniejącego snapshotu.

```bash
FIXTURE_ROOT=docs/benchmark/fixtures/context-scout-live
FAST_OUT=/tmp/opencode/context-scout-live/reproduction-fast
INLINE_OUT=/tmp/opencode/context-scout-live/reproduction-inline

node .agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-fast.mjs \
  --fixture-root "$FIXTURE_ROOT" \
  --output-dir "$FAST_OUT" \
  --repetitions 3 \
  --concurrency 1 \
  --fallback true

node .agents/skills/opencode-workflow-economics/benchmarks/run-inline-scout.mjs \
  --fixture-root "$FIXTURE_ROOT" \
  --output-dir "$INLINE_OUT" \
  --snapshot-dir "$FAST_OUT/snapshot" \
  --repetitions 3 \
  --concurrency 1
```

Następnie należy sprawdzić:

```bash
node -e 'const s=require("/tmp/opencode/context-scout-live/reproduction-fast/summary.json"); console.log(s.gates, s.snapshot, s.session_ids)'
```

Koszt należy pobierać wyłącznie przez OWE, używając wszystkich `session_ids` z
fast summary oraz session IDs odczytanych z `events.jsonl` inline. Przykład:

```bash
node .agents/skills/opencode-workflow-economics/scripts/owe.mjs prepare \
  --directory "$PWD" \
  --analysis-dir /tmp/opencode/context-scout-live/owe-reproduction-fast \
  --content compact \
  --server auto \
  --session <fast-session-id-1> \
  --session <fast-session-id-2>

node .agents/skills/opencode-workflow-economics/scripts/owe.mjs prepare \
  --directory "$PWD" \
  --analysis-dir /tmp/opencode/context-scout-live/owe-reproduction-inline \
  --content compact \
  --server auto \
  --session <inline-session-id-1> \
  --session <inline-session-id-2>
```

Nie wolno sumować kosztu bieżącej sesji agenta ani używać `$0.1537` z dawnego
restricted parent-tool probe. To była dolna granica adaptera, a nie koszt tego
samego zadania.

### Reprodukcja dokładnie historycznego snapshotu

Powyższe polecenia odtwarzają ten sam protokół, fixture i parametry. Nie
odtwarzają automatycznie identycznych bajtów historycznego snapshotu, ponieważ
benchmark kopiował stan workspace zawierający także niecommitowane zmiany.
Dokładna reprodukcja historycznego cohortu wymaga zachowania snapshotu o SHA-256
`96315f7b...` albo odtworzenia tego samego HEAD-a oraz tego samego dirty diffu.
Nowy benchmark powinien zawsze zapisać i porównać własny `snapshot.sha256`.

### `context-scout-fast`

- model primary: `opencode-go/deepseek-v4-flash`;
- thinking: disabled;
- limit primary: 48 kroków;
- targeted budget: maks. 6 plików, 3 symbole, 2 testy/komendy;
- cross-layer budget: maks. 10 plików, 5 symboli, 3 testy/komendy;
- jeden kompaktowy finding na criterion;
- maksymalnie trzy zakresy evidence na finding;
- obowiązkowy `batch-render`;
- `required_evidence` i `forbid_negative_claims` jako hard gates;
- brak delegacji zewnętrznych;
- fallback: osobna root session na `openai/gpt-5.6-luna`, wariant low,
  limit 36 kroków.

Runner fast tworzył tymczasowe primary/fallback adapters w snapshotcie,
ponieważ OpenCode traktuje pliki `mode: subagent` jako niedostępne dla
bezpośredniego `opencode run --agent`. Pierwsza wersja benchmarku wykazała ten
problem: wywołanie subagenta z root session spadało do domyślnego agenta build.
Wynik tej wersji został odrzucony. Poprawiony runner używa świeżych adapterów
`mode: primary`, zachowując model i ograniczenia odpowiednich agentów.

Aktualny runner jest jawnie klasą `model-isolation` z protokołem
`legacy-model-isolation`; nie należy przedstawiać jego wyniku jako canonical
native-task hybrid. Zapisuje osobne `primary.report.json` i
`fallback.report.json`, przenosi nieudany primary do artefaktu discarded oraz
zapisuje `snapshot.json` z hashami, revision i stanem CMM. Dostępność CMM jest
jawna przez `CBM_BINARY`; bez tej zmiennej benchmark raportuje degradację do
direct discovery zamiast udawać obecność indeksu.

### Inline

- agent: `build`;
- model: `openai/gpt-5.6-luna`;
- swobodniejszy discovery;
- brak fallbacku;
- ten sam validator i te same enriched criteria;
- 9 root sessions.

## Wyniki jakościowe

| Metryka | Fast | Inline |
|---|---:|---:|
| Próby | 9 | 9 |
| Final `COMPLETE` + valid | 9/9 | 8/9 |
| Fallback | 1/9 | 0/9 |
| Task tools | 0 | 0 |
| Snapshot gate | PASS | ten sam snapshot |
| Findings średnio, wszystkie próby | 3,22 | 3,44 |
| JSON średnio, wszystkie próby | 3704 B | 3977 B |

Inline B3 zakończył się raportem `BLOCKED` i nie miał fallbacku. Fast w
analogicznie trudniejszym przypadku użył fallbacku, po czym dostarczył poprawny
raport końcowy.

Wśród tylko poprawnych raportów inline średnia wynosiła 3,88 findings i 4345 B.
Fast był więc około 15% mniejszy i miał około 17% mniej findings.

### Równoważność merytoryczna

Równoważność oceniano względem kryteriów i dowodów, a nie identyczności tekstu.

- **A — pricing:** fast i inline wskazały te same funkcje walidacji, wyboru tieru
  oraz testy cen i aliasów. Inline opisywał nieco szerzej przepływ.
- **B — cross-layer:** fast wskazał agenta, lifecycle, builder i testy. Inline
  rozdzielał część findings dokładniej, ale nie dostarczał innego kluczowego
  faktu.
- **C — targeted pricing:** oba raporty wskazały `selectRates`, próg
  `272001`, konfigurację `openai/model` i właściwy test regresyjny.

Wniosek: fast jest równoważny jako **bounded parent-ready context report**.
Nie jest równoważny jako pełna, szeroka narracja o całym repozytorium — celowo
zwraca mniej szczegółów.

## Wyniki wydajnościowe

Latencja fast uwzględnia primary oraz czas fallbacku, jeśli wystąpił.

| Metryka | Fast | Inline |
|---|---:|---:|
| Średnia end-to-end | 120,1 s | 152,8 s |
| Mediana | 95,0 s | 160,4 s |
| Średnia raportu | 3704 B | 3977 B |

Fast był około 21,4% szybszy średnio i 40,8% szybszy medianowo.

Fast wykonał więcej kroków/tool calls niż inline, ale na tańszym modelu i z
dużym udziałem cache. Sama liczba kroków nie jest więc właściwą metryką kosztu.

## Wyniki kosztowe

| Metryka | Fast | Inline |
|---|---:|---:|
| Root sessions | 10 | 9 |
| Model steps | 275 | 140 |
| Priced cost | `$0.195650162` | `$1.207427000` |
| Koszt próby | `$0.0217389` | `$0.1341586` |
| Status OWE | `incomplete` | `complete` |

Według wycenionych wartości fast był około 6,17× tańszy, czyli redukcja wyniosła
około 83,8%.

Rozbicie fast:

- 9 sesji DeepSeek primary: `$0.083549562`;
- 1 sesja fallback Luna: `$0.112100600`.

Bez fallbacku sam primary kosztowałby około `$0.00928` na próbę, ale cohort
miałby tylko 8/9 poprawnych rezultatów. Fallback jest więc częścią realnego
kosztu jakości, a nie dodatkiem do pominięcia.

OWE fast oznaczył całość jako `incomplete`, mimo że 275/275 kroków było
wycenionych. Inline ma kompletny status kosztowy. Z tego powodu koszt fast jest
wiarygodnym sygnałem kierunkowym, ale przed deklaracją stabilnej oszczędności
warto powtórzyć cohort x5 z tym samym izolowanym runnerem.

## Wnioski

### Co zostało potwierdzone

1. Nie jest to wyłącznie efekt błędnego pomiaru follow-upu.
2. Tani fast może wygenerować raport parent-ready, nie tylko listę ścieżek.
3. Deterministyczne `required_evidence` i `forbid_negative_claims` skutecznie
   blokują znane klasy błędów.
4. Fallback pozwala utrzymać 100% poprawnych finalnych raportów w tym cohort.
5. Koszt i latencja są istotnie niższe niż w inline na tym samym snapshotcie.

### Czego benchmark nie dowodzi

- Nie dowodzi pełnej semantycznej równoważności dla dowolnych zadań.
- Nie mierzy późniejszej pracy parenta korzystającego z raportu.
- Nie dowodzi stabilnego kosztu na podstawie jednego cohortu x3.
- Nie dowodzi, że cross-layer nigdy nie wymaga pełnego fast lub fallbacku.

### Decyzja routingowa

Rekomendowane użycie:

- **targeted/local:** compact `context-scout-fast` jako domyślna ścieżka,
  zawsze z deterministic gate i fallbackiem;
- **cross-layer:** na razie zachować pełny fast albo używać compact fast jako
  ścieżki eksperymentalnej z monitoringiem fallbacków;
- **negative/exhaustive claims:** wymagać jawnych `required_evidence` albo
  pozostawić zadanie pełnemu fast;
- **monitorować:** fallback rate, invalid reports, gate failures, koszt
  fallbacku i przypadki ponownego discovery przez parenta.

## Zmiany w repozytorium

Najważniejsze elementy rozwiązania:

- `.opencode/agent/context-scout-fast.md` — kompaktowy kontrakt;
- `.agents/skills/_shared/scripts/context-criteria.mjs` — walidacja enriched
  criteria;
- `.agents/skills/_shared/scripts/context-scout-report.mjs` — deterministic
  semantic gate;
- `.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs` — canonical
  lifecycle i przekazywanie kryteriów;
- `.agents/skills/opencode-workflow-economics/benchmarks/run-context-scout-fast.mjs`
  — kontrolowany runner fast;
- `tests/skills/_shared/context-scout-report.test.mjs` i powiązane testy
  kontraktowe.

Eksperymentalny bundle `scout-lite` został usunięty po potwierdzeniu, że fast
może dostarczać tę samą klasę parent-ready outputu przy niższym koszcie.

## Weryfikacja implementacji

- testy kontraktowe i gate: **48/48 PASS** w ostatnim cleanupie;
- runner fast: **19/19 PASS**;
- `node --check`: PASS;
- `git diff --check`: PASS;
- pełne `$qa-run`: nieuruchamiane, ponieważ benchmark dotyczył punktowego
  workflow i nie był prośbą o pełne QA.
