#!/usr/bin/env python3
"""Add one normalized manual paper record into papers/manual-added-papers.json.

Input can come from:
- --source-url (auto-extract metadata from a publication page, with DOI/OpenAlex enrichment)
- --paper-json / --paper-json-file (explicit payload)
- --overrides-json (optional patch over extracted/manual data)
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import urllib.parse
import urllib.request
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

MANUAL_SOURCE = "manual-added"
MANUAL_SOURCE_NAME = "Manual Added Papers"


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_title_key(value: str) -> str:
    text = unicodedata.normalize("NFKD", collapse_ws(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return collapse_ws(text)


def slugify(value: str) -> str:
    text = unicodedata.normalize("NFKD", collapse_ws(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text).strip("-")
    return text


def sanitize_http_url(value: str) -> str:
    raw = collapse_ws(value)
    if not raw:
        return ""
    try:
        parsed = urllib.parse.urlparse(raw)
    except Exception:
        return ""
    if parsed.scheme.lower() not in {"http", "https"}:
        return ""
    if not parsed.netloc:
        return ""
    return urllib.parse.urlunparse(parsed)


def normalize_doi(value: str) -> str:
    raw = collapse_ws(value).lower()
    if not raw:
        return ""
    raw = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", raw)
    raw = re.sub(r"^doi:\s*", "", raw)
    match = re.search(r"(10\.\d{4,9}/\S+)", raw)
    if not match:
        return ""
    return match.group(1).rstrip(".,;)")


def normalize_openalex_short_id(value: str) -> str:
    raw = collapse_ws(value).rstrip("/")
    if not raw:
        return ""
    upper = raw.upper()
    if re.fullmatch(r"W\d+", upper):
        return upper
    match = re.search(r"openalex\.org/(W\d+)", upper, flags=re.IGNORECASE)
    if match:
        return match.group(1).upper()
    match = re.search(r"\bOPENALEX[-_/](W\d+)\b", upper, flags=re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return ""


def canonical_openalex_url(short_id: str) -> str:
    return f"https://openalex.org/{short_id}" if short_id else ""


def parse_text_list(value: Any) -> list[str]:
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            text = collapse_ws(str(item))
            if text:
                out.append(text)
        return out
    if isinstance(value, str):
        parts = [collapse_ws(part) for part in value.split(",")]
        return [part for part in parts if part]
    return []


def normalize_affiliation(value: Any) -> str:
    if isinstance(value, list):
        parts = [collapse_ws(str(part)) for part in value]
        parts = [part for part in parts if part]
        return " | ".join(parts)
    return collapse_ws(str(value))


def parse_authors(value: Any) -> list[dict[str, str]]:
    authors: list[dict[str, str]] = []
    if isinstance(value, list):
        for item in value:
            if isinstance(item, dict):
                name = collapse_ws(str(item.get("name", "")))
                if not name:
                    continue
                author: dict[str, str] = {"name": name}
                affiliation = normalize_affiliation(item.get("affiliation", ""))
                if affiliation:
                    author["affiliation"] = affiliation
                authors.append(author)
                continue
            text = collapse_ws(str(item))
            if not text:
                continue
            if "|" in text:
                left, right = text.split("|", 1)
                name = collapse_ws(left)
                affiliation = normalize_affiliation([part.strip() for part in right.split(";") if part.strip()])
            else:
                name = text
                affiliation = ""
            if not name:
                continue
            author = {"name": name}
            if affiliation:
                author["affiliation"] = affiliation
            authors.append(author)
        return authors

    if isinstance(value, str):
        for raw_line in value.splitlines():
            line = collapse_ws(raw_line)
            if not line:
                continue
            if "|" in line:
                left, right = line.split("|", 1)
                name = collapse_ws(left)
                affiliation = normalize_affiliation([part.strip() for part in right.split(";") if part.strip()])
            else:
                name = line
                affiliation = ""
            if not name:
                continue
            author = {"name": name}
            if affiliation:
                author["affiliation"] = affiliation
            authors.append(author)
    return authors


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def save_json(path: Path, payload: dict) -> None:
    text = json.dumps(payload, ensure_ascii=False, indent=2)
    path.write_text(text + "\n", encoding="utf-8")


def normalize_year(value: Any) -> str:
    raw = collapse_ws(str(value))
    if not raw:
        return ""
    if re.fullmatch(r"\d{4}", raw):
        return raw
    match = re.search(r"\b(\d{4})\b", raw)
    return match.group(1) if match else ""


def generate_id(preferred: str, doi: str, openalex_id: str, year: str, title: str) -> str:
    preferred_id = collapse_ws(preferred)
    if preferred_id:
        return preferred_id
    if doi:
        return f"doi-{slugify(doi)}"
    if openalex_id:
        return f"openalex-{openalex_id.lower()}"
    stem = slugify(f"{year}-{title}") if year else slugify(title)
    return f"manual-{stem or 'paper'}"


def ensure_unique_id(base_id: str, existing_ids: set[str]) -> str:
    candidate = base_id
    suffix = 2
    while candidate in existing_ids:
        candidate = f"{base_id}-{suffix}"
        suffix += 1
    return candidate


def collect_existing_papers(papers_dir: Path, manifest_path: Path, manual_bundle_path: Path) -> list[dict]:
    manifest = load_json(manifest_path)
    files = manifest.get("paperFiles")
    if not isinstance(files, list):
        raise ValueError(f"{manifest_path} missing paperFiles list")

    bundle_names: list[str] = []
    for item in files:
        rel = collapse_ws(str(item))
        if rel.endswith(".json"):
            bundle_names.append(rel)
    manual_name = manual_bundle_path.name
    if manual_name not in bundle_names and manual_bundle_path.exists():
        bundle_names.append(manual_name)

    papers: list[dict] = []
    for bundle_name in bundle_names:
        bundle_path = (papers_dir / bundle_name).resolve()
        if not bundle_path.exists():
            continue
        payload = load_json(bundle_path)
        items = payload.get("papers")
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                papers.append(item)
    return papers


def build_record(raw: dict[str, Any]) -> dict[str, Any]:
    source = collapse_ws(str(raw.get("source", ""))) or MANUAL_SOURCE
    source_name = collapse_ws(str(raw.get("sourceName", ""))) or MANUAL_SOURCE_NAME
    title = collapse_ws(str(raw.get("title", "")))
    year = normalize_year(raw.get("year", ""))
    publication = collapse_ws(str(raw.get("publication", "")))
    venue = collapse_ws(str(raw.get("venue", "")))
    paper_type = collapse_ws(str(raw.get("type", ""))) or "research-paper"
    abstract = collapse_ws(str(raw.get("abstract", "")))

    paper_url = sanitize_http_url(str(raw.get("paperUrl", "")))
    source_url = sanitize_http_url(str(raw.get("sourceUrl", "")))

    doi = normalize_doi(str(raw.get("doi", "")))
    openalex_short = normalize_openalex_short_id(str(raw.get("openalexId", "")))
    openalex_id = canonical_openalex_url(openalex_short)

    authors = parse_authors(raw.get("authors", []))
    tags = parse_text_list(raw.get("tags", []))
    keywords = parse_text_list(raw.get("keywords", []))
    matched_authors = parse_text_list(raw.get("matchedAuthors", []))
    matched_subprojects = parse_text_list(raw.get("matchedSubprojects", []))

    content_format = collapse_ws(str(raw.get("contentFormat", ""))).lower()
    if content_format not in {"", "markdown", "html", "text"}:
        raise ValueError("contentFormat must be one of: markdown, html, text")
    content = str(raw.get("content", "")).strip()

    citation_raw = raw.get("citationCount", 0)
    try:
        citation_count = int(citation_raw)
    except Exception as exc:
        raise ValueError("citationCount must be an integer") from exc
    if citation_count < 0:
        raise ValueError("citationCount must be >= 0")

    if not title:
        raise ValueError("title is required")
    if not authors:
        raise ValueError("authors is required (at least one author)")
    if not year:
        raise ValueError("year is required and must contain a 4-digit year")
    if not paper_url:
        raise ValueError("paperUrl is required and must be an absolute http/https URL")
    if not source_url:
        raise ValueError("sourceUrl is required and must be an absolute http/https URL")
    if str(raw.get("doi", "")).strip() and not doi:
        raise ValueError("doi is present but invalid")
    if str(raw.get("openalexId", "")).strip() and not openalex_id:
        raise ValueError("openalexId is present but invalid")

    record: dict[str, Any] = {
        "id": generate_id(str(raw.get("id", "")), doi, openalex_short.lower(), year, title),
        "source": source,
        "sourceName": source_name,
        "title": title,
        "authors": authors,
        "year": year,
        "type": paper_type,
        "paperUrl": paper_url,
        "sourceUrl": source_url,
        "citationCount": citation_count,
    }

    if publication:
        record["publication"] = publication
    if venue:
        record["venue"] = venue
    if abstract:
        record["abstract"] = abstract
    if doi:
        record["doi"] = doi
    if openalex_id:
        record["openalexId"] = openalex_id
    if tags:
        record["tags"] = tags
    if keywords:
        record["keywords"] = keywords
    if matched_authors:
        record["matchedAuthors"] = matched_authors
    if matched_subprojects:
        record["matchedSubprojects"] = matched_subprojects
    if content:
        record["content"] = content
        record["contentFormat"] = content_format or "markdown"

    return record


def validate_uniqueness(record: dict[str, Any], existing_papers: list[dict], existing_ids: set[str]) -> str:
    doi = normalize_doi(str(record.get("doi", "")))
    title_key = normalize_title_key(str(record.get("title", "")))
    year = normalize_year(record.get("year", ""))
    source_url = sanitize_http_url(str(record.get("sourceUrl", "")))
    openalex = normalize_openalex_short_id(str(record.get("openalexId", "")))

    existing_dois: set[str] = set()
    existing_title_year: set[tuple[str, str]] = set()
    existing_source_urls: set[str] = set()
    existing_openalex: set[str] = set()

    for paper in existing_papers:
        if not isinstance(paper, dict):
            continue
        other_doi = normalize_doi(str(paper.get("doi", "")))
        if other_doi:
            existing_dois.add(other_doi)

        other_title = normalize_title_key(str(paper.get("title", "")))
        other_year = normalize_year(paper.get("year", ""))
        if other_title and other_year:
            existing_title_year.add((other_title, other_year))

        other_source = sanitize_http_url(str(paper.get("sourceUrl", "")))
        if other_source:
            existing_source_urls.add(other_source)

        other_openalex = normalize_openalex_short_id(str(paper.get("openalexId", "")))
        if other_openalex:
            existing_openalex.add(other_openalex)

    if doi and doi in existing_dois:
        raise ValueError(f"duplicate DOI already exists: {doi}")
    if title_key and year and (title_key, year) in existing_title_year:
        raise ValueError(f"duplicate title/year already exists: {record.get('title')} ({year})")
    if source_url and source_url in existing_source_urls:
        raise ValueError(f"duplicate sourceUrl already exists: {source_url}")
    if openalex and openalex in existing_openalex:
        raise ValueError(f"duplicate openalexId already exists: {openalex}")

    base_id = collapse_ws(str(record.get("id", ""))) or "manual-paper"
    return ensure_unique_id(base_id, existing_ids)


def parse_json_object(payload_raw: str, label: str) -> dict[str, Any]:
    payload_raw = payload_raw.strip()
    if not payload_raw:
        return {}
    try:
        payload = json.loads(payload_raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{label} is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"{label} must be one JSON object")
    return payload


def parse_json_object_from_file(path_text: str, label: str) -> dict[str, Any]:
    path = Path(path_text).resolve()
    payload_raw = path.read_text(encoding="utf-8")
    return parse_json_object(payload_raw, label)


def merge_payload(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in patch.items():
        if value is None:
            continue
        out[key] = value
    return out


class _MetadataHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, list[str]] = {}
        self.link_hrefs: list[dict[str, str]] = []
        self.anchor_hrefs: list[str] = []
        self._in_title = False
        self._title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = {str(k).lower(): (v or "") for k, v in attrs}
        if tag.lower() == "meta":
            content = collapse_ws(unescape(data.get("content", "")))
            if not content:
                return
            for key_name in ("name", "property", "itemprop", "http-equiv"):
                key = collapse_ws(data.get(key_name, "")).lower()
                if key:
                    self.meta.setdefault(key, []).append(content)
            return
        if tag.lower() == "link":
            href = collapse_ws(data.get("href", ""))
            if href:
                self.link_hrefs.append(
                    {
                        "href": href,
                        "rel": collapse_ws(data.get("rel", "")).lower(),
                        "type": collapse_ws(data.get("type", "")).lower(),
                    }
                )
            return
        if tag.lower() == "a":
            href = collapse_ws(data.get("href", ""))
            if href:
                self.anchor_hrefs.append(href)
            return
        if tag.lower() == "title":
            self._in_title = True

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            text = collapse_ws(unescape(data))
            if text:
                self._title_parts.append(text)

    @property
    def title(self) -> str:
        return collapse_ws(" ".join(self._title_parts))


def _first_meta(meta: dict[str, list[str]], keys: list[str]) -> str:
    for key in keys:
        values = meta.get(key, [])
        for value in values:
            text = collapse_ws(value)
            if text:
                return text
    return ""


def _all_meta(meta: dict[str, list[str]], keys: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for key in keys:
        for value in meta.get(key, []):
            text = collapse_ws(value)
            norm = text.casefold()
            if not text or norm in seen:
                continue
            seen.add(norm)
            out.append(text)
    return out


def _resolve_url(base_url: str, candidate: str) -> str:
    joined = urllib.parse.urljoin(base_url, collapse_ws(candidate))
    return sanitize_http_url(joined)


def _extract_doi_candidates(text: str) -> list[str]:
    raw = text or ""
    candidates = re.findall(r"(10\.\d{4,9}/[^\s\"'<>)]+)", raw, flags=re.IGNORECASE)
    out: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        doi = normalize_doi(candidate)
        if doi and doi not in seen:
            seen.add(doi)
            out.append(doi)
    return out


def _decode_openalex_abstract(value: Any) -> str:
    if not isinstance(value, dict) or not value:
        return ""
    parts: list[tuple[int, str]] = []
    for token, indices in value.items():
        if not isinstance(indices, list):
            continue
        for idx in indices:
            if isinstance(idx, int):
                parts.append((idx, str(token)))
    if not parts:
        return ""
    parts.sort(key=lambda item: item[0])
    return collapse_ws(" ".join(token for _, token in parts))


def _fetch_url_text(url: str, timeout: int = 25) -> tuple[str, str]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "llvm-library-manual-paper-intake/1.0",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        final_url = sanitize_http_url(str(response.geturl())) or sanitize_http_url(url)
        body = response.read(4_000_000)
        charset = response.headers.get_content_charset() or "utf-8"
        text = body.decode(charset, errors="replace")
        return text, final_url


def _fetch_openalex_work_by_doi(doi: str, timeout: int = 20) -> dict[str, Any] | None:
    norm = normalize_doi(doi)
    if not norm:
        return None
    params = urllib.parse.urlencode(
        {
            "filter": f"doi:https://doi.org/{norm}",
            "per-page": "1",
            "select": "id,doi,title,publication_year,cited_by_count,authorships,abstract_inverted_index,primary_location,best_oa_location,host_venue",
        }
    )
    url = f"https://api.openalex.org/works?{params}"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "llvm-library-manual-paper-intake/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        return None
    work = results[0]
    return work if isinstance(work, dict) else None


def _extract_from_openalex(work: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    title = collapse_ws(str(work.get("title", "")))
    if title:
        out["title"] = title

    year = normalize_year(work.get("publication_year", ""))
    if year:
        out["year"] = year

    abstract = _decode_openalex_abstract(work.get("abstract_inverted_index"))
    if abstract:
        out["abstract"] = abstract

    doi = normalize_doi(str(work.get("doi", "")))
    if doi:
        out["doi"] = doi

    openalex_id = canonical_openalex_url(normalize_openalex_short_id(str(work.get("id", ""))))
    if openalex_id:
        out["openalexId"] = openalex_id

    cited_by = work.get("cited_by_count")
    if isinstance(cited_by, int) and cited_by >= 0:
        out["citationCount"] = cited_by

    publication = ""
    primary_location = work.get("primary_location")
    if isinstance(primary_location, dict):
        source = primary_location.get("source")
        if isinstance(source, dict):
            publication = collapse_ws(str(source.get("display_name", "")))
    if not publication:
        host_venue = work.get("host_venue")
        if isinstance(host_venue, dict):
            publication = collapse_ws(str(host_venue.get("display_name", "")))
    if publication:
        out["publication"] = publication
        out["venue"] = publication

    pdf_candidates: list[str] = []
    for key in ("best_oa_location", "primary_location"):
        loc = work.get(key)
        if not isinstance(loc, dict):
            continue
        for field in ("pdf_url", "landing_page_url"):
            url = sanitize_http_url(str(loc.get(field, "")))
            if url and url not in pdf_candidates:
                pdf_candidates.append(url)
    if pdf_candidates:
        out["paperUrl"] = pdf_candidates[0]

    authors: list[dict[str, str]] = []
    authorships = work.get("authorships")
    if isinstance(authorships, list):
        for authorship in authorships:
            if not isinstance(authorship, dict):
                continue
            author_obj = authorship.get("author")
            if not isinstance(author_obj, dict):
                continue
            name = collapse_ws(str(author_obj.get("display_name", "")))
            if not name:
                continue
            author: dict[str, str] = {"name": name}
            institutions = authorship.get("institutions")
            if isinstance(institutions, list):
                affs: list[str] = []
                for inst in institutions:
                    if not isinstance(inst, dict):
                        continue
                    inst_name = collapse_ws(str(inst.get("display_name", "")))
                    if inst_name and inst_name not in affs:
                        affs.append(inst_name)
                if affs:
                    author["affiliation"] = " | ".join(affs)
            authors.append(author)
    if authors:
        out["authors"] = authors
    return out


def extract_payload_from_source_url(source_url: str) -> dict[str, Any]:
    sanitized_source = sanitize_http_url(source_url)
    if not sanitized_source:
        raise ValueError("source_url must be an absolute http/https URL")

    try:
        html_text, final_url = _fetch_url_text(sanitized_source)
    except Exception as exc:
        raise ValueError(f"failed to fetch source_url: {sanitized_source}") from exc
    parser = _MetadataHTMLParser()
    parser.feed(html_text)

    title = _first_meta(
        parser.meta,
        [
            "citation_title",
            "dc.title",
            "dcterms.title",
            "og:title",
            "twitter:title",
            "title",
        ],
    ) or parser.title
    abstract = _first_meta(
        parser.meta,
        [
            "citation_abstract",
            "dc.description",
            "dcterms.description",
            "description",
            "og:description",
            "twitter:description",
        ],
    )
    publication = _first_meta(
        parser.meta,
        [
            "citation_journal_title",
            "citation_conference_title",
            "citation_inbook_title",
            "prism.publicationname",
            "og:site_name",
        ],
    )
    venue = _first_meta(
        parser.meta,
        [
            "citation_conference_title",
            "citation_journal_title",
            "citation_inbook_title",
            "prism.publicationname",
        ],
    )

    year = normalize_year(
        _first_meta(
            parser.meta,
            [
                "citation_publication_date",
                "citation_date",
                "dc.date",
                "dcterms.date",
                "prism.publicationdate",
                "article:published_time",
            ],
        )
    )
    if not year:
        year_match = re.search(r"\b(19|20)\d{2}\b", html_text)
        if year_match:
            year = year_match.group(0)

    raw_authors = _all_meta(
        parser.meta,
        [
            "citation_author",
            "dc.creator",
            "dcterms.creator",
            "author",
            "article:author",
        ],
    )
    authors: list[dict[str, str]] = []
    seen_names: set[str] = set()
    for raw_author in raw_authors:
        pieces = [raw_author]
        if ";" in raw_author:
            pieces = [part.strip() for part in raw_author.split(";") if part.strip()]
        for piece in pieces:
            name = collapse_ws(piece)
            key = name.casefold()
            if not name or key in seen_names:
                continue
            seen_names.add(key)
            authors.append({"name": name})

    doi = normalize_doi(
        _first_meta(
            parser.meta,
            [
                "citation_doi",
                "dc.identifier",
                "dcterms.identifier",
                "prism.doi",
            ],
        )
    )
    if not doi:
        doi_candidates = _extract_doi_candidates(final_url + "\n" + html_text)
        if doi_candidates:
            doi = doi_candidates[0]

    paper_url = sanitize_http_url(_first_meta(parser.meta, ["citation_pdf_url"]))
    if not paper_url:
        for link in parser.link_hrefs:
            rel = link.get("rel", "")
            href = link.get("href", "")
            link_type = link.get("type", "")
            if "pdf" in link_type or ("alternate" in rel and href.lower().endswith(".pdf")):
                resolved = _resolve_url(final_url, href)
                if resolved:
                    paper_url = resolved
                    break
    if not paper_url:
        for href in parser.anchor_hrefs:
            if ".pdf" not in href.lower():
                continue
            resolved = _resolve_url(final_url, href)
            if resolved:
                paper_url = resolved
                break
    if not paper_url and final_url.lower().endswith(".pdf"):
        paper_url = final_url

    record: dict[str, Any] = {
        "source": MANUAL_SOURCE,
        "sourceName": MANUAL_SOURCE_NAME,
        "sourceUrl": final_url or sanitized_source,
    }
    if title:
        record["title"] = title
    if authors:
        record["authors"] = authors
    if year:
        record["year"] = year
    if publication:
        record["publication"] = publication
    if venue:
        record["venue"] = venue
    if abstract:
        record["abstract"] = abstract
    if doi:
        record["doi"] = doi
    if paper_url:
        record["paperUrl"] = paper_url

    content_lines = [f"- Source page: {record['sourceUrl']}"]
    if doi:
        content_lines.append(f"- DOI: https://doi.org/{doi}")
    if paper_url:
        content_lines.append(f"- PDF: {paper_url}")
    record["contentFormat"] = "markdown"
    record["content"] = "\n".join(content_lines)

    if doi:
        openalex_work = _fetch_openalex_work_by_doi(doi)
        if openalex_work:
            record = merge_payload(record, _extract_from_openalex(openalex_work))
            # Preserve source links from extracted page, not OpenAlex landing defaults.
            record["sourceUrl"] = final_url or sanitized_source
            if paper_url:
                record["paperUrl"] = paper_url
            if "content" not in record or not collapse_ws(str(record.get("content", ""))):
                record["contentFormat"] = "markdown"
                record["content"] = "\n".join(content_lines)

    return record


def parse_payload_from_args(args: argparse.Namespace) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if args.source_url:
        payload = merge_payload(payload, extract_payload_from_source_url(args.source_url))
    if args.paper_json_file:
        payload = merge_payload(payload, parse_json_object_from_file(args.paper_json_file, "paper payload file"))
    if args.paper_json:
        payload = merge_payload(payload, parse_json_object(args.paper_json, "paper payload"))
    if args.overrides_json:
        payload = merge_payload(payload, parse_json_object(args.overrides_json, "overrides payload"))
    if not payload:
        raise ValueError(
            "missing payload: provide --source-url or --paper-json/--paper-json-file"
        )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", default="")
    parser.add_argument("--paper-json", default="")
    parser.add_argument("--paper-json-file", default="")
    parser.add_argument("--overrides-json", default="")
    parser.add_argument("--manual-bundle", default="papers/manual-added-papers.json")
    parser.add_argument("--manifest", default="papers/index.json")
    parser.add_argument("--print-record-json", action="store_true")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    manual_bundle_path = (repo_root / args.manual_bundle).resolve()
    manifest_path = (repo_root / args.manifest).resolve()
    papers_dir = manifest_path.parent

    if not manual_bundle_path.exists():
        raise SystemExit(f"Missing manual bundle: {manual_bundle_path}")
    if not manifest_path.exists():
        raise SystemExit(f"Missing manifest: {manifest_path}")

    try:
        raw_payload = parse_payload_from_args(args)
        record = build_record(raw_payload)

        manual_payload = load_json(manual_bundle_path)
        manual_papers = manual_payload.get("papers")
        if not isinstance(manual_papers, list):
            raise ValueError(f"{manual_bundle_path} missing papers array")

        existing_papers = collect_existing_papers(papers_dir, manifest_path, manual_bundle_path)
        existing_ids = {
            collapse_ws(str(paper.get("id", "")))
            for paper in existing_papers
            if isinstance(paper, dict) and collapse_ws(str(paper.get("id", "")))
        }

        record["id"] = validate_uniqueness(record, existing_papers, existing_ids)

        source_obj = manual_payload.get("source")
        if not isinstance(source_obj, dict):
            manual_payload["source"] = {"slug": MANUAL_SOURCE, "name": MANUAL_SOURCE_NAME, "url": ""}
        else:
            if not collapse_ws(str(source_obj.get("slug", ""))):
                source_obj["slug"] = MANUAL_SOURCE
            if not collapse_ws(str(source_obj.get("name", ""))):
                source_obj["name"] = MANUAL_SOURCE_NAME
            if source_obj.get("url") is None:
                source_obj["url"] = ""

        manual_papers.append(record)
        save_json(manual_bundle_path, manual_payload)

        print(f"Added manual paper: {record['id']} | {record['title']}")
        if args.print_record_json:
            print(json.dumps(record, ensure_ascii=False))
    except Exception as exc:
        raise SystemExit(str(exc)) from exc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
