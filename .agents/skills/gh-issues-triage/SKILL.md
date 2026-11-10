---
name: gh-issues-triage
description: >-
  Przygotowuje lub odświeża tabelę issues GitHub na podstawie aktualnych
  statusów projektu, przypisań, opisów i komentarzy, według filtrów użytkownika.
  Użyj do przeglądu backlogu, usterek, uwag po testach albo wyboru zadań;
  nie zastępuje review kodu ani procedury zmiany statusów.
---

# $gh-issues-triage

Skill jest odczytowy: wynikiem jest aktualne zestawienie z uzasadnieniem
wyboru, nie zmiana issues, przypisań, statusów ani tworzenie pakietów.

## Zakres i parametry

Przyjmuj parametry w języku naturalnym; nie wymagaj składni CLI ani formularza.
Nie zapisuj w skillu nazw organizacji, numerów projektów/issues, loginów
ani wykluczeń domenowych konkretnego projektu. Poniższe statusy są domyślnym
filtrem, który użytkownik może nadpisać; nie są stałym ograniczeniem skilla.

| Parametr | Interpretacja i domyślne zachowanie |
| --- | --- |
| Repozytorium / projekt | Jawne wskazanie ma pierwszeństwo; w przeciwnym razie ustal repo z bieżącego katalogu. Projekt wybierz z kontekstu; gdy potrzebny filtr statusu pasuje do kilku projektów, zapytaj o wybór. |
| Stan issue | Domyślnie otwarte; użytkownik może żądać zamkniętych lub wszystkich. |
| Statusy projektu | Domyślnie Backlog, Do wzięcia lub Do poprawy. Użytkownik może wskazać inny zestaw albo wyłączyć filtr. Potwierdź opcje w wybranym projekcie; jeśli nie ma tych statusów ani jednoznacznych odpowiedników, zapytaj o mapowanie zamiast rozszerzać wynik. |
| Przypisanie | Domyślnie nieprzypisane ALBO przypisane do zalogowanego użytkownika ustalonego z API. Przy wielu przypisaniach wystarczy obecność jego loginu. Użytkownik może wskazać inne osoby, tylko nieprzypisane lub wyłączyć filtr. Brak odczytu tożsamości oznacza niepełny odczyt, nie zgodę na pokazanie zadań wszystkich osób. |
| Rodzaj pracy | Wszystkie, usterki/poprawki, uwagi po testach, funkcje lub inny opisany zakres; domyślnie wszystkie. |
| Włączenia / wykluczenia | Tematy, etykiety, komponenty, słowa lub wskazane issues; domyślnie brak wykluczeń. Rozróżnij wykluczenie etykiety od całej dziedziny. |
| Pakiety / zadania nadrzędne | Domyślnie wyklucz potwierdzone zadania składowe pakietów, niezależnie od przypisania, statusu projektowego i otwartego/zamkniętego stanu pakietu. Sam pakiet pokaż, jeśli spełnia filtry tabeli. Użytkownik może jawnie zażądać pokazania składowych, grupowania albo innej reguły. |
| Sortowanie / limit | Zastosuj polecenie użytkownika; domyślnie według statusu i numeru issue, bez własnej oceny priorytetu. |

„Zaktualizuj” lub „odśwież” zachowuje ostatnie uzgodnione filtry z tej rozmowy,
chyba że użytkownik je zmieni. Nowa rozmowa bez parametrów korzysta z powyższych
domyślnych wartości. Nie odtwarzaj filtrów z pamięci starych raportów.
Krótko podaj zastosowane filtry i założenia przed tabelą. Pytaj wyłącznie o
braki, które uniemożliwiają jednoznaczny wybór źródła lub interpretację filtra.

## Odczyt aktualnych danych

- Preferuj dostępne narzędzia GitHub MCP, a gdy nie pokrywają odczytu, użyj `gh`.
  Projects v2 mogą wymagać CLI lub GraphQL także przy dostępnym MCP.
- Ustal tożsamość repo oraz, przy domyślnym filtrze przypisania, użytkownika. Gdy filtr dotyczy statusów,
  odczytaj rzeczywiste pola/opcje projektu i dopasuj intencję do nich; nie
  zakładaj angielskich etykiet ani uniwersalnej numeracji projektów.
- Pobierz issues oraz potrzebne elementy projektu: numer, URL, tytuł, stan,
  przypisania, etykiety, opis i status. Łącz rekordy po repo i numerze albo
  globalnym ID, nigdy po samym numerze przy wielu repozytoriach.
- Dla klasyfikacji pracy, uwag po testach i aktualnego problemu czytaj także
  komentarze. Sama lista issues ani ich etykiety nie wystarcza. Odczytaj
  historię pozwalającą rozróżnić nowe uwagi, naprawę i retest.
- Sprawdź paginację osobno dla issues, elementów projektu, komentarzy i
  relacji zadań. Stały wysoki limit nie jest dowodem kompletności. Jeśli
  użytkownik ograniczył wynik do N wierszy, nie przerywaj odczytu na pierwszych
  N rekordach przed filtrowaniem i sortowaniem.
- Błąd API, brak uprawnień lub ucięta strona nie oznacza pustego backlogu.
  Gdy nie można uzupełnić odczytu, podaj konkretną lukę i oznacz wynik jako
  częściowy. Nie zastępuj bieżących danych poprzednim raportem.

Przykładowe odczyty CLI, po ustaleniu wartości parametrów:

