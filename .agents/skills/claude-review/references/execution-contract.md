# Kontrakt wykonania `$claude-review`

Ten plik jest właścicielem formatu zlecenia, koperty wyniku i decyzji helpera
`review-job.mjs`. Metodyka review pozostaje w `$code-review`.

## Zlecenie (`job.json`, `version: 1`)

| Pole | Znaczenie |
|---|---|
| `job_id` | UUID wygenerowany przez koordynatora; niepoprawny identyfikator jest odrzucany przed wyznaczeniem ścieżki cache. |
| `repo` | Kanoniczna ścieżka badanego repozytorium. |
| `snapshot.head` | Dokładny `HEAD` w chwili przygotowania. |
| `snapshot.combined_sha256` | `getWorktreeFingerprint().combined_sha256`; nie zastępuje `HEAD`. |
| `parameters` | Provider `claude`, jawny model, thinking i `timeout_seconds`. |
| `inputs` | SHA-256 artefaktów: inventory, diffy staged i unstaged, untracked, wymagania, prompt. |
| `context_refs` | Ścieżki i SHA-256 plików kontekstu w repozytorium (plan, reguły, raport kontekstu). |
| `omitted_sensitive` | Pliki pominięte w diffach jako potencjalnie wrażliwe. |
| `session` | Tożsamość sesji Paseo zapisana po `bind-session`. |
| `outcome` | Wynik timeoutu, jeśli wystąpił. |

Jeden `job_id` to jedna próba: ponowne `prepare` daje `JOB_EXISTS`, a drugie
`bind-session` — `SESSION_ALREADY_BOUND`.

## Koperta wyniku wykonawcy

Wykonawca zwraca wyłącznie jeden obiekt JSON:

```json
{"version":1,"job_id":"<uuid>","snapshot":{"head":"<sha>","combined_sha256":"<sha256>"},"status":"COMPLETE","report_markdown":"..."}
```

`status` opisuje ukończenie pracy (`COMPLETE`, `INCOMPLETE`, `BLOCKED`,
`STALE`), nie werdykt review. `report_markdown` zachowuje strukturę sekcji 11
`$code-review`. Koordynator zapisuje kopertę we własnym cache.

## Decyzje `accept`

Helper sprawdza warunki w tej kolejności i zwraca pierwszą pasującą decyzję:

| Warunek | Decyzja | Powód |
|---|---|---|
| brak powiązanej sesji | `REJECTED` | `SESSION_NOT_BOUND` |
| zmieniony artefakt zlecenia albo plik kontekstu | `REJECTED` | `INPUT_CHANGED` |
| inny `Id`, parent, provider, model, thinking albo cwd sesji | `REJECTED` | `SESSION_MISMATCH` |
| oczekujące uprawnienie w sesji | `BLOCKED` | `PERMISSION_PENDING` |
| koperta nie jest pojedynczym poprawnym obiektem | `REJECTED` | `REPORT_INVALID` |
| inny `job_id` w kopercie | `REJECTED` | `JOB_MISMATCH` |
| inny snapshot w kopercie niż w zleceniu | `REJECTED` | `SNAPSHOT_MISMATCH` |
| aktualny `HEAD` albo fingerprint różni się od zlecenia | `STALE` | `SNAPSHOT_CHANGED` |
| wykonawca zgłosił `STALE` | `STALE` | `EXECUTOR_REPORTED_STALE` |
| wszystkie powyższe spełnione | `ACCEPTED` | status z koperty |

`ACCEPTED` pozwala ocenić raport; nie pozwala przejąć werdyktu bez weryfikacji
kandydatów bramką `$code-review`.

## Timeout

`record-timeout --stop-confirmed yes` zapisuje `INCOMPLETE`
(`TIMEOUT_STOPPED`). Wartość `no` zapisuje `BLOCKED`
(`TIMEOUT_STOP_UNCONFIRMED`) i powoduje, że każde kolejne `prepare` kończy się
`UNCONFIRMED_STOP_PENDING`, dopóki operator nie wyjaśni stanu sesji. Żaden
wynik nie dopuszcza automatycznej drugiej próby.

## Cache

`CACHE_PATH` musi być ignorowany przez git. Jeśli zapis zlecenia zmienia
fingerprint working tree, `prepare` kończy się `CACHE_NOT_IGNORED`, bo raport
nigdy nie mógłby zostać przyjęty.
