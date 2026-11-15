#!/usr/bin/env bash
# Installs the repo's git hooks (currently: pre-push) as symlinks into .git/hooks, so edits to
# scripts/pre-push apply immediately. Re-run is safe. Remove with: rm .git/hooks/pre-push
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
HOOKS="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOKS"
chmod +x "$ROOT/scripts/pre-push"
if [ -e "$HOOKS/pre-push" ] && [ ! -L "$HOOKS/pre-push" ]; then
  mv "$HOOKS/pre-push" "$HOOKS/pre-push.bak"
  echo "existing pre-push hook saved as $HOOKS/pre-push.bak"
fi
ln -sf "$ROOT/scripts/pre-push" "$HOOKS/pre-push"
echo "installed: $HOOKS/pre-push -> scripts/pre-push"
