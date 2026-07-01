#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat >&2 <<'EOF'
Usage:
  commit-message-render.sh --output <path>

Reads a structured commit-message draft from stdin and writes the final
commit message to <path>.

Input format:
  Subject: <subject line>
  general:
  - <item>
  db:
  - <item>
  cli:
  - <item>

Rules:
  - Empty sections are omitted.
  - Items equal to "Brak zmian", "N/A" or "-" are rejected.
EOF
}

trim() {
    local value="${1:-}"

    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    printf '%s' "$value"
}

normalize() {
    local value="${1:-}"

    if command -v iconv >/dev/null 2>&1; then
        value="$(printf '%s' "$value" | iconv -f UTF-8 -t ASCII//TRANSLIT//IGNORE 2>/dev/null || true)"
    fi

    printf '%s' "$value" | tr '[:upper:]' '[:lower:]'
}

is_filler_item() {
    case "$(normalize "$1")" in
        "brak zmian" | "n/a" | "-") return 0 ;;
        *) return 1 ;;
    esac
}

section_key_from_label() {
    case "$(normalize "$1")" in
        "general")
            printf '%s\n' "general"
            ;;
        "db")
            printf '%s\n' "db"
            ;;
        "cli")
            printf '%s\n' "cli"
            ;;
        *)
            return 1
            ;;
    esac
}

append_item() {
    local section_key="${1:-}"
    local item="${2:-}"

    case "$section_key" in
        general)
            general_items+=("$item")
            ;;
        db)
            db_items+=("$item")
            ;;
        cli)
            cli_items+=("$item")
            ;;
        *)
            return 1
            ;;
    esac
}

render_section() {
    local title="${1:-}"
    local section_key="${2:-}"
    local -a items=()
    local item=""

    case "$section_key" in
        general)
            items=("${general_items[@]}")
            ;;
        db)
            items=("${db_items[@]}")
            ;;
        cli)
            items=("${cli_items[@]}")
            ;;
        *)
            return 1
            ;;
    esac

    if [ "${#items[@]}" -eq 0 ]; then
        return 0
    fi

    printf '## %s\n' "$title"
    for item in "${items[@]}"; do
        printf -- '- %s\n' "$item"
    done
    printf '\n'
}

output_file=""
while [ "$#" -gt 0 ]; do
    case "$1" in
        --output)
            output_file="${2:-}"
            shift 2
            ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage
            exit 2
            ;;
    esac
done

if [ -z "$output_file" ]; then
    echo "Missing --output." >&2
    usage
    exit 2
fi

subject=""
subject_seen=0
current_section=""
declare -a general_items=()
declare -a db_items=()
declare -a cli_items=()

while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="$(trim "$raw_line")"

    [ -n "$line" ] || continue

    case "$line" in
        Subject:*)
            if [ "$subject_seen" -eq 1 ]; then
                echo "Duplicate Subject line." >&2
                exit 2
            fi
            subject="$(trim "${line#Subject:}")"
            if [ -z "$subject" ]; then
                echo "Empty Subject line." >&2
                exit 2
            fi
            subject_seen=1
            current_section=""
            ;;
        *:)
            if [ "$subject_seen" -eq 0 ]; then
                echo "Subject line must appear before sections." >&2
                exit 2
            fi
            label="$(trim "${line%:}")"
            section_key="$(section_key_from_label "$label" || true)"
            if [ -z "$section_key" ]; then
                echo "Unknown section: $label" >&2
                exit 2
            fi
            current_section="$section_key"
            ;;
        -*)
            if [ "$subject_seen" -eq 0 ]; then
                echo "Subject line must appear before sections." >&2
                exit 2
            fi
            if [ -z "$current_section" ]; then
                echo "Bullet item outside of a section: $line" >&2
                exit 2
            fi

            item="$(trim "${line#-}")"
            if [ -z "$item" ]; then
                echo "Empty bullet item." >&2
                exit 2
            fi
            if is_filler_item "$item"; then
                echo "Filler bullet is not allowed: $item" >&2
                exit 2
            fi

            append_item "$current_section" "$item"
            ;;
        *)
            echo "Unknown line format: $line" >&2
            exit 2
            ;;
    esac
done

if [ -z "$subject" ]; then
    echo "Missing Subject line." >&2
    exit 2
fi

{
    printf '%s\n' "$subject"

    if [ "${#general_items[@]}" -gt 0 ] || [ "${#db_items[@]}" -gt 0 ] || [ "${#cli_items[@]}" -gt 0 ]; then
        printf '\n'
        render_section "Zmiany ogólne" "general"
        render_section "Zmiany wpływające na strukturę bazy danych" "db"
        render_section "Zmiany API poleceń CLI" "cli"
    fi
} > "$output_file"
