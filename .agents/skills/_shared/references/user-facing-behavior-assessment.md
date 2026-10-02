# Ocena zachowania widocznego dla użytkownika

Ten plik jest jedynym właścicielem metody oceny, czy proponowane albo
zaimplementowane zachowanie widoczne dla użytkownika służy jego zadaniu. Skille
konsumujące decydują, kiedy metodę zastosować i gdzie zapisać wynik.

Zastosuj metodę, gdy zmiana dodaje, modyfikuje albo zależy od nawigacji,
interakcji, wyboru obiektu, komunikatu albo akcji o istotnych skutkach dla
użytkownika. Źródło ustala, czego się oczekuje, ale nie dowodzi, że oczekiwane
zachowanie służy zadaniu użytkownika. Metoda nie jest audytem UX ani badaniem
użytkowników; brak uwag jest poprawnym wynikiem.

## 1. Inwentarz interakcji

Wypisz interakcje, które zmiana dodaje, modyfikuje albo od których zależy,
łącznie z zachowaniem utrzymywanym „jak teraz”. Nie inwentaryzuj całej
aplikacji. Każdy wiersz wypełniaj od lewej do prawej:

| Wyzwalacz | Oczekiwanie użytkownika | Skutek według źródła | Ciąg dalszy |
|---|---|---|---|
| element i gest | co użytkownik przewidzi na podstawie samego elementu: czym jest, jak jest opisany i co robią podobne elementy; zapisz przed odczytaniem skutku | co każe źródło albo co dzieje się dziś | gdzie użytkownik ląduje, jaki jest jego następny krok, co traci (kontekst, filtry, wpisane dane) i jak wraca |

Gdy skutek prowadzi do powiązanego obiektu albo wybiera go automatycznie,
opisz w kolumnie skutku osiągalne warianty: brak powiązań, jedno, wiele i brak
uprawnień. Przy wielu powiązaniach reguła wyboru musi być jawna.

Następnie sprawdź:

- **rozjazd w wierszu:** skutek różni się od oczekiwania albo ciąg dalszy gubi
  kontekst, nie ma następnego kroku lub drogi powrotu;
- **niespójność między wierszami:** ten sam gest na podobnych elementach daje
  różne skutki;
- **zmianę warunków:** inny punkt tego samego źródła zmienia liczbę, układ albo
  znaczenie elementów, na których opiera się skutek, także utrzymywany „jak
  teraz”.

Cel użytkownika, którego źródło nie podaje, zapisz jako hipotezę, nie jako fakt.

## 2. Wynik

| Sytuacja | Wynik |
|---|---|
| Rozstrzygnięcie zmienia zachowanie albo kryteria akceptacji | pytanie blokujące do właściciela produktu z opcjami: utrzymać, przeformułować albo wykluczyć punkt, wraz ze skutkiem każdej opcji |
| Wątpliwość z konkretnym kosztem dla użytkownika, która nie zmienia kryteriów akceptacji | uwaga produktowa |
| Niewiadoma możliwa do taniego sprawdzenia | konkretny check |
| Preferencja bez kosztu dla zadania użytkownika | brak wpisu |

Konflikt z wymaganiem źródła nie jest defektem i nie uprawnia do samodzielnej
zmiany wymagania. Nie ukrywaj pytania blokującego jako uwagi. Rozstrzygnięty
kompromis zapisany jako decyzja nie wraca bez nowego dowodu albo zmiany zakresu.

## 3. Uwagi produktowe

Uwaga ujawnia wątpliwość, nie blokując planu. Każda uwaga wskazuje:

- konkretną interakcję albo wiersz inwentarza;
- konkretny koszt dla użytkownika: dodatkowy krok, utratę kontekstu, ukrytą
  informację, nieprzewidywalny skutek albo niespójność z podobnym elementem;
- podstawę: źródło, fakt kodowy albo hipotezę;
- możliwy kierunek albo pytanie do właściciela produktu.

Uwaga bez kosztu dla użytkownika jest preferencją i nie trafia do wyniku.
Objawy jednej przyczyny scal w jedną uwagę. Porządkuj uwagi według wpływu na
zadanie użytkownika. Liczba uwag nie jest ograniczona; jeżeli jest ich wyraźnie
więcej niż kilka, zachowaj wszystkie i dodaj zdanie, że obszar może wymagać
osobnego przeglądu projektowego.

## 4. Czego nie stosować

Nie stosuj scorecardów, sztywnych progów liczby kroków lub opcji, person ani
przewidywań zachowania użytkowników przedstawianych jako fakty.
