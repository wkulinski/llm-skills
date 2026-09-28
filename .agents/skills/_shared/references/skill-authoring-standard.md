# Standard jakości autorskiej skilli i instrukcji

Ten standard opisuje jakość autorską artefaktów instrukcji: skilli,
`.opencode/agents/*.md` oraz dokumentów reguł (`AGENTS.md` i bloków instrukcji
w `README.md`). Jest podstawą oceny w `$skill-review`, a nie drugim zbiorem
reguł wykonywalnych.

## Właściciele reguł MUST

Reguły strukturalno-wykonawcze mają jednego właściciela: `skill-structure-contract.md`.
Reguły MUST egzekwują testy repozytorium (`tests/skills/**`). Ten standard:

- nie powtarza notacji ścieżek, priorytetu zasad, semantyki `shared_files`,
  rozwiązywania entrypointów ani żadnej innej reguły strukturalnej;
- nie definiuje nowych progów MUST, limitów liczbowych ani kodów błędów;
- wskazuje właściciela zamiast kopiować jego treść.

Ocena w `$skill-review` jest read-only: standard opisuje oczekiwaną jakość,
a nie procedurę automatycznych poprawek. Zmiana standardu należy do użytkownika
i planu, nie do audytu.

## Wymiary jakości

### 1. Opis i trigger (semantyka)

- `description` jest triggerem wyboru: mówi, jaki rezultat daje artefakt i kiedy
  po niego sięgnąć, a nie jak jest zbudowany od środka.
- Opis nie zawiera polityki wewnętrznej (np. warunków uruchamiania QA) ani
  duplikacji tabeli routingu.
- Semantykę opisu ocenia się jakościowo: czy da się wybrać skill po intencji,
  bez otwierania treści. Twarde reguły opisu (język, limit, fraza użycia) należą
  do testów kontraktowych.

### 2. Progressive disclosure

- Korzeń `SKILL.md` jest routerem: cel, workflow, twarde bramki i tabela
  routingu referencji. Szczegóły żyją w plikach referencyjnych ładowanych
  warunkowo, zgodnie z aktywnym krokiem.
- Tabela routingu wiąże warunek użycia z plikiem; brak warunku oznacza, że plik
  jest zbędny albo korzeń go nie potrzebuje.
- Przeniesienie treści nie może osłabić bramki bezpieczeństwa ani pinu testu.

### 3. Przenośność modeli

- Artefakt opisuje role i wymagania, a nie konkretne modele, warianty ani
  reasoningi. Pary runtime pochodzą z konfiguracji projektu.
- Nazwy modeli w tekście normatywnym to zapach: jeśli występują, wskazują na
  przypięcie do jednego środowiska.

### 4. Granice decyzyjne i definicja ukończenia

- Artefakt mówi, kiedy działa samodzielnie, kiedy pyta, a kiedy przekazuje
  sterowanie innemu workflow.
- Warunek zakończenia jest obserwowalny: lista statusów, dowodów albo kryteriów,
  nie ogólne „dopóki nie będzie dobrze”.
- Brak granic („działaj zawsze i pytaj o wszystko”) jest równie wadliwy jak
  nadmiar bramek blokujących rutynową pracę.

### 5. Spójność i sprzeczności

- Jedna reguła ma jedno kanoniczne miejsce; pozostałe dokumenty odsyłają do
  właściciela zamiast kopiować treść.
- Powielony blok to dług: przy dotknięciu obszaru scala się go do właściciela.
- Sprzeczność między korzeniem, referencją a testem rozstrzyga się na korzyść
  właściciela reguły i testu, nie lokalnej interpretacji.

### 6. Evidence i kontrakty testowe

- Każde twierdzenie o zachowaniu ma pokrycie w teście, helperze albo konkretnym
  pliku; deklaracje bez pokrycia są findingiem.
- Artefakt deklaruje, które testy pinują jego kontrakt, i nie obiecuje
  zachowania, którego nic nie egzekwuje.
- Luka evidence jest raportowana jawnie, nigdy maskowana.

### 7. Język

- Opisy skilli są polskie i spójne z warstwą, w której żyje artefakt.
- Jeden artefakt nie miesza języków bez powodu; mieszanie języka w obrębie
  jednej sekcji utrudnia wybór i utrzymanie.

### 8. Ekonomia kontekstu

- Rozmiar korzenia jest proporcjonalny do roli routera; monolit wypiera
  progressive disclosure.
- Powtarzalne bloki, tabele i checklisty przenosi się do referencji albo
  `_shared`.
- Koszt utrzymania mierzy się liczbą miejsc wymagających edycji przy jednej
  zmianie reguły.

## Agent instructions (`.opencode/agents/*.md`)

Dotyczy plików `.opencode/agents/*.md`; runtime, uprawnienia i wybór modelu
pozostają poza oceną.

- Opis agenta jest triggerem delegacji: mówi, jakie zadanie agent przyjmuje,
  jakie odrzuca i co zwraca.
- Frontmatter nie przypina `model`, `variant` ani `thinking`; konfiguracja
  runtime żyje w `opencode.jsonc`.
- Body zawiera kontrakt delegacji (co agent dostaje) i format zwrotu (status i
  pola wyniku), spójny z delegującym skillem.
- Relacje są kompletne: delegujący skill wskazuje agenta, plik agenta ma wpis
  w `opencode.jsonc`, a kontrakt jest pinowany testem agentowym. Osierocony plik,
  osierocony wpis konfiguracji albo brak delegującego skilla to finding.
- Długość i język opisu agenta są metryką monitorowaną, bez twardego progu
  długości.

## Rules documents (`AGENTS.md` i bloki instrukcji w `README.md`)

Dotyczy `AGENTS.md` oraz bloków instrukcji dla konsumentów w `README.md`;
dokumentacja domenowa (np. `docs/**`) pozostaje w `$docs-sync`.

- Aktualność: dokument nie zawiera zdań nieprawdziwych dla bieżącego stanu repo
  ani historii, która przestała obowiązywać.
- Brak duplikatów: kluczowe bloki (np. mapa dokumentacji) występują raz.
- Spójność z `docs_map`: odwołania i ścieżki odpowiadają zadeklarowanej mapie.
- Przenośność: reguły runtime konsumentów żyją w `.agents/skills/**`, a
  `AGENTS.md` trzyma wyłącznie wskazania lokalne dla danego repo.
- Jasność entrypointu: procedura startu, warunkowy refresh kontekstu i rola
  agenta głównego są jednoznaczne.
- `rules-sync` pozostaje właścicielem synchronizacji i edycji tych plików;
  `skill-review` wyłącznie je ocenia.

## Powiązania

- Reguły strukturalne MUST: `skill-structure-contract.md`.
- Routing nadrzędnego workflow: `skill-routing-policy.md`.
- Kontrakt oceny i format findings: `<skills_root>/skill-review/SKILL.md`.
- Testy egzekwujące kontrakty: `tests/skills/**`, w tym testy opisów,
  `shared_files`, routingu Playwright i kontraktów agentowych.
