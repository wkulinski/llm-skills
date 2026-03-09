---
name: docs-todo
description: >-
  Wypisz sekcje TODO z dokumentacji wskazanej przez AGENTS.md (README główny +
  README modułów). Intencje: lista TODO w dokumentacji, wypisz otwarte zadania w
  docs. Użyj, gdy proszą o listę otwartych zadań dokumentacyjnych lub gdy ktoś
  uruchamia $docs-todo.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
---

# $docs-todo

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Celem jest zebranie wszystkich otwartych TODO z dokumentacji głównej i modułowej w jednym zestawieniu. Dzięki temu użytkownik widzi pełną listę prac do wykonania bez przeszukiwania plików.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `MAIN_DOC`: główny dokument opisowy projektu.
  - `MODULE_DOCS_GLOB`: glob dla README dokumentacji modułów.

## Kroki
1. Otwórz `AGENTS.md` i odczytaj mapę `docs_map`.
2. Znajdź:
   - główny dokument opisowy projektu (`MAIN_DOC`),
   - dokumentację modułową (`MODULE_DOCS_GLOB`, np. `docs/modules/*/README.md`).
   - Jeśli mapy lub któregoś wymaganego klucza brakuje: zatrzymaj się i dopytaj użytkownika.
3. Przeczytaj `MAIN_DOC` oraz wszystkie pliki pasujące do `MODULE_DOCS_GLOB`.
4. Wyciągnij sekcje TODO (nagłówki zawierające "TODO" lub "Otwarte zadania / TODO") wraz z listą punktów.
5. Zgłoś wyniki pogrupowane wg ścieżki pliku, zachowując oryginalne brzmienie punktów.
6. Jeśli plik nie ma sekcji TODO, pomiń go. Jeśli nic nie ma, powiedz to wprost.

## Format odpowiedzi
- Wynik: dla każdego pliku nazwa pliku jako nagłówek, pod spodem lista punktów TODO.
- Użyte klucze dokumentacji:
  - `MAIN_DOC=<resolved-path>`
  - `MODULE_DOCS_GLOB=<resolved-glob>`
- Uwagi: opcjonalne.
- Jeśli brak sekcji TODO w całej dokumentacji, napisz jedno zdanie: "Brak sekcji TODO w dokumentacji."

## Przykłady wejścia
- "wypisz TODO z dokumentacji"
- "pokaż TODO w docs"
- "lista TODO"

## Przykłady wyjścia
- ```text
  Wynik:
  (poniższe tokeny to nazwy kluczy mapy, nie literalne ścieżki)
  `<MAIN_DOC>`
  - TODO: doprecyzować proces aktualizacji dokumentacji po zmianach w architekturze.
  `<MODULE_DOCS_GLOB>/Billing/README.md`
  - Dodać opis scenariuszy błędnych i ograniczeń integracji z bramką płatności.
  - Uzupełnić checklistę testów regresyjnych dla zmian w rozliczeniach.
  `<MODULE_DOCS_GLOB>/Reporting/README.md`
  - Dopisać sekcję o strategii cache raportów i zasadach invalidacji.
  - Uzupełnić przykłady użycia endpointów raportowych.
  Uwagi: brak.
  ```
- ```text
  Brak sekcji TODO w dokumentacji.
  ```

## Efekt
Zwrócona lista TODO jest kompletna i pogrupowana per plik, albo podana jest informacja, że brak TODO w dokumentacji.

## Przypadki brzegowe
- Brak sekcji TODO w całej dokumentacji.
- Brak mapy `docs_map` lub brak wymaganego klucza (`MAIN_DOC`, `MODULE_DOCS_GLOB`) — dopytaj użytkownika i wstrzymaj wykonanie do czasu uzupełnienia.

## Uwagi
- Aby szybko znaleźć nagłówki TODO, użyj: `rg -n "TODO" <ścieżki dokumentacji z AGENTS.md>`.
