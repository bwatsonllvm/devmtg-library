#!/usr/bin/env python3
"""Edit an existing paper record by id across manifest paper bundles.

The script applies a validated partial update (updates_json) to one existing paper
record and writes the modified bundle JSON back to disk.
"""

from __future__ import annotations

import argparse
import json
import re
import unicodedata
import urllib.parse
from pathlib import Path
from typing import Any

MANUAL_BUNDLE_NAME = "manual-added-papers.json"
ALLOWED_UPDATE_FIELDS = {
    "title",
    "authors",
    "year",
    "publication",
    "venue",
    "type",
    "abstract",
    "paperUrl",
    "sourceUrl",
    "doi",
    "openalexId",
    "citationCount",
    "tags",
    "keywords",
    "matchedAuthors",
    "matchedSubprojects",
    "content",
    "contentFormat",
}
OPTIONAL_FIELDS = {
    "publication",
    "venue",
    "abstract",
    "doi",
    "openalexId",
    "tags",
    "keywords",
    "matchedAuthors",
    "matchedSubprojects",
    "content",
    "contentFormat",
}


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


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
    return ""


def canonical_openalex_url(short_id: str) -> str:
    return f"https://openalex.org/{short_id}" if short_id else ""


def normalize_year(value: Any) -> str:
    raw = collapse_ws(str(value))
    if not raw:
        return ""
    if re.fullmatch(r"\d{4}", raw):
        return raw
    match = re.search(r"\b(\d{4})\b", raw)
    return match.group(1) if match else ""


def normalize_title_key(value: str) -> str:
    text = unicodedata.normalize("NFKD", collapse_ws(value))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return collapse_ws(text)


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


def parse_updates_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        raise ValueError("updates_json is required")
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"updates_json is not valid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError("updates_json must be one JSON object")
    invalid = sorted(key for key in payload.keys() if key not in ALLOWED_UPDATE_FIELDS)
    if invalid:
        raise ValueError(f"updates_json contains unsupported fields: {', '.join(invalid)}")
    return payload


def manifest_bundle_paths(repo_root: Path, manifest_path: Path) -> list[Path]:
    manifest = load_json(manifest_path)
    files = manifest.get("paperFiles")
    if not isinstance(files, list):
        raise ValueError(f"{manifest_path} missing paperFiles list")
    out: list[Path] = []
    papers_root = manifest_path.parent
    for rel in files:
        name = collapse_ws(str(rel))
        if not name.endswith(".json"):
            continue
        path = (papers_root / name).resolve()
        if path.exists():
            out.append(path)
    manual_bundle = (papers_root / MANUAL_BUNDLE_NAME).resolve()
    if manual_bundle.exists() and manual_bundle not in out:
        out.append(manual_bundle)
    return out


def find_target_record(bundle_paths: list[Path], paper_id: str) -> tuple[Path, dict, int]:
    matches: list[tuple[Path, dict, int]] = []
    for path in bundle_paths:
        payload = load_json(path)
        papers = payload.get("papers")
        if not isinstance(papers, list):
            continue
        for idx, paper in enumerate(papers):
            if not isinstance(paper, dict):
                continue
            pid = collapse_ws(str(paper.get("id", "")))
            if pid == paper_id:
                matches.append((path, paper, idx))
    if not matches:
        raise ValueError(f"paper id not found: {paper_id}")
    for path, paper, idx in matches:
        if path.name == MANUAL_BUNDLE_NAME:
            return path, paper, idx
    return matches[0]


def normalize_update_field(field: str, value: Any) -> Any:
    if value is None:
        return None

    if field in {"title", "publication", "venue", "type", "abstract", "content"}:
        return collapse_ws(str(value))
    if field in {"paperUrl", "sourceUrl"}:
        url = sanitize_http_url(str(value))
        if not url:
            raise ValueError(f"{field} must be an absolute http/https URL")
        return url
    if field == "doi":
        doi = normalize_doi(str(value))
        if not doi:
            raise ValueError("doi is invalid")
        return doi
    if field == "openalexId":
        short_id = normalize_openalex_short_id(str(value))
        if not short_id:
            raise ValueError("openalexId is invalid")
        return canonical_openalex_url(short_id)
    if field == "year":
        year = normalize_year(value)
        if not year:
            raise ValueError("year must contain a 4-digit year")
        return year
    if field == "citationCount":
        try:
            count = int(value)
        except Exception as exc:
            raise ValueError("citationCount must be an integer") from exc
        if count < 0:
            raise ValueError("citationCount must be >= 0")
        return count
    if field in {"tags", "keywords", "matchedAuthors", "matchedSubprojects"}:
        return parse_text_list(value)
    if field == "authors":
        authors = parse_authors(value)
        if not authors:
            raise ValueError("authors must include at least one author")
        return authors
    if field == "contentFormat":
        fmt = collapse_ws(str(value)).lower()
        if fmt not in {"markdown", "html", "text"}:
            raise ValueError("contentFormat must be one of: markdown, html, text")
        return fmt
    raise ValueError(f"unsupported update field: {field}")


