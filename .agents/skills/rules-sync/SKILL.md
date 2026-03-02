---
name: rules-sync
description: >-
  Synchronizacja lokalnych wytycznych współpracy i jakości z baseline
  `skills/_shared`: usuwa duplikaty z `AGENTS.md`/docs, zostawia lokalne
  nadpisania i raportuje je jawnie. Użyj po synchronizacji skilli lub przy
  porządkowaniu zasad.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/references/runtime-quality-procedures.md
  - _shared/references/php-symfony-postgres-standards.md
  - _shared/references/cqrs-monolith-standard-overrides.md
---

# $rules-sync

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako baseline/fallback.

## Cel
Celem jest precyzyjna synchronizacja lokalnych zasad repo z aktualnym stanem skilli i `_shared`, tak aby:
- usunąć z lokalnej dokumentacji duplikaty zasad już pokrytych przez skille lub `_shared`,
- zostawić lokalne, repo-specyficzne reguły i świadome odstępstwa,
- jawnie wypisać lokalne nadpisania względem `_shared`/skills, aby użytkownik widział różnice.

## Mapa ścieżek dokumentacji (AGENTS-first)
1. Zawsze zaczynaj od `AGENTS.md`.
2. Odczytaj mapę ścieżek dokumentacji `docs_map`.
3. Wszystkie ścieżki z mapy traktuj jako repo-relative.
4. Nie zgaduj ścieżek po nazwie pliku.

## Klucze dokumentacji (docs_map)
- Preferowane:
  - `AGENT_RULES_DOC`: lokalny dokument zasad współpracy/architektury.
  - `QUALITY_PROCEDURES_DOC`: lokalny dokument procedur jakości.
- Pomocnicze (fallback):
  - `MAIN_DOC`: pozwala wyznaczyć punkt startu do wyszukania dokumentów zasad.
  - `MODULE_DOCS_GLOB`: pozwala wykluczyć dokumentację modułową z heurystyki.
  - `SKILLS_INDEX_DOC`: indeks skilli (pomocny do walidacji linków po deduplikacji).

## Kompatybilność wsteczna (starsze docs_map)
Ten skill działa także w repozytoriach, które nie mają jeszcze `AGENT_RULES_DOC` i `QUALITY_PROCEDURES_DOC`.

Fallback resolve ścieżek:
1. `AGENT_RULES_DOC`:
   - użyj klucza `AGENT_RULES_DOC` jeśli istnieje,
   - w przeciwnym razie (gdy jest `MAIN_DOC`) przeszukaj rekurencyjnie katalog `<dirname(MAIN_DOC)>` i wybierz najlepszy kandydat według priorytetu nazw:
     1) `AGENTS.md`,
     2) plik z nazwą zawierającą `agent` lub `guideline` (`*agent*.md`, `*guideline*.md`),
     3) plik z nazwą zawierającą `rules` lub `standards` (`*rules*.md`, `*standards*.md`).
2. `QUALITY_PROCEDURES_DOC`:
   - użyj klucza `QUALITY_PROCEDURES_DOC` jeśli istnieje,
   - w przeciwnym razie (gdy jest `MAIN_DOC`) przeszukaj rekurencyjnie katalog `<dirname(MAIN_DOC)>` i wybierz najlepszy kandydat według priorytetu nazw:
     1) plik z nazwą zawierającą `quality` i/lub `procedure` (`*quality*.md`, `*procedure*.md`),
     2) plik z nazwą zawierającą `qa` (`*qa*.md`),
     3) plik z nazwą zawierającą `checklist` (`*checklist*.md`).
3. Kandydatów szukaj tylko w dokumentacji projektu:
   - bazowo: pod `<dirname(MAIN_DOC)>`,
   - wyklucz: pliki z `MODULE_DOCS_GLOB` (jeśli zdefiniowany), katalogi `archive`, `archived`, `draft`, oraz katalogi zależności (`vendor`, `node_modules`).
4. Jeśli jest wielu kandydatów o tym samym priorytecie:
   - preferuj plik zawierający słowa kluczowe proceduralne (`skills-first`, `qa-run`, `git-commit`, `review-quick`, `context-refresh`),
   - jeśli nadal remis: wybierz plik bliżej katalogu `MAIN_DOC` (mniejsza głębokość ścieżki), a przy dalszym remisie wybierz alfabetycznie.
5. Jeśli ścieżki nie da się wyznaczyć powyższą sekwencją: dopytaj użytkownika.
6. Jeśli `agent_rules_doc_path` i `quality_procedures_doc_path` wskazują ten sam plik:
   - wykonaj deduplikację normalnie,
   - sekcję nadpisań dodaj w tym samym pliku (bez duplikowania nagłówków).

