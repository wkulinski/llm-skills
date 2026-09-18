---
name: plan-execute
description: >-
  Wykonuje gotowy, zwalidowany plan task-plan sekwencyjnie: wybiera pierwszy
  niezakończony work package, przekazuje go do code-implement i zleca
  task-plan zapis ukończenia wraz z dowodem. Użyj, gdy użytkownik chce
  zrealizować istniejący plan (utworzony przez skill task-plan) krok po kroku,
  wskazuje WP albo prosi o kontynuację/wznowienie planu; nie używaj go do
  tworzenia nowego planu ani do bezpośredniej implementacji pojedynczej zmiany.
shared_files:
  - _shared/references/skill-routing-policy.md
  - _shared/scripts/model-hierarchy.mjs
---

# `$plan-execute`

## Cel i granice

`$plan-execute` jest prostym orkiestratorem pomiędzy gotowym planem a
`$code-implement`.

Wybór tego skilla wynika z
`<skills_root>/_shared/references/skill-routing-policy.md`: jeżeli użytkownik
prosi o wykonanie albo kontynuację istniejącego planu lub WP, `$plan-execute`
jest pierwszym workflow, nawet gdy WP wygląda jak pojedyncza zmiana kodu.

Odpowiedzialności są rozdzielone jednoznacznie:

- `$task-plan` jest jedynym właścicielem formatu, parsowania, walidacji i
  atomowego zapisu planu;
- `$plan-execute` rozwiązuje ścieżkę i wybiera pierwszy niezakończony WP;
- `$code-implement` implementuje i weryfikuje dokładnie jeden WP;
- `$plan-execute` nie edytuje Markdowna samodzielnie, tylko wywołuje operację `complete-wp` należącą do task-plan.

## Kontrakt wykonania

Plan przechowuje wyłącznie binarną informację o ukończeniu:

```md
## Execution

- [ ] WP1
- [x] WP2 — 2026-08-27 — focused test passed
```

- `[ ]` oznacza WP niezakończony;
- `[x]` oznacza WP zakończony i zweryfikowany;
- kolejność wpisów jest kolejnością wykonania;
- następny WP to pierwszy wpis `[ ]`;
- plan jest ukończony, gdy nie ma wpisów `[ ]`.

Nie zapisuj rozpoczęcia pracy, blokady ani stanu sesji do planu. Przerwane lub
zablokowane wykonanie pozostawia WP jako `[ ]`. Bieżący working tree i lokalny
stan `$code-implement` służą do wznowienia implementacji, ale nie są drugim
źródłem statusu planu.

## Rozwiązywanie planu

1. Jeśli użytkownik podał ścieżkę, użyj jej.
2. W przeciwnym razie odczytaj
   `${CACHE_PATH:-var/agent/cache}/plan-execute/last-plan.txt`.
3. Pointer musi zawierać dokładnie jedną repo-relative ścieżkę do
   `docs/plans/*.md`.
4. Każde rozwiązanie planu — jawne (z podanej ścieżki) lub pośrednie (z
   pointera) — odświeża plik `last-plan.txt` bieżącą ścieżką, co pozwala na
   wznowienie w następnej sesji.

Pointer jest wyłącznie lokalnym skrótem do ostatniego planu. Nie zawiera statusu
ani kopii work packages.

**Uwaga — plan musi być kanonicznym plikiem task-plan.** `execute.mjs` odczytuje
plan przez API task-plan, które wiąże ścieżkę pliku z `source_identity` z
frontmatteru. Jeśli wskażesz plik skopiowany lub przemianowany (o innej nazwie niż
kanoniczna `docs/plans/<plan-id>.md` wynikająca z `source_identity`), kroki `next`
i `check-environment` zakończą się błędem `NON_CANONICAL_PLAN_PATH`, mimo że samo
rozwiązanie ścieżki się powiedzie. Używaj ścieżki zwróconej przez task-plan lub
zapisanej w pointerze.

## Workflow

### 1. Walidacja

Załaduj plan przez API task-plan. Kontynuuj tylko wtedy, gdy walidator zwróci
`valid=true` i wynik `ready`. `ready` jest wynikiem walidacji, nie polem ani
trwałym statusem zapisanym w planie.