def validate_record_after_update(record: dict[str, Any]) -> None:
    title = collapse_ws(str(record.get("title", "")))
    if not title:
        raise ValueError("title is required")

    authors = parse_authors(record.get("authors", []))
    if not authors:
        raise ValueError("authors is required (at least one author)")
    record["authors"] = authors

    year = normalize_year(record.get("year", ""))
    if not year:
        raise ValueError("year is required and must contain a 4-digit year")
    record["year"] = year

    paper_url = sanitize_http_url(str(record.get("paperUrl", "")))
    if not paper_url:
        raise ValueError("paperUrl is required and must be an absolute http/https URL")
    record["paperUrl"] = paper_url

    source_url = sanitize_http_url(str(record.get("sourceUrl", "")))
    if not source_url:
        raise ValueError("sourceUrl is required and must be an absolute http/https URL")
    record["sourceUrl"] = source_url

    doi_raw = collapse_ws(str(record.get("doi", "")))
    if doi_raw:
        doi = normalize_doi(doi_raw)
        if not doi:
            raise ValueError("doi is invalid")
        record["doi"] = doi

    openalex_raw = collapse_ws(str(record.get("openalexId", "")))
    if openalex_raw:
        openalex_short = normalize_openalex_short_id(openalex_raw)
        if not openalex_short:
            raise ValueError("openalexId is invalid")
        record["openalexId"] = canonical_openalex_url(openalex_short)

    citation_raw = record.get("citationCount", 0)
    try:
        citation = int(citation_raw)
    except Exception as exc:
        raise ValueError("citationCount must be an integer") from exc
    if citation < 0:
        raise ValueError("citationCount must be >= 0")
    record["citationCount"] = citation

    content_format = collapse_ws(str(record.get("contentFormat", ""))).lower()
    if content_format and content_format not in {"markdown", "html", "text"}:
        raise ValueError("contentFormat must be one of: markdown, html, text")
    if content_format:
        record["contentFormat"] = content_format


def apply_updates_to_record(record: dict[str, Any], updates: dict[str, Any]) -> dict[str, Any]:
    out = dict(record)
    for field, raw_value in updates.items():
        if raw_value is None:
            if field in OPTIONAL_FIELDS:
                out.pop(field, None)
                continue
            raise ValueError(f"{field} cannot be cleared")
        out[field] = normalize_update_field(field, raw_value)

    validate_record_after_update(out)
    return out


def validate_uniqueness_after_update(
    edited_record: dict[str, Any],
    edited_id: str,
    bundle_paths: list[Path],
) -> None:
    doi = normalize_doi(str(edited_record.get("doi", "")))
    title_key = normalize_title_key(str(edited_record.get("title", "")))
    year = normalize_year(edited_record.get("year", ""))

    for path in bundle_paths:
        payload = load_json(path)
        papers = payload.get("papers")
        if not isinstance(papers, list):
            continue
        for paper in papers:
            if not isinstance(paper, dict):
                continue
            pid = collapse_ws(str(paper.get("id", "")))
            if not pid or pid == edited_id:
                continue
            other_doi = normalize_doi(str(paper.get("doi", "")))
            if doi and other_doi and doi == other_doi:
                raise ValueError(f"duplicate DOI already exists on {pid}: {doi}")
            other_title = normalize_title_key(str(paper.get("title", "")))
            other_year = normalize_year(paper.get("year", ""))
            if title_key and year and other_title == title_key and other_year == year:
                raise ValueError(f"duplicate title/year already exists on {pid}: {edited_record.get('title')} ({year})")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paper-id", required=True)
    parser.add_argument("--updates-json", required=True)
    parser.add_argument("--manifest", default="papers/index.json")
    parser.add_argument("--print-before-after", action="store_true")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    manifest_path = (repo_root / args.manifest).resolve()
    if not manifest_path.exists():
        raise SystemExit(f"missing manifest: {manifest_path}")

    paper_id = collapse_ws(args.paper_id)
    if not paper_id:
        raise SystemExit("paper-id is required")

    try:
        updates = parse_updates_json(args.updates_json)
        bundle_paths = manifest_bundle_paths(repo_root, manifest_path)
        bundle_path, original_record, record_idx = find_target_record(bundle_paths, paper_id)
        updated_record = apply_updates_to_record(original_record, updates)
        validate_uniqueness_after_update(updated_record, paper_id, bundle_paths)

        payload = load_json(bundle_path)
        papers = payload.get("papers")
        if not isinstance(papers, list):
            raise ValueError(f"{bundle_path} missing papers array")
        papers[record_idx] = updated_record
        save_json(bundle_path, payload)

        print(f"Updated paper: {paper_id} in {bundle_path}")
        if args.print_before_after:
            print("BEFORE:")
            print(json.dumps(original_record, ensure_ascii=False))
            print("AFTER:")
            print(json.dumps(updated_record, ensure_ascii=False))
    except Exception as exc:
        raise SystemExit(str(exc)) from exc

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
