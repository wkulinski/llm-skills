---
name: plan-execute
description: >-
  Wykonuje i wznawia gotowy plan Markdown z docs/plans/, wybiera bezpieczny
  dynamiczny batch WP, sprawdza dostępność konkretnego modelu/reasoning i zapisuje
  postęp oraz log atomowo w tym samym planie.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/symbolic-navigation-and-editing-policy.md
  - _shared/scripts/env-load.sh
  - task-plan/SKILL.md
---

# `$plan-execute`

## Reguły rozwiązywania ścieżek

- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.
- Plan gotowy do wykonania musi znajdować się pod `./docs/plans/`.
- Ostatni plan jest wskazywany wyłącznie przez
  `${CACHE_PATH:-var/agent/cache}/plan-execute/last-plan.txt`; plik zawiera
  jedną ścieżkę repo-relative, nigdy JSON, status WP ani kopię planu.

## Priorytet zasad

1. Instrukcje systemowe/developerskie środowiska.
2. `./AGENTS.md` i dokumenty z `docs_map`.
3. Bieżący `SKILL.md`.
4. `<skills_root>/task-plan/SKILL.md` oraz pliki wskazane w `shared_files`.

## Odpowiedzialność i granice

`$task-plan` projektuje i waliduje plan. `$plan-execute` nie zmienia jego
kontraktu, tylko uruchamia kolejny bezpieczny wycinek, deleguje implementację
zgodnie z `$code-implement` i zapisuje wynik w istniejącym Markdownie. Markdown
pozostaje jedynym źródłem stanu WP; nie twórz `state.json`, event store ani
drugiego ledgera.

Skill obsługuje jawne polecenia:

```text
Realizuj plan ./docs/plans/<plan>.md
Kontynuuj realizację planu ./docs/plans/<plan>.md
Kontynuuj realizację planu
```

Bez ścieżki użyj tylko poprawnego last-plan pointer. Brak pointera, jego
niepoprawna treść albo nieistniejący plan oznacz jako prośbę o jawną ścieżkę;
nie wyszukuj i nie wybieraj arbitralnie innego planu.

## Przebieg

### 1. Rozwiąż i zweryfikuj plan

1. Dla jawnej ścieżki sprawdź, że jest repo-relative, kończy się `.md` i leży
   pod `./docs/plans/`. Dla kontynuacji bez ścieżki odczytaj jedną linię
   `${CACHE_PATH:-var/agent/cache}/plan-execute/last-plan.txt` i zastosuj tę samą
   walidację.
2. Uruchom bez sieci:

   ```bash
   node <skills_root>/task-plan/scripts/validate.mjs validate \
     --file ./docs/plans/<plan>.md --root "$PWD"
   ```

   Plan musi mieć `status: ready`, poprawne `## Execution environment` i
   `## Execution`, jeden wiersz postępu dla każdego WP oraz wymagane
   `Estimated size`. Jeśli walidacja nie przejdzie, nie rozpoczynaj WP.
3. Sprawdź `git status --short` i bieżące zmiany. Nie cofaj, nie nadpisuj ani nie
   commituj ręcznych zmian; jeśli zmieniony jest sam plan lub jego artefakty,
   zatrzymaj się przed zapisem i wykonaj read-before-write.
4. Po skutecznym rozwiązaniu jawnej ścieżki zapisz pointer atomowo. Zapisz tylko
   ścieżkę, np. `docs/plans/example.md`.

### 2. Potwierdź środowisko wykonania

Rekomendacja planu jest konkretna, ale nie jest dowodem dostępności w bieżącej
sesji. Ustal entrypoint wyłącznie przez helper repo:

```bash
source ./.agents/skills/_shared/scripts/env-load.sh
OPENCODE_CMD="$(resolve_tool_cmd opencode opencode)"
"$OPENCODE_CMD" models
```

Porównaj wynik z `Default model`, `Default reasoning` i ewentualnym override WP
w planie. Widoczność reasoning musi być jawnie potwierdzona przez bieżącą sesję;
nie wyprowadzaj ukrytego wariantu z nazwy modelu. Jeśli modelu nie ma, reasoning
nie jest widoczny albo rodzina jest niedozwolona, poproś o jawne środowisko lub
nową sesję zamiast zgadywać i nie oznaczaj WP jako rozpoczętego.

Źródłem rankingu pozostaje `https://aicodingdaily.com/leaderboard`. Możesz
odczytać je przez `webfetch`, ale nie buduj parsera, lokalnej bazy ani stałej
punktacji. Gdy ranking chwilowo nie działa, użyj zapisanej w planie rekomendacji
tylko wtedy, gdy wskazany model i reasoning nadal są dostępne. W przeciwnym razie
żądaj jawnego środowiska. Domyślne rodziny to OpenAI, DeepSeek i Tencent;
Qwen jest dozwolony wyłącznie dla pracy jawnie oznaczonej `frontend-design`.
Projektowy override może rozszerzyć lub zawęzić tę politykę, ale musi być
zapisany w planie.

### 3. Wybierz dynamiczny batch

Nie używaj stałego podziału sesji ani arbitralnego progu. Dla aktualnego planu:

1. Rozważ tylko WP `pending` albo `in_progress`, których wszystkie zależności
   mają status `done`; WP z blokadą nie jest eligible.
