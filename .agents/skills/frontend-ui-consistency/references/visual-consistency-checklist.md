# Checklista spójności wizualnej

Używaj przy audycie, transferze, nowym elemencie i większym review. W profilu minimalnym wybierz tylko sekcje związane ze zmianą.

## Geometria i układ

- szerokości, wysokości i ograniczenia min/max,
- margin, padding, gap i rytm pionowy,
- alignment, baseline'y i osie optyczne,
- proporcje kolumn i gęstość informacji,
- zachowanie przy krótkiej i długiej treści.

## Powierzchnie

- border: kolor, grubość, styl i krawędzie,
- radius, tło, cień i separatory,
- poziomy głębi i zagnieżdżenie paneli,
- czy border/tło/cień mają funkcję, a nie tylko dekorację.

## Typografia

- rodzina, rozmiar, waga, line-height i letter-spacing,
- hierarchia tytułu, wartości, opisu i metadanych,
- wrapping, truncation i line clamp,
- wyrównanie liczb i `tabular-nums`, gdy wspiera porównanie danych.

## Kolor i hierarchia

- tekst podstawowy i pomocniczy,
- rodzina neutralnych kolorów,
- akcje, akcenty i kolory semantyczne,
- kontrast i rozpoznawalność stanu bez samego koloru,
- dominacja primary action.

## Ikony i kontrolki

- rodzina, stroke i pole optyczne ikon,
- rozmiar, hit area i odstęp ikona–tekst,
- wysokości kontrolek i alignment etykiet,
- kolejność i hierarchia działań.

## Stany

Dobierz do funkcji: default, hover, focus-visible, active/pressed, selected, disabled, loading/pending, error, warning, success, empty, read-only, indeterminate i skeleton.

## Responsywność

- breakpointy i zmiana układu,
- overflow, wrapping i kolejność treści,
- tabele, gridy, sticky, modal i dropdown,
- dostępność akcji oraz minimalny target na małym ekranie.

Domyślne viewporty tylko dla profilu rozszerzonego lub zmian layoutu:

- 390×844,
- 1024×768,
- 1440×900.

## Interakcja i dostępność

- focus, klawiatura, Escape i powrót focusu,
- zgodność ARIA ze stanem,
- feedback, szybkie akcje i stabilność layoutu,
- `prefers-reduced-motion`,
- Live re-render i Stimulus lifecycle.

## Tokeny i wartości

Dla nowej wartości sprawdź, czy istnieje token lub równoważny wzorzec, czy nowa wartość nie tworzy prawie identycznego wariantu oraz czy uzasadnienie jest systemowe, a nie lokalne.

## Dowody

Zanotuj stronę, stan, viewport, screenshoty, istotne interakcje, nowe błędy konsoli i computed styles użyte do rozstrzygnięcia różnic.

Nie pisz „spójne” bez wskazania parametrów. Przykład:

```text
Cel różnił się od wzorca: brak borderu zamiast 1 px, lokalny radius 2 px
zamiast radius-md, padding space-2 zamiast space-4 i niewyrównana oś akcji.
```
