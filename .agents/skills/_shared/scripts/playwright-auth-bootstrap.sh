#!/usr/bin/env bash
set -euo pipefail

readonly EXIT_OK=0
readonly EXIT_PRECONDITION=2

usage() {
    cat <<'EOF'
Usage: playwright-auth-bootstrap.sh [-h|--help]

Bootstraps the shared Playwright authentication storage state for local
application verification. Resolves playwright-cli and node through
_shared/scripts/env-load.sh (resolve_tool_cmd; BIN_PATH first, then PATH),
    reuses a valid existing state even without login credentials, and delegates to
    playwright-auth-bootstrap.mjs. Credential values are passed in the process
environment only; they never appear in argv, stdout, or stderr. On success the
validated storage state is a regular, git-ignored file under
.playwright-cli/auth/.

Output:
  Authentication: OK|FAIL
  Reason: <code> (only when authentication fails)
  Storage state: <repo-relative path> (only when authentication succeeds)

Exit codes:
  0  storage state already valid or freshly created
  1  unexpected internal error (internal-error)
  2  precondition not met (cli-missing, env-missing, node-missing,
     playwright-module-unavailable, scope-not-loopback, browser-unavailable)
  3  authentication execution failed (form-not-recognized,
     login-not-confirmed, state-invalid)
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

# Load the consumer repository environment into this shell. resolve_tool_cmd
# runs inside command substitutions, so only an explicit call here makes the
# loaded values visible to the Node process (and to resolve_tool_cmd itself).
ensure_repo_env_loaded

# Playwright debug output bypasses the core logger and can echo credentials;
# the bootstrap never needs it.
unset DEBUG PWDEBUG

if ! cli_cmd="$(resolve_tool_cmd playwright-cli playwright-cli)"; then
    printf 'Authentication: FAIL\n'
    printf 'Reason: cli-missing\n'
    exit "$EXIT_PRECONDITION"
fi

if ! node_cmd="$(resolve_tool_cmd node node)"; then
    printf 'Authentication: FAIL\n'
    printf 'Reason: node-missing\n'
    exit "$EXIT_PRECONDITION"
fi

exec "$node_cmd" "${script_dir}/playwright-auth-bootstrap.mjs" --cli "$cli_cmd"