## Zakres
- Dokumenty docelowe (lokalne):
  - `AGENTS.md` (entrypoint),
  - `agent_rules_doc_path` (resolved z klucza lub fallbacku od `MAIN_DOC`),
  - `quality_procedures_doc_path` (resolved z klucza lub fallbacku od `MAIN_DOC`).
- Źródła porównania:
  - wszystkie `../*/SKILL.md` (z pominięciem `../_shared/` i tego skilla),
  - `../_shared/references/runtime-collaboration-guidelines.md`,
  - `../_shared/references/runtime-quality-procedures.md`,
  - `../_shared/references/php-symfony-postgres-standards.md`,
  - jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1`: `../_shared/references/cqrs-monolith-standard-overrides.md`.

Poza zakresem:
- dokumentacja domenowa i modułowa (`MAIN_DOC`, `MODULE_DOCS_GLOB`),
- zmiany w kodzie aplikacji.

## Definicje robocze
- Duplikat: lokalna reguła/procedura opisuje to samo, co już jest w skillach lub `_shared`.
- Nadpisanie lokalne: świadoma reguła repo, która doprecyzowuje, zawęża lub zmienia baseline ze skilli/_shared.

## Kroki
1. Otwórz `AGENTS.md` i odczytaj `docs_map`.
   - Jeśli mapy brak: zatrzymaj się i dopytaj użytkownika.
2. Odczytaj `MAIN_DOC` (jeśli istnieje) i wyznacz bazowy katalog wyszukiwania `<dirname(MAIN_DOC)>`.
3. Wyznacz ścieżki dokumentów zasad (sekcja "Kompatybilność wsteczna"):
   - `agent_rules_doc_path`,
   - `quality_procedures_doc_path`.
   - Jeśli którejś ścieżki nie da się wyznaczyć: zatrzymaj się i dopytaj użytkownika.
4. Zrób snapshot repo (`git status -sb`) i sprawdź, czy dokumenty docelowe istnieją.
   - Brak pliku wskazanego przez `agent_rules_doc_path` nie jest błędem: pomiń i odnotuj to w raporcie.
   - Brak pliku wskazanego przez `quality_procedures_doc_path`: utwórz plik z minimalnym nagłówkiem `# QUALITY-PROCEDURES`, aby mieć miejsce na sekcję nadpisań; odnotuj to w raporcie.
5. Zbuduj listę dokumentów docelowych: `AGENTS.md` + resolved paths.
   - Jeżeli `SKILLS_INDEX_DOC` istnieje, użyj go do walidacji linków do skilli po zmianach.
6. Wczytaj źródła porównania (skille + `_shared`).
7. Wczytaj dokumenty docelowe i rozbij treść na atomowe reguły (punkt/lista/krótkie akapity).
8. Dla każdej lokalnej reguły wykonaj klasyfikację:
   - `DUPLICATE_SKILL`: procedura operacyjna już pokryta przez konkretny skill (`$qa-run`, `$git-commit`, `$review-quick`, `$context-refresh`, ...),
   - `DUPLICATE_SHARED`: ogólna zasada współpracy/jakości/stacka już pokryta w `_shared`,
   - `LOCAL_OVERRIDE`: lokalna specyfika repo nadpisująca baseline,
   - `LOCAL_UNIQUE`: lokalna reguła niepokryta przez skills/_shared i niesprzeczna.
9. Zastosuj akcje:
   - `DUPLICATE_SKILL`: usuń z lokalnego dokumentu procedurę krok-po-kroku; zostaw krótki opis + link do skilla.
   - `DUPLICATE_SHARED`: usuń duplikat; ewentualnie zostaw jednozdaniową wzmiankę "obowiązuje baseline `_shared`".
   - `LOCAL_OVERRIDE`: zachowaj regułę lokalną i dopisz ją do jawnej listy nadpisań.
   - `LOCAL_UNIQUE`: zostaw bez zmian.
10. Utrzymaj podział odpowiedzialności dokumentów:
   - `AGENTS.md`: entrypoint i mapa dokumentacji, bez duplikowania procedur.
   - `agent_rules_doc_path`: lokalne zasady architektury/projektu (bez proceduralnych duplikatów).
   - `quality_procedures_doc_path`: zasady jakości + mapa do skilli + sekcja nadpisań lokalnych.
