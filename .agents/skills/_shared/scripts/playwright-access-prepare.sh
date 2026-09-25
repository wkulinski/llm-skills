#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: playwright-access-prepare.sh [--protected|-h|--help]

Runs the Playwright CLI/browser preflight. With --protected it also reuses a
validated storage state or bootstraps a missing one using the loopback login
helper. No login credentials are passed in argv or printed. The agent still
opens a separate application session and loads the returned state before
navigating to the explicit application URL.

Output: preflight result, optional Authentication/Storage state, Access: READY|BLOCKED.
Exit codes: preflight or authentication helper exit code on failure, 0 on READY.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

if [[ "$#" -gt 1 || ( "$#" -eq 1 && "$1" != "--protected" ) ]]; then
    usage >&2
    exit 2
fi

script_path="${BASH_SOURCE[0]}"
script_dir="${script_path%/*}"
if [[ "$script_dir" == "$script_path" ]]; then
    script_dir="."
fi
script_dir="$(cd "$script_dir" && pwd)"

if bash "${script_dir}/playwright-preflight.sh"; then
    :
else
    status=$?
    printf 'Access: BLOCKED\n'
    exit "$status"
fi

if [[ "${1:-}" == "--protected" ]]; then
    if bash "${script_dir}/playwright-auth-bootstrap.sh"; then
        :
    else
        status=$?
        printf 'Access: BLOCKED\n'
        exit "$status"
    fi
else
    printf 'Authentication: NOT_REQUIRED\n'
fi

printf 'Access: READY\n'
