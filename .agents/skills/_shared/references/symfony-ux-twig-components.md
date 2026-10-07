# Komponenty Twig

## Odkrywanie

Przed zmianą znajdź:

- komponenty o podobnej funkcji,
- miejsca użycia i reprezentatywne warianty,
- makra, partiale i layouty,
- style i tokeny,
- zależności Live i Stimulus,
- testy oraz baseline'y.

## Reużycie i granica komponentu

Najpierw rozważ istniejący komponent, wariant, semantyczne rozszerzenie API i wspólny shell.

Następnie wybierz świadomie między nowym komponentem i lokalnym markupem. Oceń:

- czy istnieje stabilna granica odpowiedzialności,
- czy element ma własne stany lub zachowanie,
- czy struktura jest złożona,
- czy niezależne testowanie ma wartość,
- czy prawdopodobne jest ponowne użycie,
- czy wydzielenie poprawia czytelność szablonu nadrzędnego,
- czy API nie będzie bardziej skomplikowane niż markup.

Nie obowiązuje mechaniczna reguła „tylko gdy występuje więcej niż raz”.

## Projektowanie API

API opisuje znaczenie i zachowanie:

```twig
<twig:Panel variant="default" density="compact" emphasis="secondary" />
```

Nie opisuje pojedynczych deklaracji CSS:

```twig
{# Niepreferowane #}
<twig:Panel padding="12" radius="8" borderColor="#d0d5dd" />
```

Użyj prop dla prostej, ograniczonej wartości. Użyj block lub slot dla zawartości z własną strukturą, np. header, actions, footer i empty state.

Props mają minimalny zakres danych, jawne typy i nazwy opisujące znaczenie.

Składnię bloków i slotów dobieraj do wersji narzędzi używanej w repo. Domyślny pojedynczy slot treści bez jawnych bloków stosuj tylko wtedy, gdy repo i wersja Symfony UX go wspierają; w przeciwnym razie trzymaj się jawnej składni przyjętej w projekcie.

## Klasy i warianty

Komponent powinien mieć stabilny root. Warianty powinny być semantyczne, np. `density="compact"`, `emphasis="secondary"`, `variant="danger"`.

Nie opieraj stylów reużywalnego komponentu na przypadkowym zagnieżdżeniu ani nie wymagaj od konsumenta znajomości jego wewnętrznego DOM.

## Semantyka i publiczny kontrakt

Dobieraj HTML do funkcji. Traktuj jako publiczny kontrakt:

- props, blocks i slots,
- klasy root i stabilne hooki,
- atrybuty Stimulus,
- eventy i modele Live,
- identyfikatory używane przez testy i dostępność.

Nie zmieniaj semantyki tylko dla wygody stylowania.

## Konsolidacja

Wydziel wspólną warstwę, gdy shell, nagłówek, stany albo zestaw reguł są rzeczywiście wspólne. Nie twórz abstrakcji nad przypadkowym podobieństwem dwóch elementów, jeśli różnice funkcjonalne zdominują API.

## Weryfikacja

Dobierz zakres do ryzyka zmiany. Sprawdź co najmniej reprezentatywne użycie i każdy zmieniony wariant. Przy współdzielonym komponencie sprawdź również jedno graniczne zastosowanie, długą treść oraz zależny kontrakt Live/Stimulus.

Po zmianie uruchom lint Twig przyjęty w repo, a przy zmianie stylów lub skryptów także lint SCSS, TS albo JS. Po refaktorze usuń klasy i selektory, które nie mają już użyć.
