#!/usr/bin/env bash
# set the project version everywhere it is written down.
#
#   scripts/set-version.sh 1.0.1
#   scripts/set-version.sh v1.0.1      # a leading v is accepted and stripped
#
# writes backend/app/__init__.py, and lets npm write frontend/package.json and
# frontend/package-lock.json together so the two cannot drift apart

set -euo pipefail
cd "$(dirname "$0")/.."

NODE_IMAGE="${NODE_IMAGE:-node:22-alpine}"
INIT_FILE=backend/app/__init__.py

raw="${1:-}"
[[ -n "$raw" ]] || { echo "Usage: scripts/set-version.sh <version>   (e.g. 1.0.1 or v1.0.1)"; exit 1; }

version="${raw#v}"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Not a semantic version: ${raw}"
  exit 1
fi

# backend

if grep -qE '^__version__ *=' "$INIT_FILE"; then
  sed -i "s/^__version__ *=.*/__version__ = \"${version}\"/" "$INIT_FILE"
else
  printf '__version__ = "%s"\n' "$version" >> "$INIT_FILE"
fi
echo "  ${INIT_FILE}"

# frontend

docker run --rm \
  -u "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e npm_config_cache=/tmp/.npm \
  -e npm_config_update_notifier=false \
  -v "$PWD/frontend":/app \
  -w /app \
  "$NODE_IMAGE" \
  npm version "$version" --no-git-tag-version --allow-same-version > /dev/null
echo "  frontend/package.json"
echo "  frontend/package-lock.json"

