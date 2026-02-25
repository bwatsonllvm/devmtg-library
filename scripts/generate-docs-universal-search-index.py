#!/usr/bin/env python3
"""Generate a universal search index for mirrored LLVM docs.

The output is a browser-consumable JS payload:
  docs/_static/docs-universal-search-index.js

This index is intentionally compact but broad:
- one entry per mirrored docs HTML page
- title, outline/chapter metadata, top headings, summary, and searchable text
- built only from local mirrored docs artifacts (no network)
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import re
from html.parser import HTMLParser
from pathlib import Path

MAX_HEADINGS = 10
MAX_SUMMARY_CHARS = 280
MAX_SEARCH_CHARS = 6000
SKIP_HTML = {"search.html", "genindex.html", "py-modindex.html"}


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def truncate_text(value: str, limit: int) -> str:
    text = normalize_space(value)
    if len(text) <= limit:
        return text
    clipped = text[:limit].rstrip()
    if " " in clipped:
        clipped = clipped.rsplit(" ", 1)[0]
    return clipped.rstrip(".,;: ") + "..."


def slug_from_relpath(relpath: str) -> str:
    rel = relpath.strip("/")
    if rel == "index.html":
        return "index"
    if rel.endswith("/index.html"):
        return rel[: -len(".html")]
    if rel.endswith(".html"):
        return rel[: -len(".html")]
    return rel


def href_from_slug(slug: str) -> str:
    normalized = slug.strip("/")
    if not normalized or normalized == "index":
        return ""
    if normalized.endswith("/index"):
        return normalized[: -len("index")]
    return f"{normalized}.html"


def fallback_title_from_slug(slug: str) -> str:
    tail = slug.split("/")[-1]
    if tail == "index" and "/" in slug:
        tail = slug.split("/")[-2]
    text = tail.replace("-", " ").replace("_", " ").strip()
    return text.title() if text else "Documentation"


def clean_doc_title(title: str) -> str:
    value = normalize_space(title)
    value = re.sub(r"\s+[–—-]\s+(?:LLVM|Clang|LLDB).*$", "", value, flags=re.IGNORECASE).strip()
    value = re.sub(r"\s+documentation$", "", value, flags=re.IGNORECASE).strip()
    return value


class DocsPageParser(HTMLParser):
    """Extract title/headings/main-text from mirrored Sphinx HTML."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._in_title = False
        self._ignore_depth = 0
        self._main_depth = 0

        self.title_chunks: list[str] = []
        self.text_chunks: list[str] = []
        self.paragraphs: list[str] = []
        self.headings: list[dict[str, object]] = []

        self._current_heading: dict[str, object] | None = None
        self._current_heading_chunks: list[str] = []
        self._current_paragraph_chunks: list[str] | None = None

    @staticmethod
    def _attr_map(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        out: dict[str, str] = {}
        for key, value in attrs:
            if value is None:
                continue
            out[key] = value
        return out

    @staticmethod
    def _is_main_body(tag: str, attrs: dict[str, str]) -> bool:
        if tag != "div":
            return False
        klass = set(attrs.get("class", "").split())
        role = attrs.get("role", "")
        return "body" in klass and role == "main"

    def _capture_text(self, data: str) -> None:
        if self._ignore_depth > 0:
            return
        text = normalize_space(data)
        if not text:
            return
        if self._main_depth > 0:
            self.text_chunks.append(text)
            if self._current_paragraph_chunks is not None:
                self._current_paragraph_chunks.append(text)
            if self._current_heading is not None:
                self._current_heading_chunks.append(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_map = self._attr_map(attrs)

        if tag in {"script", "style", "noscript"}:
            self._ignore_depth += 1

        if tag == "title":
            self._in_title = True

        if self._is_main_body(tag, attrs_map):
            self._main_depth = 1
            return

        if self._main_depth > 0:
            self._main_depth += 1

            if tag == "p":
                self._current_paragraph_chunks = []

            if tag in {"h1", "h2", "h3", "h4"}:
                level = int(tag[1])
                heading_id = attrs_map.get("id", "")
                self._current_heading = {
                    "level": level,
                    "anchor": heading_id,
                }
                self._current_heading_chunks = []

            if tag == "a" and self._current_heading is not None:
                href = attrs_map.get("href", "")
                if href.startswith("#") and not self._current_heading.get("anchor"):
                    self._current_heading["anchor"] = href[1:]

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

        if tag in {"script", "style", "noscript"} and self._ignore_depth > 0:
            self._ignore_depth -= 1

        if self._main_depth > 0:
            if tag == "p" and self._current_paragraph_chunks is not None:
                paragraph = normalize_space(" ".join(self._current_paragraph_chunks))
                if paragraph:
                    self.paragraphs.append(paragraph)
                self._current_paragraph_chunks = None

            if tag in {"h1", "h2", "h3", "h4"} and self._current_heading is not None:
                heading_text = normalize_space(" ".join(self._current_heading_chunks)).replace("¶", "").strip()
                if heading_text:
                    self.headings.append(
                        {
                            "text": heading_text,
                            "level": int(self._current_heading.get("level", 2)),
                            "anchor": str(self._current_heading.get("anchor", "") or ""),
                        }
                    )
                self._current_heading = None
                self._current_heading_chunks = []

            self._main_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._in_title and self._ignore_depth == 0:
            text = normalize_space(data)
            if text:
                self.title_chunks.append(text)
        self._capture_text(data)


def parse_book_outline_map(book_index_path: Path) -> dict[str, dict[str, str]]:
    if not book_index_path.is_file():
        return {}

    text = book_index_path.read_text(encoding="utf-8", errors="ignore")
    match = re.search(
        r"window\.LLVMDocsBookIndex\s*=\s*(\{.*\})\s*;\s*$",
        text,
        flags=re.DOTALL,
    )
    if not match:
        return {}

    try:
        payload = json.loads(match.group(1))
    except Exception:  # noqa: BLE001
        return {}

    chapters = payload.get("chapters") if isinstance(payload, dict) else None
    if not isinstance(chapters, list):
        return {}

    out: dict[str, dict[str, str]] = {}

    def register_slug(raw_slug: str, chapter_title: str, outline_number: str) -> None:
        slug = raw_slug.strip("/")
        if not slug:
            return
        if slug not in out:
            out[slug] = {
                "chapter": chapter_title,
                "outline": outline_number,
            }
        if slug.endswith("/index"):
            alt = slug[: -len("/index")]
            if alt and alt not in out:
                out[alt] = {
                    "chapter": chapter_title,
                    "outline": outline_number,
                }

    def walk_nodes(nodes: list[object], chapter_title: str, prefix: str) -> None:
        for idx, node in enumerate(nodes, start=1):
            if not isinstance(node, dict):
                continue
            number = f"{prefix}.{idx}" if prefix else str(idx)
            slug = str(node.get("slug", "")).strip()
            if slug:
                register_slug(slug, chapter_title, number)
            children = node.get("children")
            if isinstance(children, list) and children:
                walk_nodes(children, chapter_title, number)

    for chapter_index, chapter in enumerate(chapters, start=1):
        if not isinstance(chapter, dict):
            continue
        chapter_title = normalize_space(str(chapter.get("title", "") or f"Chapter {chapter_index}"))
        entries = chapter.get("entries")
        if not isinstance(entries, list):
            continue
        walk_nodes(entries, chapter_title, str(chapter_index))

    return out


def build_entry_for_html(html_path: Path, docs_root: Path, outline_map: dict[str, dict[str, str]]) -> dict[str, object] | None:
    relpath = html_path.relative_to(docs_root).as_posix()
    if relpath in SKIP_HTML:
        return None
    if relpath.startswith("_"):
        return None

    raw = html_path.read_text(encoding="utf-8", errors="ignore")
    parser = DocsPageParser()
    parser.feed(raw)

    slug = slug_from_relpath(relpath)
    title_raw = normalize_space(" ".join(parser.title_chunks))
    title = clean_doc_title(html.unescape(title_raw)) or fallback_title_from_slug(slug)

    headings: list[dict[str, object]] = []
    seen_heading_keys: set[tuple[str, str]] = set()
    for heading in parser.headings:
        text = normalize_space(str(heading.get("text", "")))
        if not text:
            continue
        anchor = normalize_space(str(heading.get("anchor", "")))
        key = (text.lower(), anchor.lower())
        if key in seen_heading_keys:
            continue
        seen_heading_keys.add(key)
        headings.append(
            {
                "text": text,
                "level": int(heading.get("level", 2)),
                "anchor": anchor,
            }
        )
        if len(headings) >= MAX_HEADINGS:
            break

    body_text = normalize_space(" ".join(parser.text_chunks))
    if not body_text:
        # Fallback for malformed pages lacking expected Sphinx main body structure.
        body_text = normalize_space(re.sub(r"<[^>]+>", " ", raw))

    paragraphs = [normalize_space(p) for p in parser.paragraphs if normalize_space(p)]
    summary = ""
    for paragraph in paragraphs:
        if len(paragraph) >= 40:
            summary = paragraph
            break
    if not summary:
        summary = body_text
    summary = truncate_text(summary, MAX_SUMMARY_CHARS)

    heading_search = " ".join(item["text"] for item in headings if isinstance(item, dict) and item.get("text"))
    paragraph_search = " ".join(paragraphs[:4])
    search_blob = truncate_text(
        " ".join(
            segment
            for segment in [title, heading_search, paragraph_search, body_text]
            if normalize_space(segment)
        ),
        MAX_SEARCH_CHARS,
    )

    if not search_blob:
        return None

    outline = outline_map.get(slug) or outline_map.get(slug.replace("/index", "")) or {}

    entry: dict[str, object] = {
        "slug": slug,
        "href": href_from_slug(slug),
        "title": title,
        "summary": summary,
        "headings": headings,
        "search": search_blob,
    }

    chapter = normalize_space(str(outline.get("chapter", "")))
    outline_number = normalize_space(str(outline.get("outline", "")))
    if chapter:
        entry["chapter"] = chapter
    if outline_number:
        entry["outline"] = outline_number

    return entry


def collect_entries(docs_root: Path, outline_map: dict[str, dict[str, str]]) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    html_files = sorted(docs_root.rglob("*.html"), key=lambda p: p.relative_to(docs_root).as_posix())
    for html_path in html_files:
        entry = build_entry_for_html(html_path, docs_root, outline_map)
        if entry:
            entries.append(entry)
    return entries


def write_output(output_path: Path, payload: dict[str, object]) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    output = (
        "// Auto-generated by scripts/generate-docs-universal-search-index.py\n"
        f"window.LLVMDocsUniversalSearchIndex={serialized};\n"
    )
    output_path.write_text(output, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate universal search index payload for mirrored LLVM docs.")
    parser.add_argument(
        "--docs-root",
        default="docs",
        help="Path to mirrored docs root directory.",
    )
    parser.add_argument(
        "--book-index",
        default="docs/_static/docs-book-index.js",
        help="Path to generated docs book index JS payload.",
    )
    parser.add_argument(
        "--output",
        default="docs/_static/docs-universal-search-index.js",
        help="Output JS payload path.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent

    docs_root = (repo_root / args.docs_root).resolve()
    if not docs_root.is_dir():
        raise SystemExit(f"Missing docs root: {docs_root}")

    book_index_path = (repo_root / args.book_index).resolve()
    output_path = (repo_root / args.output).resolve()

    outline_map = parse_book_outline_map(book_index_path)
    entries = collect_entries(docs_root, outline_map)

    payload = {
        "meta": {
            "generatedAt": dt.datetime.now(dt.timezone.utc)
            .replace(microsecond=0)
            .isoformat()
            .replace("+00:00", "Z"),
            "entryCount": len(entries),
            "source": "scripts/generate-docs-universal-search-index.py",
        },
        "entries": entries,
    }
    write_output(output_path, payload)

    print(
        "Generated docs universal search index:",
        f"entries={len(entries)}",
        f"outlined={len(outline_map)}",
        f"output={output_path}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
