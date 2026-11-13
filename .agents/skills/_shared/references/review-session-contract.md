# Kontrakt review w osobnej sesji agenta

Ten plik jest właścicielem formatu zlecenia, koperty wyniku i decyzji helpera
`<skills_root>/_shared/scripts/review-session-job.mjs`. Metodyka review należy
do skilla wykonującego review (np. `$code-review`), a procedura ownera do skilla
zlecającego (np. `$task-plan`).

## Zasada

Jedno zlecenie (`job.json`) to jedna runda review z najwyżej trzema próbami:
profile `1`, `2`, `3` w kolejności preferencji. Helper nie uruchamia agentów i nie czeka na wynik. Koordynator wywołuje
`<skills_root>/_shared/scripts/review-session-run.mjs --job <job.json>`, który
uruchamia bezpośrednie CLI i przekazuje helperowi tożsamość uruchomienia.
Paseo nie jest wymagane ani używane. Każda
operacja zwraca pole `next`:

| `next.action` | Działanie koordynatora |
| --- | --- |
| `launch` | Uruchom jedną próbę przez `review-session-run.mjs --job`; parametry pochodzą z joba. |
| `wait` | Wewnętrzny stan po `bind-session`; runner czeka na zakończenie procesu. |
| `accept` | Wynik runnera: przekaż `envelope_path` i `inspect_path` do walidatora konsumenta. |
| `evaluate` | Raport przyjęty; oceń go według procedury skilla zlecającego. |
| `self` | Zewnętrzne review nie dało wyniku; wykonaj review samodzielnie, jak bez tego mechanizmu. |

Brak konfiguracji, brak CLI harnessu, błąd providera, wyczerpanie limitu, timeout,
niezgodna sesja i niepoprawny raport nigdy nie blokują workflow: kończą się
kolejnym skonfigurowanym profilem, a po wyczerpaniu profili `self`.

## Pamięć profili w cyklu

Pierwsza runda nowego cyklu wywołuje `prepare` bez `--previous-job` i otrzymuje
nowy `cycle_id`. Każda kolejna runda tego cyklu, pełna albo delta, przekazuje
`--previous-job <ostatnie_zakończone_job.json>`. Nowy job dziedziczy wyłączenia
profili, bez globalnego rejestru, timerów ani zależności między planami.
Helper sprawdza ten sam korzeń repo, prefix, kind i pierwszy powiązany plik
(w task-plan jest nim kanoniczny plan). Poprzedni job musi być zakończony.

Błąd uruchomienia/providera, timeout, niezgodna sesja, oczekujące uprawnienie,
niepoprawny albo nieukończony raport wyłącza profil do końca cyklu. Job zapisuje
`disabled_profiles`: numer profilu, hash jego HARNESS/MODEL/THINKING/MODE i powód.
Zmiana tych ustawień ponownie dopuszcza profil, według zwykłej kolejności.
Poprawny raport wymagający naprawy jest sukcesem i nie wyłącza reviewera.
`INPUT_CHANGED` oraz `EXECUTOR_REPORTED_STALE` nie wyłączają bieżącego profilu.

Przykład: profil 1 zawiódł, 2 dostarczył raport → następne review próbuje 2,
potem 3. `prepare.skipped_profiles` zawiera krótką listę pominiętych profili i
powodów do komunikatu postępu; nie powtarzaj pełnego ostrzeżenia. Niezmienione
ostrzeżenia konfiguracji z poprzedniego joba nie są ponownie emitowane.
Gdy żaden profil nie pozostał, `self` z powodem `CYCLE_PROFILES_EXHAUSTED`
kończy tylko mechanizm zewnętrzny. Jeśli `job_path` jest `null`, owner zachowuje
ostatni zakończony job jako bazę kolejnej rundy po self-review.

Po końcowym `ready`/`blocked` następny nowy cykl zaczyna bez `--previous-job`.
Pełne review w trwającym cyklu nie jest nowym cyklem i nie resetuje pamięci.
Brak lub niezgodność wymaganego poprzednika to błąd stanu: zgłoś go przy okazji
i użyj self-review dla tej rundy; nie pomijaj flagi, aby potajemnie ponowić
wcześniej wyłączone profile.

## Konfiguracja

Wartości pochodzą z env projektu B (pliki ładowane przez
`<skills_root>/_shared/scripts/env-load.sh`). `<PREFIX>` wybiera skill
zlecający, np. `PLAN_REVIEW`.

