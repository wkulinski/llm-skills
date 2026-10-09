---
name: plan-execute
description: >-
  Wykonuje gotowy plan task-plan sekwencyjnie: wybiera pierwszy niezakończony
  work package, zleca implementację i zapis ukończenia z dowodem. Użyj, gdy
  chcesz zrealizować lub wznowić istniejący plan.
shared_files:
  - _shared/references/skill-routing-policy.md
  - _shared/references/task-plan-contract.md
  - _shared/scripts/model-hierarchy.mjs
  - _shared/scripts/model-leaderboard.mjs
  - _shared/scripts/is-main-module.mjs
  - _shared/scripts/task-plan/atomic-file.mjs
  - _shared/scripts/task-plan/difficulty.mjs
  - _shared/scripts/task-plan/source.mjs
  - _shared/scripts/task-plan/store.mjs
  - _shared/scripts/task-plan/validate.mjs
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

Plan przechowuje wyłącznie binarną informację o ukończeniu w sekcji
`## Execution` na początku dokumentu:

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

Pełny kontrakt planu (sekcje, format `Execution` i `Execution environment`) opisuje
`<skills_root>/_shared/references/task-plan-contract.md`; właścicielem procedury
planowania i zapisu pozostaje `<skills_root>/task-plan/SKILL.md`.

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
   wznowienie w następnej sesji. Komendy `resolve`, `next` i `check-environment`
   zapisują pointer przed walidacją planu, więc po wskazaniu planu niepoprawnego
   albo niegotowego pointer i tak wskazuje właśnie ten plan, mimo że komenda
   kończy się błędem.

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

### 1. Walidacja i wybór WP

`next` ładuje plan przez API task-plan i sam odrzuca plan, który nie ma wyniku
`ready` (`valid=true`), kodem `PLAN_NOT_READY`; osobne wywołanie walidatora jest
potrzebne tylko do diagnozy. `ready` jest wynikiem walidacji, nie polem ani
trwałym statusem zapisanym w planie. Plan bez zapisanego review ma status
`review_pending` i wymaga review w `$task-plan` oraz `record-review`.

Wybierz dokładnie pierwszy niezaznaczony WP w kolejności dokumentu:

```bash
node <skill_dir>/scripts/execute.mjs next --path ./docs/plans/<plan-id>.md
```

Wynik zawiera `selected.body` — pełną treść wybranego WP z sekcji
`Work packages`, nie jego wpis z `Work package summaries` — oraz
`Estimated size`, rekomendowane `model` i `reasoning` oraz
ograniczenia dla wykonawcy: `decisions` (wszystkie wpisy decyzji planu: `D`, `Q`
z odpowiedzią i źródłem, `N`) i `risks` (ryzyka dotyczące wybranego WP albo całego
planu; ryzyko bez ID WP jest globalne). Override przypisany do WP ma pierwszeństwo
przed wartościami domyślnymi planu. Rozmiar jest informacją dla wykonawcy.

Przed implementacją uruchom preflight. Profil bieżącej sesji
ustal w tej kolejności i użyj pierwszej dostępnej metody:

1. **Środowisko sesji (preferowane, OpenCode).** Wywołaj helper bez flag:

   ```bash
   node <skill_dir>/scripts/execute.mjs check-environment \
     --path ./docs/plans/<plan-id>.md
   ```

   Helper sam odczytuje `OPENCODE_SESSION_MODEL` i `OPENCODE_SESSION_VARIANT`,
   które w każdym wywołaniu bash agenta ustawia projektowy plugin
   `./.opencode/plugins/session-model-env.js`. Wynik ma
   `source: "session-env"` dla lokalnego porównania.

2. **Jawny override.** Gdy harness nie eksportuje tych zmiennych, ale znasz
   dokładny profil (np. znasz flagi CLI harnessa albo prowadzisz diagnostykę),
   podaj obie wartości:

   ```bash
   node <skill_dir>/scripts/execute.mjs check-environment \
     --path ./docs/plans/<plan-id>.md \
     --current-model provider/model-b --current-reasoning medium
   ```

   Wynik lokalnego porównania ma `source: "flags"`.

