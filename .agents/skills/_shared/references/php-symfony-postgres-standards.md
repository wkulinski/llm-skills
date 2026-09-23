# PHP + Symfony + PostgreSQL Standards

Ten dokument opisuje **domyślny baseline** dla skilli używanych w projektach PHP + Symfony + PostgreSQL.

## 1. Zakres i pierwszeństwo
- Ten dokument jest źródłem prawdy dla standardowego (niewyjątkowego) podejścia do implementacji.
- Jeżeli `CQRS_MONOLITH_STANDARD_OVERRIDES=1`, to dodatkowo obowiązuje:
  - `./cqrs-monolith-standard-overrides.md`
- W razie konfliktu: aktywny override ma pierwszeństwo nad tym dokumentem.

## 2. PHP i styl kodu
- Każdy plik PHP zaczynaj od `declare(strict_types=1);`.
- Każda metoda/funkcja/stała ma jawne typy i widoczność.
- Preferuj klasy `final` i właściwości `readonly`, gdy nie ma uzasadnienia dla dziedziczenia/mutowalności.
- Nie używaj `mixed`/`object` jako skrótu na obejście problemu projektowego.
- Stałe klasowe (`const`) umieszczaj na początku klasy (przed właściwościami i metodami).
- Unikaj API oznaczonych jako `deprecated`; jeśli alternatywy brak, zaznacz to jawnie.

## 3. Symfony i struktura aplikacji
- Utrzymuj kontrolery/komendy CLI cienkie: walidacja wejścia + delegacja logiki do warstw aplikacyjnych.
- Serwisy utrzymuj możliwie bezstanowe (stateless), z jawnie wstrzykniętymi zależnościami.
- Nie opieraj poprawności działania na stanie zgromadzonym w poprzednich żądaniach ani na rozgrzaniu cache; stan współdzielony między żądaniami opisuj jawnie wraz z jego cyklem życia.
- Nie mutuj superglobali (`$_ENV`, `$_SERVER`, `$_SESSION`, itp.).
- Trzymaj jasny podział odpowiedzialności między warstwą wejścia, aplikacyjną i domenową.

## 4. Doctrine i PostgreSQL
- Typy kolumn deklaruj przez `Types::*` lub stałe customowych typów, nie przez surowe stringi.
- Daty i timestampy trzymaj jako immutable oraz w UTC.
- Unikaj operacji, które ładują duże zbiory danych bez potrzeby; filtruj jak najbliżej bazy i oceniaj koszt całego przepływu, a nie pojedynczego wywołania.
- Nie powtarzaj odczytu tego samego zbioru ani nie indeksuj wielokrotnie tych samych danych w ramach jednego przepływu. Nieuzasadnione N+1 oceniaj względem realistycznego obciążenia, a nie liczby pętli w kodzie.
- Rekordy i relacje identyfikuj stabilnym kluczem, nie etykietą, nazwą ani wartością prezentacyjną, które mogą się powtarzać. Dwa rekordy o tej samej nazwie muszą pozostać rozróżnialne w kodzie, kluczach i mapowaniach.
- Dla cache ustal jawnie zakres, klucz i cykl życia. Brak wpisu w cache nie może maskować brakującej inicjalizacji ani zmieniać obserwowalnego wyniku.
- Model danych i migracje utrzymuj spójne z rzeczywistym kontraktem aplikacji.

## 5. Walidacja, bezpieczeństwo i niezawodność
- Waliduj wejście na granicach systemu (HTTP/CLI/API).
- Uwzględniaj scenariusze błędne, race conditions i granice transakcji.
- Nie dodawaj nowych zależności bez świadomej decyzji użytkownika.
- Zmiany bezpieczeństwa/autoryzacji i migracje danych traktuj jako high-risk i jawnie raportuj.

## 6. Testy i jakość
- Każdy naprawiany błąd powinien mieć test regresyjny (jeśli kontekst projektu na to pozwala).
- Dla większych zmian sugeruj scenariusze unit/functional/integration.
- Jeżeli brak I/O, izolacja od stanu zewnętrznego albo koszt odczytu są częścią kontraktu, pokryj je testem wykrywającym naruszenie (np. brak odczytu w warstwie bez I/O, powtórzenie tego samego odczytu albo odczyt zbiorczy zamiast N+1), a nie testem potwierdzającym samo istnienie wywołania.
- Nie wyłączaj lokalnie lintów/testów/supresji jako „naprawy” problemu jakości.

## 7. Współdziałanie ze skillami
- Procedury operacyjne (QA/commit/commit-message/review) są opisane w skillach, nie tutaj.
- Ten dokument opisuje standardy techniczne i sposób implementacji, a nie sekwencję kroków procesu.
