# Claude Code i skille przez symlinki

Data: 2026-09-30. Claude Code 2.1.284, Opus `claude-opus-5-5`, Paseo 0.9.2, Linux.

## Werdykt

**Symlinki działają w runtime Claude Code**, także dla referencji lokalnych i
wspólnego katalogu `_shared`. Nie oznacza to jednak automatycznie bezobsługowego
wykonania: potrzebne są poprawne uprawnienia do skilla oraz jego rzeczywistych
plików. Nowe, niezaufane repozytorium ignoruje projektowe reguły `permissions.allow`.

Wykonano osiem świeżych sesji: cztery przez Paseo i cztery bezpośrednio przez CLI.
Próby obejmują sukcesy po ograniczonych zgodach oraz kontrolowane odmowy uprawnień.
Nie jest to statystyczna gwarancja niezawodności ani certyfikacja innych wersji,
systemów, pluginów, wszystkich skilli katalogu lub zagnieżdżonych symlinków.

## Fixture i warianty

Wszystkie pliki testowe są pod `/tmp/opencode/claude-symlink-smoke-20260930`.
Nie zmieniono produkcyjnych skilli, konfiguracji repo ani globalnego zaufania Claude.
Po próbach cztery sesje Paseo zarchiwizowano; natywne procesy CLI zakończyły się.
Fixture pozostał do reprodukcji. `git diff --check` przeszedł, ale nie stanowi
walidacji treści tego nowego, nieśledzonego raportu.

Źródło zawiera rzeczywiste pliki:

```text
source/.agents/skills/
  symlink-probe/SKILL.md
  symlink-probe/references/local.md
  _shared/references/shared.md
```

Przetestowane układy:

1. `whole-root/.claude/skills` → `source/.agents/skills` (symlink całego katalogu,
   cel poza cwd testowanej sesji).
2. `entry-root/.claude/skills/symlink-probe` → źródłowy katalog skilla oraz
   osobny symlink `entry-root/.claude/skills/_shared` → źródłowe `_shared`.
3. W samym `source`: `.claude/skills` → `../.agents/skills` (cel w tym samym
   katalogu projektu, wariant odpowiadający repozytorium z lokalnymi skillami).

Nie testowano wariantu pojedynczego skilla bez udostępnienia `_shared`.

Skill jest tymczasową instrukcją testową. Po natywnym wywołaniu `Skill` ma odczytać
`references/local.md` oraz `../_shared/references/shared.md` względem własnego
katalogu bazowego, a nie cwd. Zwraca trzy znaczniki pochodzące z plików i status.
Prompt nie zawiera oczekiwanych znaczników. Zabroniono wyszukiwania alternatywnych
kopii, ręcznego odczytu SKILL.md zamiast Skill, edycji, shella i delegacji.

## Cztery próby przez Paseo

Każda sesja używała osobnego workspace, modelu Opus 5.5 i trybu `default`
(Always Ask), bez bypass. W każdej wystąpiła zgoda na `Skill(symlink-probe)`;
zatwierdzono wyłącznie konkretne żądanie testowej sesji. Nie były to próby
bezobsługowe. Po zgodzie wszystkie zakończyły się poprawnie, bez dodatkowych
oczekujących zgód na dwa odczyty.

| Wariant | Runda | Agent ID | Wynik po zgodzie |
|---|---|---|---|
| Cały katalog | 1 | `c1166145-a503-4398-8841-138411e9512f` | PASS |
| Pojedyncze katalogi + `_shared` | 1 | `e8aa3a14-d236-4ff0-95f4-da904fecb5f4` | PASS |
| Cały katalog | 2 | `429d1fd5-f56e-4b4b-93ff-1b95f5769845` | PASS |
| Pojedyncze katalogi + `_shared` | 2 | `254fbfbd-5a10-496c-8a2b-1cdd4fc4ca70` | PASS |

Przed rundą 2 zmieniono wszystkie znaczniki w źródłowym SKILL.md i obu
referencjach. Nowe sesje odczytały nowe wartości, bez kopiowania plików do
workspace ani restartowania daemona Paseo. Dowodzi to świeżości przy nowej sesji,
nie odświeżania już działającej sesji.

W rundzie 2 dodano do tymczasowych workspace wyłącznie:

```json
{"permissions":{"allow":["Skill(symlink-probe)"]}}
```

Nie usunęło to pytań o zgodę. Bezpośredni test CLI poniżej ujawnił, że projekt
jest niezaufany i ta reguła jest ignorowana. Nie zakładano ani nie ustawiano
automatycznie `hasTrustDialogAccepted`.

Świeże wyniki Paseo zweryfikowano niezależnymi asercjami: dokładny JSON i znaczniki
z odpowiedniej rundy, natywny event Skill, dokładnie dwa eventy Read, cwd, model,
status idle i brak pozostawionych żądań uprawnień.

## Cztery kontrole bezpośrednim CLI

