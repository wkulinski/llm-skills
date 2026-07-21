# Format raportu

Dobierz format do profilu. Pomijaj sekcje nieistotne; nie wpisuj serii „nie dotyczy”.

## Raport skrócony — profil minimalny

```text
Tryb i profil:
Zmiana:
Wzorzec lub istniejąca reguła:
Weryfikacja: strona/stan, viewport, screenshoty i najważniejszy stan
Weryfikacja Playwright i konsola:
Ryzyka lub brak weryfikacji:
```

## Raport pełny — profil standardowy lub rozszerzony

### Tryb, profil i kontekst

- Tryb:
- Profil i uzasadnienie:
- Funkcja ekranu:
- Gęstość i poziom zmiany:
- Hierarchia działań:

### Wzorzec i decyzja

- Wzorzec:
- Cel:
- Komponent kanoniczny:
- Przeniesiono:
- Świadomie zachowano:
- Odrzucono:

### Implementacja

- Zmienione pliki i komponenty:
- Zmiany API, wariantów, blocks lub slots:
- Nowe tokeny lub wyjątki wraz z uzasadnieniem:
- Zmiany kontraktu Live lub Stimulus:

### Weryfikacja

- Strona i stan:
- Viewporty:
- Screenshot before i after; screenshot wzorca, jeśli wzorzec istnieje i został odtworzony:
- Sprawdzone stany i interakcje:
- Live/Stimulus lifecycle:
- Computed styles użyte do rozstrzygnięcia różnic:
- Błędy zastane przed scenariuszem:
- Nowe błędy konsoli lub requestów po scenariuszu:
- Weryfikacja Playwright i visual regression:
- Wynik review diffu:

### Kontrola estetyczna

Podaj tylko najważniejsze decyzje: hierarchię, rytm, wyrównanie optyczne, powierzchnie, ikony lub gęstość. Nie pisz ogólnie „wygląda lepiej”.

Jeżeli użyto trybu doszlifowania, dodaj:

- Profil doszlifowania: `zachowawczy` / `dopracowany` / `charakterystyczny`:
- Teza kompozycyjna:
- Dominanta, główna akcja i element osłabiony:
- Pakiet dowodów: ekran, funkcja, stan, viewport, komponent i wzorzec:
- Ranking problemów: wpływ, zasięg, pewność i ryzyko:
- Problem wyjściowy:
- Maksymalnie trzy korekty o największym wpływie:
- Zachowany wzorzec lub token:
- Świadomie odrzucona dekoracja albo wyjątek:
- Różnica widoczna na screenshotach before/after:
- Wynik bramki dobrego gustu:

Jeżeli decyzja została zablokowana, zamiast deklarować ukończenie użyj formatu:

```text
DECISION_REQUIRED
Pytanie:
Rekomendacja:
Opcja A:
Opcja B:
Dowody:
Ryzyko decyzji:
```

### Ryzyka i brak weryfikacji

Wymień wyłącznie realne ryzyka. Gdy czegoś nie sprawdzono, podaj konkretną przyczynę. Jeżeli brak znanych ryzyk, napisz `Brak znanych ryzyk`.

## Zasady

- Nie ujawniaj prywatnego toku rozumowania.
- Wymieniaj konkretne parametry i dowody.
- Nie twierdź, że UI zweryfikowano wizualnie bez obejrzenia screenshotu.
- Jawnie wskaż nowe tokeny, warianty, wyjątki i zmiany publicznego kontraktu.
- Podawaj ścieżki artefaktów, ale nie zawartość storage state ani sekretów.
