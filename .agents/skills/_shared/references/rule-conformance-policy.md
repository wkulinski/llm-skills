# Rule Conformance Policy

Ta referencja definiuje jeden, neutralny technologicznie kontrakt rozliczania
zgodności zmiany z obowiązującymi regułami: **reguła → zakres → dowód → wynik**.
Definiuje semantykę, a nie procedurę konkretnego skilla: punkty użycia i
mapowanie na własny raport należą do skilli, które ją konsumują.

## 1. Cel i granice
- Celem jest uczciwe rozliczenie, czy zmiana spełnia właściwe reguły, oraz
  rozróżnienie naruszenia, braku zastosowania, braku dowodu i autoryzowanego
  wyjątku.
- W zakresie: semantyka źródeł, doboru reguł, mocy obowiązywania, dowodu, wyniku,
  wyjątków, konfliktów, kontroli pominięć i unieważnienia wyniku.
- Poza zakresem: globalne skanowanie i numerowanie wszystkich reguł repozytorium,
  format planu, sidecar JSON, helpery oraz własna hierarchia instrukcji.

## 2. Reguła i zakres
Regułę identyfikuje **źródło** (plik i sekcja) oraz **zakres zastosowania**:
warstwa, moduł, typ pliku, przepływ albo warunek aktywacji.
- Reguła bez ustalonego zakresu nie może otrzymać wyniku `SATISFIED`; najpierw
  ustal, czy w ogóle dotyczy zmiany.
- Zakres wyznaczasz z treści reguły i jej źródła, nie z tego, czy spełnienie jest
  wygodne.
- Reguła o węższym zakresie ma pierwszeństwo przed regułą ogólną w swoim zakresie.

## 3. Aktywne źródła i pierwszeństwo
Aktywne źródła ustalasz z: instrukcji repozytorium, mapy dokumentów (`docs_map`),
referencji wspólnych, instrukcji path-specific oraz profili warunkowych.
- Profil warunkowy jest aktywny tylko wtedy, gdy jego warunek aktywacji jest
  jednoznacznie spełniony. Profil nieaktywny nie jest źródłem reguł i nie
  powoduje naruszenia.
- Gdy aktywacji nie da się rozstrzygnąć, nie zakładaj zgodności: użyj
  `NOT_VERIFIED` i wskaż brakujący dowód aktywacji.
- Lokalne nadpisanie repozytorium obowiązuje w swoim zakresie zgodnie z aktualnym
  pierwszeństwem; wspólny baseline stosuj tam, gdzie lokalne źródło go nie
  nadpisuje.
- Pierwszeństwo między źródłami rozstrzygają istniejące dokumenty repozytorium
  (m.in. kolejność priorytetów współpracy i kontrakt priorytetu w skillach). Ta
  referencja nie tworzy własnej hierarchii ani jej nie nadpisuje.
- Uwzględniaj nadrzędne instrukcje środowiska (systemowe/developerskie) jako
  najwyższy poziom pierwszeństwa; nie oceniaj ich jako reguł zmiany, ale ta
  polityka nie może ich nadpisać.

## 4. Dobór reguł istotnych dla zmiany
Rozliczasz reguły istotne dla zakresu zmiany, nie całe repozytorium.
- Regułę uznaj za istotną, gdy zmiana ją dotyka, rozszerza, omija albo zmienia
  warunki jej spełnienia.
- Nie pomijaj reguły tylko dlatego, że zmiana jest mała ani dlatego, że jej
  naruszenie nie wywołuje jeszcze awarii runtime.
- Identyczne zastosowania tej samej reguły grupuj w jeden wpis; nie rozbijaj
  rejestru na powtórzenia.

## 5. Moc obowiązywania
Każda reguła ma jawnie ustaloną moc:
- `mandatory` — naruszenie jest defektem i nie znika przez proporcjonalność;
- `recommendation` — odstępstwo oceniasz proporcjonalnie; nie staje się
  automatycznie twardą granicą;
- `exception` — dopuszczone odstępstwo, ale wyłącznie w granicach autoryzacji.