```bash
node <skills_root>/task-plan/scripts/validate.mjs validate \
  --file ./docs/plans/<plan-id>.md \
  --root "$PWD"
```

### 2. Wybór WP

Wybierz dokładnie pierwszy niezaznaczony WP w kolejności dokumentu.

Pomocnicza komenda:

```bash
node <skill_dir>/scripts/execute.mjs next --path ./docs/plans/<plan-id>.md
```

Wynik zawiera także `Estimated size` oraz rekomendowane `model` i `reasoning`.
Override przypisany do WP ma pierwszeństwo przed wartościami domyślnymi planu.
Rozmiar jest informacją dla wykonawcy.

Przed implementacją uruchom deterministyczny preflight. Profil bieżącej sesji
ustal w tej kolejności i użyj pierwszej dostępnej metody:

1. **Środowisko sesji (preferowane, OpenCode).** Wywołaj helper bez flag:

   ```bash
   node <skill_dir>/scripts/execute.mjs check-environment \
     --path ./docs/plans/<plan-id>.md
   ```

   Helper sam odczytuje `OPENCODE_SESSION_MODEL` i `OPENCODE_SESSION_VARIANT`,
   które w każdym wywołaniu bash agenta ustawia projektowy plugin
   `./.opencode/plugins/session-model-env.js`. Wynik ma
   `source: "session-env"`.

2. **Jawny override.** Gdy harness nie eksportuje tych zmiennych, ale znasz
   dokładny profil (np. znasz flagi CLI harnessa albo prowadzisz diagnostykę),
   podaj obie wartości:

   ```bash
   node <skill_dir>/scripts/execute.mjs check-environment \
     --path ./docs/plans/<plan-id>.md \
     --current-model provider/model-b --current-reasoning medium
   ```

   Wynik ma `source: "flags"`.

3. **Atestacja użytkownika (przenośny fallback).** Gdy harness nie udostępnia
   profilu, zapytaj użytkownika wprost, czy aktualny model i poziom rozumowania
   są nie gorsze niż wymaganie WP, i dopiero po potwierdzeniu użyj:

   ```bash
   node <skill_dir>/scripts/execute.mjs check-environment \
     --path ./docs/plans/<plan-id>.md --user-attested
   ```

   Helper nadal waliduje wymaganie WP wobec `.agents/config/model-hierarchy.json`
   i zwraca `source: "user-attested"`, `attested: true` oraz `current: null`.
   To jawna, audytowalna atestacja użytkownika, a nie zgadywanie modelu — nie
   używaj tej flagi bez potwierdzenia użytkownika.
   Gdy użytkownik jej odmówi albo nie potrafi potwierdzić, przerwij preflight
   z `SESSION_PROFILE_UNKNOWN` i wskaż metodę 1 lub 2.

Nie szukaj modelu w logach, bazie sesji ani w sieci. Profil spoza konfiguracji
jest jawnym błędem; nie zgaduj pozycji. Nie pobieraj leaderboardu ani innych
danych z sieci.

Wynik preflightu zawiera porównanie dokładnych par `model + reasoning` według
project-relative `.agents/config/model-hierarchy.json`; helper zwraca
`sufficient: true` albo `sufficient: false`. Przy `false` poproś użytkownika o
zmianę na rekomendowany lub wyższy profil.

Wymaganie wstępne: w projekcie musi istnieć `.agents/config/model-hierarchy.json`
(kopiuj szablon poniżej); w przeciwnym razie `check-environment` zgłosi
`MODEL_HIERARCHY_NOT_FOUND`. Szablon konfiguracji znajduje się w
`<skill_dir>/model-hierarchy.json.dist`. Skopiuj go do projektu i usuń przykładowe
profile:

```bash
mkdir -p .agents/config
cp <skill_dir>/model-hierarchy.json.dist .agents/config/model-hierarchy.json
```

W OpenCode projekt powinien mieć także plugin
`./.opencode/plugins/session-model-env.js` (część tego katalogu skills), żeby
metoda 1 działała bez pytań do użytkownika; plugin wymaga restartu OpenCode po
dodaniu. Kontrakt zmiennych opisuje `./README.md`. W innym harnessie metody 2–3
pozostają dostępne bez pluginu.

