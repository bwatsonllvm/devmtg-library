#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBRARY="$ROOT/devmtg/library"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -d "$LIBRARY" ] || fail "Missing devmtg/library directory"
for f in index.html meetings.html talk.html css/style.css js/app.js js/events-data.js js/meetings.js js/talk.js js/shared/library-utils.js images/llvm-logo.png events/index.json; do
  [ -f "$LIBRARY/$f" ] || fail "Missing required file: devmtg/library/$f"
done

# Ensure events are JSON-native
if find "$LIBRARY/events" -maxdepth 1 -name '*.md' | grep -q .; then
  fail "Found markdown event files in devmtg/library/events; expected JSON-only"
fi

# Validate index manifest points to existing json files
ruby -rjson -e '
  hub = ARGV.fetch(0)
  idx_path = File.join(hub, "events", "index.json")
  idx = JSON.parse(File.read(idx_path))
  files = Array(idx["eventFiles"])
  abort("index.json has empty eventFiles") if files.empty?
  missing = []
  files.each do |f|
    missing << f unless File.exist?(File.join(hub, "events", f))
    abort("index.json contains non-json entry: #{f}") unless f.end_with?(".json")
  end
  unless missing.empty?
    abort("Missing event files: #{missing.join(", ")}")
  end
' "$LIBRARY"

# Validate every events/*.json parses
ruby -rjson -e '
  hub = ARGV.fetch(0)
  Dir[File.join(hub, "events", "*.json")].each do |f|
    JSON.parse(File.read(f))
  end
' "$LIBRARY"

# Validate local asset references in html files
ruby -e '
  hub = ARGV.fetch(0)
  html_files = %w[index.html meetings.html talk.html].map { |f| File.join(hub, f) }
  bad = []
  html_files.each do |html|
    text = File.read(html)
    refs = text.scan(/(?:src|href)=\"([^\"]+)\"/).flatten
    refs.each do |ref|
      next if ref.start_with?("http://", "https://", "#", "mailto:", "javascript:", "data:")
      next if ref.start_with?("?")
      clean = ref.split("?").first
      next if clean.empty?
      path = File.expand_path(clean, File.dirname(html))
      bad << "#{File.basename(html)} -> #{ref}" unless File.exist?(path)
    end
  end
  unless bad.empty?
    warn("Broken local references:\n" + bad.join("\n"))
    exit 1
  end
' "$LIBRARY"

echo "OK: llvm-www-ready bundle validation passed"
