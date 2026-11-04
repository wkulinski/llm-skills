# Ponawianie nieudanych testów

Wczytaj tę referencję, gdy pełna komenda testowa zakończyła się błędami
lub konfigurujesz jej powiązanie z wrapperem przyjmującym selektory.

## Konfiguracja konsumenta

Do obiektu komendy testowej w `./.agents/qa-run.matrix.json` dodaj `testRetry`:

```json
{
  "cmd": "./bin/proxy/composer --proxy-quiet test:qa",
  "parser": "codeception-junit",
  "testRetry": {
    "runner": "codeception",
    "report": "tests/_output/codeception-qa.xml",
    "format": "codeception-junit"
  }
}
```

`runner` wskazuje istniejący wpis `targetedTests`. Przykładowo `tool` to
`codecept`, a `args` to `["--proxy-quiet", "run", "--no-interaction", "--env", "test", "--xml=codeception-qa.xml"]`.
Entrypoint rozwiązuje wspólny resolver. Zachowaj środowisko, bootstrap i opcje
pełnej komendy; wrapper musi obsługiwać przekazane selektory.

Pełna komenda musi zapisywać świeży raport pod `report` (ścieżka względem repo,
widoczna również na hoście). Dla Codeception ustaw odpowiednie `--xml` w
komendzie lub jej skrypcie Composer. Runner nie zgaduje nazwy raportu ani
nie dopisuje flag do dowolnych komend.

Wrapper ponowienia Codeception musi również zapisywać świeży raport pod tym
samym `report`. Ustaw `--xml` w `targetedTests.args`, uwzględniając katalog
wyjściowy Codeception. Kod wyjścia `0` wystarcza dopiero wraz z raportem,
w którym wybrana metoda faktycznie się wykonała i żaden jej wariant danych
nie ma błędu ani `skipped`. Brak metody lub świeżego raportu pozostawia
nieudany selektor w kolejce. Dotyczy to również testów pominiętych z powodu
`Depends`: przywróć możliwość ich wykonania lub uzgodnij potrzebny zakres;
runner nie uruchamia automatycznie pełnego suite ani testów zależnych.

Formaty:

- `codeception-junit`: wybór `plik:metoda` z elementów JUnit `failure` i `error`.
  Ścieżki kontenerowe `/srv/app/`, `/app/`, `/workspace/` są przeliczane na repo.
  Warianty danych tej samej metody mają wspólny selektor.
- `vitest-json`: raport Vitest `--reporter=json --outputFile=<report>`;
  selekcja obejmuje pliki zawierające nieudane testy, ponieważ argumenty
  pozycyjne Vitest wybierają pliki. Poprawne pliki nie są ponawiane.

Stara macierz bez `testRetry` nadal działa. Nie zyskuje automatycznie wąskich
ponowień: uzupełnij powiązanie i raport w konfiguracji konsumenta. Nie zmieniaj
przy tej okazji zakresu lintów ani innych komend.

## Kontynuacja sesji

1. Pełny przebieg z `--session` wykonuje komendy macierzy. Po niepowodzeniu
   testów zapisuje selektory, wynik wcześniejszych kontroli i kolejkę komend,
   do których nie dotarł przez fail-fast. `summary.json` wskazuje
   `testRecoveryAvailable=true`.
2. Wykonaj naprawę wynikającą z tych błędów, a następnie:
   `node <skill_dir>/scripts/run-matrix.mjs --session <session> --rerun-reason failed-tests`.
3. Runner uruchamia każdy zapisany selektor przez wrapper, bez powłoki.
   Nie ponawia poprawnych testów. Jeśli nadal jest błąd, następne ponowienie
   obejmuje nierozwiązane i jeszcze niewykonane selektory.
4. Po sukcesie testów wykonuje kontrole pominięte po wcześniejszym błędzie,
   w ich pierwotnej kolejności. Sukces samych wybranych testów nie zamyka QA,
   gdy pozostały niewykonane kontrole.
   Jeśli kolejna kontrola zakończy się błędem, następne `failed-tests`
   wznawia od tej kontroli i zachowuje resztę kolejki; nie powtarza już
   poprawnych testów.

To ścieżka naprawy rozpoznanych błędów, nie sposób dołączania niezależnych zmian.
Agent sprawdza zakres poprawek. Jeśli naprawa unieważnia również wynik innej
kontroli, sprawdza ją według zwykłych zasad delta. Zmiana macierzy, repo albo
HEAD unieważnia checkpoint. Brak świeżego raportu, brak jednoznacznej
identyfikacji testów lub błąd uruchomienia nie uruchamiają pełnego suite
w zastępstwie. Uzupełnij dowód/konfigurację lub uzgodnij zakres dalszej kontroli.

## Znaczenie wyniku

`mode=failed-tests` oraz `qaCompletion=full-with-failed-test-retry` oznaczają
zakończenie wcześniejszego pełnego QA przez wąskie ponowienie i wykonanie
pozostałych kontroli. `recovery.reusedCommands` podaje liczbę wykorzystanych
wcześniejszych wyników. Sesja zapisuje `lastCompletedQa`; nie tworzy nowego
`lastFullPass`, bo nie wykonała ponownie pełnego zestawu.

Taki wynik spełnia bramkę procedury po review, gdy ma `status=PASS`,
`evidence=current` i brak zaległej kontroli `pendingFinalFullPass`.
Samodzielne `point`/`partial` nadal nie spełnia tej bramki.
Nie uruchamiaj ponownie pełnego QA tylko po to, by zmienić rodzaj dowodu.
