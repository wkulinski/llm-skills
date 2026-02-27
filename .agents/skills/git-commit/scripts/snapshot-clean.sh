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

case "$snapshot_dir" in
  /tmp/agent-git-commit-snapshot-*) ;;
  *)
    echo "Refusing to delete non-snapshot path: $snapshot_dir" >&2
    exit 2
    ;;
esac

if [ ! -d "$snapshot_dir" ]; then
  echo "$snapshot_dir (missing; nothing to delete)"
  if [ -f "$pointer_file" ]; then
    rm -f -- "$pointer_file"
    echo "$pointer_file (deleted)"
  fi
  exit 0
fi

rm -rf -- "$snapshot_dir"
echo "$snapshot_dir (deleted)"

if [ -f "$pointer_file" ]; then
  rm -f -- "$pointer_file"
  echo "$pointer_file (deleted)"
fi
