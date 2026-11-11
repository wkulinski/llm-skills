# Zewnętrzne review planu

Czytaj przed każdą rundą read-only review planu (sekcja 5 `SKILL.md`): pełnym
review kandydata i każdym delta-review. Mechanizm uruchamia review w osobnej
sesji agenta przez Paseo. Format zlecenia, kolejność prób i decyzje helpera
opisuje `<skills_root>/_shared/references/review-session-contract.md`.

Każde `next.action: self` oznacza powrót do dotychczasowego review bieżącego
agenta (sekcja 5 `SKILL.md`) dla tej samej rundy. Nie blokuje to planu, nie
zmienia budżetu rund ani tabeli werdyktów.

Wszystkie wyniki poleceń zapisuj do plików w `<CACHE_PATH>/task-plan/`
(przekierowaniem `>`), nie filtruj ich potokami.

## 1. Żądanie review

Zapisz `review-request-<plan-id>-r<revision>.json` z polami wejścia `decide`,
których nie ocenia reviewer:

- pierwsze review: `review_scope: full`, `full_review_count: 1`,
  `delta_review_count: 0`, `plan` (`plan_id`, `revision`, `content_sha256`
  z ostatniego `validate`, `save` albo `edit`) i `previous_findings: []`;
- każde kolejne review: `review_scope: full` albo `delta` według zmian,
  zwiększony o jeden odpowiedni licznik, drugi bez zmian, `delta_review`
  (niezmieniony wynik `review-cycle.mjs delta-input --file`) i `previous_findings`.
  Artefakt zmiany jest wymagany także dla ponownego pełnego review: wiąże je
  z bazą, aktualną rewizją i wcześniejszymi ID, nie ogranicza jego zakresu.

Dodaj `review_scope_reason` z krótkim uzasadnieniem zakresu. Zmiana kierunku,
ownership, modelu danych, zachowania publicznego, kryteriów akceptacji albo
granic, zależności lub kolejności WP wymaga `full`; lokalna korekta — `delta`.
Suma obu liczników nie przekracza czterech. Każdy profil uruchamiany w tej
samej rundzie otrzymuje te same liczniki i zakres; próba innego profilu nie
jest nową rundą review.

Zasady liczników i pól opisuje kontrakt planu, sekcja „Wejście
`review-cycle.mjs decide`”.

## 2. Przygotowanie rundy

Wygeneruj UUID jako `job_id`. W pierwszej rundzie nowego cyklu pomiń
`--previous-job`; w każdej kolejnej rundzie tego cyklu (także pełnej) przekaż
ostatni zakończony `job.json`, jeśli powstał. Gdy dotychczasowe rundy nie
utworzyły żadnego joba, pomiń flagę. Nie używaj nowego cyklu do ponawiania awarii
wewnątrz budżetu bieżącego cyklu.

```text
prepare ... --previous-job <ostatni_zakończony_job.json>
```

Przykład pierwszej rundy:

```bash
node <skills_root>/_shared/scripts/review-session-job.mjs prepare \
  --prefix PLAN_REVIEW --kind plan-review --job-id <uuid> \
  --task <skill_dir>/references/external-review-task.md \
  --context ./docs/plans/<plan-id>.md \
  --context <source_artifact> \
  --context <CACHE_PATH>/task-plan/review-request-<plan-id>-r<revision>.json \
  > <CACHE_PATH>/task-plan/review-prepare-<uuid>.json
```

`<source_artifact>` pochodzi z front matter planu. Dodaj `--context` także dla
`context_report` i `context_criteria`, jeśli front matter je wskazuje. W każdym
review po pierwszym dodaj też `--context <raport_ostatniej_rundy>` zgodnie
z sekcją 5 poniżej: zawiera opis, lokalizacje i dowody wcześniejszych findings,
których same ID i severity nie przenoszą. Raport ostatniej rundy i poprzedni
job to osobne referencje; po self-review nie używaj starszego raportu zewnętrznego.
Odczytaj też `prepare.warnings`: przy najbliższym komunikacie postępu lub
wyniku krótko poinformuj użytkownika o pominiętych wadliwych profilach i brakujących
kluczach, bez wartości env, pytania ani zatrzymania. Puste profile nie wymagają
komunikatu. Wynik `self` (`NOT_CONFIGURED`, `NO_VALID_PROFILES`, `CONFIG_INVALID`)
kończy mechanizm dla tej rundy. Tak samo traktuj `CYCLE_PROFILES_EXHAUSTED`.
Odczytaj `prepare.skipped_profiles` i krótko zaznacz pomijanie profili znanych
jako niedostępne w tym cyklu, bez powtarzania pełnych ostrzeżeń. Zachowaj
`job_path` po każdej przygotowanej rundzie; przy `job_path: null` zachowaj
poprzednią referencję. Pamięć awarii przechodzi także przez rundy self-review.
Brak/niezgodność poprzednika wymaga self-review i krótkiej informacji, bez
resetowania drabinki w trwającym cyklu.

