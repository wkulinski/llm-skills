---
name: docs-sync
description: "Aktualizacja i porządkowanie dokumentacji po większych zmianach. Intencje: sprawdź spójność dokumentacji, scal duplikaty, usuń rozbieżności, zaktualizuj odwołania. Użyj, gdy proszą o przegląd spójności dokumentów lub przy $docs-sync."
---

# $docs-sync

## Priorytet zasad (globalny kontrakt)
- Kolejność i rozstrzyganie konfliktów reguł: `../_shared/references/runtime-collaboration-guidelines.md` (sekcja "Priorytet reguł").
- `../../../AGENTS.md` oraz dokumenty przez niego wskazane mają pierwszeństwo nad `_shared` dla danego repo; `_shared` traktuj jako przenośny baseline/fallback.

## Cel
Celem jest wykrycie i usunięcie duplikatów lub sprzeczności w dokumentacji oraz przywrócenie zasady jednego źródła prawdy.

Dodatkowo ten skill ma **dwie obowiązkowe fazy**:
1) fazę domenową (aktualność i kompletność opisu systemu i modułów),
2) fazę proceduralną (skills-first: skille jako źródło prawdy dla procedur).

Dodatkowo ten skill traktuje **skille jako nadrzędne źródło prawdy dla procedur operacyjnych** (QA/commit/worklog/review itp.) i dba o to, aby:
- pozostała dokumentacja projektu (README/moduły/testy oraz opcjonalne AGENTS/QUALITY) **nie dublowała** procedur już pokrytych przez skille,
- ewentualne zmiany proceduralne były wdrażane **w skillach**, a nie dopisywane „na boku” w innych dokumentach.

Na koniec: opisy domeny i modułów muszą odpowiadać bieżącemu stanowi.

## Mapa ścieżek dokumentacji (AGENTS-first)
1. Zawsze zaczynaj od `AGENTS.md`.
2. Odczytaj mapę ścieżek dokumentacji `docs_map`.
3. Wszystkie ścieżki z mapy traktuj jako repo-relative.
4. Nie zgaduj ścieżek po nazwie pliku.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `MAIN_DOC`: główny dokument opisowy projektu.
  - `MODULE_INDEX_DOC`: indeks modułów.
  - `MODULE_DOCS_GLOB`: glob dla README dokumentacji modułów.
- Opcjonalne:
  - `TESTS_README`: README testów.
  - `SKILLS_INDEX_DOC`: indeks skilli.

## Faza domenowa (obowiązkowa)
Celem fazy domenowej jest doprowadzenie do sytuacji, w której dokumentacja domenowa:
- jest **aktualna** (nie przeczy kodowi i uwzględnia bieżące zmiany),
- jest **wystarczająco kompletna** (opisuje zakres/komponenty/entrypointy na poziomie właściwym dla docs),
- nie zawiera procedur operacyjnych (to „posprząta” faza skills-first).

Zakres fazy domenowej:
- README główny dokumentacji (opis systemu, architektura high-level, środowisko, narzędzia),
- README dokumentacji modułów (zakres/komponenty/TODO modułu),
- indeks modułów,
- (opcjonalnie, ale zalecane): README testów, jeśli zmiany dotyczyły testów/infrastruktury testowej.

### Threshold kompletności (wymuszenie jakości)
Jeśli zmiany w kodzie spełniają **którykolwiek** z warunków poniżej, traktuj to jako “większą zmianę domenową/modułową” i zastosuj próg kompletności:
- dotknięto **≥ 10 plików** w obrębie jednego modułu (`src/<Module>/...`), lub
- zmieniono pliki w `src/<Module>/Domain/` (encje/VO/porty/serwisy domenowe), lub
- zmieniono publiczne wejścia modułu: `src/<Module>/UI/Controller` lub `src/<Module>/UI/Command` lub `src/<Module>/Api`.

**Minimalny próg kompletności** przy “większej zmianie”:
- README dokumentacji modułu:
  - sekcja “Zakres” (lub równoważna) odzwierciedla aktualne komponenty i odpowiedzialności,
  - jeżeli doszły/zmieniły się istotne wejścia (UI/CLI/API): README ma krótką listę/nazwy entrypointów (bez kroków operacyjnych),
  - jeżeli zmienił się model domenowy (encje/relacje/VO): README zawiera zwięzłą aktualizację opisu modelu/relacji na poziomie koncepcyjnym,
  - sekcja “TODO” jest zaktualizowana (nowe długi dopisane, wykonane elementy usunięte/oznaczone).
- README główny dokumentacji:
  - architektura/opisy środowiska nie są przestarzałe wobec bieżących zmian (np. proxy, make, docker, multi-tenant),
  - jeżeli zmiana wpływa na globalne zachowanie (np. multi-tenant, migracje, uprawnienia): opis jest uzupełniony na poziomie high-level.

## Zasada nadrzędności (skills-first)
1. Jeśli jakaś procedura jest pokryta przez skill, to **skill jest źródłem prawdy**, a dokumentacja w `docs/` ma jedynie:
   - krótki opis intencji,
   - ograniczenia/inwarianty,
   - link do odpowiedniego skilla (np. `../qa-run/SKILL.md`).
