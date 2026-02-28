---
name: skills-sync
description: "Lekki wrapper operatorski dla `bin/skills-sync.mjs`: sync i publish (w tym dry-run oraz dodawanie nowych skilli przez `--include-new`)."
---

# $skills-sync

## Cel
Uprościć obsługę `skills-sync.mjs` bez duplikowania logiki.
Ten skill nie implementuje reguł synchronizacji ani publish samodzielnie, tylko uruchamia komendy CLI.

## Kiedy użyć
- Gdy chcesz odświeżyć lokalne skille z upstream (`sync`).
- Gdy chcesz wypchnąć lokalne zmiany skilli do source (`publish`).
- Gdy chcesz najpierw zobaczyć plan zmian (`publish --dry-run`).

## Komendy
1. Synchronizacja z upstream:
   - `node bin/skills-sync.mjs sync`
2. Dry-run publish (bez commita i pusha):
   - `node bin/skills-sync.mjs publish --dry-run --source <source>`
3. Publish z nowymi skillami:
   - `node bin/skills-sync.mjs publish --source <source> --include-new`
4. Publish bez automatycznego tworzenia PR:
   - `node bin/skills-sync.mjs publish --source <source> --no-pr`

## Notatki
- `publish` działa wyłącznie na tymczasowym klonie source i tworzy branch od commita z locka (`resolved.resolvedCommit`).
- Konflikty rebase są rozwiązywane na etapie PR, nie przez ten skill.
- Jeśli w `skills.json` jest jeden source, `--source` można pominąć.
