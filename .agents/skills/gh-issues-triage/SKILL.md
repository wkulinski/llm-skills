---
name: gh-issues-triage
description: "Przygotowuje lub odświeża raport issues GitHub: oczekujące w dynamicznych kategoriach, blokowane z wyjaśnieniami i pominięte według statusów. Użyj do przeglądu backlogu, usterek, uwag po testach albo wyboru zadań według filtrów użytkownika; nie zastępuje review kodu ani procedury zmiany statusów."
shared_files:
  - gh-issues-triage/references/github-reads.md
  - gh-issues-triage/references/classification.md
  - gh-issues-triage/references/packages.md
  - gh-issues-triage/references/refresh.md
---

# $gh-issues-triage

Skill jest odczytowy: wynikiem jest aktualne zestawienie z uzasadnieniem wyboru, nie zmiana issues, przypisań, statusów ani tworzenie pakietów.

Do zestawienia dopuszczaj wyłącznie otwarte issues należące do wybranego projektu. Odrzucaj zamknięte issues i issues spoza projektu przed pozostałymi filtrami. Brak potwierdzenia stanu lub przynależności oznacza lukę odczytu, nie kwalifikację do listy. Wyłączenie filtra statusu nie wyłącza tych reguł.

## Zakres i parametry

Przyjmuj parametry w języku naturalnym; nie wymagaj składni CLI ani formularza. Nie zapisuj w skillu nazw organizacji, numerów projektów/issues, loginów ani wykluczeń domenowych konkretnego projektu. Poniższe statusy są domyślnym filtrem, który użytkownik może nadpisać; nie są stałym ograniczeniem skilla.

| Parametr | Interpretacja i domyślne zachowanie |
| --- | --- |
| Repozytorium / projekt | Jawne wskazanie ma pierwszeństwo; w przeciwnym razie ustal repo z bieżącego katalogu. Projekt jest wymagany: wybierz go z kontekstu, a jeśli nie można wskazać go jednoznacznie, zapytaj o wybór. |
| Stan issue / przynależność | Wyłącznie otwarte issues należące do wybranego projektu. |
| Milestone | Domyślnie bez filtra. Uwzględnij albo wyklucz wskazane milestone'y według rzeczywistego pola GitHuba, w repozytorium danego issue. Potwierdzony brak przypisanego milestone odróżnij od braku odczytu. |
| Statusy projektu | Domyślnie w „Oczekujące” Backlog, Do wzięcia lub Do poprawy. Zadania w trakcie realizacji (np. W trakcie, W toku, In progress), w testach (np. W testach, Testing) i w code review wylicz w „Pominięte”, a blokady wydziel według sekcji „Raport”. Nie traktuj wykluczonych statusów jako odpowiedników statusów domyślnych. Użytkownik może wskazać inny zestaw albo wyłączyć filtr. Potwierdź opcje w wybranym projekcie; jeśli nie ma tych statusów ani jednoznacznych odpowiedników, zapytaj o mapowanie zamiast rozszerzać wynik. |
| Przypisanie | Domyślnie nieprzypisane ALBO przypisane do zalogowanego użytkownika ustalonego z API. Przy wielu przypisaniach wystarczy obecność jego loginu. Użytkownik może wskazać inne osoby, tylko nieprzypisane lub wyłączyć filtr. Brak odczytu tożsamości oznacza niepełny odczyt, nie zgodę na pokazanie zadań wszystkich osób. |
| Rodzaj pracy | Wszystkie, usterki/poprawki, uwagi po testach, funkcje lub inny opisany zakres; domyślnie wszystkie. |
| Włączenia / wykluczenia | Tematy, etykiety, komponenty, słowa lub wskazane issues; domyślnie brak wykluczeń. Rozróżnij wykluczenie etykiety od całej dziedziny. |
| Pakiety (adnotacje i grupowanie) | Domyślnie pokazuj wszystkie konkretne zadania spełniające filtry wraz ze zwięzłą adnotacją potwierdzonych relacji pakietów. Grupowanie według pakietów stosuj na żądanie zamiast kategorii tematycznych, zachowując widoczność poszczególnych zadań. Sugestie pakietów dodawaj na żądanie. O widoczności podzadań decyduje wiersz „Widok (parent)”. |
| Widok (parent) | Parent to issue ustawione w GitHubie jako rodzic innego issue (relacja sub-issue). Domyślnie widok ogólny („tylko parenty”): „Oczekujące” wyklucza podzadania, czyli issues mające parenta; parenty i issues bez relacji parent–child pozostają. Widok szczegółowy (na żądanie, np. „wszystkie zadania”, „z podzadaniami”) pokazuje w „Oczekujące” także podzadania. Filtr nie dotyczy „Blokowane” ani grupy „W testach” w „Pominięte” — te listy zawsze obejmują zadania z parentem i bez; pozostałe grupy „Pominięte” go stosują. Status i przypisanie parenta nie wpływają na kwalifikację zadania, a pozycja zawsze pokazuje numer samego zadania, nie jego parenta. |
| Sortowanie | Zastosuj polecenie użytkownika; domyślnie w obrębie kategorii według statusu i numeru issue, bez własnej oceny priorytetu. Pokazuj wszystkie issues spełniające filtry, bez ograniczania liczby pozycji. |

