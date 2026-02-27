#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  snapshot-delta-show.sh --current <path> [--full]
  snapshot-delta-show.sh --current --all [--full]
  snapshot-delta-show.sh <snapshot_dir> <path> [--full]
  snapshot-delta-show.sh <snapshot_dir> --all [--full]

Shows diff "snapshot -> now" for a file or for all files listed in snapshot_dir/delta-all.txt.
EOF
}

snapshot_dir="${1:-}"
target="${2:-}"
full="${3:-}"
pointer_file="/tmp/agent-git-commit-snapshot-pointer.txt"

if [ "$snapshot_dir" = "--current" ]; then
  if [ ! -f "$pointer_file" ]; then
    echo "Missing snapshot pointer: $pointer_file" >&2
    exit 2
  fi
  snapshot_dir="$(rg '^snapshot_dir=' "$pointer_file" | head -n 1 | sed 's/^snapshot_dir=//')"
  target="${2:-}"
  full="${3:-}"
fi

if [ ! -d "$snapshot_dir" ]; then
  echo "Snapshot dir does not exist: $snapshot_dir" >&2
  exit 2
fi

if [ -z "$target" ]; then
  usage >&2
  exit 2
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

base_head="$(cat "$snapshot_dir/base-head.txt")"

hash_file() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$path" | awk '{print $1}'
    return 0
  fi
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$path" | awk '{print $1}'
    return 0
  fi
  openssl dgst -sha256 -- "$path" | awk '{print $2}'
}

is_binary_diff() {
  local from="$1"
  local to="$2"
  if git diff --no-index --numstat -- "$from" "$to" | rg -q '^\-\t\-\t'; then
    return 0
  fi
  return 1
}

print_meta() {
  local path="$1"
  local size
  size="$(wc -c <"$path" | tr -d ' ')"
  printf '  size: %s bytes\n' "$size"
  printf '  sha256: %s\n' "$(hash_file "$path")"
}

show_one() {
  local file_path="$1"
  local full_mode="$2"

  local snap_copy="$snapshot_dir/files/$file_path"
  local tmp_base
  tmp_base="$(mktemp)"
  trap 'rm -f -- "$tmp_base"' RETURN

  echo "File: $file_path"

  if [ -e "$snap_copy" ]; then
    # File was dirty at snapshot: compare to snapshot copy.
    if [ ! -e "$file_path" ]; then
      echo "  status: missing now (was present in snapshot)"
      echo "  snapshot metadata:"
      print_meta "$snap_copy"
      return 0
    fi

    if is_binary_diff "$snap_copy" "$file_path"; then
      echo "  status: binary/non-text diff (snapshot -> now)"
      echo "  snapshot metadata:"
      print_meta "$snap_copy"
      echo "  now metadata:"
      print_meta "$file_path"
      return 0
    fi

    if [ "$full_mode" = "--full" ]; then
      git diff --no-index -- "$snap_copy" "$file_path" || true
      return 0
    fi

    # For large/lock files, default to stat + short excerpt.
    if [ "$(wc -c <"$file_path" | tr -d ' ')" -gt 200000 ] || [[ "$file_path" =~ (composer\.lock|yarn\.lock)$ ]]; then
      git diff --no-index --stat -- "$snap_copy" "$file_path" || true
      echo "  (use --full for full diff)"
      return 0
    fi

    git diff --no-index -- "$snap_copy" "$file_path" || true
    return 0
  fi

  # File was clean at snapshot: compare to base HEAD if it existed.
  if git cat-file -e "$base_head:$file_path" 2>/dev/null; then
    git show "$base_head:$file_path" >"$tmp_base"

    if [ ! -e "$file_path" ]; then
      echo "  status: missing now (was present in base HEAD)"
      echo "  base HEAD metadata:"
      print_meta "$tmp_base"
      return 0
    fi

    if is_binary_diff "$tmp_base" "$file_path"; then
      echo "  status: binary/non-text diff (base HEAD -> now)"
      echo "  base HEAD metadata:"
      print_meta "$tmp_base"
      echo "  now metadata:"
      print_meta "$file_path"
      return 0
    fi

    if [ "$full_mode" = "--full" ]; then
      git diff --no-index -- "$tmp_base" "$file_path" || true
      return 0
    fi

    if [ "$(wc -c <"$file_path" | tr -d ' ')" -gt 200000 ] || [[ "$file_path" =~ (composer\.lock|yarn\.lock)$ ]]; then
      git diff --no-index --stat -- "$tmp_base" "$file_path" || true
      echo "  (use --full for full diff)"
      return 0
    fi

    git diff --no-index -- "$tmp_base" "$file_path" || true
    return 0
  fi

  # New file vs empty.
  if [ ! -e "$file_path" ]; then
    echo "  status: file does not exist now (and not in base HEAD or snapshot copy)"
    return 0
  fi

  if is_binary_diff /dev/null "$file_path"; then
    echo "  status: new binary file"
    echo "  now metadata:"
    print_meta "$file_path"
    return 0
  fi

  if [ "$full_mode" = "--full" ]; then
    git diff --no-index -- /dev/null "$file_path" || true
    return 0
  fi

  if [ "$(wc -c <"$file_path" | tr -d ' ')" -gt 200000 ] || [[ "$file_path" =~ (composer\.lock|yarn\.lock)$ ]]; then
    git diff --no-index --stat -- /dev/null "$file_path" || true
    echo "  (use --full for full diff)"
    return 0
  fi

  git diff --no-index -- /dev/null "$file_path" || true
}

if [ "$target" = "--all" ]; then
  if [ ! -f "$snapshot_dir/delta-all.txt" ]; then
    echo "Missing $snapshot_dir/delta-all.txt. Run snapshot-delta-list.sh first." >&2
    exit 2
  fi

  while IFS= read -r path; do
    [ -n "$path" ] || continue
    show_one "$path" "$full"
    echo
  done <"$snapshot_dir/delta-all.txt"
  exit 0
fi

show_one "$target" "$full"
