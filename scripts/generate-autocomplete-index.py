#!/usr/bin/env python3
"""Generate a lightweight autocomplete artifact for viewer-side global search.

The output is intentionally compact and pre-aggregated so browser runtime does
not need to load full talks/papers/docs corpora just to render suggestions.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import posixpath
import re
import sys
from collections import defaultdict
from pathlib import Path


def collapse_ws(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", collapse_ws(value).lower())


def normalize_label(value: str, max_len: int) -> str:
    return collapse_ws(value)[:max_len]


def parse_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def parse_manifest_files(index_path: Path, key: str) -> list[str]:
    if not index_path.exists():
        return []
    payload = parse_json(index_path)
    values = payload.get(key) or payload.get("files") or []
    out: list[str] = []
    for raw in values:
        text = collapse_ws(str(raw))
        if text and text.endswith(".json"):
            out.append(text)
    return out


def load_talks(events_dir: Path) -> list[dict]:
    files = parse_manifest_files(events_dir / "index.json", "eventFiles")
    talks: list[dict] = []
    for rel in files:
        path = events_dir / rel
        if not path.exists():
            continue
        payload = parse_json(path)
        for talk in payload.get("talks", []):
            if isinstance(talk, dict):
                talks.append(talk)
    return talks


def load_papers(papers_dir: Path) -> list[dict]:
    files = parse_manifest_files(papers_dir / "index.json", "paperFiles")
    papers: list[dict] = []
    for rel in files:
        path = papers_dir / rel
        if not path.exists():
            continue
        payload = parse_json(path)
        for paper in payload.get("papers", []):
            if isinstance(paper, dict):
                papers.append(paper)
    return papers


def parse_docs_payload(js_path: Path) -> dict:
    if not js_path.exists():
        return {}
    raw = js_path.read_text(encoding="utf-8")
    marker = "window.LLVMDocsUniversalSearchIndex="
    start = raw.find(marker)
    if start < 0:
        return {}
    start += len(marker)
    end = raw.rfind(";")
    if end <= start:
        return {}
    blob = raw[start:end].strip()
    if not blob:
        return {}
    try:
        payload = json.loads(blob)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def add_count(buckets: dict[str, dict], label: str, max_len: int = 220) -> None:
    clean = normalize_label(label, max_len)
    key = normalize_key(clean)
    if not clean or not key:
        return
    bucket = buckets.setdefault(key, {"count": 0, "labels": defaultdict(int)})
    bucket["count"] += 1
    bucket["labels"][clean] += 1


def finalize_count_buckets(
    buckets: dict[str, dict],
    *,
    limit: int,
    alpha: bool = False,
) -> list[dict[str, object]]:
    entries: list[dict[str, object]] = []
    for bucket in buckets.values():
        labels = bucket.get("labels") or {}
        if not labels:
            continue
        label = sorted(labels.items(), key=lambda item: (-item[1], item[0]))[0][0]
        entries.append({"label": label, "count": int(bucket.get("count") or 0)})

    if alpha:
        entries.sort(key=lambda item: str(item["label"]).lower())
    else:
        entries.sort(key=lambda item: (-int(item["count"]), str(item["label"]).lower()))

    return entries[: max(0, limit)]


def normalize_doc_url(raw_href: str, base_prefix: str) -> str:
    href = collapse_ws(raw_href)
    if not href:
        return f"{base_prefix}/"
    if re.match(r"^https?://", href, flags=re.IGNORECASE):
        return href
    if href.startswith("/"):
        return href
    if href.startswith("docs/"):
        return href
    joined = posixpath.join(base_prefix, href)
    joined = re.sub(r"/{2,}", "/", joined)
    return joined


def collect_docs_entries(
    repo_root: Path,
    *,
    limit: int,
) -> list[dict[str, object]]:
    sources = [
        (
            repo_root / "docs" / "_static" / "docs-universal-search-index.js",
            "LLVM Core",
            "docs",
        ),
        (
            repo_root / "docs" / "clang" / "_static" / "docs-universal-search-index.js",
            "Clang",
            "docs/clang",
        ),
        (
            repo_root / "docs" / "lldb" / "_static" / "docs-universal-search-index.js",
            "LLDB",
            "docs/lldb",
        ),
    ]

    buckets: dict[str, dict] = {}

    for js_path, source_label, base_prefix in sources:
        payload = parse_docs_payload(js_path)
        entries = payload.get("entries") if isinstance(payload, dict) else []
        if not isinstance(entries, list):
            continue

        for raw_entry in entries:
            if not isinstance(raw_entry, dict):
                continue
            title = normalize_label(str(raw_entry.get("title") or ""), 220)
            if not title:
                continue
            rendered_label = f"{title} ({source_label})"
            key = normalize_key(rendered_label)
            if not key:
                continue

            bucket = buckets.setdefault(
                key,
                {
                    "count": 0,
                    "labels": defaultdict(int),
                    "url": "",
                },
            )
            bucket["count"] += 1
            bucket["labels"][rendered_label] += 1
            if not bucket["url"]:
                bucket["url"] = normalize_doc_url(str(raw_entry.get("href") or ""), base_prefix)

    out: list[dict[str, object]] = []
    for bucket in buckets.values():
        labels = bucket.get("labels") or {}
        if not labels:
            continue
        label = sorted(labels.items(), key=lambda item: (-item[1], item[0]))[0][0]
        out.append(
            {
                "label": label,
                "count": int(bucket.get("count") or 0),
                "url": str(bucket.get("url") or "docs/"),
            }
        )

    out.sort(key=lambda item: (-int(item["count"]), str(item["label"]).lower()))
    return out[: max(0, limit)]


def build_payload(
    repo_root: Path,
    *,
    max_topics: int,
    max_people: int,
    max_talk_titles: int,
    max_paper_titles: int,
    max_docs_titles: int,
) -> dict[str, object]:
    events_dir = repo_root / "devmtg" / "events"
    papers_dir = repo_root / "papers"

    talks = load_talks(events_dir)
    papers = load_papers(papers_dir)

    topic_buckets: dict[str, dict] = {}
    people_buckets: dict[str, dict] = {}
    talk_title_buckets: dict[str, dict] = {}
    paper_title_buckets: dict[str, dict] = {}

    for talk in talks:
        add_count(talk_title_buckets, str(talk.get("title") or ""), max_len=220)

        tags = talk.get("tags") if isinstance(talk.get("tags"), list) else []
        for tag in tags:
            add_count(topic_buckets, str(tag), max_len=120)

        speakers = talk.get("speakers") if isinstance(talk.get("speakers"), list) else []
        for speaker in speakers:
            if isinstance(speaker, dict):
                add_count(people_buckets, str(speaker.get("name") or ""), max_len=120)

    for paper in papers:
        add_count(paper_title_buckets, str(paper.get("title") or ""), max_len=220)

        tags = paper.get("tags") if isinstance(paper.get("tags"), list) else []
        keywords = paper.get("keywords") if isinstance(paper.get("keywords"), list) else []
        for value in [*tags, *keywords]:
            add_count(topic_buckets, str(value), max_len=120)

        authors = paper.get("authors") if isinstance(paper.get("authors"), list) else []
        for author in authors:
            if isinstance(author, dict):
                add_count(people_buckets, str(author.get("name") or ""), max_len=120)

    topics = finalize_count_buckets(topic_buckets, limit=max_topics, alpha=False)
    people = finalize_count_buckets(people_buckets, limit=max_people, alpha=False)
    talks_out = finalize_count_buckets(talk_title_buckets, limit=max_talk_titles, alpha=True)
    papers_out = finalize_count_buckets(paper_title_buckets, limit=max_paper_titles, alpha=True)
    docs_out = collect_docs_entries(repo_root, limit=max_docs_titles)

    return {
        "meta": {
            "source": "scripts/generate-autocomplete-index.py",
            "talkCount": len(talks),
            "paperCount": len(papers),
            "entryCount": {
                "topics": len(topics),
                "people": len(people),
                "talks": len(talks_out),
                "papers": len(papers_out),
                "docs": len(docs_out),
            },
        },
        "topics": topics,
        "people": people,
        "talks": talks_out,
        "papers": papers_out,
        "docs": docs_out,
    }


def payload_for_compare(payload: dict) -> dict:
    normalized = json.loads(json.dumps(payload, ensure_ascii=False))
    meta = normalized.get("meta")
    if isinstance(meta, dict):
        meta["generatedAt"] = ""
    return normalized


def generated_at_now() -> str:
    return (
        dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", default=str(repo_root))
    parser.add_argument("--output", default="js/data/autocomplete-index.json")
    parser.add_argument("--max-topics", type=int, default=800)
    parser.add_argument("--max-people", type=int, default=6000)
    parser.add_argument("--max-talk-titles", type=int, default=5000)
    parser.add_argument("--max-paper-titles", type=int, default=8000)
    parser.add_argument("--max-docs-titles", type=int, default=4500)
    parser.add_argument("--check", action="store_true", help="Fail if output is not up to date.")
    args = parser.parse_args()

    root = Path(args.repo_root).resolve()
    output_path = (root / args.output).resolve()

    payload = build_payload(
        root,
        max_topics=max(1, args.max_topics),
        max_people=max(1, args.max_people),
        max_talk_titles=max(1, args.max_talk_titles),
        max_paper_titles=max(1, args.max_paper_titles),
        max_docs_titles=max(1, args.max_docs_titles),
    )
    existing_payload = None
    if output_path.exists():
        try:
            existing_payload = json.loads(output_path.read_text(encoding="utf-8"))
        except Exception:
            existing_payload = None

    if isinstance(existing_payload, dict):
        if payload_for_compare(existing_payload) == payload_for_compare(payload):
            print(f"OK: autocomplete index is up to date ({output_path})")
            return 0

    if args.check:
        print(f"ERROR: autocomplete index is stale ({output_path})", file=sys.stderr)
        return 1

    meta = payload.get("meta")
    if isinstance(meta, dict):
        meta["generatedAt"] = generated_at_now()

    serialized = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(serialized, encoding="utf-8")
    print(f"Wrote autocomplete index: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