Repozytorium/projekt, milestone, przypisanie i dokładnie wskazane etykiety wyznaczają zakres wszystkich sekcji raportu. Brak odczytu pola potrzebnego do aktywnego filtra oznacza lukę odczytu; nie zgaduj wartości ani nie rozszerzaj przez to zakresu raportu.

Nowa rozmowa bez parametrów korzysta z powyższych domyślnych wartości. Krótko podaj zastosowane filtry i założenia we wstępie. Pytaj wyłącznie o braki, które uniemożliwiają jednoznaczny wybór źródła lub interpretację filtra. Projektowe prompty mogą dostarczać filtry; nie przenoś ich nazw projektów, milestone'ów ani wykluczeń do domyślnych reguł skilla.

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
- Pobierz issues oraz potrzebne elementy projektu: numer, URL, tytuł, stan, przypisania, etykiety, opis i status, a przy aktywnym filtrze milestone także jego wartość. Łącz rekordy po repo i numerze albo globalnym ID, nigdy po samym numerze przy wielu repozytoriach.
- Dla klasyfikacji pracy, uwag po testach i aktualnego problemu czytaj także komentarze. Sama lista issues ani ich etykiety nie wystarcza. Odczytaj historię pozwalającą rozróżnić nowe uwagi, naprawę i retest.
- Dla blokad sprawdź aktualne relacje blokowania oraz opis i komentarze issue. Potwierdź kierunek zależności i czy blokada nadal obowiązuje; historyczna wzmianka ani sama relacja parent–child nie dowodzi aktualnej blokady. Status „Blokowane” (lub jego odpowiednik w projekcie) oznacza deklarowaną blokadę, ale bez ustalonej przyczyny kwalifikuje issue do „Do wyjaśnienia”, nie do listy potwierdzonych blokad. Jeśli wskazano blokujące issue, odczytaj jego aktualny stan także wtedy, gdy jest poza filtrami zestawienia; nie dodawaj go z tego powodu jako osobnej pozycji raportu. Zamknięcie blokującego issue przy nadal deklarowanej blokadzie wymaga wyjaśnienia, nie automatycznego uznania blokady za usuniętą.
- Sprawdź paginację osobno dla issues, elementów projektu, etykiet, komentarzy i relacji zadań (w tym blokowania). Stały wysoki limit stron API nie jest dowodem kompletności.
- Błąd API, brak uprawnień lub ucięta strona nie oznacza pustego backlogu. Gdy nie można uzupełnić odczytu, podaj konkretną lukę i oznacz wynik jako częściowy. Nie zastępuj bieżących danych poprzednim raportem.

## Kwalifikacja

1. Potwierdź otwarty stan i przynależność issue do wybranego projektu.
2. Zastosuj pozostałe filtry łącznie, z wyjątkami dla „Blokowane” opisanymi w sekcji „Raport”. Alternatywy wewnątrz filtra, np. „nieprzypisane albo do mnie”, traktuj jako sumę. Dla klasyfikacji pracy, tematów i retestów zastosuj `<skill_dir>/references/classification.md`.
3. Dla filtrów mających zastosowanie w danej sekcji rozróżnij wynik: spełnia, nie spełnia lub niepewny. Przy sprzecznych dowodach lub brakujących danych nie zgaduj i nie odrzucaj issue po cichu: pokaż je w „Oczekujące → Niesklasyfikowane”, z powodem i dostępnym dowodem. Niejasność, czy issue powinno nadal być blokowane, należy do „Blokowane → Do wyjaśnienia”. Issues bez potwierdzonego otwartego stanu lub przynależności do projektu raportuj wyłącznie jako lukę odczytu.
4. Uzupełnij relacje pakietów według `<skill_dir>/references/packages.md`, chyba że użytkownik wyłączył ich obsługę. Relacja nie zmienia kwalifikacji konkretnego zadania.
5. Posortuj zakwalifikowane issues.

