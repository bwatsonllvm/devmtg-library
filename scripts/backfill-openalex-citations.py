#!/usr/bin/env python3
"""Backfill citation counts from OpenAlex into local paper bundles.

Usage:
  ./scripts/backfill-openalex-citations.py \
    --bundle /Users/britton/Desktop/library/papers/openalex-llvm-query.json \
    --bundle /Users/britton/Desktop/library/papers/combined-all-papers-deduped.json \
    --manifest /Users/britton/Desktop/library/papers/index.json
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import math
import subprocess
import time
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode

OPENALEX_WORKS_API = "https://api.openalex.org/works"


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fh:
        payload = json.load(fh)
    if not isinstance(payload, dict):
        raise ValueError(f"{path}: expected JSON object")
    return payload


def _save_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _openalex_short_id(openalex_id: str) -> str:
    raw = (openalex_id or "").strip()
    if not raw:
        return ""
    suffix = raw.rsplit("/", 1)[-1].strip().upper()
    if not suffix.startswith("W"):
        return ""
    if len(suffix) < 2:
        return ""
    return suffix


def _chunks(items: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _fetch_openalex_counts(short_ids: list[str], mailto: str = "") -> dict[str, int]:
    if not short_ids:
        return {}

    counts: dict[str, int] = {}
    batch_size = 40
    total_batches = math.ceil(len(short_ids) / batch_size)

    for idx, batch in enumerate(_chunks(short_ids, batch_size), start=1):
        params = {
            "filter": f"openalex:{'|'.join(batch)}",
            "per-page": str(len(batch)),
            "select": "id,cited_by_count",
        }
        if mailto:
            params["mailto"] = mailto

        url = f"{OPENALEX_WORKS_API}?{urlencode(params)}"
        cmd = [
            "curl",
            "-sS",
            "--retry",
            "5",
            "--retry-all-errors",
            "--connect-timeout",
            "20",
            "--max-time",
            "60",
            "-A",
            "library-openalex-citations-backfill/1.0",
            url,
        ]
        proc = subprocess.run(cmd, check=True, capture_output=True, text=True)
        payload = json.loads(proc.stdout)

        for work in payload.get("results", []) or []:
            full_id = str(work.get("id", "")).strip()
            short_id = _openalex_short_id(full_id)
            if not short_id:
                continue
            cited_by = work.get("cited_by_count", 0)
            try:
                count = int(cited_by)
            except Exception:
                count = 0
            counts[short_id] = max(0, count)

        print(f"[openalex] fetched batch {idx}/{total_batches} ({len(batch)} ids)", flush=True)
        time.sleep(0.08)

    return counts


def _collect_short_ids_from_bundles(bundle_payloads: list[tuple[Path, dict]]) -> list[str]:
    ids: set[str] = set()
    for path, payload in bundle_payloads:
        papers = payload.get("papers")
        if not isinstance(papers, list):
            raise ValueError(f"{path}: missing papers array")
        for paper in papers:
            if not isinstance(paper, dict):
                continue
            short_id = _openalex_short_id(str(paper.get("openalexId", "")))
            if short_id:
                ids.add(short_id)
    return sorted(ids)


def _apply_counts_to_bundle(payload: dict, counts: dict[str, int]) -> tuple[int, int]:
    papers = payload.get("papers")
    if not isinstance(papers, list):
        raise ValueError("bundle missing papers array")

    updated = 0
    with_openalex_id = 0

    for paper in papers:
        if not isinstance(paper, dict):
            continue
        short_id = _openalex_short_id(str(paper.get("openalexId", "")))
        if not short_id:
            continue
        with_openalex_id += 1
        count = int(counts.get(short_id, 0))
        previous = paper.get("citationCount")
        if previous != count:
            updated += 1
        paper["citationCount"] = count

    return updated, with_openalex_id


def _update_manifest_version(manifest_path: Path) -> str:
    payload = _load_json(manifest_path)
    today = _dt.date.today().isoformat()
    data_version = f"{today}-combined-all-papers-deduped-v2-after-2001-abstract-backfill-v1-citations-v1"
    payload["dataVersion"] = data_version
    _save_json(manifest_path, payload)
    return data_version


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bundle",
        dest="bundles",
        action="append",
        required=True,
        help="Path to a papers JSON bundle (repeat for multiple files).",
    )
    parser.add_argument(
        "--manifest",
        default="",
        help="Optional papers/index.json path to update dataVersion.",
    )
    parser.add_argument(
        "--mailto",
        default="",
        help="Optional contact email for OpenAlex polite pool.",
    )
    args = parser.parse_args()

    bundle_paths = [Path(p).resolve() for p in args.bundles]
    bundle_payloads: list[tuple[Path, dict]] = []
    for path in bundle_paths:
        if not path.exists():
            raise SystemExit(f"Missing bundle file: {path}")
        bundle_payloads.append((path, _load_json(path)))

    short_ids = _collect_short_ids_from_bundles(bundle_payloads)
    print(f"Unique OpenAlex ids to fetch: {len(short_ids)}")
    counts = _fetch_openalex_counts(short_ids, mailto=args.mailto.strip())
    print(f"Counts resolved from OpenAlex: {len(counts)}")

    for path, payload in bundle_payloads:
        updated, with_openalex_id = _apply_counts_to_bundle(payload, counts)
        _save_json(path, payload)
        print(
            f"Updated bundle: {path} | papers_with_openalex_id={with_openalex_id} | citationCount_written={updated}",
            flush=True,
        )

    if args.manifest:
        manifest_path = Path(args.manifest).resolve()
        if not manifest_path.exists():
            raise SystemExit(f"Missing manifest file: {manifest_path}")
        data_version = _update_manifest_version(manifest_path)
        print(f"Updated manifest dataVersion: {data_version}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
