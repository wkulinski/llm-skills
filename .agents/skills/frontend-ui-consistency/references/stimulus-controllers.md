# Kontrolery Stimulus

## Zakres

Stosuj przy `data-controller`, actions, targets, values, classes, outlets, eventach, klasach stanu lub zmianie DOM istotnej dla kontrolera.

Dokument chroni kontrakt między Twig, Stimulus, Live Components i CSS; nie jest ogólnym przewodnikiem JavaScript.

## Warstwy odpowiedzialności

- **Twig** — struktura, semantyka i publiczny markup.
- **Live Component** — dane i akcje serwerowe.
- **Stimulus** — lokalne zachowanie i przejściowy stan UI.
- **CSS/SCSS** — wygląd i wizualna reprezentacja stanu.

Nie przenoś odpowiedzialności między warstwami bez potrzeby.

## Publiczny kontrakt

Traktuj jako API komponentu:

- `data-controller`, `data-action`,
- targets, values, classes i outlets,
- eventy wysyłane i odbierane,
- klasy oraz atrybuty stanu.

Przed zmianą markupu ustal granicę kontrolera i wszystkie miejsca użycia. Nie usuwaj ani nie przenoś hooków bez sprawdzenia kontrolera.

## Stan a wygląd

Stimulus powinien ustawiać semantyczny stan, a CSS go renderować:

```js
this.element.classList.toggle('is-expanded', expanded);
this.triggerTarget.setAttribute('aria-expanded', String(expanded));
```

Nie zapisuj w JavaScript stałych kolorów, spacingu, fontów, radiusów i cieni. Dopuszczalne są wartości obliczane z geometrii, np. pozycja popovera.

## Właściciel stanu

Ustal jedno źródło prawdy. Live zwykle posiada dane i walidację, Stimulus — chwilowy stan UI, focus i geometrię. Gdy współpracują, określ kierunek synchronizacji i moment aktualizacji.

## Lifecycle

Sprawdź:

- wielokrotny `connect()`,
- cleanup w `disconnect()`,
- timery, obserwery i subskrypcje,
- opcjonalne targety przez `has...Target`,
- brak zależności od przypadkowego DOM,
- zachowanie po morphowaniu lub wymianie fragmentu przez Live Component.

## Dostępność

Dla interakcji sprawdź semantyczny element, klawiaturę, kolejność focusu, Escape, focus wejściowy i powrotny oraz adekwatne `aria-expanded`, `aria-selected`, `aria-pressed`, `aria-hidden` i `aria-disabled`.

Stan ARIA i stan wizualny muszą być zgodne.

## Transfer wzorca

Wygląd nie implikuje zachowania. Jeżeli zachowanie ma być wspólne, preferuj istniejący kontroler, jego aktualne values/classes/targets, semantyczne rozszerzenie, wydzielenie mniejszej odpowiedzialności, a dopiero potem nowy kontroler.

Nie duplikuj kontrolera pod nową nazwą z powodu innej klasy CSS.

## Weryfikacja Playwright

Dobierz scenariusz do profilu. Dla zmienionego zachowania sprawdź:

1. stan początkowy,
2. główną akcję myszą,
3. stan aktywny i ARIA,
4. zamknięcie lub cofnięcie,
5. obsługę klawiatury,
6. szybką wielokrotną akcję, jeśli istnieje ryzyko wyścigu,
7. re-render Live Component, jeśli występuje,
8. nowe błędy konsoli.

Dla dropdownu, popovera lub modala sprawdź również Escape, kliknięcie poza elementem i focus powrotny.
