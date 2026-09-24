#!/usr/bin/env bash
set -uo pipefail

HARD=0
case "${1:-}" in
  "") ;;
  --hard) HARD=1 ;;
  -h|--help)
    cat <<'HELP'
Usage: paseo-refresh [--hard]

Default:
  1. Sync skills/agents/profiles with LSM
  2. Refresh the OpenCode provider in Paseo
  3. Reload all Paseo agents

--hard:
  Additionally clear the CommandCode/OpenCode provider cache and restart
  the Paseo daemon before refreshing/reloading agents.
HELP
    exit 0
    ;;
  *)
    echo "Unknown option: $1" >&2
    echo "Use --help for usage." >&2
    exit 2
    ;;
esac

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32mOK:\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; }

command -v paseo >/dev/null 2>&1 || {
  fail "paseo not found in PATH"
  exit 1
}
command -v npx >/dev/null 2>&1 || {
  fail "npx not found in PATH"
  exit 1
}

step "Syncing skills / agents / profiles"
if npx lsm sync; then
  ok "LSM sync complete"
else
  fail "npx lsm sync failed"
  exit 1
fi

if (( HARD )); then
  step "Hard refresh: clearing CommandCode/OpenCode provider cache"
  rm -rf "$HOME/.cache/opencode/packages"/opencode-cmd-provider* 2>/dev/null || true
  ok "Provider cache cleared"

  step "Hard refresh: restarting Paseo daemon"
  if systemctl --user is-active --quiet paseo 2>/dev/null; then
    if systemctl --user restart paseo; then
      ok "Paseo restarted via systemd --user"
    else
      fail "Could not restart Paseo via systemd --user"
      exit 1
    fi
  else
    if paseo daemon restart; then
      ok "Paseo daemon restarted"
    else
      fail "Could not restart Paseo daemon"
      exit 1
    fi
  fi
fi

step "Refreshing OpenCode provider"
if paseo provider diagnostic opencode >/dev/null; then
  ok "OpenCode provider refreshed"
else
  fail "OpenCode provider diagnostic failed"
  exit 1
fi

step "Reloading all Paseo agents"
if ! agent_output="$(paseo ls -g -q 2>/dev/null)"; then
  fail "Could not list Paseo agents"
  exit 1
fi

mapfile -t AGENTS < <(printf '%s\n' "$agent_output" | sed '/^[[:space:]]*$/d')

if ((${#AGENTS[@]} == 0)); then
  warn "No Paseo agents found; nothing to reload"
  exit 0
fi

failed=0
for id in "${AGENTS[@]}"; do
  printf '  Reloading %s... ' "$id"
  if paseo agent reload "$id" >/dev/null; then
    printf 'OK\n'
  else
    printf 'FAILED\n'
    failed=$((failed + 1))
  fi
done

printf '\n'
if (( failed == 0 )); then
  ok "Refresh complete (${#AGENTS[@]} agent(s) reloaded)"
else
  warn "Refresh finished with $failed failed reload(s) out of ${#AGENTS[@]}"
  exit 1
fi
