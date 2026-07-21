# Symfony UX Live Components

## Kiedy używać

Live Component jest uzasadniony przez stan serwerowy, akcje, walidację, zależne dane lub reaktywne renderowanie. Sam reużywalny wygląd należy zwykle do komponentu Twig.

## Rozdzielenie odpowiedzialności

Oddziel:

- wizualny shell,
- stan i dane biznesowe,
- akcje i walidację,
- lokalne zachowanie przeglądarkowe.

Jeżeli Twig Component i Live Component mają ten sam wygląd, współdziel shell zamiast duplikować markup i SCSS.

## Zadanie wyłącznie wizualne

Zachowaj `LiveProp`, `LiveAction`, eventy, modele, bindingi, źródło danych i częstotliwość aktualizacji. Nie przenoś zachowania ze wzorca wizualnego.

## Ponowne renderowanie

Sprawdź odpowiednio do zakresu:

- focus i pozycję kursora,
- stan rozwinięcia i scroll,
- loading, pending i disabled,
- walidację oraz błędy serwera,
- częściowe aktualizacje DOM,
- ponowne podłączenie Stimulus,
- brak duplikacji listenerów, timerów i observerów,
- zgodność ARIA ze stanem,
- jedno źródło prawdy.

## Markup i selektory

Nie opieraj JavaScript na przypadkowej strukturze DOM wymienianej przez Live Component. Preferuj stabilne targety, atrybuty, klucze i jasno wyznaczone granice komponentu.

## Właściciel stanu

Live Component zwykle posiada dane biznesowe, walidację i stan zapisywany. Stimulus może posiadać lokalne otwarcie menu, focus, geometrię i chwilową animację. Gdy synchronizacja jest konieczna, określ jej kierunek.

## Weryfikacja Playwright

Dla zmienionego zachowania:

1. zapisz stan konsoli przed scenariuszem,
2. wykonaj screenshot i snapshot stanu początkowego,
3. wykonaj główną akcję,
4. sprawdź pending/loading, jeśli jest obserwowalny,
5. poczekaj na aktualizację DOM i pobierz nowy snapshot,
6. sprawdź screenshot, focus, ARIA i stan Stimulus,
7. powtórz akcję, jeżeli może ujawnić duplikację efektów,
8. porównaj konsolę i requesty po scenariuszu ze stanem początkowym.

Nie uznawaj za wystarczające samo wyrenderowanie stanu początkowego.
