# Kontrakty danych gh-review-learn V1

Właścicielem formatu i walidacji jest `../scripts/contracts.mjs`. Wszystkie
artefakty są JSON UTF-8, mają `schemaVersion: 1`, `kind`, `repository`.
`repository` zawiera stabilne GraphQL `id`, bieżące `name` (`owner/name`) i
`branch`. Zmiana dowolnego pola oznacza `REPOSITORY_CONFLICT`, bez zapisu.
Nieobsługiwany schemat daje `UNSUPPORTED_SCHEMA`. `rules` zawiera dodatnie
wersje `normalization: 1` i `analysis: 4`. Starsze wersje reguł w
locku są czytelne, lecz wymagają ponownej analizy przez `pendingReasons`.
Nie wolno traktować nieznanych wersji reguł jako aktualnych reguł wykonania.

## Cztery operacje CLI

Entrypointy powstają w WP2–WP4; ten pakiet definiuje kontrakt ich argumentów.
Każdy przyjmuje `--help`, nie wymaga przy pomocy Git ani sieci. Ścieżki wejściowe
są rozwiązywane względem repo konsumenta B; skrypty należą do instalacji A.

| Operacja | Argumenty |
| --- | --- |
| `collect.mjs` | `--repo owner/name` (opcjonalnie: repo B), `--branch name` (opcjonalnie: domyślna gałąź GitHuba), `--prs 1,2` (opcjonalna partia), `--resume path` (opcjonalny manifest), `--output path` |
| `prepare.mjs` | `--sources path`, `--lock path` (domyślnie `review-learning.lock.json` B, brak oznacza inicjalizację), `--prs 1,2` (opcjonalnie), `--output path` |
| `validate-result.mjs` | `--sources path`, `--prepared path`, `--result path`, `--lock path` (opcjonalny domyślny lock B) |
| `record-result.mjs` | te same wejścia co walidator oraz `--dry-run` (opcjonalnie); odświeżenie źródeł obowiązuje także przy dry run |

Stdout: dokładnie jeden JSON `{status, data, errors}`; `status` ma wartości
`complete`, `partial`, `error`, `errors` to tablica `{code, message, scope}`.
`data` zawiera wynik lub ścieżkę do artefaktu i liczniki, przy błędzie może być
`null`. Exit: 0 kompletny, 2 częściowy (w tym luki odczytu), 1 błąd.
Pomoc jest tekstem i kończy się 0. Diagnostyka i postęp trafiają tylko na stderr.
Częściowy odczyt nie upoważnia do wykrywania usunięć ani zapisu kompletnej analizy.

## Zbiór źródeł (`kind: sources`)

Pola: `rules`, `read`, `prs`, `sources`.
`read`: `startedAt`, `finishedAt` (ISO-8601), `targetSha`, `completeness`
(`complete|partial`), `gaps` (lista brakujących połączeń/stron i powodów).
Kompletny odczyt ma pustą listę luk. Manifest jest przedziałem odczytu wielu
żądań API, nie atomowym snapshotem. Pełna paginacja obejmuje listę PR-ów oraz
każde zagnieżdżone połączenie. Usunięcie wynika wyłącznie z kompletnego odczytu.
`prs`: obiekty `{id, number, mergedAt, baseSha, headSha, mergeSha}`; brak
obiektu merge zapisuje się jako null, bez odgadywania historycznej wersji.

Każdy element `sources` ma wszystkie pola `SOURCE_FIELDS`; nieadekwatne pola
mają null. `body` zawsze jest tekstem, także pustym. Tożsamości są globalnymi
ID GraphQL, nie numerami stron ani lokalnym indeksem.

