# Checklisty zgodności

Zastosuj wyłącznie sekcję właściwą dla targetu. Dla każdej pozycji ustal status:
`OK`, `FINDING`, `STANDARD_GAP`, `NOT_APPLICABLE`. Pozycja bez evidence nie może
otrzymać statusu `OK` ani `FINDING`. Ten sam problem zgłoś w jednym wierszu.

Checklisty opisują jakość autorską z `skill-authoring-standard.md`. Nie powtarzają
reguł strukturalnych MUST — ich właścicielem jest `skill-structure-contract.md`,
a egzekwują je testy repozytorium.

## Target `skill`

| # | Wymiar | Co sprawdzić | Evidence |
|---|---|---|---|
| S1 | Opis i trigger | `description` mówi, jaki rezultat daje skill i kiedy po niego sięgnąć; brak polityki wewnętrznej, duplikacji routingu i listy „Intencje:” | frontmatter `SKILL.md`; test `tests/skills/_shared/skill-description-contract.test.mjs` |
| S2 | Progressive disclosure | korzeń pełni rolę routera; wiersz routingu nazywa warunek obserwowalny bez otwierania pliku; bloki warunkowe żyją w `references/`, a bramki obowiązujące w każdym przebiegu w korzeniu; w miejscu wydzielonego bloku zostaje zdanie odsyłające; odwołania, `shared_files` i piny testów wskazują nowy plik; przeniesione frazy pinowane testami nadal istnieją | korzeń vs `references/`; `inventory.mjs` (`metrics.root.sections`); testy pinujące |
| S3 | Przenośność modeli | brak nazw modeli, wariantów i reasoningów w tekście normatywnym; role i wskazanie konfiguracji runtime zamiast przypięcia | `inventory.mjs` (`signals`); `rg` po nazwach modeli |
| S4 | Granice decyzyjne i definicja ukończenia | skill mówi, kiedy działa samodzielnie, kiedy pyta i kiedy oddaje sterowanie; warunek zakończenia jest obserwowalny | sekcje trybu/stop-conditions/końca w korzeniu |
| S5 | Spójność i sprzeczności | jedna reguła ma jedno kanoniczne miejsce; brak powielonych bloków; brak sprzeczności korzeń ↔ referencja ↔ test | `inventory.mjs` (`metrics.duplicate_blocks`); `rg` po nagłówkach bloków |
| S6 | Evidence i kontrakty testowe | każdy kontrakt ma pina w testach albo właściciela w `_shared`; deklaracje `shared_files` rozwiązują się i nie mają niejawnych zależności | `inventory.mjs` (`metrics.test_pins`, `metrics.shared_files`); `skills-shared-files.test.mjs` |
| S7 | Język | opis jest polski; treść spójna językowo w obrębie sekcji | `inventory.mjs` (`metrics.description.language`); odczyt korzenia |
| S8 | Ekonomia kontekstu | rozmiar korzenia proporcjonalny do roli routera; nadmiar rozwiązany wydzieleniem zgodnie z S2, a nie limitem długości; bloki używane przez kilka skilli w `_shared`; jedna zmiana reguły wymaga edycji w jednym miejscu | `inventory.mjs` (`metrics.root.lines`, `metrics.root.sections`) |
| S9 | Jakość treści | wymiar 9 standardu: powtórzenia wewnątrz artefaktu, także innymi słowami; błędne ścieżki, komendy i odwołania; szum; niejasność. Powielenie między dokumentami i sprzeczności zostają w S5, pokrycie twierdzeń o zachowaniu w S6 | odczyt korzenia i referencji; `inventory.mjs` (`metrics.duplicate_blocks`); `rg` po ścieżkach i nazwach sekcji |

## Target `rules`

Dotyczy `AGENTS.md` oraz bloków instrukcji dla konsumentów w `README.md`.
Dokumentacja domenowa w `docs/**` należy do `$docs-sync`.

| # | Wymiar | Co sprawdzić | Evidence |
|---|---|---|---|
| R1 | Aktualność | brak zdań nieaktualnych dla bieżącego repo, historii, która przestała obowiązywać, i obietnic bez pokrycia | odczyt punktowy pliku; porównanie z faktycznym stanem repo |
| R2 | Brak duplikatów | kluczowe bloki, w tym mapa dokumentacji, występują dokładnie raz | `rg` po nagłówkach i kluczach bloków |
| R3 | Spójność z `docs_map` | odwołania i ścieżki odpowiadają zadeklarowanej mapie; brak martwych wskazań | blok `docs_map` vs treść dokumentu |
| R4 | Przenośność reguł runtime | reguły obowiązujące konsumentów żyją w `.agents/skills/**`, nie w `AGENTS.md`; `AGENTS.md` trzyma tylko wskazania lokalne | podział treści między `AGENTS.md` a `_shared` |
| R5 | Jasność entrypointu | procedura startu, warunkowy refresh kontekstu i role agentów są jednoznaczne; brak „zawsze uruchom” bez warunku | sekcja lifecycle/startu; odwołanie do właściciela procedury |
| R6 | Właściciel | ocena nie edytuje pliku; synchronizacja i edycja należą do `$rules-sync` | raport końcowy (brak zmian plików) |
| R7 | Jakość treści | wymiar 9 standardu: szum, niejasność, powtórzenia innymi słowami i błędne odwołania. Nieaktualne zdania zostają w R1, duplikaty kluczowych bloków w R2 | odczyt punktowy pliku |

## Target `agents`

Dotyczy `.opencode/agents/*.md`. Runtime, uprawnienia i wartości konfiguracji
pozostają poza oceną.

| # | Wymiar | Co sprawdzić | Evidence |
|---|---|---|---|
| A1 | Frontmatter | brak `model`, `variant` i `thinking`; pola `mode`, `steps` i uprawnienia są kompletne i spójne z rolą | `inventory.mjs` (`metrics.frontmatter.forbidden_fields`) |
| A2 | Opis jako trigger delegacji | opis mówi, jakie zadanie agent przyjmuje, co odrzuca i co zwraca; długość i język są metryką bez twardego progu | `inventory.mjs` (`metrics.frontmatter.description`) |
| A3 | Kontrakt delegacji i format zwrotu | body zawiera wejście, granice autonomii, warunek eskalacji i format zwrotu (`STATUS`) | odczyt body; zgodność z delegującym skillem |
| A4 | Relacje | delegujący skill wskazuje agenta; plik ma wpis w `opencode.jsonc`; testy agentowe pinują kontrakt; brak osieroconego pliku, wpisu i brakującego właściciela | `inventory.mjs` (`metrics.config`, `metrics.delegating_skills`, `metrics.test_pins`) |
| A5 | Spójność z delegującym skillem | pola handoffu i oczekiwany format wyniku nie są sprzeczne między agentem a skillem | porównanie body agenta z sekcją delegacji skilla |
| A6 | Jakość treści | wymiar 9 standardu: szum, niejasność, powtórzenia i błędne odwołania w body agenta. Zgodność kontraktu z delegującym skillem zostaje w A5 | odczyt body agenta |

## Poza zakresem checklist

- kod, zmiany i plany — `$code-review`;
- dokumentacja domenowa i porządki `docs/**` — `$docs-sync`;
- synchronizacja i edycja reguł — `$rules-sync`;
- runtime behavior agentów i efekty ich pracy — `$opencode-workflow-economics`,
  `$runtime-diagnostician`, `$code-review`, `$qa-run`;
- automatyczne poprawki i zmiany standardu — poza `$skill-review`.