```bash
gh api user --jq .login
gh repo view --json nameWithOwner,url
gh project field-list PROJECT_NUMBER --owner OWNER --format json
gh project item-list PROJECT_NUMBER --owner OWNER --limit PAGE_LIMIT --format json
gh issue list --repo OWNER/REPO --state open --limit PAGE_LIMIT --json number,title,body,labels,assignees,updatedAt,url
gh issue view ISSUE_NUMBER --repo OWNER/REPO --json number,title,body,comments,projectItems,url
```

W tych przykładach `PAGE_LIMIT` nie zastępuje kontroli liczby wszystkich
rekordów i dalszej paginacji. Przy dużym zbiorze dobierz zbiorczy odczyt
GraphQL zamiast wielu pojedynczych zapytań; sprawdzaj też błędy GraphQL.

## Kwalifikacja i pakiety

- Filtry różnych rodzajów stosuj łącznie. Alternatywy wewnątrz filtra, np.
  „nieprzypisane albo do mnie”, traktuj jako sumę.
- Przy filtrze usterek uwzględniaj zgłoszenia błędnego zachowania oraz
  niezaakceptowane uwagi po testach także w pierwotnych zadaniach funkcjonalnych.
  Samo słowo „test”, przyszły plan QA lub nowa funkcja nie oznacza usterki.
- Oceniaj chronologię i konkretne punkty. Akceptacja jednego punktu nie zamyka
  pozostałych, a nowy retest może otwierać inny problem niż pierwotny opis.
  W wierszu opisz to, co aktualnie wymaga działania, z datą/linkiem do dowodu.
- Komentarz „naprawione, czeka na commit”, brak reprodukcji i zaakceptowany
  retest to różne stany. Pokaż rozbieżność z formalnym statusem; nie ogłaszaj
  wdrożenia ani konieczności ponownej implementacji bez dowodów.
- Wykluczenie tematyczne oceniaj zgodnie z poleceniem na podstawie tytułu,
  etykiet, opisu i istotnych komentarzy. Wzmianka o module w technicznym zadaniu
  przekrojowym nie oznacza automatycznie zadania z tej dziedziny. Dla mieszanego
  zakresu jasno wskaż, czy pozostawiasz tylko część, czy pomijasz całe issue.
- Pakiet ustalaj przez formalne relacje lub jawną listę zadań w opisie bądź
  komentarzu. Sam odnośnik, wzmianka w PR lub podobny temat nie dowodzi objęcia
  zadania pakietem. W raporcie rozróżnij relację formalną od deklaracji w treści.
- Wykrywanie pakietów wykonuj poza filtrami tabeli: sprawdź także pakiety
  przypisane innym osobom, na dowolnym statusie i zamknięte, również spoza
  wybranego projektu. Korzystaj z relacji nadrzędnych i treści pakietów; nie
  ograniczaj wyszukiwania do wstępnej listy kandydatów. Jeśli pakiet sam jest
  składową innego pakietu, domyślna reguła wykluczenia dotyczy również jego.
- Nie przenoś statusu pakietu na podzadania. Ukrycie składowej służy unikaniu
  dublowania pracy i nie oznacza jej wykonania. Pod tabelą pokaż krótko
  wykluczone numery z odnośnikami do pakietów, także gdy pakiet nie kwalifikuje
  się do tabeli. Przy częściowym zakresie pakietu odnotuj pozostałe wymagania,
  ale nie przywracaj automatycznie składowej do domyślnej tabeli. Jeśli nie
  udało się sprawdzić relacji, oznacz tę lukę zamiast deklarować usunięcie
  wszystkich składowych.
- Sugestie kolejności lub kolejnych pakietów dodawaj na żądanie, oddzielając
  dowody z GitHuba od własnej oceny. Nie utożsamiaj wspólnego tematu ze wspólną
  przyczyną błędów ani gotowością do implementacji.

## Raport

Podaj datę odczytu, repo/projekt, filtry i jedną tabelę:

| Issue | Status | Przypisanie | Aktualny problem / ostatnie ustalenia | Pakiet |
| --- | --- | --- | --- | --- |

- Issue i pakiet linkuj do GitHuba. Przy ustaleniach po testach dodaj datę
  i odnośnik do komentarza, który je uzasadnia. Pustą kolumnę pakietów można
  pominąć, jeśli żadne zadanie nie ma relacji.
- Status pokazuj tak, jak występuje w projekcie. Brak statusu, brak projektu
  i zamknięte issue oznaczaj jednoznacznie; nie nazywaj ich automatycznie backlogiem.
- Przy odświeżeniu wskaż zmiany względem poprzedniej tabeli tylko na podstawie
  ponownego odczytu: nowe pozycje, zmiany statusów i powody usunięcia.
- Przy pustym wyniku podaj, że nic nie spełnia zastosowanych filtrów, o ile
  odczyt był kompletny. Ograniczenia odczytu podaj przy wyniku.
- Odróżnij odczyt zgłoszeń od reprodukcji problemu lub weryfikacji kodu.

## Przykłady wywołania

- „$gh-issues-triage” — zastosuj domyślne statusy i przypisanie, wyklucz
  składowe pakietów; bez wykluczeń tematycznych.
- „$gh-issues-triage — tylko usterki lub niezaakceptowane wyniki testów;
  wyklucz wskazane przeze mnie domeny.”
- „$gh-issues-triage — w projekcie pod wskazanym URL pokaż wszystkie zadania
  dokumentacyjne, również zamknięte; bez filtra przypisania.”
- „$gh-issues-triage — odśwież poprzednią tabelę.”
- „$gh-issues-triage — pokaż również składowe pakietów; bez filtra statusu
  i przypisania.”