| Pole znormalizowane | Źródło GitHub GraphQL / odpowiednik REST |
| --- | --- |
| `id`, `kind`, `prId`, `url` | node ID, typ `review|review_comment|issue_comment|thread`, ID nadrzędnego PR, URL; wątek bez URL używa URL PR |
| `body`, `author` | body; autor `{id, login}` lub null po usunięciu konta |
| `createdAt`, `updatedAt` | metadane czasu; null gdy typ nie udostępnia edycji; wątek używa czasu PR jako pochodzenia |
| `replyToId`, `reviewId`, `threadId` | replyTo.id / in_reply_to_id, pullRequestReview.id, ID połączenia reviewThreads |
| `reviewState` | review.state, również DISMISSED; kopia stanu nadrzędnego dla komentarza |
| `threadResolved`, `threadOutdated` | reviewThread.isResolved, isOutdated; kopia dla komentarza |
| `path`, `line`, `side`, `startLine`, `startSide` | path, line, diffSide, startLine, startDiffSide |
| `originalLine`, `originalStartLine`, `diffHunk` | originalLine, originalStartLine, diffHunk |
| `commitSha`, `originalCommitSha` | commit.oid, originalCommit.oid |

Wycofane review zachowuje ID, tekst i stan. Samo review bez inline nadal jest
źródłem. Wątek jest źródłem z pustym body; agent jawnie rozstrzyga też ten
materiał strukturalny. Referencje odpowiedzi, review i wątków muszą istnieć w
zbiorze i należeć do tego samego PR. Nieosiągalne połączenia dają częściowy
manifest; walidator nie naprawia brakujących referencji.

## Kanonizacja

`canonicalSources` sprawdza unikalność ID, wybiera wyłącznie `SOURCE_FIELDS`,
rzutuje autora do `{id, login}` i sortuje po ID porównaniem kodowym JS, bez locale.
`canonicalJson` sortuje klucze obiektów; kolejność tablic zachowuje. Dlatego
kolekcje źródeł zawsze przechodzą najpierw przez `canonicalSources`.
Hash to SHA-256 bajtów UTF-8 bez końcowego newline. Czas pobrania, ETag i pola
transportowe poza projekcją nie wpływają na hash. Treść, edycja, autor,
lokalizacja, SHA, powiązania i stany wpływają. Usunięcie elementu zmienia hash.
Fingerprint PR to `sourceFingerprint` jego pełnego zbioru źródeł.

## Przygotowany materiał (`kind: prepared`)

Pola: `rules`, `projectSha`, `expectedLockHash` (SHA-256 odczytanych bajtów locka
lub null przy braku), `context`, `items`, `totalPending` (także poza partią).
`context`: `{fingerprint, files, environmentScope}`. Plik to `{path, mode, hash}`;
tryby to `100644|100755|120000|160000`. Hash obejmuje bajty pliku, tekst celu
symlinka albo SHA submodułu. Manifest sortuje się po path przed fingerprintem.
Fingerprint kontekstu zależy od zbioru ścieżek, trybów i hashy, nie SHA commita.
Wyłącza lock, `.git` i rozwiązany cache. Runtime nieodczytany jest jawną luką
`environmentScope`; nie czyta się lokalnych sekretów.
`items`: `{prId, sourceFingerprint, sourceIds, reasons, materials}`.
Materiał ma `id`, `status: available|missing`, `provenance` i dalsze dane
przygotowane w WP3 (wersja, ścieżka cache, zakres dowodu lub przyczyna braku).
Zestaw `sourceIds` musi być dokładnie zbiorem źródeł PR. Brak materiału
historycznego jest danymi do oceny, nie pozwoleniem na wymyślenie poprawki.

## Wynik agenta (`kind: result`)

Pola: `rules`, `expectedLockHash`, `inputContextFingerprint`, `entries`.
Wynik pokrywa dokładnie wszystkie PR przygotowanej partii i ich źródła.
Wpis zawiera własne `rules`, `prId`, `sourceFingerprint`, `projectSha`, `contextFingerprint`,
`sourceCompleteness`, `analysis`, `delivery`, `assessments`, `dispositions`,
`documents`. Snapshot i token muszą odpowiadać przygotowanemu materiałowi.