Szablon pozostaje zwykłym JSON-em i zamiast komentarzy używa pól `_comment`.

### 3. Implementacja

Przekaż wybrany WP do `$code-implement` jako jedno wymaganie. `$code-implement`
jest źródłem prawdy dla:

- intake i read-before-write;
- decyzji o delegacji do `implementation-worker`;
- implementacji;
- punktowego testu lub checku;
- `$review-quick`;
- raportowania blockera.

### 4. Zapis ukończenia

Oznacz WP jako ukończony dopiero po uzyskaniu konkretnego evidence. Zapis zleć
task-plan:

```bash
node <skill_dir>/scripts/execute.mjs complete \
  --path ./docs/plans/<plan-id>.md \
  --wp WP1 \
  --evidence "focused test passed" \
  --root "$PWD"
```

Fasada najpierw rozwiązuje jawnie wskazany plan i atomowo ustawia go jako pointer
ostatniego planu, a dopiero potem przekazuje zapis ukończenia do `$task-plan`.
Dzięki temu błąd walidacji lub kolejności nie zmienia planu i pozostawia pointer
przy jawnie wybranym planie, a nie przy poprzednim.

Operacja task-plan:

- odrzuca brak evidence;
- odrzuca ukończenie WP poza kolejnością;
- zmienia wyłącznie odpowiedni wpis `[ ]` na `[x]` z datą i evidence;
- ponownie waliduje cały plan;
- zapisuje go atomowo.

Jeśli implementacja lub weryfikacja nie zakończyła się powodzeniem, nie wykonuj
`complete-wp`. Pozostaw plan bez zmian i przekaż użytkownikowi konkretny powód.

### 5. Kontynuacja

Po ukończeniu WP możesz ponownie wybrać pierwszy wpis `[ ]`, jeśli kontynuacja w
tej samej sesji jest rozsądna. Jeśli nie ma kolejnego wpisu `[ ]`, zgłoś ukończenie planu.

## Helper `execute.mjs`

Helper jest małą fasadą orkiestracyjną. Obsługuje tylko:

```text
resolve  — rozwiąż ścieżkę i pointer
next     — zwróć pierwszy niezakończony WP
check-environment — porównaj bieżący profil z wymaganiem WP
complete — ustaw pointer na jawnie wskazany plan i przekaż ukończenie WP do task-plan
```

`check-environment` przyjmuje profil z pierwszej dostępnej metody:
`OPENCODE_SESSION_MODEL`/`OPENCODE_SESSION_VARIANT` (`source: "session-env"`),
flag `--current-model`/`--current-reasoning` (`source: "flags"`) albo jawnej
atestacji użytkownika `--user-attested` (`source: "user-attested"`). Porównuje
tylko dwie pozycje z lokalnej, zwalidowanej hierarchii.

## Warunki przerwania

- brak planu lub niepoprawny pointer;
- walidator task-plan nie zwraca `ready`;
- brak pliku `.agents/config/model-hierarchy.json` (skopiuj szablon
  `model-hierarchy.json.dist` do projektu) — `check-environment` kończy się błędem
  `MODEL_HIERARCHY_NOT_FOUND`;
- brak profilu sesji (`SESSION_PROFILE_UNKNOWN`) i brak potwierdzenia
  użytkownika dla `--user-attested` — w OpenCode sprawdź plugin
  `./.opencode/plugins/session-model-env.js` i restart; w innym harnessie użyj
  `--current-model`/`--current-reasoning` albo zapytaj użytkownika;
- rekomendowany model albo reasoning nie jest dostępny w bieżącym środowisku;
- wybrany WP wymaga decyzji użytkownika albo zmiany planu;
- `$code-implement` nie zakończył WP lub nie dostarczył evidence;
- task-plan odrzucił zapis ukończenia.

W każdym z tych przypadków plan pozostaje bez nowego oznaczenia `[x]`.

## Punktowa weryfikacja skilla

```bash
node <skill_dir>/scripts/execute.mjs --help
npm test -- tests/skills/plan-execute/plan-execute.test.mjs tests/skills/task-plan/task-plan-v2.test.mjs
```