11. Zaktualizuj lub utwórz w pliku z `quality_procedures_doc_path` sekcję:
   - `## Lokalne nadpisania względem skills/_shared`
   - każdy wpis zawiera:
     - `Obszar`
     - `Lokalna zasada`
     - `Nadpisywane źródło` (plik + sekcja)
     - `Uzasadnienie` (krótko, po co to odstępstwo).
12. Walidacja końcowa:
   - brak kroków proceduralnych QA/commit/review/worklog w lokalnych docs (powinny być linki do skilli),
   - brak duplikatów oczywistych zasad runtime z `_shared`,
   - sekcja nadpisań zawiera tylko realne, świadome odstępstwa.

## Reguły decyzyjne (precyzja)
- Jeśli reguła lokalna jest semantycznie taka sama jak w źródle prawdy: traktuj jako duplikat, nawet przy innym sformułowaniu.
- Jeśli reguła lokalna dodaje ograniczenie specyficzne dla repo (np. konwencja nazw, struktura modułów, wymagania PR): zostaw jako lokalną.
- Jeśli nie da się jednoznacznie odróżnić "duplikat vs nadpisanie": nie usuwaj automatycznie; oznacz do decyzji użytkownika.

## Format odpowiedzi
- Wynik:
  - liczba usuniętych duplikatów (z podziałem `skills` vs `_shared`),
  - lista zachowanych lokalnych nadpisań (z mapowaniem do nadpisywanych źródeł),
  - lista zachowanych reguł lokalnych (`LOCAL_UNIQUE`).
- Użyte klucze dokumentacji i fallbacki:
  - `AGENT_RULES_DOC=<resolved|fallback>`
  - `QUALITY_PROCEDURES_DOC=<resolved|fallback>`
  - opcjonalnie: `MAIN_DOC=<resolved>`, `MODULE_DOCS_GLOB=<resolved>`, `SKILLS_INDEX_DOC=<resolved>`
- Zmienione pliki: lista ścieżek.
- Uwagi: miejsca niejednoznaczne wymagające decyzji użytkownika.

## Przykłady wejścia
- "zsynchronizuj zasady lokalne z skillami"
- "usuń duplikaty zasad z docs względem _shared"
- "zostaw tylko lokalne override i wypisz je"

## Przykłady wyjścia
- ```text
  Wynik:
  - Usunięto 11 duplikatów: 7 względem skilli, 4 względem `_shared`.
  - Zachowano 6 lokalnych nadpisań i wpisano je do sekcji "Lokalne nadpisania względem skills/_shared".
  - Zachowano 9 reguł lokalnych unikalnych dla repo.
  Użyte klucze/fallbacki: MAIN_DOC=docs/README.md, AGENT_RULES_DOC=<auto:AGENTS.md z katalogu MAIN_DOC>, QUALITY_PROCEDURES_DOC=<auto: plik z "quality/procedure" z katalogu MAIN_DOC>.
  Zmienione pliki: AGENTS.md, <agent_rules_doc_path>, <quality_procedures_doc_path>.
  Uwagi: 1 reguła oznaczona jako niejednoznaczna (wymaga decyzji użytkownika).
  ```

## Efekt
Lokalna dokumentacja zasad jest odchudzona, nie dubluje procedur ze skilli/_shared, a wszystkie repo-specyficzne odstępstwa są jawnie zebrane i widoczne dla użytkownika.

## Przypadki brzegowe
- Brak mapy `docs_map` w `AGENTS.md` — dopytaj użytkownika i wstrzymaj wykonanie.
- Brak `MAIN_DOC` i jednocześnie brak klucza `AGENT_RULES_DOC` lub `QUALITY_PROCEDURES_DOC` — dopytaj użytkownika (brak punktu startu do wyszukiwania).
- Brak klucza `AGENT_RULES_DOC` lub `QUALITY_PROCEDURES_DOC` — użyj fallbacków (sekcja "Kompatybilność wsteczna"), wyszukiwanie rozpocznij od `MAIN_DOC`.
- Wielu kandydatów o tym samym priorytecie i bez rozstrzygających słów kluczowych — rozstrzygnij głębokością ścieżki, potem alfabetycznie.
- Brak pliku `quality_procedures_doc_path` — utwórz minimalny dokument i kontynuuj.
- Brak pliku `agent_rules_doc_path` — pomiń bez błędu i zgłoś to w raporcie.
- Brak kluczowych plików `_shared` — zgłoś brak i nie usuwaj reguł, których nie da się zweryfikować.
- Aktywny `CQRS_MONOLITH_STANDARD_OVERRIDES=1` — traktuj override jako część źródeł prawdy podczas deduplikacji.
