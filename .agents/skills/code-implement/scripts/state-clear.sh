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
state_path="${cache_root}/code-implement/state.md"

if [ ! -e "$state_path" ]; then
  echo "$state_path (missing; nothing to clear)"
  exit 0
fi

rm -f -- "$state_path"
echo "$state_path (cleared)"
