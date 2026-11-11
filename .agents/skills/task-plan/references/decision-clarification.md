# Doprecyzowanie decyzji

Czytaj przy zadawaniu pytań blokujących lub zapisie odpowiedzi, zmianie pojęć
domenowych lub sprzeczności ich znaczeń, a także przy ocenie, czy ustalenie
powinno służyć kolejnym zadaniom. Korzeń skilla określa warunki pytań i kanał
interakcji; ta referencja opisuje format rundy, zapis odpowiedzi i kontrolę
domenową.

## Format rundy i zapis odpowiedzi

1. Przekaż wszystkie pytania bieżącej rundy w jednym batchu, zachowując kolejność
   identyfikatorów `Q<number>`. Każde pytanie ma krótki `header`, pełną treść i
   2–5 opisanych opcji; nie dodawaj opcji „Inne”, ponieważ narzędzie udostępnia
   własną odpowiedź użytkownika.
2. Niezależne decyzje zapisuj jako osobne pytania z kolejnymi identyfikatorami
   `Q<number>`, bez wariantów literowych.
3. Po odpowiedzi ponownie oceń zależności i potrzebę pytań. W istniejącym planie
   zaktualizuj cały Markdown jedną operacją, zachowaj dosłowne
   brzmienie odpowiedzi i `Source: current conversation`, oznacz rozstrzygnięte
   pytania jako `[answered]`, a nadal potrzebne nierozstrzygnięte pozostaw jako
   `[open]`. Następnie uruchom walidację oraz punktowy review zmienionych fragmentów
   i zadaj kolejną rundę, jeśli jej przesłanki zostały rozstrzygnięte. Gdy odpowiedź
   jest niepełna albo brakuje evidence, wskaż konkretną blokadę zamiast powtarzać
   tę samą rundę bez nowych danych.

Jeżeli plan już istnieje albo można przygotować jego pierwszy użyteczny zapis,
przed pytaniem zapisz pełny plan z pytaniem w sekcji decyzji:

```md
- Q1 [open]: Który istniejący kontrakt powinien pozostać właścicielem?
```

Taki dokument ma wynik `blocked`. Po odpowiedzi zastąp wpis:

```md
- Q1 [answered]: Który istniejący kontrakt powinien pozostać właścicielem?
  - Answer: Pozostaje istniejący kontrakt Core.
  - Source: current conversation
```

## Przykład zależnych pytań

Dla zadania „dodaj anulowanie zamówienia” pierwsza runda może dotyczyć
dopuszczenia anulowania pojedynczej pozycji. Pytanie o rozliczenie rabatu
obejmującego całe zamówienie po anulowaniu pozycji wymaga tego rozstrzygnięcia,
więc trafia do późniejszej rundy. Jeśli anulowanie pozycji zostanie wykluczone,
ta gałąź nie wymaga odpowiedzi. Niezależne pytanie o dozwolony moment anulowania
całego zamówienia może wejść już do pierwszej rundy.

## Kontrola pojęć domenowych

Uruchom kontrolę, gdy zadanie wprowadza lub zmienia pojęcie domenowe, jego
cykl życia, relację między obiektami albo granicę odpowiedzialności, lub gdy
źródło, dokumentacja i kod używają tego samego terminu w różnych znaczeniach.
Zmiana pisowni komunikatu albo nazwy prywatnej metody, która nie dotyka znaczenia
domenowego, nie uruchamia kontroli.

1. Przez dokumentację wskazaną w `docs_map` projektu znajdź odpowiedni słownik,
   decyzję lub opis modułu. Czytaj punktowo istniejące definicje i reprezentatywny
   kod właściciela zachowania; nie twórz inwentarza wszystkich pojęć projektu.
2. Nazwij konkretną różnicę znaczeń albo brakującą granicę. Oddziel dowód
   obecnego zachowania od decyzji o zachowaniu docelowym: kod nie rozstrzyga,
   jak system powinien działać po zmianie.
3. Dla nierozstrzygniętej różnicy wybierz konkretny scenariusz, w którym możliwe
   interpretacje dają różne obserwowalne wyniki. Sprawdzaj tylko przypadki mogące
   zmienić zakres, zachowanie, model danych, odpowiedzialność lub kryteria
   akceptacji; nie rozwijaj wyczerpującej macierzy kombinacji.
4. Rozstrzygnij znaczenie istniejącym kontraktem i dowodami albo zadaj pytanie
   blokujące według rund z korzenia skilla. Scenariusz wymyślony do dyskusji nie
   staje się wymaganiem bez potwierdzenia. Brakujący fakt repozytoryjny kieruj
   do zwykłej ścieżki repository-context zamiast zastępować go decyzją użytkownika.

Przykład: dla „anulowania cesji” sprawdź, co ma nastąpić po przekazaniu jej do
dalszej obsługi. Usunięcie wersji roboczej, zmiana statusu i odwrócenie skutków
operacji mogą wymagać różnych reguł. Jeśli źródło nie rozstrzyga tej różnicy,
przed wyborem naprawy zapytaj o oczekiwany rezultat.

Zapis wyniku w planie określa kontrakt `Decisions and open questions` w
`<skills_root>/_shared/references/task-plan-contract.md`.

## Wiedza potrzebna po wykonaniu planu

Oceń miejsce utrwalenia rozstrzygnięcia, gdy dotyczy ono wspólnego pojęcia
domenowego albo decyzji o długotrwałych skutkach architektonicznych:

| Miejsce | Kryterium wyboru |
|---|---|
| Słownik projektu | Nowe lub zmienione pojęcie domenowe wymaga spójnej nazwy i definicji także w kolejnych zadaniach. |
| ADR | Decyzja spełnia wszystkie trzy warunki: jest kosztowna do odwrócenia, bez kontekstu będzie nieoczywista dla przyszłego czytelnika oraz wynika z rzeczywistego wyboru między alternatywami. |
| Sam plan | Ustalenie jest lokalne dla zadania albo nie spełnia powyższych kryteriów. |

Te same prace mogą wymagać definicji w słowniku i osobnego uzasadnienia
architektonicznego w ADR. Nie powielaj tej samej treści w obu dokumentach.
Słownik definiuje pojęcie i odróżnia je od mylących nazw; szczegóły implementacji
i uzasadnienia techniczne pozostają poza nim.

Najpierw wykorzystaj istniejące dokumenty i konwencje znalezione przez
`docs_map` projektu. Jeśli odpowiedniego dokumentu brakuje, zaplanuj jego
utworzenie w miejscu zgodnym z konwencjami; brak pliku nie blokuje planowania
i nie wymaga nowego klucza `docs_map`. Jeżeli wybór miejsca sam istotnie zmienia
zakres lub odpowiedzialność, rozstrzygnij go zwykłym pytaniem blokującym.

Task-plan zapisuje potrzebną pracę dokumentacyjną w odpowiednim WP według
kontraktu planu, zamiast tworzyć słownik lub ADR podczas rozmowy. Samo
spełnienie filtra nie uprawnia do rozszerzenia uzgodnionego zakresu; w takim
przypadku zastosuj istniejącą bramkę pytania o zakres.

Przykład zakresu WP: „Uzupełnij istniejący słownik w ścieżce wskazanej przez
atlas modułu o znaczenie anulowania cesji uzgodnione w D2 i odróżnienie go od
usunięcia wersji roboczej”. Kryterium akceptacji: „Po aktualizacji definicja
opisuje rezultat z D2 i jednoznacznie odróżnia obie operacje”. W rzeczywistym
planie podstaw ustaloną ścieżkę dokumentu.
