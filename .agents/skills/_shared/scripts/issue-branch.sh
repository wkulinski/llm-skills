#!/usr/bin/env bash
set -euo pipefail

issue_branch_slugify() {
  local input="${1:-}"
  local ascii

  if command -v iconv >/dev/null 2>&1; then
    ascii="$(printf '%s' "$input" | iconv -f UTF-8 -t ASCII//TRANSLIT//IGNORE 2>/dev/null || true)"
  else
    ascii="$input"
  fi

  ascii="$(printf '%s' "$ascii" | LC_ALL=C tr -cd '[:alnum:] -')"
  ascii="$(printf '%s' "$ascii" | tr '[:upper:]' '[:lower:]')"
  ascii="$(printf '%s' "$ascii" | tr ' ' '-' | tr -s '-')"
  ascii="$(printf '%s' "$ascii" | sed -E 's/[^a-z0-9-]+//g; s/^-+//; s/-+$//')"

  printf '%s' "$ascii"
}

issue_branch_make() {
    local issue_number="${1:-}"
    local title="${2:-}"
    local slug

    if [ -z "$issue_number" ]; then
        return 2
    fi

    slug="$(issue_branch_slugify "$title")"
    if [ -z "$slug" ]; then
        slug="issue"
    fi

    printf 'issue/%s-%s\n' "$issue_number" "$slug"
}

issue_branch_parse() {
    local branch="${1:-}"

    if [ -z "$branch" ]; then
        branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
    fi

    branch="${branch#refs/heads/}"

    if [[ "$branch" =~ ^issue/([0-9]+)(-|$) ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi

    if [[ "$branch" =~ ^issue-([0-9]+)(-|$) ]]; then
        printf '%s\n' "${BASH_REMATCH[1]}"
        return 0
    fi

    return 1
}

usage() {
    cat >&2 <<'EOF'
Usage:
  issue-branch.sh make --issue <number> [--title <title>]
  issue-branch.sh parse [--branch <branch>]
EOF
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
    command="${1:-}"
    shift || true

    case "$command" in
        make)
            issue_number=""
            title=""
            while [ "$#" -gt 0 ]; do
                case "$1" in
                    --issue)
                        issue_number="$2"
                        shift 2
                        ;;
                    --title)
                        title="$2"
                        shift 2
                        ;;
                    -h | --help)
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

            if [ -z "$issue_number" ]; then
                echo "Missing --issue." >&2
                usage
                exit 2
            fi

            issue_branch_make "$issue_number" "$title"
            ;;
        parse)
            branch=""
            while [ "$#" -gt 0 ]; do
                case "$1" in
                    --branch)
                        branch="$2"
                        shift 2
                        ;;
                    -h | --help)
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

            issue_branch_parse "$branch"
            ;;
        -h | --help | "")
            usage
            exit 0
            ;;
        *)
            echo "Unknown command: $command" >&2
            usage
            exit 2
            ;;
    esac
fi
