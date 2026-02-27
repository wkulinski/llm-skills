# QUALITY-PROCEDURES

## Zasada ogólna
Kroki poniżej wykonuj zawsze w odpowiednim momencie.
Jeśli krok odwołuje się do skilla (`$...`), to skill jest źródłem prawdy dla procedury operacyjnej.

## 1. Przed rozpoczęciem pracy
1. Przeczytaj prompt i ustal kryteria akceptacji.
2. Sprawdź źródła reguł wymagane do implementacji:
   - `./runtime-collaboration-guidelines.md`
   - `./php-symfony-postgres-standards.md`
   - jeśli `CQRS_MONOLITH_STANDARD_OVERRIDES=1`: `./cqrs-monolith-standard-overrides.md`
3. Zweryfikuj entrypointy narzędzi projektu **wyłącznie** przez helper `.agents/skills/_shared/scripts/env-load.sh`:
   - wyznacz komendy przez `resolve_tool_cmd` (np. `composer`, `console`, `yarn`, `codecept`),
   - nie wyprowadzaj ścieżek ręcznie z `BIN_PATH` i nie stosuj dodatkowych heurystyk,
   - `resolve_tool_cmd` ładuje `.env`/`.env.local` automatycznie.
   - wyjątek: `$qa-run` w trybie macierzy JSON uruchamia komendy 1:1 z `.agents/qa-run.matrix.json` (bez discovery entrypointów).
4. Jeśli pracujesz jako agent LLM lub użytkownik prosi o odświeżenie kontekstu, uruchom `$context-refresh`.

## 2. Po utworzeniu nowego pliku
1. Podejrzyj zawartość pliku i sprawdź, czy powstał poprawnie.
2. Sprawdź `git status`, aby potwierdzić pojawienie się zmiany.
3. Dla nowych plików PHP uruchom `<COMPOSER_CMD> dump-autoload --no-scripts`, gdzie `<COMPOSER_CMD>` pochodzi z preflightu opartego o `resolve_tool_cmd`.

## 3. W trakcie implementacji
1. Implementuj zgodnie z `./runtime-collaboration-guidelines.md` oraz aktywnym baseline/override.
2. Utrzymuj zasadę evidence-based: decyzje i raportowanie opieraj na realnych odczytach/komendach.
3. Nie rozszerzaj zakresu bez decyzji użytkownika, zwłaszcza dla zmian high-risk.

## 4. Przed zakończeniem zadania
1. Jeśli to zadanie implementacyjne: zastosuj `$code-implement` jako orkiestrator.
2. Jeśli potrzebujesz szybkiej auto-weryfikacji: uruchom `$review-quick`.
3. Jeśli przygotowujesz commit: uruchom `$git-commit` (zawiera QA, worklog i commit flow).
4. Jeśli trzeba uporządkować dokumentację: uruchom `$docs-sync`.

## 5. Po commicie / finalna kontrola
1. Potwierdź wynik procedury (np. czysty `git status`) i jawnie zgłoś ewentualne celowo pozostawione zmiany.
2. W podsumowaniu wskaż wykonane kroki jakości oraz ograniczenia/ryzyka.

## 6. Zasada skills-first
- Procedury QA/commit/worklog/review utrzymuj w skillach, nie w dokumentach projektu.
- Jeśli znajdziesz rozbieżność: popraw odpowiedni skill, a nie dubluj kroków w wielu miejscach.
