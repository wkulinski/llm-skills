# Kontrakt struktury skilla

Ten plik jest jedynym kanonicznym właścicielem reguł strukturalno-wykonawczych
wspólnych dla skilli: notacji ścieżek, priorytetu zasad, semantyki `shared_files`
oraz rozwiązywania entrypointów narzędzi.

Odrębny standard jakości autorskiej (w tym samym katalogu) odsyła do niniejszego
kontraktu i nie powtarza jego reguł. Egzekwowanie reguł MUST należy do testów
repozytorium; ten plik opisuje kontrakt, a nie jego implementację.

## Notacja ścieżek

- `skill_dir` = katalog aktywnego `SKILL.md`.
- `skills_root` = katalog nadrzędny wobec `skill_dir` (w tym repo:
  `.agents/skills`).
- W treści `SKILL.md` używaj wyłącznie jawnej notacji:
  - `./...` dla ścieżek repo-relative (`./` = root repo),
  - `<skill_dir>/...` dla plików aktywnego skilla,
  - `<skills_root>/_shared/...` dla plików współdzielonych,
  - `<skills_root>/<nazwa-skilla>/SKILL.md` dla odwołań do innych skilli.
- Nie używaj w treści `SKILL.md` gołych ścieżek względnych typu `scripts/...`,
  `references/...`, `assets/...`, `templates/...`, `_shared/...` ani `../...`.
- Skill nie odwołuje się do wewnętrznych plików innego skilla ani w treści, ani
  w kodzie. Wspólny artefakt potrzebny więcej niż jednemu skillowi przenieś do
  `<skills_root>/_shared/...`; nie kopiuj go do drugiego skilla i nie sięgaj po
  wersję z jego katalogu. Odwołanie do innego skilla jest dozwolone wyłącznie
  jako wskazanie właściciela procedury przez
  `<skills_root>/<nazwa-skilla>/SKILL.md`.
- Naruszenie reguł notacji to dług strukturalny: przy dotknięciu obszaru przenieś
  artefakt do `_shared` zamiast utrwalać zależność.

## Priorytet zasad

Po wybraniu aktywnego skilla stosuj kolejność (od najwyższego priorytetu):

1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

Wyjątek przed wyborem aktywnego skilla: routing nadrzędnego workflow odbywa się
według `<skills_root>/_shared/references/skill-routing-policy.md`. Bieżący
`SKILL.md` nie może nadpisać tej reguły, ponieważ nie został jeszcze wybrany;
po wyborze obowiązuje powyższa kolejność dla procedur wykonawczych.

Kolejność priorytetów jest stała — zmiana należy do właściciela tego kontraktu,
a nie do pojedynczego skilla.

## Semantyka `shared_files`

- `shared_files` to płaska lista wpisów w frontmatterze `SKILL.md`. Wpisy są
  relative względem `skills_root` z powodów kompatybilności z toolingiem repo.
- Deklaracja znaczy „plik jest zadeklarowany i dostępny dla tego skilla”, a nie
  „każdy wpis trzeba przeczytać w całości przed startem”. Pliki z listy czyta się
  na żądanie, gdy aktywny krok workflow faktycznie ich potrzebuje.
- Kolejność i zakres odczytu wynikają z aktywnego kroku skilla oraz celu odczytu
  (`discovery`, `read-before-write`, `verification`, `snapshot-refresh`,
  `report-gap`). Sama deklaracja nie tworzy obowiązku odczytu ani nie zastępuje
  guardu `read-before-write`.
- Każdy wpis musi wskazywać istniejący, regularny plik pod `skills_root`, a
  lokalne zależności deklarowanych plików `.mjs` również muszą być zadeklarowane.
- Semantyka obowiązuje niezależnie od tego, czy harness automatycznie doczytuje
  `shared_files`; skill nie może zakładać takiego doczytania ani maskować braku
  odczytu samą obecnością wpisu na liście.
- Semantyki `shared_files` nie zmieniają adnotacje inline — składnia listy
  pozostaje płaska.

## Entrypointy narzędzi

- Ścieżki narzędzi projektu ustalaj wyłącznie przez
  `<skills_root>/_shared/scripts/env-load.sh` (`resolve_tool_cmd`).
- `resolve_tool_cmd` jest jedynym źródłem prawdy; nie wyprowadzaj ścieżek ręcznie
  z `BIN_PATH` ani nie składaj ich z fragmentów — env jest ładowany automatycznie
  w resolverze.
- W ramach jednego zadania nie mieszaj wielu wariantów entrypointów.

## Powiązania

- Routing nadrzędnego workflow: `skill-routing-policy.md`.
- Zasady współpracy i wykonania technicznego: `runtime-collaboration-guidelines.md`.
- Egzekwowanie reguł MUST: testy kontraktowe `skills-shared-files.test.mjs` oraz
  `playwright-routing-contract.test.mjs`.