Domyślnie rekomenduj jedno zadanie zgodnie z sekcją „Raport”. Szerszą kolejność zadań i sugestie pakietów dodawaj na żądanie, jako krótkie uzupełnienie w „Oczekujące”, według `<skill_dir>/references/packages.md`.

## Raport

Zacznij dwiema krótkimi liniami, bez osobnego nagłówka: pierwsza zawiera repo/projekt (link) oraz datę i godzinę odczytu z oznaczeniem strefy; druga zwięźle podaje zastosowane filtry, bez powtarzania liczby oczekujących podawanej na końcu. Przykład:

```markdown
**[Projekt](URL) · DD.MM.RRRR, HH:MM CET**
Otwarte, nieprzypisane lub do `login` · widok ogólny (bez podzadań).
```

Strefa w przykładzie nie jest stałą: użyj strefy ustalonej dla projektu lub użytkownika, a przy jej braku UTC; nie oznaczaj czasu UTC jako lokalnego. Dalej stosuj dokładnie trzy sekcje główne: `## Oczekujące`, `## Blokowane`, `## Pominięte`. Bez tabeli i bez dodatkowych sekcji głównych. Rozróżniaj odczyt zgłoszeń od reprodukcji problemu lub weryfikacji kodu.

### Oczekujące

Na początku `## Oczekujące`, przed kategoriami, wskaż jedno rekomendowane issue z listy oczekujących w cytacie Markdown: `> **Na początek: [#N](URL)** — uzasadnienie.` Nie powtarzaj tu tytułu — pełny tytuł pozostaje w kategorii. Uzasadnienie podaj w jednym zdaniu opartym na aktualnych danych. Powinno wskazywać najważniejszy powód wyboru, bez streszczania zadania ani opisywania sposobu realizacji. To ocena agenta, nie priorytet nadany przez projekt; nie przedstawiaj niezweryfikowanego wpływu jako faktu. Nie wybieraj zadania blokowanego ani z podsekcji „Niesklasyfikowane”. Gdy nie ma oczekujących zadań do podjęcia, pomiń rekomendację, bez zastępczej propozycji z innej sekcji.

Na podstawie aktualnej treści issues wyprowadź rozłączne kategorie tematyczne. Ich nazwy, liczbę i kolejność dobierz do bieżącego wyniku, nie kopiuj z poprzedniego raportu ani przykładu. Każde zakwalifikowane issue pokaż dokładnie raz w kategoriach; powtórzenie rekomendowanego issue we wstępie jest tylko wyróżnieniem, nie dodatkowym zadaniem i nie zwiększa liczników. Pomiń puste kategorie. Stosuj format:

```markdown
## Oczekujące
> **Na początek: [#N](URL)** — Jedno zdanie wskazujące najważniejszy powód wyboru, bez streszczania zadania ani opisywania sposobu realizacji.
>
> `etykieta 1` · `etykieta 2`

### Nazwa kategorii (N)
- [#N](URL) — Tytuł issue *(Status)*\
  `etykieta 1` · `etykieta 2`
```

Po kategoriach tematycznych dodaj `### Niesklasyfikowane (N)` dla issues o oczekującym statusie, bez blokady, których kwalifikacji według pozostałych filtrów nie da się rozstrzygnąć, np. przy sprzecznych dowodach co do rodzaju pracy albo przypisania. Każdą pozycję pokaż jako `- [#N — Tytuł issue](URL): …` z maksymalnie dwoma zdaniami wyjaśnienia: czego dotyczy niepewność i jakiego ustalenia brakuje, z linkiem do dowodu na zasadach podsekcji „Do wyjaśnienia” w „Blokowane”. Podsekcja nie jest kategorią tematyczną, a jej pozycje nie trafiają do rekomendacji i nie wliczają się do `Razem oczekujące`. Przy kompletnym odczycie i braku takich issues pomiń podsekcję.

