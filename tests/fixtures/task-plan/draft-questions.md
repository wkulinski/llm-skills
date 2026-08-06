## Decisions and open questions

### Decyzje zakresowe przed decyzjami pakietowymi

- **SQ1 [BLOCKING]** Czy async ma być opt-in, czy domyślny dla wszystkich POST-ów grida?
  - Wpływ: Zmienia kontrakt wszystkich pakietów runtime.
  - Wymagana decyzja: Wybrać opt-in albo default async.
  - Status: `resolved`
  - Odpowiedź: default async

### WP1 — Kontrakt backendu

**Status:** `pending`<br>
**Dostępne decyzje:** `accept` / `revise` / `exclude` / `separate`

#### Pytania blokujące

- **WP1-Q1 [BLOCKING]** Jakie kody HTTP obowiązują dla błędów domenowych, uprawnień i CSRF?
  - Wpływ: Definiuje kryteria akceptacji kontraktu odpowiedzi.
  - Wymagana decyzja: Wskazać kody HTTP.
  - Status: `open`

#### Pytania nieblokujące

- Brak.

### WP2 — Runtime TypeScript/Stimulus

**Status:** `pending`<br>
**Dostępne decyzje:** `accept` / `revise` / `exclude` / `separate`

#### Pytania blokujące

- Brak.

#### Pytania nieblokujące

- **WP2-Q1 [NON-BLOCKING]** Czy testy mają być funkcjonalne czy integracyjne?
  - Wpływ: Wpływa na sposób weryfikacji pakietu.
  - Wymagana decyzja: Wybrać preferowany typ testu.
  - Status: `open`

### WP3 — Flash alerty i live state

**Status:** `pending`<br>
**Dostępne decyzje:** `accept` / `revise` / `exclude` / `separate`

#### Pytania blokujące

- Brak.

#### Pytania nieblokujące

- Brak.
