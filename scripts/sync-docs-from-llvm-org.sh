#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_URL="https://llvm.org/docs/"
DOCS_DIR="$ROOT/docs"
REGENERATE_BOOK_INDEX=1
REGENERATE_UNIVERSAL_SEARCH_INDEX=1
BRIDGE_DOC_OPTIONS=""
EXCLUDE_PATH_PREFIXES=()
FETCH_SOURCE_COMPANIONS=1
SOURCE_REPO=""
SOURCE_REF=""
SOURCE_COMMIT_PATH=""
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

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
  --bridge-doc-options PATH
                          Optional bridge documentation_options.js to copy into docs _static
  --source-repo OWNER/NAME
                          Optional GitHub source repository for commit-aware skip checks
  --source-ref REF        Optional Git ref used with --source-repo (default: main)
  --source-commit-path PATH
                          Optional repo subpath used for commit-aware skip checks
  --github-token TOKEN    Optional GitHub token for commit/release API calls
  --exclude-path-prefix PATH
                          Skip crawling/downloading URLs under this absolute path prefix
                          (repeatable, e.g. --exclude-path-prefix /cpp_reference/)
  --skip-source-companions
                          Skip fallback probing for missing _sources/*.txt companion files
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
    --bridge-doc-options)
      [[ $# -ge 2 ]] || fail "--bridge-doc-options requires a value"
      BRIDGE_DOC_OPTIONS="$2"
      shift 2
      ;;
    --source-repo)
      [[ $# -ge 2 ]] || fail "--source-repo requires a value"
      SOURCE_REPO="$2"
      shift 2
      ;;
    --source-ref)
      [[ $# -ge 2 ]] || fail "--source-ref requires a value"
      SOURCE_REF="$2"
      shift 2
      ;;
    --source-commit-path)
      [[ $# -ge 2 ]] || fail "--source-commit-path requires a value"
      SOURCE_COMMIT_PATH="$2"
      shift 2
      ;;
    --github-token)
      [[ $# -ge 2 ]] || fail "--github-token requires a value"
      GITHUB_TOKEN="$2"
      shift 2
      ;;
    --exclude-path-prefix)
      [[ $# -ge 2 ]] || fail "--exclude-path-prefix requires a value"
      raw_prefix="$2"
      raw_prefix="${raw_prefix%%\#*}"
      raw_prefix="${raw_prefix%%\?*}"
      raw_prefix="/${raw_prefix#/}"
      if [[ "$raw_prefix" == "/" ]]; then
        fail "--exclude-path-prefix cannot be /"
      fi
      if [[ "$raw_prefix" != */ ]]; then
        raw_prefix="${raw_prefix}/"
      fi
      EXCLUDE_PATH_PREFIXES+=("$raw_prefix")
      shift 2
      ;;
    --skip-source-companions)
      FETCH_SOURCE_COMPANIONS=0
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

