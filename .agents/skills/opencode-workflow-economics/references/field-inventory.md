# Etap 12 — inwentaryzacja pól raportu

Każdy wpis opisuje decyzję dla bieżącego schematu. Pola usuwane są
rekonstruowalne lub nie mają samodzielnej wartości audytowej; pola zachowane
pozostają częścią kontraktu analitycznego.

| Pole | Źródło | Konsumenci | Rekonstruowalne | Wartość audytowa | Decyzja |
|---|---|---|---|---|---|
| `roots[].steps[].activity` | `analysis.mjs`, klasyfikacja kroku | brak; odczyty używają `primary_activity` | tak, z `primary_activity` | brak dodatkowej | usunąć |
| `roots[].spans[].activity` | `analysis.mjs`, budowa spanów | brak; fingerprint i renderery używają `primary_activity` | tak, z `primary_activity` | brak dodatkowej | usunąć |
| `aggregates.by_activity` | `analysis.mjs` | brak; projekcje używają `by_primary_activity` | tak, z `by_primary_activity` | brak dodatkowej | usunąć |
| `candidate_views.high_cost` | `analysis.mjs`, widoki kandydatów | brak; ranking kosztu jest realizowany przez patterny/rooty | tak, z `all_main_agent_spans` | brak | usunąć |
| `roots[].steps[].activity_classification.method` | `analysis.mjs`, klasyfikacja kroku | brak; wersja jest w metodologii raportu | tak, z `methodology.activity_classification_version` | brak per obiekt | usunąć |
| `roots[].spans[].classification_method` | `analysis.mjs`, budowa spanów | brak; wersja jest w metodologii raportu | tak, z manifestu metodologii | brak per obiekt | usunąć |
| `roots[].delegations[].parent_followup.activities` | `delegation-overlap.mjs` | brak; `primary_activities` i `activity_sets` są używane | tak, z `primary_activities` | brak dodatkowej | usunąć |
| `roots[].spans[].read_only` | `analysis.mjs`, budowa spanów | wewnętrznie tylko do budowy widoku low-risk | tak, z `operation_fingerprint.mutation_mode` | brak po fingerprintingu | usunąć |
| `roots[].spans[].operation_fingerprint.diagnostics.profile.read_only` | `fingerprints.mjs` | brak; `profile.mutation_mode` jest źródłem prawdy | tak, z `mutation_mode` | brak dodatkowej | usunąć |
| `aggregates.by_activity_signal` | `analysis.mjs` | brief, jako nieaddytywny kontekst sygnałów | nie bez utraty współwystępujących sygnałów | tak, ostrzega przed sumowaniem | zachować |
| `activity_classification.resolution` | `analysis.mjs` | data quality, overlap, interpretacja | nie bez utraty klasyfikacji | tak | zachować |
| `activity_classification.evidence` / `classification_evidence` | `analysis.mjs` | audyt przypisania aktywności | nie | tak | zachować |
| `provider_id`, `reported_model_id`, `model_variant` | `parser.mjs`, kroki modelowe | agregacja modeli i audyt kosztu | nie | tak | zachować |
| `evidence` w diagnostykach overlapu | `delegation-overlap.mjs` | renderer overlapu i audyt repeated-work | nie | tak | zachować |

Usunięcie powyższych pól zmienia canonical report contract, dlatego raport ma
`schema_version: 5`, a testy sprawdzają zarówno brak pól usuniętych, jak i
obecność pól wymaganych do reprodukcji i audytu.