`dispositions`: `{sourceId, status: assessed|no_learning|unresolved,
rationale, assessmentIds}`. Każde źródło wymaga jednego rozstrzygnięcia;
`assessed` musi wskazywać co najmniej jedną ocenę związaną z tym źródłem.
`assessments`: lokalne `id`, `sources` (`{id, quote}` lub `{id, start, end}`;
zakres jednostek UTF-16, koniec wyłączny), `historical`, `currency`,
`verificationScope`, `rationale`, `evidence` (referencje dowodów).
Kilka ocen może wskazywać jeden tekst, a jedna ocena kilka źródeł.
Walidator sprawdza referencje, strukturę i rzeczywiste bajty dowodów. Trafność
wyboru pliku, interpretację dowodu, argumentację i aktualność ocenia agent.
Poprawny hash nie dowodzi poprawnego wniosku.

- `historical`: `fixed|rejected|accepted|suggestion|unresolved`.
- `currency`: `current_application|existing_coverage|existing_safeguard|historical|superseded|no_evidence`.
- `analysis`: `pending|complete|needs_decision`; complete wymaga pełnych źródeł,
  bez unresolved i no_evidence. Brak dowodu pozostaje pracą do rozstrzygnięcia.
- `delivery`: `not_required|delivery_pending|applied|declined`, niezależne od
  ukończenia analizy. Declined wymaga `userDecisionRef`; applied wymaga
  `finalDocumentsReviewed: true` i odczytu rzeczywistych bajtów przez WP4.

`documents`: `{path, beforeHash, afterHash}`. `beforeHash: null` oznacza nowy
plik. Ścieżka jest względna B, bez traversal. Pending i applied wymagają
niepustego manifestu dokumentów. Kontrolę realpath/symlinków, końcowych bajtów,
zmian poza manifestem i odświeżonych źródeł przeprowadza WP4 przed zapisem.
Dokładny diff pozostaje w cache; manifest nie jest drugą bazą treści instrukcji.

## Dowody historii (od analysis 2)

Każda ocena ma `verification` z następującymi częściami:

| Część | Pola i znaczenie |
| --- | --- |
| `original` | `status: verified|unavailable`, `sourceId`, `sha`, `evidence`, `rationale`; verified wymaga `git_file` z tego SHA |
| `response` | `sourceIds`, `relation: none|original|post_fix|later_decision|unknown`, `appliesToSha` (SHA albo null); none ma pustą listę |
| `correction` | `status: verified|not_required|unavailable`, `evidence`, `rationale`; verified wymaga `fromSha`, `toSha`, diffu między nimi oraz pliku z toSha |
| `current` | `status: verified|unavailable`, `sha`, `evidence`, `rationale`; verified wymaga SHA projektu i aktualnego pliku z Git lub worktree |
| `decision` | wymagane dla accepted: `sourceIds` i `scope` świadomie pozostawionego ryzyka |

`evidence` w tych częściach jest tablicą dowodów z hashem SHA-256 bajtów:

- `{kind: git_file, sha, path, hash}`: dokładne `git show SHA:path`.
- `{kind: git_diff, fromSha, toSha, paths, hash}`: niepusty wynik
  `git diff --no-ext-diff --no-textconv --binary FROM TO -- PATHS...`.
- `{kind: worktree_file, path, hash}`: bieżące bajty zwykłego pliku w B.
- `{kind: source, sourceId, hash}`: bajty UTF-8 treści źródła; samo źródło
  odpowiedzi nie zastępuje pierwotnego pliku ani diffu poprawki.

Ścieżki muszą być bezpieczne, względne. Original dla inline odpowiada
`originalCommitSha ?? commitSha`, dla review `commitSha`, gdy te pola istnieją.
`response.relation: original` wskazuje original.sha, a post_fix przy
potwierdzonej poprawce wskazuje correction.toSha. Correction.fromSha równa
się original.sha. Fixed wymaga potwierdzonego original i correction;
rejected/accepted wymagają potwierdzonego original. Unavailable original lub
correction wymusza unresolved, unavailable current wymusza no_evidence.
Wtedy `analysis: complete` jest zabronione, nawet przy istniejącym pokryciu.

