#!/usr/bin/env bash
# Deploys the Convex backend to production and the built site to the VPS,
# where Caddy serves DEPLOY_DIR directly (no restart or sudo needed).
#
# Each part keeps its production settings in its own .env.prod.local
# (git-ignored; see each part's .env.example): backend/ has the Convex deploy key, web/ has
# the VPS details.
#   scripts/deploy.sh            deploy the backend, build, upload
#   DRY_RUN=1 scripts/deploy.sh  preview only: nothing is deployed or uploaded
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/load-env.sh

URL="https://pitara.pknspace.com"

load_env backend/.env.prod.local
load_env web/.env.prod.local
: "${CONVEX_DEPLOY_KEY:?CONVEX_DEPLOY_KEY is not set in backend/.env.prod.local}"
: "${DEPLOY_HOST:?DEPLOY_HOST is not set in web/.env.prod.local}"
: "${DEPLOY_PORT:?DEPLOY_PORT is not set in web/.env.prod.local}"
: "${DEPLOY_DIR:?DEPLOY_DIR is not set in web/.env.prod.local}"
# backend/.env.local points `convex` at the local dev backend; don't let it win.
unset CONVEX_DEPLOYMENT
# deploy.sh gets the production URL from `convex deploy`; ignore one set in web/.env.prod.local.
unset VITE_CONVEX_URL

echo "› Checks"
scripts/check.sh

if [ -n "${DRY_RUN:-}" ]; then
  echo "› Backend (dry run)"
  (cd backend && npx convex deploy --dry-run)
  echo "› Upload (dry run, using a local build)"
  npm --prefix web run build
  rsync -avz --delete --dry-run -e "ssh -p $DEPLOY_PORT" web/dist/ "$DEPLOY_HOST:$DEPLOY_DIR/"
  echo "Dry run: nothing was deployed or uploaded."
  exit 0
fi

echo "› Backend + build"
# Deploys backend/convex/ and builds web/ with VITE_CONVEX_URL set to production.
(cd backend && npx convex deploy -y --cmd-url-env-var-name VITE_CONVEX_URL --cmd 'npm --prefix ../web run build')

if grep -rq "127.0.0.1:32" web/dist/assets || ! grep -rq "convex.cloud" web/dist/assets; then
  echo "Build does not point at the production Convex URL; not uploading." >&2
  exit 1
fi

echo "› Upload"
rsync -avz --delete -e "ssh -p $DEPLOY_PORT" web/dist/ "$DEPLOY_HOST:$DEPLOY_DIR/"

echo "Deployed to $URL"
