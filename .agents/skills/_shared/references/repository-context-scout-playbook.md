# Repository-context scout playbook

Ten playbook jest wspólnym kontraktem wykonawczym dla `context-scout-fast` i
`context-scout`. Adapter agenta określa rolę, dozwolone narzędzia i strategię
nawigacji; ten dokument określa niezmienną procedurę rekonesansu i raportowania.

## Twarde granice

- Pracuj wyłącznie read-only. Nie implementuj, nie edytuj kodu, nie uruchamiaj
  QA/review, nie commituj i nie diagnozuj runtime.
- Nie uruchamiaj `./.agents/skills/_shared/scripts/context-scout-hybrid-run.mjs`.
- Nie deleguj agentów, scoutów ani fallbacków i nie uruchamiaj `task`.
- Nie wykonuj `$context-refresh`, nie pobieraj ani nie interpretuj issue lub
  komentarzy GitHub.
- Nie kopiuj pełnych plików, dokumentów, diffów, logów ani sekretów. Raportuj
  tylko minimalne ścieżki, symbole, identyfikatory, zakresy linii i streszczenia.
- Trzymaj twardy budżet: najwyżej 10 istotnych plików, 5 symboli i 3 testy/komendy;
  wykonaj najwyżej jeden przebieg discovery oraz jeden przebieg weryfikacji źródłowej.
- Nie czytaj raportu, błędów ani metadanych innej próby.
- Nie używaj powłoki ani helperów. Jedyny zapis to kompletny plik JSON własnej
  próby przez natywne narzędzie `write` albo `apply_patch`, udostępnione w profilu,
  pod dokładną ścieżką przekazaną przez kontroler.

Naruszenie którejkolwiek granicy kończy próbę statusem `BLOCKED`; nie próbuj
naprawiać orkiestracji ani uruchamiać kolejnej próby.

## Walidacja wejścia

Oczekuj dokładnych ścieżek do oryginalnego prompta, manifestu, handoffu,
criteria oraz pliku scouta tej próby. Handoff zawiera wyłącznie `mode`, `task_brief`,
`decisions` i `constraints`. Repozytorium, branch, HEAD i `already_read` pochodzą
z manifestu, a kryteria wyłącznie z `criteria.json`.

Kontroler waliduje handoff, criteria i manifest oraz sprawdza snapshot przed
delegacją. Scout odczytuje dokładne wejścia narzędziami plikowymi; brak pliku lub
pola oznacza `BLOCKED`, nie zgadywanie ani samodzielne uruchamianie walidatorów.
Wspólny playbook pochodzi z absolutnej ścieżki instalacji A. Root i branch B
podaje kontroler, metadane potwierdza manifest. Instrukcje A nie są kodem B.
Używaj absolutnych ścieżek B w odczytach i jawnego parametru `path` w każdym
wyszukiwaniu; katalog sesji nie wyznacza repozytorium do rozpoznania.
Jeżeli schemat narzędzia udostępnia parametr katalogu projektu, np.
`project_root`, przy każdym wywołaniu przekazuj dokładny absolutny root B
podany przez kontroler. Dotyczy to również `list_projects`, jeśli jego schemat
udostępnia taki parametr. Nie dodawaj parametru nieobecnego w schemacie i nie
wybieraj B na podstawie katalogu sesji, instalacji A ani poprzedniego wywołania.
Potwierdzenie izolacji i gotowości danych pozostaje warunkiem użycia CMM;
jawny parametr projektu nie zastępuje tego potwierdzenia. Zachowaj zakaz
powłoki i mutacji określony w twardych granicach oraz adapterze swojej roli.
Nie czytaj ponownie źródeł z `already_read` bez konkretnego uzasadnienia
powiązanego z kryterium lub ryzykiem.

## Procedura rekonesansu

1. Ustal z handoffu tryb `targeted` albo `cross-layer` i utwórz checklistę
   wszystkich identyfikatorów criteria.
   Dla każdego criterion przepisz też opcjonalne `required_evidence`,
   `required_symbols`, `required_tests` i
   `forbid_negative_claims`: są to twarde bramki budżetu lub walidatora, nie
   sugestie.
2. Nawiguj strategią opisaną w adapterze agenta. Grupuj niezależne odczyty i nie
   skanuj szerzej, niż wymagają criteria.
3. Dla każdego kryterium zbierz minimalne evidence: dokładną repo-relative
   ścieżkę, liczbowe `line_start`/`line_end`, opcjonalny locator oraz relację,
   np. `defines`, `uses`, `implements`, `tests` albo `configures`.
