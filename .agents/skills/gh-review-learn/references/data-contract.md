# Kontrakty danych gh-review-learn V1 i V2

Właścicielem formatu i walidacji jest `../scripts/contracts.mjs`. Wszystkie
artefakty są JSON UTF-8, mają `schemaVersion`, `kind`, `repository`.
Źródła GitHuba pozostają w V1. Nowe przygotowanie, wynik i lock używają V2;
czytniki nadal przyjmują V1. Zmiana formatu nie podnosi `rules.analysis`.
`repository` zawiera stabilne GraphQL `id`, bieżące `name` (`owner/name`) i
`branch`. Zmiana dowolnego pola oznacza `REPOSITORY_CONFLICT`, bez zapisu.
Nieobsługiwany schemat daje `UNSUPPORTED_SCHEMA`. `rules` zawiera dodatnie
wersje `normalization: 1` i `analysis: 4`. Starsze wersje reguł w
locku są czytelne, lecz wymagają ponownej analizy przez `pendingReasons`.
Nie wolno traktować nieznanych wersji reguł jako aktualnych reguł wykonania.

## Propozycje dokumentacji w V2

Lock ma jedno kanoniczne `documentationChanges`. Każdy rekord zawiera:
`id`, dodatnie `revision`, repo-relative `path`, `section`, `description`
(konkretna zmiana zasady), `rationale`, `beforeHash` (null dla nowego pliku),
`afterHash`, `status: proposed|applied|declined` oraz niepuste `references`
z parami `{prId, assessmentId}`. Te same teksty nie łączą rekordów automatycznie.
Jedna wspólna zmiana ma jedno ID i jawne referencje wszystkich ocen.
PR zawiera `documentationChangeIds`; oba kierunki relacji muszą być zgodne,
a oceny muszą istnieć w odpowiednim PR. Duplikaty są błędem.

`declined` wymaga `userDecisionRef` na propozycji, `applied` wymaga
`finalDocumentsReviewed: true`. Propozycja `proposed` nie może dziedziczyć
decyzji ani potwierdzenia zastosowania. Zmiana ścieżki, sekcji, opisu lub
docelowych hashy wymaga kolejnej rewizji (`poprzednia + 1`) w stanie `proposed`.
Bez zmiany treści rewizja pozostaje ta sama; pierwsza wynosi 1. Zapis nie usuwa
wcześniejszych propozycji. Zmiany uzasadnienia i referencji nie tworzą nowej
rewizji treści.
Przy tej samej rewizji status `applied` lub `declined` oraz pola
`appliedOperationId`, `appliedAt`, `finalDocumentsReviewed` i `userDecisionRef`
pozostają niezmienne. Zapis analizy nie może cofnąć ani przepisać decyzji.

Stan `delivery` PR-a jest sprawdzany względem propozycji: dowolna `proposed`
daje `delivery_pending`; w przeciwnym razie dowolna `applied` daje `applied`;
same `declined` dają `declined`; pusty zbiór daje `not_required`. Decyzje
odmowy należą do indywidualnych propozycji. `documents` PR-a obejmuje dokładnie
ich ścieżki, po jednym wpisie na plik. Przy mieszanych stanach hash końcowy
manifestu opisuje faktycznie zastosowany zestaw dla pliku, a nie wszystkie
propozycje. Pending na innym pliku nie wymaga jego edycji.

Przygotowanie V2 udostępnia `documentationChanges` oraz `previousEntries`
(wpisy locka), aby wynik obejmujący tylko część PR-ów mógł walidować wspólne
referencje. Wynik V2 zawiera pełne `documentationChanges`; nie może zgubić
propozycji spoza bieżącego wyboru. Zapis dodatkowo porównuje rewizje z lockiem
odczytanym pod wyłączną blokadą, a nie wyłącznie z cache przygotowania.

`validateLock` ani `prepare` nie zmieniają bajtów locka V1. `upgradeLock`
tworzy wyłącznie kopię w pamięci; pierwszy jawny zapis przechodzi do V2.
Wszystkie wcześniejsze oceny, źródła, hashe, wersje reguł i stany pozostają.
Wpisy V1 otrzymują `documentationChangeIds: []` oraz
`historicalDocumentation: {"schemaVersion": 1, "details": "unavailable"}`.
To jawna luka opisu,
nie dowód nowej edycji. Nie tworzy się fikcyjnych propozycji. Odczytanie V1
nie jest samo w sobie powodem ponownej analizy. Nadal obsługiwany wynik V1
zapisuje się jako historyczny wpis bez szczegółów; nowy wynik V2 nie może
sam nadać tej etykiety nowemu PR-owi.

