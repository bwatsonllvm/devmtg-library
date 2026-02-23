#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIBRARY="$ROOT/devmtg"
PAPERS="$ROOT/papers"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -d "$LIBRARY" ] || fail "Missing devmtg directory"
for f in index.html events.html talk.html paper.html papers.html updates.html css/style.css js/app.js js/events-data.js js/meetings.js js/talk.js js/paper.js js/papers-data.js js/papers.js js/updates.js js/shared/library-utils.js images/llvm-logo.png events/index.json updates/index.json; do
  [ -f "$LIBRARY/$f" ] || fail "Missing required file: devmtg/$f"
done
[ -d "$PAPERS" ] || fail "Missing papers directory"
[ -f "$PAPERS/index.json" ] || fail "Missing required file: papers/index.json"

# Ensure events are JSON-native
if find "$LIBRARY/events" -maxdepth 1 -name '*.md' | grep -q .; then
  fail "Found markdown event files in devmtg/events; expected JSON-only"
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

# Validate updates log JSON
ruby -rjson -e '
  hub = ARGV.fetch(0)
  path = File.join(hub, "updates", "index.json")
  payload = JSON.parse(File.read(path))
  abort("updates/index.json must contain an object") unless payload.is_a?(Hash)
  abort("updates/index.json missing dataVersion") if String(payload["dataVersion"]).strip.empty?
  abort("updates/index.json missing generatedAt") if String(payload["generatedAt"]).strip.empty?
  entries = payload["entries"]
  abort("updates/index.json missing entries array") unless entries.is_a?(Array)
  entries.each_with_index do |entry, idx|
    abort("updates/index.json entry #{idx} must be object") unless entry.is_a?(Hash)
    abort("updates/index.json entry #{idx} missing kind") if String(entry["kind"]).strip.empty?
    abort("updates/index.json entry #{idx} missing title") if String(entry["title"]).strip.empty?
    abort("updates/index.json entry #{idx} missing url") if String(entry["url"]).strip.empty?
  end
' "$LIBRARY"

# Validate papers manifest points to existing json files
ruby -rjson -e '
  papers_root = ARGV.fetch(0)
  idx_path = File.join(papers_root, "index.json")
  idx = JSON.parse(File.read(idx_path))
  files = Array(idx["paperFiles"])
  abort("papers/index.json has empty paperFiles") if files.empty?
  missing = []
  files.each do |f|
    missing << f unless File.exist?(File.join(papers_root, f))
    abort("papers/index.json contains non-json entry: #{f}") unless f.end_with?(".json")
  end
  unless missing.empty?
    abort("Missing paper files: #{missing.join(", ")}")
  end
' "$PAPERS"

# Validate every papers/*.json parses
ruby -rjson -e '
  papers_root = ARGV.fetch(0)
  Dir[File.join(papers_root, "*.json")].each do |f|
    JSON.parse(File.read(f))
  end
' "$PAPERS"

# Validate URL-bearing fields only use safe URL schemes
ruby -rjson -ruri -e '
  hub = ARGV.fetch(0)
  papers_root = ARGV.fetch(1)
  PLACEHOLDER_URL_VALUES = %w[none null nil nan n/a na undefined].freeze

  def valid_http_url?(value)
    uri = URI.parse(String(value))
    %w[http https].include?(String(uri.scheme).downcase) && !String(uri.host).strip.empty?
  rescue URI::InvalidURIError
    false
  end

  def valid_linkish_url?(value)
    text = String(value).strip
    return false if text.empty?
    return false if PLACEHOLDER_URL_VALUES.include?(text.downcase)
    return false if text.match?(/\s/)
    return true if text.start_with?("#")
    return valid_http_url?("https:#{text}") if text.start_with?("//")
    return valid_http_url?(text) if text =~ /\A[a-z][a-z0-9+.-]*:/i
    true
  end

  bad = []

  Dir[File.join(hub, "events", "*.json")].each do |event_path|
    payload = JSON.parse(File.read(event_path))
    talks = Array(payload["talks"])
    talks.each_with_index do |talk, idx|
      next unless talk.is_a?(Hash)
      {
        "videoUrl" => talk["videoUrl"],
        "slidesUrl" => talk["slidesUrl"],
        "projectGithub" => talk["projectGithub"],
      }.each do |field, value|
        text = String(value).strip
        next if text.empty?
        bad << "#{File.basename(event_path)} talks[#{idx}].#{field}=#{text}" unless valid_http_url?(text)
      end

      Array(talk["speakers"]).each_with_index do |speaker, sidx|
        next unless speaker.is_a?(Hash)
        {"github" => speaker["github"], "linkedin" => speaker["linkedin"], "twitter" => speaker["twitter"]}.each do |field, value|
          text = String(value).strip
          next if text.empty?
          bad << "#{File.basename(event_path)} talks[#{idx}].speakers[#{sidx}].#{field}=#{text}" unless valid_http_url?(text)
        end
      end
    end
  end

  Dir[File.join(papers_root, "*.json")].each do |paper_path|
    payload = JSON.parse(File.read(paper_path))
    papers = Array(payload["papers"])
    papers.each_with_index do |paper, idx|
      next unless paper.is_a?(Hash)
      {"paperUrl" => paper["paperUrl"], "sourceUrl" => paper["sourceUrl"], "openalexId" => paper["openalexId"]}.each do |field, value|
        text = String(value).strip
        next if text.empty?
        bad << "#{File.basename(paper_path)} papers[#{idx}].#{field}=#{text}" unless valid_http_url?(text)
      end
    end
  end

  updates_path = File.join(hub, "updates", "index.json")
  updates_payload = JSON.parse(File.read(updates_path))
  entries = Array(updates_payload["entries"])
  entries.each_with_index do |entry, idx|
    next unless entry.is_a?(Hash)
    url_text = String(entry["url"]).strip
    bad << "updates/index.json entries[#{idx}].url=#{url_text}" unless valid_linkish_url?(url_text)
    {"videoUrl" => entry["videoUrl"], "slidesUrl" => entry["slidesUrl"], "paperUrl" => entry["paperUrl"], "sourceUrl" => entry["sourceUrl"], "blogUrl" => entry["blogUrl"]}.each do |field, value|
      text = String(value).strip
      next if text.empty?
      bad << "updates/index.json entries[#{idx}].#{field}=#{text}" unless valid_http_url?(text)
    end
  end

  unless bad.empty?
    warn("Unsafe URL fields:\n" + bad.join("\n"))
    exit 1
  end
' "$LIBRARY" "$PAPERS"

# Validate local asset references in html files
ruby -e '
  hub = ARGV.fetch(0)
  html_files = %w[index.html events.html talk.html paper.html papers.html updates.html].map { |f| File.join(hub, f) }
  bad = []
  html_files.each do |html|
    text = File.read(html)
    refs = text.scan(/(?:src|href)=\"([^\"]+)\"/).flatten
    refs.each do |ref|
      if ref.start_with?("javascript:", "data:")
        bad << "#{File.basename(html)} -> unsafe scheme #{ref}"
        next
      end
      next if ref.start_with?("http://", "https://", "#", "mailto:")
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

echo "OK: library bundle validation passed"