## 3. Próba

Dla `next.action: launch` ustal Paseo przez `resolve_tool_cmd paseo` z
`<skills_root>/_shared/scripts/env-load.sh`. Brak Paseo oznacza review bieżącego
agenta bez dalszych kroków. Uruchom sesję z parametrów `next.launch`:

```bash
source <skills_root>/_shared/scripts/env-load.sh
PASEO="$(resolve_tool_cmd paseo)"
"$PASEO" run --no-wait -q --provider <provider> --model <model> --thinking <thinking> \
  --mode <mode> --cwd <cwd> --title "<title>" "$(cat <prompt_path>)" > <job_dir>/session-<attempt>.txt
"$PASEO" inspect "$(cat <job_dir>/session-<attempt>.txt)" --json > <job_dir>/inspect-launch-<attempt>.json
node <skills_root>/_shared/scripts/review-session-job.mjs bind-session \
  --job <job_path> --inspect <job_dir>/inspect-launch-<attempt>.json \
  [--parent-id "$PASEO_AGENT_ID"] > <job_dir>/bind-<attempt>.json
```

`--mode` jest wymagany dla każdego uruchamianego profilu. `--parent-id` podaj tylko wtedy, gdy `PASEO_AGENT_ID` jest ustawione. Nieudane
`paseo run` zapisz przez `record-failure --reason LAUNCH_FAILED`; gdy przyczyną
jest odrzucenie ustawień profilu, zgłoś je użytkownikowi przy okazji komunikatu
postępu i przejdź do kolejnego profilu według `next`, bez pytania i zatrzymania. Sesja z `PendingPermissions` oznacza, że ustawiony tryb nie pozwala na pracę
bez nadzoru: zatrzymaj tę sesję, zapisz porażkę przez `record-failure --reason
LAUNCH_FAILED`, krótko zgłoś problem i wykonaj `next`. Nie czekaj na poprawienie
env ani zatwierdzenie uprawnienia przez użytkownika. Wynik
`bind-session` z `ok: false` oznacza niezgodną sesję: zatrzymaj ją
(`paseo stop <id>`) i wykonaj jego `next`.

Po `next.action: wait`:

```bash
"$PASEO" wait <session-id> --timeout <wait_timeout_seconds> --json > <job_dir>/wait-<attempt>.json
"$PASEO" inspect <session-id> --json > <job_dir>/inspect-final-<attempt>.json
"$PASEO" logs <session-id> --filter text --tail 1 > <job_dir>/envelope-<attempt>.txt
node <skill_dir>/scripts/review-cycle.mjs accept-session \
  --job <job_path> --envelope <job_dir>/envelope-<attempt>.txt \
  --inspect <job_dir>/inspect-final-<attempt>.json \
  --request <CACHE_PATH>/task-plan/review-request-<plan-id>-r<revision>.json > <job_dir>/accept-<attempt>.json
```

Gdy `wait` przekroczy limit, wykonaj `paseo stop <session-id>`, sprawdź przez
`inspect`, czy sesja nie pracuje, i zapisz `record-failure --reason
TIMEOUT_STOPPED` albo `TIMEOUT_STOP_UNCONFIRMED`. Sesję zakończoną błędem
providera (np. wyczerpany limit tokenów) bez koperty zapisz jako
`PROVIDER_ERROR`; brak lub niepoprawna koperta przy `accept` daje to samo
przejście do kolejnej próby. Każdy wynik wykonuj według jego `next`.

Podczas review nie zmieniaj planu ani powiązanych wejść. Zmiana daje `STALE` i
review bieżącego agenta dla aktualnego stanu.

`accept-session` sprawdza także payload przez walidację `decide`, zanim helper
zapisze wynik jako `ACCEPTED`. `REPORT_PAYLOAD_INVALID` przechodzi do kolejnego
profilu albo `self`; nie zapisuj takiego wyniku przez `record-review`.
Poprawny `PLAN DISCUSS`/`PLAN BLOCKED` i findings wymagające naprawy kończą próby;
nie są błędem protokołu. Błąd powiązania żądania pozostaje twardym błędem —
nie rekonstruuj liczników ani hashy.