if [[ -n "$BRIDGE_DOC_OPTIONS" ]]; then
  if [[ "$BRIDGE_DOC_OPTIONS" != /* ]]; then
    BRIDGE_DOC_OPTIONS="$ROOT/$BRIDGE_DOC_OPTIONS"
  fi
  [[ -f "$BRIDGE_DOC_OPTIONS" ]] || fail "Missing --bridge-doc-options file: $BRIDGE_DOC_OPTIONS"
fi

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

if [[ -z "$SOURCE_REPO" || -z "$SOURCE_COMMIT_PATH" ]]; then
  case "$SOURCE_URL" in
    "https://llvm.org/docs/")
      [[ -n "$SOURCE_REPO" ]] || SOURCE_REPO="llvm/llvm-project"
      [[ -n "$SOURCE_REF" ]] || SOURCE_REF="main"
      [[ -n "$SOURCE_COMMIT_PATH" ]] || SOURCE_COMMIT_PATH="llvm/docs"
      ;;
    "https://clang.llvm.org/docs/")
      [[ -n "$SOURCE_REPO" ]] || SOURCE_REPO="llvm/llvm-project"
      [[ -n "$SOURCE_REF" ]] || SOURCE_REF="main"
      [[ -n "$SOURCE_COMMIT_PATH" ]] || SOURCE_COMMIT_PATH="clang/docs"
      ;;
    "https://lldb.llvm.org/")
      [[ -n "$SOURCE_REPO" ]] || SOURCE_REPO="llvm/llvm-project"
      [[ -n "$SOURCE_REF" ]] || SOURCE_REF="main"
      [[ -n "$SOURCE_COMMIT_PATH" ]] || SOURCE_COMMIT_PATH="lldb/docs"
      ;;
  esac
fi

SOURCE_REPO="${SOURCE_REPO## }"
SOURCE_REPO="${SOURCE_REPO%% }"
SOURCE_REF="${SOURCE_REF## }"
SOURCE_REF="${SOURCE_REF%% }"
if [[ -n "$SOURCE_REPO" && -z "$SOURCE_REF" ]]; then
  SOURCE_REF="main"
fi
SOURCE_COMMIT_PATH="${SOURCE_COMMIT_PATH#/}"
SOURCE_COMMIT_PATH="${SOURCE_COMMIT_PATH%%/}"

resolve_latest_source_revision() {
  if [[ -z "$SOURCE_REPO" || -z "$SOURCE_REF" || -z "$SOURCE_COMMIT_PATH" ]]; then
    return 0
  fi

  python3 - "$SOURCE_REPO" "$SOURCE_REF" "$SOURCE_COMMIT_PATH" "$GITHUB_TOKEN" <<'PY'
import json
import ssl
import sys
import urllib.parse
import urllib.request

repo = (sys.argv[1] or "").strip()
ref = (sys.argv[2] or "").strip()
path = (sys.argv[3] or "").strip().strip("/")
token = (sys.argv[4] or "").strip()
if not repo or "/" not in repo or not ref or not path:
    raise SystemExit(0)

url = (
    f"https://api.github.com/repos/{repo}/commits"
    f"?sha={urllib.parse.quote(ref)}"
    f"&path={urllib.parse.quote(path)}"
    "&per_page=1"
)
headers = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "llvm-library-docs-sync/1.0",
}
if token:
    headers["Authorization"] = f"Bearer {token}"
req = urllib.request.Request(url, headers=headers, method="GET")
try:
    with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context()) as resp:
        payload = json.loads(resp.read().decode("utf-8", errors="replace"))
except Exception:
    raise SystemExit(0)

entries = payload if isinstance(payload, list) else [payload]
for entry in entries:
    if not isinstance(entry, dict):
        continue
    sha = str(entry.get("sha", "")).strip()
    if sha:
        print(sha)
        break
PY
}

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/llvm-docs-sync.XXXXXX")"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

META_PATH="$DOCS_DIR/_static/docs-sync-meta.json"
EXISTING_SOURCE_REVISION=""
if [[ -f "$META_PATH" ]]; then
  EXISTING_SOURCE_REVISION="$(
    python3 - "$META_PATH" <<'PY'
import json
import pathlib
import sys

meta_path = pathlib.Path(sys.argv[1])
try:
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
except Exception:
    raise SystemExit(0)
if isinstance(payload, dict):
    value = str(payload.get("sourceRevision", "")).strip()
    if value:
        print(value)
PY
  )"
fi

LATEST_SOURCE_REVISION="$(resolve_latest_source_revision || true)"
SKIP_MIRROR=0
if [[ -n "$LATEST_SOURCE_REVISION" && -n "$EXISTING_SOURCE_REVISION" && "$LATEST_SOURCE_REVISION" == "$EXISTING_SOURCE_REVISION" ]]; then
  SKIP_MIRROR=1
  echo "Skipping mirror sync: upstream unchanged at ${LATEST_SOURCE_REVISION:0:12}"
fi

if [[ "$SKIP_MIRROR" -eq 0 ]]; then
echo "Syncing docs mirror from $SOURCE_URL"
USE_CURL_CRAWLER=0
if command -v wget >/dev/null 2>&1; then
  WGET_EXTRA_ARGS=()
  if ((${#EXCLUDE_PATH_PREFIXES[@]})); then
    for excluded_prefix in "${EXCLUDE_PATH_PREFIXES[@]}"; do
      escaped_prefix="${excluded_prefix//\//\\/}"
      WGET_EXTRA_ARGS+=(--reject-regex "https?://[^/]+${escaped_prefix}.*")
    done
  fi
  if ((${#WGET_EXTRA_ARGS[@]})); then
    WGET_CMD=(
      wget
      --mirror
      --no-verbose
      --no-host-directories
      --directory-prefix "$TMP_DIR"
      --no-parent
      --execute robots=off
      --retry-connrefused
      --waitretry=5
      --tries=4
      --timeout=30
      --read-timeout=30
      "${WGET_EXTRA_ARGS[@]}"
      "$SOURCE_URL"
    )
  else
    WGET_CMD=(
      wget
      --mirror
      --no-verbose
      --no-host-directories
      --directory-prefix "$TMP_DIR"
      --no-parent
      --execute robots=off
      --retry-connrefused
      --waitretry=5
      --tries=4
      --timeout=30
      --read-timeout=30
      "$SOURCE_URL"
    )
  fi
  if "${WGET_CMD[@]}"; then
    :
  else
    wget_status=$?
    echo "wget mirror failed (exit ${wget_status}); using curl crawler fallback"
    USE_CURL_CRAWLER=1
  fi
else
  echo "wget not found; using curl crawler fallback"
  USE_CURL_CRAWLER=1
fi

if [[ "$USE_CURL_CRAWLER" -eq 1 ]]; then
  CRAWL_QUEUE_FILE="$TMP_DIR/.crawl-queue.txt"
  CRAWL_NEXT_FILE="$TMP_DIR/.crawl-next.txt"
  CRAWL_SEEN_FILE="$TMP_DIR/.crawl-seen.txt"
  CRAWL_LINKS_FILE="$TMP_DIR/.crawl-links.txt"
  printf '%s\n' "$SOURCE_URL" > "$CRAWL_QUEUE_FILE"
  : > "$CRAWL_NEXT_FILE"
  : > "$CRAWL_SEEN_FILE"
  : > "$CRAWL_LINKS_FILE"

  fetched_count=0
  while [[ -s "$CRAWL_QUEUE_FILE" ]]; do
    : > "$CRAWL_NEXT_FILE"
    while IFS= read -r current_url; do
      [[ -n "$current_url" ]] || continue

      crawl_meta="$(python3 - "$current_url" <<'PY'
import sys
import urllib.parse

raw = str(sys.argv[1] or "").strip()
if not raw:
    raise SystemExit(0)

parsed = urllib.parse.urlparse(raw)
if parsed.scheme not in {"http", "https"} or not parsed.netloc:
    raise SystemExit(0)

path = parsed.path or "/"
normalized = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))
rel_path = path.lstrip("/")
if path.endswith("/"):
    rel_path = f"{rel_path}index.html"
if not rel_path:
    rel_path = "index.html"

print(normalized)
print(rel_path)
PY
)"

      normalized_url="$(printf '%s\n' "$crawl_meta" | sed -n '1p')"
      rel_path="$(printf '%s\n' "$crawl_meta" | sed -n '2p')"
      [[ -n "$normalized_url" && -n "$rel_path" ]] || continue

      if grep -Fqx "$normalized_url" "$CRAWL_SEEN_FILE"; then
        continue
      fi
      printf '%s\n' "$normalized_url" >> "$CRAWL_SEEN_FILE"

      out_path="$TMP_DIR/$rel_path"
      mkdir -p "$(dirname "$out_path")"
      if ! curl -fsSL \
        --retry 4 \
        --retry-delay 1 \
        --connect-timeout 20 \
        --max-time 60 \
        "$normalized_url" \
        -o "$out_path"; then
        if [[ "$normalized_url" == "$SOURCE_URL" ]]; then
          fail "Failed to fetch source URL in curl crawler fallback: $normalized_url"
        fi
        continue
      fi
      fetched_count=$((fetched_count + 1))

      CRAWL_PY_ARGS=("$SOURCE_URL" "$normalized_url" "$out_path")
      if ((${#EXCLUDE_PATH_PREFIXES[@]})); then
        CRAWL_PY_ARGS+=("${EXCLUDE_PATH_PREFIXES[@]}")
      fi
      python3 - "${CRAWL_PY_ARGS[@]}" > "$CRAWL_LINKS_FILE" <<'PY'
import pathlib
import re
import sys
import urllib.parse
from html.parser import HTMLParser


source_url = sys.argv[1]
current_url = sys.argv[2]
file_path = pathlib.Path(sys.argv[3])
exclude_prefixes = []
for raw in sys.argv[4:]:
    value = str(raw or "").strip()
    if not value:
        continue
    if not value.startswith("/"):
        value = "/" + value
    if value != "/" and not value.endswith("/"):
        value += "/"
    exclude_prefixes.append(value)

source_parsed = urllib.parse.urlparse(source_url)
source_prefix = source_parsed.path or "/"
if not source_prefix.endswith("/"):
    source_prefix += "/"


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[str] = []

    def handle_starttag(self, _tag: str, attrs: list[tuple[str, str | None]]) -> None:
        for key, value in attrs:
            if key in {"href", "src"} and value:
                self.links.append(value)


def normalize(raw_url: str) -> str:
    parsed = urllib.parse.urlparse(raw_url)
    if parsed.scheme not in {"http", "https"}:
        return ""
    path = parsed.path or "/"
    if parsed.netloc != source_parsed.netloc:
        return ""
    if not path.startswith(source_prefix):
        return ""
    for excluded_prefix in exclude_prefixes:
        if path == excluded_prefix.rstrip("/") or path.startswith(excluded_prefix):
            return ""
    normalized = parsed._replace(path=path, params="", query="", fragment="")
    return urllib.parse.urlunparse(normalized)


body = file_path.read_text(encoding="utf-8", errors="ignore")
lower_path = urllib.parse.urlparse(current_url).path.lower()
looks_like_html = lower_path.endswith("/") or lower_path.endswith(".html") or lower_path.endswith(".htm")
if not looks_like_html:
    probe = body[:600].lower()
    if "<html" in probe or "<!doctype html" in probe:
        looks_like_html = True
looks_like_css = lower_path.endswith(".css")

found = set()
if looks_like_html:
    parser = LinkParser()
    parser.feed(body)
    for candidate in parser.links:
        value = str(candidate or "").strip()
        if not value:
            continue
        lowered = value.lower()
        if lowered.startswith(("javascript:", "mailto:", "data:", "#")):
            continue
        absolute = urllib.parse.urljoin(current_url, value)
        normalized = normalize(absolute)
        if normalized:
            found.add(normalized)

if looks_like_css:
    for candidate in re.findall(r"url\(([^)]+)\)", body, flags=re.IGNORECASE):
        value = str(candidate or "").strip().strip("'\"")
        if not value:
            continue
        lowered = value.lower()
        if lowered.startswith(("javascript:", "mailto:", "data:", "#")):
            continue
        absolute = urllib.parse.urljoin(current_url, value)
        normalized = normalize(absolute)
        if normalized:
            found.add(normalized)

for link in sorted(found):
    print(link)
PY

      while IFS= read -r discovered_url; do
        [[ -n "$discovered_url" ]] || continue
        if grep -Fqx "$discovered_url" "$CRAWL_SEEN_FILE"; then
          continue
        fi
        if grep -Fqx "$discovered_url" "$CRAWL_QUEUE_FILE"; then
          continue
        fi
        if grep -Fqx "$discovered_url" "$CRAWL_NEXT_FILE"; then
          continue
        fi
        printf '%s\n' "$discovered_url" >> "$CRAWL_NEXT_FILE"
      done < "$CRAWL_LINKS_FILE"
    done < "$CRAWL_QUEUE_FILE"
    sort -u "$CRAWL_NEXT_FILE" > "$CRAWL_QUEUE_FILE"
  done

  seen_count="$(wc -l < "$CRAWL_SEEN_FILE" | tr -d '[:space:]')"
  echo "Crawler mirror complete: fetched=$fetched_count urls=$seen_count"

  FALLBACK_MIRROR_ROOT="$TMP_DIR"
  if [[ -n "$SOURCE_PATH" ]]; then
    FALLBACK_MIRROR_ROOT="$TMP_DIR/$SOURCE_PATH"
  fi

  if [[ "$FETCH_SOURCE_COMPANIONS" -eq 1 && -d "$FALLBACK_MIRROR_ROOT" ]]; then
    echo "Fetching _sources companions for fallback mirror"
    while IFS= read -r html_file; do
      rel_path="${html_file#$FALLBACK_MIRROR_ROOT/}"
      [[ "$rel_path" == "$html_file" ]] && continue
      [[ "$rel_path" == _static/* ]] && continue
      [[ "$rel_path" == _sources/* ]] && continue

      slug="${rel_path%.html}"
      if [[ "$rel_path" == "index.html" ]]; then
        slug="index"
      elif [[ "$rel_path" == */index.html ]]; then
        slug="${rel_path%.html}"
      fi

      if [[ -z "$slug" ]]; then
        continue
      fi

      for ext in rst md; do
        source_text_url="${SOURCE_URL}_sources/${slug}.${ext}.txt"
        dest_text_path="$FALLBACK_MIRROR_ROOT/_sources/${slug}.${ext}.txt"
        mkdir -p "$(dirname "$dest_text_path")"
        if curl -fsSL \
          --retry 2 \
          --retry-delay 1 \
          --connect-timeout 20 \
          --max-time 60 \
          "$source_text_url" \
          -o "$dest_text_path"; then
          break
        fi
      done
    done < <(find "$FALLBACK_MIRROR_ROOT" -type f -name '*.html' -print)
  fi
