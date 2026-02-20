#!/usr/bin/env python3
"""Build unified papers dataset from llvm-www-pubs PUBS list.

Inputs:
  - /tmp/llvm-www-pubs/pubs.js (default)
  - /tmp/llvm-www-pubs/*.html (for abstract extraction when present)
  - devmtg/js/app.js (for canonical talk tag vocabulary)

Outputs:
  - papers/index.json
  - papers/llvm-org-pubs.json
"""

from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlparse


PLACEHOLDER_ABSTRACT = "No abstract available in llvm.org/pubs metadata."
BASE_PUBS_URL = "https://llvm.org/pubs/"


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def strip_tags(value: str) -> str:
    if not value:
        return ""
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"</p\s*>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]+>", " ", value)
    return collapse_ws(html.unescape(value))


def parse_all_tags(app_js_path: Path) -> list[str]:
    text = app_js_path.read_text(encoding="utf-8")
    match = re.search(r"const\s+ALL_TAGS\s*=\s*\[(.*?)\];", text, flags=re.DOTALL)
    if not match:
        raise RuntimeError(f"Could not find ALL_TAGS in {app_js_path}")

    tags_raw = match.group(1)
    tags: list[str] = []
    for single, double in re.findall(r"'([^']+)'|\"([^\"]+)\"", tags_raw):
        tag = single or double
        tag = collapse_ws(tag)
        if tag:
            tags.append(tag)

    if not tags:
        raise RuntimeError("Parsed empty ALL_TAGS list")
    return tags


