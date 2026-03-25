---
name: skills-sync
description: >-
  Publikacja i synchronizacja skilli przez `bin/skills-sync.mjs` (`sync`,
  `publish`, `publish --dry-run`), w tym selektywne dodawanie nowych skilli
  przez `--new-skill` oraz kontrolowane usuwanie przez `--remove-skill` +
  `--confirm-deletes`. Użyj, gdy użytkownik prosi o publikację zmian w
  skillach, wypchnięcie skilli, sync skilli albo dry-run publikacji skilli.
shared_files: []
---

# $skills-sync

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Uprościć obsługę `skills-sync.mjs` bez duplikowania logiki.
Ten skill nie implementuje reguł synchronizacji ani publish samodzielnie, tylko uruchamia komendy CLI.

## Reguła aktywacji
Uruchom ten skill zawsze, gdy intencja użytkownika dotyczy publikacji, synchronizacji albo dry-runu zmian w skillach.

Przykładowe frazy aktywujące:
- "opublikuj zmiany w skillach"
- "opublikuj skille"
- "wypchnij skille"
- "zrób skills publish"
- "skills-sync publish"
- "zsynchronizuj skille"
- "puść dry-run publikacji skilli"

## Kiedy użyć
- Gdy chcesz odświeżyć lokalne skille z upstream (`sync`).
- Gdy chcesz wypchnąć lokalne zmiany skilli do source (`publish`).
- Gdy chcesz najpierw zobaczyć plan zmian (`publish --dry-run`).

## Reguła pierwszeństwa nad workflow Git/GitHub
Jeśli polecenie użytkownika dotyczy `skills` / `skilli`, ten skill ma pierwszeństwo nad ogólnymi workflow typu `git-commit`, `git push`, `gh-issue-review` albo ręczne tworzenie PR.

Nie wolno domyślnie interpretować publikacji skilli jako:
- zwykły `git commit`
- zwykły `git push`
- utworzenie lub aktualizacja PR w bieżącym repo

Workflow gitowy wolno rozważyć dopiero wtedy, gdy użytkownik jednoznacznie prosi o publikację zmian definicji skilli do tego repozytorium Git, a nie o publish przez `skills-sync`.

## Rozstrzyganie dwuznaczności
Słowo `opublikuj` samo w sobie jest niejednoznaczne.

Jeśli jednak obiektem polecenia są `skills` / `skille`, domyślną interpretacją jest publish przez `skills-sync`, a nie publikacja przez Git/GitHub.

Dopytanie użytkownika jest potrzebne tylko wtedy, gdy jednocześnie pojawia się język skilli oraz commita/pusha/PR do repo.

## Komendy
1. Synchronizacja z upstream:
   - `node bin/skills-sync.mjs sync`
   - `node bin/skills-sync.mjs sync --force` (gdy chcesz pominąć guard lokalnych zmian)
2. Dry-run publish (bez commita i pusha):
   - `node bin/skills-sync.mjs publish --dry-run --source <source>`
3. Publish z nowymi skillami (tylko wskazane nazwy, flaga wielokrotna):
   - `node bin/skills-sync.mjs publish --source <source> --new-skill <skillA> --new-skill <skillB>`
4. Publish z usunięciem skilla upstream (jawne i potwierdzone):
   - `node bin/skills-sync.mjs publish --dry-run --source <source> --remove-skill <skillA>`
   - `node bin/skills-sync.mjs publish --source <source> --remove-skill <skillA> --confirm-deletes`
5. Publish bez automatycznego tworzenia PR:
   - `node bin/skills-sync.mjs publish --source <source> --no-pr`

## Notatki
- `publish` działa wyłącznie na tymczasowym klonie source i tworzy branch od commita z locka (`resolved.resolvedCommit`).
- `--new-skill` publikuje tylko wskazane skille i tylko wtedy, gdy nie są już zarządzane przez inne source w locku.
- Brakujący lokalnie managed skill jest domyślnie tylko ostrzeżeniem (bez kasowania upstream).
- Kasowanie upstream wymaga jawnej deklaracji `--remove-skill <name>`.
- Jeśli plan publish zawiera kasowanie (skill lub shared file), realny publish wymaga `--confirm-deletes` (w dry-run nie jest wymagane).
- `sync` i `publish` uwzględniają pliki z `shared_files` deklarowane we frontmatterach skilli.
- Konflikty rebase są rozwiązywane na etapie PR, nie przez ten skill.
- Jeśli w `skills.json` jest jeden source, `--source` można pominąć.