Merytoryczne `no_learning` wymaga `inspection` w formacie original bez sourceId
(status, sha, evidence, rationale). Brak inspekcji blokuje walidację; unavailable
blokuje zakończenie. Opis PR, pusty tekst i strukturalny thread są wyłączone.
Wznowienie nie może pominąć ID ocen z prepared.previous ani ich zachowanych
źródeł. Starszy lock analysis 1 pozostaje czytelny, lecz ponowny zapis wymaga
nowych dowodów. Brak dowodu daje `EVIDENCE_UNAVAILABLE`, zmiana bajtów
`EVIDENCE_CONFLICT`; pominięta uwaga `INCOMPLETE_FINDING_COVERAGE`.

Analysis 3 zachowuje wymagania dowodów z analysis 2 i wymaga oceny poziomu
reguły oraz treści i dostępności instrukcji według `analysis.md`. Wniosek
zapisuje się w istniejącym `rationale`; ocena semantyczna należy do agenta.
Starsze wpisy analysis 1/2 wracają do kolejki przez `rules_changed`.

## Lock (`kind: lock`)

`rules` wskazuje reguły ostatniej operacji; każdy wpis ma własne wersje `rules`,
aby zmiana jednej partii nie odświeżała pozostałych ocen. Wpis odpowiada wpisowi wyniku oraz przechowuje `sourceIds`.
Lock nie zależy od raportu cache: zawiera rozstrzygnięcia, referencje źródeł,
identyfikatory ocen i manifest dokumentów. Unikaj kopiowania pełnych komentarzy
lub diffów do locka; używaj zakresów tekstu zamiast cytatów, gdy wystarczą.
`validateLock` sprawdza schemat, repo, stany, hashe i wewnętrzne pokrycie.
`pendingReasons` wykrywa zmiany źródeł, kontekstu i reguł, niepełny odczyt,
nieukończoną analizę oraz oczekujące dostarczenie. Funkcja nie modyfikuje wpisu,
więc odświeżenie kontekstu zachowuje wcześniejsze fakty odczytu i ocenę historii.

Przykład pustego locka (przechodzi `validateLock`):

```json
{"schemaVersion":1,"kind":"lock","repository":{"id":"R_1","name":"example/project","branch":"main"},"rules":{"normalization":1,"analysis":4},"entries":[]}
```

Pełne wykonywalne przykłady źródeł, przygotowania i wyniku są syntetycznymi
fixtures w `tests/skills/gh-review-learn/contracts.test.mjs` repo katalogu.

## Kolektor — kontrakt operacyjny WP2