def extract_array_literal(js_text: str, var_name: str) -> str:
    idx = js_text.find(f"var {var_name}")
    if idx < 0:
        raise RuntimeError(f"Could not find 'var {var_name}' in JS source")

    start = js_text.find("[", idx)
    if start < 0:
        raise RuntimeError("Could not find array start '['")

    depth = 0
    i = start
    in_str = False
    str_quote = ""
    escaped = False

    while i < len(js_text):
        ch = js_text[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == str_quote:
                in_str = False
        else:
            if ch in ('"', "'"):
                in_str = True
                str_quote = ch
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    return js_text[start : i + 1]
        i += 1

    raise RuntimeError("Could not find matching array closing bracket")


def parse_js_string(src: str, pos: int) -> tuple[str, int]:
    quote = src[pos]
    assert quote in ('"', "'")
    pos += 1
    out: list[str] = []
    escaped = False

    while pos < len(src):
        ch = src[pos]
        if escaped:
            if ch == "n":
                out.append("\n")
            elif ch == "t":
                out.append("\t")
            elif ch == "r":
                out.append("\r")
            else:
                out.append(ch)
            escaped = False
            pos += 1
            continue

        if ch == "\\":
            escaped = True
            pos += 1
            continue

        if ch == quote:
            return "".join(out), pos + 1

        out.append(ch)
        pos += 1

    raise RuntimeError("Unterminated JS string literal")


def skip_ws(src: str, pos: int) -> int:
    while pos < len(src) and src[pos].isspace():
        pos += 1
    return pos


def parse_identifier(src: str, pos: int) -> tuple[str, int]:
    start = pos
    while pos < len(src) and re.match(r"[A-Za-z0-9_$]", src[pos]):
        pos += 1
    if pos == start:
        raise RuntimeError(f"Expected identifier at {pos}")
    return src[start:pos], pos


def parse_value(src: str, pos: int):
    pos = skip_ws(src, pos)
    if pos >= len(src):
        raise RuntimeError("Unexpected EOF while parsing value")

    ch = src[pos]
    if ch in ('"', "'"):
        parts: list[str] = []
        end = pos
        while True:
            value, end = parse_js_string(src, end)
            parts.append(value)
            end = skip_ws(src, end)
            if end < len(src) and src[end] == "+":
                end = skip_ws(src, end + 1)
                if end < len(src) and src[end] in ('"', "'"):
                    continue
                raise RuntimeError(f"Expected string literal after '+' at {end}")
            break
        return "".join(parts), end

    if ch == "-" or ch.isdigit():
        start = pos
        pos += 1
        while pos < len(src) and src[pos].isdigit():
            pos += 1
        raw = src[start:pos]
        try:
            return int(raw, 10), pos
        except ValueError as exc:
            raise RuntimeError(f"Invalid integer value: {raw}") from exc

    if src.startswith("true", pos):
        return True, pos + 4
    if src.startswith("false", pos):
        return False, pos + 5
    if src.startswith("null", pos):
        return None, pos + 4

    # Fallback: consume until comma/closing brace on the same nesting level.
    start = pos
    while pos < len(src) and src[pos] not in ",}":
        pos += 1
    return collapse_ws(src[start:pos]), pos


def parse_object(src: str, pos: int) -> tuple[dict, int]:
    if src[pos] != "{":
        raise RuntimeError(f"Expected '{{' at {pos}")
    pos += 1
    obj: dict = {}

    while pos < len(src):
        pos = skip_ws(src, pos)
        if pos < len(src) and src[pos] == "}":
            return obj, pos + 1

        key, pos = parse_identifier(src, pos)
        pos = skip_ws(src, pos)
        if pos >= len(src) or src[pos] != ":":
            raise RuntimeError(f"Expected ':' after key '{key}'")
        pos += 1

        value, pos = parse_value(src, pos)
        obj[key] = value

        pos = skip_ws(src, pos)
        if pos < len(src) and src[pos] == ",":
            pos += 1
            continue
        if pos < len(src) and src[pos] == "}":
            return obj, pos + 1

    raise RuntimeError("Unterminated object literal")


def parse_pubs_array(array_text: str) -> list[dict]:
    if not array_text.startswith("["):
        raise RuntimeError("Array text must start with '['")

    pos = 1
    out: list[dict] = []

    while pos < len(array_text):
        pos = skip_ws(array_text, pos)
        if pos >= len(array_text):
            break
        ch = array_text[pos]
        if ch == "]":
            return out
        if ch == ",":
            pos += 1
            continue
        if ch == "{":
            obj, pos = parse_object(array_text, pos)
            out.append(obj)
            continue

        # Unexpected token; skip one char to avoid infinite loops on comments.
        pos += 1

    raise RuntimeError("Array literal not closed")


def resolve_paper_url(raw_url: str) -> str:
    raw = collapse_ws(raw_url)
    if not raw:
        return ""
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
        return raw
    return urljoin(BASE_PUBS_URL, raw)


def is_pdf_url(raw_url: str) -> bool:
    return bool(re.search(r"\.pdf(?:$|[?#])", collapse_ws(raw_url), flags=re.IGNORECASE))


def local_html_candidates(src_repo: Path, raw_url: str) -> list[Path]:
    raw = collapse_ws(raw_url)
    if not raw:
        return []

    candidates: list[Path] = []

    def add_if(name: str):
        if not name:
            return
        path = (src_repo / name).resolve()
        if path.exists() and path.is_file():
            candidates.append(path)

    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
        parsed = urlparse(raw)
        basename = Path(parsed.path).name
        if basename:
            if basename.lower().endswith(".html"):
                add_if(basename)
            elif basename.lower().endswith(".pdf"):
                add_if(re.sub(r"\.pdf$", ".html", basename, flags=re.IGNORECASE))
        return candidates

    rel = raw.lstrip("/")
    if rel.lower().endswith(".html"):
        add_if(rel)
    elif rel.lower().endswith(".pdf"):
        add_if(re.sub(r"\.pdf$", ".html", rel, flags=re.IGNORECASE))

    return candidates


def local_pdf_candidate(src_repo: Path, raw_url: str) -> Path | None:
    raw = collapse_ws(raw_url)
    if not raw:
        return None

    parsed = urlparse(raw) if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw) else None
    path_part = parsed.path if parsed else raw
    rel = path_part.lstrip("/")
    if not rel:
        return None

    stem_path = Path(rel)
    if stem_path.suffix.lower() != ".html":
        return None

    pdf_rel = str(stem_path.with_suffix(".pdf"))
    candidate = (src_repo / pdf_rel).resolve()
    if candidate.exists() and candidate.is_file():
        return candidate
    return None


def to_llvm_org_pubs_url(src_repo: Path, local_path: Path) -> str:
    try:
        rel = local_path.resolve().relative_to(src_repo.resolve()).as_posix()
        return urljoin(BASE_PUBS_URL, rel)
    except ValueError:
        return urljoin(BASE_PUBS_URL, local_path.name)


def extract_pdf_links_from_html(src_repo: Path, html_path: Path) -> list[str]:
    text = html_path.read_text(encoding="utf-8", errors="ignore")
    links: list[str] = []

    for href in re.findall(r"<a[^>]+href\s*=\s*['\"]([^'\"]+)['\"]", text, flags=re.IGNORECASE):
        href = collapse_ws(html.unescape(href))
        if not href or href.startswith("#"):
            continue
        if not re.search(r"\.pdf(?:$|[?#])", href, flags=re.IGNORECASE):
            continue

        if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", href):
            links.append(href)
            continue

        rel = href.lstrip("/")
        candidate = (html_path.parent / rel).resolve()
        if candidate.exists() and candidate.is_file():
            links.append(to_llvm_org_pubs_url(src_repo=src_repo, local_path=candidate))
        else:
            links.append(urljoin(BASE_PUBS_URL, rel))

    return links


