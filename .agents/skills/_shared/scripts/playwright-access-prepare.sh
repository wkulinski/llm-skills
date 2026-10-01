#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: playwright-access-prepare.sh [--protected [--refresh]] [--url <url>]
       playwright-access-prepare.sh --stage --session <name>
       playwright-access-prepare.sh --promote --candidate <path> --evidence <text> [--url <url>]

Runs the Playwright CLI/browser preflight. With --protected it also reuses a
private candidate storage state or bootstraps a missing one using the loopback login
helper. No login credentials are passed in argv or printed. The agent still
opens a separate application session and loads the returned state before
navigating to the explicit application URL.

Protected preparation returns Access: ACTION_REQUIRED and Candidate state.
Finish allowed non-secret steps in an agent CLI session, then use --stage.
Assess the staged candidate in a fresh session before --promote with evidence.
Promotion checks technical access in a fresh browser context.
Output: Access: READY|ACTION_REQUIRED|VERIFY_REQUIRED|BLOCKED. No secrets in argv.
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
stage=0
promote=0
finalize_args=()
common_args=()
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        --protected) protected=1; shift ;;
        --refresh) refresh=1; shift ;;
        --stage) stage=1; finalize=1; finalize_args+=(--stage); shift ;;
        --promote) promote=1; finalize=1; finalize_args+=(--promote); shift ;;
        --session|--candidate|--evidence)
            [[ "$#" -ge 2 ]] || { usage >&2; exit 2; }
            finalize_args+=("$1" "$2"); shift 2 ;;
        --url)
            [[ "$#" -ge 2 && -n "$2" ]] || { usage >&2; exit 2; }
            common_args+=("$1" "$2"); shift 2 ;;
        *) usage >&2; exit 2 ;;
    esac
done
if [[ "$stage" == 1 && "$promote" == 1 ]] ||
    [[ "$finalize" == 1 && ( "$protected" == 1 || "$refresh" == 1 ) ]] ||
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
    if finalize_result="$("$node_cmd" "${script_dir}/playwright-auth-finalize.mjs" --cli "$cli_cmd" "${finalize_args[@]}" "${common_args[@]}")"; then
        printf '%s\n' "$finalize_result"
        exit 0
    else
        status=$?
        printf '%s\n' "$finalize_result"
        if [[ "$finalize_result" != *"Access: BLOCKED"* ]]; then printf 'Access: BLOCKED\n'; fi
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