## 6. Rejestr zgodności
Jeden wpis rejestru opisuje jedną regułę istotną dla zmiany i zawiera:
- `źródło`: plik i sekcja,
- `moc`: `mandatory` / `recommendation` / `exception`,
- `zastosowanie`: dlaczego i gdzie reguła dotyczy zmiany,
- `dowód`: konkretny odczyt, plik, fragment, komenda albo wynik potwierdzający
  rezultat,
- `wynik`: dokładnie jeden z pięciu wyników z sekcji 7.

Rejestr jest częścią istniejącego raportu albo stanu; nie tworzy nowego artefaktu
ani sidecara.

## 7. Wyniki i wymagania dowodowe
- `SATISFIED` — wymaga dowodu potwierdzającego spełnienie. Samo przeczytanie
  reguły, samo istnienie mechanizmu albo zielone testy nie są dowodem zgodności.
- `VIOLATED` — wymaga wskazania naruszonej reguły, dowodu naruszenia i dotkniętego
  zakresu. Brak dowodu nie pozwala ogłosić `VIOLATED`.
- `NOT_APPLICABLE` — wymaga krótkiego uzasadnienia, dlaczego reguła nie dotyczy
  zakresu zmiany.
- `NOT_VERIFIED` — brak wystarczającego dowodu do rozstrzygnięcia; nazwij
  brakujący dowód i sposób jego uzyskania.
- `EXEMPTED` — wymaga autoryzatywnej decyzji i zakresu wyjątku (sekcja 8).

Zasady dodatkowe:
- Reguła, której źródła nie odczytano, nie może otrzymać `SATISFIED`.
- Brak mechanicznego testu nie jest samodzielnie `NOT_VERIFIED`: gdy zgodność
  potwierdza wystarczający odczyt kodu, wynikiem jest `SATISFIED`, a luka
  mechaniczna pozostaje jawnie nazwana (np. jako potrzeba testu), bez
  przemianowywania jej na naruszenie.

## 8. Wyjątki
- `EXEMPTED` wymaga decyzji autoryzatywnej (właściciel reguły, użytkownik albo
  jawnie wskazany kontrakt) oraz określonego zakresu: które reguły, gdzie i do
  kiedy.
- Wyjątek opisany wyłącznie w kodzie, historii zmian lub konwencji, bez decyzji,
  nie jest wyjątkiem; taki przypadek pozostaje `VIOLATED` albo `NOT_VERIFIED`.
- Wyjątek nie rozciąga się automatycznie na inne reguły ani na inne przypadki tej
  samej reguły.

## 9. Konflikty
- Gdy dwie aktywne reguły dają sprzeczne wymagania, a rozstrzygnięcie wpływa na
  decyzję, spór pozostaje **nierozstrzygnięty**: nie wybieraj wygodniejszej strony
  i nie deklaruj zgodności.
- Wskaż oba źródła, sprzeczność i potrzebną decyzję; do czasu jej podjęcia
  wynikiem jest `NOT_VERIFIED`.

## 10. Kontrola pominięć
- Sprawdź, czy żadna istotna reguła nie wypadła z rejestru: przejdź po aktywnych
  źródłach i po zakresie zmiany.
- Pominięcie ujawnione po publikacji wyniku unieważnia wynik (sekcja 11) i wymaga
  uzupełnienia rejestru.
- Rejestr nie deklaruje zgodności całego repozytorium; rozlicza wyłącznie zakres
  zmiany.

## 11. Unieważnienie wyniku
Wynik traci ważność, gdy zmieni się którykolwiek z elementów:
- zakres zmiany,
- treść albo aktywacja reguły,
- dowód, na którym oparto wynik.

Po zmianie ustal ponownie zakres i dowody; nie przenoś wyniku automatycznie na
nową wersję.

## 12. Proporcjonalność
Proporcjonalność pozwala dobierać głębokość dowodu i liczbę wpisów do ryzyka
zmiany. Nie pozwala pominąć reguły `mandatory` ani obniżyć wyniku `VIOLATED` do
zalecenia tylko dlatego, że zmiana jest mała.

## 13. Zakres stosowania
Referencja jest neutralna technologicznie i nie zawiera reguł domenowych ani
procedur konkretnego skilla. Skille ją konsumujące wskazują punkty użycia, pola
rejestru w swoim raporcie oraz mapowanie wyników na własne poziomy i werdykty.