2. Jeśli wykryjesz, że ktoś dopisał/zmienił procedurę w dokumentacji projektu (np. `AGENTS.md` lub dokumentach przez niego wskazanych), a jest to procedura pokryta przez skill:
   - **przenieś zmianę do właściwego skilla** (update `../<skill>/SKILL.md`),
   - w docs zostaw tylko link (i ewentualnie inwariant, jeśli to nie jest „krok po kroku”).
3. Nie dubluj list komend/step-by-step (np. `git add`, `git commit`, `lint:*`) w dokumentacji projektu, jeżeli istnieje skill, który te komendy opisuje i orkiestruje.

## Kroki
1. (Faza domenowa) Zbierz kontekst zmian:
   - sprawdź `git status -sb`,
   - zbierz listę zmienionych plików (`git diff --name-only`) i nowe pliki (`git ls-files --others --exclude-standard`),
   - określ, które moduły są dotknięte zmianami (`src/<Module>/...`) i czy spełniony jest threshold kompletności (sekcja wyżej).
   - jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1` w `.env` / `.env.local`: uwzględnij `../_shared/references/cqrs-monolith-standard-overrides.md` jako aktywne zasady architektoniczne.
2. (Faza domenowa) Odczytaj wymagane klucze mapy `docs_map`: `MAIN_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB`.
   - Jeśli mapy lub któregoś wymaganego klucza brakuje: zatrzymaj się i dopytaj użytkownika.
3. (Faza domenowa) Zweryfikuj README główny dokumentacji pod kątem aktualności i kompletności:
   - czy opis high-level nadal odpowiada kodowi,
   - czy nowe globalne zachowania/zmiany są odnotowane (na poziomie architektury/domeny, bez procedur),
   - czy nie ma sprzeczności lub przestarzałych fragmentów.
4. (Faza domenowa) Dla każdego dotkniętego modułu:
   - znajdź README dokumentacji modułu przez `MODULE_DOCS_GLOB` (z pomocą `MODULE_INDEX_DOC`) i porównaj z realnymi zmianami w module,
   - jeśli threshold kompletności jest spełniony: doprowadź README modułu do minimalnego progu kompletności (Zakres/entrypointy/model/TODO),
   - jeśli zmiana jest mała: dopisz tylko to, co konieczne, aby README mówiło prawdę.
5. (Faza domenowa) Zweryfikuj indeks modułów:
   - indeks modułów musi zawierać link do README dokumentacji każdego modułu,
   - jeśli doszedł nowy moduł: dopisz go do indeksu modułów.
6. (Faza domenowa) Opcjonalnie (jeśli dotyczy i zdefiniowano `TESTS_README`): README testów:
   - jeśli zmiana dotyczy sposobu uruchamiania testów lub infrastruktury testów, zaktualizuj opis tak, by odpowiadał stanowi repo.
7. (Faza proceduralna / skills-first) Ustal mapę źródeł prawdy:
   - sprawdź zawartość `../` oraz dokumenty proceduralne shared (`../_shared/references/runtime-collaboration-guidelines.md`, `../_shared/references/runtime-quality-procedures.md`),
   - dla procedur operacyjnych przyjmij skille jako nadrzędne (skills-first),
   - przykładowe mapowanie (jeśli te skille istnieją w repo):
     - QA/linty/testy → `$qa-run` (`../qa-run/SKILL.md`)
     - commit (snapshot/akceptacja/staging/commit) → `$git-commit` (`../git-commit/SKILL.md`)
     - worklog (plik per email + ULID) → `$worklog-add` (`../worklog-add/SKILL.md`)
     - szybka weryfikacja zmian → `$review-quick`
     - inicjalizacja kontekstu → `$context-refresh`
     - odświeżenie indeksu skills → `$skills-index-refresh`
8. (Faza proceduralna / skills-first) Przeskanuj dokumentację pod kątem duplikatów procedur już pokrytych przez skille:
   - obowiązkowo: README główny dokumentacji i indeks modułów,
   - opcjonalnie (jeśli istnieją): `AGENTS.md`, dokumenty wskazane przez `AGENTS.md`, indeks skilli,
   - moduły: README dokumentacji modułów,
   - (opcjonalnie, ale zalecane): README testów oraz inne istotne dokumenty, jeśli istnieją odwołania do QA/commit.
9. (Faza proceduralna / skills-first) Wykryj „proceduralne duplikaty” (heurystyka; nie musisz idealnie, ale bądź konsekwentny):
   - listy komend QA lub kolejność lintów/testów (np. wzmianki o `lint:*`, komendach z `BIN_PATH` albo natywnych entrypointach repo),
   - opis krok po kroku commitowania (np. `git add`, `git commit`, `git commit -F`, format message, staging check),
   - procedury workloga (np. ULID generation, zasady edycji wpisów),
   - procedury „review po QA” (jeśli istnieje dedykowany skill),
   - proceduralne „jak używać skilli” (jeśli to już jest w indeksie skilli / `SKILL.md`).
10. (Faza proceduralna / skills-first) Dla każdego wykrytego duplikatu:
   - jeśli jest pokryty przez skill: usuń/skrót do linku i pozostaw tylko inwarianty,
   - jeśli NIE jest pokryty przez skill, ale powinien (bo to procedura operacyjna): rozważ dodanie/rozszerzenie skilla i dopiero potem zostaw link w docs.
11. (Faza proceduralna / skills-first) Wykrywanie i „przenoszenie zmian proceduralnych” (kluczowe):
   - jeśli w docs pojawił się nowy krok/komenda w procedurze QA/commit/worklog, a istnieje odpowiedni skill (`$qa-run`, `$git-commit`, `$worklog-add`):
     - zaktualizuj skill tak, aby obejmował tę zmianę,
     - usuń krok/komendę z docs i zamień na odwołanie do skilla (skills-first),
     - upewnij się, że nie ma sprzeczności między dokumentacją projektu (jeśli istnieje) a skillami.
   - jeśli zmiana proceduralna dotyczy repo-procesu (QA/commit/worklog), a Ty ją wdrożyłeś w skillu:
     - upewnij się, że dokumentacja projektu nie zawiera już starej wersji procedury (ma link, nie opis),
     - przy przygotowaniu commita uwzględnij tę zmianę w worklogu (standardowo przez `$worklog-add` w ramach `$git-commit`).
12. Sprawdź spójność linków i indeksów:
   - indeks modułów ↔ README dokumentacji modułów,
   - indeks skilli ↔ `../` (jeśli plik istnieje),
   - jeśli indeks skilli istnieje i jest nieaktualny: użyj `$skills-index-refresh` lub doprowadź indeks do zgodności.
13. Jeśli wykryjesz sprzeczności, zgłoś je i zaproponuj konkretne korekty; jeśli możesz bezpiecznie — wdroż korekty zgodnie z zasadą nadrzędności skilli.

## Zakres
- W zakresie:
  - spójność i aktualność dokumentacji,
  - deduplikacja procedur pokrytych przez skille (skills-first),
  - aktualizacja skilli, jeśli to one powinny być źródłem prawdy dla procedury.
- Poza zakresem:
  - zmiany w kodzie aplikacji (poza niezbędnymi korektami dokumentacyjnymi),
  - wdrażanie nowych procedur „w docs” zamiast w skillach (to jest antycel).

## Format odpowiedzi
- Wynik:
  - (Faza domenowa) status aktualności i kompletności:
    - README główny dokumentacji — OK / wymaga zmian (co i dlaczego),
    - moduły dotknięte zmianami (README dokumentacji modułów) — OK / wymaga zmian (co i dlaczego),
    - indeks modułów — OK / wymaga zmian,
    - (opcjonalnie) README testów — OK / wymaga zmian.
  - (Faza proceduralna / skills-first) lista wykrytych duplikatów/sprzeczności proceduralnych,
  - (Faza proceduralna / skills-first) lista miejsc, gdzie zastąpiono procedurę linkiem do skilla,
  - lista skilli, które zaktualizowano, bo to one są źródłem prawdy.
- Użyte klucze dokumentacji: lista użytych kluczy `docs_map` z resolved paths.
- Uwagi: opcjonalne ryzyka lub braki.
- Przy aktywnym `CQRS_MONOLITH_STANDARD_OVERRIDES=1`: wskaż ewentualne rozbieżności docs względem `../_shared/references/cqrs-monolith-standard-overrides.md`.
- Jeśli brak rozbieżności, napisz: "Brak rozbieżności w dokumentacji."

## Przykłady wejścia
- "zsynchronizuj dokumentację"
- "sprawdź spójność dokumentacji"
- "scal duplikaty w docs"

## Przykłady wyjścia
- ```text
  Wynik:
  - Brak rozbieżności w dokumentacji.
  - Sprawdzone: README główny ↔ README testów, indeks modułów ↔ README modułów, indeks skilli ↔ `../`.
  Uwagi: brak.
  ```
- ```text
  Wynik:
  - Usunięto duplikację procedury QA w dokumentacji projektu (zastąpiono listę komend linkiem do `$qa-run`).
  - Uporządkowano dokument proceduralny projektu tak, aby nie powielał kroków commit/worklog (odsyła do `$git-commit` i `$worklog-add`).
  - Zaktualizowano `../qa-run/SKILL.md`, bo w docs pojawiła się nowa komenda QA — przeniesiono ją do skilla (skills-first).
  Uwagi: brak.
  ```

## Efekt
Dokumentacja jest spójna, bez duplikatów procedur, a wszystkie procedury operacyjne znajdują się w skillach (lub są do nich jednoznacznie referowane).

## Przypadki brzegowe
- Brak README modułu wskazanego w indeksie modułów.
- Dokument zawiera zarówno inwarianty jak i procedurę: usuń część proceduralną, zostaw inwariant + link do skilla.
- Brak mapy `docs_map` lub brak wymaganego klucza (`MAIN_DOC`, `MODULE_INDEX_DOC`, `MODULE_DOCS_GLOB`) — dopytaj użytkownika i wstrzymaj wykonanie.