## 4. Decyzja

Po `next.action: evaluate`:

```bash
node <skill_dir>/scripts/review-cycle.mjs ingest \
  --result <job_dir>/result.json \
  --request <CACHE_PATH>/task-plan/review-request-<plan-id>-r<revision>.json \
  > <CACHE_PATH>/task-plan/review-decision-<uuid>.json
node <skill_dir>/scripts/store.mjs record-review --file ./docs/plans/<plan-id>.md \
  --input <CACHE_PATH>/task-plan/review-decision-<uuid>.json --root "$PWD"
```

Przed działaniem odczytaj pełne `report_markdown` i `payload` z `result.json`.
Decyzja zawiera ID, ale nie opis naprawy: dla każdego actionable ID połącz
finding z jego lokalizacją, dowodem i zaleceniem w raporcie. Nie odtwarzaj
opisu z samego werdyktu. Zalecenia w podsumowaniu review nie zmieniają procedury:
owner nadal wykonuje wymagane `record-review` i delta-review po naprawie. Brak opisu uniemożliwiający naprawę to luka evidence.
Po `apply-repair` zapisz decyzję jako bazę review, popraw plan, zwaliduj go i
zbuduj `delta-input --file`. Do następnego żądania przenieś nierozwiązane
findings z ich oryginalnymi ID i klasyfikacją z payloadu, a nie z listy samych
`actionable_finding_ids`. Następnie wykonaj nowe review i ponowne `record-review`.

`ingest` bierze z raportu tylko werdykt, findings i rozstrzygnięcia wcześniejszych
ID; liczniki, referencję planu i delta pobiera z powiązanego żądania. Nie
poprawiaj ocen reviewera ręcznie. Gdy uznajesz finding za błędny, traktuj go
jak każdy inny: rozstrzygalny fakt naprawiasz w planie albo pokazujesz dowód w
kolejnej rundzie, decyzję biznesową zamieniasz w pytanie `[open]`.

Dalsze działanie wynika z decyzji helpera i tabeli werdyktów w sekcji 5
`SKILL.md`. Każda kolejna runda (pełna albo delta) to nowe żądanie i nowy `job_id`,
połączony z istniejącym poprzednikiem przez `--previous-job` według sekcji 2.
Nowy cykl po końcowej decyzji
`ready` albo `blocked` pomija tę flagę i ponownie dopuszcza wszystkie profile.

Gdy runda kończy się review bieżącego agenta, `decide` bez pola `reviewer`
zapisuje je jako `self`. W handoffie podaj, kto wykonał ostatnie review
(`review_reviewer` w front matter), a przy `self` także powód z `next.reason`.

## 5. Raport do kolejnej rundy

Przed naprawą planu zachowaj raport ostatniej ukończonej rundy i przekaż jego
ścieżkę w handoffie, niezależnie od referencji do ostatniego zakończonego joba:

- Po przyjętym review zewnętrznym raportem jest istniejący
  `<job_dir>/result.json` z `report_markdown` i `payload`.
- Po self-review zapisz `<CACHE_PATH>/task-plan/review-self-<uuid>.json`
  z `reviewer: {"mode": "self"}`, referencją `plan` do recenzowanej rewizji
  (`plan_id`, `revision`, `content_sha256`), pełnym `report_markdown` oraz
  `payload` (`verdict`, `findings`, `previous_resolutions`) zgodnym z wejściem
  użytym do `decide`. Raport zawiera lokalizacje, dowody i zalecenia dla findings.
  Użyj nowego UUID dla każdej rundy; nie nadpisuj wcześniejszych raportów.

Raport self-review służy jako kontekst następnego review; nie przekazuj go do
`ingest`, które wymaga wyniku `ACCEPTED`. Nie twórz zastępczego `result.json`
w katalogu joba: helper nie zapisuje go dla `SELF` ani `job_path: null`.
W następnej rundzie `previous_findings` i raport muszą pochodzić z tej samej
ostatniej recenzji. Jeśli raportu brakuje, zgłoś lukę evidence i wykonaj
self-review; nie przekazuj nieistniejącego pliku do `prepare` ani nie zastępuj
raportu starszym wynikiem. Zachowaj przy tym istniejącą pamięć awarii jobów.
