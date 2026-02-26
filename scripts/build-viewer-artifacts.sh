#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MODE="apply"
if [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

if [[ "$MODE" == "check" ]]; then
  python3 scripts/sync-site-header.py --repo-root "$ROOT" --check
  python3 scripts/generate-autocomplete-index.py --repo-root "$ROOT" --check
  python3 scripts/apply-asset-versions.py --repo-root "$ROOT" --check
else
  python3 scripts/sync-site-header.py --repo-root "$ROOT"
  python3 scripts/generate-autocomplete-index.py --repo-root "$ROOT"
  python3 scripts/apply-asset-versions.py --repo-root "$ROOT"
fi
