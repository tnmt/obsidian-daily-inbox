# Sourced by the hooks in this directory.
set -eu

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is not installed; refusing to continue. Enter the dev shell (nix develop) or install gitleaks." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
GITLEAKS_CONFIG="$REPO_ROOT/.gitleaks.toml"
export GITLEAKS_CONFIG
