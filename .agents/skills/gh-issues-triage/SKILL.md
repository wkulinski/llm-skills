---
name: gh-issues-triage
description: Przygotowuje lub odświeża tabelę issues GitHub na podstawie aktualnych statusów projektu, przypisań, opisów i komentarzy, według filtrów użytkownika. Użyj do przeglądu backlogu, usterek, uwag po testach albo wyboru zadań; nie zastępuje review kodu ani procedury zmiany statusów.
shared_files:
  - gh-issues-triage/references/github-reads.md
  - gh-issues-triage/references/classification.md
  - gh-issues-triage/references/packages.md
  - gh-issues-triage/references/refresh.md
---

# $gh-issues-triage

Skill jest odczytowy: wynikiem jest aktualne zestawienie z uzasadnieniem wyboru, nie zmiana issues, przypisań, statusów ani tworzenie pakietów.

Do zestawienia dopuszczaj wyłącznie otwarte issues należące do wybranego projektu. Odrzucaj zamknięte issues i issues spoza projektu przed pozostałymi filtrami. Brak potwierdzenia stanu lub przynależności oznacza lukę odczytu, nie kwalifikację do tabeli. Wyłączenie filtra statusu nie wyłącza tych reguł.

## Zakres i parametry

Przyjmuj parametry w języku naturalnym; nie wymagaj składni CLI ani formularza. Nie zapisuj w skillu nazw organizacji, numerów projektów/issues, loginów ani wykluczeń domenowych konkretnego projektu. Poniższe statusy są domyślnym filtrem, który użytkownik może nadpisać; nie są stałym ograniczeniem skilla.

| Parametr | Interpretacja i domyślne zachowanie |
| --- | --- |
| Repozytorium / projekt | Jawne wskazanie ma pierwszeństwo; w przeciwnym razie ustal repo z bieżącego katalogu. Projekt jest wymagany: wybierz go z kontekstu, a jeśli nie można wskazać go jednoznacznie, zapytaj o wybór. |
| Stan issue / przynależność | Wyłącznie otwarte issues należące do wybranego projektu. |
| Statusy projektu | Domyślnie Backlog, Do wzięcia lub Do poprawy. Użytkownik może wskazać inny zestaw albo wyłączyć filtr. Potwierdź opcje w wybranym projekcie; jeśli nie ma tych statusów ani jednoznacznych odpowiedników, zapytaj o mapowanie zamiast rozszerzać wynik. |
| Przypisanie | Domyślnie nieprzypisane ALBO przypisane do zalogowanego użytkownika ustalonego z API. Przy wielu przypisaniach wystarczy obecność jego loginu. Użytkownik może wskazać inne osoby, tylko nieprzypisane lub wyłączyć filtr. Brak odczytu tożsamości oznacza niepełny odczyt, nie zgodę na pokazanie zadań wszystkich osób. |
| Rodzaj pracy | Wszystkie, usterki/poprawki, uwagi po testach, funkcje lub inny opisany zakres; domyślnie wszystkie. |
| Włączenia / wykluczenia | Tematy, etykiety, komponenty, słowa lub wskazane issues; domyślnie brak wykluczeń. Rozróżnij wykluczenie etykiety od całej dziedziny. |
| Pakiety / zadania nadrzędne | Domyślnie pokazuj wszystkie konkretne zadania spełniające filtry wraz z potwierdzonymi relacjami pakietów. Grupuj na żądanie, zachowując widoczność poszczególnych zadań. Sugestie pakietów mogą uzupełniać wynik. |
| Sortowanie / limit | Zastosuj polecenie użytkownika; domyślnie według statusu i numeru issue, bez własnej oceny priorytetu. |

Nowa rozmowa bez parametrów korzysta z powyższych domyślnych wartości. Krótko podaj zastosowane filtry i założenia przed tabelą. Pytaj wyłącznie o braki, które uniemożliwiają jednoznaczny wybór źródła lub interpretację filtra.

## Procedury warunkowe

Odczytaj referencję przy spełnieniu warunku, przed wykonaniem danego kroku.

| Warunek | Procedura |
| --- | --- |
| MCP nie pokrywa odczytu i używasz `gh` | `<skill_dir>/references/github-reads.md` |
| Filtr rodzaju pracy, tematu lub interpretacja uwag i retestów | `<skill_dir>/references/classification.md` |
| Relacje pakietów (domyślnie), opcjonalne grupowanie lub sugestie pakietów | `<skill_dir>/references/packages.md` |
| Odświeżenie poprzedniego zestawienia | `<skill_dir>/references/refresh.md` |

## Odczyt aktualnych danych