Użyto `claude -p --model claude-opus-5-5 --permission-mode default --max-turns ...
--output-format json`. Usunięto z procesu zmienne API key/auth token/base URL;
korzystano z istniejącego loginu, nie instalowano credentials.

### A. Zewnętrzne źródło, tylko projektowe permissions.allow

Sesja `52e76ea4-8ef1-4257-81bb-33b7c208f08d`.

**BLOCKED**: Skill odmówiony. CLI jawnie wypisało:
`Ignoring 1 permissions.allow entry ... this workspace has not been trusted`.
`permission_denials` zawiera wywołanie `Skill` dla `symlink-probe`.

### B. Zewnętrzne źródło, Skill dozwolony argumentem CLI

Sesja `6a349014-780f-4bcc-9f20-0b9b49472bbc`.

Dodano `--allowedTools 'Skill(symlink-probe)'`.
**PARTIAL/BLOCKED**: Skill załadowany, lecz `permission_denials` zawiera dwa Read
do referencji. Odpowiedź zwraca aktualny marker skilla, ale nie zgaduje markerów
nieodczytanych referencji. Symlink nie zapewnia sam z siebie dostępu do celu poza
zakresem katalogów sesji.

### C. Zewnętrzne źródło, Skill + jawny dostęp do katalogu źródeł

Sesja `5e4a862c-1c77-475d-8573-6324f86320a6`.

Dodano `--allowedTools 'Skill(symlink-probe)'` oraz
`--add-dir /tmp/opencode/claude-symlink-smoke-20260930/source/.agents/skills`.
**PASS**: poprawny JSON z trzema aktualnymi znacznikami,
`permission_denials: []`, `subagent_stats.spawned: 0`.
Projektowe pozwolenie nadal było ignorowane, lecz jawne argumenty procesu
wystarczyły. Nie użyto bypass ani szerokiego zezwolenia na wszystkie narzędzia.

### D. Źródło wewnątrz projektu, tylko jawne pozwolenie na Skill

Sesja `beefacf1-12dc-470b-81a5-38e5f8872f13`.

Cwd: katalog `source`, `.claude/skills` → `../.agents/skills`.
Użyto `--allowedTools 'Skill(symlink-probe)'`, bez `--add-dir`.
**PASS**: aktualne znaczniki skilla i obu referencji,
`permission_denials: []`, `subagent_stats.spawned: 0`.
Ten wariant nie wymaga dostępu do źródeł poza projektem.

W kontrolach CLI JSON zawiera wynik i metadane, nie pełny stream eventów narzędzi.
Nie interpretowano deklaracji modelu jako niezależnej inspekcji tool-catalogu;
odmowy pochodzą z pola runtime `permission_denials`. Szczegółowe eventy Skill/Read
potwierdzono osobno w czterech logach Paseo.

## Znaczenie dla planu

- Można użyć symlinków jako warstwy dostępu; nie trzeba kopiować treści skilli
  wyłącznie z obawy przed ich wykrywaniem.
- Najprostszy testowany układ to lokalne `.agents/skills` w repo oraz symlink
  `.claude/skills` → `../.agents/skills`. Wymaga sprawdzenia kolizji, jeżeli
  `.claude/skills` już zawiera lokalne skille użytkownika.
- Przy linkach pojedynczych katalogów trzeba zachować także dostęp do `_shared`
  i pozostałych referencji. Jedna próba pokazała normalizację ścieżki do
  `.claude/skills/_shared`, dlatego nie opierać się wyłącznie na założeniu, że
  model będzie zawsze używać kanonicznej fizycznej ścieżki targetu.
- Link do wspólnej instalacji poza repo wymaga jawnego dostępu do tego katalogu.
  `--add-dir` potwierdzono w bezpośrednim CLI; nie zweryfikowano jeszcze mapowania
  tej opcji na konfigurację providera Paseo.
- Plan musi objąć zaufanie workspace i wąskie permissions dla review.
  Projektowe settings nie są wystarczającym bootstrapem niezaufanego repo.
- Test akceptacyjny powinien sprawdzać native Skill + referencje + brak
  `permission_denials`/oczekującej zgody, a nie tylko widoczność nazwy skilla.
- Nie zweryfikowano produkcyjnego `code-review`, skryptów, executable bits,
  referencji do root `.agents`, Windows, chmur ani plugin packaging.

## Dokumentacja

Oficjalna dokumentacja opisuje symlinkowane katalogi pojedynczych skilli w
lokalizacji project/personal/enterprise jako wspierane. Walidator pluginów
traktuje symlinki inaczej i może je pominąć lub odmówić walidacji; brak walidacji
nie jest dowodem, że skill nie ładuje się w runtime.

- https://code.claude.com/docs/en/skills#choose-where-skills-load
- https://code.claude.com/docs/en/plugin-marketplaces
- https://code.claude.com/docs/en/large-codebases
