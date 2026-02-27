#!/usr/bin/env bash
set -euo pipefail

threshold="${1:-15}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

tracked_file="$(mktemp)"
untracked_file="$(mktemp)"
cleanup() {
  rm -f "$tracked_file" "$untracked_file"
}
trap cleanup EXIT

git diff --name-only >"$tracked_file"
git ls-files --others --exclude-standard >"$untracked_file"

all_files="$(cat "$tracked_file" "$untracked_file" | sed '/^$/d' | sort -u)"
file_count="$(printf '%s\n' "$all_files" | sed '/^$/d' | wc -l | tr -d ' ')"

has_php=0
has_twig=0
has_js_ts=0
has_style=0
has_yaml=0
has_translations=0

critical_files=()

is_critical() {
  local path="$1"

  case "$path" in
    composer.json|composer.lock|package.json|yarn.lock|Makefile) return 0 ;;
    config/*|config/**) return 0 ;;
    .github/*|.github/**) return 0 ;;
    .docker/*|.docker/**) return 0 ;;
    bin/*|bin/**) return 0 ;;
    migrations/*|migrations/**) return 0 ;;
    src/Migration/*|src/Migration/**) return 0 ;;
    src/*/Domain/*|src/*/Domain/**) return 0 ;;
    src/*/Infrastructure/*|src/*/Infrastructure/**) return 0 ;;
    src/*/UI/Controller/*|src/*/UI/Controller/**) return 0 ;;
    src/*/UI/Command/*|src/*/UI/Command/**) return 0 ;;
    src/*/Api/*|src/*/Api/**) return 0 ;;
    config/routes*|config/routes/*|config/routes/**) return 0 ;;
    config/packages/security.yaml|config/packages/security/*|config/packages/security/**) return 0 ;;
  esac

  return 1
}

while IFS= read -r path; do
  [ -n "$path" ] || continue

  case "$path" in
    *.php) has_php=1 ;;
    *.twig) has_twig=1 ;;
    *.js|*.jsx|*.ts|*.tsx) has_js_ts=1 ;;
    *.css|*.scss) has_style=1 ;;
    *.yml|*.yaml) has_yaml=1 ;;
  esac

  case "$path" in
    translations/*|translations/**|src/*/UI/Translation/*|src/*/UI/Translation/**) has_translations=1 ;;
  esac

  if is_critical "$path"; then
    critical_files+=("$path")
  fi
done <<<"$all_files"

review_required=0
if [ "$has_php" -eq 1 ] || [ "$has_twig" -eq 1 ] || [ "$has_js_ts" -eq 1 ] || [ "$has_style" -eq 1 ] || [ "$has_yaml" -eq 1 ] || [ "$has_translations" -eq 1 ]; then
  review_required=1
fi

is_large_change=0
if [ "$file_count" -ge "$threshold" ]; then
  is_large_change=1
fi

printf 'Changed files (tracked): %s\n' "$(wc -l <"$tracked_file" | tr -d ' ')"
printf 'Untracked files: %s\n' "$(wc -l <"$untracked_file" | tr -d ' ')"
printf 'Total unique (tracked+untracked): %s\n' "$file_count"
printf '\n'

printf 'Detected types:\n'
printf '  php=%s twig=%s js_ts=%s style=%s yaml=%s translations=%s\n' "$has_php" "$has_twig" "$has_js_ts" "$has_style" "$has_yaml" "$has_translations"
printf '\n'

printf 'Gates:\n'
printf '  review_required=%s\n' "$review_required"
printf '  large_change_threshold=%s\n' "$threshold"
printf '  is_large_change=%s\n' "$is_large_change"
printf '\n'

if [ "${#critical_files[@]}" -gt 0 ]; then
  printf 'Critical files touched (%s):\n' "${#critical_files[@]}"
  for f in "${critical_files[@]}"; do
    printf '  - %s\n' "$f"
  done
else
  printf 'Critical files touched: none\n'
fi

printf '\n'
printf 'All files:\n'
printf '%s\n' "$all_files" | sed 's/^/  - /'
