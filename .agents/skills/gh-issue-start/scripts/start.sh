#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. "$repo_root/.agents/skills/_shared/scripts/env-load.sh"
load_repo_env "$repo_root"

issue_number=""
title=""
description=""
owner=""
repo=""
base_ref=""

usage() {
  echo "Usage: $0 [--issue-number <number>] [--title <title>] [--desc <description>] [--owner <owner>] [--repo <repo>] [--base <ref>]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --issue-number)
      issue_number="$2"
      shift 2
      ;;
    --title)
      title="$2"
      shift 2
      ;;
    --desc)
      description="$2"
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
      base_ref="$2"
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

if [ -z "$base_ref" ]; then
  default_branch="$(gh repo view "${owner}/${repo}" --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null || true)"
  if [ -z "$default_branch" ]; then
    default_branch="main"
  fi
  base_ref="origin/${default_branch}"
fi

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

  echo "Multiple issues match title keywords:" >&2
  printf '%s\n' "$result" | awk -F '\t' '{printf "- #%s %s\n", $1, $2}' >&2
  return 2
}

slugify() {
  local input="$1"
  local ascii

  ascii="$(printf '%s' "$input" | LC_ALL=C tr -cd '[:alnum:] -')"
  ascii="$(printf '%s' "$ascii" | tr '[:upper:]' '[:lower:]')"
  ascii="$(printf '%s' "$ascii" | tr ' ' '-' | tr -s '-')"
  ascii="$(printf '%s' "$ascii" | sed -E 's/[^a-z0-9-]+//g; s/^-+//; s/-+$//')"

  printf '%s' "$ascii"
}

if [ -z "$issue_number" ] && { [ -n "$description" ] || [ -n "$title" ]; }; then
  search_input="$description"
  if [ -z "$search_input" ]; then
    search_input="$title"
  fi

  keywords="$(extract_subject_keywords "$search_input")"
  if issue_number="$(search_issue_by_title "$keywords")"; then
    :
  else
    search_exit=$?
    if [ "$search_exit" -eq 2 ]; then
      exit 21
    fi
  fi
fi

issue_title=""
if [ -n "$issue_number" ]; then
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
fi

if [ -z "$issue_number" ]; then
  if [ -z "$title" ]; then
    if [ -n "$description" ]; then
      title="$description"
    fi
  fi

  if [ -z "$title" ]; then
    echo "Cannot create issue: missing issue number and no title/description found. Provide --issue-number, --title, or --desc." >&2
    exit 10
  fi

  issue_number="$(gh issue create --title "$title" --body "" --json number -q .number)"
  if [ -z "$issue_number" ]; then
    echo "Failed to create issue." >&2
    exit 11
  fi
  issue_title="$title"
fi

slug="$(slugify "$issue_title")"
if [ -z "$slug" ]; then
  slug="issue"
fi

branch_name="issue/${issue_number}-${slug}"

remote="origin"
base_branch="$base_ref"
if [[ "$base_ref" == */* ]]; then
  remote="${base_ref%%/*}"
  base_branch="${base_ref#*/}"
else
  base_ref="${remote}/${base_ref}"
  base_branch="${base_ref#*/}"
fi

git fetch "$remote" "$base_branch" --quiet
if ! git show-ref --verify --quiet "refs/remotes/${base_ref}"; then
  echo "Missing base ref ${base_ref}." >&2
  exit 12
fi

if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
  git checkout "${branch_name}"
elif git show-ref --verify --quiet "refs/remotes/origin/${branch_name}"; then
  git checkout -b "${branch_name}" --track "origin/${branch_name}"
else
  git checkout -b "${branch_name}" "${base_ref}"
fi

current_user="$(gh api user -q .login)"
assignees="$(gh issue view "$issue_number" --json assignees -q '.assignees[].login' || true)"
if ! printf '%s\n' "$assignees" | grep -qx "$current_user"; then
  gh issue edit "$issue_number" --add-assignee "$current_user" >/dev/null
fi

echo "Issue #$issue_number ready on branch $branch_name."
