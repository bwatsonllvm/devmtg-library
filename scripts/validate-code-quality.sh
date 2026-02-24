#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

python3 -m compileall -q scripts

if ! command -v ruff >/dev/null 2>&1; then
  echo "ERROR: ruff is required for lint checks" >&2
  exit 1
fi
ruff check scripts

if ls scripts/*.sh >/dev/null 2>&1; then
  bash -n scripts/*.sh
fi

if [ -d tests ]; then
  if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: node is required to run JS tests" >&2
    exit 1
  fi
  node --test tests
fi

echo "OK: code quality checks passed"