fi

MIRROR_ROOT="$TMP_DIR"
if [[ -n "$SOURCE_PATH" ]]; then
  MIRROR_ROOT="$TMP_DIR/$SOURCE_PATH"
fi
[[ -d "$MIRROR_ROOT" ]] || fail "Downloaded mirror root not found: $MIRROR_ROOT"
[[ -f "$MIRROR_ROOT/index.html" ]] || fail "Downloaded mirror missing index.html: $MIRROR_ROOT/index.html"

RSYNC_ARGS=(-a --delete --exclude ".DS_Store" --exclude ".crawl-*")
for keep_path in "${KEEP_PATHS[@]}"; do
  RSYNC_ARGS+=(--exclude "$keep_path")
done

rsync "${RSYNC_ARGS[@]}" "$MIRROR_ROOT/" "$DOCS_DIR/"

if [[ -n "$BRIDGE_DOC_OPTIONS" ]]; then
  mkdir -p "$DOCS_DIR/_static"
  cp "$BRIDGE_DOC_OPTIONS" "$DOCS_DIR/_static/documentation_options.js"
elif [[ ! -f "$DOCS_DIR/_static/documentation_options.js" && -f "$MIRROR_ROOT/_static/documentation_options.js" ]]; then
  mkdir -p "$DOCS_DIR/_static"
  cp "$MIRROR_ROOT/_static/documentation_options.js" "$DOCS_DIR/_static/documentation_options.js"
