#!/usr/bin/env bash
# build (and optionally push) the production images.
#
#   scripts/build-images.sh            # tags :latest
#   scripts/build-images.sh v1.2.3     # tags :v1.2.3 and :latest
#   PUSH=1 scripts/build-images.sh v1.2.3
#
# REGISTRY defaults to ghcr.io/jfhack; override with REGISTRY=...

set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${1:-latest}"
REGISTRY="${REGISTRY:-ghcr.io/jfhack}"

build() {
  local name="$1" context="$2" target="$3"
  local image="${REGISTRY}/cadence-${name}"
  docker build --target "$target" -t "${image}:${VERSION}" "$context"
  if [[ "$VERSION" != "latest" ]]; then
    docker tag "${image}:${VERSION}" "${image}:latest"
  fi
  if [[ "${PUSH:-0}" == "1" ]]; then
    docker push "${image}:${VERSION}"
    [[ "$VERSION" != "latest" ]] && docker push "${image}:latest"
  fi
}

build backend backend prod
build frontend frontend runtime

echo "Done: ${REGISTRY}/cadence-{backend,frontend}:${VERSION}"