## Rezerwacje partii i zastosowania w V2

Lock i przygotowanie mają obowiązkowe pola `activeBatch`, `activeDelivery`
oraz `lastDelivery`, każde jako obiekt albo null. Jedno pole mieści najwyżej
jedną operację; nie powstaje druga baza postępu.

- `activeBatch`: `{id, limit, repository, prIds, prNumbers, members, recordedPrIds, scopeFingerprint, boundary, selectedAt, inventoryReadAt}`.
  Limit jest dodatni, lista ID niepusta, unikalna i nie większa od limitu.
  `members` przechowuje wersje metadanych PR-ów, a `recordedPrIds` zapisane
  wyniki. Hash repo i gałęzi oraz granica odczytu wiążą trwały skład z wyborem.
  Po zakończeniu `lastBatch` zachowuje ostatni skład, rozmiar i czas odbioru,
  aby kontynuacja mogła wskazać ten sam rozmiar.
- `activeDelivery`: `{operationId, userDecisionRef, changes, documents,
  startedAt, inputContext, sourceFingerprints, sourcePrs, diffHash}`. `changes` to niepusty,
  unikalny zestaw `{id, revision}` oczekujących propozycji; `documents`
  obejmuje dokładnie wybrane ścieżki i ich hashe dla tego zestawu.
  `inputContext` ma format `context`, a `sourceFingerprints` zawiera
  `{prId, sourceFingerprint}` dokładnie powiązanych PR-ów. `sourcePrs` wiąże
  również ich wersje Git, a opcjonalny `diffHash` chroni artefakt cache.
- `lastDelivery`: `{operationId, userDecisionRef, changes, documents,
  confirmedAt, contextFingerprint, sourceFingerprints, sourcePrs, diffHash}`. To jedno zwięzłe potwierdzenie;
  może wskazywać starszą rewizję obecnego rekordu, bez przeniesienia
  zastosowania na jego późniejszą rewizję.

Te schematy są podstawą kolejnych operacji partii i potwierdzenia zastosowania.
Sam obiekt zamiaru nie oznacza zastosowania. Dokładny diff i snapshot bajtów
pozostają w cache, a po ich utracie nie rekonstruuje się ich z hashy.

`lock-store.mjs` jest jedynym właścicielem zapisu: `withConsumerLock` trzyma
wyłączną blokadę także przez asynchroniczne odświeżenie źródeł. Pod blokadą
odczytuje i waliduje plik, sprawdza `expectedLockHash`, rewizje i niezmienność
odczytanych bajtów, po czym wykonuje atomową podmianę. Identyczne ponowienie
nie zapisuje nawet przy starym tokenie. Inna zmiana wymaga aktualnego tokenu.
`dryRun` wykonuje kontrole bez migracji i podmiany. Awaria zachowuje stary
plik; wyłączna blokada jest zwalniana także po błędzie.

Przykład pustego locka V2 (przechodzi `validateLock`):

```json
{"schemaVersion":2,"kind":"lock","repository":{"id":"R_1","name":"example/project","branch":"main"},"rules":{"normalization":1,"analysis":4},"entries":[],"documentationChanges":[],"activeBatch":null,"activeDelivery":null,"lastDelivery":null}
```

## Operacje CLI

Każdy przyjmuje `--help`, nie wymaga przy pomocy Git ani sieci. Ścieżki wejściowe
są rozwiązywane względem repo konsumenta B; skrypty należą do instalacji A.

| Operacja | Argumenty |
| --- | --- |
| `collect.mjs` | `--repo owner/name` (opcjonalnie: repo B), `--branch name` (opcjonalnie: domyślna gałąź GitHuba), `--inventory-only` lub `--batch ID` lub `--prs 1,2`, `--resume path` (opcjonalny manifest), `--output path` |
| `prepare.mjs` | `--sources path`, `--lock path` (domyślnie `review-learning.lock.json` B, brak oznacza inicjalizację), `--prs 1,2` (opcjonalnie), `--output path` |
| `validate-result.mjs` | `--sources path`, `--prepared path`, `--result path`, `--lock path` (opcjonalny domyślny lock B) |
| `record-result.mjs` | te same wejścia co walidator; opcjonalnie `--begin-delivery` albo `--confirm-delivery` oraz `--dry-run`; tryby dostarczenia czytają `result.delivery` |
| `batch.mjs` | `select --inventory path --batch-size N` albo `resume [--batch ID]` |
| `report.mjs` | `--output path`; opcjonalnie `--sources path`, `--prepared path`, `--inventory path`, `--event path` |

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
przygotowane przez prepare (wersja, ścieżka cache, zakres dowodu lub przyczyna braku).
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
  ukończenia analizy. W V1 declined wymaga referencji decyzji na wpisie PR,
  w V2 decyzje są indywidualne. Nowe applied nadaje tylko confirm-delivery
  po ocenie całego zestawu i sprawdzeniu rzeczywistych bajtów.