Pod rekomendacją, pod każdą pozycją w kategoriach „Oczekujące” oraz w podsekcjach „Niesklasyfikowane” i „Do wyjaśnienia” pokaż w osobnej linii wszystkie rzeczywiste etykiety przypisane do danego issue w GitHubie: każda nazwa jako kod inline, oddzielona ` · `. Zachowaj dokładne nazwy, bez tłumaczenia i wymyślania etykiet; sortuj je alfabetycznie. Dobierz delimitery kodu tak, aby nazwy zawierające backticki pozostały poprawnie wyświetlane. Nie stosuj obrazków, HTML ani zewnętrznych usług badge'ów. Etykiety rekomendowanego issue pokaż zarówno w cytacie, jak i pod jego pozycją w kategorii. Gdy potwierdzono brak etykiet, pomiń całą dodatkową linię, również pustą linię cytatu. Przy błędzie lub niepełnym odczycie etykiet nie deklaruj ich braku ani nie pokazuj niepełnej listy jako kompletnej — oznacz lukę przy odpowiedniej pozycji i w informacji o kompletności. W cytacie użyj osobnej linii `>` między rekomendacją a etykietami; pod pozycją listy zastosuj wcięcie i twardy podział wiersza Markdown, aby etykiety pozostały pod tym samym issue. Nie dodawaj etykiet w podsekcji potwierdzonych „Blokowane” ani w sekcji „Pominięte”. Etykiety nie zastępują statusu projektu.

Podawaj rzeczywisty tytuł i status projektu; brak statusu oznacz jako *(bez statusu)*, nie jako Backlog. Nie dodawaj domyślnie opisów, przypisań, następnych działań ani osobnych pól dowodowych do każdej pozycji. Potwierdzony pakiet zaznacz krótką adnotacją z linkiem, zgodnie z referencją pakietów. Nie wyciągaj wniosku o naprawie ze statusu; sprzeczność istotną dla kwalifikacji przenieś do „Niesklasyfikowane”. Przy kompletnym odczycie i pustym wyniku napisz „Brak issues spełniających filtry”.

### Blokowane

Pod `## Blokowane` umieść dwie podsekcje w tej kolejności: `### Do wyjaśnienia (N)`, następnie `### Blokowane (N)`. W pierwszej pokaż issues, przy których trzeba wyjaśnić, czy nadal powinny być blokowane: niejasna aktualność blokady, nieustalona przyczyna deklarowanej blokady albo zamknięte blokujące issue przy nadal deklarowanej blokadzie. W drugiej umieszczaj wyłącznie potwierdzone aktualne blokady o ustalonej przyczynie; sama lista otwartych zagadnień przy statusie „Blokowane” nie wystarcza do przypisania przyczyny. Przyczyną może być inne issue, brak decyzji lub dostępu — numer blokującego issue nie jest wymagany, jeśli rzeczywista przeszkoda jest ustalona. Nie powielaj tych zadań w „Oczekujące” ani „Pominięte”.

Dla obu podsekcji stosuj pozostałe filtry użytkownika poza filtrem statusu listy oczekujących, filtrem widoku (parent) i filtrem rodzaju pracy wymagającym interpretacji treści. Nie uzależniaj widoczności blokady od oceny, czy zadanie jest usterką czy funkcją. Polecenie „z etykietą `bug`” pozostaje dokładnym filtrem pola GitHuba i obowiązuje również tutaj. Potwierdzona blokada wynikająca z treści lub relacji kwalifikuje się tutaj także przy statusie Backlog.

W podsekcji „Do wyjaśnienia” każdą pozycję pokaż jako link z numerem i tytułem oraz maksymalnie dwa zdania wyjaśnienia:

`- [#N — Tytuł issue](URL): Na czym polega niejasność blokady; blokujące [#M](URL), jeśli można je ustalić.`

Pod wyjaśnieniem dodaj linię rzeczywistych etykiet issue w formacie `etykieta 1` · `etykieta 2`, na tych samych zasadach co w „Oczekujące”. Etykiety nie wliczają się do dwóch zdań wyjaśnienia.

Wyjaśnij rzeczywistą niejasność, nie samo powtórzenie statusu. Jeśli nie udało się ustalić przyczyny lub blokującego issue, zaznacz to bez zgadywania. Ustalenia z treści poprzyj linkiem do opisu lub komentarza w ramach tych samych dwóch zdań; przy wynikach testów podaj także datę.

