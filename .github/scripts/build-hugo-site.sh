#!/usr/bin/env bash
# Shared Hugo + Pagefind build used by hugo-build.yml and preview.yml.
# Tailwind must be compiled to assets/css/compiled.css before invoking this script.
set -euo pipefail

MODE="${1:-}"
PAGEFIND_BIN="${PAGEFIND_BIN:-./pagefind}"

usage() {
  echo "Usage: $0 production|preview [pr-number]" >&2
  exit 1
}

[[ -n "$MODE" ]] || usage

build_pagefind() {
  echo "Running Pagefind on public/"
  "$PAGEFIND_BIN" --site public

  if [[ ! -f public/pagefind/pagefind.js ]]; then
    echo "ERROR: public/pagefind/pagefind.js missing after Pagefind" >&2
    exit 1
  fi
  if [[ ! -f public/pagefind/pagefind-entry.json ]]; then
    echo "ERROR: public/pagefind/pagefind-entry.json missing after Pagefind" >&2
    exit 1
  fi

  PAGE_COUNT="$(
    grep -o '"page_count":[0-9]*' public/pagefind/pagefind-entry.json \
      | head -1 \
      | grep -o '[0-9]*' \
      || true
  )"
  if [[ -z "${PAGE_COUNT}" || "${PAGE_COUNT}" -lt 1 ]]; then
    echo "ERROR: Pagefind indexed 0 pages" >&2
    exit 1
  fi

  echo "Pagefind OK (${PAGE_COUNT} pages indexed)"
}

case "$MODE" in
  production)
    hugo --minify --gc
    build_pagefind
    ;;
  preview)
    PREVIEW_NUM="${2:-}"
    [[ -n "$PREVIEW_NUM" ]] || usage
    PREVIEW_HOST="${PREVIEW_SITE_URL:-https://opensourcedesign.net}"
    PREVIEW_HOST="${PREVIEW_HOST%/}"
    if [[ ! "$PREVIEW_HOST" =~ ^https?:// ]]; then
      PREVIEW_HOST="https://${PREVIEW_HOST}"
    fi
    BASE="${PREVIEW_HOST}/pr-preview/pr-${PREVIEW_NUM}/"
    hugo --minify --gc --baseURL "${BASE}"
    build_pagefind
    rm -f public/CNAME
    ;;
  *)
    usage
    ;;
esac
