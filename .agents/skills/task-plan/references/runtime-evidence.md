# Dowody z działającej aplikacji

Czytaj, gdy criterion, evidence gate albo wiersz critical review wymaga dowodu,
którego nie da się uzyskać z kodu: wyglądu, stanu albo zachowania wyrenderowanej
aplikacji. Technikę uruchomienia, dostępu i rodzaje dowodów (snapshot,
screenshot, eval) opisuje `<skills_root>/_shared/references/playwright-cli-verification.md`;
ten plik określa tylko, kiedy i jak task-plan z nich korzysta.

## Kiedy

Użyj Playwright CLI w fazie planowania, gdy:

- zgłoszenie opisuje błąd widoczny w aplikacji i trzeba przejść drogę od
  czynności zgłaszającego do komunikatu, stanu albo wyglądu
  (`<skill_dir>/references/defect-planning.md`);
- plan ma uznać, że błędu nie da się odtworzyć albo że istniejący mechanizm już
  spełnia wymaganie; własny dowód porównaj wtedy z dowodem zgłoszenia;
- punkt źródła dotyczy interakcji użytkownika i inwentarz interakcji wymaga
  obecnego zachowania (`<skills_root>/_shared/references/user-facing-behavior-assessment.md`);
- właściciela widoku (komponent, kontroler, trasa) taniej ustalić ze snapshotu
  niż z przeszukiwania kodu.

Nie uruchamiaj przeglądarki domyślnie ani dla twierdzeń, które rozstrzyga kod.

Podczas fazy `$code-review` obowiązuje jego granica read-only: bez jawnej zgody
użytkownika reviewer nie zmienia trwałych danych aplikacji. Poniższe pozwolenie
dotyczy zbierania dowodów przez właściciela planu poza tą fazą.

## Zasady

- Agent pracuje na środowisku dev z danymi testowymi. Wolno wykonywać akcje
  zmieniające dane aplikacji (formularze, usuwanie, wysyłka) bez pytania o
  zgodę. Zmiany danych w aplikacji nie są zmianami plików repozytorium.
- Nie nawiguj poza URL-e środowiska dev ustalone według referencji Playwright.
- Rolę użytkownika dobierz do zgłoszenia. Inna rola, dane albo wersja aplikacji
  to ograniczenie dowodu; zapisz je przy wyniku.
- Brak odtworzenia nie dowodzi braku błędu. Rozstrzyga porównanie z dowodem
  zgłoszenia i prześledzenie warunków w kodzie.
- Screenshoty i inne artefakty zostają w `<CACHE_PATH>/task-plan/`, nie w
  repozytorium ani w planie.

## Zapis w planie

Wynik zapisz w `Claims verified in evidence` albo `Claims corrected or still
unverified`. Wpis podaje URL lub trasę, rolę, HEAD, datę, wykonane kroki i
obserwowany wynik oraz ścieżkę artefaktu w cache. Nie kopiuj do planu treści
ekranu poza fragmentem potrzebnym do rozstrzygnięcia twierdzenia.

Gdy dowodu nie da się uzyskać (brak URL-a, `Access: BLOCKED`, niedziałająca
aplikacja), evidence gate pozostaje nierozstrzygnięty, a plan `blocked` według
sekcji 1 `SKILL.md`.
