#!/usr/bin/env bash
set -euo pipefail

readonly EXIT_OK=0
readonly EXIT_PRECONDITION=2

usage() {
    cat <<'EOF'
Usage: playwright-auth-bootstrap.sh [--refresh] [--url <protected-url>]

Bootstraps the shared Playwright authentication storage state for local
application verification. Resolves playwright-cli and node through
_shared/scripts/env-load.sh (resolve_tool_cmd; BIN_PATH first, then PATH),
copies an existing state privately for agent inspection, and delegates to
playwright-auth-bootstrap.mjs. Credential values are passed in the process
environment only; they never appear in argv, stdout, or stderr. A successful
login only stages a unique, regular, git-ignored provisional file under
.playwright-cli/auth/ and requires agent action; the canonical state file is
never overwritten during bootstrap. With --refresh an existing state is not
reused and a single fresh login is attempted.

Output:
  Authentication: ACTION_REQUIRED|FAIL
  Reason: <code> (only when authentication fails)
  Candidate state: <repo-relative path> (when agent action is required)

Exit codes:
  0  private candidate state was staged for agent assessment
  1  unexpected internal error (internal-error)
  2  precondition not met (cli-missing, env-missing, node-missing,
     playwright-module-unavailable, scope-not-loopback, browser-unavailable)
  3  authentication execution failed (form-not-recognized,
     login-not-confirmed, state-invalid)
EOF
}

refresh_requested=0
url_override=""
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            exit "$EXIT_OK"
            ;;
        --refresh)
            refresh_requested=1
            shift
            ;;
        --url)
            [[ "$#" -ge 2 && -n "$2" ]] || { usage >&2; exit "$EXIT_PRECONDITION"; }
            url_override="$2"
            shift 2
            ;;
        *)
            usage >&2
            exit "$EXIT_PRECONDITION"
            ;;
    esac
done

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
if [[ -n "$url_override" ]]; then export PLAYWRIGHT_GUI_BASE_URL="$url_override"; fi

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

args=(--cli "$cli_cmd")
if [[ "$refresh_requested" == 1 ]]; then
    args+=(--refresh)
fi
exec "$node_cmd" "${script_dir}/playwright-auth-bootstrap.mjs" "${args[@]}"
