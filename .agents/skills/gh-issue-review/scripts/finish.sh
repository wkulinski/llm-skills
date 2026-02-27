#!/usr/bin/env bash
set -euo pipefail

reviewer=""
issue_number=""
owner=""
repo=""
base_branch=""
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. "$repo_root/.agents/skills/_shared/scripts/env-load.sh"
load_repo_env "$repo_root"

reviewers_file="${script_dir}/../default-reviewers.txt"
template_override=""
tmp_body=""
tmp_error=""
pr_url=""
pr_number=""
existing_pr_state=""

cleanup() {
  if [ -n "$tmp_body" ] && [ -f "$tmp_body" ]; then
    rm -f "$tmp_body"
  fi
  if [ -n "$tmp_error" ] && [ -f "$tmp_error" ]; then
    rm -f "$tmp_error"
  fi
}

trap cleanup EXIT

usage() {
  echo "Usage: $0 [--issue-number <number>] [--reviewer <login>] [--template <path>] [--owner <owner>] [--repo <repo>] [--base <branch>]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --issue-number)
      issue_number="$2"
      shift 2
      ;;
    --reviewer)
      reviewer="$2"
      shift 2
      ;;
    --template)
      template_override="$2"
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
    --base)
      base_branch="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

repo_full=""
if [ -z "$owner" ] || [ -z "$repo" ]; then
  repo_full="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
  owner="${repo_full%%/*}"
  repo="${repo_full##*/}"
fi

if [ -z "$base_branch" ]; then
  base_branch="$(gh repo view "${owner}/${repo}" --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)"
  if [ -z "$base_branch" ]; then
    base_branch="main"
  fi
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

humanize_branch_title() {
  local branch="$1"
  local short

  short="${branch##*/}"
  short="${short#issue-}"
  short="${short#issue/}"
  short="${short//-/ }"
  printf '%s' "$short" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//'
}

branch="$(git rev-parse --abbrev-ref HEAD)"
subject="$(git log -1 --pretty=%s 2>/dev/null || true)"

if [ -z "$issue_number" ]; then
  issue_number="$(find_issue_from_branch "$branch" || true)"
fi

if [ -z "$issue_number" ]; then
  issue_number="$(find_issue_from_subject "$subject" || true)"
fi

if [ -z "$issue_number" ]; then
  echo "Cannot determine issue number. Provide --issue-number or use branch name issue/<ID>-*." >&2
  exit 3
fi

issue_info="$(gh issue view "$issue_number" --json state,title -q '.state + "\t" + .title' 2>/dev/null || true)"
if [ -z "$issue_info" ]; then
  echo "Issue #$issue_number not found or inaccessible. Check if it was closed." >&2
  exit 13
fi

IFS=$'\t' read -r issue_state issue_title <<< "$issue_info"
if [ "$issue_state" != "OPEN" ]; then
  echo "Issue #$issue_number is not open. Check if it was closed." >&2
  exit 13
fi

current_user="$(gh api user -q .login)"

if [ -z "$reviewer" ]; then
  assignees="$(gh issue view "$issue_number" --json assignees -q '.assignees[].login' || true)"
  filtered="$(printf '%s\n' "$assignees" | grep -v -x "$current_user" || true)"
  count="$(printf '%s\n' "$filtered" | sed '/^$/d' | wc -l | tr -d ' ')"

  if [ "$count" -eq 1 ]; then
    reviewer="$(printf '%s\n' "$filtered" | head -n 1)"
  elif [ "$count" -gt 1 ]; then
    echo "Multiple assignees available for review:" >&2
    printf '%s\n' "$filtered" | sed 's/^/- /' >&2
    echo "Provide --reviewer to choose." >&2
    exit 21
  elif [ -f "$reviewers_file" ]; then
    reviewer="$(grep -v '^[[:space:]]*$' "$reviewers_file" | grep -v '^[[:space:]]*#' | head -n 1 || true)"
  fi

  if [ -z "$reviewer" ]; then
    echo "No reviewer selected. Provide --reviewer or add defaults in ${reviewers_file}." >&2
    exit 22
  fi
fi

base_ref="origin/${base_branch}"

git fetch origin "${base_branch}" --quiet
if ! git show-ref --verify --quiet "refs/remotes/${base_ref}"; then
  echo "Missing base ref ${base_ref}." >&2
  exit 12
fi