4. Każdą ścieżkę skopiuj bezpośrednio z wyniku narzędzia. Potwierdź istnienie
   pliku i zakres linii w aktualnym snapshotcie; nie zgaduj prefiksów i nie używaj
   skrótów `...` ani ścieżek absolutnych.
5. Zakres claimu nie może być szerszy niż evidence. Zbiory potwierdzaj
   wyczerpująco albo oznaczaj twierdzenie jako częściowe.
6. Po uzyskaniu minimalnego coverage dla wszystkich criteria zakończ discovery.
   Nie zużywaj pozostałych kroków na ulepszanie już wystarczającego raportu.

7. Zapisz `read_coverage.covered` dla dokładnych ścieżek faktycznie odczytanych
   oraz `read_coverage.follow_up` wyłącznie dla punktowych odczytów, których
   rodzic może potrzebować z konkretnym powodem. Nie powtarzaj odczytów z
   `covered` bez uzasadnienia wynikającego z read-before-write, zmiany snapshotu,
   luki w raporcie albo jawnego wymagania użytkownika.
   Jeśli zapisujesz cel odczytu, użyj jednej z etykiet `discovery`,
   `read-before-write`, `verification`, `snapshot-refresh` albo `report-gap`;
   uzupełnij wtedy cały zestaw `event: "read"`, `purpose`, `source: "scout"`
   i `read_mode`. Jest to deklarowany kontekst, nie dowód aktualności pliku.

8. Nie wnioskuj o zawartości pliku z jego nazwy. Claim musi być bezpośrednio
   potwierdzony minimalnym zakresem linii; nie cytuj całego pliku, jeśli kilka
   linii wystarcza do rozstrzygnięcia criterion.

9. Każdy finding oznacz jako `observed`, `structural` albo `inferred` i nadaj mu
   confidence `high`, `medium` albo `low`. Hipotezy i interpretacje oznaczaj jako
   `inferred`; nie przedstawiaj ich jako faktów.

10. Dodaj do każdego findingu literalne `anchors`, które występują w cytowanym
    evidence. Jeśli twierdzenie dotyczy kilku niezależnych plików, rozbij je na
    osobne findings zamiast łączyć kotwice z różnych źródeł.

Przy wznowieniu przez `task_id` odczytaj wyłącznie zakres wskazany przez agenta
głównego i nie powtarzaj ukończonego rekonesansu.

## Budowanie raportu

Stosuj `context-scout-report-protocol.md` z tego samego katalogu instalacji co
playbook. Zarezerwuj co najmniej 40% kroków na preflight evidence, coverage i
zapis. Zbuduj kompletny JSON w pamięci i zapisz go przez `write` albo `apply_patch`
(narzędziem dostępnym w profilu) dokładnie do
pliku `.scout.json` własnej próby wskazanego w promptcie. Nie inicjalizuj ledgeru,
nie wykonuj buildera ani walidatorów i nie zapisuj końcowego `.report.json`.
Kontroler wykonuje builder i walidację w projekcie B.

`status` musi być dokładnie jednym z `COMPLETE`, `INCOMPLETE` albo `BLOCKED`.
`COMPLETE` wymaga bezpośredniego evidence
oraz poprawnego coverage każdego criterion. `INCOMPLETE` zapisuje tylko
zweryfikowane findings i oznacza niepokryte criteria statusem `blocked` z powodem.
`BLOCKED` nie zawiera findings i oznacza każde criterion jako `blocked` albo
`not_applicable` z konkretnym powodem. Brak pełnego coverage albo wyczerpanie
budżetu nie zwalnia z zapisu minimalnego raportu; nie kończ próby bez artefaktu.

Jeżeli odczyt lub zapis zostanie odrzucony przez klienta, zgłoś dosłowną odmowę.
Nie próbuj zastępować pliku treścią odpowiedzi ani zapisywać go w innym projekcie.
Nie obchodź walidatora. Raport `COMPLETE` wymaga coverage
każdego criterion jako `covered` albo uzasadnione `not_applicable`. Status
`blocked` nie może wystąpić w raporcie `COMPLETE`, a `BLOCKED` nie może zawierać findings.

## Odpowiedź

Po zapisaniu pliku zwróć wyłącznie krótkie potwierdzenie z `status`,
`scout_path`, `findings_count` i `covered_criteria`. JSON raportu nie przechodzi
przez kontekst agenta głównego. Potwierdzenie jest metadanymi, nie zamiennikiem
pliku. Obowiązuje koperta z `context-subagent-contract.md` z tego samego katalogu
instalacji, w tym maksymalnie 12 findings i około 1500 tokenów.
