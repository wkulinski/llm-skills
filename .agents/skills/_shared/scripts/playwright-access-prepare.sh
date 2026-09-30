#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: playwright-access-prepare.sh [--protected [--refresh]] [--url <url>] [--selector <css>]
       playwright-access-prepare.sh --finalize --session <name> [--url <url>] [--selector <css>]

Runs the Playwright CLI/browser preflight. With --protected it also reuses a
validated storage state or bootstraps a missing one using the loopback login
helper. No login credentials are passed in argv or printed. The agent still
opens a separate application session and loads the returned state before
navigating to the explicit application URL.

Protected preparation can return Access: ACTION_REQUIRED and Provisional state.
Finish non-secret login steps in an agent CLI session, then use --finalize.
Finalization verifies that session's saved state in a fresh browser context.
Output: Access: READY|ACTION_REQUIRED|BLOCKED. Credentials never appear in argv.
Exit codes: helper exit code on failure, 0 on READY or ACTION_REQUIRED.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

protected=0
refresh=0
finalize=0
finalize_args=()
common_args=()
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --protected) protected=1; shift ;;
        --refresh) refresh=1; shift ;;
        --finalize) finalize=1; shift ;;
        --session)
            [[ "$#" -ge 2 ]] || { usage >&2; exit 2; }
            finalize_args+=("$1" "$2"); shift 2 ;;
        --url|--selector)
            [[ "$#" -ge 2 && -n "$2" ]] || { usage >&2; exit 2; }
            common_args+=("$1" "$2"); shift 2 ;;
        *) usage >&2; exit 2 ;;
    esac
done
if [[ "$finalize" == 1 && ( "$protected" == 1 || "$refresh" == 1 ) ]] ||
    [[ "$finalize" == 0 && ( "${#finalize_args[@]}" -gt 0 || ( "$refresh" == 1 && "$protected" == 0 ) ) ]]; then
    usage >&2
    exit 2
fi

script_path="${BASH_SOURCE[0]}"
script_dir="${script_path%/*}"
if [[ "$script_dir" == "$script_path" ]]; then
    script_dir="."
fi
script_dir="$(cd "$script_dir" && pwd)"

if [[ "$finalize" == 1 ]]; then
    . "${script_dir}/env-load.sh"
    ensure_repo_env_loaded
    unset DEBUG PWDEBUG
    if ! cli_cmd="$(resolve_tool_cmd playwright-cli playwright-cli)" ||
        ! node_cmd="$(resolve_tool_cmd node node)"; then
        printf 'Authentication: FAIL\nReason: tooling-unavailable\nAccess: BLOCKED\n'
        exit 2
    fi
    if "$node_cmd" "${script_dir}/playwright-auth-finalize.mjs" --cli "$cli_cmd" "${finalize_args[@]}" "${common_args[@]}"; then
        exit 0
    else
        status=$?
        printf 'Access: BLOCKED\n'
        exit "$status"
    fi
fi

if bash "${script_dir}/playwright-preflight.sh"; then
    :
else
    status=$?
    printf 'Access: BLOCKED\n'
    exit "$status"
fi

if [[ "$protected" == 1 ]]; then
    auth_args=("${common_args[@]}")
    if [[ "$refresh" == 1 ]]; then auth_args+=(--refresh); fi
    if auth_result="$(bash "${script_dir}/playwright-auth-bootstrap.sh" "${auth_args[@]}")"; then
        printf '%s\n' "$auth_result"
        if [[ "$auth_result" == *"Authentication: ACTION_REQUIRED"* ]]; then
            printf 'Access: ACTION_REQUIRED\n'
            exit 0
        fi
    else
        status=$?
        printf '%s\n' "$auth_result"
        printf 'Access: BLOCKED\n'
        exit "$status"
    fi
else
    printf 'Authentication: NOT_REQUIRED\n'
fi

printf 'Access: READY\n'