`documents`: `{path, beforeHash, afterHash}`. `beforeHash: null` oznacza nowy
plik. Ścieżka jest względna B, bez traversal. Pending i applied wymagają
niepustego manifestu dokumentów. Kontrolę realpath/symlinków, końcowych bajtów,
zmian poza manifestem i odświeżonych źródeł przeprowadza confirm-delivery.
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

## Kolektor

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
`SOURCE_CONFLICT`, luka `INCOMPLETE_READ`. record-result wywołuje ją przed zapisem.

## Przygotowanie

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
`extraPaths` pozwala uwzględnić nowy dokument w końcowym manifeście;
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

## Walidacja i zapis analizy

Każdy wpis wyniku ma dodatkowo `materialDispositions`: dokładnie jeden obiekt
`{id, status: used|unavailable|not_needed, rationale}` dla każdego materiału
przygotowanego przez prepare. `used` wymaga dostępnego materiału, `unavailable`
wymaga brakującego; świadome pominięcie wymaga uzasadnienia `not_needed`.
To jawna decyzja agenta, bez automatycznego uznawania brakującej poprawki.

`validate-result.mjs` sprawdza schemat, repo, referencje, pełne pokrycie źródeł
i materiałów, bieżące reguły, token locka oraz faktyczne dokumenty i kontekst.
Nie pobiera GitHuba i nie zapisuje plików. `record-result.mjs` powtarza te
kontrole i przed zapisem wywołuje `revalidateSources` dla wybranej partii.
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
edycji dokumentów. Potwierdzenie wznawia się z tym samym trwałym zamiarem;
nowy prepare nie zastępuje jego bazowego kontekstu snapshotem po edycji.

Lock przechowuje tylko pola kontraktu wpisów. Oceny zachowują referencje jako
zakresy tekstu i URL-e źródeł, bez kopii komentarzy: cytat musi wskazywać jedno dokładne
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


## Trwałe partie nowych PR-ów

`collect --inventory-only` zapisuje `kind: inventory`, schemaVersion 1, pełne
`prs`, repo i przedział odczytu, bez dyskusji. `validateInventory` sprawdza ten
format. Nie jest to kompletny odczyt źródeł do analizy; prepare przyjmuje tylko
`kind: sources`. Listowanie zachowuje pełną paginację historii.

`batch select` przyjmuje wyłącznie kompletny inwentarz i dodatni bezpieczny
integer. Pod wspólną blokadą wybiera PR-y bez jakiegokolwiek wpisu analizy,
według mergedAt, numeru i ID, i zapisuje skład w activeBatch bez tworzenia ocen.
Przy tej samej aktywnej partii zwraca ją bez zapisu. Inny rozmiar, repo, gałąź,
granica albo brak/zmiana wybranego członka dają konflikt. Nowy PR nie zastępuje
brakującego. Nowy wybór po zamknięciu używa świeżego pełnego inwentarza.

`resume` odczytuje lock bez cache i zwraca niezapisanych członków oraz gotowe
polecenie collect. `sources.batchId`, `prepared.batchId` i `result.batchId`
muszą być identyczne. Collect zachowuje granicę i wersje metadanych członków.
Po świeżym odczycie można przygotować wynik podzbioru niezapisanych PR-ów.
Każdy zapisany complete albo needs_decision dopisuje członka do recordedPrIds;
po komplecie activeBatch jest zamykane. Pending bez zapisanego rozstrzygnięcia
nie kończy członka. Dry run niczego nie oznacza jako zapisanego.

Przy aktywnej partii domyślna ścieżka wymaga resume i nie może zastąpić składu.
Jawne `collect --prs` bez `--batch` może odświeżyć wyłącznie PR-y, które mają już
zapisany wpis analizy, także z wcześniejszych partii. Prepare i zapis ponownie
sprawdzają tę granicę. Taki zapis nie zmienia recordedPrIds ani składu partii;
może służyć ponownej ocenie i zastosowaniu gotowych propozycji. Zastosowanie
wymaga świeżych źródeł wszystkich powiązanych PR-ów oraz aktualnego kontekstu.
Bez aktywnej partii dotychczasowy pełny zakres i jawne --prs pozostają dostępne.
Prepared ma osobne queues: new, unresolved, reassessment, delivery. Mogą się
nakładać. Wpisy bez odczytu źródeł mają sourceFreshness: unchecked. Zmiana
kontekstu nadal kieruje stare oceny do ponownego sprawdzenia.

