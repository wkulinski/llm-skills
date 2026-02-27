#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(git -C "$script_dir" rev-parse --show-toplevel)"
# shellcheck disable=SC1091
. "$repo_root/.agents/skills/_shared/scripts/env-load.sh"
load_repo_env "$repo_root"

cd "$repo_root"

cache_root="${CACHE_PATH:-var/agent/cache}"
cache_root="${cache_root%/}"
state_path="${cache_root}/code-implement/state.md"

if [ -f "$state_path" ]; then
  echo "$state_path (exists)"
  exit 0
fi

mkdir -p "$(dirname "$state_path")"

today="$(date +%Y-%m-%d)"
now="$(date +%H:%M:%S)"

cat >"$state_path" <<'EOF'
# STAN CODE-IMPLEMENT (lokalny, niecommitowany)

> Ten plik jest lokalny i ignorowany przez git. Służy do utrzymania stanu zadania implementacyjnego między iteracjami.

## Aktywne zadanie
- Utworzono: __CREATED__
- Cel: (uzupełnij)

### Rejestr wymagań
- R1 (TODO): …
  - Kryteria: …
  - Dowody: …
  - Notatki: …

### Założenia / decyzje
- …

### Dotknięte obszary
- …

### Dziennik odczytów
- [__CREATED__] Init
- [__CREATED__] Przykład: rg "EntityConnection" -n src; git diff --stat

### Dziennik iteracji
- [__CREATED__] Init
EOF

created="${today} ${now}"
sed -i "s|__CREATED__|${created}|g" "$state_path"

echo "$state_path (created)"
