#!/usr/bin/env bash
# Builds the Chrome extension into extension/dist/ (load unpacked) and extension/../pitara-extension.zip.
#
# The API origin (the backend's .convex.site URL, also the extension's only host permission) comes from:
#   VITE_CONVEX_SITE_URL                          if you set it
#   EXT_ENV=dev                                   backend/.env.local (the local backend)
#   otherwise (production)                        web/.env.prod.local VITE_CONVEX_URL, .convex.cloud -> .convex.site
# VITE_COMMIT defaults to the short git SHA (the Release workflow's tag).
#   scripts/build-extension.sh            production build + zip
#   EXT_ENV=dev scripts/build-extension.sh   build for the local backend, no zip
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/load-env.sh

if [ -z "${VITE_CONVEX_SITE_URL:-}" ]; then
  if [ "${EXT_ENV:-}" = "dev" ]; then
    VITE_CONVEX_SITE_URL="$(load_env backend/.env.local; echo "${VITE_CONVEX_SITE_URL:-}")"
    [ -n "$VITE_CONVEX_SITE_URL" ] || { echo "VITE_CONVEX_SITE_URL is not set in backend/.env.local." >&2; exit 1; }
  else
    load_env web/.env.prod.local
    : "${VITE_CONVEX_URL:?VITE_CONVEX_URL (production) is not set in web/.env.prod.local}"
    VITE_CONVEX_SITE_URL="${VITE_CONVEX_URL/.convex.cloud/.convex.site}"
  fi
fi
export VITE_CONVEX_SITE_URL
export VITE_COMMIT="${VITE_COMMIT:-$(git rev-parse --short=7 HEAD 2>/dev/null || true)}"

if [ "${EXT_ENV:-}" != "dev" ]; then
  case "$VITE_CONVEX_SITE_URL" in
    https://*.convex.site) ;;
    *) echo "A production build needs an https://*.convex.site API origin; got a different one." >&2; exit 1 ;;
  esac
fi

echo "› Checks"
npm --prefix extension run check

echo "› Build"
npm --prefix extension run build

if ! grep -rqF "$VITE_CONVEX_SITE_URL" extension/dist/assets; then
  echo "The build doesn't contain the API origin; not zipping." >&2
  exit 1
fi

if [ "${EXT_ENV:-}" = "dev" ]; then
  echo "Dev build in extension/dist (not zipped). Load it unpacked from chrome://extensions."
else
  rm -f pitara-extension.zip
  (cd extension/dist && zip -qr ../../pitara-extension.zip .)
  echo "Wrote pitara-extension.zip"
fi