| Klucz | Znaczenie |
| --- | --- |
| `<PREFIX>_<N>_HARNESS`, `_<N>_MODEL`, `_<N>_THINKING` | Profil review, gdzie `N` to `1`, `2` albo `3`. Niższy numer oznacza wyższą preferencję; puste profile są pomijane. Bez żadnego profilu `prepare` zwraca `self` (`NOT_CONFIGURED`). |
| `<PREFIX>_<N>_MODE` | Wymagany tryb uprawnień harnessu (mapowanie na CLI opisane poniżej), dobrany do sesji bez nadzoru. |
| `<PREFIX>_TIMEOUT_SECONDS` | Limit oczekiwania na jedną próbę; domyślnie 1200. |

Profil z wszystkimi czterema polami pustymi jest nieobecny: pomiń go bez
ostrzeżenia. Profil częściowy, także z samym `MODE`, jest pomijany z ostrzeżeniem
`PROFILE_CONFIG_INVALID`; pozostałe kompletne profile nadal są próbowane w
kolejności. `prepare.warnings` zawiera numer profilu, brakujące klucze i krótki
komunikat, bez wartości env. Ostrzeżenia są zachowane w `job.config_warnings`.
Jeśli nie ma poprawnego profilu, wynik to `self` (`NO_VALID_PROFILES`), a brak
jakichkolwiek profili nadal daje `NOT_CONFIGURED`.

Koordynator pokazuje ostrzeżenia użytkownikowi przy okazji najbliższego komunikatu
postępu lub wyniku, bez pytania i bez zatrzymywania workflow. Także odrzucenie
parametrów przez CLI (np. nieznany model albo tryb) zgłoś krótko przy okazji,
zapisz porażkę próby i przejdź według `next`. Helper sprawdza kompletność profilu;
Runner sprawdza obsługiwany harness i mode; CLI sprawdza model i thinking przy
uruchomieniu. Nie uruchamiaj profilu bez jawnego `MODE`.

Niepoprawny wspólny timeout nadal daje `self` (`CONFIG_INVALID`) z listą
problemów, ponieważ dotyczy wszystkich prób.

`HARNESS` wybiera bezpośrednie CLI: `claude`, `codex` albo `opencode`.
Entrypoint jest ustalany przez `resolve_tool_cmd` z env projektu B (w tym
`BIN_PATH`). `MODEL` i `THINKING` to natywne identyfikatory harnessu; dostępność
modelu i wariantu zależy od konfiguracji providera. Runner nie wybiera zamiennika.

| Harness | Model / thinking | MODE |
| --- | --- | --- |
| `claude` | `--model` / `--effort` | `auto`, `acceptEdits`, `bypassPermissions`, `dontAsk`, `plan` → `--permission-mode` |
| `codex` | `--model` / `model_reasoning_effort` | `read-only` → sandbox `read-only`; `auto-review` → `workspace-write`; `full-access` → `danger-full-access`; zawsze `approval_policy=never` dla pracy bez pytań |
| `opencode` | `--model` / `--variant` | `build` albo `plan` → `--agent`; uprawnienia wynikają z konfiguracji OpenCode |

`MODE` nie ma wspólnej semantyki między harnessami. Przy migracji z Paseo
sprawdź powyższe mapowanie: Codex `auto-review` nie korzysta z automatycznego
recenzenta uprawnień Paseo, a polecenia wymagające zgody są odrzucane.
Nieobsługiwany tryb kończy próbę; runner nie rozszerza uprawnień automatycznie.
Runner obsługuje tylko wbudowane tryby OpenCode `build` i `plan`; inne nazwy
odrzuca, aby nie dopuścić cichego wyboru agenta domyślnego przez CLI.
OpenCode nie dostaje `--auto`. Żaden harness nie dostaje flagi kontynuacji sesji.

