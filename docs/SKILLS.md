# Skills Index

Routing głównego workflow opisuje
[`skill-routing-policy.md`](../.agents/skills/_shared/references/skill-routing-policy.md).
Tabela triggerów pozwala wybrać skill po intencji; pełna lista alfabetyczna
znajduje się na końcu dokumentu.

## Tabela triggerów

### Planowanie

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Przygotuj plan wykonawczy z issue, pliku albo opisu | `$task-plan` | krytyczna weryfikacja, potem walidacja planu |
| Wykonaj albo wznow istniejący plan lub WP | `$plan-execute` | wybrany WP trafia do `$code-implement` |

### Implementacja

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Zaimplementuj zmianę, bugfix albo refaktor bez istniejącego planu | `$code-implement` | implementacja, dowody i lekka weryfikacja |
| Wykonaj operacje strukturalne PHP: move/copy/rename, transformacje klas lub AST | `$php-structure-refactor` | refaktoryzacja przez Phpactora albo Rectora |
| Twórz albo opiniuj widoki i elementy UI zgodnie z istniejącymi wzorcami | `$frontend-ui-consistency` | spójny UI i weryfikacja przez Playwright CLI |

### Review kodu i planu

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Przeprowadź głęboki, niezależny review zmian albo planu | `$code-review` | werdykt przed merge lub wdrożeniem planu |
| Szybko sprawdź bieżące zmiany przed commitem | `$review-quick` | raport findings-first bez pełnej procedury |

### Review instrukcji

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Zaudytuj skill, reguły lokalne, agenta albo cały katalog względem standardu autorskiego | `$skill-review` | findings albo standard-gap z evidence, bez edycji plików |
| Uporządkuj lokalne reguły i usuń duplikaty względem baseline `_shared` | `$rules-sync` | zsynchronizowane zasady z jawnie zaraportowanymi nadpisaniami |

### QA i commit

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Uruchom deterministyczne QA z macierzy komend: linty, testy i review | `$qa-run` | raport QA i sesja QA |
| Zacommituj zmiany zgodnie z workflow repo | `$git-commit` | pełna procedura testów, walidacji i commit |
| Przygotuj samą treść commit message | `$commit-message-write` | zapis do `COMMIT_MESSAGE_DIR/commit-message.txt` |

### Dokumentacja

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Uporządkuj dokumentację po większych zmianach | `$docs-sync` | scalone duplikaty i spójne odwołania |
| Wypisz otwarte zadania TODO z dokumentacji | `$docs-todo` | lista zadań bez implementacji |
| Zaktualizuj atlas modułów | `$module-atlas-sync` | aktualna mapa ról, wejść, powiązań i API modułów |
| Odśwież indeks skilli: listę i tabelę triggerów | `$skills-index-refresh` | `SKILLS_INDEX_DOC` zgodny z katalogiem |

### Obsługa issue

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Rozpocznij pracę nad issue | `$gh-issue-start` | branch, status In progress i assignee |
| Odeślij issue do review | `$gh-issue-review` | push, PR, status In review i opcjonalny reviewer |
| Ustaw status issue w GitHub Projects v2 | `$gh-issue-status-set` | zaktualizowany status na podstawie brancha albo numeru issue |

### Diagnostyka

| Intencja | Skill | Następny krok |
| --- | --- | --- |
| Zdiagnozuj runtime, logi, profiler albo kontener DI | `$dev-mate` | ustrukturyzowane dowody z AI Mate przed decyzją |
| Przeanalizuj koszty i duplikację pracy w sesjach OpenCode | `$opencode-workflow-economics` | raport ekonomii subagentów i fallbacków |
| Załaduj albo odśwież kontekst projektu | `$context-refresh` | manifest kontekstu i stan repo |
| Przekaż kontekst kolejnemu agentowi | `$handoff-refresh` | zrzut stanu dla nowej sesji |
| Wyczyść lokalny cache agenta | `$agent-cache-clear` | usunięcie stanu z `CACHE_PATH` |

## Lista skilli

- `$agent-cache-clear`
- `$code-implement`
- `$code-review`
- `$commit-message-write`
- `$context-refresh`
- `$dev-mate`
- `$docs-sync`
- `$docs-todo`
- `$frontend-ui-consistency`
- `$gh-issue-review`
- `$gh-issue-start`
- `$gh-issue-status-set`
- `$git-commit`
- `$handoff-refresh`
- `$module-atlas-sync`
- `$opencode-workflow-economics`
- `$php-structure-refactor`
- `$plan-execute`
- `$qa-run`
- `$review-quick`
- `$rules-sync`
- `$skill-review`
- `$skills-index-refresh`
- `$task-plan`
