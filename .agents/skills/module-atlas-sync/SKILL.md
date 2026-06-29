---
name: module-atlas-sync
description: >-
  Utrzymuj atlas modułów wskazany przez `MODULE_INDEX_DOC` jako zwięzłą mapę
  ról modułów: pilnuj ról modułów, punktów wejścia, powiązań, API modułów oraz
  odnośników do `MAIN_DOC` i README modułów wskazanych przez
  `MODULE_DOCS_GLOB`. Używaj, gdy zmienia się struktura modułów, dokumentacja
  modułów, relacje między modułami, publiczne API modułów albo gdy trzeba
  świadomie zaktualizować atlas.
shared_files:
  - _shared/references/runtime-collaboration-guidelines.md
  - _shared/scripts/env-load.sh
---

# $module-atlas-sync

## Reguły rozwiązywania ścieżek
- Stosuj globalny kontrakt ścieżek z root `AGENTS.md`.

## Priorytet zasad (globalny kontrakt)
1. Instrukcje systemowe/developerskie środowiska
2. `./AGENTS.md` i dokumenty z `docs_map`
3. Bieżący `SKILL.md`
4. Pliki wskazane w `shared_files`

## Cel
Utrzymuj i aktualizuj atlas modułów wskazany przez `MODULE_INDEX_DOC` tak, aby
był krótki, dokładny i łatwy do skanowania. Głównym wynikiem pracy skilla jest
zawsze zaktualizowany atlas modułów. Atlas jest warstwą orientacyjną, a nie
zamiennikiem pełnej dokumentacji modułów.

## Wymagane klucze dokumentacji (docs_map)
- Wymagane:
  - `MAIN_DOC`: główny dokument projektu.
  - `MODULE_INDEX_DOC`: plik atlasu modułów do aktualizacji.
  - `MODULE_DOCS_GLOB`: glob dla README dokumentacji modułów.

## Kiedy używać
- Gdy moduł został dodany, usunięty, przemianowany albo zmienił zakres.
- Gdy zmieniła się struktura modułów, dokumentacja modułów, relacje między modułami, publiczne API albo punkty wejścia modułów.
- Gdy atlas modułów wymaga sprawdzenia spójności względem `MAIN_DOC` i dokumentacji modułów.

## Przepływ
1. Otwórz `AGENTS.md` i odczytaj `docs_map`.
2. Odczytaj `MAIN_DOC`, `MODULE_INDEX_DOC` i `MODULE_DOCS_GLOB`.
3. Jeśli mapy lub któregoś z wymaganych kluczy brakuje, zatrzymaj się i dopytaj użytkownika.
4. Przeczytaj `MAIN_DOC` i `MODULE_INDEX_DOC`.
5. Dla każdego dotkniętego modułu przeczytaj tylko odpowiedni README znaleziony przez `MODULE_DOCS_GLOB`.
6. Jeśli `MODULE_INDEX_DOC` nie istnieje, utwórz go razem z brakującymi katalogami nadrzędnymi.
7. Porównaj wpisy z poniższym szablonem i doprowadź atlas do zgodności.
8. Preferuj skracanie albo usuwanie treści zamiast dopisywania kolejnych akapitów.
9. Jeśli czegoś nie da się podeprzeć dokumentacją repo albo kodem, pomiń to i oznacz jako follow-up.

## Sztywny szablon wpisu
Każdy moduł w atlasie wskazanym przez `MODULE_INDEX_DOC` zapisuj dokładnie w tym układzie:

```md
- [Nazwa](../src/Nazwa/Docs/README.md) — <jednozdaniowa rola modułu>.
  - Punkty wejścia: <krótka lista lub `brak potwierdzonych`>
  - Powiązania: <krótka lista modułów lub `brak potwierdzonych`>
  - Czytać, gdy: <krótka lista sytuacji>
  - Nie czytać, gdy: <krótka lista sytuacji>
  - Główna dokumentacja: `<MAIN_DOC>`, `<README modułu>`
```

Zasady wpisów:
- Jeden wpis na jeden moduł.
- Opisy mają być krótkie i skanowalne.
- Nie duplikuj w atlasie pełnej dokumentacji modułu.
- Używaj atlasu do wyboru kolejnych dokumentów do czytania, nie jako zamiennika tych dokumentów.

## Szybkie kontrole
- `rg -n "^-" <MODULE_INDEX_DOC>`
- `rg -n "README.md|src/.*/Docs/README.md" <MODULE_INDEX_DOC>`

## Oczekiwany wynik
Najpierw zapisz zaktualizowany plik wskazany przez `MODULE_INDEX_DOC`, a dopiero potem zwróć zwięzły raport o znalezionych uszkodzonych linkach, nieaktualnych opisach, brakujących modułach albo lukach w powiązaniach.
