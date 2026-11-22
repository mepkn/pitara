#!/usr/bin/env bash
# Runs every part's checks (typecheck, lint, tests). Parts that have no
# package.json yet (web, extension, mobile before their steps) are skipped.
# Run before committing.
set -euo pipefail
cd "$(dirname "$0")/.."

for dir in shared backend web extension mobile; do
  if [ ! -f "$dir/package.json" ]; then
    echo "› $dir (skipped: no package.json yet)"
    continue
  fi
  echo "› $dir"
  npm --prefix "$dir" run check
done
