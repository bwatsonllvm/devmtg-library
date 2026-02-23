#!/usr/bin/env python3
"""Backfill stronger paper keywords from title/abstract text.

This keeps canonical `tags` for UI filters and adds/refreshes a richer
`keywords` list for each paper record.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import re
from pathlib import Path

from paper_keywords import PaperKeywordExtractor
from tag_vocabulary import load_canonical_tags


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", collapse_ws(value).lower())


def parse_all_tags(app_js_path: Path) -> list[str]:
    return load_canonical_tags(app_js_path)


def load_manifest_files(manifest_path: Path) -> list[str]:
    if not manifest_path.exists():
        return []
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    files = payload.get("paperFiles") or payload.get("files") or []
    out = [collapse_ws(str(item)) for item in files if collapse_ws(str(item))]
    return out


def merge_unique(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        clean = collapse_ws(value)
        key = normalize_key(clean)
        if not clean or not key or key in seen:
            continue
        seen.add(key)
        out.append(clean)
    return out


def enrich_bundle(
    path: Path,
    extractor: PaperKeywordExtractor,
    keep_existing_keywords: bool = False,
) -> tuple[int, int, int]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    papers = payload.get("papers")
    if not isinstance(papers, list):
        return (0, 0, 0)

    changed_records = 0
    with_tags = 0
    with_keywords = 0

    for paper in papers:
        if not isinstance(paper, dict):
            continue

        title = collapse_ws(str(paper.get("title", "")))
        abstract = collapse_ws(str(paper.get("abstract", "")))
        publication = collapse_ws(str(paper.get("publication", "")))
        venue = collapse_ws(str(paper.get("venue", "")))
        if not title:
            continue

        extracted = extractor.extract(
            title=title,
            abstract=abstract,
            publication=publication,
            venue=venue,
        )

        existing_tags = [collapse_ws(str(tag)) for tag in (paper.get("tags") or []) if collapse_ws(str(tag))]
        merged_tags = merge_unique(existing_tags + extracted["tags"])

        existing_keywords = [collapse_ws(str(kw)) for kw in (paper.get("keywords") or []) if collapse_ws(str(kw))]
        keyword_seed = existing_keywords if keep_existing_keywords else []
        merged_keywords = merge_unique(keyword_seed + extracted["keywords"] + merged_tags)[:24]

        if merged_tags:
            with_tags += 1
        if merged_keywords:
            with_keywords += 1

        if paper.get("tags") != merged_tags or paper.get("keywords") != merged_keywords:
            paper["tags"] = merged_tags
            paper["keywords"] = merged_keywords
            changed_records += 1

    if changed_records > 0:
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    return (changed_records, with_tags, with_keywords)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser()
    parser.add_argument("--papers-dir", default=str(repo_root / "papers"))
    parser.add_argument("--manifest", default=str(repo_root / "papers/index.json"))
    parser.add_argument("--app-js", default=str(repo_root / "js/app.js"))
    parser.add_argument("--all-json", action="store_true", help="Process every papers/*.json file (except index.json)")
    parser.add_argument(
        "--keep-existing-keywords",
        action="store_true",
        help="Preserve existing keyword values in addition to extracted keywords.",
    )
    args = parser.parse_args()

    papers_dir = Path(args.papers_dir).resolve()
    manifest = Path(args.manifest).resolve()
    app_js = Path(args.app_js).resolve()

    tags = parse_all_tags(app_js)
    extractor = PaperKeywordExtractor(tags)

    files: list[Path] = []
    if args.all_json:
        files = sorted([path for path in papers_dir.glob("*.json") if path.name != "index.json"])
    else:
        manifest_files = load_manifest_files(manifest)
        files = [papers_dir / rel for rel in manifest_files if (papers_dir / rel).exists()]

    if not files:
        raise SystemExit("No paper bundle files found to enrich.")

    total_changed = 0
    total_with_tags = 0
    total_with_keywords = 0

    for path in files:
        changed, with_tags, with_keywords = enrich_bundle(
            path,
            extractor,
            keep_existing_keywords=args.keep_existing_keywords,
        )
        total_changed += changed
        total_with_tags += with_tags
        total_with_keywords += with_keywords
        print(f"{path.name}: changed={changed}, with_tags={with_tags}, with_keywords={with_keywords}")

    if manifest.exists():
        payload = json.loads(manifest.read_text(encoding="utf-8"))
        payload["dataVersion"] = _dt.date.today().isoformat() + "-papers-keywords-v2"
        manifest.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Updated manifest dataVersion: {payload['dataVersion']}")

    print(
        "Totals: "
        f"bundles={len(files)}, "
        f"changed_records={total_changed}, "
        f"papers_with_tags={total_with_tags}, "
        f"papers_with_keywords={total_with_keywords}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