`batch abandon --batch ID --user-decision-ref REF` wymaga jawnej decyzji
użytkownika. Pod wspólną blokadą przenosi aktywną rezerwację do `lastBatch`
ze statusem `abandoned`, `abandonedAt` i `userDecisionRef`, a activeBatch ustawia
na null. Zachowuje wszystkie wpisy analizy, propozycje i dane dostarczenia;
nie zapisuje fikcyjnego ukończenia brakujących PR-ów. Powtórzenie tej samej
decyzji dla tej samej ostatniej porzuconej partii nie zapisuje pliku ponownie.
Nieznane lub nieaktywne ID daje konflikt. Wynik przygotowany dla porzuconej
partii nie może już zostać zapisany. Nowa selekcja używa świeżego inwentarza
i nadal pomija zapisane wyniki; niezapisane PR-y pozostają kandydatami.

## Protokół zastosowania

Tryby dostarczenia record-result czytają z pliku --result obiekt `delivery`
zamiast nowego zestawu ocen. Zapis analizy nie nadaje nowego applied, również
przy starszym formacie wejścia. Historyczne applied pozostają czytelne.

Po potwierdzonym poleceniu użytkownika przygotuj delivery z operationId,
userDecisionRef, changes w formacie {id, revision} oraz documents. Każdy dokument
zawiera path, rzeczywisty beforeHash, oczekiwany afterHash **wybranego zestawu**
i afterBytes w base64. Kilka propozycji jednego pliku ma jeden końcowy manifest;
hash pełnego zestawu nie zastępuje hasha wybranego podzbioru. OperationId używa
liter, cyfr, myślników lub podkreśleń i ma do 128 znaków.

```bash
node <skill_dir>/scripts/record-result.mjs --sources "$REVIEW_LEARN_CACHE/sources.json" --prepared "$REVIEW_LEARN_CACHE/prepared.json" --result "$REVIEW_LEARN_CACHE/intent.json" --begin-delivery
node <skill_dir>/scripts/prepare.mjs --sources "$REVIEW_LEARN_CACHE/sources.json" --output "$REVIEW_LEARN_CACHE/prepared.json"
```

Begin wymaga aktualnego kontekstu ocen i pełnych, świeżych źródeł wszystkich
powiązanych PR-ów. Weryfikuje bieżące pliki, wiąże ich manifest z inputContext
i zapisuje zamiar przed edycjami. Cache deliveries/<operationId>/ zawiera
snapshoty przed edycją, zadeklarowane bajty końcowe oraz dokładny changes.diff.
Lock zachowuje tylko manifest, referencje i hashe; nie przechowuje diffu.
Sam zamiar nie zmienia stanów propozycji. Kolejne różne rozpoczęcie daje konflikt.

Następnie agent edytuje wyłącznie uzgodnione pliki i czyta cały końcowy zestaw.
Do confirmation.json wpisuje:

```json
{"delivery":{"operationId":"delivery-42","finalDocumentsReviewed":true}}
```

```bash
node <skill_dir>/scripts/record-result.mjs --sources "$REVIEW_LEARN_CACHE/sources.json" --prepared "$REVIEW_LEARN_CACHE/prepared.json" --result "$REVIEW_LEARN_CACHE/confirmation.json" --confirm-delivery
```

Confirm sprawdza źródła, wersje PR-ów, dokumenty i zmiany kontekstu względem
**trwałego inputContext**, nie nowego prepared po edycji. Wszystkie pliki bazowe
dają not_applied. Zestaw mieszany, inne bajty, zmiana źródeł lub kontekstu poza
manifestem blokują potwierdzenie. Po zgodnych końcowych bajtach tylko wybrane
rewizje przechodzą do applied, a lastDelivery i stany są zapisywane atomowo.
Pozostałe propozycje zachowują stan. Odrębna ocena semantyczna dokumentów jest
obowiązkiem agenta, nie rezultatem porównania hashy.

Po awarii podmiany zostają stare stany i activeDelivery oraz zmienione dokumenty.
Także błąd przed wejściem w sekcję zapisu, np. zajęty guard, odtwarza stan
z czytelnego locka i rzeczywistych plików zamiast raportować brak edycji.
Błąd zwraca delivery.event: progress_unconfirmed i changedFiles; nie potwierdza
applied. Wznów tę samą operację bez ponownej edycji po sprawdzeniu źródeł i
plików. Po utracie cache kontrola używa trwałych hashy; brak diffu pozostaje
jawny. Identyczne ponowienie potwierdzonego operationId zwraca
previously_confirmed bez zmiany locka i jego mtime. Dry run nie zapisuje zamiaru,
nie potwierdza zastosowania i nie tworzy zgody na edycję. Helper nigdy nie
edytuje dokumentów ani nie wykonuje automatycznego rollbacku.

