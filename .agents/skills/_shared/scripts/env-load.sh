#!/usr/bin/env bash

# Shared helper for loading repository-level environment files.
# This file is the single source of truth for resolving tool entrypoints.
# Usage:
#   source "<repo>/.agents/skills/_shared/scripts/env-load.sh"
#   resolve_tool_cmd <tool_name> [fallback1 fallback2 ...]

__repo_env_loaded_root=""

load_repo_env() {
  local repo_root="${1:-}"
  local env_file=""
  local env_path=""
  local had_allexport=0

  if [ -z "$repo_root" ]; then
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  fi

  if [ -z "$repo_root" ] || [ ! -d "$repo_root" ]; then
    return 0
  fi

  for env_file in ".env" ".env.local"; do
    env_path="${repo_root}/${env_file}"
    if [ -f "$env_path" ]; then
      case "$-" in
        *a*) had_allexport=1 ;;
        *) had_allexport=0 ;;
      esac
      set -a
      # shellcheck disable=SC1090
      . "$env_path"
      if [ "$had_allexport" -eq 0 ]; then
        set +a
      fi
    fi
  done
}

ensure_repo_env_loaded() {
  local repo_root="${1:-}"

  if [ -z "$repo_root" ]; then
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  fi

  if [ -z "$repo_root" ] || [ ! -d "$repo_root" ]; then
    return 0
  fi

  if [ "${__repo_env_loaded_root:-}" = "$repo_root" ]; then
    return 0
  fi

  load_repo_env "$repo_root"
  __repo_env_loaded_root="$repo_root"
}

resolve_tool_cmd() {
  local tool_name="${1:-}"
  shift || true

  if [ -z "$tool_name" ]; then
    return 1
  fi

  local candidate=""
  local prefix=""

  ensure_repo_env_loaded

  if [ -n "${BIN_PATH:-}" ]; then
    prefix="${BIN_PATH%/}"
    if [ -n "$prefix" ]; then
      case "$prefix" in
        /*) candidate="${prefix}/${tool_name}" ;;
        *) candidate="./${prefix#./}/${tool_name}" ;;
      esac
      if [ -x "$candidate" ]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
  fi

  for candidate in "$@"; do
    [ -n "$candidate" ] || continue
    case "$candidate" in
      */*|.*)
        if [ -x "$candidate" ]; then
          printf '%s\n' "$candidate"
          return 0
        fi
        ;;
      *)
        if command -v "$candidate" >/dev/null 2>&1; then
          printf '%s\n' "$candidate"
          return 0
        fi
        ;;
    esac
  done

  if command -v "$tool_name" >/dev/null 2>&1; then
    printf '%s\n' "$tool_name"
    return 0
  fi

  return 1
}
