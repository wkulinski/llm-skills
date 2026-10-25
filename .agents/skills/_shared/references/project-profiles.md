# Profile projektu

Ten plik jest jedynym właścicielem wyboru profilu stacka i aktywacji jego reguł.
Profil wybiera reguły, nie workflow ani zestaw narzędzi do uruchomienia.

## Rozstrzygnięcie przed pracą

Przed odczytem standardów stacka, implementacją, review, QA lub zapisem plików projektu
załaduj istniejący `<skills_root>/_shared/scripts/env-load.sh` i wywołaj
`resolve_stack_profile` w root repo konsumenta. Nie kontynuuj po błędzie:

```bash
source .agents/skills/_shared/scripts/env-load.sh
ensure_repo_env_loaded || exit $?
STACK_PROFILE="$(resolve_stack_profile)" || exit $?
```

Odczytowy snapshot i lokalne artefakty workflow (cache, stan, snapshot commita)
mogą powstać wcześniej; nie uprawniają do zmian w projekcie przed walidacją.

Przykład zakłada instalację w `.agents/skills`; przy innym położeniu użyj
rzeczywistego `skills_root`. Funkcja korzysta z istniejącego ładowania aktywnych
env przez `ensure_repo_env_loaded`; nie parsuj env ponownie w skillu.
Kolejność pozostaje: `.env`, `.env.local` (poza `APP_ENV=test`),
`.env.<APP_ENV>`, `.env.<APP_ENV>.local`; domyślny `APP_ENV` to `dev`.
`.env.dist` jest szablonem, nie aktywnym plikiem runtime.

| Końcowe `SKILLS_STACK_PROFILE` | Aktywne standardy |
|---|---|
| brak, puste lub `generic` | przenośne reguły współpracy i jakości; bez baseline PHP |
| `php-symfony-postgres` | obowiązkowo `php-symfony-postgres-standards.md` |
| inna wartość | `SKILLS_STACK_PROFILE_INVALID`, exit 2; zatrzymaj procedurę przed zmianami |

`CQRS_MONOLITH_STANDARD_OVERRIDES` jest osobną osią konfiguracji. Wartość `1`
dołącza `cqrs-monolith-standard-overrides.md` wyłącznie w profilu PHP, z jego
dotychczasowym pierwszeństwem względem baseline. W profilu `generic` wartość
`1` daje `CQRS_OVERRIDE_REQUIRES_PHP_PROFILE`, exit 2 — nigdy nie wybiera PHP
automatycznie. Pozostałe wartości pozostawiają override nieaktywny.

Nie wnioskuj profilu z rozszerzeń plików, obecności `composer.json`, nazwy
workflow ani samej flagi CQRS. Zapisz rozstrzygnięty profil i aktywność override
w istniejącym manifeście/stanie/raporcie, bez kopiowania całego env. Przy zmianie
konfiguracji rozstrzygnij profil ponownie w świeżym shellu i odśwież kontekst.

## Konsumpcja i narzędzia

Skille odsyłają tutaj zamiast powtarzać warunki wyboru. Czytaj i stosuj tylko
standardy aktywowane powyżej. `shared_files` pozostaje deklaracją dostępności:
zachowaj baseline, override, tę referencję i `env-load.sh` w dystrybucji skilli,
które ich używają; obecność na liście nie aktywuje standardu.

Preflight obejmuje tylko narzędzia potrzebne w bieżącym kroku, przez istniejący
`resolve_tool_cmd`. Sam profil PHP nie wymaga uruchomienia wszystkich narzędzi
PHP, a `generic` nie wyłącza narzędzia potrzebnego konkretnemu zadaniu. Komendy
macierzy QA i kolejność workflow pozostają własnością ich dotychczasowych skilli.

## Migration for existing consumers

The default changes from an unconditional PHP baseline to the portable core.
**Before updating the installed skills**, existing PHP consumers must add
`SKILLS_STACK_PROFILE=php-symfony-postgres` to their active repository env
(for example `.env.local` outside `APP_ENV=test`). Preserve the existing CQRS
flag; it does not replace the stack profile. For test environments, put the
selection in an active test env file or exported runtime configuration.

Then update the skills together with their declared shared files, run the
resolution command above in a fresh shell, and refresh the context manifest.
Verify that the resolved profile is `php-symfony-postgres`, the PHP baseline is
loaded, and the prior CQRS override remains active if configured. Do not copy
secrets or overwrite local env from `.env.dist` during migration.

New portable consumers may leave the variable unset or select `generic`.
To deliberately migrate away from the PHP rules, first disable the CQRS override,
then select `generic` and refresh context; do not silently remove existing
consumer rules through `$rules-sync` as a substitute for this decision.
