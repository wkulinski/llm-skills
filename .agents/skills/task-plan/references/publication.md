# Ocena i publikacja planu

Czytaj przy poleceniu publikacji albo odświeżaniu istniejącej publikacji.

Na jawne polecenie publikowania wybierz pełny URL issue (także dla źródła
GitHub) i kanoniczny plan, a następnie:

```bash
node <skill_dir>/scripts/publish.mjs bind --path ./docs/plans/<plan-id>.md --issue https://github.com/owner/repo/issues/123
node <skill_dir>/scripts/publish.mjs assess --path ./docs/plans/<plan-id>.md --input <assessment.json>
node <skill_dir>/scripts/publish.mjs publish --path ./docs/plans/<plan-id>.md
```

Ocenę początkowego planu zapisuj dla końcowych bajtów po wymaganym review i
`record-review`. Przy odbiorze WP ocenę zapisuje właściciel po `complete-wp`,
nie przed nim. Każda zmiana planu (także wspólnej decyzji, kryteriów lub
technicznego front matter), reguł, selekcji albo ocenianego raportu wymaga
jawnego potwierdzenia lub korekty całej oceny dla aktualnych wejść. Nie odczytuj
ponownie raportów i nie streszczaj ich, gdy ocena pozostaje aktualna.

Oceń jawnie także raporty pominięte jako duplikaty. Utrwal gotowe krótkie teksty
albo jawny pusty wybór; `assess` zapisuje hashe, nie tworzy tekstu przez model.
Przy ponownym otwarciu WP oznacz dawne ustalenia jako `historical` albo
`requires-reassessment`; po ponownym zamknięciu potwierdź lub zastąp je zgodnie
z nowymi kryteriami. Nie kopiuj decyzji dostępnej w ADR ani norm i technicznych
artefaktów. Dodatkowy dokument wymaga uzasadnienia istotności, unikalności i
niewystarczalności krótkiego streszczenia. Schemat i przykład jawnego pustego
wyboru opisuje `<skills_root>/_shared/references/task-plan-contract.md`
(sekcja „Publikacja do czytania”); skrót CLI podaje `publish.mjs --help`.

Błąd oceny/publikacji nie cofa poprawnie odebranego WP ani jego evidence.
Zgłoś go jawnie i zablokuj odświeżenie do osobnej oceny właściciela lub
uzgodnienia konfliktu przez użytkownika. Sam publish ani commit nie wykonuje
ponownej selekcji LLM, review planu, QA, stagingu ani zmiany pointera.
