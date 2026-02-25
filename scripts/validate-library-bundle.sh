#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SITE_ROOT="$ROOT"
EVENTS_ROOT="$ROOT/devmtg/events"
UPDATES_ROOT="$ROOT/updates"
PAPERS_ROOT="$ROOT/papers"

fail() { echo "ERROR: $*" >&2; exit 1; }

[ -d "$SITE_ROOT" ] || fail "Missing repository root: $SITE_ROOT"
[ -d "$EVENTS_ROOT" ] || fail "Missing events directory: devmtg/events"
[ -d "$UPDATES_ROOT" ] || fail "Missing updates directory: updates"
[ -d "$PAPERS_ROOT" ] || fail "Missing papers directory: papers"

for f in \
  index.html \
  work.html \
  talks/index.html \
  talks/events.html \
  talks/talk.html \
  papers/index.html \
  papers/paper.html \
  blogs/index.html \
  people/index.html \
  about/index.html \
  docs/index.html \
  docs/clang/index.html \
  docs/lldb/index.html \
  docs/sources.json \
  updates/index.html \
  updates/index.json \
  css/style.css \
  js/app.js \
  js/events-data.js \
  js/meetings.js \
  js/talk.js \
  js/paper.js \
  js/papers-data.js \
  js/papers.js \
  js/updates.js \
  js/docs.js \
  js/shared/library-utils.js \
  images/llvm-logo.png \
  images/llvm-favicon.png \
  devmtg/events/index.json; do
  [ -f "$SITE_ROOT/$f" ] || fail "Missing required file: $f"
done
[ -f "$PAPERS_ROOT/index.json" ] || fail "Missing required file: papers/index.json"

# Ensure event bundles are JSON-native.
if find "$EVENTS_ROOT" -maxdepth 1 -name '*.md' | grep -q .; then
  fail "Found markdown event files in devmtg/events; expected JSON-only"
fi

# Validate event manifest points to existing JSON files.
ruby -rjson -e '
  events_root = ARGV.fetch(0)
  idx_path = File.join(events_root, "index.json")
  idx = JSON.parse(File.read(idx_path))
  files = Array(idx["eventFiles"])
  abort("devmtg/events/index.json has empty eventFiles") if files.empty?
  missing = []
  files.each do |f|
    missing << f unless File.exist?(File.join(events_root, f))
    abort("devmtg/events/index.json contains non-json entry: #{f}") unless f.end_with?(".json")
  end
  unless missing.empty?
    abort("Missing event files: #{missing.join(", ")}")
  end
' "$EVENTS_ROOT"

# Validate every devmtg/events/*.json parses.
ruby -rjson -ruri -e '
  events_root = ARGV.fetch(0)
  Dir[File.join(events_root, "*.json")].each do |f|
    JSON.parse(File.read(f))
  end
' "$EVENTS_ROOT"

# Validate updates log JSON.
ruby -rjson -e '
  updates_root = ARGV.fetch(0)
  path = File.join(updates_root, "index.json")
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
    topics = entry["keyTopics"]
    abort("updates/index.json entry #{idx} missing keyTopics array") unless topics.is_a?(Array)
    abort("updates/index.json entry #{idx} keyTopics must not be empty") if topics.empty?
    topics.each_with_index do |topic, tidx|
      label = String(topic).strip
      abort("updates/index.json entry #{idx} keyTopics[#{tidx}] must be non-empty string") if label.empty?
    end
  end
' "$UPDATES_ROOT"

# Validate docs sources catalog JSON.
ruby -rjson -e '
  path = ARGV.fetch(0)
  payload = JSON.parse(File.read(path))
  abort("docs/sources.json must contain an object") unless payload.is_a?(Hash)
  sources = payload["sources"]
  abort("docs/sources.json must contain a non-empty sources array") unless sources.is_a?(Array) && !sources.empty?

  sources.each_with_index do |source, idx|
    abort("docs/sources.json sources[#{idx}] must be an object") unless source.is_a?(Hash)
    id = String(source["id"]).strip
    name = String(source["name"]).strip
    docs_url = String(source["docsUrl"]).strip
    search_url = String(source["searchUrlTemplate"]).strip
    abort("docs/sources.json sources[#{idx}] missing id") if id.empty?
    abort("docs/sources.json sources[#{idx}] missing name") if name.empty?
    abort("docs/sources.json sources[#{idx}] missing docsUrl") if docs_url.empty?
    abort("docs/sources.json sources[#{idx}] missing searchUrlTemplate") if search_url.empty?
    [docs_url, search_url].each do |url|
      begin
        uri = URI.parse(url)
      rescue URI::InvalidURIError
        abort("docs/sources.json sources[#{idx}] has invalid URL: #{url}")
      end
      unless %w[http https].include?(String(uri.scheme).downcase) && !String(uri.host).strip.empty?
        abort("docs/sources.json sources[#{idx}] URL must be absolute http/https: #{url}")
      end
    end
  end
' "$SITE_ROOT/docs/sources.json"

# Validate papers manifest points to existing JSON files.
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
' "$PAPERS_ROOT"

# Validate every papers/*.json parses.
ruby -rjson -e '
  papers_root = ARGV.fetch(0)
  Dir[File.join(papers_root, "*.json")].each do |f|
    JSON.parse(File.read(f))
  end
' "$PAPERS_ROOT"

# Validate URL-bearing fields only use safe URL schemes.
ruby -rjson -ruri -e '
  events_root = ARGV.fetch(0)
  updates_root = ARGV.fetch(1)
  papers_root = ARGV.fetch(2)
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

  Dir[File.join(events_root, "*.json")].each do |event_path|
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

  updates_path = File.join(updates_root, "index.json")
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
' "$EVENTS_ROOT" "$UPDATES_ROOT" "$PAPERS_ROOT"

# Validate local asset references in HTML files.
ruby -e '
  site_root = ARGV.fetch(0)
  html_files = %w[
    index.html
    work.html
    talks/index.html
    talks/events.html
    talks/talk.html
    papers/index.html
    papers/paper.html
    blogs/index.html
    people/index.html
    about/index.html
    docs/index.html
    updates/index.html
  ].map { |f| File.join(site_root, f) }

  bad = []
  html_files.each do |html|
    text = File.read(html)
    base_href = text[/<base\s+href="([^"]+)"/i, 1]
    base_dir = File.dirname(html)
    if base_href && base_href !~ /\A[a-z][a-z0-9+.-]*:/i && !base_href.start_with?("//")
      base_dir = File.expand_path(base_href, File.dirname(html))
    end
    refs = text.scan(/(?:src|href)=\"([^\"]+)\"/).flatten
    refs.each do |ref|
      if ref.start_with?("javascript:", "data:")
        bad << "#{File.basename(html)} -> unsafe scheme #{ref}"
        next
      end
      next if ref.start_with?("http://", "https://", "#", "mailto:")
      next if ref.start_with?("?")
      clean = ref.split("#", 2).first.split("?", 2).first
      next if clean.empty?
      if clean.start_with?("/library/")
        clean = clean.sub(%r{\A/library/}, "")
        path = File.expand_path(clean, site_root)
      elsif clean.start_with?("/")
        clean = clean.sub(%r{\A/}, "")
        path = File.expand_path(clean, site_root)
      else
        path = File.expand_path(clean, base_dir)
      end
      bad << "#{File.basename(html)} -> #{ref}" unless File.exist?(path)
    end
  end
  unless bad.empty?
    warn("Broken local references:\n" + bad.join("\n"))
    exit 1
  end
' "$SITE_ROOT"

echo "OK: library bundle validation passed"
