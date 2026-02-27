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
state_file="${cache_root}/code-implement/state.md"

if [ ! -f "${state_file}" ]; then
  echo "ERROR: missing state file: ${state_file}" >&2
  exit 1
fi

if [ "$#" -eq 0 ]; then
  echo "ERROR: missing log message" >&2
  exit 1
fi

timestamp="$(date --iso-8601=seconds)"
message="$*"
log_line="- [${timestamp}] ${message}"

if ! grep -q '^### Dziennik odczytów' "${state_file}"; then
  {
    printf '\n### Dziennik odczytów\n'
    printf '%s\n' "${log_line}"
  } >> "${state_file}"
  exit 0
fi

tmp_file="$(mktemp)"

awk -v log_line="${log_line}" '
  BEGIN { in_log=0; inserted=0 }
  /^### Dziennik odczytów/ { in_log=1; print; next }
  /^### / && in_log && inserted == 0 {
    print log_line
    inserted=1
    in_log=0
  }
  { print }
  END {
    if (in_log && inserted == 0) {
      print log_line
    }
  }
' "${state_file}" > "${tmp_file}"

mv "${tmp_file}" "${state_file}"