- Preferuj dostępne narzędzia GitHub MCP, a gdy nie pokrywają odczytu, użyj `gh`. Projects v2 mogą wymagać CLI lub GraphQL także przy dostępnym MCP.
- Ustal tożsamość repo oraz, przy domyślnym filtrze przypisania, użytkownika. Gdy filtr dotyczy statusów, odczytaj rzeczywiste pola/opcje projektu i dopasuj intencję do nich; nie zakładaj angielskich etykiet ani uniwersalnej numeracji projektów.
- Pobierz issues oraz potrzebne elementy projektu: numer, URL, tytuł, stan, przypisania, etykiety, opis i status. Łącz rekordy po repo i numerze albo globalnym ID, nigdy po samym numerze przy wielu repozytoriach.
- Dla klasyfikacji pracy, uwag po testach i aktualnego problemu czytaj także komentarze. Sama lista issues ani ich etykiety nie wystarcza. Odczytaj historię pozwalającą rozróżnić nowe uwagi, naprawę i retest.
- Sprawdź paginację osobno dla issues, elementów projektu, komentarzy i relacji zadań. Stały wysoki limit nie jest dowodem kompletności. Jeśli użytkownik ograniczył wynik do N wierszy, nie przerywaj odczytu na pierwszych N rekordach przed filtrowaniem i sortowaniem.
- Błąd API, brak uprawnień lub ucięta strona nie oznacza pustego backlogu. Gdy nie można uzupełnić odczytu, podaj konkretną lukę i oznacz wynik jako częściowy. Nie zastępuj bieżących danych poprzednim raportem.

## Kwalifikacja

1. Potwierdź otwarty stan i przynależność issue do wybranego projektu.
2. Zastosuj pozostałe filtry łącznie. Alternatywy wewnątrz filtra, np. „nieprzypisane albo do mnie”, traktuj jako sumę. Dla klasyfikacji pracy, tematów i retestów zastosuj `<skill_dir>/references/classification.md`.
3. Dla pozostałych filtrów rozróżnij wynik: spełnia, nie spełnia lub do wyjaśnienia. Przy sprzecznych dowodach lub brakujących danych nie zgaduj i nie odrzucaj issue po cichu: pokaż je osobno pod tabelą jako „Do wyjaśnienia”, z powodem i dostępnym dowodem. Issues bez potwierdzonego otwartego stanu lub przynależności do projektu raportuj wyłącznie jako lukę odczytu.
4. Uzupełnij relacje pakietów według `<skill_dir>/references/packages.md`, chyba że użytkownik wyłączył ich obsługę. Relacja nie zmienia kwalifikacji konkretnego zadania.
5. Posortuj zakwalifikowane issues i dopiero wtedy zastosuj limit wyniku. Nie wliczaj sugestii pakietów do limitu konkretnych zadań. Zaznacz ograniczenie liczby pokazanych pozycji do wyjaśnienia, jeśli takie zastosujesz.

Sugestie kolejności zadań dodawaj na żądanie. Sugestie pakietów mogą stanowić uzupełnienie według `<skill_dir>/references/packages.md`.

## Raport

Podaj datę odczytu, repo/projekt, filtry i jedną tabelę:

| Issue | Status projektu | Przypisanie | Stan ustaleń / następne działanie | Dowód | Pakiet |
| --- | --- | --- | --- | --- | --- |

- Issue i pakiet linkuj do GitHuba. Przy ustaleniach po testach dodaj datę i odnośnik do komentarza, który je uzasadnia. Pustą kolumnę pakietów można pominąć, jeśli żadne zadanie nie ma relacji.
- Status pokazuj tak, jak występuje w projekcie. Brak statusu oznaczaj jednoznacznie; nie nazywaj go automatycznie backlogiem.
- Stan ustaleń pokazuj niezależnie od statusu projektu: np. zgłoszony problem, deklarowana naprawa — oczekuje na commit, oczekuje na retest, zaakceptowany retest lub do wyjaśnienia. Podaj aktualny problem, zakres ustalenia i następne działanie wynikające z dowodów; gdy nie można go określić, napisz „do ustalenia”. Brak ustaleń po testach oznacz wprost. Nie wnioskuj o wykonanej naprawie wyłącznie ze statusu projektu.
- Przy pustym wyniku podaj, że nic nie spełnia zastosowanych filtrów, o ile odczyt był kompletny. Ograniczenia odczytu podaj przy wyniku.
- Odróżnij odczyt zgłoszeń od reprodukcji problemu lub weryfikacji kodu.

Zakończ raport krótką informacją o kompletności odczytu: issues, elementy projektu, wymagane komentarze i relacje pakietów. Dla każdego obszaru określ „kompletny”, „częściowy” lub „nie dotyczy” (z powodem). Całość jest kompletna tylko wtedy, gdy żaden wymagany obszar nie jest częściowy. Przy każdej luce podaj zakres, przyczynę oraz wpływ: które wiersze lub decyzje pozostają niepewne, czy możliwe są pominięcia zadań, czy brakuje jedynie relacji pakietów. Nie utożsamiaj niejednoznacznej treści komentarzy z niepełnym odczytem API.

## Przykłady wywołania

- „$gh-issues-triage” — zastosuj domyślne statusy i przypisanie, pokaż konkretne zadania z relacjami pakietów; bez wykluczeń tematycznych.
- „$gh-issues-triage — tylko usterki lub niezaakceptowane wyniki testów; wyklucz wskazane przeze mnie domeny.”
- „$gh-issues-triage — w projekcie pod wskazanym URL pokaż wszystkie zadania dokumentacyjne; bez filtra przypisania.”
- „$gh-issues-triage — odśwież poprzednią tabelę.”
- „$gh-issues-triage — pogrupuj zadania według pakietów; bez filtra statusu i przypisania.”
- „$gh-issues-triage — zaproponuj pakiety jako uzupełnienie listy konkretnych zadań.”
