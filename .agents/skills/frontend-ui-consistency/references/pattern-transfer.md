# Transfer wzorca i tworzenie na podstawie wzorca

## Role

Określ:

- **Wzorzec** — element referencyjny,
- **Cel** — element modyfikowany,
- **Komponent kanoniczny** — źródło prawdy po zmianie.

## Dowody

Otwórz wzorzec i cel w porównywalnych stanach. Preferuj screenshoty elementów oraz zgodne dane, viewport, zoom i stan interakcji. Gdy obraz nie wystarcza, odczytaj tylko potrzebne computed styles.

## Mapa transferu

Porównaj krótko:

| Obszar | Wzorzec | Cel | Decyzja |
|---|---|---|---|
| shell i powierzchnia | ... | ... | przenieść / zachować / wydzielić |
| spacing i typografia | ... | ... | ... |
| layout i gęstość | ... | ... | ... |
| akcje i stany | ... | ... | ... |
| Live/Stimulus | ... | ... | użyć / zachować / nie przenosić |
| responsywność | ... | ... | ... |

Tabela może pozostać robocza. Raport końcowy ma zawierać tylko decyzje.

## Styl a funkcja

Zwykle można przenieść shell, border, radius, powierzchnię, nagłówek, spacing, typografię, separatory, hierarchię akcji i semantyczne tokeny.

Nie przenoś automatycznie wysokości wynikającej z treści, układu kolumn, hovera całego komponentu, mechanizmu rozwijania, eventów, Stimulus, LiveProp/LiveAction, semantyki HTML, gęstości i breakpointów.

## Wybór wzorca

- Wskazany wzorzec ma pierwszeństwo wizualne, ale nie przenoś jego błędów.
- Przy kilku wzorcach wybierz maksymalnie trzy najbliższe i preferuj funkcjonalnie zbliżony, dobrze utrzymany, często używany i zgodny z tokenami.
- Gdy brak wzorca, szukaj podobnego shellu, hierarchii, danych, stanów i gęstości. Nowy wzorzec jest ostatecznością.

## Konflikt wzorców

Konflikt występuje wtedy, gdy dwa istniejące elementy pełnią tę samą lub bardzo
podobną funkcję, ale narzucają różne reguły dla tego samego aspektu, na przykład:

- ten sam typ danych jest raz płaską listą, a raz zbiorem kart o innej hierarchii,
- główna akcja jest w jednym wzorcu przy nagłówku, a w drugim przy końcu treści,
- ten sam status jest raz neutralnym tekstem, a raz mocnym badge'em,
- ten sam formularz ma różne wysokości kontrolek, spacing lub zasady błędów.

Nie jest konfliktem różnica wynikająca z innej funkcji, gęstości, liczby danych,
stanu lub breakpointu. Nie przenoś takiej różnicy mechanicznie.

Rozstrzygaj konflikt według kolejności:

1. wzorzec wskazany przez użytkownika lub wymagany przez produkt,
2. wzorzec kanoniczny i najlepiej utrzymany,
3. wzorzec częściej używany w tej samej domenie,
4. reguła zgodna z tokenami i kontraktami komponentów.

Jeśli dowody nie wskazują zwycięzcy, nie twórz hybrydy. Zwróć `DECISION_REQUIRED`
do głównego agenta wraz z obiema opcjami, rekomendacją i konsekwencjami.

## Nowy element

Wskaż bazowy shell, nagłówek, akcje, spacing, stany i responsywność. Uzasadnij każdy nowy token lub wariant.

## Konsolidacja

Jeśli wzorzec i cel rzeczywiście dzielą stabilną odpowiedzialność, wydziel wspólną warstwę. Nie kopiuj klas, ale również nie twórz komponentu bazowego, którego API stanie się sumą wyjątków obu elementów.

## Zachowanie Stimulus

Analizuj oddzielnie. Preferuj użycie istniejącego kontrolera, aktualnych values/classes/targets, semantyczne rozszerzenie albo mniejszą odpowiedzialność. Nie duplikuj kontrolera z powodu różnicy stylu.

## Weryfikacja

Porównaj ten sam stan i viewport, shell, hierarchię, spacing, typografię, akcje, stany i funkcjonalnie uzasadnione różnice. Dobierz viewporty zgodnie z profilem.

Transfer jest ukończony, gdy cel należy do tego samego języka wizualnego, zachowuje własną funkcję, nie tworzy arbitralnych wartości ani niepotrzebnego zachowania, a wspólne reguły mają jedno źródło prawdy.
