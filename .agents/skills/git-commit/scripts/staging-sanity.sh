#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

staged="$(git diff --cached --name-only || true)"
if [ -z "$staged" ]; then
  echo "STAGING_EMPTY"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f -- "$tmp"' EXIT

printf '%s\n' "$staged" >"$tmp"

suspects="$(mktemp)"
trap 'rm -f -- "$tmp" "$suspects"' EXIT

rg -n \
  '(^\.env($|\.))|(^var/)|(^/var/)|(^node_modules/)|(^\.idea/)|(^\.vscode/)|(\.log$)|(\.cache$)' \
  "$tmp" \
  | cut -d: -f2- \
  | sed 's/^[0-9]*://' \
  | sed '/^$/d' \
  | sort -u >"$suspects" || true

if [ -s "$suspects" ]; then
  echo "STAGING_SUSPECTS_PRESENT"
  sed 's/^/- /' "$suspects"
  echo
  echo "Suggested (manual) unstage commands:"
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    echo "  git restore --staged -- \"$path\""
  done <"$suspects"
  exit 1
fi

echo "STAGING_OK"
exit 0

