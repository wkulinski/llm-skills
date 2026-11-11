# Obsługa źródeł

Czytaj, gdy źródłem jest bieżąca rozmowa albo issue GitHub z pustym body.

Dla źródła z bieżącej konwersacji agent nie żąda od użytkownika pliku wejściowego.
Przekazuje JSON źródła przez stdin (heredoc, bez shellowego escapowania JSON) i
pozwala `source.mjs` utworzyć kanoniczny artefakt:

```bash
node <skill_dir>/scripts/source.mjs normalize-user --input - <<'CONVERSATION_JSON' \
  | node <skill_dir>/scripts/source.mjs persist --input - --root "$PWD"
{"title":"Conversation task","body":"Don't fail on apostrophes."}
CONVERSATION_JSON
```

Wynik `persist` dostarcza `source_identity`, `source_artifact` i
`source_sha256`, które należy zachować przy zapisie planu. Nie zapisuj ręcznie
tymczasowego `source.json` i nie pomijaj utrwalenia źródła tylko dlatego, że
wejściem była konwersacja.

GitHub issue może zawierać wyłącznie niepusty tytuł. Puste body nie blokuje wtedy
planowania: tytuł jest całym dostępnym materiałem źródłowym, a szczegóły
techniczne i kryteria pozostają jawnie niezweryfikowane, dopóki nie potwierdzi ich
repository-context albo użytkownik. Brak zarówno tytułu, jak i body jest błędem
źródła.