Runner wykonuje jedną próbę na POSIX (Windows: WSL), zapisuje prywatne logi
w katalogu joba i zatrzymuje grupę procesów po timeout lub przerwaniu
SIGINT/SIGTERM/SIGHUP. Env projektu B służy wyłącznie do ustalenia entrypointu
CLI (`resolve_tool_cmd`, `BIN_PATH`); CLI działa ze środowiskiem koordynatora,
więc zmienne z plików env aplikacji (np. klucze API) do niego nie trafiają.
PID i czas startu grupy procesów runner zapisuje w katalogu joba zaraz po
uruchomieniu (`running-<id>.json`).
Przerwanie runnera nie jest awarią providera: próba kończy się wynikiem
`INTERRUPTED`, profil nie trafia do `disabled_profiles`, a `next` to `self`.
Gdy runner zginął bez obsługi (SIGKILL, zamknięty terminal), ponowne
`review-session-run.mjs --job` zatrzymuje pozostawioną grupę (po zgodności czasu
startu, by nie ruszyć obcego procesu o tym samym PID) i zwraca to samo `self`;
niepotwierdzone zatrzymanie oznacza `RUNNER_INTERRUPTED_STOP_UNCONFIRMED`.
Kod wyjścia różny od zera oznacza porażkę nawet przy obecności raportu.
Codex oddaje ostatnią wiadomość przez `--output-last-message`, Claude przez
wynik JSON `--print`, a OpenCode przez zdarzenia JSON zakończone `step_finish`
z powodem `stop`. Odrzucone uprawnienia Claude albo zdarzenie błędu OpenCode
kończą próbę jako błąd providera. Wynik runnera `next.action: accept` zawiera
`envelope_path` i `inspect_path` do walidacji przez konsumenta; nie jest `ACCEPTED`.

Stare klucze env `MAIN_*` i `FALLBACK_*` zastąp odpowiednio `1_*` i `2_*`.
Helper nie odczytuje starych nazw. Istniejące zlecenia i wpisy review planów
z nazwami prób `main` i `fallback` pozostają czytelne.

Kompletny, przyjęty raport kończy próby także wtedy, gdy żąda zmian w planie.
Nie uruchamiaj kolejnego profilu w poszukiwaniu korzystniejszego werdyktu.

## Zlecenie (`job.json`, `version: 1`)

`prepare` zapisuje zlecenie w `<CACHE_PATH>/review-session/<job_id>/`:

| Pole | Znaczenie |
| --- | --- |
| `job_id` | UUID wygenerowany przez koordynatora; jeden `job_id` to jedna runda. |
| `cycle_id`, `previous_job` | Identyfikator cyklu i ścieżka poprzedniego zakończonego joba; nowy cykl ma `previous_job: null`. |
| `prefix`, `disabled_profiles`, `config_warnings` | Przestrzeń konfiguracji, wyłączenia profili dziedziczone w cyklu i pełna lista ostrzeżeń konfiguracji tej rundy. |
| `kind` | Etykieta zlecenia, np. `plan-review`; trafia do tytułu sesji. |
| `context_refs` | Ścieżki i SHA-256 powiązanych wejść (pliki w repozytorium albo w cache). |
| `binding_sha256` | Hash listy `context_refs`; reviewer odsyła go w kopercie. |
| `prompt_sha256` | Hash `prompt.md`, wyrenderowanego z pliku zadania (`--task`). |
| `attempts` | Próby skonfigurowanych profili `1`, `2`, `3`: parametry, powiązana sesja, wynik. |
| `result` | Wynik rundy: `ACCEPTED` z tożsamością reviewera albo `SELF` z powodem. |

Plik zadania może używać `<skills_root>`; helper zastępuje go absolutną ścieżką
instalacji skilli, bo sesja reviewera nie zna kontekstu koordynatora. Prompt
nadaje sesji rolę delegowanego reviewera: bez `$context-refresh`, bez
repository-context, bez procedury startowej `AGENTS.md`, bez pytań do
użytkownika, bez delegowania i bez zmian plików repozytorium.

## Koperta wyniku

Reviewer zwraca w ostatniej wiadomości wyłącznie jeden obiekt JSON:

```json
{"version":1,"job_id":"<uuid>","binding_sha256":"<sha256>","status":"COMPLETE","report_markdown":"...","payload":{}}
```

`status` opisuje ukończenie pracy (`COMPLETE`, `INCOMPLETE`, `BLOCKED`,
`STALE`), nie werdykt. `payload` jest obiektem wymaganym przy `COMPLETE`; jego
schemat określa plik zadania skilla zlecającego.

## Decyzje

