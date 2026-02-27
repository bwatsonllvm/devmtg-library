#!/usr/bin/env python3
"""Normalize publication/source metadata for papers/*.json bundles.

This script keeps backward-compatible `venue` while adding a canonical
`publication` field and cleaning placeholder metadata (e.g. `Vol. None`).
It also standardizes per-paper `source` to the bundle/source slug.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import html
import json
import re
from pathlib import Path


MISSING_TOKENS = {"", "none", "null", "nan", "n/a"}
PUBLICATION_ALIAS_MAP: dict[str, str] = {
    "proceedingsofacmonprogramminglanguages": "Proceedings of the ACM on Programming Languages",
    "proceedingsoftheacmonprogramminglanguages": "Proceedings of the ACM on Programming Languages",
    "proceedingsofinstituteforsystemprogrammingoftheras": "Proceedings of the Institute for System Programming of the RAS",
    "proceedingsofinstituteforsystemprogrammingofras": "Proceedings of the Institute for System Programming of the RAS",
    "proceedingsoftheinstituteforsystemprogrammingoftheras": "Proceedings of the Institute for System Programming of the RAS",
    "proceedingsoftheinstituteforsystemprogrammingofras": "Proceedings of the Institute for System Programming of the RAS",
}


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def clean_token(value: str) -> str:
    clean = collapse_ws(value)
    if clean.lower() in MISSING_TOKENS:
        return ""
    return clean


def publication_alias_key(value: str) -> str:
    text = collapse_ws(value).lower().replace("&", " and ")
    text = re.sub(r"""['".,()/-]""", "", text)
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


def canonicalize_publication_label(value: str) -> str:
    clean = clean_token(html.unescape(value))
    if not clean:
        return ""

    clean = (
        clean
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
    )
    clean = re.sub(r"\s+,", ",", clean)
    clean = re.sub(r"\s+([):;,.])", r"\1", clean)
    clean = re.sub(r"([(:])\s+", r"\1", clean)
    clean = clean.strip(" '\"")

    clean = re.sub(r"^proceedings of eedings(?: of)?(?:\s+|/)+", "Proceedings of ", clean, flags=re.IGNORECASE)
    clean = re.sub(r"^proceedings of proceedings of\s+", "Proceedings of ", clean, flags=re.IGNORECASE)

    proc_prefix_re = r"^proc(?:\.|\b)\s*(?:of\s+)?(?:the\s+)?"
    if re.match(proc_prefix_re, clean, flags=re.IGNORECASE):
        tail = collapse_ws(re.sub(proc_prefix_re, "", clean, flags=re.IGNORECASE))
        if tail:
            clean = f"Proceedings of {tail}"
    else:
        clean = re.sub(r"^proceedings\s+of\s+the\s+", "Proceedings of ", clean, flags=re.IGNORECASE)

    if re.fullmatch(r"(?:m\.?\s*s\.?|masters?)\s+thesis", clean, flags=re.IGNORECASE):
        clean = "Masters Thesis"
    elif re.fullmatch(r"(?:ph\.?\s*d\.?|doctoral)\s+thesis", clean, flags=re.IGNORECASE):
        clean = "Ph.D. Thesis"
    elif re.fullmatch(r"(?:b\.?\s*s?c\.?|bachelor(?:'s)?)\s+thesis", clean, flags=re.IGNORECASE):
        clean = "Bachelor Thesis"

    if re.fullmatch(r"arxiv(?:\.org)?(?:\s*\(cornell university\))?", clean, flags=re.IGNORECASE):
        return "arXiv"

    alias = PUBLICATION_ALIAS_MAP.get(publication_alias_key(clean))
    if alias:
        clean = alias

    return collapse_ws(clean)


def split_venue_parts(venue: str) -> list[str]:
    clean = collapse_ws(venue)
    if not clean:
        return []
    return [collapse_ws(part) for part in clean.split("|") if collapse_ws(part)]


def parse_volume_issue(parts: list[str]) -> tuple[str, str]:
    volume = ""
    issue = ""

    for part in parts:
        m = re.fullmatch(r"Vol\.\s*(.+?)(?:\s*\(Issue\s*(.+?)\))?", part, flags=re.IGNORECASE)
        if m:
            volume = clean_token(m.group(1) or "")
            issue = clean_token(m.group(2) or "")
            continue

        m_issue = re.fullmatch(r"Issue\s*(.+)", part, flags=re.IGNORECASE)
        if m_issue:
            issue = clean_token(m_issue.group(1) or "")

    return volume, issue


def derive_publication(existing_publication: str, venue: str) -> str:
    publication = canonicalize_publication_label(existing_publication)
    if publication:
        return publication

    parts = split_venue_parts(venue)
    if not parts:
        return ""

    first = canonicalize_publication_label(parts[0])
    if not first:
        return ""
    if re.match(r"^(vol\.|issue\b)", first, flags=re.IGNORECASE):
        return ""
    return first


def rebuild_venue(publication: str, venue: str) -> str:
    parts = split_venue_parts(venue)
    volume, issue = parse_volume_issue(parts)

    extras: list[str] = []
    for part in parts:
        clean = canonicalize_publication_label(part)
        if not clean:
            continue
        canonical_publication = canonicalize_publication_label(publication)
        if canonical_publication and canonicalize_publication_label(clean).lower() == canonical_publication.lower():
            continue
        if re.match(r"^(vol\.|issue\b)", clean, flags=re.IGNORECASE):
            continue
        extras.append(clean)

    out: list[str] = []
    if publication:
        out.append(publication)
    for extra in extras:
        if any(extra.lower() == existing.lower() for existing in out):
            continue
        out.append(extra)

    if volume:
        out.append(f"Vol. {volume}" + (f" (Issue {issue})" if issue else ""))
    elif issue:
        out.append(f"Issue {issue}")

    return " | ".join(out)


def normalize_source_slug(raw_source, bundle_source: dict) -> str:
    if isinstance(raw_source, str):
        source = collapse_ws(raw_source)
        if source:
            return source

    if isinstance(raw_source, dict):
        slug = collapse_ws(str(raw_source.get("slug", "")))
        if slug:
            return slug

    if isinstance(bundle_source, dict):
        slug = collapse_ws(str(bundle_source.get("slug", "")))
        if slug:
            return slug

    return ""


def normalize_bundle(path: Path) -> int:
    payload = json.loads(path.read_text(encoding="utf-8"))
    papers = payload.get("papers")
    if not isinstance(papers, list):
        return 0

    bundle_source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    bundle_source_name = clean_token(str(bundle_source.get("name", ""))) if bundle_source else ""
    changed = 0

    for paper in papers:
        if not isinstance(paper, dict):
            continue

        source_slug = normalize_source_slug(paper.get("source"), bundle_source)
        if source_slug != paper.get("source"):
            paper["source"] = source_slug
            changed += 1

        source_name = clean_token(str(paper.get("sourceName", "")))
        if not source_name and bundle_source_name:
            paper["sourceName"] = bundle_source_name
            changed += 1

        publication = derive_publication(str(paper.get("publication", "")), str(paper.get("venue", "")))
        venue = rebuild_venue(publication, str(paper.get("venue", "")))

        if paper.get("publication", "") != publication:
            paper["publication"] = publication
            changed += 1
        if paper.get("venue", "") != venue:
            paper["venue"] = venue
            changed += 1

    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return changed


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser()
    parser.add_argument("--papers-dir", default=str(repo_root / "papers"))
    parser.add_argument("--manifest", default=str(repo_root / "papers/index.json"))
    args = parser.parse_args()

    papers_dir = Path(args.papers_dir).resolve()
    manifest = Path(args.manifest).resolve()

    if not papers_dir.exists():
        raise SystemExit(f"Missing papers directory: {papers_dir}")

    total_changed = 0
    bundles = 0
    for path in sorted(papers_dir.glob("*.json")):
        if path.name == "index.json":
            continue
        changed = normalize_bundle(path)
        total_changed += changed
        bundles += 1
        print(f"{path.name}: updated fields={changed}")

    if manifest.exists():
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        payload["dataVersion"] = _dt.date.today().isoformat() + "-papers-publication-standardized"
        manifest.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Updated manifest dataVersion: {payload['dataVersion']}")

    print(f"Processed bundles: {bundles}, total field updates: {total_changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