def score_pdf_candidate(pdf_url: str, preferred_stem: str) -> tuple[int, int]:
    basename = Path(urlparse(pdf_url).path).name.lower()
    stem = collapse_ws(preferred_stem).lower()

    score = 0
    if stem:
        if basename == f"{stem}.pdf":
            score += 200
        elif basename.startswith(f"{stem}-"):
            score += 140
        elif stem in basename:
            score += 80

    # Prefer the main paper over auxiliary assets when several PDFs are linked.
    if re.search(r"(slides?|presentation|pres|poster|handout|book|supplement)", basename):
        score -= 40

    return (score, -len(basename))


def resolve_primary_pdf_url(src_repo: Path, raw_url: str, html_candidates: list[Path]) -> str:
    raw = collapse_ws(raw_url)
    if not raw:
        return ""

    if is_pdf_url(raw):
        return resolve_paper_url(raw)

    preferred_stem = ""
    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", raw):
        preferred_stem = Path(urlparse(raw).path).stem
    else:
        preferred_stem = Path(raw).stem

    direct_local = local_pdf_candidate(src_repo, raw)
    if direct_local:
        return to_llvm_org_pubs_url(src_repo, direct_local)

    pdf_links: list[str] = []
    seen: set[str] = set()
    for html_path in html_candidates:
        for link in extract_pdf_links_from_html(src_repo, html_path):
            if link in seen:
                continue
            seen.add(link)
            pdf_links.append(link)

    if not pdf_links:
        return ""

    pdf_links.sort(key=lambda link: score_pdf_candidate(link, preferred_stem), reverse=True)
    return pdf_links[0]


