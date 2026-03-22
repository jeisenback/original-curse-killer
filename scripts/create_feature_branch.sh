#!/usr/bin/env bash
# Create the same feature branch across multiple local repos.
# Usage: ./scripts/create_feature_branch.sh feature/issue-desc [--push] [--force] [--dry-run]

set -euo pipefail

BRANCH=""
PUSH="no"
FORCE="no"
DRY_RUN="no"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) PUSH="yes"; shift;;
    --force) FORCE="yes"; shift;;
    --dry-run) DRY_RUN="yes"; shift;;
    --help) echo "Usage: $0 feature/<name> [--push] [--force] [--dry-run]"; exit 0;;
    *)
      if [[ -z "$BRANCH" ]]; then BRANCH="$1"; else echo "Unknown arg: $1"; exit 2; fi
      shift
    ;;
  esac
done

if [[ -z "$BRANCH" ]]; then
  echo "Error: branch name required (e.g. feature/123-short-desc)"
  exit 2
fi

# Read repo list from .repos (one path per line) if present, else use defaults
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ROOT_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
REPO_FILE="$ROOT_DIR/.repos"

if [[ -f "$REPO_FILE" ]]; then
  mapfile -t REPOS < <(grep -v '^\s*$' "$REPO_FILE" | sed 's/#.*//')
else
  REPOS=("$ROOT_DIR/../dmforge" "$ROOT_DIR/../golden_boy_peanuts" "$ROOT_DIR/../non-profit-tool")
fi

echo "Branch: $BRANCH"
echo "Push: $PUSH  Force: $FORCE  Dry-run: $DRY_RUN"

for R in "${REPOS[@]}"; do
  echo
  echo "=== $R ==="
  if [[ ! -d "$R" ]]; then
    echo "Path not found; skipping"
    continue
  fi
  if [[ ! -d "$R/.git" ]]; then
    echo "Not a git repo; skipping"
    continue
  fi
  pushd "$R" >/dev/null
  # fetch latest refs
  if [[ "$DRY_RUN" == "yes" ]]; then
    echo "[dry-run] git fetch --all"
  else
    git fetch --all --quiet
  fi

  # check working tree
  DIRTY=$(git status --porcelain)
  if [[ -n "$DIRTY" ]]; then
    if [[ "$FORCE" == "yes" ]]; then
      echo "Working tree dirty but --force set; continuing"
    else
      echo "Working tree dirty; skipping (use --force to override)"
      popd >/dev/null
      continue
    fi
  fi

  if [[ "$DRY_RUN" == "yes" ]]; then
    echo "[dry-run] git checkout -b $BRANCH"
    if [[ "$PUSH" == "yes" ]]; then
      echo "[dry-run] git push -u origin HEAD"
    fi
  else
    git checkout -b "$BRANCH"
    if [[ "$PUSH" == "yes" ]]; then
      git push -u origin HEAD
    fi
    echo "Created branch $BRANCH"
  fi

  popd >/dev/null
done

echo
echo "Done."
