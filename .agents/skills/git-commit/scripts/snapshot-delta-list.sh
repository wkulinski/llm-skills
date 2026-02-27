#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--current | <snapshot_dir>]"
}

snapshot_dir="${1:-}"
pointer_file="/tmp/agent-git-commit-snapshot-pointer.txt"

if [ -z "$snapshot_dir" ] || [ "$snapshot_dir" = "--current" ]; then
  if [ ! -f "$pointer_file" ]; then
    echo "Missing snapshot pointer: $pointer_file" >&2
    usage >&2
    exit 2
  fi
  snapshot_dir="$(rg '^snapshot_dir=' "$pointer_file" | head -n 1 | sed 's/^snapshot_dir=//')"
fi

if [ ! -d "$snapshot_dir" ]; then
  echo "Snapshot dir does not exist: $snapshot_dir" >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

base_head="$(cat "$snapshot_dir/base-head.txt")"

git diff --name-only >"$snapshot_dir/now-changed-tracked.txt"
git ls-files --others --exclude-standard >"$snapshot_dir/now-untracked.txt"

cat "$snapshot_dir/now-changed-tracked.txt" "$snapshot_dir/now-untracked.txt" | sed '/^$/d' | sort -u >"$snapshot_dir/now-all.txt"
cat "$snapshot_dir/changed-tracked.txt" "$snapshot_dir/untracked.txt" | sed '/^$/d' | sort -u >"$snapshot_dir/snap-all.txt"

comm -13 "$snapshot_dir/snap-all.txt" "$snapshot_dir/now-all.txt" >"$snapshot_dir/delta-new-dirty.txt" || true

: >"$snapshot_dir/delta-content-changed.txt"
: >"$snapshot_dir/delta-missing-now.txt"

while IFS= read -r path; do
  [ -n "$path" ] || continue

  if [ ! -e "$path" ]; then
    printf '%s\n' "$path" >>"$snapshot_dir/delta-missing-now.txt"
    continue
  fi

snap_copy="$snapshot_dir/files/$path"
if [ -e "$snap_copy" ]; then
  if ! diff -q -- "$snap_copy" "$path" >/dev/null; then
    printf '%s\n' "$path" >>"$snapshot_dir/delta-content-changed.txt"
  fi
else
  # Safety: if we don't have the copy, treat it as changed.
  printf '%s\n' "$path" >>"$snapshot_dir/delta-content-changed.txt"
fi
done <"$snapshot_dir/snap-all.txt"

cat \
  "$snapshot_dir/delta-new-dirty.txt" \
  "$snapshot_dir/delta-content-changed.txt" \
  "$snapshot_dir/delta-missing-now.txt" \
  | sed '/^$/d' | sort -u >"$snapshot_dir/delta-all.txt"

if [ -s "$snapshot_dir/delta-all.txt" ]; then
  echo "DELTA_PRESENT"
  sed 's/^/- /' "$snapshot_dir/delta-all.txt"
  exit 1
fi

echo "DELTA_EMPTY"
exit 0