W podsekcji „Blokowane” podawaj wyłącznie linkowany numer i tytuł, jak w zwięzłej liście oczekujących: `- [#N](URL) — Tytuł issue`. Bez uzasadnień, statusów, adnotacji pakietów ani dodatkowych linków do blokujących zadań. Nadal sprawdzaj dowody i aktualność blokad przed kwalifikacją; skrócony format nie ogranicza odczytu danych.

Przy kompletnym odczycie i pustej podsekcji napisz „Brak”; przy luce oznacz ją jako częściową. W obu podsekcjach sortuj według repo i numeru issue.

### Pominięte

Pod `## Pominięte` pokaż krótkie listy linkowanych numerów, bez tytułów i opisów, z liczbą w każdej grupie:

```markdown
## Pominięte
- W trakcie (N): [#N](URL), …
- W testach (N): [#N](URL), …
- Code review (N): [#N](URL), …
```

Uwzględniaj wyłącznie otwarte issues wybranego projektu spełniające pozostałe filtry, pominięte z powodu statusu grupy. Filtr widoku (parent) stosuj zgodnie z tabelą parametrów.

Domyślnie pokaż powyższe trzy grupy; jeśli użytkownik jawnie włączył dany status do oczekujących lub wyłączył filtr statusu, nie wyliczaj go ponownie jako pominiętego. Dodatkowe grupy statusów pokazuj tylko na żądanie. Nie wypisuj zadań zamkniętych, spoza projektu ani odrzuconych z innych powodów. Przy kompletnym odczycie i pustej grupie podaj „(0): brak”; przy luce oznacz listę jako częściową. Numery sortuj rosnąco, bez duplikatów; przy wielu repo rozdziel listy według repo.

Na końcu, bez nowego nagłówka, przy kompletnym odczycie issues, elementów projektu, etykiet, wymaganych komentarzy, relacji pakietów i blokad wystarczy: `Dane kompletne · bez zmian w GitHubie.` Nie wypisuj wtedy liczby pobranych rekordów ani szczegółów paginacji. Przy niepełnym odczycie zamiast tego podaj zakres luki, przyczynę i wpływ; liczby rekordów i szczegóły techniczne dodaj tylko, jeśli pomagają wyjaśnić ograniczenie. Nie ukrywaj ograniczeń interpretacji załączników, jeśli wpływają na wynik. Nie utożsamiaj niejasnych ustaleń z błędem odczytu API ani nie deklaruj „brak” przy niepełnym odczycie. Ostatnia linia: `Razem oczekujące: **N issues**.` — liczba dotyczy wyłącznie pozycji w kategoriach tematycznych „Oczekujące”, bez „Niesklasyfikowane” i bez pozostałych sekcji.

## Przykłady wywołania

- „$gh-issues-triage” — zastosuj domyślne filtry i przygotuj raport zgodnie z sekcją „Raport”.
- „$gh-issues-triage — pokaż wszystkie zadania, z podzadaniami.” — zastosuj widok szczegółowy: „Oczekujące” obejmuje także podzadania.
- „$gh-issues-triage — uwzględnij także zadania w trakcie.” — rozszerz domyślne statusy o status rozpoczętej pracy w wybranym projekcie; zachowaj pozostałe filtry.
- „$gh-issues-triage — tylko usterki lub niezaakceptowane wyniki testów; wyklucz wskazane przeze mnie domeny.”
- „$gh-issues-triage — tylko milestone MILESTONE i tylko usterki.” — filtr milestone obowiązuje wszystkie sekcje; dla blokad pomiń interpretacyjny filtr rodzaju pracy.
- „$gh-issues-triage — wyklucz milestone MILESTONE; tylko z etykietą `bug`.” — oba filtry obowiązują wszystkie sekcje, także blokady.
- „$gh-issues-triage — w projekcie pod wskazanym URL pokaż wszystkie zadania dokumentacyjne; bez filtra przypisania.”
- „$gh-issues-triage — odśwież poprzednie zestawienie.”
- „$gh-issues-triage — pogrupuj zadania według pakietów; bez filtra statusu i przypisania.”
- „$gh-issues-triage — zaproponuj pakiety jako uzupełnienie listy konkretnych zadań.”