def extract_abstract_from_html(html_path: Path) -> str:
    text = html_path.read_text(encoding="utf-8", errors="ignore")

    match = re.search(
        r"<h2[^>]*>\s*Abstract\s*:\s*</h2>\s*<blockquote[^>]*>(.*?)</blockquote>",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        match = re.search(
            r"<h3[^>]*>\s*Abstract\s*:\s*</h3>\s*<blockquote[^>]*>(.*?)</blockquote>",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )

    if not match:
        return ""

    abstract = strip_tags(match.group(1))
    return abstract


def parse_authors(author_text: str) -> list[dict]:
    text = collapse_ws(author_text)
    if not text:
        return []

    # Normalize separators while keeping common name punctuation intact.
    normalized = text.replace(" and ", ", ").replace(";", ",")
    parts = [collapse_ws(part) for part in normalized.split(",")]
    parts = [part for part in parts if part]

    authors: list[dict] = []
    seen: set[str] = set()

    for part in parts:
        part = strip_tags(part)
        if not part:
            continue
        key = part.lower()
        if key in seen:
            continue
        seen.add(key)
        authors.append({"name": part, "affiliation": ""})

    return authors


def classify_type(title: str, published: str) -> str:
    blob = f"{title} {published}".lower()
    if "thesis" in blob or "dissertation" in blob:
        return "thesis"
    if "keynote" in blob or "tutorial" in blob or "workshop" in blob:
        return "presentation-paper"
    return "research-paper"


def slugify(value: str) -> str:
    lowered = value.lower()
    lowered = re.sub(r"[^a-z0-9]+", "-", lowered)
    lowered = re.sub(r"-{2,}", "-", lowered)
    return lowered.strip("-")


def normalize_title_key(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def extract_tags_from_text(tags: list[str], title: str, abstract: str) -> list[str]:
    text = f"{title} {abstract}".lower()
    found: list[str] = []

    for tag in tags:
        t = tag.lower()
        alnum_len = len(re.sub(r"[^a-z0-9]", "", t))
        if alnum_len <= 3:
            pattern = rf"(?<![a-z0-9]){re.escape(t)}(?![a-z0-9])"
            if re.search(pattern, text):
                found.append(tag)
        else:
            if t in text:
                found.append(tag)

    return found


def build_old_dataset_map(old_dataset_path: Path) -> dict[tuple[str, str], dict]:
    if not old_dataset_path.exists():
        return {}

    payload = json.loads(old_dataset_path.read_text(encoding="utf-8"))
    papers = payload.get("papers", [])

    out: dict[tuple[str, str], dict] = {}
    for paper in papers:
        year = collapse_ws(str(paper.get("year", "")))
        title = strip_tags(str(paper.get("title", "")))
        if not title:
            continue
        key = (year, normalize_title_key(title))
        out[key] = paper
    return out


def build_dataset(src_repo: Path, tags: list[str], old_map: dict[tuple[str, str], dict]) -> list[dict]:
    pubs_js = (src_repo / "pubs.js").read_text(encoding="utf-8")
    array_text = extract_array_literal(pubs_js, "PUBS")
    entries = parse_pubs_array(array_text)

    out: list[dict] = []
    used_ids: set[str] = set()

    for entry in entries:
        title = strip_tags(str(entry.get("title", "")))
        if not title:
            continue

        year_raw = entry.get("year", "")
        year = collapse_ws(str(year_raw))
        if not re.fullmatch(r"\d{4}", year):
            year = ""

        raw_url = collapse_ws(str(entry.get("url", "")))
        published = strip_tags(str(entry.get("published", "")))
        location = strip_tags(str(entry.get("location", "")))
        award = strip_tags(str(entry.get("award", "")))

        venue_parts = [published]
        if location:
            venue_parts.append(location)
        if award:
            venue_parts.append(award)
        venue = " | ".join([part for part in venue_parts if part])

        html_candidates = local_html_candidates(src_repo, raw_url)
        paper_url = resolve_primary_pdf_url(src_repo, raw_url, html_candidates)

        source_url = ""
        if raw_url:
            source_url = resolve_paper_url(raw_url)
            if source_url == paper_url:
                source_url = ""

        abstract = ""
        for candidate in html_candidates:
            abstract = extract_abstract_from_html(candidate)
            if abstract:
                break

        key = (year, normalize_title_key(title))
        old = old_map.get(key)

        if not abstract and old:
            abstract = strip_tags(str(old.get("abstract", "")))

        if not abstract:
            abstract = PLACEHOLDER_ABSTRACT

        authors = parse_authors(str(entry.get("author", "")))
        if not authors and old:
            old_authors = old.get("authors") or []
            if isinstance(old_authors, list):
                authors = [
                    {
                        "name": strip_tags(str(author.get("name", ""))),
                        "affiliation": strip_tags(str(author.get("affiliation", ""))),
                    }
                    for author in old_authors
                    if strip_tags(str(author.get("name", "")))
                ]

        tags_for_paper = extract_tags_from_text(tags, title, abstract)

        base_id = slugify(f"pubs-{year or 'unknown'}-{title}")
        paper_id = base_id
        suffix = 2
        while paper_id in used_ids:
            paper_id = f"{base_id}-{suffix}"
            suffix += 1
        used_ids.add(paper_id)

        # For entries with empty URLs keep them visible, but do not fabricate links.
        record = {
            "id": paper_id,
            "source": "llvm-org-pubs",
            "title": title,
            "authors": authors,
            "year": year,
            "venue": venue,
            "type": classify_type(title, published),
            "abstract": abstract,
            "paperUrl": paper_url,
            "sourceUrl": source_url,
            "tags": tags_for_paper,
        }
        out.append(record)

    def sort_key(paper: dict):
        y = paper.get("year") or "0000"
        return (y, paper.get("title") or "", paper.get("id") or "")

    out.sort(key=sort_key, reverse=True)
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src-repo", default="/tmp/llvm-www-pubs", help="Path to llvm-www-pubs checkout")
    parser.add_argument("--app-js", default="/Users/britton/Desktop/library/devmtg/js/app.js", help="Path to devmtg app.js")
    parser.add_argument("--old-dataset", default="/Users/britton/Desktop/library/papers/llvm-org-pubs.json", help="Existing dataset for abstract/author fallback")
    parser.add_argument("--out-dir", default="/Users/britton/Desktop/library/papers", help="Output directory for generated papers data")
    args = parser.parse_args()

    src_repo = Path(args.src_repo).resolve()
    app_js = Path(args.app_js).resolve()
    old_dataset = Path(args.old_dataset).resolve()
    out_dir = Path(args.out_dir).resolve()

    if not (src_repo / "pubs.js").exists():
        raise SystemExit(f"Missing pubs.js under source repo: {src_repo}")

    tags = parse_all_tags(app_js)
    old_map = build_old_dataset_map(old_dataset)
    papers = build_dataset(src_repo, tags, old_map)

    out_dir.mkdir(parents=True, exist_ok=True)

    bundle = {
        "source": {
            "slug": "llvm-org-pubs",
            "name": "LLVM Publications",
            "url": "https://llvm.org/pubs/",
        },
        "papers": papers,
    }

    bundle_path = out_dir / "llvm-org-pubs.json"
    bundle_path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    data_version = _dt.date.today().isoformat() + "-llvm-org-pubs-full"
    manifest = {
        "dataVersion": data_version,
        "paperFiles": ["llvm-org-pubs.json"],
    }
    manifest_path = out_dir / "index.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"Wrote {len(papers)} papers to {bundle_path}")
    print(f"Wrote manifest to {manifest_path} (dataVersion={data_version})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
