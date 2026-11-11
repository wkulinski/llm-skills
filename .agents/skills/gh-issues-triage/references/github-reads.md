# Odczyt przez GitHub CLI

Ładuj, gdy dostępne narzędzia GitHub MCP nie pokrywają wymaganego odczytu i używasz `gh`.

Przykładowe odczyty CLI, po ustaleniu wartości parametrów:

```bash
gh api user --jq .login
gh repo view --json nameWithOwner,url
gh project field-list PROJECT_NUMBER --owner OWNER --format json
gh project item-list PROJECT_NUMBER --owner OWNER --limit PAGE_LIMIT --format json
gh issue list --repo OWNER/REPO --state open --limit PAGE_LIMIT --json number,title,state,body,labels,assignees,updatedAt,url
gh issue view ISSUE_NUMBER --repo OWNER/REPO --json number,title,state,body,comments,projectItems,url
```

W tych przykładach `PAGE_LIMIT` nie zastępuje kontroli liczby wszystkich rekordów i dalszej paginacji. Przy dużym zbiorze dobierz zbiorczy odczyt GraphQL zamiast wielu pojedynczych zapytań; sprawdzaj też błędy GraphQL.
