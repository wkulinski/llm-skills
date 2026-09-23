#!/usr/bin/env bash
set -euo pipefail

readonly EXIT_OK=0
readonly EXIT_CLI_MISSING=2
readonly EXIT_BROWSER_LAUNCH=3
readonly EXIT_BROWSER_CLEANUP=4

usage() {
    cat <<'EOF'
Usage: playwright-preflight.sh [-h|--help]

Runs the shared Playwright CLI preflight for browser verification. Resolves
playwright-cli through _shared/scripts/env-load.sh (resolve_tool_cmd), opens
about:blank in local Chromium, or attaches through CDP when
PLAYWRIGHT_MCP_CDP_ENDPOINT is set, and always cleans up the session.

Output:
  CLI: OK|MISSING|INVALID
  Browser mode: local-chromium|cdp-attach
  Browser launch: OK|FAIL
  Browser cleanup: OK|FAIL|NOT_REQUIRED

Exit codes:
  0  CLI help, browser launch/attach, and cleanup succeeded
  2  playwright-cli is missing or its --help validation failed
  3  CLI help passed, but browser launch/attach failed
  4  CLI help and browser launch/attach passed, but cleanup failed
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit "$EXIT_OK"
fi

script_path="${BASH_SOURCE[0]}"
script_dir="${script_path%/*}"
if [[ "$script_dir" == "$script_path" ]]; then
    script_dir="."
fi
script_dir="$(cd "$script_dir" && pwd)"
skills_root="$(cd "${script_dir}/../.." && pwd)"

# shellcheck source=/dev/null
. "${skills_root}/_shared/scripts/env-load.sh"

if ! cli_cmd="$(resolve_tool_cmd playwright-cli playwright-cli)"; then
    printf 'CLI: MISSING\n'
    printf 'Browser cleanup: NOT_REQUIRED\n'
    exit "$EXIT_CLI_MISSING"
fi

if ! "$cli_cmd" --help >/dev/null 2>&1; then
    printf 'CLI: INVALID\n'
    printf 'Browser cleanup: NOT_REQUIRED\n'
    exit "$EXIT_CLI_MISSING"
fi

mode="local-chromium"
if [[ -n "${PLAYWRIGHT_MCP_CDP_ENDPOINT:-}" ]]; then
    mode="cdp-attach"
fi

session="playwright-preflight-$$-${RANDOM}"
cleanup_done=0
cleanup_status=1

cleanup() {
    if [[ "$cleanup_done" -eq 1 ]]; then
        return 0
    fi
    cleanup_done=1

    local cleanup_rc=0
    if [[ "$mode" == "cdp-attach" ]]; then
        if ! "$cli_cmd" -s="$session" detach >/dev/null 2>&1; then
            cleanup_rc=1
        fi
    else
        if ! "$cli_cmd" -s="$session" close >/dev/null 2>&1; then
            cleanup_rc=1
        fi
    fi

    cleanup_status="$cleanup_rc"
    if [[ "$cleanup_status" -eq 0 ]]; then
        printf 'Browser cleanup: OK\n'
    else
        printf 'Browser cleanup: FAIL\n'
    fi

    return 0
}

trap cleanup EXIT

printf 'CLI: OK\n'
printf 'Browser mode: %s\n' "$mode"

if [[ "$mode" == "cdp-attach" ]]; then
    if "$cli_cmd" -s="$session" attach --cdp="$PLAYWRIGHT_MCP_CDP_ENDPOINT" >/dev/null 2>&1; then
        printf 'Browser launch: OK\n'
        launch_status="$EXIT_OK"
    else
        printf 'Browser launch: FAIL\n'
        launch_status="$EXIT_BROWSER_LAUNCH"
    fi
else
    if "$cli_cmd" -s="$session" open about:blank --browser=chromium >/dev/null 2>&1; then
        printf 'Browser launch: OK\n'
        launch_status="$EXIT_OK"
    else
        printf 'Browser launch: FAIL\n'
        launch_status="$EXIT_BROWSER_LAUNCH"
    fi
fi

cleanup
trap - EXIT

if [[ "$launch_status" -eq "$EXIT_BROWSER_LAUNCH" ]]; then
    exit "$EXIT_BROWSER_LAUNCH"
fi

if [[ "$cleanup_status" -ne 0 ]]; then
    exit "$EXIT_BROWSER_CLEANUP"
fi

exit "$EXIT_OK"