Nie szukaj tożsamości bieżącego modelu w logach, bazie sesji ani w sieci.
Nie zgaduj reasoning ani pozycji profilu.

Automatyczna bramka ma dwie rozłączne gałęzie:

- **Lokalna dokładna para:** `.agents/config/model-hierarchy.json` jest
  nadrzędna; `sufficient` wynika wyłącznie z `currentIndex <= requiredIndex`.
  Lokalnie niższy profil nie ma obejścia przez punkty. Helper nie pobiera wtedy
  rankingu. Lokalne porównanie zachowuje dopasowanie prefiksów dostawcy, np.
  `commandcode/deepseek/model` do `deepseek/model`; reasoning jest dokładne.
- **Para spoza lokalnej hierarchii:** helper korzysta ze wspólnego
  `<skills_root>/_shared/scripts/model-leaderboard.mjs`. Bez etykiet rankingu
  zwraca `action: "pairing-required"` i niczego nie pobiera. Wtedy wypisz
  świeże wiersze rankingu do kontekstu (nie zapisuj ich do pliku):

  ```bash
  node <skills_root>/_shared/scripts/model-leaderboard.mjs entries
  ```

  Wskaż dokładne etykiety wierszy odpowiadających wymaganemu i bieżącemu
  profilowi, z tym samym modelem i reasoning, i powtórz preflight:

  ```bash
  node <skill_dir>/scripts/execute.mjs check-environment \
    --path ./docs/plans/<plan-id>.md \
    --required-label "Model A (Medium)" --current-label "Model B (Max)"
  ```

  Helper pobiera ranking ponownie, sprawdza obie etykiety w jednym odczycie,
  bierze z niego punkty i przepuszcza `currentPoints >= requiredPoints - 2`.
  Wynik ma `source: "leaderboard"` oraz `profileSource: "session-env"` albo
  `"flags"`. Gdy nie potrafisz jednoznacznie sparować któregoś profilu, nie
  zgaduj: potraktuj to jak `decision-required` i zapytaj użytkownika.
  Helper nie zapisuje rankingu ani cache.

Brak profilu/reasoning, etykieta nieobecna w odczycie, ta sama etykieta dla obu
stron albo awaria sieci zwraca `action: "decision-required"`, nie wymyśloną
ocenę zero.
Automatycznie zbyt słaby profil zwraca `action: "change-environment"`.
Oba wyniki zawierają `options: ["change-profile", "user-attested", "stop"]`;
przed implementacją zapytaj użytkownika, którą opcję wybiera. Sam kod wyjścia
komendy nie oznacza dopuszczenia — wymagaj `action: "execute"` i
`sufficient: true`. Usunięcie wymaganej pary z hierarchii wymaga rewizji
rekomendacji planu, nie atestacji.

**Atestacja użytkownika (jawny wyjątek dla jednego WP).** Atestacja nie jest
źródłem profilu, tylko wyjątkiem od wyniku bramki. Gdy bramka modelowa
zatrzymuje wykonanie, przedstaw trzy opcje: zmiana profilu,
ręczna atestacja obecnego profilu dla wskazanego WP albo stop. Zapytaj wprost:
„WP4 wymaga modelu X z reasoning Y; bieżący profil to Z (albo jest
nieobserwowalny). Czy zmieniasz profil, potwierdzasz wystarczalność obecnego
profilu wyłącznie dla WP4, czy zatrzymujemy wykonanie?”. Nie traktuj ogólnego
„kontynuuj” jako atestacji. Dopiero po jawnym potwierdzeniu, przy
nieobserwowalnym profilu, użyj:

```bash
node <skill_dir>/scripts/execute.mjs check-environment \
  --path ./docs/plans/<plan-id>.md --user-attested --attested-wp WP4
```

Przy obserwowalnym profilu dodaj dokładnie potwierdzoną parę:

```bash
node <skill_dir>/scripts/execute.mjs check-environment \
  --path ./docs/plans/<plan-id>.md --user-attested --attested-wp WP4 \
  --attested-model provider/model-b --attested-reasoning medium
```