2. Jeśli istnieje `in_progress`, najpierw kontynuuj ten aktywny wycinek.
3. Traktuj `Estimated size` jako koszt względny: `small=1`, `medium=2`,
   `large=3`. Pojemność batcha wynika z realnie pozostałego kontekstu bieżącej
   sesji, a nie z globalnego limitu. Wybierz uporządkowany prefiks eligible WP,
   który mieści się w tej pojemności; jeśli pierwszy nie mieści się, zwróć
   potrzebę nowej sesji.
4. Sprawdź dostępność środowiska dla każdego wybranego WP. Nie uruchamiaj
   części batcha, która nie spełnia kontraktu modelu/reasoning.
5. Jeśli wszystkie eligible WP mieszczą się w kontekście, możesz wybrać cały
   batch. Jeśli nie, zapisz decyzję i pozostałe WP zostaw do kontynuacji.

Przykład punktowego helpera:

```bash
node <skill_dir>/scripts/execute.mjs select \
  --path ./docs/plans/<plan>.md \
  --context-budget 3 \
  --available-models openai/gpt-5.6-luna \
  --reasoning max
```

### 4. Wykonaj WP zgodnie z `$code-implement`

Każdy aktywny WP mapuj na jedno wymaganie `R#`, jeden obserwowalny outcome,
jedną główną odpowiedzialność produkcyjną, jawne `Non-goals` i jeden punktowy
check. Przed delegacją `implementation-worker` spełnij całą bramkę z
`<skills_root>/code-implement/SKILL.md`; nie kopiuj jej kontraktu do nowego
sidecara. Jeśli batch ma kilka WP, zachowaj tę atomizację i wykonuj/raportuj je
sekwencyjnie w granicach pozostałego kontekstu.

Przed rozpoczęciem pracy oznacz wybrane WP jako `in_progress` i zapisz batch w
planie. Dzięki temu przerwanie sesji nie gubi próby. Nie kontynuuj automatycznie
po granicy sesji.

### 5. Zweryfikuj i zapisz wynik

WP może otrzymać status `done` wyłącznie, gdy zapisujesz datę i krótkie,
konkretne evidence w kolumnie `Verification`. Wynik `blocked` wymaga jawnego
powodu i rewizji planu przed wznowieniem; executor nie odblokowuje WP
automatycznie. Po każdym batchu:

1. uruchom check wskazany przez WP, używając reguł `$code-implement` i
   `targeted-check-decision.mjs`;
2. zapisz wynik przez `<skill_dir>/scripts/execute.mjs record`, który ponownie
   waliduje eligibility, dowód i zależności;
3. zaktualizuj atomowo cały Markdown przez istniejący `task-plan/store.mjs`;
4. dopisz próbę do `### Execution log` i odśwież `Status`/`Next WP`;
5. po statusie `complete` ogłoś ukończenie planu tylko wtedy, gdy każdy WP ma
   `done` oraz verification evidence. W przeciwnym razie raportuj następny WP,
   blokadę albo potrzebę nowej sesji.

Przykład zapisania wyników z pliku JSON:

```bash
node <skill_dir>/scripts/execute.mjs record \
  --path ./docs/plans/<plan>.md \
  --results-file ./var/agent/cache/plan-execute/results.json
```

Plik wyników jest wejściem jednorazowej komendy i nie staje się stanem planu.
Po zapisie źródłem prawdy pozostaje wyłącznie Markdown.

## Publiczny helper

`<skill_dir>/scripts/execute.mjs` jest wąskim adapterem do istniejącego
`task-plan`:

- `resolvePlanPath` — jawna ścieżka albo path-only pointer, z ochroną root i
  `docs/plans/`;
- `loadExecutionPlan` — odczyt i bezsieciowa walidacja planu;
- `selectBatch` — dependency/progress/size/context/environment gate;
- `writeLastPlanPointer` — atomowy zapis wyłącznie względnej ścieżki;
- `recordBatch` — eligibility, verification evidence, log i atomowy zapis przez
  `store.mjs`.

Helper nie uruchamia `opencode`, nie przełącza modelu, nie wykonuje WP, nie
tworzy branchy/commitów i nie przechowuje niezależnego statusu.

## Błędy i granice

- Brak/niepoprawny plan lub pointer → poproś o jawną ścieżkę.
- Niepoprawny kontrakt Markdown → zakończ bez zapisu.
- Niedostępny model, niewidoczny reasoning, niedozwolona rodzina lub zbyt mały
  kontekst → zgłoś konkretną potrzebę środowiskową/nowej sesji; nie zgaduj.
- Brak verification przy `done` albo niespełnione zależności → odrzuć zapis.
- Błąd atomowego zapisu → zachowaj poprzedni poprawny plan i zgłoś błąd.
- Skill nie robi pełnego `$qa-run`, commitów, pull requestów ani automatycznej
  kontynuacji po sesji.

## Weryfikacja

```bash
node <skill_dir>/scripts/execute.mjs --help
npm test -- tests/skills/plan-execute/plan-execute.test.mjs
node <skills_root>/task-plan/scripts/validate.mjs validate \
  --file ./docs/plans/<plan>.md --root "$PWD"
```

Testy helpera używają katalogów tymczasowych i sprawdzają: jawną ścieżkę,
last-plan continuation, blokadę środowiska, partial continuation, atomowy log,
odrzucenie `done` bez evidence oraz final completion.
