#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. "$repo_root/.agents/skills/_shared/scripts/env-load.sh"
load_repo_env "$repo_root"

cd "$repo_root"

cache_root="${CACHE_PATH:-var/agent/cache}"
cache_root="${cache_root%/}"

if [ ! -d "$cache_root" ]; then
  mkdir -p "$cache_root"
  echo "$cache_root (created; nothing to clear)"
  exit 0
fi

find "$cache_root" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
echo "$cache_root (cleared)"