`bind-session` porównuje tożsamość lokalnego uruchomienia z bieżącą próbą:
`id`, `provider`, `cwd`, oraz `model` i `thinking`, gdy są raportowane.
Runner tworzy nowy UUID dla każdej próby i zapisuje go razem z PID i wynikiem
procesu. Tożsamość ma pola `id`, `provider`, `model`, `thinking`, `cwd`,
`pending_permissions`; nie wymaga formatu ani relacji rodzica Paseo.
Dowodzi parametrów wywołania, nie faktycznego wyboru modelu przez provider.
Starsze tożsamości `Id`/`Provider`/`Cwd` pozostają czytelne dla istniejących jobów.
Niezgodność kończy próbę wynikiem `SESSION_MISMATCH`.

`accept` sprawdza warunki w tej kolejności:

| Warunek | Wynik próby | `next` |
| --- | --- | --- |
| zmienione powiązane wejście albo prompt | `STALE` (`INPUT_CHANGED`) | `self` dla bieżącego stanu |
| inna sesja niż powiązana | `REJECTED` (`SESSION_MISMATCH`) | kolejna próba albo `self` |
| oczekujące uprawnienie w sesji | `BLOCKED` (`PERMISSION_PENDING`) | kolejna próba albo `self` |
| koperta nie jest pojedynczym poprawnym obiektem (przyjmowana jest ostatnia linia będąca samodzielnie obiektem JSON, bo harnessy dodają separatory wokół wiadomości; tekst w tej samej linii jest odrzucany) | `REJECTED` (`REPORT_INVALID`) | kolejna próba albo `self` |
| inny `job_id` albo `binding_sha256` | `REJECTED` (`JOB_MISMATCH`, `BINDING_MISMATCH`) | kolejna próba albo `self` |
| reviewer zgłosił `STALE` | `STALE` (`EXECUTOR_REPORTED_STALE`) | `self` |
| reviewer zgłosił `INCOMPLETE` albo `BLOCKED` | `REJECTED` (`EXECUTOR_<status>`) | kolejna próba albo `self` |
| wszystkie powyższe spełnione | `ACCEPTED` | `evaluate` |

`record-failure --reason` zapisuje porażkę bez koperty: `LAUNCH_FAILED` (brak
CLI, odrzucone uruchomienie), `PROVIDER_ERROR` (sesja zakończona błędem, np.
wyczerpanym limitem), `TIMEOUT_STOPPED` i `TIMEOUT_STOP_UNCONFIRMED`. Przy
niepotwierdzonym zatrzymaniu zgłoś użytkownikowi identyfikator sesji; runda i tak
przechodzi dalej.

`ACCEPTED` oznacza tylko, że raport należy do tej rundy, sesji i wejść.
Wynik (`result.json` w katalogu zlecenia) zawiera `reviewer` (`attempt`,
`provider`, `model`, `thinking`, `session_id`), `context_refs`, `report_markdown`
i `payload`. Ocena raportu należy do skilla zlecającego.

Konsument może przekazać do API `acceptResult` funkcję `validateReport`.
Jest wykonywana przed finalizacją `ACCEPTED`; `ok: false` daje
`REPORT_PAYLOAD_INVALID` i kolejny profil albo `self`. Task-plan używa
`review-cycle.mjs accept-session`, który sprawdza kompletny protokół `decide`.
Ważny werdykt blokujący (`ok: true`, `action: blocked`) kończy próby normalnie.

## Granice

Sesja działa w skonfigurowanym trybie uprawnień harnessu (`MODE`), bez
dodatkowych ograniczeń narzędzi nakładanych przez mechanizm review.
Granicę „tylko odczyt plików repozytorium” wyznacza prompt; zmiana powiązanego
wejścia jest wykrywana przy `accept`, ale nie jest cofana. Konsekwencje opisuje
`SECURITY.md`.

## Widok niezależnego plan-review

Dla `kind: plan-review` z żądaniem `review_scope: full` helper zachowuje
`context_refs` jako prywatne wejścia ownera i generuje `reviewer_context_refs`.
Prompt wskazuje wyłącznie te drugie. Oba zestawy są sprawdzane pod kątem zmiany
bajtów przed przyjęciem wyniku. Wynik zawiera `independent_full_review: true`;
metodyka i rozliczenie wcześniejszych findings należą do task-plan.
Pełny reviewer nie odczytuje joba ani kanonicznego planu. Nie jest to izolacja
systemu plików: dostęp pozostaje ograniczony instrukcjami sesji.
