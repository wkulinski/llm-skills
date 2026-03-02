---
name: skills-sync
description: >-
  Lekki wrapper operatorski dla `bin/skills-sync.mjs`: sync i publish (w tym
  dry-run oraz selektywne dodawanie nowych skilli przez `--new-skill`).
shared_files: []
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
   - `node bin/skills-sync.mjs sync --force` (gdy chcesz pominąć guard lokalnych zmian)
2. Dry-run publish (bez commita i pusha):
   - `node bin/skills-sync.mjs publish --dry-run --source <source>`
3. Publish z nowymi skillami (tylko wskazane nazwy, flaga wielokrotna):
   - `node bin/skills-sync.mjs publish --source <source> --new-skill <skillA> --new-skill <skillB>`
4. Publish bez automatycznego tworzenia PR:
   - `node bin/skills-sync.mjs publish --source <source> --no-pr`

## Notatki
- `publish` działa wyłącznie na tymczasowym klonie source i tworzy branch od commita z locka (`resolved.resolvedCommit`).
- `--new-skill` publikuje tylko wskazane skille i tylko wtedy, gdy nie są już zarządzane przez inne source w locku.
- `sync` i `publish` uwzględniają pliki z `shared_files` deklarowane we frontmatterach skilli.
- Konflikty rebase są rozwiązywane na etapie PR, nie przez ten skill.
- Jeśli w `skills.json` jest jeden source, `--source` można pominąć.