`collect.mjs` eksportuje `collect`, `compareSources`, `revalidateSources` oraz
`createGhTransport`. Transport przyjmuje `{type: rest, endpoint}` lub
`{type: graphql, query, variables}` i zwraca `{body, headers}`. REST zachowuje
nagłówek `link`, GraphQL `data` i `errors`, także przy niezerowym exit `gh`.
Pola API potwierdzono w dokumentacji [REST PR](https://docs.github.com/en/rest/pulls/pulls),
[REST review](https://docs.github.com/en/rest/pulls/reviews) i
[GraphQL pull requests](https://docs.github.com/en/graphql/reference/pulls).

Opis PR jest źródłem `issue_comment` z ID samego PR. Review bez inline,
wycofane review i puste wątki pozostają źródłami. Metadane edycji review
pochodzą z GraphQL, ponieważ REST listy review nie zwraca `updatedAt`.
Każdy wątek ma osobno stronicowaną listę komentarzy. `coverage` zawiera
scope, numer strony lub kursor, liczbę rekordów i potwierdzenie końca listy.
`read.boundary` zamyka zakres merge; nowe wywołanie ma nową granicę,
wznowienie zachowuje poprzednią. Brak żądanego PR jest jawną luką.

Cache zawiera źródła w `--output` i prywatny plik `<output>.checkpoint.json`.
Checkpoint V1 ma `selection`, `boundary`, `repository`, `responses`, `lastRead`.
`responses` to mapa SHA-256 strukturalnego requestu do `{request, response,
hash, scope}`. To referencje i hashe pełnych odpowiedzi, pozwalające odzyskać
już pobrane dane bez utraty treści. Zapis następuje po każdym udanym żądaniu;
cały checkpoint jest atomowo podmieniany z uprawnieniami 0600. Błędy GraphQL
nie są zapamiętywane jako sukces. Przerwanie zachowuje ostatni checkpoint.
Nie ma automatycznych sleep/retry. Błąd serwera i wskazówki retry trafiają do
luk; operator ponawia jawnie przez `--resume` po ustąpieniu ograniczenia.

Wznowienie najpierw odtwarza brakujące strony, a następnie wykonuje pełny,
świeży odczyt tej samej partii. Tylko świeży przebieg stanowi wynik; mieszany
wiek stron z fazy odzyskiwania nigdy nie daje dowodu kompletności.
`compareSources` dla częściowego odczytu zwraca `unknown_partial` i nie
wnioskuje o usunięciach; nie zmienia locka. Rewalidacja przed odbiorem przez
`revalidateSources(previous, options)` wymaga kompletności obu odczytów,
tego samego repo/gałęzi, zbioru PR i fingerprintu źródeł. Rozbieżność daje
`SOURCE_CONFLICT`, luka `INCOMPLETE_READ`. WP4 musi ją wywołać przed zapisem.

## Przygotowanie — kontrakt operacyjny WP3

`prepare.mjs` eksportuje `prepare`, `buildContext`, `createGitReader`,
`readSource`, `readGitFile` oraz `main`. CLI sprawdza repo konsumenta B i jego
`origin` względem `sources.repository.name`. Git wyznacza się przez
`resolve_tool_cmd`, a wykonywany proces otrzymuje aktywne env B. Nie ma
fetch, dostępu do API ani wyboru wersji zastępczej. Brak obiektu wskazuje
konieczność jawnego uzyskania dowodu przez agenta, nie upoważnia do uznania
poprawki za wykonaną.

`buildContext` odczytuje `git ls-files --stage -z` i rzeczywisty worktree.
Bajtowy hash to SHA-256, symlink jest hashowany jako tekst celu bez podążania,
a submoduł jako SHA jego HEAD (dla niepopulowanego: SHA indexu). Efektywny
tryb pliku uwzględnia bit wykonania. Usunięty, lecz śledzony plik ma
`missing: true` i `hash: fingerprint({missing:true})`; usunięcie z indexu
usuwa ścieżkę z manifestu. Konflikt indexu i nieobsługiwany typ obiektu dają
jawny błąd. Nie są odczytywane nieśledzone pliki lokalnych sekretów.
`extraPaths` pozwala WP4 uwzględnić nowy dokument w końcowym manifeście;
późniejsze śledzenie tych samych bajtów i commit nie zmieniają fingerprintu.

Konteksty cache są przechowywane jako
`<CACHE_PATH>/gh-review-learn/contexts/<fingerprint>.json`. `contextChanges`
przedstawia różnice ścieżek, trybów i hashy względem poprzedniej oceny.
Przy utracie cache zwraca `available: false`, nazwany powód i pełen aktualny
manifest. Nie udaje odtworzenia nieznanych dirty bajtów z dawnego SHA.
Porównanie fingerprintów i odbudowa materiałów nie zależą od tego cache.

Przygotowany wynik rozszerzają `inventory`, `remaining`, `sourceRead` i
`documentationDiscovery`. Inwentarz obejmuje wszystkie PR-y i źródła; kolejność
to czas merge, numer PR i ID źródła. `totalPending` obejmuje także elementy
poza jawną partią `--prs`. Każdy wybrany element dostaje `previous` z locka,
`contextChanges` oraz `materials`. Oczekujące dostarczenie pozostaje pracą
nawet po ukończeniu analizy, a zmiana kontekstu nie modyfikuje poprzedniej oceny.

Materiały mają stabilne `id`, `kind`, `provenance`, `status` i dane:

- `commit_inventory`: dokładny SHA, role `base|pr_head|reviewed|original_reviewed|merged`
  oraz pełny wykaz drzewa (path, mode, typ, OID).
- `file`: dokładny SHA i ścieżka, pełne `bytes` w base64, hash i reprezentacja
  UTF-8. Odczyt obejmuje ścieżki wskazane w źródłach; cały wykaz pozostałych
  plików jest dostępny w inwentarzu commita.
- `diff`: dokładne `from`, `to`, rola, pełny binarny diff (base64 i tekst), hash
  oraz `complete: true`. Role rozdzielają reviewed→head, base→head,
  head→merged i pierwszy rodzic merge→merged. Ten ostatni jest różnicą
  wskazanych obiektów, nie automatycznym dowodem całej poprawki przy rebase.
- `merge_parent`: SHA merge i pierwszy rodzic wskazany przez obiekt Git.
- `current_document`: faktyczne bajty i hash dokumentu z poprzedniej propozycji.

Błąd odczytu materiału daje `status: missing`, `reason` i diagnostykę.
`truncated_output` oznacza limit procesu; ucięty tekst nie jest zwracany jako
pełny diff. Inne braki mają `unavailable_git_object_or_path` lub
`merge_sha_unavailable`. Nie ma heurystyk długości, autorów, słów ani nazw plików.

Przygotowanie używa dokładnych `lockBytes` do tokenu `expectedLockHash`;
przekazany obiekt locka musi odpowiadać tym bajtom. Źródła wymagające innej
wersji reguł wymagają ponownego zebrania. Lock ze starszymi regułami pozostaje
czytelny i jego wpisy wracają do kolejki. Przy częściowym odczycie wszystkie
objęte PR-y wymagają dalszej pracy (`incomplete_sources`).

Jawne odczyty nie zapisują plików i obsługują zakres UTF-16 `[start,end)`:

```bash
node <skill_dir>/scripts/prepare.mjs --sources <CACHE_PATH>/gh-review-learn/sources.json --read-source SOURCE_ID --start 0 --end 20
node <skill_dir>/scripts/prepare.mjs --read-file docs/README.md --sha EXACT_GIT_SHA --start 0 --end 20
```

Bez zakresu zwracany jest cały tekst. Wersja pliku zawsze pochodzi z jawnego
SHA; bajty w base64 zachowują także dane binarne. Tekstowy zakres nie ogranicza
pełnych bajtów w polu `bytes`. Pomoc CLI działa bez repo i sieci.
Brak historycznych materiałów daje CLI `partial`/exit 2, przy zachowaniu całego
inwentarza i dostępnych dowodów. Semantyczne rozstrzygnięcie luk należy do agenta.

## Walidacja i zapis — kontrakt operacyjny WP4

Każdy wpis wyniku ma dodatkowo `materialDispositions`: dokładnie jeden obiekt
`{id, status: used|unavailable|not_needed, rationale}` dla każdego materiału
przygotowanego przez WP3. `used` wymaga dostępnego materiału, `unavailable`
wymaga brakującego; świadome pominięcie wymaga uzasadnienia `not_needed`.
To jawna decyzja agenta, bez automatycznego uznawania brakującej poprawki.

`validate-result.mjs` sprawdza schemat, repo, referencje, pełne pokrycie źródeł
i materiałów, bieżące reguły, token locka oraz faktyczne dokumenty i kontekst.
Nie pobiera GitHuba i nie zapisuje plików. `record-result.mjs` powtarza te
kontrole i przed zapisem wywołuje `revalidateSources` z WP2 dla wybranej partii.
Oba odczyty muszą być kompletne, fingerprinty i metadane wersji PR zgodne.
Błąd ma nazwany zakres: `SOURCE_CONFLICT`, `CONTEXT_CONFLICT`,
`DOCUMENT_CONFLICT`, `LOCK_CONFLICT` lub błąd formatu/pokrycia.

Dla `applied` dokument musi mieć rzeczywisty `afterHash`, a `beforeHash`
odpowiadać manifestowi wejściowemu (null dla nowego dokumentu). Pozostałe
stany wymagają rzeczywistych bajtów `beforeHash`: sam manifest propozycji nie
oznacza zastosowania. Każdy zastosowany wpis potwierdza
`finalDocumentsReviewed: true`. Ścieżki muszą być w B, poza `.git`, cache i
lockiem, bez symlinków w którymkolwiek komponencie. Aktualny kontekst może
różnić się od przygotowanego tylko zadeklarowanymi zastosowanymi dokumentami.
Nowe dokumenty są jawnie dodawane przez `extraPaths` do końcowego manifestu;
po commicie tych samych bajtów kontekst pozostaje identyczny.

Podczas całej operacji `recordResult` posiada wyłącznie utworzony przez `wx`
plik `review-learning.lock.json.write-lock`. Drugi writer otrzymuje konflikt;
nie przejmuje ani nie usuwa cudzej blokady. Po przerwaniu procesu operator
sprawdza właściciela przed ręcznym usunięciem pozostawionej blokady.
Po pobraniu źródeł ponownie sprawdza kontekst i token rzeczywistych bajtów
locka. Po walidacji zapisuje wyłącznie lock przez współdzielony
`writeFileAtomic`; awaria podmiany zachowuje poprzedni plik. Dokumenty
zmienia agent na polecenie użytkownika. Błąd nie wycofuje dokonanej wcześniej
edycji dokumentów: można wznowić stary wynik po sprawdzeniu bajtów lub ponownie
przygotować aktualny materiał i świadomie rozliczyć stan istniejący.

Lock przechowuje tylko pola kontraktu wpisów. Oceny zachowują referencje jako
zakresy tekstu, bez kopii komentarzy: cytat musi wskazywać jedno dokładne
wystąpienie albo agent podaje zakres. Inne wpisy pozostają bez zmian, z własnymi
wersjami reguł i fingerprintami. Zmiana dokumentów nie odświeża ich ocen.

Token musi odpowiadać bieżącemu lockowi. Wyjątkiem w `record-result` jest
identyczny już zapisany wynik: porównanie danych (nie kolejności wpisów PR)
pozwala zakończyć bez zapisu również ze starym tokenem. Różny wynik wymaga
ponownego przygotowania na bieżącej bazie. `validate-result` pozostaje ścisłym
walidatorem tokenu i sam nie stosuje tego wyjątku. Nie zmienia się timestampów,
nie przepisuje identycznych bajtów. Pusta partia nie tworzy pustego locka.

`--dry-run` wykonuje ten sam świeży odczyt i kontrole pod przejściową blokadą,
ale nie podmienia locka ani dokumentów. Raport zawiera kompletność i przedział
odczytu, liczbę obsłużonych źródeł, brakujących materiałów i dowodów,
oczekujących propozycji, konfliktów oraz `changed` i `dryRun`.
Wstrzyknięty `transport` testuje zmiany API, a `fsOps` testuje wyłączny dostęp
i awarie atomowego zapisu bez zmiany produkcyjnego protokołu.

### Usunięte źródła wcześniejszych uwag

Po kompletnym odczycie zachowaj referencję usuniętego komentarza jako
`{id, start, end, unavailable: true}`, kopiując ID i zakres z tej samej uwagi
w poprzednim locku. Nie dodawaj tego ID do aktualnych `sourceIds` ani dispositions.
Uwaga pozostaje `historical: unresolved`; gdy usunięto źródło pierwotne,
`verification.original.status` musi być `unavailable`. Niedostępne ID nie może
służyć jako aktualny dowód, odpowiedź ani decyzja. Zachowany zakres jest
pochodzeniem historycznym, nie dowodem odczytu. Po powrocie źródła oceń je
ponownie i usuń znacznik.
