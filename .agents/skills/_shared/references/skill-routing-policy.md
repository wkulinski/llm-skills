# Skill Routing Policy

Ten dokument jest przenośnym źródłem prawdy dla wyboru nadrzędnego workflow
skilla. Rozstrzyga, który skill przejmuje zadanie jako pierwszy; nie zastępuje
procedur wykonawczych opisanych w poszczególnych skillach.

## Pojęcia

- **Istniejący plan** — gotowy plan wykonawczy utworzony przez `$task-plan` i
  zawierający work packages.
- **Work package (WP)** — jeden uporządkowany pakiet wykonawczy z istniejącego
  planu, niezależnie od tego, czy jego zakres jest mały.
- **Bezpośrednia implementacja** — zmiana opisana bez odwołania do istniejącego
  planu lub work package.
- **Jawne wywołanie skilla** — użytkownik wskazuje skill albo jego workflow wprost,
  np. `$plan-execute`, `$code-implement`, `$task-plan`, `$code-review`, `$review-quick` lub
  `$git-commit`.
- **Handoff wykonawczy** — `$plan-execute` przekazuje jeden wybrany WP do
  `$code-implement`; nie jest to nowe, niezależne wywołanie orkiestratora.

## Zasada pierwszeństwa

Stosuj następującą kolejność:

1. Jawne polecenie użytkownika dotyczące konkretnego skilla ma pierwszeństwo,
   z zachowaniem twardych zasad bezpieczeństwa i stop-conditions.
2. Bez jawnego wskazania skilla rozpoznaj intencję:
    - utworzenie planu, krytyczna rewizja w ramach jego tworzenia albo walidacja planu → `$task-plan`;
    - niezależny, read-only review istniejącego planu → `$code-review` w trybie `plan`;
    - wykonanie, kontynuacja albo wznowienie istniejącego planu lub WP →
     `$plan-execute`;
    - implementacja konkretnej zmiany (w tym feature, bugfix lub refaktor) bez
      istniejącego planu → `$code-implement`;
    - pełny albo głęboki przegląd implementacji → `$code-review` w trybie `code`;
    - szybki przegląd bieżących zmian → `$review-quick`;
    - przygotowanie lub wykonanie commita → `$git-commit`.
3. Jeśli prośba łączy słowa „WP”, „work package”, „plan”, „kontynuuj plan” albo
   „zrealizuj kolejny pakiet” z implementacją, a użytkownik nie wskazał
   bezpośrednio `$code-implement`, pierwszym skillem zawsze jest
   `$plan-execute`.

## Sygnały istniejącego planu

Za sygnał wykonania istniejącego planu uznaj w szczególności:

- wskazanie pliku planu albo kanonicznego planu zapisanej sesji;
- odwołanie do `WP1`, `WP2`, `WP3` itd. lub „pierwszego niezakończonego WP”;
- czasowniki „wykonaj”, „zrealizuj”, „kontynuuj”, „wznów” lub „dokończ” użyte
  wobec planu albo jego WP;
- prośbę o przejście przez plan krok po kroku.

Jeżeli prośba zawiera taki sygnał, ale nie można rozwiązać istniejącego planu,
nie wolno cicho przełączyć się na `$code-implement`. `$plan-execute` powinien
zgłosić problem z planem albo poprosić o brakującą ścieżkę.

Samo określenie zadania jako „feature”, „bugfix” albo „refactor” nie unieważnia
sygnału WP. Są to kryteria dla `$code-implement` dopiero po wybraniu WP przez
`$plan-execute` albo przy bezpośrednim zadaniu bez planu.

## Granica odpowiedzialności

### `$plan-execute` jako orkiestrator

`$plan-execute`:

1. rozwiązuje i waliduje istniejący plan;
2. wybiera dokładnie pierwszy niezakończony WP;
3. przekazuje ten jeden WP do `$code-implement` jako handoff wykonawczy;
4. po evidence zleca `$task-plan` zapis ukończenia WP.

Nie przekazuje całego planu do implementacji i nie zastępuje `$code-implement`.

### `$code-implement` jako wykonawca

`$code-implement`:

- implementuje bezpośrednią zmianę, gdy nie ma istniejącego planu;
- implementuje dokładnie jeden WP, gdy został wywołany handoffem z
  `$plan-execute`;
- nie wybiera kolejnego WP i nie oznacza WP jako ukończonego w planie.

Przy bezpośrednim wejściu musi na intake sprawdzić, czy prompt wskazuje
istniejący plan/WP. Jeśli tak i nie ma jawnego polecenia bezpośredniej
implementacji, zwraca sterowanie do `$plan-execute` zamiast rozpoczynać własny
workflow.

Jawne polecenie „zaimplementuj ten już wybrany WP bezpośrednio przez
`$code-implement`” jest świadomym wyjątkiem routingu. W takim trybie
`$code-implement` nadal nie zapisuje statusu planu; odpowiedzialność za
`complete-wp` pozostaje po stronie `$plan-execute` lub użytkownika.

## Wznowienie i częściowo wykonany WP

Bieżący working tree, raport implementacji i lokalny stan skilla mogą wskazywać,
że WP został rozpoczęty, ale nie są źródłem statusu planu.

Przy wznowieniu:

1. `$plan-execute` nadal odczytuje status z planu i wybiera pierwszy wpis `[ ]`;
2. przed ponowną implementacją sprawdza evidence i bieżące zmiany, aby odróżnić
   brak pracy, pracę częściową i ukończenie wymagające tylko formalnego zapisu;
3. nie uruchamia ponownie całego WP „na wszelki wypadek”;
4. oznacza WP przez `$task-plan` dopiero po aktualnej weryfikacji.

Brak pewności, czy istniejące zmiany spełniają WP, wymaga zawężonego odczytu lub
jasnego pytania — nie cichego pominięcia orkiestratora ani zmiany zakresu.

## Tabela routingu

| Intencja użytkownika | Pierwszy skill | Następny krok |
| --- | --- | --- |
| Przygotuj plan albo wykonaj jego critical review w ramach tworzenia | `$task-plan` | pozostaje planem, bez implementacji |
| Formalnie zweryfikuj istniejący plan | `$task-plan` | walidacja struktury i statusu planu |
| Wykonaj istniejący plan/WP | `$plan-execute` | wybrany WP → `$code-implement` |
| Kontynuuj istniejący plan | `$plan-execute` | pierwszy niezakończony WP |
| Zaimplementuj zmianę bez planu | `$code-implement` | implementacja i lekka weryfikacja |
| Niezależny review istniejącego planu | `$code-review` (`plan`) | findings-first + plan coverage + readiness verdict |
| Pełny albo głęboki przegląd implementacji | `$code-review` (`code`) | findings-first + coverage + merge verdict |
| Przejrzyj bieżące zmiany | `$review-quick` | raport findings-first |
| Zrób commit | `$git-commit` | procedura QA i commit |

## Zasada dla dokumentacji skilli

Ten dokument jest jedynym miejscem dla algorytmu routingu. `$plan-execute`,
`$code-implement` i `$task-plan` mogą zawierać krótkie wskazania triggerów oraz
guardów, ale nie powinny kopiować całej tabeli ani zmieniać tej kolejności
lokalną interpretacją.
