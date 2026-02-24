#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_URL="https://llvm.org/docs/"
DOCS_DIR="$ROOT/docs"
REGENERATE_BOOK_INDEX=1
REGENERATE_UNIVERSAL_SEARCH_INDEX=1

KEEP_PATHS=(
  "_static/documentation_options.js"
  "_static/docs-book-index.js"
  "_static/docs-universal-search-index.js"
  "_static/docs-known-broken-links.txt"
  "_static/docs-sync-meta.json"
)

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: scripts/sync-docs-from-llvm-org.sh [options]

Mirror docs from llvm.org into local docs/ and regenerate search/index artifacts.

Options:
  --source-url URL        Source docs root URL (default: https://llvm.org/docs/)
  --docs-dir PATH         Destination docs directory (default: docs)
  --skip-book-index       Skip book-index regeneration step
  --skip-universal-search-index
                          Skip universal-search-index regeneration step
  -h, --help              Show help
EOF
}

while (($#)); do
  case "$1" in
    --source-url)
      [[ $# -ge 2 ]] || fail "--source-url requires a value"
      SOURCE_URL="$2"
      shift 2
      ;;
    --docs-dir)
      [[ $# -ge 2 ]] || fail "--docs-dir requires a value"
      DOCS_DIR="$2"
      shift 2
      ;;
    --skip-book-index)
      REGENERATE_BOOK_INDEX=0
      shift
      ;;
    --skip-universal-search-index)
      REGENERATE_UNIVERSAL_SEARCH_INDEX=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      fail "Unknown option: $1"
      ;;
  esac
done

if [[ "$DOCS_DIR" != /* ]]; then
  DOCS_DIR="$ROOT/$DOCS_DIR"
fi
[[ -d "$DOCS_DIR" ]] || fail "Missing docs directory: $DOCS_DIR"

command -v wget >/dev/null 2>&1 || fail "wget is required"
command -v rsync >/dev/null 2>&1 || fail "rsync is required"
command -v python3 >/dev/null 2>&1 || fail "python3 is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

SOURCE_URL="$(python3 - "$SOURCE_URL" <<'PY'
import sys
import urllib.parse

raw = sys.argv[1].strip()
if not raw:
    raise SystemExit("empty --source-url")

parsed = urllib.parse.urlparse(raw)
if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise SystemExit("source URL must be an absolute http/https URL")

path = parsed.path or "/"
if not path.endswith("/"):
    path += "/"

print(urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", "")))
PY
)" || fail "Invalid --source-url: $SOURCE_URL"

SOURCE_PATH="$(python3 - "$SOURCE_URL" <<'PY'
import sys
import urllib.parse

parsed = urllib.parse.urlparse(sys.argv[1])
print((parsed.path or "/").strip("/"))
PY
)"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/llvm-docs-sync.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Syncing docs mirror from $SOURCE_URL"
wget \
  --mirror \
  --no-verbose \
  --no-host-directories \
  --directory-prefix "$TMP_DIR" \
  --no-parent \
  --execute robots=off \
  --retry-connrefused \
  --waitretry=5 \
  --tries=4 \
  --timeout=30 \
  --read-timeout=30 \
  "$SOURCE_URL"

MIRROR_ROOT="$TMP_DIR"
if [[ -n "$SOURCE_PATH" ]]; then
  MIRROR_ROOT="$TMP_DIR/$SOURCE_PATH"
fi
[[ -d "$MIRROR_ROOT" ]] || fail "Downloaded mirror root not found: $MIRROR_ROOT"
[[ -f "$MIRROR_ROOT/index.html" ]] || fail "Downloaded mirror missing index.html: $MIRROR_ROOT/index.html"

RSYNC_ARGS=(-a --delete --exclude ".DS_Store")
for keep_path in "${KEEP_PATHS[@]}"; do
  RSYNC_ARGS+=(--exclude "$keep_path")
done

rsync "${RSYNC_ARGS[@]}" "$MIRROR_ROOT/" "$DOCS_DIR/"

if [[ "$REGENERATE_BOOK_INDEX" -eq 1 ]]; then
  python3 "$ROOT/scripts/generate-docs-book-index.py" \
    --source-root "$DOCS_DIR/_sources" \
    --output "$DOCS_DIR/_static/docs-book-index.js"
fi

if [[ "$REGENERATE_UNIVERSAL_SEARCH_INDEX" -eq 1 ]]; then
  python3 "$ROOT/scripts/generate-docs-universal-search-index.py" \
    --docs-root "$DOCS_DIR" \
    --book-index "$DOCS_DIR/_static/docs-book-index.js" \
    --output "$DOCS_DIR/_static/docs-universal-search-index.js"
fi

LATEST_RELEASE_JSON="$(curl -fsSL \
  --retry 3 \
  --retry-delay 2 \
  --connect-timeout 10 \
  --max-time 20 \
  https://api.github.com/repos/llvm/llvm-project/releases/latest 2>/dev/null || true)"

LLVM_DOCS_LATEST_RELEASE_JSON="$LATEST_RELEASE_JSON" python3 - "$DOCS_DIR" "$SOURCE_URL" <<'PY'
import datetime
import json
import os
import pathlib
import sys

docs_dir = pathlib.Path(sys.argv[1])
source_url = sys.argv[2]
meta_path = docs_dir / "_static" / "docs-sync-meta.json"
meta_path.parent.mkdir(parents=True, exist_ok=True)

def normalize_release_version(raw):
    value = str(raw or "").strip()
    if not value:
        return ""
    if value.lower().startswith("llvmorg-"):
        value = value[len("llvmorg-") :]
    if value.lower().startswith("llvm "):
        value = value[len("llvm ") :]
    return value.strip()


def parse_latest_release(payload):
    if not isinstance(payload, dict):
        return {}

    tag = str(payload.get("tag_name", "")).strip()
    name = str(payload.get("name", "")).strip()
    version = normalize_release_version(name) or normalize_release_version(tag)
    github_url = str(payload.get("html_url", "")).strip()
    published_at = str(payload.get("published_at", "")).strip()

    release = {}
    if tag:
        release["tag"] = tag
    if name:
        release["name"] = name
    if version:
        release["version"] = version
    if github_url:
        release["githubUrl"] = github_url
    if published_at:
        release["publishedAt"] = published_at
    return release


def resolve_latest_release_from_env():
    raw = str(os.environ.get("LLVM_DOCS_LATEST_RELEASE_JSON", "")).strip()
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except Exception:  # noqa: BLE001
        return {}
    return parse_latest_release(payload)


latest_release = resolve_latest_release_from_env()

payload = {
    "sourceUrl": source_url,
    "syncedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "generator": "scripts/sync-docs-from-llvm-org.sh",
}
if latest_release:
    payload["latestRelease"] = latest_release

meta_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

echo "Docs mirror sync complete."
