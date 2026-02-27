#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. "$repo_root/.agents/skills/_shared/scripts/env-load.sh"
load_repo_env "$repo_root"

status=""
field_name="Status"
issue_number=""
owner=""
repo=""
project_number=""

usage() {
    echo "Użycie: $0 --status <nazwa> [--field <nazwa>] [--issue <numer>] [--owner <właściciel>] [--repo <repo>] [--project-number <numer>]" >&2
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --status)
            status="$2"
            shift 2
            ;;
        --field)
            field_name="$2"
            shift 2
            ;;
        --issue)
            issue_number="$2"
            shift 2
            ;;
        --owner)
            owner="$2"
            shift 2
            ;;
        --repo)
            repo="$2"
            shift 2
            ;;
        --project-number)
            project_number="$2"
            shift 2
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "Nieznany argument: $1" >&2
            usage
            exit 2
            ;;
    esac
done

if [ -z "$status" ]; then
    echo "Status jest wymagany. Podaj --status \"<Status>\"." >&2
    exit 8
fi

repo_full=""
if [ -z "$owner" ] || [ -z "$repo" ]; then
    repo_full="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
    owner="${repo_full%%/*}"
    repo="${repo_full##*/}"
fi

find_issue_from_branch() {
    local branch="$1"
    if [[ "$branch" =~ issue/([0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    elif [[ "$branch" =~ issue-([0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

find_issue_from_subject() {
    local subject="$1"
    if [[ "$subject" =~ \#([0-9]+) ]]; then
        echo "${BASH_REMATCH[1]}"
        return 0
    fi
    return 1
}

extract_subject_keywords() {
    local subject="$1"
    local cleaned

    cleaned="${subject#*:}"
    cleaned="${cleaned//\[/ }"
    cleaned="${cleaned//\]/ }"
    cleaned="${cleaned//[$'\t\n\r']/ }"
    cleaned="${cleaned//  / }"
    cleaned="${cleaned# }"
    cleaned="${cleaned% }"

    printf '%s' "$cleaned" | awk '{for (i=1; i<=NF && i<=7; i++) printf "%s%s", $i, (i<NF && i<7 ? " " : "");}'
}

search_issue_by_title() {
    local keywords="$1"
    if [ -z "$keywords" ]; then
        return 1
    fi

    local result
    result="$(gh search issues "repo:${owner}/${repo} is:issue is:open in:title ${keywords}" --json number,title -q '.[] | "\(.number)\t\(.title)"' || true)"

    if [ -z "$result" ]; then
        return 1
    fi

    local count
    count="$(printf '%s\n' "$result" | wc -l | tr -d ' ')"
    if [ "$count" -eq 1 ]; then
        printf '%s\n' "$result" | awk -F '\t' 'NR==1 {print $1}'
        return 0
    fi

    echo "Wiele issue pasuje do słów kluczowych w tytule:" >&2
    printf '%s\n' "$result" | awk -F '\t' '{printf "- #%s %s\n", $1, $2}' >&2
    return 2
}

if [ -z "$issue_number" ]; then
    branch="$(git rev-parse --abbrev-ref HEAD)"
    issue_number="$(find_issue_from_branch "$branch" || true)"
fi

if [ -z "$issue_number" ]; then
    subject="$(git log -1 --pretty=%s)"
    issue_number="$(find_issue_from_subject "$subject" || true)"
fi

if [ -z "$issue_number" ]; then
    subject="$(git log -1 --pretty=%s)"
    keywords="$(extract_subject_keywords "$subject")"
    issue_number="$(search_issue_by_title "$keywords" || true)"
fi

if [ -z "$issue_number" ]; then
    echo "Nie można ustalić numeru issue. Podaj --issue lub użyj nazwy brancha issue/<ID>-*." >&2
    exit 3
fi

items_raw="$(gh api graphql -F owner="$owner" -F repo="$repo" -F number="$issue_number" -f query="query(\$owner:String!, \$repo:String!, \$number:Int!) { repository(owner:\$owner, name:\$repo) { issue(number:\$number) { projectItems(first: 20) { nodes { id project { id title number } } } } } }" --jq '.data.repository.issue.projectItems.nodes[] | "\(.id)\t\(.project.title)\t\(.project.number)"' || true)"

add_item_to_project() {
    local proj_num="$1"
    local issue_url="https://github.com/${owner}/${repo}/issues/${issue_number}"

    gh project item-add "$proj_num" --owner "$owner" --url "$issue_url" --format json -q '.id' 2>/dev/null || true
}

item_id=""
if [ -z "$items_raw" ]; then
    if [ -z "$project_number" ]; then
        echo "Issue #$issue_number nie jest w żadnym ProjectV2. Podaj --project-number, aby je dodać." >&2
        exit 4
    fi

    item_id="$(add_item_to_project "$project_number")"
    if [ -z "$item_id" ]; then
        echo "Nie udało się dodać issue #$issue_number do projektu o numerze $project_number." >&2
        exit 6
    fi
else
    if [ -z "$project_number" ]; then
        line_count="$(printf '%s\n' "$items_raw" | wc -l | tr -d ' ')"
        if [ "$line_count" -gt 1 ]; then
            echo "Issue #$issue_number znajduje się w wielu projektach:" >&2
            printf '%s\n' "$items_raw" | awk -F '\t' '{printf "- %s (numer %s) element=%s\n", $2, $3, $1}' >&2
            echo "Podaj --project-number, aby wybrać." >&2
            exit 5
        fi
        project_number="$(printf '%s\n' "$items_raw" | awk -F '\t' 'NR==1 {print $3}')"
    fi

    item_id="$(printf '%s\n' "$items_raw" | awk -F '\t' -v num="$project_number" '$3==num {print $1}' | head -n 1)"
    if [ -z "$item_id" ]; then
        item_id="$(add_item_to_project "$project_number")"
        if [ -z "$item_id" ]; then
            echo "Issue #$issue_number nie należy do projektu o numerze $project_number i nie udało się go dodać." >&2
            exit 6
        fi
    fi
fi

project_ref="${owner}/${project_number}"

item_edit_help="$(gh project item-edit --help 2>/dev/null || true)"
use_id_flags=false
if printf '%s' "$item_edit_help" | grep -q -- '--project-id'; then
    use_id_flags=true
fi

if [ "$use_id_flags" = true ]; then
    owner_type="$(gh api "users/$owner" --jq '.type' 2>/dev/null || true)"
    if [ "$owner_type" = "Organization" ]; then
        project_query="query(\$owner:String!, \$number:Int!) { organization(login:\$owner) { projectV2(number:\$number) { id fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2Field { id name } } } } } }"
    elif [ "$owner_type" = "User" ]; then
        project_query="query(\$owner:String!, \$number:Int!) { user(login:\$owner) { projectV2(number:\$number) { id fields(first: 100) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } ... on ProjectV2Field { id name } } } } } }"
    else
        echo "Nie udało się ustalić typu właściciela dla '$owner'." >&2
        exit 7
    fi

    jq_escape() {
        printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
    }

    field_name_escaped="$(jq_escape "$field_name")"
    status_escaped="$(jq_escape "$status")"

    project_id="$(gh api graphql -F owner="$owner" -F number="$project_number" -f query="$project_query" --jq '.data.organization.projectV2.id // .data.user.projectV2.id // empty' 2>/dev/null || true)"
    field_id="$(gh api graphql -F owner="$owner" -F number="$project_number" -f query="$project_query" --jq "((.data.organization.projectV2.fields.nodes // .data.user.projectV2.fields.nodes // []) | map(select(.name==\"${field_name_escaped}\")) | .[0].id) // empty" 2>/dev/null || true)"
    option_id="$(gh api graphql -F owner="$owner" -F number="$project_number" -f query="$project_query" --jq "((.data.organization.projectV2.fields.nodes // .data.user.projectV2.fields.nodes // []) | map(select(.name==\"${field_name_escaped}\")) | .[0].options // [] | map(select(.name==\"${status_escaped}\")) | .[0].id) // empty" 2>/dev/null || true)"

    if [ -z "$project_id" ] || [ -z "$field_id" ] || [ -z "$option_id" ]; then
        echo "Nie udało się ustalić ID projektu/pola/statusu dla '$field_name' -> '$status' w projekcie $project_ref." >&2
        echo "Sprawdź pola: gh project field-list $project_ref" >&2
        exit 7
    fi

    if ! gh project item-edit --project-id "$project_id" --id "$item_id" --field-id "$field_id" --single-select-option-id "$option_id" >/dev/null; then
        echo "Nie udało się ustawić statusu '$status' używając pola '$field_name' w projekcie $project_ref." >&2
        echo "Sprawdź pola: gh project field-list $project_ref" >&2
        exit 7
    fi
else
    if ! gh project item-edit --project "$project_ref" --id "$item_id" --field "$field_name" --single-select-option "$status" >/dev/null; then
        echo "Nie udało się ustawić statusu '$status' używając pola '$field_name' w projekcie $project_ref." >&2
        echo "Sprawdź pola: gh project field-list $project_ref" >&2
        exit 7
    fi
fi

echo "Status '$status' ustawiony dla issue #$issue_number w projekcie $project_ref (element $item_id)."