if ! git rebase "${base_ref}"; then
  echo "Rebase failed. Resolve conflicts, run 'git rebase --continue', then rerun this script." >&2
  exit 42
fi

git push origin HEAD --force

existing_pr_info="$(gh pr view --json state,number,url -q '.state + "\t" + (.number|tostring) + "\t" + .url' 2>/dev/null || true)"
if [ -n "$existing_pr_info" ]; then
  IFS=$'\t' read -r existing_pr_state pr_number pr_url <<< "$existing_pr_info"
  if [ "$existing_pr_state" != "OPEN" ]; then
    pr_url=""
    pr_number=""
  fi
fi

if [ -n "$pr_url" ] && [ -n "$reviewer" ]; then
  if ! gh pr edit "$pr_number" --add-reviewer "$reviewer" >/dev/null; then
    echo "Could not add reviewer '$reviewer' to PR #$pr_number. Continuing." >&2
  fi
fi

pr_title=""
if [ -z "$pr_url" ]; then
  if [ -n "$issue_title" ]; then
    pr_title="#${issue_number} ${issue_title}"
  else
    pr_title="$(humanize_branch_title "$branch")"
  fi

  template_path="$template_override"
  if [ -n "$template_path" ] && [ ! -f "$template_path" ]; then
    echo "Template not found: $template_path" >&2
    exit 32
  fi

  if [ -z "$template_path" ]; then
    if [ -f ".github/PULL_REQUEST_TEMPLATE.md" ]; then
      template_path=".github/PULL_REQUEST_TEMPLATE.md"
    elif [ -f ".github/pull_request_template.md" ]; then
      template_path=".github/pull_request_template.md"
    elif [ -d ".github/PULL_REQUEST_TEMPLATE" ]; then
      mapfile -t templates < <(find .github/PULL_REQUEST_TEMPLATE -maxdepth 1 -type f | sort)
      if [ "${#templates[@]}" -eq 1 ]; then
        template_path="${templates[0]}"
      elif [ "${#templates[@]}" -gt 1 ]; then
        echo "Multiple PR templates found:" >&2
        printf '%s\n' "${templates[@]}" | sed 's/^/- /' >&2
        echo "Provide --template with the chosen path." >&2
        exit 31
      fi
    fi
  fi

  body_file=""
  if [ -n "$template_path" ]; then
    body_file="$template_path"
  else
    tmp_body="$(mktemp)"
    goal_line=""
    if [ -n "$issue_title" ]; then
      goal_line="#${issue_number} ${issue_title}"
    else
      goal_line="$(humanize_branch_title "$branch")"
    fi

    changes="$(git log --oneline "${base_ref}..HEAD" | head -n 5 || true)"
    if [ -z "$changes" ]; then
      changes="- _No change details available._"
    else
      changes="$(printf '%s\n' "$changes" | sed 's/^/- /')"
    fi

    cat <<BODY > "$tmp_body"
## Goal
${goal_line:-_No goal provided._}

## Changes
${changes}

## QA
- _Not run._

## Checklist
- [ ] Docs updated
- [ ] Migrations
- [ ] New env vars
- [ ] Breaking changes
BODY

    body_file="$tmp_body"
  fi

  reviewer_flag=()
  if [ -n "$reviewer" ]; then
    reviewer_flag+=("--reviewer" "$reviewer")
  fi

  tmp_error="$(mktemp)"
  if pr_url="$(gh pr create --base "$base_branch" --head "$branch" --title "$pr_title" --body-file "$body_file" "${reviewer_flag[@]}" --json url -q .url 2> "$tmp_error")"; then
    :
  else
    pr_error="$(cat "$tmp_error")"
    if printf '%s' "$pr_error" | grep -qi "unknown flag: --json"; then
      pr_output="$(gh pr create --base "$base_branch" --head "$branch" --title "$pr_title" --body-file "$body_file" "${reviewer_flag[@]}" 2>&1)"
      pr_url="$(printf '%s\n' "$pr_output" | grep -Eo 'https://github.com/[^ ]+/pull/[0-9]+' | head -n 1 || true)"
    else
      printf '%s\n' "$pr_error" >&2
    fi
  fi

  if [ -z "$pr_url" ]; then
    echo "Failed to create PR." >&2
    exit 41
  fi
fi

if [ "$existing_pr_state" = "OPEN" ] && [ -n "$pr_url" ]; then
  echo "PR reused: $pr_url"
else
  echo "PR created: $pr_url"
fi