fi

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
fi

LATEST_RELEASE_JSON="$(curl -fsSL \
  --retry 3 \
  --retry-delay 2 \
  --connect-timeout 10 \
  --max-time 20 \
  https://api.github.com/repos/llvm/llvm-project/releases/latest 2>/dev/null || true)"

LLVM_DOCS_LATEST_RELEASE_JSON="$LATEST_RELEASE_JSON" python3 - "$DOCS_DIR" "$SOURCE_URL" "$SOURCE_REPO" "$SOURCE_REF" "$SOURCE_COMMIT_PATH" "$LATEST_SOURCE_REVISION" <<'PY'
import datetime
import json
import os
import pathlib
import sys

docs_dir = pathlib.Path(sys.argv[1])
source_url = sys.argv[2]
source_repo = str(sys.argv[3] or "").strip()
source_ref = str(sys.argv[4] or "").strip()
source_commit_path = str(sys.argv[5] or "").strip().strip("/")
source_revision = str(sys.argv[6] or "").strip()
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

existing = {}
if meta_path.exists():
    try:
        loaded = json.loads(meta_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            existing = loaded
    except Exception:
        existing = {}

if not source_repo:
    source_repo = str(existing.get("sourceRepo", "")).strip()
if not source_ref:
    source_ref = str(existing.get("sourceRef", "")).strip()
if not source_commit_path:
    source_commit_path = str(existing.get("sourceCommitPath", "")).strip().strip("/")
if not source_revision:
    source_revision = str(existing.get("sourceRevision", "")).strip()

payload = {
    "sourceUrl": source_url,
    "syncedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    "generator": "scripts/sync-docs-from-llvm-org.sh",
}
if latest_release:
    payload["latestRelease"] = latest_release
elif isinstance(existing.get("latestRelease"), dict):
    payload["latestRelease"] = existing["latestRelease"]
if source_repo:
    payload["sourceRepo"] = source_repo
if source_ref:
    payload["sourceRef"] = source_ref
if source_commit_path:
    payload["sourceCommitPath"] = source_commit_path
if source_revision:
    payload["sourceRevision"] = source_revision

meta_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
PY

echo "Docs mirror sync complete."
