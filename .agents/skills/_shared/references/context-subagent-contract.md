# Kontrakt kontekstu między agentami

## Role

### Agent główny

Agent główny odpowiada za rozmowę z użytkownikiem oraz:

- odczyt issue i komentarzy,
- interpretację intencji i kryteriów akceptacji,
- decyzje dotyczące zakresu i architektury,
- rozpoczęcie lifecycle kontekstu projektu,
- weryfikację plików przed edycją.

### `context-refresher`

`context-refresher` jest jedyną delegowaną rolą, która może wykonać pełną
procedurę `$context-refresh`. Używa się go jawnie przy inicjalizacji sesji lub
świadomym odświeżeniu kontekstu. Zwraca zwarty manifest, a nie kopię treści
dokumentacji.

### `context-scout`

`context-scout` jest tylko do odczytu i wykonuje repozytoryjny rekonesans. Musi:

- nie pobierać ani nie interpretować issue/komentarzy GitHub,
- nie uruchamiać `$context-refresh`,
- nie edytować plików, nie uruchamiać QA/review, nie commitować i nie diagnozować runtime,
- otrzymać znormalizowany brief oraz manifest od agenta głównego,
- analizować tylko pliki repozytorium potrzebne do zmapowania implementacji.

Powinien najpierw używać Sereny dla obsługiwanych języków, a następnie
punktowego wyszukiwania i odczytu. Może doczytać brakujący README modułu lub
lokalną konwencję, jeśli wymaga tego brief, ale nie powinien ponownie czytać
źródeł wymienionych w manifeście bez wyjaśnienia, dlaczego manifest jest
niewystarczający.

## Triggery routingu

Deleguj `repository-context` do `context-scout`, gdy zachodzi co najmniej jeden
warunek:

- zadanie obejmuje wiele modułów lub warstw architektonicznych,
- zadanie obejmuje backend oraz frontend/testy,
- docelowy moduł albo graf wywołań nie jest jeszcze znany,
- spodziewane są więcej niż dwie rundy wyszukiwania lub więcej niż trzy pliki kandydackie,
- duży dirty diff wymaga zmapowania przed implementacją.

Nie deleguj go dla jednego znanego pliku/symbolu, pojedynczego wyszukania,
prostego configu, QA, review, commita ani obsługi pliku stanu.

Deleguj `context-initialization` do `context-refresher` tylko wtedy, gdy agent
główny potrzebuje nowego/odświeżonego kontekstu i nie istnieje ważny manifest.

## Handoff od agenta głównego

Agent główny przekazuje zwarty brief, zwykle krótszy niż 1000 tokenów:

```yaml
repository: stabilny identyfikator repozytorium
branch: bieżący branch
task_brief: znormalizowany cel implementacji
acceptance_criteria: [krótkie, testowalne kryteria]
decisions: [decyzje użytkownika]
constraints: [ograniczenia architektoniczne, bezpieczeństwa i zależności]
context_manifest: ścieżka lub referencja do manifestu
already_read: [ścieżki repo-relative]
```

Handoff nie może zawierać pełnych komentarzy issue, pełnej dokumentacji,
sekretów ani pełnych treści plików. Jeśli brakuje wymaganego pola, scout zgłasza
blokadę zamiast zgadywać.

## Manifest kontekstu

Manifest jest zwięzłym indeksem kontekstu załadowanego przez agenta głównego
albo `context-refresher`. Zawiera ścieżki i krótkie role źródeł, nie ich treść:

```yaml
version: 1
role: primary | context-refresher
repository: stabilny identyfikator repozytorium
branch: bieżący branch
head: opcjonalny hash commita
rules: [ścieżki repo-relative]
documentation: [ścieżki repo-relative]
active_overrides: [krótkie nazwy i wartości]
constraints: [krótkie inwarianty]
already_read: [ścieżki repo-relative]
omitted: [znane, celowo niezaładowane źródła]
```

Manifest waliduj przez `<skills_root>/_shared/scripts/context-manifest.mjs`
przed przekazaniem go capability. Manifesty są lokalnymi artefaktami pod
`CACHE_PATH` i nigdy nie mogą zawierać sekretów.

## Raport scouta

Scout zwraca maksymalnie dwanaście krótkich sekcji/punktów (zwykle do około
1500 tokenów). Może zakończyć wcześniej, gdy zakres jest kompletny; limit nie
jest celem samym w sobie.

1. zakres i istotne moduły,
2. pliki i symbole,
3. call sites i zależności,
4. istotne testy,
5. obowiązujące konwencje,
6. ryzyka i niewiadome,
7. pliki świadomie wyłączone z zakresu,
8. rekomendowany następny krok,
9. stopień kompletności mapy,
10. brakujące odczyty przy raporcie `INCOMPLETE`.

Każde istotne twierdzenie musi zawierać ścieżkę repo-relative oraz, jeśli to
możliwe, symbol lub zakres linii. Agent główny zapisuje raport i nie powtarza
szerokiego rekonesansu, chyba że raport jest niekompletny albo sprzeczny z repo.