Jeśli profil pochodzi z jawnego override zamiast env sesji, dodaj też
`--current-model provider/model-b --current-reasoning medium`. Potwierdzona
para musi odpowiadać obserwowanej dokładnie; zmiana profilu lub wybranego WP
daje `ATTESTATION_SCOPE_MISMATCH` i wymaga ponownego pytania.
Helper nadal wymaga planu `ready` i poprawnej hierarchii oraz obecności
wymaganej pary. Wynik ma `source: "user-attested"`, `attested: true` oraz
`attestation: {wpId, profile, reusable: false}`. `current` i `profile` są
`null` wyłącznie przy profilu nieobserwowalnym. Dopuszczenie pochodzi z
potwierdzenia użytkownika, nie z automatycznego porównania. Niczego nie
utrwalaj ani nie używaj ponownie automatycznie; każda nowa atestacja wymaga
jawnego potwierdzenia dla jednego WP i bieżącego profilu.

Wymaganie wstępne: w projekcie musi istnieć `.agents/config/model-hierarchy.json`
(kopiuj szablon poniżej). Bez tego pliku walidacja planu zgłasza „Model hierarchy
does not exist”, plan jest `invalid`, a `next` i `check-environment` kończą się
błędem `PLAN_NOT_READY` (szczegóły w `details.errors`), zanim dojdzie do
porównania profili. Szablon konfiguracji znajduje się w
`<skill_dir>/model-hierarchy.json.dist`. Skopiuj go do projektu i usuń przykładowe
profile:

```bash
mkdir -p .agents/config
cp <skill_dir>/model-hierarchy.json.dist .agents/config/model-hierarchy.json
```

W OpenCode projekt powinien mieć także plugin
`./.opencode/plugins/session-model-env.js` (część tego katalogu skills), żeby
metoda 1 działała bez pytań do użytkownika; plugin wymaga restartu OpenCode po
dodaniu. Kontrakt zmiennych opisuje `./README.md`. W innym harnessie metoda 2 i
atestacja użytkownika pozostają dostępne bez pluginu.

Szablon pozostaje zwykłym JSON-em i zamiast komentarzy używa pól `_comment`.

### 2. Implementacja

Przekaż pełne `selected.body` z wyniku `next` do `$code-implement` jako jedno
wymaganie, razem z `decisions` i `risks` jako ograniczeniami. Zachowaj wszystkie
pola WP, w tym `Goal`, `Scope`, `Out of scope`, `Acceptance criteria` i
`Verification`; nie zastępuj ich tytułem ani streszczeniem z
`Work package summaries`. Nie przekazuj całego planu ani planowej sekcji
`Acceptance and verification`. `$code-implement`
jest źródłem prawdy dla:

- intake i read-before-write;
- decyzji o delegacji do `implementation-worker`;
- implementacji;
- punktowego testu lub checku;
- `$review-quick`;
- raportowania blockera.

### 3. Zapis ukończenia

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

### 4. Kontynuacja

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
flag `--current-model`/`--current-reasoning` (`source: "flags"`). Lokalna
hierarchia jest nadrzędna; wyłącznie profil zewnętrzny korzysta ze świeżego
rankingu (`source: "leaderboard"`) z etykietami `--required-label` i
`--current-label` wskazanymi przez agenta. Jawna atestacja `--user-attested` wymaga
`--attested-wp` i, przy obserwowalnym profilu, obu `--attested-model` oraz
`--attested-reasoning`; daje odrębne `source: "user-attested"`.

## Warunki przerwania

- brak planu lub niepoprawny pointer;
- walidator task-plan nie zwraca `ready`;
- brak pliku `.agents/config/model-hierarchy.json` (skopiuj szablon
  `model-hierarchy.json.dist` do projektu) — plan jest `invalid`, a `next` i
  `check-environment` kończą się błędem `PLAN_NOT_READY`;
- brak profilu sesji (`decision-required`, `SESSION_PROFILE_UNKNOWN`) i brak potwierdzenia
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
