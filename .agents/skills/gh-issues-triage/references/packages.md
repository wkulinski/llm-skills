# Pakiety i zadania składowe

Ładuj, gdy pokazujesz relacje pakietów (domyślnie), grupujesz wynik według pakietów lub dodajesz ich sugestie.

## Potwierdzone relacje

- Pakiet ustalaj przez formalne relacje lub jawną listę zadań w opisie bądź komentarzu. Sam odnośnik, wzmianka w PR lub podobny temat nie dowodzi objęcia zadania pakietem. W raporcie rozróżnij relację formalną od deklaracji w treści i wskaż jej źródło.
- Wykrywanie pakietów wykonuj wśród otwartych issues należących do wybranego projektu, poza pozostałymi filtrami listy: sprawdź także pakiety przypisane innym osobom i na innych statusach. Korzystaj z relacji nadrzędnych i treści pakietów; nie ograniczaj wyszukiwania do wstępnej listy kandydatów. Zamknięte pakiety i pakiety spoza projektu pomijaj.
- Każde konkretne zadanie kwalifikuj według jego własnych danych. Nie przenoś statusu ani przypisania pakietu na składowe i nie ukrywaj zadania z powodu przynależności do pakietu, także gdy sam pakiet nie spełnia pozostałych filtrów. Wyjątkiem jest domyślny widok ogólny z wiersza „Widok (parent)” w `SKILL.md`, który wyklucza podzadania z „Oczekujące”.
- Przy pozycji issue dodaj zwięzłą adnotację, np. `· pakiet formalny: [#N](URL)` albo `· pakiet zadeklarowany: [#N](URL) ([źródło](URL))`. Sam pakiet może mieć własną pozycję, jeśli spełnia filtry; oznacz go jako zadanie zbiorcze. Jeśli nie udało się sprawdzić relacji, oznacz lukę zamiast deklarować brak pakietów. Niepotwierdzonej relacji nie przedstawiaj jako istniejącej.

## Opcjonalne grupowanie

Na żądanie grupuj oczekujące zadania pod nagłówkami pakietów zamiast kategorii tematycznych, zachowując osobną pozycję, tytuł, link i status każdego konkretnego zadania. Pozostaw grupę zadań bez pakietu. Przy wielu powiązaniach pokaż zadanie raz i wymień pozostałe relacje; nie licz go wielokrotnie. Nagłówek pakietu nie zastępuje zadania ani nie rozszerza listy zadań poza filtry. Zachowaj osobne sekcje „Blokowane” i „Pominięte”.

## Sugestie pakietów

Na żądanie dodaj na końcu sekcji „Oczekujące” krótkie sugestie pakietów, jeśli widzisz uzasadniony wspólny zakres pracy. Dla każdej sugestii podaj linki do konkretnych zadań z zestawienia, proponowany cel oraz uzasadnienie wspólnej realizacji, np. wspólną zmianę kontraktu lub zależność między zadaniami. Sam wspólny temat nie wystarcza.

Oznacz propozycje jako ocenę agenta, oddzieloną od potwierdzonych relacji z GitHuba. Nie zakładaj wspólnej przyczyny błędów ani gotowości do implementacji. Sugestie nie zmieniają kwalifikacji, widoczności ani liczby konkretnych zadań, nie zastępują ich na liście i nie tworzą issues. Jeśli brak uzasadnienia, pomiń sugestie.
