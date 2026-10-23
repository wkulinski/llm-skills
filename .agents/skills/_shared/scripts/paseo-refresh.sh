#!/usr/bin/env bash
set -euo pipefail

HARD=0
case "${1:-}" in
  "") ;;
  --hard) HARD=1 ;;
  -h|--help)
    cat <<'HELP'
Usage: paseo-refresh [--hard]

Default:
  1. Refresh the OpenCode and Claude provider catalogs in Paseo
     (Claude: re-detects the Claude Code version and models from
     ~/.claude/settings.json)
  2. Reload Paseo agents except closed sessions (which are kept, not deleted)

Requires: paseo and node in PATH (Node.js parses the agent list).

Note: Paseo's built-in Claude model list ships with Paseo itself;
models newer than the installed Paseo release require a Paseo upgrade.

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

wait_for_daemon_ready() {
  local timeout="${1:-30}" deadline
  deadline=$((SECONDS + timeout))
  while (( SECONDS < deadline )); do
    if paseo daemon status --no-color 2>/dev/null | grep -q '^connectedDaemon: reachable$'; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

command -v paseo >/dev/null 2>&1 || {
  fail "paseo not found in PATH"
  exit 1
}
command -v node >/dev/null 2>&1 || {
  fail "node not found in PATH (required to parse the Paseo agent list)"
  exit 1
}

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

if (( HARD )); then
  ready_timeout="${PASEO_READY_TIMEOUT:-30}"
  step "Waiting for Paseo daemon readiness"
  if wait_for_daemon_ready "$ready_timeout"; then
    ok "Paseo daemon reachable"
  else
    fail "Paseo daemon did not become reachable within ${ready_timeout}s"
    exit 1
  fi
fi

refresh_provider() {
  local provider="$1" label="$2"
  step "Refreshing $label provider"
  if paseo provider diagnostic "$provider" >/dev/null; then
    ok "$label provider refreshed"
  else
    fail "$label provider diagnostic failed"
    exit 1
  fi
}

refresh_provider opencode OpenCode
refresh_provider claude Claude

step "Reloading Paseo agents (excluding closed sessions)"
if ! agent_output="$(paseo ls -g --json)"; then
  fail "Could not list Paseo agents"
  exit 1
fi

if ! agent_rows="$(printf '%s\n' "$agent_output" | node -e '
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      const agents = JSON.parse(input);
      if (!Array.isArray(agents) || agents.some(agent =>
        !agent || typeof agent.id !== "string" || !agent.id.trim() || /\s/.test(agent.id) ||
        typeof agent.status !== "string" || !agent.status.trim() || /\s/.test(agent.status)
      )) throw new Error("Expected an array of agents with non-empty id and status strings");
      for (const agent of agents) console.log(`${agent.id}\t${agent.status}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
')"; then
  fail "Could not parse Paseo agent list"
  exit 1
fi

if [[ -z "$agent_rows" ]]; then
  warn "No Paseo agents found; nothing to reload"
  exit 0
fi

failed=0
total=0
skipped=0
while IFS=$'\t' read -r id status; do
  if [[ "$status" == "closed" ]]; then
    printf '  Skipping %s (closed)\n' "$id"
    skipped=$((skipped + 1))
    continue
  fi
  total=$((total + 1))
  printf '  Reloading %s... ' "$id"
  if paseo agent reload "$id" >/dev/null; then
    printf 'OK\n'
  else
    printf 'FAILED\n'
    failed=$((failed + 1))
  fi
done <<< "$agent_rows"

printf '\n'
if (( failed == 0 )); then
  ok "Refresh complete ($total agent(s) reloaded); $skipped closed agent(s) skipped"
else
  warn "Refresh finished with $failed failed reload(s) out of $total; $skipped closed agent(s) skipped"
  exit 1
fi
