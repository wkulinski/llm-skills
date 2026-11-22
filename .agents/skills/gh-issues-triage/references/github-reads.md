# Odczyt przez GitHub CLI

Ładuj, gdy dostępne narzędzia GitHub MCP nie pokrywają wymaganego odczytu i używasz `gh`.

Przykładowe odczyty CLI, po ustaleniu wartości parametrów:

```bash
gh api user --jq .login
gh repo view --json nameWithOwner,url
gh project field-list PROJECT_NUMBER --owner OWNER --format json
gh project item-list PROJECT_NUMBER --owner OWNER --limit PAGE_LIMIT --format json
gh issue list --repo OWNER/REPO --state open --limit PAGE_LIMIT --json number,title,state,body,labels,assignees,milestone,updatedAt,url
gh issue view ISSUE_NUMBER --repo OWNER/REPO --json number,title,state,body,comments,projectItems,milestone,url
```

W tych przykładach `PAGE_LIMIT` nie zastępuje kontroli liczby wszystkich rekordów i dalszej paginacji. Przy dużym zbiorze dobierz zbiorczy odczyt GraphQL zamiast wielu pojedynczych zapytań; sprawdzaj też błędy GraphQL.

Powyższe komendy `gh issue` nie zwracają relacji blokowania ani sub-issues. Odczytaj je przez GraphQL (`gh api graphql`), np. z pól issue `blockedBy`, `blocking`, `parent` i `subIssues`, z paginacją każdej listy. Jeśli GraphQL jest niedostępny albo nie udostępnia tych pól, i tak ustal relacje z dostępnych źródeł: opisu i komentarzy issue, odnośników między issues oraz osi czasu (`gh api repos/OWNER/REPO/issues/ISSUE_NUMBER/timeline`). Oznacz wtedy, że relacje pochodzą z treści, a nie z formalnego odczytu, i nie deklaruj braku blokad, jeśli tych źródeł nie dało się sprawdzić.
