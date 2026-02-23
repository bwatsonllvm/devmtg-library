#!/usr/bin/env python3
"""Normalize URL-bearing fields in library JSON bundles.

This script performs a one-time cleanup pass over:
  - devmtg/events/*.json
  - papers/*.json
  - updates/index.json

It removes placeholder URL strings, repairs common malformed values, and
enforces safe http/https URL schemes for external links.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import urllib.parse
from pathlib import Path

PLACEHOLDER_URL_VALUES = {"none", "null", "nil", "nan", "n/a", "na", "undefined"}
TRAILING_JUNK_CHARS = ",;>"


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def is_placeholder_url_value(value: str | None) -> bool:
    return collapse_ws(str(value or "")).lower() in PLACEHOLDER_URL_VALUES


def normalize_raw_url_text(value: str | None) -> str:
    text = collapse_ws(html.unescape(str(value or "")))
    if not text:
        return ""
    if is_placeholder_url_value(text):
        return ""

    if len(text) >= 2 and text[0] == text[-1] and text[0] in {"'", '"', "`"}:
        text = text[1:-1].strip()

    if text.startswith("<") and text.endswith(">"):
        text = text[1:-1].strip()

    while text and text[-1] in TRAILING_JUNK_CHARS:
        text = text[:-1].rstrip()

    if is_placeholder_url_value(text):
        return ""
    return text


def maybe_prefix_scheme(value: str) -> str:
    text = value
    if text.startswith("//"):
        return f"https:{text}"
    if re.match(r"^www\.", text, flags=re.IGNORECASE):
        return f"https://{text}"
    if re.match(r"^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)", text, flags=re.IGNORECASE):
        return f"https://{text}"
    return text


def _encode_url_parts(parsed: urllib.parse.SplitResult) -> urllib.parse.SplitResult:
    path = urllib.parse.quote(urllib.parse.unquote(parsed.path or ""), safe="/:@!$&'()*+,;=-._~")
    query = urllib.parse.quote(
        urllib.parse.unquote(parsed.query or ""),
        safe="=&/:?+,%@!$'()*;,-._~",
    )
    fragment = urllib.parse.quote(
        urllib.parse.unquote(parsed.fragment or ""),
        safe="=&/:?+,%@!$'()*;,-._~",
    )
    return urllib.parse.SplitResult(parsed.scheme, parsed.netloc, path, query, fragment)


def sanitize_external_http_url(value: str | None) -> str:
    text = normalize_raw_url_text(value)
    if not text:
        return ""
    text = maybe_prefix_scheme(text)

    try:
        parsed = urllib.parse.urlsplit(text)
    except Exception:
        return ""

    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"}:
        return ""
    if not parsed.netloc:
        return ""
    if "@" in parsed.netloc:
        return ""

    encoded = _encode_url_parts(parsed)
    return urllib.parse.urlunsplit((scheme, encoded.netloc, encoded.path, encoded.query, encoded.fragment))


def sanitize_link_url(value: str | None) -> str:
    text = normalize_raw_url_text(value)
    if not text:
        return ""
    if text.startswith("#"):
        return text
    if text.startswith("//"):
        return sanitize_external_http_url(f"https:{text}")
    if re.match(r"^[a-z][a-z0-9+.-]*:", text, flags=re.IGNORECASE):
        return sanitize_external_http_url(text)

    try:
        parsed = urllib.parse.urlsplit(text)
    except Exception:
        return ""

    if parsed.scheme or parsed.netloc:
        return ""

    normalized_path = normalize_internal_library_path(parsed.path or "")
    normalized = urllib.parse.SplitResult("", "", normalized_path, parsed.query, parsed.fragment)
    encoded = _encode_url_parts(normalized)
    return urllib.parse.urlunsplit(("", "", encoded.path, encoded.query, encoded.fragment))


def normalize_internal_library_path(path: str) -> str:
    raw_path = str(path or "")
    if raw_path.startswith("/devmtg/"):
        raw_path = raw_path[len("/devmtg/") :]
    elif raw_path.startswith("/"):
        raw_path = raw_path[1:]

    aliases = {
        "talk.html": "talks/talk.html",
        "paper.html": "papers/paper.html",
        "events.html": "talks/events.html",
        "papers.html": "papers/",
        "blogs.html": "blogs/",
        "people.html": "people/",
        "about.html": "about/",
        "updates.html": "updates/",
    }
    normalized_key = raw_path.lower()
    return aliases.get(normalized_key, raw_path)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: dict) -> bool:
    current = path.read_text(encoding="utf-8")
    updated = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if current == updated:
        return False
    path.write_text(updated, encoding="utf-8")
    return True


def sanitize_external_field(obj: dict, field: str) -> bool:
    previous = field in obj
    current = str(obj.get(field, ""))
    safe = sanitize_external_http_url(current)
    if safe:
        obj[field] = safe
        return (not previous) or safe != current
    if previous:
        obj.pop(field, None)
        return True
    return False


def sanitize_events(events_dir: Path) -> tuple[int, int]:
    changed_files = 0
    changed_fields = 0
    for path in sorted(events_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        payload = load_json(path)
        talks = payload.get("talks")
        if not isinstance(talks, list):
            continue

        file_changed = False
        for talk in talks:
            if not isinstance(talk, dict):
                continue
            for field in ("videoUrl", "slidesUrl", "projectGithub"):
                if sanitize_external_field(talk, field):
                    file_changed = True
                    changed_fields += 1

            speakers = talk.get("speakers")
            if not isinstance(speakers, list):
                continue
            for speaker in speakers:
                if not isinstance(speaker, dict):
                    continue
                for field in ("github", "linkedin", "twitter"):
                    if sanitize_external_field(speaker, field):
                        file_changed = True
                        changed_fields += 1

        if file_changed and write_json(path, payload):
            changed_files += 1

    return changed_files, changed_fields


def sanitize_papers(papers_dir: Path) -> tuple[int, int]:
    changed_files = 0
    changed_fields = 0
    for path in sorted(papers_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        payload = load_json(path)
        papers = payload.get("papers")
        if not isinstance(papers, list):
            continue

        file_changed = False
        for paper in papers:
            if not isinstance(paper, dict):
                continue
            for field in ("paperUrl", "sourceUrl", "openalexId"):
                if sanitize_external_field(paper, field):
                    file_changed = True
                    changed_fields += 1

        if file_changed and write_json(path, payload):
            changed_files += 1

    return changed_files, changed_fields


def sanitize_updates(updates_path: Path) -> tuple[int, int]:
    payload = load_json(updates_path)
    entries = payload.get("entries")
    if not isinstance(entries, list):
        return 0, 0

    changed_fields = 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue

        current_url = entry.get("url", "")
        safe_url = sanitize_link_url(str(current_url))
        if safe_url:
            if safe_url != str(current_url):
                changed_fields += 1
            entry["url"] = safe_url
        else:
            if str(current_url) != "updates/":
                changed_fields += 1
            entry["url"] = "updates/"

        for field in ("videoUrl", "slidesUrl", "paperUrl", "sourceUrl", "blogUrl"):
            if sanitize_external_field(entry, field):
                changed_fields += 1

    changed_file = 1 if write_json(updates_path, payload) else 0
    return changed_file, changed_fields


def main() -> int:
    default_root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=str(default_root))
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    events_dir = repo_root / "devmtg" / "events"
    papers_dir = repo_root / "papers"
    updates_path = repo_root / "updates" / "index.json"

    events_changed_files, events_changed_fields = sanitize_events(events_dir)
    papers_changed_files, papers_changed_fields = sanitize_papers(papers_dir)
    updates_changed_files, updates_changed_fields = sanitize_updates(updates_path)

    print(
        "Sanitized URL fields: "
        f"events files={events_changed_files}, events fields={events_changed_fields}; "
        f"papers files={papers_changed_files}, papers fields={papers_changed_fields}; "
        f"updates files={updates_changed_files}, updates fields={updates_changed_fields}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
