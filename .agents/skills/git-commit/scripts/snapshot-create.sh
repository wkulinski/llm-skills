#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

pointer_file="/tmp/agent-git-commit-snapshot-pointer.txt"

force_new=0
if [ "${1:-}" = "--new" ] || [ "${1:-}" = "--force-new" ]; then
  force_new=1
fi

read_pointer() {
  if [ ! -f "$pointer_file" ]; then
    return 1
  fi

  local p_repo_root
  local p_snapshot_dir

  p_repo_root="$(rg '^repo_root=' "$pointer_file" | head -n 1 | sed 's/^repo_root=//')"
  p_snapshot_dir="$(rg '^snapshot_dir=' "$pointer_file" | head -n 1 | sed 's/^snapshot_dir=//')"

  if [ -z "$p_repo_root" ] || [ -z "$p_snapshot_dir" ]; then
    return 1
  fi

  if [ "$p_repo_root" != "$repo_root" ]; then
    return 1
  fi

  if [ ! -d "$p_snapshot_dir" ]; then
    return 1
  fi

  printf '%s\n' "$p_snapshot_dir"
  return 0
}

if [ "$force_new" -eq 0 ]; then
  if existing_snapshot_dir="$(read_pointer)"; then
    printf '%s\n' "$existing_snapshot_dir"
    exit 0
  fi
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
rand="$(openssl rand -hex 8)"
snapshot_dir="/tmp/agent-git-commit-snapshot-${timestamp}-${rand}"

mkdir -p "$snapshot_dir/files"

git status -sb >"$snapshot_dir/git-status-sb.txt"
base_head="$(git rev-parse HEAD)"
printf '%s\n' "$base_head" >"$snapshot_dir/base-head.txt"

git diff --name-only >"$snapshot_dir/changed-tracked.txt"
git ls-files --others --exclude-standard >"$snapshot_dir/untracked.txt"

cat "$snapshot_dir/changed-tracked.txt" "$snapshot_dir/untracked.txt" | sed '/^$/d' | sort -u >"$snapshot_dir/files-to-copy.txt"

while IFS= read -r path; do
  [ -n "$path" ] || continue

  if [ -e "$path" ]; then
    cp -a --parents -- "$path" "$snapshot_dir/files/"
  else
    printf '%s\n' "$path" >>"$snapshot_dir/missing-at-snapshot.txt"
  fi
done <"$snapshot_dir/files-to-copy.txt"

printf '%s\n' "$snapshot_dir" >"$snapshot_dir/SNAPSHOT_PATH.txt"

cat >"$pointer_file" <<EOF
repo_root=$repo_root
snapshot_dir=$snapshot_dir
created_at=$(date +%Y-%m-%dT%H:%M:%S%z)
EOF

printf '%s\n' "$snapshot_dir"