## Rozstrzygnięcie nieaktualnego zamiaru

`--abandon-delivery` przyjmuje `result.delivery: {operationId, userDecisionRef}`
z jawną decyzją porzucenia. Pod wspólną blokadą i z bieżącym expectedLockHash
zwalnia wyłącznie wskazany activeDelivery. Nie wymaga przyjęcia zmienionych
źródeł ani cofania dokumentów. Zachowuje propozycje, ich statusy i lastDelivery.
Opcjonalne pole V2 `lastAbandonedDelivery` przechowuje operationId, referencję
decyzji porzucenia, originalDecisionRef, zmiany, manifest, abandonedAt i observed
z rzeczywistymi hashami lub stanem unreadable. To jeden ostatni zapis, nie dziennik.
Raport odróżnia historyczny stan plików w chwili porzucenia od nowego applied.
Powtórzenie tej samej decyzji dla ostatniej porzuconej operacji jest no-op;
nieznane ID daje konflikt. Dry run nie zwalnia zamiaru. Nie wolno ponownie użyć
ID ostatniej porzuconej operacji. Po porzuceniu świeże źródła i prepare pozwalają
zapisać ponowną analizę, nową rewizję i zamiar z nowym ID. Zgoda na porzucenie
nie jest zgodą na nowe edycje. Błąd podmiany zachowuje aktywny zamiar i stare bajty.

## Protokół raportu

Czysta funkcja buildReportModel jest współdzielona przez stdout record-result
(`data.report`) i report.mjs. Przyjmuje zapisane propozycje, bieżące zdarzenie,
wyniki walidacji i zakres odczytu. Renderowanie nie dowodzi trafności wniosku.
Report.mjs zapisuje tylko cache. Opcjonalny --event wskazuje zapisany stdout
operacji; bez niego raport opisuje zastany stan. Przy aktywnym zamiarze helper
odczytuje rzeczywiste hashe, aby także bez cache nazwać niepotwierdzone edycje.

Kolejność czterech części:

1. Wprowadzone zmiany: po jednym wpisie na propozycję, dokument i sekcja z
   linkiem, konkretna zasada, przyczyna i źródła wszystkich powiązanych ocen.
   Diff do 80 linii pokazuje się w całości; większy ma opis zmienionych zasad
   i link do pełnego artefaktu. Nie ogranicza to kompletności dowodu.
2. Propozycje niezastosowane: indywidualne proposed i declined, z decyzją odmowy.
3. Ustalenia bez zmiany dokumentacji: merytoryczne rozstrzygnięcia ocen i jawne
   luki historycznych rekordów bez opisu; bez fikcyjnych szczegółów V1.
4. Postęp i kontynuacja: repo, gałąź, SHA, przedział i granica odczytu,
   kompletność, odświeżone i niesprawdzone PR-y, dokładny skład partii, liczby
   nowych analiz, wyników, nierozstrzygnięć, ponownych ocen i dostarczeń.
   Kolejek nie sumuje się jako różnych PR-ów. Liczba pozostałych nowych PR-ów
   wymaga pełnego inwentarza i daty jego odczytu, inaczej jest nieznana.

Bez nowego potwierdzenia pierwsze zdanie brzmi „Nie wprowadzono zmian do
dokumentacji”, a dalsze wyjaśnia powód. Dawne applied nie stają się nowymi
zmianami. Po edycji bez zapisanego potwierdzenia pierwsze zdanie brzmi
„Dokumentacja została zmieniona, ale zapis postępu nie został potwierdzony”
i pokazuje pliki. Powtórne potwierdzenie nazywa wcześniejsze zastosowanie.

Dokładny diff jest odczytywany wyłącznie z cache po sprawdzeniu trwałego hasha.
Po jego utracie pozostają opisy i hashe, a raport nazywa brak artefaktu.
Gotowe polecenie wskazuje resume z ID aktywnej partii albo świeży inwentarz i
następną partię o tym samym rozmiarze (np. 20). Koniec nowej historii dotyczy
wyłącznie kompletnego odczytu, nie wcześniejszych zaległości. Raport nie zleca
sam zastosowania propozycji ani rozszerzenia zakresu.
